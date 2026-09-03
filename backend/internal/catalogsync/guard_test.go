package catalogsync

import (
	"errors"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

func validatedProvider(t *testing.T) ProviderConfig {
	t.Helper()
	config := Config{
		Version:       1,
		WorkDirectory: "/var/lib/catalog-sync",
		Providers: []ProviderConfig{{
			Name: "kayan", Command: []string{"/opt/capture"},
			Projects: map[string]ProjectPolicy{
				"mirador": {MinimumRecords: 10},
				"ofiyat":  {MinimumRecords: 10},
			},
		}},
	}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
	return config.Providers[0]
}

func preparedProject(slug string, count int, capturedAt time.Time, checksum string, complete bool) importer.PreparedCatalogImport {
	return importer.PreparedCatalogImport{Bundles: []importer.CatalogBundle{{
		Checksum: checksum,
		Projects: []importer.CatalogProject{{
			Slug: slug, Complete: complete, CapturedAt: capturedAt,
			Units: make([]importer.NormalizedUnit, count),
		}},
	}}}
}

func mergePrepared(items ...importer.PreparedCatalogImport) importer.PreparedCatalogImport {
	result := importer.PreparedCatalogImport{}
	for _, item := range items {
		result.Bundles = append(result.Bundles, item.Bundles...)
	}
	return result
}

func TestCompletenessGuardAcceptsGrowthAndNormalSmallDrop(t *testing.T) {
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	prepared := mergePrepared(
		preparedProject("mirador", 109, now, "new-m", true),
		preparedProject("ofiyat", 90, now, "new-o", true),
	)
	baselines := map[string]AcceptedProject{
		"mirador": {Records: 100, CapturedAt: now.Add(-time.Minute), Checksum: "old-m"},
		"ofiyat":  {Records: 100, CapturedAt: now.Add(-time.Minute), Checksum: "old-o"},
	}
	if err := ValidatePreparedCatalog(validatedProvider(t), prepared, baselines, now); err != nil {
		t.Fatal(err)
	}
}

func TestCompletenessGuardUsesProjectChecksumForMultiProjectCapture(t *testing.T) {
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	mirador := preparedProject("mirador", 100, now, "whole-file-a", true)
	ofiyat := preparedProject("ofiyat", 101, now, "whole-file-b", true)
	prepared := mirador
	prepared.Bundles[0].Checksum = "changed-whole-multi-project-file"
	prepared.Bundles[0].Projects = append(prepared.Bundles[0].Projects, ofiyat.Bundles[0].Projects[0])
	miradorChecksum, err := importer.CatalogProjectContentChecksum(mirador.Bundles[0].Projects[0])
	if err != nil {
		t.Fatal(err)
	}
	baselines := map[string]AcceptedProject{
		"mirador": {Records: 100, CapturedAt: now, Checksum: miradorChecksum},
	}
	if err := ValidatePreparedCatalog(validatedProvider(t), prepared, baselines, now); err != nil {
		t.Fatalf("a changed sibling made an unchanged project look modified: %v", err)
	}
}

func TestCompletenessGuardFailureCodes(t *testing.T) {
	now := time.Date(2026, 9, 3, 10, 0, 0, 0, time.UTC)
	provider := validatedProvider(t)
	validMirador := preparedProject("mirador", 100, now, "m", true)
	validOfiyat := preparedProject("ofiyat", 100, now, "o", true)
	officialMismatch := preparedProject("mirador", 100, now, "m", true)
	officialCount := 101
	officialMismatch.Bundles[0].Projects[0].OfficialCount = &officialCount
	tests := []struct {
		name      string
		prepared  importer.PreparedCatalogImport
		baselines map[string]AcceptedProject
		code      string
	}{
		{"missing project", validMirador, nil, "missing_project"},
		{"unexpected project", mergePrepared(validMirador, validOfiyat, preparedProject("other", 10, now, "x", true)), nil, "unexpected_project"},
		{"partial capture", mergePrepared(preparedProject("mirador", 100, now, "m", false), validOfiyat), nil, "incomplete_capture"},
		{"below configured minimum", mergePrepared(preparedProject("mirador", 9, now, "m", true), validOfiyat), nil, "below_minimum"},
		{"official count mismatch", mergePrepared(officialMismatch, validOfiyat), nil, "official_count_mismatch"},
		{"record count collapse", mergePrepared(preparedProject("mirador", 60, now, "m", true), validOfiyat), map[string]AcceptedProject{"mirador": {Records: 100, CapturedAt: now.Add(-time.Minute), Checksum: "old"}}, "excessive_record_drop"},
		{"capture time regression", mergePrepared(validMirador, validOfiyat), map[string]AcceptedProject{"mirador": {Records: 100, CapturedAt: now.Add(time.Minute), Checksum: "old"}}, "capture_time_regressed"},
		{"same time changed bytes", mergePrepared(validMirador, validOfiyat), map[string]AcceptedProject{"mirador": {Records: 100, CapturedAt: now, Checksum: "different"}}, "timestamp_content_conflict"},
		{"future capture", mergePrepared(preparedProject("mirador", 100, now.Add(16*time.Minute), "m", true), validOfiyat), nil, "future_capture_time"},
		{"stale capture", mergePrepared(preparedProject("mirador", 100, now.Add(-31*time.Minute), "m", true), validOfiyat), nil, "stale_capture"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := ValidatePreparedCatalog(provider, test.prepared, test.baselines, now)
			var guard *GuardError
			if !errors.As(err, &guard) || guard.Code != test.code {
				t.Fatalf("guard error=%v, code=%q, want %q", err, guardCode(guard), test.code)
			}
		})
	}
}

func guardCode(err *GuardError) string {
	if err == nil {
		return ""
	}
	return err.Code
}
