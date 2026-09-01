package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
	"github.com/tencorp/real-estate-platform/backend/internal/httpapi"
)

func TestNormalizeRecord(t *testing.T) {
	house := SnapshotHouse{SourceID: "154813", ProjectSlug: "mirador", PhaseSlug: "main"}
	record := RawRecord{
		PropertyType: "Квартира", RawStatus: "Свободно", Number: "7",
		PriceText: "1 321 214 811 сум", Entrance: "1", Floor: "2",
		HouseName: "Mirador", ProjectName: "Mirador", AreaText: "62.5", RoomsText: "2",
	}
	unit, err := normalizeRecord(house, record)
	if err != nil {
		t.Fatal(err)
	}
	if unit.SourceKey != "154813:apartment:1:2:7" {
		t.Fatalf("unexpected source key %q", unit.SourceKey)
	}
	if unit.Status != "available" || unit.PropertyType != "apartment" {
		t.Fatalf("unexpected normalized values: %#v", unit)
	}
	if unit.Price == nil || *unit.Price != 1321214811 {
		t.Fatalf("unexpected price %#v", unit.Price)
	}
	if unit.Rooms == nil || *unit.Rooms != 2 {
		t.Fatalf("unexpected rooms %#v", unit.Rooms)
	}
	if unit.PhaseSlug != "main" {
		t.Fatalf("normalized unit phaseSlug=%q, want main", unit.PhaseSlug)
	}
}

func TestNormalizeSkipsIdenticalDuplicateUnits(t *testing.T) {
	record := RawRecord{PropertyType: "Квартира", RawStatus: "Продано", Number: "1", PriceText: "Продано", Entrance: "A", Floor: "2", AreaText: "45.5", RoomsText: "2"}
	result, err := Normalize(Snapshot{
		SchemaVersion: 1,
		CapturedAt:    time.Now(),
		House:         SnapshotHouse{SourceID: "1", ProjectSlug: "ofiyat", PhaseSlug: "phase-1"},
		Records:       []RawRecord{record, record},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Units) != 1 || result.DuplicateRecords != 1 {
		t.Fatalf("unexpected duplicate handling: units=%d duplicates=%d", len(result.Units), result.DuplicateRecords)
	}
}

func TestNormalizeRejectsConflictingDuplicateUnits(t *testing.T) {
	first := RawRecord{PropertyType: "Квартира", RawStatus: "Продано", Number: "1", PriceText: "Продано", Entrance: "A", Floor: "2", AreaText: "45.5", RoomsText: "2"}
	second := first
	second.AreaText = "46.0"
	_, err := Normalize(Snapshot{
		SchemaVersion: 1,
		CapturedAt:    time.Now(),
		House:         SnapshotHouse{SourceID: "1", ProjectSlug: "ofiyat", PhaseSlug: "phase-1"},
		Records:       []RawRecord{first, second},
	})
	if err == nil {
		t.Fatal("expected conflicting duplicate source key error")
	}
}

func TestNormalizeStatus(t *testing.T) {
	tests := map[string]string{
		"Свободно":           "available",
		"Бронь":              "reserved",
		"Договор согласован": "reserved",
		"Продано":            "sold",
		"Руководство":        "unavailable",
	}
	for raw, want := range tests {
		if got := normalizeStatus(raw); got != want {
			t.Fatalf("normalizeStatus(%q)=%q, want %q", raw, got, want)
		}
	}
}

func TestMiradorPlanCompanionIsStrictAndLocal(t *testing.T) {
	item, err := LoadFile(filepath.Join("..", "..", "data", "raw", "kayan", "mirador.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(item.Units) != 199 {
		t.Fatalf("Mirador units=%d, want 199", len(item.Units))
	}
	if item.PlanMapping == nil {
		t.Fatal("Mirador plan companion was not loaded")
	}
	audit := item.PlanMapping
	if audit.CaptureCount != 61 || audit.StrictMatches != 51 || audit.Rejected != 10 || audit.UniqueCapturedImages != 31 {
		t.Fatalf("unexpected exact-plan audit: %#v", audit)
	}
	if audit.RepresentativeLayouts != 44 || audit.UniqueRepresentativeImages != 44 || audit.FloorSchemes != 0 {
		t.Fatalf("unexpected representative/floor-plan audit: %#v", audit)
	}
	if item.FloorSchemeAudit == nil {
		t.Fatal("Mirador floor-scheme companion was not loaded")
	}
	if item.FloorSchemeAudit.SchemaVersion != 2 || item.FloorSchemeAudit.SourceStatus != "captured-read-only" || item.FloorSchemeAudit.CaptureStatus != "captured-complete" || item.FloorSchemeAudit.SchemeCount != 34 || item.FloorSchemeAudit.HotspotCount != 209 || len(item.FloorSchemes) != 34 || item.FloorSchemeAudit.ExpectedUniverse == nil || item.FloorSchemeAudit.ExpectedUniverse.UnitCount != 209 || item.FloorSchemeAudit.CompanionEvidence == nil || item.FloorSchemeAudit.CompanionEvidence.RecordCount != 10 {
		t.Fatalf("unexpected official floor-scheme audit: %#v schemes=%d", item.FloorSchemeAudit, len(item.FloorSchemes))
	}
	for _, scheme := range item.FloorSchemes {
		if scheme.Entrance == "3" && scheme.Floor == 16 {
			if scheme.SourceCrop != (floorSchemeImageRectangle{X: 672, Y: 277, Width: 469, Height: 468}) || len(scheme.Zones) != 6 {
				t.Fatalf("E3/F16 source projection/zones=%#v/%d", scheme.SourceCrop, len(scheme.Zones))
			}
		}
	}
	wantUnmatched := []string{"44", "45", "47", "48", "49", "114", "115", "116", "118", "119"}
	gotUnmatched := append([]string(nil), audit.UnmatchedNumbers...)
	sort.Strings(gotUnmatched)
	sort.Strings(wantUnmatched)
	if strings.Join(gotUnmatched, ",") != strings.Join(wantUnmatched, ",") {
		t.Fatalf("unmatched evidence=%v, want %v", gotUnmatched, wantUnmatched)
	}

	exactUnits := 0
	exactImages := make(map[string]struct{})
	for _, unit := range item.Units {
		if unit.PlanImageURL == "" {
			continue
		}
		exactUnits++
		exactImages[unit.PlanImageURL] = struct{}{}
		if !strings.HasPrefix(unit.PlanImageURL, "/kayan/mirador/plans/exact/") || !strings.HasSuffix(unit.PlanImageURL, ".webp") {
			t.Fatalf("unit %s has non-local exact plan %q", unit.Number, unit.PlanImageURL)
		}
	}
	if exactUnits != 51 || len(exactImages) != 21 {
		t.Fatalf("exact units/images=%d/%d, want 51/21", exactUnits, len(exactImages))
	}
	if item.ImageURL != "/kayan/mirador/hero.webp" {
		t.Fatalf("project image=%q", item.ImageURL)
	}
	if len(item.Layouts) != 44 {
		t.Fatalf("representative layouts=%d, want 44", len(item.Layouts))
	}
	representativeImages := make(map[string]struct{})
	for _, layout := range item.Layouts {
		representativeImages[layout.ImageURL] = struct{}{}
		if !strings.HasPrefix(layout.ImageURL, "/kayan/mirador/plans/representative/") || !strings.HasSuffix(layout.ImageURL, ".webp") {
			t.Fatalf("layout %s has non-local image %q", layout.SourceID, layout.ImageURL)
		}
		if layout.ThumbnailURL != layout.ImageURL {
			t.Fatalf("layout %s thumbnail=%q, image=%q", layout.SourceID, layout.ThumbnailURL, layout.ImageURL)
		}
	}
	if len(representativeImages) != 44 {
		t.Fatalf("unique representative images=%d, want 44", len(representativeImages))
	}
	if strings.Contains(item.ImageURL, "profitbase.ru") {
		t.Fatal("project image leaked a Profitbase runtime URL")
	}

	byNumber := make(map[string]NormalizedUnit, len(item.Units))
	for _, unit := range item.Units {
		byNumber[unit.Number] = unit
	}
	if byNumber["11"].Status != "unavailable" {
		t.Fatalf("partial plan overlay changed unit 11 status to %q", byNumber["11"].Status)
	}
	if byNumber["112"].Status != "available" || byNumber["112"].PlanImageURL != "" {
		t.Fatalf("absence from public plan capture was incorrectly treated as status/plan evidence: %#v", byNumber["112"])
	}
	if !item.Snapshot.CapturedAt.Equal(time.Date(2026, time.August, 29, 8, 46, 56, 739000000, time.UTC)) {
		t.Fatalf("partial plan overlay changed snapshot capturedAt to %s", item.Snapshot.CapturedAt)
	}
}

func TestKayanSnapshotDiscoveryIgnoresMappingSubdirectory(t *testing.T) {
	items, err := LoadDirectory(filepath.Join("..", "..", "data", "raw", "kayan"))
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("snapshot discovery loaded %d files, want the four root snapshots only", len(items))
	}
}

func TestUnitUpsertPreservesVerifiedPlanOnEmptyReimport(t *testing.T) {
	want := "plan_image_url=COALESCE(NULLIF(EXCLUDED.plan_image_url,''),units.plan_image_url)"
	if !strings.Contains(upsertUnitSQL, want) {
		t.Fatalf("unit upsert must preserve a verified plan when an incoming snapshot is empty")
	}
}

func validFloorSchemeFixture() (NormalizedSnapshot, floorSchemeMapping) {
	lockedAt := time.Date(2026, time.August, 29, 8, 46, 56, 739000000, time.UTC)
	capturedAt := time.Date(2026, time.August, 31, 14, 0, 0, 0, time.UTC)
	result := NormalizedSnapshot{
		Snapshot: Snapshot{CapturedAt: lockedAt},
		House: SnapshotHouse{
			SourceID: "154813", ProjectSlug: "mirador", ProjectName: "Mirador", PhaseSlug: "main", PhaseName: "Mirador",
		},
		Units: []NormalizedUnit{
			{SourceKey: "154813:apartment:1:2:1", PhaseSlug: "main", PropertyType: "apartment", Number: "1", Entrance: "1", Floor: 2},
		},
	}
	mapping := floorSchemeMapping{
		SchemaVersion: 2,
		ProjectSlug:   "mirador",
		CapturedAt:    &capturedAt,
		CaptureStatus: "captured-partial",
		CaptureScope: floorSchemeCaptureScope{
			Mode:                 "partial",
			DeclaredBlocks:       []int{},
			DeclaredEntrances:    []string{"1"},
			DeclaredFloors:       []floorSchemeScopeFloor{{Entrance: "1", Floor: 2}},
			DeclaredUnitHotspots: []floorSchemeScopeUnitHotspot{{Entrance: "1", Floor: 2, UnitNumber: "1"}},
			SchemeCount:          1,
			HotspotCount:         1,
			AuditedExclusions: []floorSchemeAuditedExclusion{
				{Kind: "remaining-floor-schemes", Reason: "fixture-partial", Evidence: "The fixture deliberately covers one scheme."},
			},
		},
		Source: floorSchemeMappingSource{
			ObservedAt:   capturedAt,
			Status:       "captured-read-only",
			TenantOrigin: "https://pb21432.profitbase.ru",
			HouseID:      154813,
			AccountID:    21432,
			Routes: floorSchemeMappingSourceRoutes{
				Catalog: "/eco/catalog/house/154813/smallGrid?accountId=21432&context=agencyOffice",
				Floor:   "/api/v4/json/floor?houseId=154813",
				Board:   "/board?houseId=154813",
				Facade:  "/facade?houseId=154813",
			},
			Method: "Authenticated read-only capture fixture",
			Note:   "Official image and hotspot geometry fixture",
		},
		Validation: floorSchemeMappingValidation{
			LockedSnapshotCapturedAt:    lockedAt,
			LockedSnapshotRecordCount:   len(result.Units),
			OfficialUniverseRecordCount: 209,
			SchemeCount:                 1,
			HotspotCount:                1,
			SourceScreenshotCount:       1,
			CoordinateSystem:            "image-pixels",
			ImagePathPrefix:             miradorFloorSchemeImagePrefix,
		},
		Schemes: []floorScheme{
			{
				Entrance: "1", Floor: 2,
				ImageURL:    "/kayan/mirador/floor-schemes/entrance-1-floor-02.webp",
				ImageSHA256: strings.Repeat("a", 64), ImageBytes: 1024,
				Width: 1000, Height: 800,
				Zones: []floorSchemeZone{
					{UnitKey: stringReference("154813:apartment:1:2:1"), UnitNumber: "1", Points: "100,100 300,100 200,300", Label: floorSchemeLabel{X: 200, Y: 180}},
				},
			},
		},
	}
	return result, mapping
}

func TestFloorSchemeContractAcceptsStrictLocalOfficialGeometry(t *testing.T) {
	result, mapping := validFloorSchemeFixture()
	audit, schemes, err := applyFloorSchemeMapping(&result, mapping)
	if err != nil {
		t.Fatal(err)
	}
	if audit.SchemeCount != 1 || audit.HotspotCount != 1 || len(schemes) != 1 || len(schemes[0].Zones) != 1 {
		t.Fatalf("unexpected normalized floor schemes: audit=%#v schemes=%#v", audit, schemes)
	}
	if schemes[0].Zones[0].UnitSourceKey != "154813:apartment:1:2:1" || schemes[0].Zones[0].UnitNumber != "1" || schemes[0].Zones[0].Points != "100,100 300,100 200,300" {
		t.Fatalf("official hotspot geometry changed during normalization: %#v", schemes[0].Zones[0])
	}
}

func TestFloorSchemeContractRejectsUnsafeOrUnmatchedData(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*NormalizedSnapshot, *floorSchemeMapping)
		want   string
	}{
		{
			name: "missing canonical snapshot identity",
			mutate: func(result *NormalizedSnapshot, _ *floorSchemeMapping) {
				result.Units[0].SourceKey = ""
			},
			want: "no canonical locked-snapshot source key",
		},
		{
			name: "remote image",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].ImageURL = "https://pb21432.profitbase.ru/floor.webp"
			},
			want: "local public path",
		},
		{
			name: "malformed polygon",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Zones[0].Points = "100,100 300,100"
			},
			want: "at least three",
		},
		{
			name: "out of bounds polygon",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Zones[0].Points = "100,100 1200,100 200,300"
			},
			want: "outside",
		},
		{
			name: "out of bounds label",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Zones[0].Label.X = 1001
			},
			want: "label",
		},
		{
			name: "unknown apartment",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Zones[0].UnitNumber = "999"
			},
			want: "no exact companion proof",
		},
		{
			name: "wrong floor association",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Floor = 3
			},
			want: "no exact companion proof",
		},
		{
			name: "duplicate apartment hotspot",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes[0].Zones = append(mapping.Schemes[0].Zones, mapping.Schemes[0].Zones[0])
				mapping.Validation.HotspotCount = 2
			},
			want: "duplicates apartment",
		},
		{
			name: "duplicate block floor",
			mutate: func(_ *NormalizedSnapshot, mapping *floorSchemeMapping) {
				mapping.Schemes = append(mapping.Schemes, mapping.Schemes[0])
				mapping.Validation.SchemeCount = 2
				mapping.Validation.HotspotCount = 2
				mapping.Validation.SourceScreenshotCount = 2
			},
			want: "duplicates entrance/floor",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result, mapping := validFloorSchemeFixture()
			test.mutate(&result, &mapping)
			_, _, err := applyFloorSchemeMapping(&result, mapping)
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error=%v, want substring %q", err, test.want)
			}
		})
	}
}

func TestFloorSchemeRawCannotInjectCanonicalIdentity(t *testing.T) {
	_, mapping := validFloorSchemeFixture()
	body, err := json.Marshal(mapping)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"sourceKey":"attacker"`, `"unitId":999`} {
		injected := strings.Replace(string(body), `"unitNumber":"1"`, `"unitNumber":"1",`+field, 1)
		if _, err := decodeFloorSchemeMapping([]byte(injected)); err == nil || !strings.Contains(err.Error(), "unknown field") {
			t.Fatalf("raw canonical identity %s was accepted: %v", field, err)
		}
	}
}

func TestCompleteFloorSchemeCaptureCannotSilentlyCoverOneScheme(t *testing.T) {
	result, mapping := validFloorSchemeFixture()
	mapping.CaptureStatus = "captured-complete"
	mapping.CaptureScope.Mode = "complete"
	mapping.CaptureScope.AuditedExclusions = nil
	_, _, err := applyFloorSchemeMapping(&result, mapping)
	if err == nil || !strings.Contains(err.Error(), "expected-universe manifest") {
		t.Fatalf("one-scheme complete capture error=%v", err)
	}
}

func completeSharedEntranceFloorSchemeFixture() (NormalizedSnapshot, floorSchemeMapping) {
	result, mapping := validFloorSchemeFixture()
	result.Units = make([]NormalizedUnit, 0, 199)
	mapping.Schemes = make([]floorScheme, 0, 34)
	mapping.CaptureStatus = "captured-complete"
	mapping.CaptureScope = floorSchemeCaptureScope{
		Mode: "complete", DeclaredBlocks: []int{},
		DeclaredEntrances: []string{"1", "2", "3"}, SchemeCount: 34, HotspotCount: 209,
		DeclaredFloors: make([]floorSchemeScopeFloor, 0, 34), DeclaredUnitHotspots: make([]floorSchemeScopeUnitHotspot, 0, 209),
		AuditedExclusions: []floorSchemeAuditedExclusion{},
	}
	expected := &NormalizedFloorSchemeExpectedUniverse{
		SourceObservedAt: mapping.Source.ObservedAt, ExpectedManifestByteSHA256: strings.Repeat("c", 64),
		SchemeCount: 34, UnitCount: 209, LockedSnapshotUnitCount: 199, CompanionUnitCount: 10,
		Assignments: make([]NormalizedFloorSchemeExpectedAssignment, 0, 209),
	}
	companionSet := make(map[string]struct{}, len(miradorFloorSchemeCompanionUnits))
	for _, number := range miradorFloorSchemeCompanionUnits {
		companionSet[number] = struct{}{}
	}
	for number := 1; number <= 209; number++ {
		unitNumber := strconv.Itoa(number)
		entrance, floor, _ := officialMiradorUnitLocation(unitNumber)
		unitKey := ""
		evidence := "official-public-companion"
		if _, companion := companionSet[unitNumber]; !companion {
			unitKey = strings.Join([]string{"154813", "apartment", entrance, strconv.Itoa(floor), unitNumber}, ":")
			evidence = "locked-snapshot"
			result.Units = append(result.Units, NormalizedUnit{
				SourceKey: unitKey, PhaseSlug: "main", PropertyType: "apartment", Entrance: entrance, Floor: floor, Number: unitNumber,
			})
		}
		expected.Assignments = append(expected.Assignments, NormalizedFloorSchemeExpectedAssignment{
			Entrance: entrance, Floor: floor, UnitNumber: unitNumber, UnitSourceKey: unitKey, Evidence: evidence,
		})
	}
	for _, entrance := range []string{"1", "2", "3"} {
		lastFloor := map[string]int{"1": 8, "2": 13, "3": 16}[entrance]
		for floor := 2; floor <= lastFloor; floor++ {
			zones := make([]floorSchemeZone, 0, 7)
			for number := 1; number <= 209; number++ {
				unitNumber := strconv.Itoa(number)
				unitEntrance, unitFloor, _ := officialMiradorUnitLocation(unitNumber)
				if unitEntrance != entrance || unitFloor != floor {
					continue
				}
				var zoneUnitKey *string
				if _, companion := companionSet[unitNumber]; !companion {
					zoneUnitKey = stringReference(strings.Join([]string{"154813", "apartment", entrance, strconv.Itoa(floor), unitNumber}, ":"))
				}
				zones = append(zones, floorSchemeZone{UnitKey: zoneUnitKey, UnitNumber: unitNumber, Points: "100,100 300,100 300,300 100,300", Label: floorSchemeLabel{X: 200, Y: 200}})
				mapping.CaptureScope.DeclaredUnitHotspots = append(mapping.CaptureScope.DeclaredUnitHotspots, floorSchemeScopeUnitHotspot{Entrance: entrance, Floor: floor, UnitNumber: unitNumber})
			}
			mapping.Schemes = append(mapping.Schemes, floorScheme{
				Entrance: entrance, Floor: floor,
				ImageURL:    "/kayan/mirador/floor-schemes/entrance-" + entrance + "-floor-" + strconv.Itoa(floor) + ".webp",
				ImageSHA256: strings.Repeat("b", 64), ImageBytes: 1024, Width: 1000, Height: 439,
				SourceScreenshot: floorSchemeSourceScreenshot{
					SHA256: strings.Repeat("d", 64), Canvas: floorSchemeImageRectangle{X: 160, Y: 257, Width: 1501, Height: 439},
					TightCrop: floorSchemeTightCrop{X: 0, Y: 0, Width: 1000, Height: 439},
				},
				Zones: zones,
			})
			mapping.CaptureScope.DeclaredFloors = append(mapping.CaptureScope.DeclaredFloors, floorSchemeScopeFloor{Entrance: entrance, Floor: floor})
		}
	}
	mapping.Validation.LockedSnapshotRecordCount = len(result.Units)
	mapping.Validation.OfficialUniverseRecordCount = 209
	mapping.Validation.SchemeCount = 34
	mapping.Validation.HotspotCount = 209
	mapping.Validation.SourceScreenshotCount = 34
	mapping.ExpectedUniverse = expected
	mapping.CompanionEvidence = &NormalizedFloorSchemeCompanionEvidence{
		Source: miradorFloorSchemeCompanionSource, SourceObservedAt: mapping.Source.ObservedAt.Add(-time.Hour),
		RecordCount: 10, UnitNumbers: append([]string(nil), miradorFloorSchemeCompanionUnits...), RecordsSHA256: miradorFloorSchemeCompanionSHA256,
	}
	return result, mapping
}

func TestCompleteFloorSchemeExpectedUniverseSupportsThirtyFourEntranceFloors(t *testing.T) {
	result, mapping := completeSharedEntranceFloorSchemeFixture()
	audit, schemes, err := applyFloorSchemeMapping(&result, mapping)
	if err != nil {
		t.Fatal(err)
	}
	if audit.ExpectedUniverse == nil || audit.ExpectedUniverse.UnitCount != 209 || len(schemes) != 34 || audit.CompanionEvidence == nil {
		t.Fatalf("complete entrance/floor capture lost expected universe: audit=%#v schemes=%d", audit, len(schemes))
	}
}

func TestCompleteFloorSchemeExpectedUniverseRejectsMissingAndDuplicateEligibleUnits(t *testing.T) {
	t.Run("missing eligible unit", func(t *testing.T) {
		result, mapping := completeSharedEntranceFloorSchemeFixture()
		result.Units = result.Units[1:]
		mapping.Validation.LockedSnapshotRecordCount = len(result.Units)
		_, _, err := applyFloorSchemeMapping(&result, mapping)
		if err == nil || !strings.Contains(err.Error(), "no exact companion proof") {
			t.Fatalf("missing eligible expected-universe unit error=%v", err)
		}
	})
	t.Run("duplicate expected unit", func(t *testing.T) {
		result, mapping := completeSharedEntranceFloorSchemeFixture()
		mapping.ExpectedUniverse.Assignments = append(mapping.ExpectedUniverse.Assignments, mapping.ExpectedUniverse.Assignments[0])
		mapping.ExpectedUniverse.UnitCount++
		_, _, err := applyFloorSchemeMapping(&result, mapping)
		if err == nil || !strings.Contains(err.Error(), "provenance/counts") {
			t.Fatalf("duplicate expected-universe unit error=%v", err)
		}
	})
}

func TestOfficialFloorSchemeArtifactSurvivesSanitizedRoundTrip(t *testing.T) {
	item, err := LoadFile(filepath.Join("..", "..", "data", "raw", "kayan", "mirador.json"))
	if err != nil {
		t.Fatal(err)
	}
	artifact, err := buildPublicFloorSchemeArtifact(item, func(sourceKey, _ string, _ int, _ string) (string, error) { return sourceKey, nil })
	if err != nil {
		t.Fatal(err)
	}
	if artifact.CaptureStatus != "captured-complete" || artifact.CaptureScope.Mode != "complete" || artifact.CapturedAt == nil {
		t.Fatalf("unexpected captured artifact metadata: %#v", artifact)
	}
	if artifact.FloorSchemeCount != 34 || artifact.HotspotCount != 209 || artifact.BlockEntranceMapping != nil || len(artifact.Schemes) != 34 || artifact.ExpectedUniverse == nil || artifact.CompanionEvidence == nil {
		t.Fatalf("unexpected captured artifact payload: %#v", artifact)
	}
	if len(artifact.CaptureScope.AuditedExclusions) != 0 || len(artifact.BackendAPIArtifactSHA256) != 64 {
		t.Fatalf("captured artifact lost audit/checksum: %#v", artifact)
	}

	body, err := json.Marshal(artifact)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"profitbase.ru", "tenantOrigin", "houseId", "accountId", `"routes"`, "154813/smallGrid"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("sanitized artifact leaks %q: %s", forbidden, body)
		}
	}
	var decoded domain.FloorSchemeArtifact
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.ProjectSlug != "mirador" || decoded.SourceObservedAt.IsZero() || decoded.BackendAPIArtifactSHA256 != artifact.BackendAPIArtifactSHA256 || decoded.CompanionEvidence == nil || decoded.ExpectedUniverse == nil {
		t.Fatalf("floor-scheme artifact did not round-trip: %#v", decoded)
	}
}

func TestNonEmptyFloorSchemeArtifactDerivesStableUnitKey(t *testing.T) {
	result, mapping := validFloorSchemeFixture()
	audit, schemes, err := applyFloorSchemeMapping(&result, mapping)
	if err != nil {
		t.Fatal(err)
	}
	result.FloorSchemeAudit = &audit
	result.FloorSchemes = schemes
	wantUnitKey := result.Units[0].SourceKey
	artifact, err := buildPublicFloorSchemeArtifact(result, func(sourceKey, entrance string, floor int, unitNumber string) (string, error) {
		if sourceKey != wantUnitKey || entrance != "1" || floor != 2 || unitNumber != "1" {
			t.Fatalf("unexpected unit resolver tuple: %q/%q/%d/%q", sourceKey, entrance, floor, unitNumber)
		}
		return sourceKey, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(artifact.Schemes) != 1 || len(artifact.Schemes[0].Zones) != 1 || artifact.Schemes[0].Zones[0].UnitKey == nil || *artifact.Schemes[0].Zones[0].UnitKey != wantUnitKey {
		t.Fatalf("canonical unitKey was not emitted: %#v", artifact.Schemes)
	}
	body, err := json.Marshal(artifact)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"unitKey":"154813:apartment:1:2:1"`) || strings.Contains(string(body), `"unitId"`) {
		t.Fatalf("unexpected client identity contract: %s", body)
	}

	if _, err := buildPublicFloorSchemeArtifact(result, func(string, string, int, string) (string, error) {
		return "154813:apartment:1:2:attacker", nil
	}); err == nil || !strings.Contains(err.Error(), "inconsistent canonical unitKey") {
		t.Fatalf("mismatched canonical unitKey was accepted: %v", err)
	}
}

func TestFloorSchemePersistenceRejectsDowngrades(t *testing.T) {
	older := time.Date(2026, time.August, 31, 10, 0, 0, 0, time.UTC)
	newer := older.Add(time.Hour)
	captured := domain.FloorSchemeArtifact{CaptureStatus: "captured-complete", CapturedAt: &newer, SourceObservedAt: newer}
	blocked := domain.FloorSchemeArtifact{CaptureStatus: "blocked-by-authentication", SourceObservedAt: newer.Add(time.Hour)}
	if floorSchemeArtifactMayReplace(captured, blocked) {
		t.Fatal("blocked artifact may replace a captured artifact")
	}
	stale := domain.FloorSchemeArtifact{CaptureStatus: "captured-complete", CapturedAt: &older, SourceObservedAt: older}
	if floorSchemeArtifactMayReplace(captured, stale) {
		t.Fatal("older captured artifact may replace a newer capture")
	}
	partial := domain.FloorSchemeArtifact{CaptureStatus: "captured-partial", CapturedAt: &newer, SourceObservedAt: newer}
	if floorSchemeArtifactMayReplace(captured, partial) {
		t.Fatal("partial artifact may replace a complete capture")
	}
	if !floorSchemeArtifactMayReplace(blocked, captured) {
		t.Fatal("captured artifact could not replace an authentication blocker")
	}
	for _, guard := range []string{
		"EXCLUDED.source_observed_at >= project_floor_scheme_artifacts.source_observed_at",
		"EXCLUDED.captured_at >= project_floor_scheme_artifacts.captured_at",
		"NOT (project_floor_scheme_artifacts.capture_status='captured-complete' AND EXCLUDED.capture_status='captured-partial')",
	} {
		if !strings.Contains(upsertFloorSchemeArtifactSQL, guard) {
			t.Fatalf("database upsert is missing freshness guard %q", guard)
		}
	}
}

func writeFloorSchemeCatalogImportFixture(t *testing.T, dir, slug, developerSlug string, capturedAt time.Time, units []NormalizedUnit, artifact domain.FloorSchemeArtifact) []byte {
	t.Helper()
	if len(artifact.Schemes) > 0 {
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
		writeTestFloorSchemeAssets(t, dir, artifact)
	}
	unitRows := make([]map[string]any, 0, len(units))
	for index, unit := range units {
		unitRows = append(unitRows, map[string]any{
			"id":              fmt.Sprintf("fixture-source-%d", index+1),
			"sourceKey":       unit.SourceKey,
			"phaseSlug":       "main",
			"phaseName":       "Fixture",
			"propertyType":    "apartment",
			"rawPropertyType": "Квартира",
			"status":          "available",
			"rawStatus":       "Свободно",
			"number":          unit.Number,
			"entrance":        unit.Entrance,
			"floor":           unit.Floor,
			"area":            100,
			"currency":        "UZS",
		})
	}
	catalog := map[string]any{
		"generatedAt": capturedAt,
		"projects": []any{map[string]any{
			"project": map[string]any{
				"developerSlug": developerSlug,
				"slug":          slug,
				"name":          "Floor scheme fixture",
				"totalUnits":    len(unitRows),
				"phases": []any{map[string]any{
					"sourceId": "main", "slug": "main", "name": "Main", "propertyType": "apartment", "sortOrder": 10,
				}},
			},
			"units": unitRows,
		}},
	}
	catalogBody, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, slug+"-catalog.json"), append(catalogBody, '\n'), 0o600); err != nil {
		t.Fatal(err)
	}

	artifact.SidecarByteSHA256 = ""
	artifact.BackendAPIArtifactSHA256 = ""
	sidecarBody, err := json.MarshalIndent(artifact, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	sidecarBody = append(sidecarBody, '\n')
	if err := os.WriteFile(filepath.Join(dir, slug+"-floor-schemes.json"), sidecarBody, 0o600); err != nil {
		t.Fatal(err)
	}
	return sidecarBody
}

func TestFloorSchemeDatabaseStoreHTTPRoundTrip(t *testing.T) {
	databaseURL := os.Getenv("FLOOR_SCHEME_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set FLOOR_SCHEME_TEST_DATABASE_URL to run the PostgreSQL round-trip")
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

	result, mapping := completeSharedEntranceFloorSchemeFixture()
	audit, schemes, err := applyFloorSchemeMapping(&result, mapping)
	if err != nil {
		t.Fatal(err)
	}
	slug := fmt.Sprintf("floor-scheme-roundtrip-%d", time.Now().UnixNano())
	developerSlug := slug + "-developer"
	result.House.ProjectSlug = slug
	audit.ProjectSlug = slug
	result.FloorSchemeAudit = &audit
	result.FloorSchemes = schemes
	artifact, err := buildPublicFloorSchemeArtifact(result, func(sourceKey, _ string, _ int, _ string) (string, error) { return sourceKey, nil })
	if err != nil {
		t.Fatal(err)
	}
	boundaryZone := time.FixedZone("UTC+5", 5*60*60)
	boundary := time.Date(2026, time.August, 31, 23, 59, 59, 123456500, boundaryZone)
	artifact.CapturedAt = &boundary
	artifact.SourceObservedAt = boundary
	artifact.ExpectedUniverse.SourceObservedAt = boundary
	fixtureRoot := t.TempDir()
	dataDir := filepath.Join(fixtureRoot, "data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	sidecarBody := writeFloorSchemeCatalogImportFixture(t, dataDir, slug, developerSlug, boundary.Add(-time.Hour), result.Units, artifact)
	importResult, err := ImportCatalogDirectory(ctx, pool, dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if importResult.Projects != 1 || importResult.RecordsSaved != 199 || importResult.FloorSchemeArtifacts != 1 {
		t.Fatalf("production catalog import did not include floor sidecar: %#v", importResult)
	}
	var developerID, projectID int64
	if err := pool.QueryRow(ctx, `SELECT d.id,p.id FROM projects p JOIN developers d ON d.id=p.developer_id WHERE p.slug=$1 AND d.slug=$2`, slug, developerSlug).Scan(&developerID, &projectID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE sync_run_id=$1`, importResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE id=$1`, importResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, projectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, developerID)
	}()

	store := database.NewStore(pool)
	stored, err := store.GetFloorSchemeArtifact(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	wantTimestamp := boundary.UTC().Truncate(time.Microsecond)
	if stored.CapturedAt == nil || !stored.CapturedAt.Equal(wantTimestamp) || !stored.SourceObservedAt.Equal(wantTimestamp) || stored.ExpectedUniverse == nil || !stored.ExpectedUniverse.SourceObservedAt.Equal(wantTimestamp) {
		t.Fatalf("timestamps did not survive UTC microsecond DB round-trip: %#v", stored)
	}
	wantSidecarDigest := sha256.Sum256(sidecarBody)
	if stored.SidecarByteSHA256 != hex.EncodeToString(wantSidecarDigest[:]) || stored.ExpectedUniverse.UnitCount != 209 || stored.ExpectedUniverse.LockedSnapshotUnitCount != 199 || stored.ExpectedUniverse.CompanionUnitCount != 10 || len(stored.Schemes) != 34 || stored.HotspotCount != 209 || stored.CompanionEvidence == nil || stored.CompanionEvidence.RecordCount != 10 {
		t.Fatalf("non-empty floor artifact did not round-trip: %#v", stored)
	}
	keyedZones, companionZones := 0, 0
	for _, scheme := range stored.Schemes {
		for _, zone := range scheme.Zones {
			if zone.UnitKey == nil {
				companionZones++
			} else {
				keyedZones++
			}
		}
	}
	if keyedZones != 199 || companionZones != 10 {
		t.Fatalf("persisted floor identity split=%d keyed/%d companion, want 199/10", keyedZones, companionZones)
	}
	if checksum, err := floorSchemeArtifactChecksum(stored); err != nil || checksum != stored.BackendAPIArtifactSHA256 {
		t.Fatalf("backend API checksum is unstable after DB round-trip: checksum=%q stored=%q err=%v", checksum, stored.BackendAPIArtifactSHA256, err)
	}

	for _, downgrade := range []domain.FloorSchemeArtifact{
		{SchemaVersion: 2, ProjectSlug: slug, CaptureStatus: "blocked-by-authentication", CaptureScope: domain.FloorSchemeCaptureScope{Mode: "blocked", DeclaredBlocks: []int{}, DeclaredEntrances: []string{}, DeclaredFloors: []domain.FloorSchemeScopeFloor{}, DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{}, AuditedExclusions: []domain.FloorSchemeAuditedExclusion{{Kind: "all", Reason: "auth", Evidence: "fixture"}}}, SourceStatus: "blocked-by-authentication", SourceObservedAt: wantTimestamp.Add(time.Hour), Schemes: []domain.FloorScheme{}},
		func() domain.FloorSchemeArtifact {
			partial := stored
			value := wantTimestamp.Add(time.Hour)
			partial.CapturedAt = &value
			partial.SourceObservedAt = value
			partial.CaptureStatus = "captured-partial"
			partial.CaptureScope.Mode = "partial"
			partial.CaptureScope.AuditedExclusions = []domain.FloorSchemeAuditedExclusion{{Kind: "remaining", Reason: "fixture-partial", Evidence: "A newer partial capture must not replace a complete artifact."}}
			partial.ExpectedUniverse = nil
			partial.CompanionEvidence = nil
			return partial
		}(),
		func() domain.FloorSchemeArtifact {
			stale := stored
			expected := *stored.ExpectedUniverse
			expected.Assignments = append([]domain.FloorSchemeExpectedUniverseAssignment(nil), stored.ExpectedUniverse.Assignments...)
			stale.ExpectedUniverse = &expected
			value := wantTimestamp.Add(-time.Hour)
			stale.CapturedAt = &value
			stale.SourceObservedAt = value
			stale.ExpectedUniverse.SourceObservedAt = value
			return stale
		}(),
	} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if err := upsertFloorSchemeArtifact(ctx, tx, projectID, downgrade); err != nil {
			_ = tx.Rollback(ctx)
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	afterDowngrade, err := store.GetFloorSchemeArtifact(ctx, slug)
	if err != nil {
		t.Fatal(err)
	}
	if afterDowngrade.BackendAPIArtifactSHA256 != stored.BackendAPIArtifactSHA256 || afterDowngrade.CaptureStatus != "captured-complete" {
		t.Fatalf("database freshness guard accepted a downgrade: before=%#v after=%#v", stored, afterDowngrade)
	}

	server := httptest.NewServer(httpapi.New(store, slog.New(slog.NewTextHandler(io.Discard, nil)), ""))
	defer server.Close()
	response, err := http.Get(server.URL + "/v1/projects/" + slug + "/floor-schemes") //nolint:gosec
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(response.Header.Get("Cache-Control"), "public") {
		t.Fatalf("floor-scheme endpoint status/cache=%d/%q", response.StatusCode, response.Header.Get("Cache-Control"))
	}
	var apiArtifact domain.FloorSchemeArtifact
	if err := json.NewDecoder(response.Body).Decode(&apiArtifact); err != nil {
		t.Fatal(err)
	}
	if apiArtifact.BackendAPIArtifactSHA256 != stored.BackendAPIArtifactSHA256 || apiArtifact.SidecarByteSHA256 != stored.SidecarByteSHA256 || apiArtifact.ExpectedUniverse == nil || apiArtifact.CompanionEvidence == nil || len(apiArtifact.Schemes[0].Zones) != 7 {
		t.Fatalf("HTTP artifact lost sanitized fields: %#v", apiArtifact)
	}
	encoded, _ := json.Marshal(apiArtifact)
	for _, forbidden := range []string{"profitbase.ru", "tenantOrigin", "houseId", "accountId", `"routes"`, "credentials"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("HTTP floor-scheme payload leaks %q: %s", forbidden, encoded)
		}
	}

	blockedSlug := fmt.Sprintf("floor-scheme-blocked-%d", time.Now().UnixNano())
	blockedDeveloperSlug := blockedSlug + "-developer"
	blockedObservedAt := boundary.Add(2 * time.Hour)
	blockedArtifact := domain.FloorSchemeArtifact{
		SchemaVersion: 2,
		ProjectSlug:   blockedSlug,
		CaptureStatus: "blocked-by-authentication",
		CaptureScope: domain.FloorSchemeCaptureScope{
			Mode:                 "blocked",
			DeclaredBlocks:       []int{},
			DeclaredEntrances:    []string{},
			DeclaredFloors:       []domain.FloorSchemeScopeFloor{},
			DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{},
			AuditedExclusions: []domain.FloorSchemeAuditedExclusion{{
				Kind: "all-floor-schemes", Reason: "authentication-required", Evidence: "The read-only fixture represents an authenticated CRM blocker.",
			}},
		},
		SourceStatus:     "blocked-by-authentication",
		SourceObservedAt: blockedObservedAt,
		Schemes:          []domain.FloorScheme{},
	}
	blockedRoot := t.TempDir()
	blockedDir := filepath.Join(blockedRoot, "data")
	if err := os.MkdirAll(blockedDir, 0o755); err != nil {
		t.Fatal(err)
	}
	blockedSidecarBody := writeFloorSchemeCatalogImportFixture(t, blockedDir, blockedSlug, blockedDeveloperSlug, boundary, result.Units[:1], blockedArtifact)
	blockedImportResult, err := ImportCatalogDirectory(ctx, pool, blockedDir)
	if err != nil {
		t.Fatal(err)
	}
	var blockedDeveloperID, blockedProjectID int64
	if err := pool.QueryRow(ctx, `SELECT d.id,p.id FROM projects p JOIN developers d ON d.id=p.developer_id WHERE p.slug=$1 AND d.slug=$2`, blockedSlug, blockedDeveloperSlug).Scan(&blockedDeveloperID, &blockedProjectID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE sync_run_id=$1`, blockedImportResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE id=$1`, blockedImportResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, blockedProjectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, blockedDeveloperID)
	}()
	blockedStored, err := store.GetFloorSchemeArtifact(ctx, blockedSlug)
	if err != nil {
		t.Fatal(err)
	}
	blockedDigest := sha256.Sum256(blockedSidecarBody)
	if blockedStored.CaptureStatus != "blocked-by-authentication" || blockedStored.FloorSchemeCount != 0 || blockedStored.HotspotCount != 0 || len(blockedStored.Schemes) != 0 || blockedStored.ExpectedUniverse != nil || blockedStored.SidecarByteSHA256 != hex.EncodeToString(blockedDigest[:]) {
		t.Fatalf("blocked production sidecar did not round-trip: %#v", blockedStored)
	}
	blockedResponse, err := http.Get(server.URL + "/v1/projects/" + blockedSlug + "/floor-schemes") //nolint:gosec
	if err != nil {
		t.Fatal(err)
	}
	defer blockedResponse.Body.Close()
	if blockedResponse.StatusCode != http.StatusOK {
		t.Fatalf("blocked floor-scheme endpoint status=%d", blockedResponse.StatusCode)
	}
	var blockedAPIArtifact domain.FloorSchemeArtifact
	if err := json.NewDecoder(blockedResponse.Body).Decode(&blockedAPIArtifact); err != nil {
		t.Fatal(err)
	}
	if blockedAPIArtifact.CaptureStatus != "blocked-by-authentication" || blockedAPIArtifact.FloorSchemeCount != 0 || blockedAPIArtifact.HotspotCount != 0 || len(blockedAPIArtifact.Schemes) != 0 {
		t.Fatalf("blocked floor-scheme API response is not an honest zero capture: %#v", blockedAPIArtifact)
	}

	unavailableSlug := fmt.Sprintf("floor-scheme-unavailable-%d", time.Now().UnixNano())
	unavailableDeveloperSlug := unavailableSlug + "-developer"
	unavailableObservedAt := boundary.Add(3 * time.Hour)
	unavailableArtifact := domain.FloorSchemeArtifact{
		SchemaVersion: 3,
		ProjectSlug:   unavailableSlug,
		CapturedAt:    &unavailableObservedAt,
		CaptureStatus: "not-published-by-source",
		CaptureScope: domain.FloorSchemeCaptureScope{
			Mode:                 "unavailable",
			DeclaredBlocks:       []int{},
			DeclaredEntrances:    []string{},
			DeclaredFloors:       []domain.FloorSchemeScopeFloor{},
			DeclaredUnitHotspots: []domain.FloorSchemeScopeUnitHotspot{},
			AuditedExclusions: []domain.FloorSchemeAuditedExclusion{{
				Kind: "all-floor-schemes", Reason: "not-published-by-source", Evidence: "The authenticated read-only source publishes no official floor-plan assets.",
			}},
		},
		SourceStatus:     "captured-read-only",
		SourceObservedAt: unavailableObservedAt,
		Schemes:          []domain.FloorScheme{},
	}
	unavailableRoot := t.TempDir()
	unavailableDir := filepath.Join(unavailableRoot, "data")
	if err := os.MkdirAll(unavailableDir, 0o755); err != nil {
		t.Fatal(err)
	}
	unavailableSidecarBody := writeFloorSchemeCatalogImportFixture(t, unavailableDir, unavailableSlug, unavailableDeveloperSlug, boundary, result.Units[:1], unavailableArtifact)
	unavailableImportResult, err := ImportCatalogDirectory(ctx, pool, unavailableDir)
	if err != nil {
		t.Fatal(err)
	}
	var unavailableDeveloperID, unavailableProjectID int64
	if err := pool.QueryRow(ctx, `SELECT d.id,p.id FROM projects p JOIN developers d ON d.id=p.developer_id WHERE p.slug=$1 AND d.slug=$2`, unavailableSlug, unavailableDeveloperSlug).Scan(&unavailableDeveloperID, &unavailableProjectID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM source_snapshots WHERE sync_run_id=$1`, unavailableImportResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM sync_runs WHERE id=$1`, unavailableImportResult.SyncRunID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM projects WHERE id=$1`, unavailableProjectID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM developers WHERE id=$1`, unavailableDeveloperID)
	}()
	unavailableStored, err := store.GetFloorSchemeArtifact(ctx, unavailableSlug)
	if err != nil {
		t.Fatal(err)
	}
	unavailableDigest := sha256.Sum256(unavailableSidecarBody)
	if unavailableStored.SchemaVersion != 3 || unavailableStored.CaptureStatus != "not-published-by-source" || unavailableStored.CapturedAt == nil || unavailableStored.CaptureScope.Mode != "unavailable" || unavailableStored.FloorSchemeCount != 0 || unavailableStored.HotspotCount != 0 || len(unavailableStored.Schemes) != 0 || unavailableStored.ExpectedUniverse != nil || unavailableStored.CompanionEvidence != nil || unavailableStored.SidecarByteSHA256 != hex.EncodeToString(unavailableDigest[:]) {
		t.Fatalf("schema v3 source-unavailable sidecar did not round-trip: %#v", unavailableStored)
	}
	unavailableResponse, err := http.Get(server.URL + "/v1/projects/" + unavailableSlug + "/floor-schemes") //nolint:gosec
	if err != nil {
		t.Fatal(err)
	}
	defer unavailableResponse.Body.Close()
	if unavailableResponse.StatusCode != http.StatusOK {
		t.Fatalf("source-unavailable floor-scheme endpoint status=%d", unavailableResponse.StatusCode)
	}
	var unavailableAPIArtifact domain.FloorSchemeArtifact
	if err := json.NewDecoder(unavailableResponse.Body).Decode(&unavailableAPIArtifact); err != nil {
		t.Fatal(err)
	}
	if unavailableAPIArtifact.SchemaVersion != 3 || unavailableAPIArtifact.CaptureStatus != "not-published-by-source" || unavailableAPIArtifact.SourceStatus != "captured-read-only" || unavailableAPIArtifact.CapturedAt == nil || unavailableAPIArtifact.FloorSchemeCount != 0 || unavailableAPIArtifact.HotspotCount != 0 || len(unavailableAPIArtifact.Schemes) != 0 {
		t.Fatalf("source-unavailable API response is not a sanitized audited zero capture: %#v", unavailableAPIArtifact)
	}
}
