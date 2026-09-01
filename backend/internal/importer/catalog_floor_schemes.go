package importer

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

func DiscoverFloorSchemeArtifactFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read catalog directory %s: %w", dir, err)
	}
	paths := make([]string, 0, 1)
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), "-floor-schemes.json") {
			paths = append(paths, filepath.Join(dir, entry.Name()))
		}
	}
	sort.Strings(paths)
	return paths, nil
}

func LoadGeneratedFloorSchemeArtifacts(dir string, bundles []CatalogBundle) (map[string]domain.FloorSchemeArtifact, error) {
	paths, err := DiscoverFloorSchemeArtifactFiles(dir)
	if err != nil {
		return nil, err
	}
	projects := make(map[string]CatalogProject)
	for _, bundle := range bundles {
		for _, project := range bundle.Projects {
			if _, duplicate := projects[project.Slug]; duplicate {
				return nil, fmt.Errorf("floor-scheme association found duplicate catalog project %q", project.Slug)
			}
			projects[project.Slug] = project
		}
	}
	result := make(map[string]domain.FloorSchemeArtifact, len(paths))
	for _, path := range paths {
		body, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read generated floor-scheme artifact %s: %w", path, err)
		}
		artifact, err := decodeGeneratedFloorSchemeArtifact(body)
		if err != nil {
			return nil, fmt.Errorf("decode generated floor-scheme artifact %s: %w", path, err)
		}
		canonicalizeFloorSchemeArtifactTimes(&artifact)
		project, ok := projects[artifact.ProjectSlug]
		if !ok {
			return nil, fmt.Errorf("generated floor-scheme artifact %s references unknown project %q", path, artifact.ProjectSlug)
		}
		if _, duplicate := result[artifact.ProjectSlug]; duplicate {
			return nil, fmt.Errorf("multiple generated floor-scheme artifacts reference project %q", artifact.ProjectSlug)
		}
		if err := validateGeneratedFloorSchemeArtifact(artifact, project, body); err != nil {
			return nil, fmt.Errorf("validate generated floor-scheme artifact %s: %w", path, err)
		}
		if err := validateGeneratedFloorSchemeAssets(dir, artifact); err != nil {
			return nil, fmt.Errorf("validate generated floor-scheme assets for %s: %w", path, err)
		}
		sidecarDigest := sha256.Sum256(body)
		artifact.SidecarByteSHA256 = hex.EncodeToString(sidecarDigest[:])
		artifact.BackendAPIArtifactSHA256, err = floorSchemeArtifactChecksum(artifact)
		if err != nil {
			return nil, fmt.Errorf("checksum generated floor-scheme API artifact %s: %w", path, err)
		}
		result[artifact.ProjectSlug] = artifact
	}
	return result, nil
}

func validateGeneratedFloorSchemeAssets(dataDir string, artifact domain.FloorSchemeArtifact) error {
	publicRoot := generatedFloorSchemePublicRoot(dataDir)
	for schemeIndex, scheme := range artifact.Schemes {
		relativeAssetPath := filepath.FromSlash(strings.TrimPrefix(scheme.ImageURL, "/"))
		assetPath := filepath.Join(publicRoot, relativeAssetPath)
		relativeToPublic, err := filepath.Rel(publicRoot, assetPath)
		if err != nil || relativeToPublic == ".." || strings.HasPrefix(relativeToPublic, ".."+string(filepath.Separator)) {
			return fmt.Errorf("floor scheme %d image path escapes the public asset directory", schemeIndex+1)
		}

		info, err := os.Stat(assetPath)
		if err != nil {
			return fmt.Errorf("floor scheme %d read image asset %s: %w", schemeIndex+1, assetPath, err)
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("floor scheme %d image asset %s is not a regular file", schemeIndex+1, assetPath)
		}
		if info.Size() != scheme.ImageBytes || info.Size() < 1024 || info.Size() > maxFloorSchemeImageBytes {
			return fmt.Errorf("floor scheme %d image asset byte size %d does not match declared safe size %d", schemeIndex+1, info.Size(), scheme.ImageBytes)
		}
		body, err := os.ReadFile(assetPath)
		if err != nil {
			return fmt.Errorf("floor scheme %d read image asset %s: %w", schemeIndex+1, assetPath, err)
		}
		if int64(len(body)) != info.Size() {
			return fmt.Errorf("floor scheme %d image asset size changed while being verified", schemeIndex+1)
		}
		digest := sha256.Sum256(body)
		if hex.EncodeToString(digest[:]) != scheme.ImageSHA256 {
			return fmt.Errorf("floor scheme %d image asset SHA-256 does not match the generated sidecar", schemeIndex+1)
		}
		width, height, err := webPDimensions(body)
		if err != nil {
			return fmt.Errorf("floor scheme %d decode WebP dimensions: %w", schemeIndex+1, err)
		}
		if width != scheme.Width || height != scheme.Height {
			return fmt.Errorf("floor scheme %d WebP dimensions %dx%d do not match declared %dx%d", schemeIndex+1, width, height, scheme.Width, scheme.Height)
		}
	}
	return nil
}

func generatedFloorSchemePublicRoot(dataDir string) string {
	return filepath.Join(filepath.Dir(filepath.Clean(dataDir)), "public")
}

func webPDimensions(body []byte) (int, int, error) {
	if len(body) < 20 || string(body[:4]) != "RIFF" || string(body[8:12]) != "WEBP" {
		return 0, 0, errors.New("asset is not a RIFF WebP")
	}
	declaredSize := uint64(binary.LittleEndian.Uint32(body[4:8])) + 8
	if declaredSize != uint64(len(body)) {
		return 0, 0, fmt.Errorf("RIFF declares %d bytes, file contains %d", declaredSize, len(body))
	}

	canvasWidth, canvasHeight := 0, 0
	imageWidth, imageHeight := 0, 0
	offset := 12
	for offset+8 <= len(body) {
		chunkSize := uint64(binary.LittleEndian.Uint32(body[offset+4 : offset+8]))
		payloadStart := uint64(offset + 8)
		payloadEnd := payloadStart + chunkSize
		if payloadEnd > uint64(len(body)) {
			return 0, 0, errors.New("WebP chunk exceeds the file boundary")
		}
		payload := body[payloadStart:payloadEnd]
		switch string(body[offset : offset+4]) {
		case "VP8X":
			if len(payload) < 10 {
				return 0, 0, errors.New("truncated VP8X header")
			}
			canvasWidth = 1 + int(payload[4]) + (int(payload[5]) << 8) + (int(payload[6]) << 16)
			canvasHeight = 1 + int(payload[7]) + (int(payload[8]) << 8) + (int(payload[9]) << 16)
		case "VP8L":
			if len(payload) < 5 || payload[0] != 0x2f {
				return 0, 0, errors.New("invalid VP8L header")
			}
			imageWidth = 1 + int(payload[1]) + (int(payload[2]&0x3f) << 8)
			imageHeight = 1 + int(payload[2]>>6) + (int(payload[3]) << 2) + (int(payload[4]&0x0f) << 10)
		case "VP8 ":
			if len(payload) < 10 || payload[3] != 0x9d || payload[4] != 0x01 || payload[5] != 0x2a {
				return 0, 0, errors.New("invalid VP8 frame header")
			}
			imageWidth = int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff)
			imageHeight = int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)
			if imageWidth == 0 || imageHeight == 0 {
				return 0, 0, errors.New("WebP dimensions must be positive")
			}
		}

		next := payloadEnd + chunkSize%2
		if next <= uint64(offset) || next > uint64(len(body)) {
			return 0, 0, errors.New("invalid WebP chunk padding")
		}
		offset = int(next)
	}
	if offset != len(body) {
		return 0, 0, errors.New("WebP has a truncated trailing chunk header")
	}
	if imageWidth == 0 || imageHeight == 0 {
		return 0, 0, errors.New("WebP contains no VP8/VP8L image frame")
	}
	if canvasWidth != 0 && (canvasWidth != imageWidth || canvasHeight != imageHeight) {
		return 0, 0, errors.New("WebP canvas and image frame dimensions differ")
	}
	return imageWidth, imageHeight, nil
}

func decodeGeneratedFloorSchemeArtifact(body []byte) (domain.FloorSchemeArtifact, error) {
	var artifact domain.FloorSchemeArtifact
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&artifact); err != nil {
		return domain.FloorSchemeArtifact{}, err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return domain.FloorSchemeArtifact{}, err
	}
	return artifact, nil
}

func validateGeneratedFloorSchemeArtifactV2(artifact domain.FloorSchemeArtifact, project CatalogProject, rawBody []byte) error {
	if artifact.SchemaVersion != floorSchemeMappingSchemaVersion || artifact.ProjectSlug != project.Slug {
		return fmt.Errorf("unsupported floor-scheme identity %d/%q for project %q", artifact.SchemaVersion, artifact.ProjectSlug, project.Slug)
	}
	for _, scheme := range artifact.Schemes {
		if scheme.PhaseSlug != "" || scheme.SourceScreenshotWidth != 0 || scheme.SourceScreenshotHeight != 0 {
			return errors.New("schema v2 floor-scheme sidecar cannot contain schema v3 scheme identity/provenance fields")
		}
	}
	for _, floor := range artifact.CaptureScope.DeclaredFloors {
		if floor.PhaseSlug != "" {
			return errors.New("schema v2 floor-scheme scope cannot contain phaseSlug")
		}
	}
	for _, hotspot := range artifact.CaptureScope.DeclaredUnitHotspots {
		if hotspot.PhaseSlug != "" {
			return errors.New("schema v2 floor-scheme hotspot scope cannot contain phaseSlug")
		}
	}
	if artifact.ExpectedUniverse != nil {
		if artifact.ExpectedUniverse.CatalogUnitCount != nil {
			return errors.New("schema v2 expected universe cannot contain catalogUnitCount")
		}
		for _, assignment := range artifact.ExpectedUniverse.Assignments {
			if assignment.PhaseSlug != "" {
				return errors.New("schema v2 expected universe cannot contain phaseSlug")
			}
		}
	}
	if artifact.CompanionEvidence != nil && len(artifact.CompanionEvidence.Records) != 0 {
		return errors.New("schema v2 companion evidence cannot contain phase-aware records")
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
	if artifact.FloorSchemeCount != len(artifact.Schemes) || artifact.CaptureScope.SchemeCount != len(artifact.Schemes) || artifact.CaptureScope.HotspotCount != artifact.HotspotCount {
		return errors.New("floor-scheme artifact counts are inconsistent")
	}
	if err := validatePublicFloorSchemeExclusions(artifact.CaptureScope.AuditedExclusions); err != nil {
		return err
	}

	if len(artifact.Schemes) == 0 {
		if artifact.CaptureStatus != "blocked-by-authentication" || artifact.SourceStatus != "blocked-by-authentication" || artifact.CaptureScope.Mode != "blocked" || artifact.CapturedAt != nil {
			return errors.New("empty floor-scheme artifact must be an uncaptured authentication blocker")
		}
		if artifact.FloorSchemeCount != 0 || artifact.HotspotCount != 0 || artifact.BlockEntranceMapping != nil || artifact.ExpectedUniverse != nil || artifact.CompanionEvidence != nil || len(artifact.CaptureScope.AuditedExclusions) == 0 || len(artifact.CaptureScope.DeclaredBlocks) != 0 || len(artifact.CaptureScope.DeclaredEntrances) != 0 || len(artifact.CaptureScope.DeclaredFloors) != 0 || len(artifact.CaptureScope.DeclaredUnitHotspots) != 0 {
			return errors.New("blocked floor-scheme artifact contains unsupported captured data")
		}
		return nil
	}

	if artifact.CapturedAt == nil || artifact.CapturedAt.Before(project.CapturedAt) || artifact.SourceStatus != "captured-read-only" {
		return errors.New("captured floor-scheme artifact has invalid provenance time/status")
	}
	if artifact.CaptureStatus == "captured-complete" {
		if artifact.CaptureScope.Mode != "complete" || len(artifact.CaptureScope.AuditedExclusions) != 0 {
			return errors.New("complete floor-scheme artifact cannot contain exclusions")
		}
		if artifact.ExpectedUniverse == nil || artifact.CompanionEvidence == nil {
			return errors.New("complete floor-scheme artifact requires a sanitized expected universe and companion evidence")
		}
	} else if artifact.CaptureStatus == "captured-partial" {
		if artifact.CaptureScope.Mode != "partial" || len(artifact.CaptureScope.AuditedExclusions) == 0 {
			return errors.New("partial floor-scheme artifact requires audited exclusions")
		}
		if artifact.ExpectedUniverse != nil || artifact.CompanionEvidence != nil {
			return errors.New("partial floor-scheme artifact cannot contain an expected universe or companion evidence")
		}
	} else {
		return fmt.Errorf("invalid non-empty floor-scheme capture status %q", artifact.CaptureStatus)
	}
	if artifact.BlockEntranceMapping != nil {
		return errors.New("floor-scheme artifact must not infer a visual block-to-entrance mapping")
	}

	unitsBySourceKey := make(map[string]NormalizedUnit, len(project.Units))
	for _, unit := range project.Units {
		if unit.SourceKey == "" {
			return errors.New("catalog contains a unit without canonical sourceKey")
		}
		if _, duplicate := unitsBySourceKey[unit.SourceKey]; duplicate {
			return fmt.Errorf("catalog repeats canonical sourceKey %q", unit.SourceKey)
		}
		unitsBySourceKey[unit.SourceKey] = unit
	}
	seenSchemes := make(map[string]struct{}, len(artifact.Schemes))
	seenUnitKeys := make(map[string]struct{}, artifact.HotspotCount)
	seenUnitNumbers := make(map[string]struct{}, artifact.HotspotCount)
	normalizedSchemes := make([]NormalizedFloorScheme, 0, len(artifact.Schemes))
	hotspotCount := 0
	for schemeIndex, scheme := range artifact.Schemes {
		rawScheme := floorScheme{
			Entrance: scheme.Entrance, Floor: scheme.Floor,
			ImageURL: scheme.ImageURL, ImageSHA256: scheme.ImageSHA256, ImageBytes: scheme.ImageBytes,
			Width: scheme.Width, Height: scheme.Height,
		}
		mapping := floorSchemeMapping{Validation: floorSchemeMappingValidation{ImagePathPrefix: miradorFloorSchemeImagePrefix}}
		if err := validateFloorScheme(mapping, floorScheme{
			Entrance: rawScheme.Entrance, Floor: rawScheme.Floor,
			ImageURL: rawScheme.ImageURL, ImageSHA256: rawScheme.ImageSHA256, ImageBytes: rawScheme.ImageBytes,
			Width: rawScheme.Width, Height: rawScheme.Height, Zones: make([]floorSchemeZone, len(scheme.Zones)),
		}); err != nil {
			return fmt.Errorf("floor scheme %d: %w", schemeIndex+1, err)
		}
		if validateLowerSHA256(scheme.SourceScreenshotSHA256) != nil || scheme.SourceCrop.X < 0 || scheme.SourceCrop.Y < 0 || scheme.SourceCrop.Width != scheme.Width || scheme.SourceCrop.Height != scheme.Height || scheme.SourceCrop.X+scheme.SourceCrop.Width > 1661 || scheme.SourceCrop.Y+scheme.SourceCrop.Height > 811 {
			return fmt.Errorf("floor scheme %d has invalid source screenshot/crop provenance", schemeIndex+1)
		}
		schemeKey := strings.Join([]string{scheme.Entrance, strconv.Itoa(scheme.Floor)}, "\x1f")
		if _, duplicate := seenSchemes[schemeKey]; duplicate {
			return fmt.Errorf("floor scheme %d duplicates entrance/floor %q", schemeIndex+1, schemeKey)
		}
		seenSchemes[schemeKey] = struct{}{}
		normalized := NormalizedFloorScheme{
			Entrance: scheme.Entrance, Floor: scheme.Floor,
			ImageURL: scheme.ImageURL, ImageSHA256: scheme.ImageSHA256, ImageBytes: scheme.ImageBytes,
			Width: scheme.Width, Height: scheme.Height, SourceScreenshotSHA256: scheme.SourceScreenshotSHA256,
			SourceCrop: floorSchemeImageRectangle{X: scheme.SourceCrop.X, Y: scheme.SourceCrop.Y, Width: scheme.SourceCrop.Width, Height: scheme.SourceCrop.Height},
			Zones:      make([]NormalizedFloorSchemeZone, 0, len(scheme.Zones)),
		}
		seenNumbers := make(map[string]struct{}, len(scheme.Zones))
		for zoneIndex, zone := range scheme.Zones {
			rawZone := floorSchemeZone{UnitNumber: zone.UnitNumber, Points: zone.Points, Label: floorSchemeLabel{X: zone.Label.X, Y: zone.Label.Y}}
			if err := validateFloorSchemeZone(rawScheme, rawZone); err != nil {
				return fmt.Errorf("floor scheme %d zone %d: %w", schemeIndex+1, zoneIndex+1, err)
			}
			if _, duplicate := seenNumbers[zone.UnitNumber]; duplicate {
				return fmt.Errorf("floor scheme %d repeats apartment %q", schemeIndex+1, zone.UnitNumber)
			}
			seenNumbers[zone.UnitNumber] = struct{}{}
			unitKey := ""
			evidence := "official-public-companion"
			if zone.UnitKey != nil {
				unitKey = *zone.UnitKey
				unit, matched := unitsBySourceKey[unitKey]
				if unitKey == "" || !matched || unit.PhaseSlug != "main" || unit.PropertyType != "apartment" || unit.Entrance != scheme.Entrance || unit.Floor != scheme.Floor || unit.Number != zone.UnitNumber {
					return fmt.Errorf("floor scheme %d zone %d unitKey %q does not strictly match one active main apartment tuple", schemeIndex+1, zoneIndex+1, unitKey)
				}
				if _, duplicate := seenUnitKeys[unitKey]; duplicate {
					return fmt.Errorf("floor scheme %d zone %d repeats canonical unitKey %q across the capture", schemeIndex+1, zoneIndex+1, unitKey)
				}
				seenUnitKeys[unitKey] = struct{}{}
				evidence = "locked-snapshot"
			}
			if _, duplicate := seenUnitNumbers[zone.UnitNumber]; duplicate {
				return fmt.Errorf("floor scheme %d zone %d repeats apartment %q across the capture", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
			}
			seenUnitNumbers[zone.UnitNumber] = struct{}{}
			normalized.Zones = append(normalized.Zones, NormalizedFloorSchemeZone{
				UnitSourceKey: unitKey, UnitNumber: zone.UnitNumber, Points: zone.Points, LabelX: zone.Label.X, LabelY: zone.Label.Y, Evidence: evidence,
			})
			hotspotCount++
		}
		normalizedSchemes = append(normalizedSchemes, normalized)
	}
	if hotspotCount != artifact.HotspotCount {
		return fmt.Errorf("floor-scheme artifact has %d hotspots, declares %d", hotspotCount, artifact.HotspotCount)
	}
	if err := validatePublicFloorSchemeCaptureSets(artifact.CaptureScope, normalizedSchemes); err != nil {
		return err
	}
	if artifact.ExpectedUniverse != nil {
		expected := artifact.ExpectedUniverse
		decodedExpectedHash, expectedHashError := hex.DecodeString(expected.ExpectedManifestByteSHA256)
		if !expected.SourceObservedAt.Equal(artifact.SourceObservedAt) || expectedHashError != nil || len(decodedExpectedHash) != sha256.Size || expected.ExpectedManifestByteSHA256 != strings.ToLower(expected.ExpectedManifestByteSHA256) || expected.UnitCount != len(expected.Assignments) {
			return errors.New("sanitized floor-scheme expected universe has invalid provenance/counts")
		}
		internalExpected := &NormalizedFloorSchemeExpectedUniverse{
			SourceObservedAt: expected.SourceObservedAt, ExpectedManifestByteSHA256: expected.ExpectedManifestByteSHA256,
			SchemeCount: expected.SchemeCount, UnitCount: expected.UnitCount,
			LockedSnapshotUnitCount: expected.LockedSnapshotUnitCount, CompanionUnitCount: expected.CompanionUnitCount,
			Assignments: make([]NormalizedFloorSchemeExpectedAssignment, 0, len(expected.Assignments)),
		}
		for _, assignment := range expected.Assignments {
			unitKey := ""
			if assignment.UnitKey != nil {
				unitKey = *assignment.UnitKey
			}
			internalExpected.Assignments = append(internalExpected.Assignments, NormalizedFloorSchemeExpectedAssignment{
				Entrance: assignment.Entrance, Floor: assignment.Floor,
				UnitNumber: assignment.UnitNumber, UnitSourceKey: unitKey, Evidence: assignment.Evidence,
			})
		}
		if artifact.CaptureStatus == "captured-complete" {
			mapping := floorSchemeMapping{
				Source:           floorSchemeMappingSource{ObservedAt: artifact.SourceObservedAt},
				ExpectedUniverse: internalExpected,
			}
			if artifact.CompanionEvidence != nil {
				mapping.CompanionEvidence = &NormalizedFloorSchemeCompanionEvidence{
					Source: artifact.CompanionEvidence.Source, SourceObservedAt: artifact.CompanionEvidence.SourceObservedAt,
					RecordCount: artifact.CompanionEvidence.RecordCount, UnitNumbers: append([]string(nil), artifact.CompanionEvidence.UnitNumbers...), RecordsSHA256: artifact.CompanionEvidence.RecordsSHA256,
				}
			}
			result := &NormalizedSnapshot{House: SnapshotHouse{PhaseSlug: "main"}, Units: project.Units}
			if err := validateCompleteExpectedUniverse(result, mapping, normalizedSchemes, seenUnitKeys, seenUnitNumbers); err != nil {
				return err
			}
		}
	}
	return nil
}

func validatePublicFloorSchemeExclusions(exclusions []domain.FloorSchemeAuditedExclusion) error {
	for index, exclusion := range exclusions {
		if exclusion.Kind == "" || exclusion.Kind != strings.TrimSpace(exclusion.Kind) || exclusion.Reason == "" || exclusion.Reason != strings.TrimSpace(exclusion.Reason) || exclusion.Evidence == "" || exclusion.Evidence != strings.TrimSpace(exclusion.Evidence) || len(exclusion.Kind) > 80 || len(exclusion.Reason) > 160 || len(exclusion.Evidence) > 1000 || strings.ContainsAny(exclusion.Kind+exclusion.Reason+exclusion.Evidence, "\x00\r\n") {
			return fmt.Errorf("floor-scheme audited exclusion %d is invalid", index+1)
		}
	}
	return nil
}

func validatePublicFloorSchemeCaptureSets(scope domain.FloorSchemeCaptureScope, schemes []NormalizedFloorScheme) error {
	entrances := make(map[string]struct{})
	floors := make([]domain.FloorSchemeScopeFloor, 0, len(schemes))
	hotspots := make([]domain.FloorSchemeScopeUnitHotspot, 0, scope.HotspotCount)
	for _, scheme := range schemes {
		entrances[scheme.Entrance] = struct{}{}
		floors = append(floors, domain.FloorSchemeScopeFloor{Entrance: scheme.Entrance, Floor: scheme.Floor})
		for _, zone := range scheme.Zones {
			hotspots = append(hotspots, domain.FloorSchemeScopeUnitHotspot{Entrance: scheme.Entrance, Floor: scheme.Floor, UnitNumber: zone.UnitNumber})
		}
	}
	actualEntrances := make([]string, 0, len(entrances))
	for entrance := range entrances {
		actualEntrances = append(actualEntrances, entrance)
	}
	sort.Strings(actualEntrances)
	sort.Slice(floors, func(i, j int) bool {
		return floors[i].Entrance < floors[j].Entrance || floors[i].Entrance == floors[j].Entrance && floors[i].Floor < floors[j].Floor
	})
	sort.Slice(hotspots, func(i, j int) bool {
		return hotspots[i].Entrance < hotspots[j].Entrance || hotspots[i].Entrance == hotspots[j].Entrance && (hotspots[i].Floor < hotspots[j].Floor || hotspots[i].Floor == hotspots[j].Floor && compareUnitNumbers(hotspots[i].UnitNumber, hotspots[j].UnitNumber) < 0)
	})
	if len(scope.DeclaredBlocks) != 0 || !reflect.DeepEqual(scope.DeclaredEntrances, actualEntrances) || !reflect.DeepEqual(scope.DeclaredFloors, floors) || !reflect.DeepEqual(scope.DeclaredUnitHotspots, hotspots) {
		return errors.New("floor-scheme declared capture sets do not exactly cover the normalized schemes/hotspots")
	}
	return nil
}
