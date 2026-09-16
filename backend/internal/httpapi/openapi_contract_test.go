package httpapi

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFloorSchemeRouteAndOpenAPIContract(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/projects/mirador/floor-schemes", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("floor-scheme path is not registered as a GET route: status=%d", recorder.Code)
	}

	body, err := os.ReadFile(filepath.Join("..", "..", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	document := string(body)
	routeStart := strings.Index(document, "  /v1/projects/{slug}/floor-schemes:")
	routeEnd := strings.Index(document, "  /v1/units/{id}:")
	if routeStart < 0 || routeEnd <= routeStart {
		t.Fatal("OpenAPI floor-scheme route section is missing")
	}
	routeSection := document[routeStart:routeEnd]
	for _, required := range []string{"\n    get:\n", "operationId: getFloorSchemeArtifact", "security: []", "'200':", "'404':"} {
		if !strings.Contains(routeSection, required) {
			t.Errorf("OpenAPI floor-scheme route is missing %q", required)
		}
	}
	for _, required := range []string{
		"FloorSchemeArtifact:",
		"FloorSchemeExpectedUniverse:",
		"FloorSchemeCompanionEvidence:",
		"FloorSchemeCompanionRecord:",
		"sidecarByteSha256:",
		"backendApiArtifactSha256:",
		"expectedManifestByteSha256:",
		"enum: [2, 3]",
		"not-published-by-source",
		"phaseSlug/entrance/floor/unitNumber",
		"sourceScreenshotWidth:",
		"sourceScreenshotHeight:",
		"blockEntranceMapping всегда null",
		"legacy v2 — 10 Mirador companion-only квартир",
		"CRM IDs, routes",
		"JSON number разрешается исключительно по deployment-local units.id",
		"units.source_id",
		"Stable opaque units.source_key",
	} {
		if !strings.Contains(document, required) {
			t.Errorf("OpenAPI floor-scheme/identity contract is missing %q", required)
		}
	}
}

func TestCatalogProviderStatusRouteAndOpenAPIContract(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/sync/catalog-status", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("catalog provider status path is not registered as a GET route: status=%d", recorder.Code)
	}

	body, err := os.ReadFile(filepath.Join("..", "..", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	document := string(body)
	for _, required := range []string{
		"/v1/sync/catalog-status:",
		"operationId: getCatalogProviderSyncStatus",
		"CatalogProviderSyncStatus:",
		"CatalogProjectSyncStatus:",
		"lastAttemptAt:",
		"lastSuccessAt:",
		"lastCapturedAt:",
		"freshness:",
		"errorCode:",
		"command output and credentials are never exposed",
	} {
		if !strings.Contains(document, required) {
			t.Errorf("OpenAPI catalog provider status contract is missing %q", required)
		}
	}
}

func TestMonthlySalesRouteAndOpenAPIContract(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/analytics/monthly-sales", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("monthly sales path is not registered as a GET route: status=%d", recorder.Code)
	}

	body, err := os.ReadFile(filepath.Join("..", "..", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	document := string(body)
	for _, required := range []string{
		"/v1/analytics/monthly-sales:",
		"operationId: getMonthlyUnitSales",
		"MonthlyUnitSales:",
		"trackingStartedAt:",
		"Asia/Tashkent",
		"Первый снимок", // Keep the safety semantics discoverable to clients.
		"available-only",
	} {
		if !strings.Contains(document, required) {
			t.Errorf("OpenAPI monthly sales contract is missing %q", required)
		}
	}
}

func TestProjectQueueOpenAPIContract(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	document := string(body)
	for _, required := range []string{
		"ProjectQueue:",
		"queueKey:",
		"queueLabel:",
		"queueDisplayCode:",
		"queueOrder:",
		"CRM-owned queue metadata",
		"не выводится из phase/building/block",
	} {
		if !strings.Contains(document, required) {
			t.Errorf("OpenAPI explicit queue contract is missing %q", required)
		}
	}
	if count := strings.Count(document, "      - name: queue\n"); count != 3 {
		t.Errorf("queue query parameter count=%d, want units/layouts/availability", count)
	}
}

func TestProjectRegistryRouteAndOpenAPIContract(t *testing.T) {
	handler := New(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/v1/project-registry", nil)
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("project registry path is not registered as a GET route: status=%d", recorder.Code)
	}

	body, err := os.ReadFile(filepath.Join("..", "..", "openapi", "openapi.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	document := string(body)
	for _, required := range []string{
		"/v1/project-registry:",
		"operationId: listProjectRegistry",
		"ProjectRegistryItem:",
		"required: [projectKey, name, published, passportPath",
		"const: true",
		"клиент не должен вычислять его из projectKey",
	} {
		if !strings.Contains(document, required) {
			t.Errorf("OpenAPI project registry contract is missing %q", required)
		}
	}
}
