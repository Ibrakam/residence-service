package catalogsync

import (
	"fmt"
	"sort"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/importer"
)

const maximumFutureSkew = 15 * time.Minute

type AcceptedProject struct {
	Records    int
	CapturedAt time.Time
	Checksum   string
}

type GuardError struct {
	Code        string
	ProjectSlug string
	message     string
}

func (err *GuardError) Error() string {
	return err.message
}

func guardFailure(code, slug, message string, arguments ...any) error {
	return &GuardError{Code: code, ProjectSlug: slug, message: fmt.Sprintf(message, arguments...)}
}

// ValidatePreparedCatalog rejects incomplete, unexpectedly small, regressed,
// or sharply truncated captures before the importer can deactivate any rows.
// Baselines come only from this provider's previous successful imports, so the
// first live import is governed by the explicit per-project minimum.
func ValidatePreparedCatalog(provider ProviderConfig, prepared importer.PreparedCatalogImport, baselines map[string]AcceptedProject, now time.Time) error {
	type candidateProject struct {
		project  importer.CatalogProject
		checksum string
	}
	candidates := make(map[string]candidateProject)
	for _, bundle := range prepared.Bundles {
		for _, project := range bundle.Projects {
			if _, duplicate := candidates[project.Slug]; duplicate {
				return guardFailure("duplicate_project", project.Slug, "duplicate project %q in provider output", project.Slug)
			}
			checksum, err := importer.CatalogProjectContentChecksum(project)
			if err != nil {
				return guardFailure("checksum_failed", project.Slug, "project %q cannot be checksummed", project.Slug)
			}
			candidates[project.Slug] = candidateProject{project: project, checksum: checksum}
		}
	}

	expected := provider.ProjectSlugs()
	for _, slug := range expected {
		candidate, ok := candidates[slug]
		if !ok {
			return guardFailure("missing_project", slug, "expected project %q is missing", slug)
		}
		delete(candidates, slug)

		project := candidate.project
		count := len(project.Units)
		if project.OfficialCount != nil && count+project.DuplicateUnits != *project.OfficialCount {
			return guardFailure("official_count_mismatch", slug, "project %q record count does not match its official count", slug)
		}
		if !project.Complete {
			return guardFailure("incomplete_capture", slug, "project %q is not marked complete", slug)
		}
		if count < provider.Projects[slug].MinimumRecords {
			return guardFailure("below_minimum", slug, "project %q has %d records below its configured minimum", slug, count)
		}
		if project.CapturedAt.After(now.Add(maximumFutureSkew)) {
			return guardFailure("future_capture_time", slug, "project %q capture time is too far in the future", slug)
		}
		if !project.CapturedAt.Add(provider.FreshnessDuration()).After(now) {
			return guardFailure("stale_capture", slug, "project %q capture is older than its freshness window", slug)
		}

		baseline, hasBaseline := baselines[slug]
		if !hasBaseline {
			continue
		}
		minimumRetained := float64(baseline.Records) * (100 - provider.MaximumDropPercent()) / 100
		if float64(count) < minimumRetained {
			return guardFailure("excessive_record_drop", slug, "project %q record count dropped beyond the configured limit", slug)
		}
		if project.CapturedAt.Before(baseline.CapturedAt) {
			return guardFailure("capture_time_regressed", slug, "project %q capture time regressed", slug)
		}
		if project.CapturedAt.Equal(baseline.CapturedAt) && candidate.checksum != baseline.Checksum {
			return guardFailure("timestamp_content_conflict", slug, "project %q changed without a newer capture time", slug)
		}
	}

	if len(candidates) > 0 {
		unexpected := make([]string, 0, len(candidates))
		for slug := range candidates {
			unexpected = append(unexpected, slug)
		}
		sort.Strings(unexpected)
		return guardFailure("unexpected_project", unexpected[0], "provider output contains unexpected project %q", unexpected[0])
	}
	return nil
}
