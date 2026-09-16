package httpapi

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func TestPublishedSalesSiteRoutesAreExplicitAndComplete(t *testing.T) {
	expectedKeys := []string{
		"4u", "avalon-residence", "bayterak", "botanika-saroyi", "c1",
		"flagman", "jomiy", "maftun-makon", "meros", "mirador", "ofiyat",
		"regnum-plaza", "saadiyat", "sado", "sarbon", "soy-boyi", "sun",
		"voha", "yangibaxt", "zamon",
	}
	if len(publishedSalesSiteRoutes) != len(expectedKeys) {
		t.Fatalf("published route count = %d, want %d", len(publishedSalesSiteRoutes), len(expectedKeys))
	}
	for _, key := range expectedKeys {
		routes, ok := publishedSalesSiteRoutes[key]
		if !ok {
			t.Errorf("published route %q is missing", key)
			continue
		}
		if key == "avalon-residence" {
			if routes.passportPath != "/" || routes.apartmentsPath != "" {
				t.Errorf("Avalon routes = %#v, want only the root passport path", routes)
			}
			continue
		}
		if routes.passportPath != "/"+key || routes.apartmentsPath != "/"+key+"/apartments" {
			t.Errorf("routes for %q = %#v", key, routes)
		}
	}
	if _, published := publishedSalesSiteRoutes["avalon"]; published {
		t.Fatal("legacy Avalon alias must not become a canonical project key")
	}
}

func TestBuildProjectRegistryMapsCurrentSummariesAndFiltersUnpublished(t *testing.T) {
	updatedAt := time.Date(2026, time.September, 16, 12, 30, 0, 0, time.UTC)
	projects := []domain.ProjectSummary{
		{ID: 1, DeveloperSlug: "tencorp", Slug: "avalon-residence", Name: "Avalon Residence", TotalUnits: 268, AvailableUnits: 41, UpdatedAt: &updatedAt},
		{ID: 2, DeveloperSlug: "internal", Slug: "unpublished-pilot", Name: "Unpublished Pilot", TotalUnits: 10, AvailableUnits: 9, UpdatedAt: &updatedAt},
		{ID: 3, DeveloperSlug: "murad-buildings", Slug: "soy-boyi", Name: "Soy Bo‘yi", TotalUnits: 209, AvailableUnits: 20, UpdatedAt: &updatedAt},
	}

	got := buildProjectRegistry(projects)
	want := []domain.ProjectRegistryItem{
		{ProjectKey: "avalon-residence", Name: "Avalon Residence", Published: true, PassportPath: "/", TotalUnits: 268, AvailableUnits: 41, UpdatedAt: &updatedAt},
		{ProjectKey: "soy-boyi", Name: "Soy Bo‘yi", Published: true, PassportPath: "/soy-boyi", ApartmentsPath: "/soy-boyi/apartments", TotalUnits: 209, AvailableUnits: 20, UpdatedAt: &updatedAt},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("registry = %#v, want %#v", got, want)
	}
	for _, item := range got {
		if item.ProjectKey == "unpublished-pilot" {
			t.Fatal("unpublished catalog leaked into the project registry")
		}
	}
}

func TestBuildProjectRegistryReturnsNonNilEmptyItems(t *testing.T) {
	items := buildProjectRegistry([]domain.ProjectSummary{{Slug: "unpublished-pilot", Name: "Pilot"}})
	if items == nil || len(items) != 0 {
		t.Fatalf("empty registry = %#v, want a non-nil empty slice", items)
	}
}

func TestAvalonRegistryJSONIsExplicitAndDoesNotSynthesizePaths(t *testing.T) {
	items := buildProjectRegistry([]domain.ProjectSummary{{Slug: "avalon-residence", Name: "Avalon Residence"}})
	encoded, err := json.Marshal(items[0])
	if err != nil {
		t.Fatal(err)
	}
	var item map[string]any
	if err := json.Unmarshal(encoded, &item); err != nil {
		t.Fatal(err)
	}
	if item["published"] != true || item["passportPath"] != "/" {
		t.Fatalf("Avalon JSON contract = %s", encoded)
	}
	if _, exists := item["apartmentsPath"]; exists {
		t.Fatalf("Avalon JSON must omit a nonexistent separate apartments path: %s", encoded)
	}
	if _, exists := item["id"]; exists {
		t.Fatalf("deployment-local project id leaked into registry JSON: %s", encoded)
	}
	if _, exists := item["developerSlug"]; exists {
		t.Fatalf("catalog-only developer metadata leaked into registry JSON: %s", encoded)
	}
}
