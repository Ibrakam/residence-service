package importer

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestPushkinPublicCatalogPreservesIdentitiesAndPrices(t *testing.T) {
	bundle, err := LoadCatalogFile(filepath.Join("..", "..", "..", "website", "data", "pushkin-catalog.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Projects) != 1 {
		t.Fatal("expected one Pushkin project")
	}
	p := bundle.Projects[0]
	if p.Slug != "pushkin" || p.DeveloperSlug != "tower-up" || !p.Complete || p.OfficialCount == nil || len(p.Units) != *p.OfficialCount {
		t.Fatal("Pushkin catalogue lost its project identity or completeness")
	}
	seen := map[string]bool{}
	for _, u := range p.Units {
		if u.Status != "available" || u.PropertyType != "apartment" || seen[u.SourceKey] || !strings.HasPrefix(u.SourceKey, "taqsim:pushkin:") {
			t.Fatal("Pushkin catalogue contains an invalid or duplicate apartment")
		}
		seen[u.SourceKey] = true
		if u.Price == nil || *u.Price <= 0 || !strings.HasPrefix(u.PlanImageURL, "/pushkin/plans/") {
			t.Fatal("Pushkin price or plan is missing")
		}
	}
}
