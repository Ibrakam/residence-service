package importer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/httpapi"
)

func TestProductionRegnumSnapshotPreservesNumericStringSourceIDs(t *testing.T) {
	path := filepath.Clean(filepath.Join("..", "..", "..", "website", "data", "regnum-plaza-client.json"))
	bundle, err := LoadCatalogFile(path)
	if err != nil {
		t.Fatalf("load production-shaped Regnum snapshot: %v", err)
	}
	if len(bundle.Projects) != 1 || bundle.Projects[0].Slug != "regnum-plaza" {
		t.Fatalf("unexpected Regnum bundle: %#v", bundle.Projects)
	}

	unitsBySourceID := make(map[string]NormalizedUnit, len(bundle.Projects[0].Units))
	for _, unit := range bundle.Projects[0].Units {
		unitsBySourceID[unit.SourceID] = unit
	}
	for _, sourceID := range []string{"12", "235"} {
		unit, ok := unitsBySourceID[sourceID]
		if !ok {
			t.Fatalf("production Regnum source_id %q was not imported", sourceID)
		}
		if unit.SourceKey == "" || unit.SourceKey == sourceID {
			t.Fatalf("Regnum source_id %q lost its distinct stable sourceKey: %#v", sourceID, unit)
		}
	}
}

func TestProductionRegnumImportLeadKeepsStringIDsInSourceIDNamespace(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL import/lead round-trip")
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

	productionPath := filepath.Clean(filepath.Join("..", "..", "..", "website", "data", "regnum-plaza-client.json"))
	body, err := os.ReadFile(productionPath)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	slug := fmt.Sprintf("regnum-identity-%d", time.Now().UnixNano())
	payload["projectSlug"] = slug
	payload["project"] = "REGNUM PLAZA identity fixture"
	body, err = json.MarshalIndent(payload, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, slug+"-client.json"), append(body, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}
	importResult, err := ImportCatalogDirectory(ctx, pool, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if importResult.Projects != 1 || importResult.RecordsSaved != 12 {
		t.Fatalf("unexpected Regnum production-shaped import result: %#v", importResult)
	}

	var projectID, developerID int64
	if err := pool.QueryRow(ctx, `
		SELECT p.id,d.id FROM projects p JOIN developers d ON d.id=p.developer_id WHERE p.slug=$1`, slug,
	).Scan(&projectID, &developerID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM leads WHERE project_id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE sync_run_id=$1`, importResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE id=$1`, importResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM projects WHERE developer_id=$1)`, developerID)
	}()

	type expectedUnit struct {
		id        int64
		sourceKey string
	}
	expectedBySourceID := make(map[string]expectedUnit, 2)
	for _, sourceID := range []string{"12", "235"} {
		var expected expectedUnit
		if err := pool.QueryRow(ctx, `
			SELECT u.id,u.source_key
			FROM units u JOIN phases ph ON ph.id=u.phase_id
			WHERE ph.project_id=$1 AND u.is_active AND u.source_id=$2`, projectID, sourceID,
		).Scan(&expected.id, &expected.sourceKey); err != nil {
			t.Fatalf("load imported Regnum source_id %q: %v", sourceID, err)
		}
		if expected.sourceKey == "" || expected.sourceKey == sourceID {
			t.Fatalf("Regnum source_id %q has unsafe canonical sourceKey %q", sourceID, expected.sourceKey)
		}
		expectedBySourceID[sourceID] = expected
	}

	store := database.NewStore(pool)
	server := httptest.NewServer(httpapi.New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), "", true))
	defer server.Close()
	for index, sourceID := range []string{"12", "235"} {
		phone := fmt.Sprintf("+99890123456%d", index)
		requestBody, err := json.Marshal(map[string]any{
			"projectSlug": slug,
			"unitId":      sourceID,
			"lastViewedApartment": map[string]any{
				"unitId": sourceID,
			},
			"name": "Backend QA", "phone": phone, "goal": "live", "language": "ru", "consent": true,
		})
		if err != nil {
			t.Fatal(err)
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/leads", bytes.NewReader(requestBody))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		responseBody, readErr := io.ReadAll(response.Body)
		_ = response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != http.StatusCreated {
			t.Fatalf("Regnum string unitId %q lead status=%d body=%s", sourceID, response.StatusCode, responseBody)
		}

		var unitID, lastViewedUnitID int64
		var unitReference, lastViewedReference string
		if err := pool.QueryRow(ctx, `
			SELECT unit_id,last_viewed_unit_id,unit_reference,last_viewed_reference
			FROM leads WHERE project_id=$1 AND phone=$2 ORDER BY id DESC LIMIT 1`, projectID, phone,
		).Scan(&unitID, &lastViewedUnitID, &unitReference, &lastViewedReference); err != nil {
			t.Fatal(err)
		}
		expected := expectedBySourceID[sourceID]
		if unitID != expected.id || lastViewedUnitID != expected.id || unitReference != sourceID || lastViewedReference != sourceID {
			t.Fatalf("Regnum string unitId %q resolved to unit/last/reference %d/%d/%q/%q, want %d/%d/%q/%q", sourceID, unitID, lastViewedUnitID, unitReference, lastViewedReference, expected.id, expected.id, sourceID, sourceID)
		}
	}
}
