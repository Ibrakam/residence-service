package importer

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func TestSanitizedSUNClientAdapter(t *testing.T) {
	bundle, err := LoadCatalogFile(filepath.Join("testdata", "sun-client.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bundle.SchemaName != "sanitized-client-v1" || len(bundle.Projects) != 1 {
		t.Fatalf("unexpected bundle: %#v", bundle)
	}
	project := bundle.Projects[0]
	if project.Slug != "sun" || project.DeveloperSlug != "human2human" || len(project.Units) != 2 || project.Complete {
		t.Fatalf("unexpected SUN project: %#v", project)
	}
	if project.OfficialCount == nil || *project.OfficialCount != 306 {
		t.Fatalf("SUN public-universe provenance was not preserved: %#v", project.OfficialCount)
	}
	if project.Units[0].SourceID != "sun-a-a2-f2" || project.Units[0].PlanImageURL != "/sun/plans/101.webp" {
		t.Fatalf("SUN identity/plan not preserved: %#v", project.Units[0])
	}
	if project.Units[0].SourceKey == project.Units[0].SourceID {
		t.Fatal("private source id leaked into public sourceKey")
	}
}

func TestSanitizedClientWithoutUniverseFailsClosedAsPartial(t *testing.T) {
	path := filepath.Join(t.TempDir(), "future-client.json")
	body := `{"project":"Future","projectSlug":"future","capturedAt":"2026-08-31T12:00:00Z","units":[{"id":"public-1","number":"1","rooms":1,"area":40,"floor":2,"status":"available"}]}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := LoadCatalogFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.Projects[0].Complete {
		t.Fatal("sanitized client without an official universe count must not deactivate unseen rows")
	}
}

func TestMultiProjectCatalogUsesProjectUpdatedAtForFloorSchemeProvenance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kayan-catalog.json")
	body := `{
  "generatedAt": "2026-08-31T19:26:42.293Z",
  "projects": [
    {
      "project": {"slug": "mirador", "name": "Mirador", "updatedAt": "2026-08-29T08:46:56.739Z"},
      "units": [{"id": "mirador-1", "number": "1", "rooms": 1, "area": 40, "floor": 2, "status": "available"}]
    },
    {
      "project": {"slug": "ofiyat", "name": "Ofiyat", "updatedAt": "2026-08-31T19:26:42.293Z"},
      "units": [{"id": "ofiyat-1", "number": "1", "rooms": 1, "area": 40, "floor": 2, "status": "available"}]
    }
  ]
}`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	bundle, err := LoadCatalogFile(path)
	if err != nil {
		t.Fatal(err)
	}
	wantGlobal := time.Date(2026, time.August, 31, 19, 26, 42, 293000000, time.UTC)
	wantMirador := time.Date(2026, time.August, 29, 8, 46, 56, 739000000, time.UTC)
	if !bundle.CapturedAt.Equal(wantGlobal) {
		t.Fatalf("bundle capturedAt=%s, want global generatedAt %s", bundle.CapturedAt, wantGlobal)
	}
	projects := make(map[string]CatalogProject, len(bundle.Projects))
	for _, project := range bundle.Projects {
		projects[project.Slug] = project
	}
	if !projects["mirador"].CapturedAt.Equal(wantMirador) {
		t.Fatalf("Mirador capturedAt=%s, want its project.updatedAt %s", projects["mirador"].CapturedAt, wantMirador)
	}
	if !projects["ofiyat"].CapturedAt.Equal(wantGlobal) {
		t.Fatalf("Ofiyat capturedAt=%s, want its project.updatedAt %s", projects["ofiyat"].CapturedAt, wantGlobal)
	}

	artifactBody, artifactBundle := generatedCompleteFloorSchemeSidecarFixture(t)
	artifactBundle.Projects[0].CapturedAt = projects["mirador"].CapturedAt
	if _, err := loadGeneratedSidecarFixture(t, artifactBody, artifactBundle); err != nil {
		t.Fatalf("newer sibling/global capture invalidated unchanged Mirador sidecar: %v", err)
	}
}

func TestCatalogProjectUpdatedAtIsStrictAndFallsBackOnlyWhenAbsent(t *testing.T) {
	global := time.Date(2026, time.August, 31, 19, 26, 42, 293000000, time.UTC)
	if got, err := catalogProjectCapturedAt(map[string]json.RawMessage{}, global); err != nil || !got.Equal(global) {
		t.Fatalf("absent project.updatedAt did not use global fallback: got=%s err=%v", got, err)
	}
	for _, raw := range []string{`""`, `"31.08.2026"`, `null`, `42`} {
		_, err := catalogProjectCapturedAt(map[string]json.RawMessage{"updatedAt": json.RawMessage(raw)}, global)
		if err == nil {
			t.Fatalf("invalid present project.updatedAt %s used the global fallback", raw)
		}
	}
}

func TestReadyWorkspaceCatalogCounts(t *testing.T) {
	dataDir := filepath.Clean(filepath.Join("..", "..", "..", "website", "data"))
	audit, err := AuditCatalogDirectory(dataDir)
	if err != nil {
		t.Skipf("workspace catalog fixtures are not available: %v", err)
	}
	want := map[string]int{
		"4u": 33, "avalon-residence": 268, "bayterak": 140, "botanika-saroyi": 224,
		"flagman": 8, "jomiy": 121, "mirador": 199, "ofiyat": 585,
		"maftun-makon": 204, "meros": 256, "regnum-plaza": 12, "sado": 338,
		"sun": 51, "voha": 104, "yangibaxt": 265, "zamon": 104,
	}
	for _, item := range audit.Items {
		expected, tracked := want[item.ProjectSlug]
		if !tracked {
			continue // SUN and future sanitized clients are intentionally auto-discovered.
		}
		if item.Records != expected {
			t.Errorf("%s records=%d, want %d", item.ProjectSlug, item.Records, expected)
		}
		delete(want, item.ProjectSlug)
	}
	for slug := range want {
		t.Errorf("ready project %s was not discovered", slug)
	}
	for _, item := range audit.Items {
		if item.ProjectSlug == "4u" {
			if item.Complete || item.OfficialCount == nil || *item.OfficialCount != 183 {
				t.Fatalf("4U must remain an explicitly partial 33/183 snapshot: %#v", item)
			}
		}
		if item.ProjectSlug == "sun" {
			if item.Complete || item.OfficialCount == nil || *item.OfficialCount != 306 {
				t.Fatalf("SUN must remain an explicitly partial 51/306 public snapshot: %#v", item)
			}
		}
	}
	if audit.Files != 15 || audit.Projects != 16 || audit.Records != 2912 || audit.CompleteRecords != 2828 || audit.PartialRecords != 84 {
		t.Fatalf("unexpected workspace totals: %#v", audit)
	}
	if audit.FloorSchemeArtifacts != 2 || audit.FloorSchemes != 34 || audit.FloorSchemeHotspots != 209 {
		t.Fatalf("dry-run did not validate Mirador 34/209 plus the audited Ofiyat zero sidecar: %#v", audit)
	}
}

func TestGeneratedCompleteFloorSchemeSidecarIsDiscoveredAndValidated(t *testing.T) {
	dataDir := filepath.Clean(filepath.Join("..", "..", "..", "website", "data"))
	bundles, err := LoadCatalogDirectory(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, err := LoadGeneratedFloorSchemeArtifacts(dataDir, bundles)
	if err != nil {
		t.Fatal(err)
	}
	artifact, ok := artifacts["mirador"]
	if !ok || artifact.SchemaVersion != 2 || artifact.CaptureStatus != "captured-complete" || artifact.FloorSchemeCount != 34 || artifact.HotspotCount != 209 || artifact.ExpectedUniverse == nil || artifact.CompanionEvidence == nil || len(artifact.SidecarByteSHA256) != 64 || len(artifact.BackendAPIArtifactSHA256) != 64 {
		t.Fatalf("unexpected generated complete floor artifact: %#v", artifact)
	}
	keyed, companion := 0, 0
	for _, scheme := range artifact.Schemes {
		if scheme.Entrance == "3" && scheme.Floor == 16 && scheme.SourceCrop != (domain.FloorSchemeImageRectangle{X: 672, Y: 277, Width: 469, Height: 468}) {
			t.Fatalf("generated E3/F16 source crop is ambiguous: %#v", scheme.SourceCrop)
		}
		for _, zone := range scheme.Zones {
			if zone.UnitKey == nil {
				companion++
			} else {
				keyed++
			}
		}
	}
	if keyed != 199 || companion != 10 {
		t.Fatalf("generated floor identities=%d keyed/%d companion, want 199/10", keyed, companion)
	}
	legacyProjection, err := json.Marshal(artifact)
	if err != nil {
		t.Fatal(err)
	}
	for _, v3OnlyField := range []string{`"phaseSlug"`, `"catalogUnitCount"`, `"records"`, `"sourceScreenshotWidth"`, `"sourceScreenshotHeight"`} {
		if strings.Contains(string(legacyProjection), v3OnlyField) {
			t.Fatalf("legacy Mirador schema v2 API projection unexpectedly contains v3-only field %s", v3OnlyField)
		}
	}
}

func TestGeneratedOfiyatUnavailableFloorSchemeSidecarIsDiscoveredAndValidated(t *testing.T) {
	dataDir := filepath.Clean(filepath.Join("..", "..", "..", "website", "data"))
	bundles, err := LoadCatalogDirectory(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	artifacts, err := LoadGeneratedFloorSchemeArtifacts(dataDir, bundles)
	if err != nil {
		t.Fatal(err)
	}
	artifact, ok := artifacts["ofiyat"]
	if !ok || artifact.SchemaVersion != 3 || artifact.CaptureStatus != "not-published-by-source" || artifact.SourceStatus != "captured-read-only" || artifact.CapturedAt == nil || artifact.CaptureScope.Mode != "unavailable" || len(artifact.CaptureScope.AuditedExclusions) == 0 || artifact.FloorSchemeCount != 0 || artifact.HotspotCount != 0 || len(artifact.Schemes) != 0 || artifact.ExpectedUniverse != nil || artifact.CompanionEvidence != nil || artifact.BlockEntranceMapping != nil || len(artifact.SidecarByteSHA256) != 64 || len(artifact.BackendAPIArtifactSHA256) != 64 {
		t.Fatalf("unexpected audited Ofiyat source-unavailable floor artifact: %#v", artifact)
	}
}

func TestGeneratedBlockedFloorSchemeSidecarRemainsBackwardCompatible(t *testing.T) {
	observedAt := time.Date(2026, time.August, 31, 10, 0, 0, 0, time.UTC)
	artifact := domain.FloorSchemeArtifact{
		SchemaVersion: 2, ProjectSlug: "mirador", CaptureStatus: "blocked-by-authentication",
		CaptureScope: domain.FloorSchemeCaptureScope{
			Mode: "blocked", DeclaredBlocks: []int{}, DeclaredEntrances: []string{},
			DeclaredFloors: []domain.FloorSchemeScopeFloor{}, DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{},
			AuditedExclusions: []domain.FloorSchemeAuditedExclusion{{Kind: "all-floor-schemes", Reason: "authentication-required", Evidence: "Historical sanitized blocker fixture."}},
		},
		SourceStatus: "blocked-by-authentication", SourceObservedAt: observedAt, Schemes: []domain.FloorScheme{},
	}
	body, err := json.MarshalIndent(artifact, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	body = append(body, '\n')
	bundle := CatalogBundle{Projects: []CatalogProject{{Slug: "mirador", CapturedAt: observedAt.Add(-time.Hour)}}}
	artifacts, err := loadGeneratedSidecarFixture(t, body, bundle)
	if err != nil {
		t.Fatal(err)
	}
	got := artifacts["mirador"]
	if got.CaptureStatus != "blocked-by-authentication" || got.FloorSchemeCount != 0 || got.HotspotCount != 0 || got.ExpectedUniverse != nil || got.CompanionEvidence != nil {
		t.Fatalf("blocked artifact contract changed: %#v", got)
	}
}

func generatedCompleteFloorSchemeSidecarFixture(t *testing.T) ([]byte, CatalogBundle) {
	t.Helper()
	result, mapping := completeSharedEntranceFloorSchemeFixture()
	audit, schemes, err := applyFloorSchemeMapping(&result, mapping)
	if err != nil {
		t.Fatal(err)
	}
	result.FloorSchemeAudit = &audit
	result.FloorSchemes = schemes
	artifact, err := buildPublicFloorSchemeArtifact(result, func(sourceKey, _ string, _ int, _ string) (string, error) { return sourceKey, nil })
	if err != nil {
		t.Fatal(err)
	}
	imageBody := testFloorSchemeWebPBytes(t)
	imageDigest := sha256.Sum256(imageBody)
	for index := range artifact.Schemes {
		artifact.Schemes[index].ImageSHA256 = hex.EncodeToString(imageDigest[:])
		artifact.Schemes[index].ImageBytes = int64(len(imageBody))
		artifact.Schemes[index].Width = 32
		artifact.Schemes[index].Height = 32
		artifact.Schemes[index].SourceScreenshotSHA256 = strings.Repeat("d", 64)
		artifact.Schemes[index].SourceCrop = domain.FloorSchemeImageRectangle{X: 160, Y: 257, Width: 32, Height: 32}
		for zoneIndex := range artifact.Schemes[index].Zones {
			artifact.Schemes[index].Zones[zoneIndex].Points = "2,2 30,2 30,30 2,30"
			artifact.Schemes[index].Zones[zoneIndex].Label = domain.FloorSchemeLabel{X: 16, Y: 16}
		}
	}
	artifact.SidecarByteSHA256 = ""
	artifact.BackendAPIArtifactSHA256 = ""
	body, err := json.MarshalIndent(artifact, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	body = append(body, '\n')
	project := CatalogProject{Slug: "mirador", CapturedAt: result.Snapshot.CapturedAt, Complete: true, Units: result.Units}
	return body, CatalogBundle{Projects: []CatalogProject{project}}
}

func loadGeneratedSidecarFixture(t *testing.T, body []byte, bundle CatalogBundle) (map[string]domain.FloorSchemeArtifact, error) {
	t.Helper()
	dir := writeGeneratedSidecarFixture(t, body, true)
	return LoadGeneratedFloorSchemeArtifacts(dir, []CatalogBundle{bundle})
}

func writeGeneratedSidecarFixture(t *testing.T, body []byte, withAssets bool) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, "data")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "mirador-floor-schemes.json"), body, 0o600); err != nil {
		t.Fatal(err)
	}
	if withAssets {
		var artifact domain.FloorSchemeArtifact
		if err := json.Unmarshal(body, &artifact); err != nil {
			t.Fatal(err)
		}
		writeTestFloorSchemeAssets(t, dir, artifact)
	}
	return dir
}

func writeTestFloorSchemeAssets(t *testing.T, dataDir string, artifact domain.FloorSchemeArtifact) {
	t.Helper()
	body := testFloorSchemeWebPBytes(t)
	written := make(map[string]struct{}, len(artifact.Schemes))
	for _, scheme := range artifact.Schemes {
		if _, duplicate := written[scheme.ImageURL]; duplicate {
			continue
		}
		written[scheme.ImageURL] = struct{}{}
		assetPath := filepath.Join(filepath.Dir(dataDir), "public", filepath.FromSlash(strings.TrimPrefix(scheme.ImageURL, "/")))
		if err := os.MkdirAll(filepath.Dir(assetPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(assetPath, body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func testFloorSchemeWebPBytes(t *testing.T) []byte {
	t.Helper()
	const encoded = "UklGRooEAABXRUJQVlA4IH4EAABQGQCdASogACAAAAAAJYwCdMoMYPYEGA5gH9A/wH8A9wH6q8wB7gP1G9V3+S+o7/gPYA/Wb2AP1c9RP+b/sr8AH67f9X/EfAB+t3/cwQTK/wB79vdH133GK+b+j/lR6AbhjuM9Z5/VfyA/o3OB9MP53+TPwN/h39r/Kr2A4wD+R/xH+q/zf90v719EH7R/mfyZ/wHsO/F/5t/m/6X8AH8S/kH9l/r37Xf2D///8b7K+oj/TU+/7sdQZHxJaHz+/PYwM/Fk+era9HxpBqD0e8WpYiGgAP7//7Ss1/4M5DDFeaBwl7RqbMLb0787T8fNkLKdS/Dxdgfst4313dnE3/Kw1TMTuRbsxD8x5p3JgWjgym66CiCxlmoc/qgjVZuPh3N7pNGb5RSFWS37s9hlkieb44CAsECXua8/uQs/MW/hOOps51+gcDl5eP2FjaNIQZSLn1r6Pw6JO4XilVJJ/68IeJ7yYbh95lDiKjZbqX/jM/Zsg0vFC4KPNP/qJzixv3mdn5BZnr4TwdgXUdnyt9+53khePqkG5MqcTliZERWZD1Tq5iuZyOt1Vl/pu1HBJJUBmltS0UQPK2I00f7W33VKXT8sOJgYTd2gMfpNxPL/zxffhj99A9Qvv/mPiyYJCaXw6RYCB86L2+u+7O3kLqbzmEaMVnB9wBuT3t8RaMjD642bMmx6f3CobC3060ZYdliPa34nbB2fRf8MOQVpoIg2Z0525W2fny8QnbLgTbT+HfrItctZzWlUdL5gwedrMwZ7UstqlUAJXU+j1ldCAKcoxGdGdiUuZgeofptAfFbl7JrYE5BM7TNFr5l2lOLWQZ+EhPSATb+h0QIr4LPjKZn6KRQ96G+wbjnoaef9nEvk227nV8oVyO6rXvlOkEnDPsdfuNQytlfQN7cn//40p2eizFQKNVkUTmtdWx7ZVz9SxWGcZ0IHY9c/9bTaYrHFJoVipCU/RByNr5fYu7VynwvRZgwNhiGOJ0YVy1wofEq8550A6dck+n5vkY86RxNeLjw63aMHTH9oODG1lZ8yfMQrh+zXLtMTIPira3IFHHlOqKB6cu5FYEgvnP93Oqzfqkhr1qDsXr/SNHZ9zuPZ7hzrIaocsYllfNVMRaw0a9Ghrah/FGzxSU6RIZk7p4dDWxuy7vRVUoVDT+d0bntDP1aZ0KUOzo7wpcZ3Eb9gyEOxa7wpPr4htSFK3inf5gHudV7cRZMohb+YedH9jB0zwTmIp5GY5y18P/LkqxaKb7245smhdIFUI5MpxCvWZMIkLUzxQXvZLX6cjjRiHn/jss4k9cVx0FDkzEqbnQCxWcR+d7Fk/zIyO3EEYkthxjQjfI3XsIK0z4q9Duf0afeXnOVS0cXfumh34fdscH9OiNLIQWb9I80uqV/OHSlQBXc6aMXf43BFN/31dBqMiwTJm+C80G6VY5vvGAxrFiv0x0CZlNVUEjWweOwcGILH0dm8jYwMeFFRAGbAGgoLuT49bPD1fgtTUWaUzsz7WruNeP76W9s2XMW9MoXstFoauAAA"
	body, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestGeneratedCompleteFloorSchemeSidecarSupportsSharedEntrances(t *testing.T) {
	body, bundle := generatedCompleteFloorSchemeSidecarFixture(t)
	artifacts, err := loadGeneratedSidecarFixture(t, body, bundle)
	if err != nil {
		t.Fatal(err)
	}
	artifact := artifacts["mirador"]
	if artifact.ExpectedUniverse == nil || artifact.ExpectedUniverse.UnitCount != 209 || artifact.ExpectedUniverse.SchemeCount != 34 || len(artifact.Schemes) != 34 || artifact.HotspotCount != 209 || artifact.CompanionEvidence == nil {
		t.Fatalf("complete generated sidecar lost shared-entrance universe: %#v", artifact)
	}
	digest := sha256.Sum256(body)
	if artifact.SidecarByteSHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("sidecar checksum=%q, want exact byte checksum %q", artifact.SidecarByteSHA256, hex.EncodeToString(digest[:]))
	}
}

func TestGeneratedFloorSchemeSidecarVerifiesLocalWebPAssets(t *testing.T) {
	body, bundle := generatedCompleteFloorSchemeSidecarFixture(t)

	missingDir := writeGeneratedSidecarFixture(t, body, false)
	if _, err := LoadGeneratedFloorSchemeArtifacts(missingDir, []CatalogBundle{bundle}); err == nil || !strings.Contains(err.Error(), "read image asset") {
		t.Fatalf("missing floor-scheme WebP error=%v", err)
	}

	mutatedDir := writeGeneratedSidecarFixture(t, body, true)
	var artifact domain.FloorSchemeArtifact
	if err := json.Unmarshal(body, &artifact); err != nil {
		t.Fatal(err)
	}
	assetPath := filepath.Join(filepath.Dir(mutatedDir), "public", filepath.FromSlash(strings.TrimPrefix(artifact.Schemes[0].ImageURL, "/")))
	assetBody, err := os.ReadFile(assetPath)
	if err != nil {
		t.Fatal(err)
	}
	assetBody[len(assetBody)-1] ^= 0xff
	if err := os.WriteFile(assetPath, assetBody, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadGeneratedFloorSchemeArtifacts(mutatedDir, []CatalogBundle{bundle}); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("mutated floor-scheme WebP error=%v", err)
	}
}

func TestFloorSchemeAssetRootMatchesProductionContainerMount(t *testing.T) {
	if got, want := generatedFloorSchemePublicRoot("/app/data/catalogs"), "/app/data/public"; got != want {
		t.Fatalf("production floor-scheme public root=%q, want %q", got, want)
	}
	composeBody, err := os.ReadFile(filepath.Join("..", "..", "docker-compose.yml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(composeBody), "../website/public:/app/data/public:ro") {
		t.Fatal("docker-compose does not mount website/public at the derived floor-scheme asset root")
	}
}

func TestGeneratedCompleteFloorSchemeSidecarAcceptsLocked199PlusCompanion(t *testing.T) {
	body, bundle := generatedCompleteFloorSchemeSidecarFixture(t)
	bundle.Projects[0].Complete = false
	artifacts, err := loadGeneratedSidecarFixture(t, body, bundle)
	if err != nil || artifacts["mirador"].CompanionEvidence == nil {
		t.Fatalf("generated complete sidecar did not accept explicit 199+10 evidence: artifact=%#v err=%v", artifacts["mirador"], err)
	}
}

func TestGeneratedFloorSchemeSidecarRejectsUnsafeOrMismatchedData(t *testing.T) {
	body, bundle := generatedCompleteFloorSchemeSidecarFixture(t)
	tests := []struct {
		name   string
		mutate func([]byte) []byte
		want   string
	}{
		{
			name: "forbidden source metadata",
			mutate: func(body []byte) []byte {
				return []byte(strings.Replace(string(body), `"schemaVersion": 2,`, `"schemaVersion": 2, "routes": {"floor":"secret"},`, 1))
			},
			want: "unknown field",
		},
		{
			name: "malformed expected manifest byte hash",
			mutate: func(body []byte) []byte {
				return []byte(strings.Replace(string(body), strings.Repeat("c", 64), strings.Repeat("C", 64), 1))
			},
			want: "provenance/counts",
		},
		{
			name: "strict unit tuple mismatch",
			mutate: func(body []byte) []byte {
				var artifact domain.FloorSchemeArtifact
				if err := json.Unmarshal(body, &artifact); err != nil {
					t.Fatal(err)
				}
				artifact.Schemes[0].Zones[0].UnitNumber = "999"
				artifact.CaptureScope.DeclaredUnitHotspots[0].UnitNumber = "999"
				artifact.ExpectedUniverse.Assignments[0].UnitNumber = "999"
				mutated, err := json.MarshalIndent(artifact, "", "  ")
				if err != nil {
					t.Fatal(err)
				}
				return append(mutated, '\n')
			},
			want: "does not strictly match",
		},
		{
			name: "locked snapshot unit cannot lose unitKey",
			mutate: func(body []byte) []byte {
				var artifact domain.FloorSchemeArtifact
				if err := json.Unmarshal(body, &artifact); err != nil {
					t.Fatal(err)
				}
				artifact.Schemes[0].Zones[0].UnitKey = nil
				mutated, _ := json.MarshalIndent(artifact, "", "  ")
				return append(mutated, '\n')
			},
			want: "do not cover 199 eligible locked-snapshot apartments",
		},
		{
			name: "companion evidence hash cannot drift",
			mutate: func(body []byte) []byte {
				var artifact domain.FloorSchemeArtifact
				if err := json.Unmarshal(body, &artifact); err != nil {
					t.Fatal(err)
				}
				artifact.CompanionEvidence.RecordsSHA256 = strings.Repeat("f", 64)
				mutated, _ := json.MarshalIndent(artifact, "", "  ")
				return append(mutated, '\n')
			},
			want: "companion evidence is invalid",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := loadGeneratedSidecarFixture(t, test.mutate(append([]byte(nil), body...)), bundle)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("generated sidecar error=%v, want %q", err, test.want)
			}
		})
	}
}
