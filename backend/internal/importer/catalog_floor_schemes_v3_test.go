package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func TestGeneratedV3NotPublishedFloorSchemeArtifactIsAnAuditedZero(t *testing.T) {
	artifact, project := validNotPublishedFloorSchemeV3Fixture()
	body := marshalFloorSchemeSidecarForTest(t, artifact)
	if err := validateGeneratedFloorSchemeArtifact(artifact, project, body); err != nil {
		t.Fatalf("valid audited zero capture was rejected: %v", err)
	}

	bundle := CatalogBundle{Projects: []CatalogProject{project}}
	artifacts, err := loadGeneratedSidecarFixture(t, body, bundle)
	if err != nil {
		t.Fatal(err)
	}
	got := artifacts["ofiyat"]
	if got.SchemaVersion != 3 || got.CaptureStatus != "not-published-by-source" || got.CapturedAt == nil || got.FloorSchemeCount != 0 || got.HotspotCount != 0 || len(got.Schemes) != 0 || got.ExpectedUniverse != nil || got.CompanionEvidence != nil || len(got.SidecarByteSHA256) != 64 || len(got.BackendAPIArtifactSHA256) != 64 {
		t.Fatalf("audited zero capture changed during sanitized import: %#v", got)
	}

	tests := []struct {
		name   string
		mutate func(*domain.FloorSchemeArtifact)
		want   string
	}{
		{name: "capturedAt required", mutate: func(value *domain.FloorSchemeArtifact) { value.CapturedAt = nil }, want: "audited read-only zero capture"},
		{name: "capturedAt cannot predate observation", mutate: func(value *domain.FloorSchemeArtifact) {
			timestamp := value.SourceObservedAt.Add(-time.Second)
			value.CapturedAt = &timestamp
		}, want: "audited read-only zero capture"},
		{name: "captured source required", mutate: func(value *domain.FloorSchemeArtifact) { value.SourceStatus = "blocked-by-authentication" }, want: "audited read-only zero capture"},
		{name: "unavailable mode required", mutate: func(value *domain.FloorSchemeArtifact) { value.CaptureScope.Mode = "blocked" }, want: "audited read-only zero capture"},
		{name: "audit exclusion required", mutate: func(value *domain.FloorSchemeArtifact) {
			value.CaptureScope.AuditedExclusions = []domain.FloorSchemeAuditedExclusion{}
		}, want: "lacks an audited exclusion"},
		{name: "cannot assert expected 91/414 universe", mutate: func(value *domain.FloorSchemeArtifact) {
			value.ExpectedUniverse = &domain.FloorSchemeExpectedUniverse{SchemeCount: 91, UnitCount: 414}
		}, want: "unsupported captured data"},
		{name: "cannot disguise zero as partial", mutate: func(value *domain.FloorSchemeArtifact) { value.CaptureStatus = "captured-partial" }, want: "invalid empty schema v3"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mutated := artifact
			test.mutate(&mutated)
			err := validateGeneratedFloorSchemeArtifact(mutated, project, marshalFloorSchemeSidecarForTest(t, mutated))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want %q", err, test.want)
			}
		})
	}
}

func TestGeneratedV3FloorSchemesUseCompositePhaseIdentity(t *testing.T) {
	artifact, project := validCapturedFloorSchemeV3Fixture()
	body := marshalFloorSchemeSidecarForTest(t, artifact)
	if err := validateGeneratedFloorSchemeArtifact(artifact, project, body); err != nil {
		t.Fatalf("two phases sharing entrance/floor/unit number were rejected: %v", err)
	}
	if !project.CapturedAt.After(*artifact.CapturedAt) {
		t.Fatal("fixture no longer proves catalog freshness is decoupled from audited geometry capture time")
	}
	imageBody := testFloorSchemeWebPBytes(t)
	imageDigest := sha256.Sum256(imageBody)
	for index := range artifact.Schemes {
		artifact.Schemes[index].ImageSHA256 = hex.EncodeToString(imageDigest[:])
		artifact.Schemes[index].ImageBytes = int64(len(imageBody))
	}
	loaded, err := loadGeneratedSidecarFixture(t, marshalFloorSchemeSidecarForTest(t, artifact), CatalogBundle{Projects: []CatalogProject{project}})
	if err != nil || loaded["ofiyat"].FloorSchemeCount != 2 {
		t.Fatalf("schema v3 local WebP assets did not survive full generated-sidecar loading: artifact=%#v err=%v", loaded["ofiyat"], err)
	}

	tests := []struct {
		name   string
		mutate func(*domain.FloorSchemeArtifact)
		want   string
	}{
		{name: "phaseSlug required", mutate: func(value *domain.FloorSchemeArtifact) { value.Schemes[0].PhaseSlug = "" }, want: "phaseSlug"},
		{name: "parking phase rejected", mutate: func(value *domain.FloorSchemeArtifact) { value.Schemes[0].PhaseSlug = "parking" }, want: "not an apartment phase"},
		{name: "cross-phase unitKey", mutate: func(value *domain.FloorSchemeArtifact) {
			value.Schemes[1].Zones[0].UnitKey = value.Schemes[0].Zones[0].UnitKey
		}, want: "does not strictly match"},
		{name: "duplicate composite scheme", mutate: func(value *domain.FloorSchemeArtifact) { value.Schemes[1].PhaseSlug = value.Schemes[0].PhaseSlug }, want: "duplicates phase/entrance/floor"},
		{name: "project-local image prefix", mutate: func(value *domain.FloorSchemeArtifact) {
			value.Schemes[0].ImageURL = "/kayan/mirador/floor-schemes/p1.webp"
		}, want: "outside"},
		{name: "source screenshot dimensions required", mutate: func(value *domain.FloorSchemeArtifact) { value.Schemes[0].SourceScreenshotWidth = 0 }, want: "source screenshot provenance"},
		{name: "exact expected phase", mutate: func(value *domain.FloorSchemeArtifact) { value.ExpectedUniverse.Assignments[0].PhaseSlug = "phase-2" }, want: "does not strictly match"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mutated := cloneFloorSchemeArtifactForTest(t, artifact)
			test.mutate(&mutated)
			err := validateGeneratedFloorSchemeArtifact(mutated, project, marshalFloorSchemeSidecarForTest(t, mutated))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want %q", err, test.want)
			}
		})
	}
}

func TestGeneratedV3CompanionIdentityIsPhaseAware(t *testing.T) {
	artifact, project := validCapturedFloorSchemeV3Fixture()
	artifact.Schemes[1].Zones[0].UnitKey = nil
	artifact.ExpectedUniverse.Assignments[1].UnitKey = nil
	artifact.ExpectedUniverse.Assignments[1].Evidence = "official-public-companion"
	oneCatalogUnit := 1
	artifact.ExpectedUniverse.CatalogUnitCount = &oneCatalogUnit
	artifact.ExpectedUniverse.CompanionUnitCount = 1
	artifact.CompanionEvidence = &domain.FloorSchemeCompanionEvidence{
		Source: "official-public-floor-capture-v1", SourceObservedAt: artifact.SourceObservedAt,
		RecordCount: 1, UnitNumbers: []string{"101"},
		Records:       []domain.FloorSchemeCompanionRecord{{PhaseSlug: "phase-2", Entrance: "A", Floor: 3, UnitNumber: "101"}},
		RecordsSHA256: strings.Repeat("d", 64),
	}
	if err := validateGeneratedFloorSchemeArtifact(artifact, project, marshalFloorSchemeSidecarForTest(t, artifact)); err != nil {
		t.Fatalf("exact phase-aware companion evidence was rejected: %v", err)
	}
	artifact.CompanionEvidence.Records[0].PhaseSlug = "phase-1"
	if err := validateGeneratedFloorSchemeArtifact(artifact, project, marshalFloorSchemeSidecarForTest(t, artifact)); err == nil || !strings.Contains(err.Error(), "exact phase-aware companion evidence") {
		t.Fatalf("cross-phase companion record was accepted: %v", err)
	}
}

func TestFloorSchemeV3PersistenceGuardsPhaseAndSchemaDowngrades(t *testing.T) {
	for _, required := range []string{
		"ph.slug=$2",
		"EXCLUDED.schema_version >= project_floor_scheme_artifacts.schema_version",
		"not-published-by-source",
	} {
		if !strings.Contains(upsertFloorSchemeArtifactSQL+generatedFloorSchemeUnitLookupSQL, required) {
			t.Fatalf("phase-aware persistence is missing %q", required)
		}
	}
	if strings.Contains(generatedFloorSchemeUnitLookupSQL, "ph.slug='main'") {
		t.Fatal("generated floor-scheme persistence still hardcodes the Mirador main phase")
	}

	observed := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	blocked := domain.FloorSchemeArtifact{SchemaVersion: 2, CaptureStatus: "blocked-by-authentication", SourceObservedAt: observed}
	unavailable := domain.FloorSchemeArtifact{SchemaVersion: 3, CaptureStatus: "not-published-by-source", SourceObservedAt: observed.Add(time.Minute)}
	capturedAt := observed.Add(2 * time.Minute)
	captured := domain.FloorSchemeArtifact{SchemaVersion: 3, CaptureStatus: "captured-complete", CapturedAt: &capturedAt, SourceObservedAt: capturedAt}
	if !floorSchemeArtifactMayReplace(blocked, unavailable) || !floorSchemeArtifactMayReplace(unavailable, captured) {
		t.Fatal("a newer audited/captured v3 artifact could not replace a weaker zero state")
	}
	if floorSchemeArtifactMayReplace(unavailable, blocked) || floorSchemeArtifactMayReplace(captured, unavailable) {
		t.Fatal("floor-scheme persistence permits a status/schema downgrade")
	}
	staleCapturedAt := observed.Add(-time.Minute)
	staleCaptured := domain.FloorSchemeArtifact{SchemaVersion: 3, CaptureStatus: "captured-complete", CapturedAt: &staleCapturedAt, SourceObservedAt: staleCapturedAt}
	if floorSchemeArtifactMayReplace(unavailable, staleCaptured) {
		t.Fatal("an older captured artifact may replace a newer audited source-unavailable observation")
	}

	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "0010_floor_scheme_phase_aware_unavailable_status.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"not-published-by-source", "schema_version >= 3", "captured_at IS NOT NULL", "schemes = '[]'::jsonb"} {
		if !strings.Contains(string(migration), required) {
			t.Fatalf("forward migration is missing audited-zero guard %q", required)
		}
	}
}

func validNotPublishedFloorSchemeV3Fixture() (domain.FloorSchemeArtifact, CatalogProject) {
	observedAt := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	capturedAt := observedAt.Add(time.Minute)
	artifact := domain.FloorSchemeArtifact{
		SchemaVersion: 3, ProjectSlug: "ofiyat", CapturedAt: &capturedAt,
		CaptureStatus: "not-published-by-source",
		CaptureScope: domain.FloorSchemeCaptureScope{
			Mode: "unavailable", DeclaredBlocks: []int{}, DeclaredEntrances: []string{},
			DeclaredFloors: []domain.FloorSchemeScopeFloor{}, DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{},
			AuditedExclusions: []domain.FloorSchemeAuditedExclusion{{
				Kind: "official-floor-schemes", Reason: "not-published-by-source",
				Evidence: "The authenticated read-only source exposed Chess, Chess+, Premises and Layouts, but no official floor-plan assets.",
			}},
		},
		SourceStatus: "captured-read-only", SourceObservedAt: observedAt,
		BlockEntranceMapping: nil, Schemes: []domain.FloorScheme{}, ExpectedUniverse: nil, CompanionEvidence: nil,
	}
	project := CatalogProject{Slug: "ofiyat", CapturedAt: observedAt.Add(24 * time.Hour)}
	return artifact, project
}

func validCapturedFloorSchemeV3Fixture() (domain.FloorSchemeArtifact, CatalogProject) {
	observedAt := time.Date(2026, time.September, 1, 12, 0, 0, 0, time.UTC)
	capturedAt := observedAt.Add(time.Minute)
	key1, key2 := "ofiyat:phase-1:A:3:101", "ofiyat:phase-2:A:3:101"
	catalogUnitCount := 2
	project := CatalogProject{
		Slug: "ofiyat", CapturedAt: observedAt.Add(time.Hour),
		Phases: []CatalogPhase{
			{Slug: "phase-1", PropertyType: "apartment"},
			{Slug: "phase-2", PropertyType: "apartment"},
			{Slug: "parking", PropertyType: "parking"},
		},
		Units: []NormalizedUnit{
			{PhaseSlug: "phase-1", SourceKey: key1, PropertyType: "apartment", Entrance: "A", Floor: 3, Number: "101"},
			{PhaseSlug: "phase-2", SourceKey: key2, PropertyType: "apartment", Entrance: "A", Floor: 3, Number: "101"},
		},
	}
	makeScheme := func(phaseSlug, imageURL string, unitKey *string) domain.FloorScheme {
		return domain.FloorScheme{
			PhaseSlug: phaseSlug, Entrance: "A", Floor: 3,
			ImageURL: imageURL, ImageSHA256: strings.Repeat("a", 64), ImageBytes: 2048,
			Width: 32, Height: 32, SourceScreenshotSHA256: strings.Repeat("b", 64),
			SourceScreenshotWidth: 100, SourceScreenshotHeight: 100,
			SourceCrop: domain.FloorSchemeImageRectangle{X: 10, Y: 10, Width: 32, Height: 32},
			Zones:      []domain.FloorSchemeZone{{UnitKey: unitKey, UnitNumber: "101", Points: "2,2 30,2 30,30 2,30", Label: domain.FloorSchemeLabel{X: 16, Y: 16}}},
		}
	}
	artifact := domain.FloorSchemeArtifact{
		SchemaVersion: 3, ProjectSlug: "ofiyat", CapturedAt: &capturedAt,
		CaptureStatus: "captured-complete", SourceStatus: "captured-read-only", SourceObservedAt: observedAt,
		FloorSchemeCount: 2, HotspotCount: 2,
		CaptureScope: domain.FloorSchemeCaptureScope{
			Mode: "complete", DeclaredBlocks: []int{}, DeclaredEntrances: []string{"A"},
			DeclaredFloors: []domain.FloorSchemeScopeFloor{
				{PhaseSlug: "phase-1", Entrance: "A", Floor: 3},
				{PhaseSlug: "phase-2", Entrance: "A", Floor: 3},
			},
			DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{
				{PhaseSlug: "phase-1", Entrance: "A", Floor: 3, UnitNumber: "101"},
				{PhaseSlug: "phase-2", Entrance: "A", Floor: 3, UnitNumber: "101"},
			},
			SchemeCount: 2, HotspotCount: 2, AuditedExclusions: []domain.FloorSchemeAuditedExclusion{},
		},
		Schemes: []domain.FloorScheme{
			makeScheme("phase-1", "/kayan/ofiyat/floor-schemes/phase-1-a-03.webp", &key1),
			makeScheme("phase-2", "/kayan/ofiyat/floor-schemes/phase-2-a-03.webp", &key2),
		},
		ExpectedUniverse: &domain.FloorSchemeExpectedUniverse{
			SourceObservedAt: observedAt, ExpectedManifestByteSHA256: strings.Repeat("c", 64),
			SchemeCount: 2, UnitCount: 2, CatalogUnitCount: &catalogUnitCount, CompanionUnitCount: 0,
			Assignments: []domain.FloorSchemeExpectedUniverseAssignment{
				{PhaseSlug: "phase-1", Entrance: "A", Floor: 3, UnitNumber: "101", UnitKey: &key1, Evidence: "catalog-unit"},
				{PhaseSlug: "phase-2", Entrance: "A", Floor: 3, UnitNumber: "101", UnitKey: &key2, Evidence: "catalog-unit"},
			},
		},
		CompanionEvidence: nil,
	}
	return artifact, project
}

func marshalFloorSchemeSidecarForTest(t *testing.T, artifact domain.FloorSchemeArtifact) []byte {
	t.Helper()
	body, err := json.MarshalIndent(artifact, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	return append(body, '\n')
}

func cloneFloorSchemeArtifactForTest(t *testing.T, artifact domain.FloorSchemeArtifact) domain.FloorSchemeArtifact {
	t.Helper()
	body := marshalFloorSchemeSidecarForTest(t, artifact)
	var clone domain.FloorSchemeArtifact
	if err := json.Unmarshal(body, &clone); err != nil {
		t.Fatal(err)
	}
	return clone
}
