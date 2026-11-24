package catalogsync

import (
	"errors"
	"github.com/tencorp/real-estate-platform/backend/internal/importer"
	"testing"
	"time"
)

func TestOverlayModeIsExplicitAndAllowsOnlyNonnegativeFloors(t *testing.T) {
	for _, test := range []struct {
		mode    string
		minimum int
		valid   bool
	}{{"", 0, false}, {"complete", 0, false}, {"overlay", 0, true}, {"overlay", -1, false}, {"partial", 1, false}, {"complete", 1, true}} {
		config := Config{Version: 1, WorkDirectory: "/tmp/sync", Providers: []ProviderConfig{{Name: "public", ImportMode: test.mode, Command: []string{"/opt/capture"}, Projects: map[string]ProjectPolicy{"avalon": {MinimumRecords: test.minimum}}}}}
		if err := config.Validate(); (err == nil) != test.valid {
			t.Fatalf("mode=%s minimum=%d err=%v", test.mode, test.minimum, err)
		}
	}
}

func TestOverlayGuardRetainsListingCompletenessAndTimestampSafety(t *testing.T) {
	now := time.Now().UTC()
	config := Config{Version: 1, WorkDirectory: "/tmp/sync", Providers: []ProviderConfig{{Name: "public", ImportMode: "overlay", Command: []string{"/opt/capture"}, Projects: map[string]ProjectPolicy{"avalon": {MinimumRecords: 0}}}}}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
	provider := config.Providers[0]
	listing := func(count int) importer.PreparedCatalogImport {
		p := preparedProject("avalon", count, now, "test", false)
		p.Bundles[0].Projects[0].CatalogScope = importer.PublishedOffersScope
		p.Bundles[0].Projects[0].OfficialCount = &count
		return p
	}
	baseline := map[string]AcceptedProject{"avalon": {Records: 500, CapturedAt: now.Add(-time.Minute), MatrixBlockIDs: []string{"old-crm-block"}}}
	for _, count := range []int{0, 1, 30} {
		if err := ValidatePreparedCatalog(provider, listing(count), baseline, now); err != nil {
			t.Fatalf("public subset %d rejected: %v", count, err)
		}
	}
	for _, test := range []struct {
		name, code string
		mutate     func(*importer.CatalogProject)
	}{
		{"full claim", "invalid_overlay_scope", func(p *importer.CatalogProject) { p.Complete = true }},
		{"missing scope", "invalid_overlay_scope", func(p *importer.CatalogProject) { p.CatalogScope = "" }},
		{"missing official listing count", "invalid_overlay_scope", func(p *importer.CatalogProject) { p.OfficialCount = nil }},
		{"truncated pagination", "official_count_mismatch", func(p *importer.CatalogProject) { count := 3; p.OfficialCount = &count }},
		{"stale listing", "stale_capture", func(p *importer.CatalogProject) { p.CapturedAt = now.Add(-time.Hour) }},
		{"regressed listing", "capture_time_regressed", func(p *importer.CatalogProject) { p.CapturedAt = now.Add(-2 * time.Minute) }},
	} {
		t.Run(test.name, func(t *testing.T) {
			candidate := listing(1)
			test.mutate(&candidate.Bundles[0].Projects[0])
			err := ValidatePreparedCatalog(provider, candidate, baseline, now)
			var guard *GuardError
			if !errors.As(err, &guard) || guard.Code != test.code {
				t.Fatalf("err=%v want=%s", err, test.code)
			}
		})
	}
	provider.ImportMode = "complete"
	if err := ValidatePreparedCatalog(provider, listing(1), nil, now); err == nil {
		t.Fatal("complete provider accepted public overlay")
	}
}
