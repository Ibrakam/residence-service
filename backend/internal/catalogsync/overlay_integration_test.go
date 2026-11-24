package catalogsync

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func TestPublishedOverlayZeroMinimumStartsAttemptAndRetries(t *testing.T) {
	databaseURL := os.Getenv("CATALOG_SYNC_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set CATALOG_SYNC_TEST_DATABASE_URL for isolated PostgreSQL overlay policy regression")
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
	name := fmt.Sprintf("overlay-start-%d", identity)
	slug := fmt.Sprintf("overlay-project-%d", identity)
	config := Config{Version: 1, WorkDirectory: "/tmp/catalog-overlay-test", Providers: []ProviderConfig{{Name: name, ImportMode: "overlay", Command: []string{"/opt/not-executed"}, Projects: map[string]ProjectPolicy{slug: {MinimumRecords: 0}}}}}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
	provider := config.Providers[0]
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM catalog_sync_providers WHERE provider=$1`, name)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE source=$1`, ProviderSource(name))
	}()
	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Release()
	at := time.Now().UTC().Truncate(time.Microsecond)
	firstRun, err := startAttempt(ctx, connection, provider, at)
	if err != nil {
		t.Fatalf("zero-floor overlay attempt rejected after migration: %v", err)
	}
	secondRun, err := startAttempt(ctx, connection, provider, at.Add(time.Minute))
	if err != nil {
		t.Fatalf("zero-floor overlay retry failed: %v", err)
	}
	if firstRun == secondRun || firstRun == 0 || secondRun == 0 {
		t.Fatal("attempt identities were not distinct")
	}
	var minimum int
	var run int64
	var status string
	if err := pool.QueryRow(ctx, `SELECT minimum_records,last_attempt_run_id,last_attempt_status FROM catalog_sync_projects WHERE project_slug=$1`, slug).Scan(&minimum, &run, &status); err != nil {
		t.Fatal(err)
	}
	if minimum != 0 || run != secondRun || status != "running" {
		t.Fatalf("policy floor/run/status=%d/%d/%s", minimum, run, status)
	}
	var previousStatus, errorCode string
	if err := pool.QueryRow(ctx, `SELECT status,error FROM sync_runs WHERE id=$1`, firstRun).Scan(&previousStatus, &errorCode); err != nil {
		t.Fatal(err)
	}
	if previousStatus != "failed" || errorCode != "interrupted" {
		t.Fatalf("retry did not atomically interrupt previous attempt: %s/%s", previousStatus, errorCode)
	}
	if _, err := pool.Exec(ctx, `UPDATE catalog_sync_projects SET minimum_records=-1 WHERE project_slug=$1`, slug); err == nil {
		t.Fatal("database accepted a negative minimum")
	}
	config.Providers[0].ImportMode = "complete"
	if err := config.Validate(); err == nil {
		t.Fatal("full-catalog provider accepted zero minimum")
	}
}
