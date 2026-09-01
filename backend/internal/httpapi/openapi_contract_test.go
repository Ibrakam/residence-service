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
