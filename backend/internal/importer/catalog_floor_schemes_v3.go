package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

const floorSchemeMappingSchemaVersionV3 = 3

func validateGeneratedFloorSchemeArtifact(artifact domain.FloorSchemeArtifact, project CatalogProject, rawBody []byte) error {
	switch artifact.SchemaVersion {
	case floorSchemeMappingSchemaVersion:
		return validateGeneratedFloorSchemeArtifactV2(artifact, project, rawBody)
	case floorSchemeMappingSchemaVersionV3:
		return validateGeneratedFloorSchemeArtifactV3(artifact, project, rawBody)
	default:
		return fmt.Errorf("unsupported floor-scheme schemaVersion %d for project %q", artifact.SchemaVersion, project.Slug)
	}
}

func validateGeneratedFloorSchemeArtifactV3(artifact domain.FloorSchemeArtifact, project CatalogProject, rawBody []byte) error {
	if err := validateRequiredFloorSchemeJSONFieldsV3(rawBody); err != nil {
		return err
	}
	if artifact.ProjectSlug != project.Slug {
		return fmt.Errorf("floor-scheme project %q does not match catalog project %q", artifact.ProjectSlug, project.Slug)
	}
	if artifact.SourceObservedAt.IsZero() || strings.TrimSpace(artifact.SourceStatus) == "" {
		return errors.New("floor-scheme source status/observedAt are required")
	}
	for _, forbidden := range []string{"profitbase.ru", `"tenantOrigin"`, `"houseId"`, `"accountId"`, `"routes"`, `"credentials"`, `"cookie"`, `"token"`} {
		if bytes.Contains(bytes.ToLower(rawBody), bytes.ToLower([]byte(forbidden))) {
			return fmt.Errorf("sanitized floor-scheme artifact contains forbidden source metadata %q", forbidden)
		}
	}
	if bytes.Contains(rawBody, []byte(`"sidecarByteSha256"`)) || bytes.Contains(rawBody, []byte(`"backendApiArtifactSha256"`)) || bytes.Contains(rawBody, []byte(`"artifactSha256"`)) {
		return errors.New("generated floor-scheme sidecar must not contain self-referential transport/API checksums")
	}
	if bytes.Contains(rawBody, []byte(`"lockedSnapshotUnitCount"`)) {
		return errors.New("schema v3 expected universe must use generic catalogUnitCount, not the legacy Mirador lockedSnapshotUnitCount")
	}
	if artifact.Schemes == nil {
		return errors.New("schema v3 floor-scheme sidecar must declare schemes as an array")
	}
	if artifact.CaptureScope.DeclaredBlocks == nil || artifact.CaptureScope.DeclaredEntrances == nil || artifact.CaptureScope.DeclaredFloors == nil || artifact.CaptureScope.DeclaredUnitHotspots == nil || artifact.CaptureScope.AuditedExclusions == nil {
		return errors.New("schema v3 floor-scheme captureScope collections must be JSON arrays")
	}
	if artifact.FloorSchemeCount != len(artifact.Schemes) || artifact.CaptureScope.SchemeCount != len(artifact.Schemes) || artifact.CaptureScope.HotspotCount != artifact.HotspotCount {
		return errors.New("floor-scheme artifact counts are inconsistent")
	}
	if err := validatePublicFloorSchemeExclusions(artifact.CaptureScope.AuditedExclusions); err != nil {
		return err
	}
	if artifact.BlockEntranceMapping != nil {
		return errors.New("floor-scheme artifact must not infer a visual block-to-entrance mapping")
	}

	if len(artifact.Schemes) == 0 {
		return validateGeneratedZeroFloorSchemeArtifactV3(artifact)
	}
	return validateGeneratedCapturedFloorSchemeArtifactV3(artifact, project)
}

func validateRequiredFloorSchemeJSONFieldsV3(rawBody []byte) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(rawBody, &root); err != nil {
		return fmt.Errorf("decode schema v3 floor-scheme field set: %w", err)
	}
	for _, field := range []string{
		"schemaVersion", "projectSlug", "capturedAt", "captureStatus", "captureScope",
		"sourceStatus", "sourceObservedAt", "floorSchemeCount", "hotspotCount",
		"blockEntranceMapping", "schemes", "expectedUniverse", "companionEvidence",
	} {
		if _, present := root[field]; !present {
			return fmt.Errorf("schema v3 floor-scheme sidecar is missing required field %q", field)
		}
	}
	var scope map[string]json.RawMessage
	if err := json.Unmarshal(root["captureScope"], &scope); err != nil {
		return errors.New("schema v3 floor-scheme captureScope must be an object")
	}
	for _, field := range []string{"mode", "declaredBlocks", "declaredEntrances", "declaredFloors", "declaredUnitHotspots", "schemeCount", "hotspotCount", "auditedExclusions"} {
		if _, present := scope[field]; !present {
			return fmt.Errorf("schema v3 floor-scheme captureScope is missing required field %q", field)
		}
	}
	return nil
}

func validateGeneratedZeroFloorSchemeArtifactV3(artifact domain.FloorSchemeArtifact) error {
	if artifact.FloorSchemeCount != 0 || artifact.HotspotCount != 0 || artifact.ExpectedUniverse != nil || artifact.CompanionEvidence != nil || len(artifact.CaptureScope.DeclaredBlocks) != 0 || len(artifact.CaptureScope.DeclaredEntrances) != 0 || len(artifact.CaptureScope.DeclaredFloors) != 0 || len(artifact.CaptureScope.DeclaredUnitHotspots) != 0 || len(artifact.CaptureScope.AuditedExclusions) == 0 {
		return errors.New("empty schema v3 floor-scheme artifact contains unsupported captured data or lacks an audited exclusion")
	}
	switch artifact.CaptureStatus {
	case "blocked-by-authentication":
		if artifact.SourceStatus != "blocked-by-authentication" || artifact.CaptureScope.Mode != "blocked" || artifact.CapturedAt != nil {
			return errors.New("empty authentication-blocked floor-scheme artifact has invalid provenance")
		}
	case "not-published-by-source":
		if artifact.SourceStatus != "captured-read-only" || artifact.CaptureScope.Mode != "unavailable" || artifact.CapturedAt == nil || artifact.CapturedAt.IsZero() || artifact.CapturedAt.Before(artifact.SourceObservedAt) {
			return errors.New("source-unavailable floor-scheme artifact must be an audited read-only zero capture")
		}
	default:
		return fmt.Errorf("invalid empty schema v3 floor-scheme capture status %q", artifact.CaptureStatus)
	}
	return nil
}

func validateGeneratedCapturedFloorSchemeArtifactV3(artifact domain.FloorSchemeArtifact, project CatalogProject) error {
	if artifact.CapturedAt == nil || artifact.CapturedAt.IsZero() || artifact.CapturedAt.Before(artifact.SourceObservedAt) || artifact.SourceStatus != "captured-read-only" || artifact.FloorSchemeCount <= 0 || artifact.HotspotCount <= 0 {
		return errors.New("captured schema v3 floor-scheme artifact has invalid provenance or empty counts")
	}
	switch artifact.CaptureStatus {
	case "captured-complete":
		if artifact.CaptureScope.Mode != "complete" || len(artifact.CaptureScope.AuditedExclusions) != 0 || artifact.ExpectedUniverse == nil {
			return errors.New("complete schema v3 floor-scheme artifact requires an exact expected universe and no exclusions")
		}
	case "captured-partial":
		if artifact.CaptureScope.Mode != "partial" || len(artifact.CaptureScope.AuditedExclusions) == 0 || artifact.ExpectedUniverse != nil || artifact.CompanionEvidence != nil {
			return errors.New("partial schema v3 floor-scheme artifact requires exclusions and cannot assert a complete universe")
		}
	default:
		return fmt.Errorf("invalid non-empty schema v3 floor-scheme capture status %q", artifact.CaptureStatus)
	}

	eligiblePhases := eligibleApartmentPhases(project)
	if len(eligiblePhases) == 0 {
		return errors.New("catalog project has no apartment phase eligible for floor schemes")
	}
	unitsBySourceKey := make(map[string]NormalizedUnit, len(project.Units))
	for _, unit := range project.Units {
		if strings.TrimSpace(unit.SourceKey) == "" {
			return errors.New("catalog contains a unit without canonical sourceKey")
		}
		if _, duplicate := unitsBySourceKey[unit.SourceKey]; duplicate {
			return fmt.Errorf("catalog repeats canonical sourceKey %q", unit.SourceKey)
		}
		unitsBySourceKey[unit.SourceKey] = unit
	}

	companionRecords, err := validateFloorSchemeCompanionEvidenceV3(artifact.CompanionEvidence, artifact.SourceObservedAt, eligiblePhases)
	if err != nil {
		return err
	}
	seenSchemes := make(map[string]struct{}, len(artifact.Schemes))
	seenUnitKeys := make(map[string]struct{}, artifact.HotspotCount)
	actualAssignments := make(map[string]struct{}, artifact.HotspotCount)
	actualSchemeKeys := make(map[string]struct{}, len(artifact.Schemes))
	usedCompanionRecords := make(map[string]struct{}, len(companionRecords))
	hotspotCount := 0
	for schemeIndex, scheme := range artifact.Schemes {
		if _, valid := eligiblePhases[scheme.PhaseSlug]; !valid {
			return fmt.Errorf("floor scheme %d phaseSlug %q is not an apartment phase in project %q", schemeIndex+1, scheme.PhaseSlug, project.Slug)
		}
		if err := validateFloorSchemeV3(project.Slug, scheme); err != nil {
			return fmt.Errorf("floor scheme %d: %w", schemeIndex+1, err)
		}
		schemeKey := floorSchemeCompositeKey(scheme.PhaseSlug, scheme.Entrance, scheme.Floor)
		if _, duplicate := seenSchemes[schemeKey]; duplicate {
			return fmt.Errorf("floor scheme %d duplicates phase/entrance/floor %q", schemeIndex+1, schemeKey)
		}
		seenSchemes[schemeKey] = struct{}{}
		actualSchemeKeys[schemeKey] = struct{}{}
		seenNumbers := make(map[string]struct{}, len(scheme.Zones))
		for zoneIndex, zone := range scheme.Zones {
			if err := validateFloorSchemeZone(floorScheme{Width: scheme.Width, Height: scheme.Height}, floorSchemeZone{UnitNumber: zone.UnitNumber, Points: zone.Points, Label: floorSchemeLabel{X: zone.Label.X, Y: zone.Label.Y}}); err != nil {
				return fmt.Errorf("floor scheme %d zone %d: %w", schemeIndex+1, zoneIndex+1, err)
			}
			if _, duplicate := seenNumbers[zone.UnitNumber]; duplicate {
				return fmt.Errorf("floor scheme %d repeats apartment %q", schemeIndex+1, zone.UnitNumber)
			}
			seenNumbers[zone.UnitNumber] = struct{}{}
			unitKey := ""
			if zone.UnitKey == nil {
				if artifact.CaptureStatus != "captured-complete" {
					return fmt.Errorf("floor scheme %d zone %d has null unitKey outside a complete companion-evidenced capture", schemeIndex+1, zoneIndex+1)
				}
				companionKey := floorSchemeCompositeAssignmentKey(scheme.PhaseSlug, scheme.Entrance, scheme.Floor, zone.UnitNumber)
				if _, official := companionRecords[companionKey]; !official {
					return fmt.Errorf("floor scheme %d zone %d has null unitKey without exact phase-aware companion evidence", schemeIndex+1, zoneIndex+1)
				}
				usedCompanionRecords[companionKey] = struct{}{}
			} else {
				unitKey = *zone.UnitKey
				unit, matched := unitsBySourceKey[unitKey]
				if strings.TrimSpace(unitKey) == "" || !matched || unit.PhaseSlug != scheme.PhaseSlug || unit.PropertyType != "apartment" || unit.Entrance != scheme.Entrance || unit.Floor != scheme.Floor || unit.Number != zone.UnitNumber {
					return fmt.Errorf("floor scheme %d zone %d unitKey %q does not strictly match one active apartment phase/entrance/floor/unit tuple", schemeIndex+1, zoneIndex+1, unitKey)
				}
				if _, duplicate := seenUnitKeys[unitKey]; duplicate {
					return fmt.Errorf("floor scheme %d zone %d repeats canonical unitKey %q across the capture", schemeIndex+1, zoneIndex+1, unitKey)
				}
				seenUnitKeys[unitKey] = struct{}{}
			}
			assignmentKey := floorSchemeExpectedAssignmentKeyV3(scheme.PhaseSlug, scheme.Entrance, scheme.Floor, zone.UnitNumber, unitKey)
			if _, duplicate := actualAssignments[assignmentKey]; duplicate {
				return fmt.Errorf("floor scheme %d zone %d duplicates a composite assignment across the capture", schemeIndex+1, zoneIndex+1)
			}
			actualAssignments[assignmentKey] = struct{}{}
			hotspotCount++
		}
	}
	if hotspotCount != artifact.HotspotCount {
		return fmt.Errorf("floor-scheme artifact has %d hotspots, declares %d", hotspotCount, artifact.HotspotCount)
	}
	if err := validatePublicFloorSchemeCaptureSetsV3(artifact.CaptureScope, artifact.Schemes); err != nil {
		return err
	}
	if artifact.CaptureStatus == "captured-complete" {
		if err := validateCompleteExpectedUniverseV3(artifact, eligiblePhases, unitsBySourceKey, companionRecords, usedCompanionRecords, actualSchemeKeys, actualAssignments); err != nil {
			return err
		}
	}
	return nil
}

func eligibleApartmentPhases(project CatalogProject) map[string]struct{} {
	result := make(map[string]struct{})
	knownPhaseTypes := make(map[string]string, len(project.Phases))
	for _, phase := range project.Phases {
		knownPhaseTypes[phase.Slug] = phase.PropertyType
		if phase.PropertyType == "apartment" && phase.Slug != "" && phase.Slug == strings.TrimSpace(phase.Slug) {
			result[phase.Slug] = struct{}{}
		}
	}
	for _, unit := range project.Units {
		phaseType, known := knownPhaseTypes[unit.PhaseSlug]
		if unit.PropertyType == "apartment" && (!known || phaseType == "apartment") && unit.PhaseSlug != "" && unit.PhaseSlug == strings.TrimSpace(unit.PhaseSlug) {
			result[unit.PhaseSlug] = struct{}{}
		}
	}
	return result
}

func validateFloorSchemeV3(projectSlug string, scheme domain.FloorScheme) error {
	if scheme.PhaseSlug == "" || scheme.PhaseSlug != strings.TrimSpace(scheme.PhaseSlug) {
		return fmt.Errorf("phaseSlug %q is invalid", scheme.PhaseSlug)
	}
	if scheme.Entrance == "" || scheme.Entrance != strings.TrimSpace(scheme.Entrance) {
		return fmt.Errorf("entrance %q is invalid", scheme.Entrance)
	}
	if scheme.Floor <= 0 {
		return fmt.Errorf("floor %d must be positive", scheme.Floor)
	}
	if scheme.Width <= 0 || scheme.Height <= 0 || scheme.Width > maxFloorSchemeImageDimension || scheme.Height > maxFloorSchemeImageDimension || int64(scheme.Width)*int64(scheme.Height) > maxFloorSchemeImagePixels {
		return fmt.Errorf("image dimensions %dx%d are invalid", scheme.Width, scheme.Height)
	}
	if scheme.ImageBytes < 1024 || scheme.ImageBytes > maxFloorSchemeImageBytes {
		return fmt.Errorf("image byte size %d is outside the safe range", scheme.ImageBytes)
	}
	if err := validateLowerSHA256(scheme.ImageSHA256); err != nil {
		return fmt.Errorf("image SHA-256 %q is invalid", scheme.ImageSHA256)
	}
	if len(scheme.Zones) == 0 {
		return errors.New("an official floor scheme needs at least one apartment hotspot")
	}
	prefix := "/kayan/" + projectSlug + "/floor-schemes/"
	if err := validateLocalFloorSchemeURL(prefix, scheme.ImageURL); err != nil {
		return err
	}
	if validateLowerSHA256(scheme.SourceScreenshotSHA256) != nil || scheme.SourceScreenshotWidth <= 0 || scheme.SourceScreenshotHeight <= 0 || scheme.SourceScreenshotWidth > maxFloorSchemeImageDimension || scheme.SourceScreenshotHeight > maxFloorSchemeImageDimension || int64(scheme.SourceScreenshotWidth)*int64(scheme.SourceScreenshotHeight) > maxFloorSchemeImagePixels {
		return errors.New("source screenshot provenance is invalid")
	}
	if scheme.SourceCrop.X < 0 || scheme.SourceCrop.Y < 0 || scheme.SourceCrop.Width != scheme.Width || scheme.SourceCrop.Height != scheme.Height || scheme.SourceCrop.X+scheme.SourceCrop.Width > scheme.SourceScreenshotWidth || scheme.SourceCrop.Y+scheme.SourceCrop.Height > scheme.SourceScreenshotHeight {
		return errors.New("source crop is outside the declared source screenshot")
	}
	return nil
}

func validateFloorSchemeCompanionEvidenceV3(companion *domain.FloorSchemeCompanionEvidence, sourceObservedAt time.Time, eligiblePhases map[string]struct{}) (map[string]struct{}, error) {
	result := make(map[string]struct{})
	if companion == nil {
		return result, nil
	}
	if companion.Source == "" || companion.Source != strings.TrimSpace(companion.Source) || len(companion.Source) > 200 || strings.ContainsAny(companion.Source, "\x00\r\n") || companion.SourceObservedAt.IsZero() || companion.SourceObservedAt.After(sourceObservedAt) || validateLowerSHA256(companion.RecordsSHA256) != nil || companion.RecordCount <= 0 || companion.RecordCount != len(companion.Records) {
		return nil, errors.New("schema v3 floor-scheme companion evidence has invalid provenance/counts")
	}
	if companion.UnitNumbers == nil {
		return nil, errors.New("schema v3 companion unitNumbers must be a JSON array")
	}
	if len(companion.UnitNumbers) != 0 && len(companion.UnitNumbers) != companion.RecordCount {
		return nil, errors.New("schema v3 companion unitNumbers must be empty or mirror phase-aware records")
	}
	for index, record := range companion.Records {
		if _, valid := eligiblePhases[record.PhaseSlug]; !valid || record.Entrance == "" || record.Entrance != strings.TrimSpace(record.Entrance) || record.Floor <= 0 || record.UnitNumber == "" || record.UnitNumber != strings.TrimSpace(record.UnitNumber) {
			return nil, fmt.Errorf("schema v3 companion record %d has an invalid composite identity", index+1)
		}
		if len(companion.UnitNumbers) != 0 && companion.UnitNumbers[index] != record.UnitNumber {
			return nil, fmt.Errorf("schema v3 companion record %d does not match unitNumbers", index+1)
		}
		key := floorSchemeCompositeAssignmentKey(record.PhaseSlug, record.Entrance, record.Floor, record.UnitNumber)
		if _, duplicate := result[key]; duplicate {
			return nil, fmt.Errorf("schema v3 companion record %d duplicates a composite identity", index+1)
		}
		result[key] = struct{}{}
	}
	return result, nil
}

func validateCompleteExpectedUniverseV3(artifact domain.FloorSchemeArtifact, eligiblePhases map[string]struct{}, unitsBySourceKey map[string]NormalizedUnit, companionRecords, usedCompanionRecords, actualSchemeKeys, actualAssignments map[string]struct{}) error {
	expected := artifact.ExpectedUniverse
	if expected == nil {
		return errors.New("complete schema v3 floor-scheme capture requires an expected universe")
	}
	if expected.CatalogUnitCount == nil {
		return errors.New("schema v3 floor-scheme expected universe requires catalogUnitCount")
	}
	catalogUnitCount := *expected.CatalogUnitCount
	if !expected.SourceObservedAt.Equal(artifact.SourceObservedAt) || validateLowerSHA256(expected.ExpectedManifestByteSHA256) != nil || expected.SchemeCount != artifact.FloorSchemeCount || expected.UnitCount != artifact.HotspotCount || expected.UnitCount != len(expected.Assignments) || catalogUnitCount < 0 || expected.LockedSnapshotUnitCount != 0 || expected.CompanionUnitCount < 0 || catalogUnitCount+expected.CompanionUnitCount != expected.UnitCount {
		return errors.New("schema v3 floor-scheme expected-universe provenance/counts are invalid")
	}
	expectedAssignments := make(map[string]struct{}, len(expected.Assignments))
	expectedSchemes := make(map[string]struct{}, expected.SchemeCount)
	seenUnitKeys := make(map[string]struct{}, catalogUnitCount)
	companionCount := 0
	for index, assignment := range expected.Assignments {
		if _, valid := eligiblePhases[assignment.PhaseSlug]; !valid || assignment.Entrance == "" || assignment.Entrance != strings.TrimSpace(assignment.Entrance) || assignment.Floor <= 0 || assignment.UnitNumber == "" || assignment.UnitNumber != strings.TrimSpace(assignment.UnitNumber) {
			return fmt.Errorf("schema v3 expected-universe assignment %d has an invalid composite identity", index+1)
		}
		unitKey := ""
		if assignment.UnitKey == nil {
			if assignment.Evidence != "official-public-companion" {
				return fmt.Errorf("schema v3 expected-universe assignment %d has null unitKey without companion evidence", index+1)
			}
			companionKey := floorSchemeCompositeAssignmentKey(assignment.PhaseSlug, assignment.Entrance, assignment.Floor, assignment.UnitNumber)
			if _, present := companionRecords[companionKey]; !present {
				return fmt.Errorf("schema v3 expected-universe assignment %d is absent from companion evidence", index+1)
			}
			companionCount++
		} else {
			unitKey = *assignment.UnitKey
			if assignment.Evidence != "catalog-unit" {
				return fmt.Errorf("schema v3 expected-universe assignment %d has unsupported evidence %q", index+1, assignment.Evidence)
			}
			unit, matched := unitsBySourceKey[unitKey]
			if strings.TrimSpace(unitKey) == "" || !matched || unit.PhaseSlug != assignment.PhaseSlug || unit.PropertyType != "apartment" || unit.Entrance != assignment.Entrance || unit.Floor != assignment.Floor || unit.Number != assignment.UnitNumber {
				return fmt.Errorf("schema v3 expected-universe assignment %d does not strictly match one catalog unit", index+1)
			}
			if _, duplicate := seenUnitKeys[unitKey]; duplicate {
				return fmt.Errorf("schema v3 expected-universe assignment %d duplicates unitKey %q", index+1, unitKey)
			}
			seenUnitKeys[unitKey] = struct{}{}
		}
		key := floorSchemeExpectedAssignmentKeyV3(assignment.PhaseSlug, assignment.Entrance, assignment.Floor, assignment.UnitNumber, unitKey)
		if _, duplicate := expectedAssignments[key]; duplicate {
			return fmt.Errorf("schema v3 expected-universe assignment %d duplicates a composite identity", index+1)
		}
		expectedAssignments[key] = struct{}{}
		expectedSchemes[floorSchemeCompositeKey(assignment.PhaseSlug, assignment.Entrance, assignment.Floor)] = struct{}{}
	}
	if len(seenUnitKeys) != catalogUnitCount || companionCount != expected.CompanionUnitCount || len(companionRecords) != expected.CompanionUnitCount || len(usedCompanionRecords) != len(companionRecords) {
		return errors.New("schema v3 expected-universe keyed/companion counts do not cover the captured assignments")
	}
	if len(expectedSchemes) != expected.SchemeCount || !equalStringSets(expectedSchemes, actualSchemeKeys) || !equalStringSets(expectedAssignments, actualAssignments) {
		return errors.New("schema v3 floor-scheme payload does not exactly match the expected phase-aware universe")
	}
	return nil
}

func validatePublicFloorSchemeCaptureSetsV3(scope domain.FloorSchemeCaptureScope, schemes []domain.FloorScheme) error {
	entranceSet := make(map[string]struct{})
	floors := make([]domain.FloorSchemeScopeFloor, 0, len(schemes))
	hotspots := make([]domain.FloorSchemeScopeUnitHotspot, 0, scope.HotspotCount)
	for _, scheme := range schemes {
		entranceSet[scheme.Entrance] = struct{}{}
		floors = append(floors, domain.FloorSchemeScopeFloor{PhaseSlug: scheme.PhaseSlug, Entrance: scheme.Entrance, Floor: scheme.Floor})
		for _, zone := range scheme.Zones {
			hotspots = append(hotspots, domain.FloorSchemeScopeUnitHotspot{PhaseSlug: scheme.PhaseSlug, Entrance: scheme.Entrance, Floor: scheme.Floor, UnitNumber: zone.UnitNumber})
		}
	}
	entrances := make([]string, 0, len(entranceSet))
	for entrance := range entranceSet {
		entrances = append(entrances, entrance)
	}
	sort.Strings(entrances)
	sort.Slice(floors, func(i, j int) bool {
		return compareFloorSchemeScopeFloorV3(floors[i], floors[j]) < 0
	})
	sort.Slice(hotspots, func(i, j int) bool {
		left, right := hotspots[i], hotspots[j]
		if left.PhaseSlug != right.PhaseSlug {
			return left.PhaseSlug < right.PhaseSlug
		}
		if left.Entrance != right.Entrance {
			return left.Entrance < right.Entrance
		}
		if left.Floor != right.Floor {
			return left.Floor < right.Floor
		}
		return compareUnitNumbers(left.UnitNumber, right.UnitNumber) < 0
	})
	if len(scope.DeclaredBlocks) != 0 || !reflect.DeepEqual(scope.DeclaredEntrances, entrances) || !reflect.DeepEqual(scope.DeclaredFloors, floors) || !reflect.DeepEqual(scope.DeclaredUnitHotspots, hotspots) {
		return errors.New("schema v3 declared capture sets do not exactly cover phase-aware schemes/hotspots")
	}
	return nil
}

func compareFloorSchemeScopeFloorV3(left, right domain.FloorSchemeScopeFloor) int {
	if left.PhaseSlug != right.PhaseSlug {
		return strings.Compare(left.PhaseSlug, right.PhaseSlug)
	}
	if left.Entrance != right.Entrance {
		return strings.Compare(left.Entrance, right.Entrance)
	}
	return left.Floor - right.Floor
}

func floorSchemeCompositeKey(phaseSlug, entrance string, floor int) string {
	return strings.Join([]string{phaseSlug, entrance, strconv.Itoa(floor)}, "\x1f")
}

func floorSchemeCompositeAssignmentKey(phaseSlug, entrance string, floor int, unitNumber string) string {
	return strings.Join([]string{phaseSlug, entrance, strconv.Itoa(floor), unitNumber}, "\x1f")
}

func floorSchemeExpectedAssignmentKeyV3(phaseSlug, entrance string, floor int, unitNumber, unitKey string) string {
	return strings.Join([]string{phaseSlug, entrance, strconv.Itoa(floor), unitNumber, unitKey}, "\x1f")
}

func equalStringSets(left, right map[string]struct{}) bool {
	if len(left) != len(right) {
		return false
	}
	for key := range left {
		if _, present := right[key]; !present {
			return false
		}
	}
	return true
}
