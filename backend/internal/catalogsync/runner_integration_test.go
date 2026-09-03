package catalogsync

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

func TestProviderAdvisoryLockPreventsOverlap(t *testing.T) {
	databaseURL := os.Getenv("CATALOG_SYNC_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set CATALOG_SYNC_TEST_DATABASE_URL to run the PostgreSQL catalog sync round-trip")
	}
	ctx := t.Context()
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	first, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	second, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Release()
	provider := fmt.Sprintf("lock-test-%d", time.Now().UnixNano())
	locked, err := tryProviderLock(ctx, first, provider)
	if err != nil || !locked {
		t.Fatalf("first lock=(%v,%v)", locked, err)
	}
	defer releaseProviderLock(first, provider)
	locked, err = tryProviderLock(ctx, second, provider)
	if err != nil {
		t.Fatal(err)
	}
	if locked {
		releaseProviderLock(second, provider)
		t.Fatal("overlapping provider lock was acquired")
	}
}

func TestProviderImportKeepsLastGoodCatalogAfterGuardFailure(t *testing.T) {
	databaseURL := os.Getenv("CATALOG_SYNC_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set CATALOG_SYNC_TEST_DATABASE_URL to run the PostgreSQL catalog sync round-trip")
	}
	ctx := t.Context()
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}

	identity := time.Now().UnixNano()
	providerName := fmt.Sprintf("test-%d", identity)
	projectSlug := fmt.Sprintf("sync-test-%d", identity)
	developerSlug := projectSlug + "-developer"
	provider := ProviderConfig{
		Name: providerName, Command: []string{"/opt/not-executed"}, FreshnessWindow: "30m",
		Projects: map[string]ProjectPolicy{projectSlug: {MinimumRecords: 2}},
	}
	config := Config{Version: 1, WorkDirectory: "/var/lib/catalog-sync-test", Providers: []ProviderConfig{provider}}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
	provider = config.Providers[0]
	source := ProviderSource(provider.Name)
	recoverySource := "recovery-test/" + provider.Name

	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Release()
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_sync_projects WHERE project_slug=$1`, projectSlug)
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_sync_providers WHERE provider=$1`, providerName)
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE source=$1`, source)
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE source=$1`, recoverySource)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE source=$1`, source)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE source=$1`, recoverySource)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE slug=$1`, developerSlug)
	}()

	firstAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	firstSuccessAt := firstAt.Add(5 * time.Second)
	first := providerPreparedFixture(projectSlug, developerSlug, firstAt, 3, "first")
	firstRunID, err := startAttempt(ctx, connection, provider, firstAt)
	if err != nil {
		t.Fatal(err)
	}
	_, err = importer.ImportPreparedCatalog(ctx, pool, first, importer.CatalogImportOptions{
		Source: source, SyncRunID: firstRunID,
		Finalize: func(ctx context.Context, tx pgx.Tx, _ importer.CatalogImportResult) error {
			return finalizeSuccess(ctx, tx, provider, first, firstRunID, firstSuccessAt)
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	var active int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM units u
		JOIN phases ph ON ph.id=u.phase_id
		JOIN projects p ON p.id=ph.project_id
		WHERE p.slug=$1 AND u.is_active`, projectSlug).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 3 {
		t.Fatalf("first active count=%d", active)
	}
	stale := providerPreparedFixture(projectSlug, developerSlug, firstAt.Add(-time.Minute), 3, "stale-recovery")
	if _, err := importer.ImportPreparedCatalog(ctx, pool, stale, importer.CatalogImportOptions{Source: recoverySource}); err == nil {
		t.Fatal("older recovery catalog replaced newer live data")
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM units u
		JOIN phases ph ON ph.id=u.phase_id
		JOIN projects p ON p.id=ph.project_id
		WHERE p.slug=$1 AND u.is_active`, projectSlug).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 3 {
		t.Fatalf("stale recovery changed last-known-good active count to %d", active)
	}

	secondAt := firstAt.Add(time.Minute)
	secondRunID, err := startAttempt(ctx, connection, provider, secondAt)
	if err != nil {
		t.Fatal(err)
	}
	baselines, err := loadAcceptedProjects(ctx, connection, source)
	if err != nil {
		t.Fatal(err)
	}
	truncated := providerPreparedFixture(projectSlug, developerSlug, secondAt, 1, "truncated")
	guardErr := ValidatePreparedCatalog(provider, truncated, baselines, secondAt)
	var typedGuard *GuardError
	if !errors.As(guardErr, &typedGuard) || typedGuard.Code != "below_minimum" {
		t.Fatalf("truncated capture guard=%v", guardErr)
	}
	if err := finishFailed(ctx, connection, provider, secondRunID, secondAt, "completeness_guard_failed", typedGuard); err != nil {
		t.Fatal(err)
	}

	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM units u
		JOIN phases ph ON ph.id=u.phase_id
		JOIN projects p ON p.id=ph.project_id
		WHERE p.slug=$1 AND u.is_active`, projectSlug).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if active != 3 {
		t.Fatalf("guard failure changed last-known-good active count to %d", active)
	}
	var attemptStatus, errorCode string
	var lastSuccessRunID int64
	var freshUntil time.Time
	if err := pool.QueryRow(ctx, `
		SELECT last_attempt_status,error_code,last_success_run_id,fresh_until
		FROM catalog_sync_projects WHERE project_slug=$1`, projectSlug).Scan(
		&attemptStatus, &errorCode, &lastSuccessRunID, &freshUntil,
	); err != nil {
		t.Fatal(err)
	}
	if attemptStatus != "failed" || errorCode != "below_minimum" || lastSuccessRunID != firstRunID {
		t.Fatalf("project status=(%q,%q,%d), want failed/below_minimum/first run", attemptStatus, errorCode, lastSuccessRunID)
	}
	if wantFreshUntil := firstAt.Add(provider.FreshnessDuration()); !freshUntil.Equal(wantFreshUntil) {
		t.Fatalf("freshUntil=%s, want capture-based %s", freshUntil, wantFreshUntil)
	}
	statuses, err := database.NewStore(pool).CatalogProviderSyncStatus(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, status := range statuses {
		if status.Provider != providerName {
			continue
		}
		found = true
		if status.Status != "failed" || status.Freshness != "fresh" || status.ErrorCode != "completeness_guard_failed" || status.LastSuccessAt == nil {
			t.Fatalf("provider machine status lost LKG/failure split: %#v", status)
		}
		if len(status.Projects) != 1 || status.Projects[0].ErrorCode != "below_minimum" || status.Projects[0].Freshness != "fresh" || status.Projects[0].RecordCount == nil || *status.Projects[0].RecordCount != 3 {
			t.Fatalf("project machine status is incomplete: %#v", status.Projects)
		}
	}
	if !found {
		t.Fatal("provider is missing from machine-readable status")
	}
}

func TestProviderImportRollsBackDataWhenAtomicFinalizerFails(t *testing.T) {
	databaseURL := os.Getenv("CATALOG_SYNC_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set CATALOG_SYNC_TEST_DATABASE_URL to run the PostgreSQL catalog sync round-trip")
	}
	ctx := t.Context()
	pool, err := database.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}

	identity := time.Now().UnixNano()
	providerName := fmt.Sprintf("rollback-%d", identity)
	projectSlug := fmt.Sprintf("rollback-project-%d", identity)
	developerSlug := projectSlug + "-developer"
	provider := ProviderConfig{
		Name: providerName, Command: []string{"/opt/not-executed"},
		Projects: map[string]ProjectPolicy{projectSlug: {MinimumRecords: 1}},
	}
	config := Config{Version: 1, WorkDirectory: "/var/lib/catalog-sync-test", Providers: []ProviderConfig{provider}}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
	provider = config.Providers[0]
	source := ProviderSource(provider.Name)
	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Release()
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_sync_projects WHERE project_slug=$1`, projectSlug)
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_sync_providers WHERE provider=$1`, providerName)
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE source=$1`, source)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE source=$1`, source)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE slug=$1`, developerSlug)
	}()

	attemptAt := time.Now().UTC().Truncate(time.Microsecond)
	runID, err := startAttempt(ctx, connection, provider, attemptAt)
	if err != nil {
		t.Fatal(err)
	}
	prepared := providerPreparedFixture(projectSlug, developerSlug, attemptAt, 2, "rollback")
	_, err = importer.ImportPreparedCatalog(ctx, pool, prepared, importer.CatalogImportOptions{
		Source: source, SyncRunID: runID,
		Finalize: func(context.Context, pgx.Tx, importer.CatalogImportResult) error {
			return errors.New("injected finalizer failure")
		},
	})
	if err == nil {
		t.Fatal("injected finalizer failure was ignored")
	}
	var projects int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM projects WHERE slug=$1`, projectSlug).Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if projects != 0 {
		t.Fatalf("catalog rows committed without their provider success state: projects=%d", projects)
	}
	var runStatus string
	if err := pool.QueryRow(ctx, `SELECT status FROM sync_runs WHERE id=$1`, runID).Scan(&runStatus); err != nil {
		t.Fatal(err)
	}
	if runStatus != "failed" {
		t.Fatalf("failed atomic import run status=%q", runStatus)
	}
}

func providerPreparedFixture(projectSlug, developerSlug string, capturedAt time.Time, records int, checksum string) importer.PreparedCatalogImport {
	units := make([]importer.NormalizedUnit, 0, records)
	for index := 0; index < records; index++ {
		units = append(units, importer.NormalizedUnit{
			PhaseSlug: "phase-1", SourceKey: fmt.Sprintf("unit-%d", index+1),
			PropertyType: "apartment", RawPropertyType: "apartment",
			Status: "available", RawStatus: "available", Number: fmt.Sprintf("%d", index+1),
			Floor: 1, Area: 40 + float64(index), Currency: "UZS", SourcePayload: []byte(`{}`),
		})
	}
	return importer.PreparedCatalogImport{Bundles: []importer.CatalogBundle{{
		Path: "provider-catalog.json", Checksum: checksum, SchemaName: "test-v1", CapturedAt: capturedAt,
		Projects: []importer.CatalogProject{{
			DeveloperSlug: developerSlug, DeveloperName: developerSlug,
			Slug: projectSlug, Name: projectSlug, CapturedAt: capturedAt, Complete: true,
			Phases: []importer.CatalogPhase{{
				SourceID: "phase-1", Slug: "phase-1", Name: "Phase 1", PropertyType: "apartment",
			}},
			Units: units,
		}},
	}}}
}
