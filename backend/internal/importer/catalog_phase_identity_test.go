package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
)

func TestCatalogPhaseUpsertReconcilesSourceIDAndPreservesRow(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL phase identity test")
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

	suffix := time.Now().UnixNano()
	developerSlug := fmt.Sprintf("phase-identity-%d", suffix)
	projectSlug := fmt.Sprintf("phase-identity-project-%d", suffix)
	var developerID, projectID, originalPhaseID, originalUnitID int64
	if err := pool.QueryRow(ctx, `INSERT INTO developers(slug,name) VALUES($1,$2) RETURNING id`, developerSlug, developerSlug).Scan(&developerID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, developerID)
	}()
	if err := pool.QueryRow(ctx, `INSERT INTO projects(developer_id,slug,name) VALUES($1,$2,$3) RETURNING id`, developerID, projectSlug, projectSlug).Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO phases(project_id,source_id,slug,name,property_type)
		VALUES($1,'42','human-readable','Old','apartment') RETURNING id`, projectID).Scan(&originalPhaseID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO units(
			phase_id,source_key,source_id,property_type,raw_property_type,status,raw_status,
			number,area,currency,source_updated_at
		) VALUES($1,'old-key','official-unit-42','apartment','Квартира','sold','Продано','42',50,'UZS',now())
		RETURNING id`, originalPhaseID).Scan(&originalUnitID); err != nil {
		t.Fatal(err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	phaseID, err := upsertCatalogPhase(ctx, tx, projectID, CatalogPhase{
		SourceID: "42", Slug: "block-42", Name: "Live", PropertyType: "apartment",
	}, time.Now().UTC())
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if phaseID != originalPhaseID {
		t.Fatalf("phase row changed from %d to %d", originalPhaseID, phaseID)
	}
	var sourceID, slug, name string
	if err := pool.QueryRow(ctx, `SELECT source_id,slug,name FROM phases WHERE id=$1`, originalPhaseID).Scan(&sourceID, &slug, &name); err != nil {
		t.Fatal(err)
	}
	if sourceID != "42" || slug != "block-42" || name != "Live" {
		t.Fatalf("phase identity was not reconciled: sourceID=%q slug=%q name=%q", sourceID, slug, name)
	}

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	price := int64(500_000_000)
	if err := upsertUnit(ctx, tx, phaseID, time.Now().UTC(), NormalizedUnit{
		SourceID: "official-unit-42", SourceKey: "live-key", PhaseSlug: "block-42",
		PropertyType: "apartment", RawPropertyType: "Квартира", Status: "available", RawStatus: "Свободно",
		Number: "42", Area: 50, Price: &price, Currency: "UZS", SourcePayload: json.RawMessage(`{}`),
	}); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var unitID int64
	var sourceKey, status string
	if err := pool.QueryRow(ctx, `SELECT id,source_key,status FROM units WHERE phase_id=$1 AND source_id='official-unit-42'`, originalPhaseID).Scan(&unitID, &sourceKey, &status); err != nil {
		t.Fatal(err)
	}
	if unitID != originalUnitID || sourceKey != "live-key" || status != "available" {
		t.Fatalf("unit identity was not reconciled: id=%d sourceKey=%q status=%q", unitID, sourceKey, status)
	}
}

func TestCatalogPhaseUpsertRejectsAmbiguousIdentity(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL phase identity test")
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

	suffix := time.Now().UnixNano()
	developerSlug := fmt.Sprintf("phase-ambiguity-%d", suffix)
	projectSlug := fmt.Sprintf("phase-ambiguity-project-%d", suffix)
	var developerID, projectID int64
	if err := pool.QueryRow(ctx, `INSERT INTO developers(slug,name) VALUES($1,$2) RETURNING id`, developerSlug, developerSlug).Scan(&developerID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, developerID)
	}()
	if err := pool.QueryRow(ctx, `INSERT INTO projects(developer_id,slug,name) VALUES($1,$2,$3) RETURNING id`, developerID, projectSlug, projectSlug).Scan(&projectID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO phases(project_id,source_id,slug,name,property_type) VALUES
		($1,'source-a','old-a','A','apartment'),
		($1,'source-b','target','B','apartment')`, projectID); err != nil {
		t.Fatal(err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = upsertCatalogPhase(ctx, tx, projectID, CatalogPhase{
		SourceID: "source-a", Slug: "target", Name: "Ambiguous", PropertyType: "apartment",
	}, time.Now().UTC())
	_ = tx.Rollback(ctx)
	if err == nil {
		t.Fatal("ambiguous source ID and slug were accepted")
	}
}
