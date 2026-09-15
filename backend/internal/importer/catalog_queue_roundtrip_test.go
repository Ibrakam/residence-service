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
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func TestCatalogQueueDatabaseRoundTripAndLastKnownGood(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL queue round-trip")
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
	projectSlug := fmt.Sprintf("queue-roundtrip-%d", suffix)
	developerSlug := projectSlug + "-developer"
	capturedAt := time.Now().UTC().Truncate(time.Microsecond)
	dataDir := t.TempDir()
	catalogPath := filepath.Join(dataDir, projectSlug+"-catalog.json")
	writeCatalog := func(queues any) {
		t.Helper()
		catalog := map[string]any{
			"capturedAt":  capturedAt,
			"projectSlug": projectSlug,
			"project": map[string]any{
				"slug": projectSlug, "name": "Queue round-trip", "developerSlug": developerSlug,
			},
			"sourceCount": 2,
			"queues":      queues,
			"units": []any{
				map[string]any{
					"id": "crm-1", "sourceKey": projectSlug + ":1", "phaseSlug": "q1-s1", "phaseName": "Q1/S1",
					"queueKey": "q1", "queueLabel": "I очередь", "queueDisplayCode": "I", "queueOrder": 1,
					"propertyType": "apartment", "rawPropertyType": "residential", "status": "available", "rawStatus": "AVAILABLE",
					"number": "1", "floor": 1, "area": 45, "currency": "UZS",
				},
				map[string]any{
					"id": "crm-3", "sourceKey": projectSlug + ":3", "phaseSlug": "q3-s1", "phaseName": "Q3/S1",
					"queueKey": "q3", "queueLabel": "II очередь", "queueDisplayCode": "II", "queueOrder": 2,
					"propertyType": "apartment", "rawPropertyType": "residential", "status": "available", "rawStatus": "AVAILABLE",
					"number": "3", "floor": 3, "area": 65, "currency": "UZS",
				},
			},
		}
		body, err := json.MarshalIndent(catalog, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(catalogPath, append(body, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	queues := []any{
		map[string]any{"sourceId": "1", "queueKey": "q1", "queueLabel": "I очередь", "queueDisplayCode": "I", "queueOrder": 1},
		map[string]any{"sourceId": "3", "queueKey": "q3", "queueLabel": "II очередь", "queueDisplayCode": "II", "queueOrder": 2},
	}
	writeCatalog(queues)

	result, err := ImportCatalogDirectory(ctx, pool, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var developerID, projectID int64
	if err := pool.QueryRow(ctx, `
		SELECT d.id,p.id FROM projects p JOIN developers d ON d.id=p.developer_id
		WHERE p.slug=$1 AND d.slug=$2`, projectSlug, developerSlug).Scan(&developerID, &projectID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE sync_run_id=$1`, result.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE id=$1`, result.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, developerID)
	}()

	store := database.NewStore(pool)
	project, err := store.GetProject(ctx, projectSlug)
	if err != nil {
		t.Fatal(err)
	}
	if len(project.Queues) != 2 || project.Queues[1].QueueKey != "q3" || project.Queues[1].QueueLabel != "II очередь" || project.Queues[1].QueueOrder != 2 {
		t.Fatalf("authoritative project queues did not round-trip: %#v", project.Queues)
	}
	page, err := store.ListUnits(ctx, domain.UnitFilter{ProjectSlug: projectSlug, QueueKey: "q3", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].QueueKey != "q3" || page.Items[0].QueueLabel != "II очередь" || page.Items[0].PhaseSlug != "q3-s1" {
		t.Fatalf("queue-filtered unit did not round-trip independently of phase: %#v", page)
	}

	// A corrupt next snapshot must fail during preparation, before it can clear
	// or relabel the last accepted queue rows.
	writeCatalog([]any{map[string]any{
		"sourceId": "3", "queueKey": "q3", "queueLabel": "", "queueDisplayCode": "III", "queueOrder": 3,
	}})
	if _, err := ImportCatalogDirectory(ctx, pool, dataDir); err == nil {
		t.Fatal("invalid queue metadata replaced the last-known-good catalog")
	}
	project, err = store.GetProject(ctx, projectSlug)
	if err != nil {
		t.Fatal(err)
	}
	if len(project.Queues) != 2 || project.Queues[1].QueueLabel != "II очередь" || project.Queues[1].QueueOrder != 2 {
		t.Fatalf("invalid metadata changed last-known-good queues: %#v", project.Queues)
	}
}
