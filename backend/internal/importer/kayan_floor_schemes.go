package importer

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg"
	"io"
	"math"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	floorSchemeMappingSchemaVersion = 2
	miradorFloorSchemeImagePrefix   = "/kayan/mirador/floor-schemes/"
	maxFloorSchemeImageDimension    = 8192
	maxFloorSchemeImagePixels       = 40_000_000
	maxFloorSchemeImageBytes        = 12 << 20
)

// FloorSchemeMappingAudit describes the verified, local-only projection of an
// official floor-scheme capture. Source routes remain in the raw companion and
// are deliberately not part of the public catalog contract.
type FloorSchemeMappingAudit struct {
	Path                 string
	Checksum             string
	SchemaVersion        int
	ProjectSlug          string
	ObservedAt           time.Time
	CapturedAt           *time.Time
	CaptureStatus        string
	CaptureScope         floorSchemeCaptureScope
	SourceStatus         string
	BlockEntranceMapping map[string][]string
	SchemeCount          int
	HotspotCount         int
	ExpectedUniverse     *NormalizedFloorSchemeExpectedUniverse
	CompanionEvidence    *NormalizedFloorSchemeCompanionEvidence
}

type NormalizedFloorSchemeExpectedUniverse struct {
	SourceObservedAt           time.Time
	ExpectedManifestByteSHA256 string
	SchemeCount                int
	UnitCount                  int
	LockedSnapshotUnitCount    int
	CompanionUnitCount         int
	Assignments                []NormalizedFloorSchemeExpectedAssignment
}

type NormalizedFloorSchemeExpectedAssignment struct {
	Entrance      string
	Floor         int
	UnitNumber    string
	UnitSourceKey string
	Evidence      string
}

type NormalizedFloorSchemeCompanionEvidence struct {
	Source           string
	SourceObservedAt time.Time
	RecordCount      int
	UnitNumbers      []string
	RecordsSHA256    string
}

type NormalizedFloorScheme struct {
	Entrance               string
	Floor                  int
	ImageURL               string
	ImageSHA256            string
	ImageBytes             int64
	Width                  int
	Height                 int
	SourceScreenshotSHA256 string
	SourceCrop             floorSchemeImageRectangle
	Zones                  []NormalizedFloorSchemeZone
}

type NormalizedFloorSchemeZone struct {
	// UnitSourceKey is accepted only when the raw value and one strict
	// locked-snapshot tuple agree. It stays empty for the ten independently
	// evidenced companion-only apartments so no identity is invented.
	UnitSourceKey string
	UnitNumber    string
	Points        string
	LabelX        float64
	LabelY        float64
	Evidence      string
}

type floorSchemeMapping struct {
	SchemaVersion     int                                     `json:"schemaVersion"`
	ProjectSlug       string                                  `json:"projectSlug"`
	CapturedAt        *time.Time                              `json:"capturedAt"`
	CaptureStatus     string                                  `json:"captureStatus"`
	CaptureScope      floorSchemeCaptureScope                 `json:"captureScope"`
	Source            floorSchemeMappingSource                `json:"source"`
	Validation        floorSchemeMappingValidation            `json:"validation"`
	Schemes           []floorScheme                           `json:"schemes"`
	ExpectedUniverse  *NormalizedFloorSchemeExpectedUniverse  `json:"-"`
	CompanionEvidence *NormalizedFloorSchemeCompanionEvidence `json:"-"`
}

type floorSchemeCaptureScope struct {
	Mode                 string                        `json:"mode"`
	DeclaredBlocks       []int                         `json:"declaredBlocks"`
	DeclaredEntrances    []string                      `json:"declaredEntrances"`
	DeclaredFloors       []floorSchemeScopeFloor       `json:"declaredFloors"`
	DeclaredUnitHotspots []floorSchemeScopeUnitHotspot `json:"declaredUnitHotspots"`
	SchemeCount          int                           `json:"schemeCount"`
	HotspotCount         int                           `json:"hotspotCount"`
	AuditedExclusions    []floorSchemeAuditedExclusion `json:"auditedExclusions"`
}

type floorSchemeScopeFloor struct {
	Entrance string `json:"entrance"`
	Floor    int    `json:"floor"`
}

type floorSchemeScopeUnitHotspot struct {
	Entrance   string `json:"entrance"`
	Floor      int    `json:"floor"`
	UnitNumber string `json:"unitNumber"`
}

type floorSchemeAuditedExclusion struct {
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
	Evidence string `json:"evidence"`
}

type floorSchemeMappingSource struct {
	ObservedAt   time.Time                      `json:"observedAt"`
	Status       string                         `json:"status"`
	TenantOrigin string                         `json:"tenantOrigin"`
	HouseID      int                            `json:"houseId"`
	AccountID    int                            `json:"accountId"`
	Routes       floorSchemeMappingSourceRoutes `json:"routes"`
	Method       string                         `json:"method"`
	Note         string                         `json:"note"`
}

type floorSchemeMappingSourceRoutes struct {
	Catalog string `json:"catalog"`
	Floor   string `json:"floor"`
	Board   string `json:"board"`
	Facade  string `json:"facade"`
}

type floorSchemeMappingValidation struct {
	LockedSnapshotCapturedAt    time.Time                               `json:"lockedSnapshotCapturedAt"`
	LockedSnapshotRecordCount   int                                     `json:"lockedSnapshotRecordCount"`
	OfficialUniverseRecordCount int                                     `json:"officialUniverseRecordCount"`
	SchemeCount                 int                                     `json:"schemeCount"`
	HotspotCount                int                                     `json:"hotspotCount"`
	SourceScreenshotCount       int                                     `json:"sourceScreenshotCount"`
	CoordinateSystem            string                                  `json:"coordinateSystem"`
	ImagePathPrefix             string                                  `json:"imagePathPrefix"`
	BlockEntranceMapping        *map[string][]string                    `json:"blockEntranceMapping"`
	ExpectedUniverseManifest    *floorSchemeExpectedUniverseManifestRef `json:"expectedUniverseManifest"`
	CompanionEvidence           *floorSchemeExpectedUniverseManifestRef `json:"companionEvidence"`
}

type floorSchemeExpectedUniverseManifestRef struct {
	Path       string `json:"path"`
	ByteSHA256 string `json:"byteSha256"`
}

type floorSchemeExpectedUniverseManifest struct {
	SchemaVersion           int                                     `json:"schemaVersion"`
	ProjectSlug             string                                  `json:"projectSlug"`
	SourceObservedAt        time.Time                               `json:"sourceObservedAt"`
	SchemeCount             int                                     `json:"schemeCount"`
	UnitCount               int                                     `json:"unitCount"`
	LockedSnapshotUnitCount int                                     `json:"lockedSnapshotUnitCount"`
	CompanionUnitCount      int                                     `json:"companionUnitCount"`
	Assignments             []floorSchemeExpectedUniverseAssignment `json:"assignments"`
}

type floorSchemeExpectedUniverseAssignment struct {
	Entrance   string  `json:"entrance"`
	Floor      int     `json:"floor"`
	UnitNumber string  `json:"unitNumber"`
	UnitKey    *string `json:"unitKey"`
	Evidence   string  `json:"evidence"`
}

type floorScheme struct {
	Entrance         string                      `json:"entrance"`
	Floor            int                         `json:"floor"`
	ImageURL         string                      `json:"imageUrl"`
	ImageSHA256      string                      `json:"imageSha256"`
	ImageBytes       int64                       `json:"imageBytes"`
	Width            int                         `json:"width"`
	Height           int                         `json:"height"`
	Zones            []floorSchemeZone           `json:"zones"`
	SourceScreenshot floorSchemeSourceScreenshot `json:"sourceScreenshot"`
}

type floorSchemeSourceScreenshot struct {
	Path      string                    `json:"path"`
	SHA256    string                    `json:"sha256"`
	Bytes     int64                     `json:"bytes"`
	Width     int                       `json:"width"`
	Height    int                       `json:"height"`
	MediaType string                    `json:"mediaType"`
	Canvas    floorSchemeImageRectangle `json:"canvas"`
	TightCrop floorSchemeTightCrop      `json:"tightCrop"`
}

type floorSchemeTightCrop struct {
	X                   int                       `json:"x"`
	Y                   int                       `json:"y"`
	Width               int                       `json:"width"`
	Height              int                       `json:"height"`
	Padding             int                       `json:"padding"`
	Detector            string                    `json:"detector"`
	ForegroundThreshold int                       `json:"foregroundThreshold"`
	ComponentPixelCount int                       `json:"componentPixelCount"`
	ComponentBounds     floorSchemeImageRectangle `json:"componentBounds"`
	DetectionHeight     int                       `json:"detectionHeight"`
}

type floorSchemeImageRectangle struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type floorSchemeZone struct {
	UnitKey    *string          `json:"unitKey"`
	UnitNumber string           `json:"unitNumber"`
	Points     string           `json:"points"`
	Label      floorSchemeLabel `json:"label"`
}

type floorSchemeLabel struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

func loadAndApplyFloorSchemeMapping(snapshotPath string, result *NormalizedSnapshot) error {
	mappingPath := filepath.Join(filepath.Dir(snapshotPath), "mappings", result.House.ProjectSlug+"-floor-schemes.json")
	mappingBody, err := os.ReadFile(mappingPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read KAYAN floor-scheme mapping %s: %w", mappingPath, err)
	}

	mapping, err := decodeFloorSchemeMapping(mappingBody)
	if err != nil {
		return fmt.Errorf("decode KAYAN floor-scheme mapping %s: %w", mappingPath, err)
	}
	if err := validateRawFloorSchemeScreenshots(mappingPath, mapping); err != nil {
		return fmt.Errorf("validate KAYAN floor-scheme source screenshots %s: %w", mappingPath, err)
	}
	companionEvidence, err := loadFloorSchemeCompanionEvidence(mappingPath, mapping, result)
	if err != nil {
		return fmt.Errorf("load KAYAN floor-scheme companion evidence %s: %w", mappingPath, err)
	}
	mapping.CompanionEvidence = companionEvidence
	expectedUniverse, err := loadFloorSchemeExpectedUniverse(mappingPath, mapping, result)
	if err != nil {
		return fmt.Errorf("load KAYAN floor-scheme expected universe %s: %w", mappingPath, err)
	}
	mapping.ExpectedUniverse = expectedUniverse

	audit, schemes, err := applyFloorSchemeMapping(result, mapping)
	if err != nil {
		return fmt.Errorf("apply KAYAN floor-scheme mapping %s: %w", mappingPath, err)
	}
	mappingHash := sha256.Sum256(mappingBody)
	audit.Path = mappingPath
	audit.Checksum = hex.EncodeToString(mappingHash[:])
	result.FloorSchemeAudit = &audit
	result.FloorSchemes = schemes

	// Extend the already combined inventory/unit-plan checksum without changing
	// the authoritative inventory capturedAt.
	previousHash, err := hex.DecodeString(result.Snapshot.Checksum)
	if err != nil {
		return fmt.Errorf("decode current KAYAN snapshot checksum: %w", err)
	}
	combined := sha256.New()
	_, _ = combined.Write(previousHash)
	_, _ = combined.Write([]byte{0})
	_, _ = combined.Write(mappingBody)
	result.Snapshot.Checksum = hex.EncodeToString(combined.Sum(nil))
	return nil
}

func validateRawFloorSchemeScreenshots(mappingPath string, mapping floorSchemeMapping) error {
	if len(mapping.Schemes) == 0 {
		return nil
	}
	absoluteMappingPath, err := filepath.Abs(mappingPath)
	if err != nil {
		return fmt.Errorf("resolve mapping path: %w", err)
	}
	backendRoot := filepath.Clean(filepath.Join(filepath.Dir(absoluteMappingPath), "..", "..", "..", ".."))
	workspaceRoot := filepath.Dir(backendRoot)
	wantPrefix := filepath.ToSlash(filepath.Join("backend", "data", "raw", "kayan", "mappings", "floor-schemes", "mirador", "2026-08-31")) + "/"
	seenPaths := make(map[string]struct{}, len(mapping.Schemes))
	seenHashes := make(map[string]struct{}, len(mapping.Schemes))
	for index, scheme := range mapping.Schemes {
		source := scheme.SourceScreenshot
		if filepath.IsAbs(source.Path) || filepath.Clean(source.Path) != source.Path || !strings.HasPrefix(filepath.ToSlash(source.Path), wantPrefix) || !strings.HasSuffix(source.Path, ".png") {
			return fmt.Errorf("scheme %d source screenshot path %q is outside the captured repository directory", index+1, source.Path)
		}
		if _, duplicate := seenPaths[source.Path]; duplicate {
			return fmt.Errorf("scheme %d repeats source screenshot path %q", index+1, source.Path)
		}
		seenPaths[source.Path] = struct{}{}
		if validateLowerSHA256(source.SHA256) != nil || source.Bytes < 1024 || source.Bytes > maxFloorSchemeImageBytes || source.MediaType != "image/jpeg" || source.Width != 1661 || source.Height != 811 {
			return fmt.Errorf("scheme %d source screenshot metadata is invalid", index+1)
		}
		if _, duplicate := seenHashes[source.SHA256]; duplicate {
			return fmt.Errorf("scheme %d repeats source screenshot SHA-256", index+1)
		}
		seenHashes[source.SHA256] = struct{}{}
		if source.Canvas != (floorSchemeImageRectangle{X: 160, Y: 257, Width: 1501, Height: 439}) {
			return fmt.Errorf("scheme %d official canvas metadata is invalid", index+1)
		}
		crop := source.TightCrop
		if crop.X < 0 || crop.Y < 0 || crop.Width != scheme.Width || crop.Height != scheme.Height || crop.Padding != 24 || crop.Detector != "largest-8-connected-nonwhite-component-v1" || crop.ForegroundThreshold != 8 || crop.ComponentPixelCount <= 0 || crop.DetectionHeight < source.Canvas.Height || crop.DetectionHeight > source.Height-source.Canvas.Y || crop.X+crop.Width > source.Canvas.Width || crop.Y+crop.Height > crop.DetectionHeight {
			return fmt.Errorf("scheme %d tight-crop metadata is invalid", index+1)
		}
		bounds := crop.ComponentBounds
		if bounds.Width <= 0 || bounds.Height <= 0 || bounds.X < crop.X || bounds.Y < crop.Y || bounds.X+bounds.Width > crop.X+crop.Width || bounds.Y+bounds.Height > crop.Y+crop.Height {
			return fmt.Errorf("scheme %d connected-component bounds are outside the tight crop", index+1)
		}
		assetPath := filepath.Join(workspaceRoot, filepath.FromSlash(source.Path))
		body, err := os.ReadFile(assetPath)
		if err != nil {
			return fmt.Errorf("scheme %d read source screenshot: %w", index+1, err)
		}
		if int64(len(body)) != source.Bytes {
			return fmt.Errorf("scheme %d source screenshot byte count does not match", index+1)
		}
		digest := sha256.Sum256(body)
		if hex.EncodeToString(digest[:]) != source.SHA256 {
			return fmt.Errorf("scheme %d source screenshot SHA-256 does not match", index+1)
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(body))
		if err != nil || format != "jpeg" || config.Width != source.Width || config.Height != source.Height {
			return fmt.Errorf("scheme %d source screenshot bytes/dimensions/media type do not match metadata", index+1)
		}
	}
	return nil
}

const miradorFloorSchemeCompanionSource = "mirador-plans-public-dom-v1"
const miradorFloorSchemeCompanionSHA256 = "e1dd3c6fc098f960d578e96c4520962bc4c3dbd0b0325ccfb75495c9966ddc98"

var miradorFloorSchemeCompanionUnits = []string{"44", "45", "47", "48", "49", "114", "115", "116", "118", "119"}

func loadFloorSchemeCompanionEvidence(mappingPath string, mapping floorSchemeMapping, result *NormalizedSnapshot) (*NormalizedFloorSchemeCompanionEvidence, error) {
	ref := mapping.Validation.CompanionEvidence
	if ref == nil {
		return nil, nil
	}
	if ref.Path == "" || filepath.IsAbs(ref.Path) || filepath.Clean(ref.Path) != ref.Path || !strings.HasPrefix(filepath.ToSlash(ref.Path), "expected/") || !strings.HasSuffix(ref.Path, ".tsv") {
		return nil, fmt.Errorf("companion-evidence path %q is not a safe expected/*.tsv companion", ref.Path)
	}
	if err := validateLowerSHA256(ref.ByteSHA256); err != nil {
		return nil, errors.New("companion-evidence byteSha256 is invalid")
	}
	body, err := os.ReadFile(filepath.Join(filepath.Dir(mappingPath), ref.Path))
	if err != nil {
		return nil, err
	}
	if len(body) == 0 || len(body) > 64<<10 || body[len(body)-1] != '\n' || bytes.Contains(body, []byte{'\r'}) {
		return nil, errors.New("companion-evidence TSV bytes are invalid")
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != ref.ByteSHA256 {
		return nil, errors.New("companion-evidence TSV byte checksum mismatch")
	}

	planPath := filepath.Join(filepath.Dir(mappingPath), result.House.ProjectSlug+"-plans.json")
	planBody, err := os.ReadFile(planPath)
	if err != nil {
		return nil, fmt.Errorf("read official public plan companion: %w", err)
	}
	var plans planMapping
	if err := json.Unmarshal(planBody, &plans); err != nil {
		return nil, fmt.Errorf("decode official public plan companion: %w", err)
	}
	if plans.ProjectSlug != mapping.ProjectSlug || plans.CapturedAt.IsZero() || plans.CapturedAt.After(mapping.Source.ObservedAt) {
		return nil, errors.New("companion-evidence plan provenance does not match the floor capture")
	}
	associations := make(map[string]planAssociation, len(miradorFloorSchemeCompanionUnits))
	for _, association := range plans.Associations {
		if !association.ExpectedSnapshotMatch {
			associations[association.Number] = association
		}
	}

	lines := strings.Split(strings.TrimSuffix(string(body), "\n"), "\n")
	if len(lines) != len(miradorFloorSchemeCompanionUnits) {
		return nil, fmt.Errorf("companion-evidence has %d records, want %d", len(lines), len(miradorFloorSchemeCompanionUnits))
	}
	unitNumbers := make([]string, 0, len(lines))
	for index, line := range lines {
		fields := strings.Split(line, "\t")
		if len(fields) != 5 || fields[0] != miradorFloorSchemeCompanionUnits[index] {
			return nil, fmt.Errorf("companion-evidence row %d is malformed or out of canonical numeric order", index+1)
		}
		floor, floorErr := strconv.Atoi(fields[2])
		area, areaErr := strconv.ParseFloat(fields[3], 64)
		rooms, roomsErr := strconv.Atoi(fields[4])
		association, found := associations[fields[0]]
		if floorErr != nil || areaErr != nil || roomsErr != nil || !found || association.Entrance != fields[1] || association.Floor != floor || association.Area != area || association.Rooms != rooms || strings.TrimSpace(association.UnmatchedReason) == "" {
			return nil, fmt.Errorf("companion-evidence row %d does not match one official unmatched public-plan association", index+1)
		}
		if _, _, present := officialMiradorUnitLocation(fields[0]); !present {
			return nil, fmt.Errorf("companion-evidence row %d apartment %q is outside the official floor universe", index+1, fields[0])
		}
		unitNumbers = append(unitNumbers, fields[0])
	}
	if result.PlanMapping == nil || result.PlanMapping.Rejected != len(unitNumbers) || !equalStrings(result.PlanMapping.UnmatchedNumbers, unitNumbers) {
		return nil, errors.New("companion-evidence rows do not exactly equal the audited public-plan unmatched set")
	}
	return &NormalizedFloorSchemeCompanionEvidence{
		Source: miradorFloorSchemeCompanionSource, SourceObservedAt: plans.CapturedAt,
		RecordCount: len(unitNumbers), UnitNumbers: unitNumbers, RecordsSHA256: ref.ByteSHA256,
	}, nil
}

func validateLowerSHA256(value string) error {
	decoded, err := hex.DecodeString(value)
	if err != nil || len(decoded) != sha256.Size || value != strings.ToLower(value) {
		return errors.New("invalid lowercase SHA-256")
	}
	return nil
}

func loadFloorSchemeExpectedUniverse(mappingPath string, mapping floorSchemeMapping, result *NormalizedSnapshot) (*NormalizedFloorSchemeExpectedUniverse, error) {
	ref := mapping.Validation.ExpectedUniverseManifest
	if ref == nil {
		return nil, nil
	}
	if ref.Path == "" || filepath.IsAbs(ref.Path) || filepath.Clean(ref.Path) != ref.Path || !strings.HasPrefix(filepath.ToSlash(ref.Path), "expected/") || !strings.HasSuffix(ref.Path, ".json") {
		return nil, fmt.Errorf("expected-universe path %q is not a safe expected/*.json companion", ref.Path)
	}
	decodedHash, err := hex.DecodeString(ref.ByteSHA256)
	if err != nil || len(decodedHash) != sha256.Size || ref.ByteSHA256 != strings.ToLower(ref.ByteSHA256) {
		return nil, errors.New("expected-universe byteSha256 is invalid")
	}
	manifestPath := filepath.Join(filepath.Dir(mappingPath), ref.Path)
	body, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, err
	}
	if len(body) == 0 || len(body) > 4<<20 {
		return nil, fmt.Errorf("expected-universe manifest size %d is invalid", len(body))
	}
	digest := sha256.Sum256(body)
	if hex.EncodeToString(digest[:]) != ref.ByteSHA256 {
		return nil, errors.New("expected-universe manifest byte checksum mismatch")
	}
	var manifest floorSchemeExpectedUniverseManifest
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return nil, err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return nil, err
	}
	if manifest.SchemaVersion != floorSchemeMappingSchemaVersion || manifest.ProjectSlug != mapping.ProjectSlug || !manifest.SourceObservedAt.Equal(mapping.Source.ObservedAt) {
		return nil, errors.New("expected-universe identity/provenance does not match the floor-scheme capture")
	}
	if manifest.UnitCount != len(manifest.Assignments) || manifest.UnitCount != 209 || manifest.LockedSnapshotUnitCount != 199 || manifest.CompanionUnitCount != 10 || manifest.LockedSnapshotUnitCount+manifest.CompanionUnitCount != manifest.UnitCount {
		return nil, errors.New("expected-universe unit count is invalid")
	}
	unitsByLocation := make(map[string][]NormalizedUnit, len(result.Units))
	for _, unit := range result.Units {
		if unit.PhaseSlug == result.House.PhaseSlug && unit.PropertyType == "apartment" {
			key := floorSchemeUnitKey(unit.Entrance, unit.Floor, unit.Number)
			unitsByLocation[key] = append(unitsByLocation[key], unit)
		}
	}
	normalized := &NormalizedFloorSchemeExpectedUniverse{
		SourceObservedAt: manifest.SourceObservedAt, ExpectedManifestByteSHA256: ref.ByteSHA256,
		SchemeCount: manifest.SchemeCount, UnitCount: manifest.UnitCount,
		LockedSnapshotUnitCount: manifest.LockedSnapshotUnitCount, CompanionUnitCount: manifest.CompanionUnitCount,
		Assignments: make([]NormalizedFloorSchemeExpectedAssignment, 0, len(manifest.Assignments)),
	}
	seenUnitNumbers := make(map[string]struct{}, manifest.UnitCount)
	seenSchemeKeys := make(map[string]struct{})
	for index, assignment := range manifest.Assignments {
		if assignment.Entrance == "" || assignment.Entrance != strings.TrimSpace(assignment.Entrance) || assignment.Floor <= 0 || assignment.UnitNumber == "" || assignment.UnitNumber != strings.TrimSpace(assignment.UnitNumber) {
			return nil, fmt.Errorf("expected-universe assignment %d is malformed", index+1)
		}
		wantEntrance, wantFloor, official := officialMiradorUnitLocation(assignment.UnitNumber)
		if !official || wantEntrance != assignment.Entrance || wantFloor != assignment.Floor {
			return nil, fmt.Errorf("expected-universe assignment %d is outside the official entrance/floor/unit universe", index+1)
		}
		matches := unitsByLocation[floorSchemeUnitKey(assignment.Entrance, assignment.Floor, assignment.UnitNumber)]
		unitKey := ""
		switch assignment.Evidence {
		case "locked-snapshot":
			if len(matches) != 1 || strings.TrimSpace(matches[0].SourceKey) == "" {
				return nil, fmt.Errorf("expected-universe assignment %d has %d strict locked-snapshot matches", index+1, len(matches))
			}
			unitKey = matches[0].SourceKey
			if assignment.UnitKey == nil || *assignment.UnitKey != unitKey {
				return nil, fmt.Errorf("expected-universe assignment %d sourceKey does not match its strict locked-snapshot tuple", index+1)
			}
		case "official-public-companion":
			if len(matches) != 0 || mapping.CompanionEvidence == nil || !containsString(mapping.CompanionEvidence.UnitNumbers, assignment.UnitNumber) {
				return nil, fmt.Errorf("expected-universe assignment %d is not one of the independently captured companion-only apartments", index+1)
			}
			if assignment.UnitKey != nil {
				return nil, fmt.Errorf("expected-universe assignment %d companion-only apartment must keep unitKey null", index+1)
			}
		default:
			return nil, fmt.Errorf("expected-universe assignment %d has unsupported evidence %q", index+1, assignment.Evidence)
		}
		if _, duplicate := seenUnitNumbers[assignment.UnitNumber]; duplicate {
			return nil, fmt.Errorf("expected-universe assignment %d repeats apartment %q", index+1, assignment.UnitNumber)
		}
		seenUnitNumbers[assignment.UnitNumber] = struct{}{}
		seenSchemeKeys[strings.Join([]string{assignment.Entrance, strconv.Itoa(assignment.Floor)}, "\x1f")] = struct{}{}
		normalized.Assignments = append(normalized.Assignments, NormalizedFloorSchemeExpectedAssignment{
			Entrance: assignment.Entrance, Floor: assignment.Floor,
			UnitNumber: assignment.UnitNumber, UnitSourceKey: unitKey, Evidence: assignment.Evidence,
		})
	}
	if manifest.SchemeCount != len(seenSchemeKeys) || manifest.SchemeCount <= 0 {
		return nil, errors.New("expected-universe scheme count does not match its assignment universe")
	}
	return normalized, nil
}

func containsString(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}

func stringReference(value string) *string {
	return &value
}

func decodeFloorSchemeMapping(mappingBody []byte) (floorSchemeMapping, error) {
	var mapping floorSchemeMapping
	decoder := json.NewDecoder(bytes.NewReader(mappingBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&mapping); err != nil {
		return floorSchemeMapping{}, err
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return floorSchemeMapping{}, err
	}
	return mapping, nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	err := decoder.Decode(&extra)
	if errors.Is(err, io.EOF) {
		return nil
	}
	if err == nil {
		return errors.New("multiple JSON values are not allowed")
	}
	return err
}

func applyFloorSchemeMapping(result *NormalizedSnapshot, mapping floorSchemeMapping) (FloorSchemeMappingAudit, []NormalizedFloorScheme, error) {
	if mapping.SchemaVersion != floorSchemeMappingSchemaVersion {
		return FloorSchemeMappingAudit{}, nil, fmt.Errorf("unsupported floor-scheme schema version %d", mapping.SchemaVersion)
	}
	if mapping.ProjectSlug != result.House.ProjectSlug {
		return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor-scheme project %q does not match snapshot project %q", mapping.ProjectSlug, result.House.ProjectSlug)
	}
	if err := validateFloorSchemeMetadata(result, mapping); err != nil {
		return FloorSchemeMappingAudit{}, nil, err
	}

	unitsByLocation := make(map[string][]NormalizedUnit, len(result.Units))
	for _, unit := range result.Units {
		if unit.PhaseSlug != result.House.PhaseSlug {
			continue
		}
		key := floorSchemeUnitKey(unit.Entrance, unit.Floor, unit.Number)
		unitsByLocation[key] = append(unitsByLocation[key], unit)
	}
	expectedByLocation := make(map[string]NormalizedFloorSchemeExpectedAssignment)
	if mapping.ExpectedUniverse != nil {
		for _, assignment := range mapping.ExpectedUniverse.Assignments {
			expectedByLocation[floorSchemeUnitKey(assignment.Entrance, assignment.Floor, assignment.UnitNumber)] = assignment
		}
	}

	schemes := make([]NormalizedFloorScheme, 0, len(mapping.Schemes))
	seenSchemes := make(map[string]struct{}, len(mapping.Schemes))
	seenUnitSourceKeys := make(map[string]struct{}, mapping.Validation.HotspotCount)
	seenUnitNumbers := make(map[string]struct{}, mapping.Validation.HotspotCount)
	hotspotCount := 0
	for schemeIndex, scheme := range mapping.Schemes {
		if err := validateFloorScheme(mapping, scheme); err != nil {
			return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d: %w", schemeIndex+1, err)
		}
		schemeKey := strings.Join([]string{scheme.Entrance, strconv.Itoa(scheme.Floor)}, "\x1f")
		if _, duplicate := seenSchemes[schemeKey]; duplicate {
			return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d duplicates entrance/floor %q", schemeIndex+1, schemeKey)
		}
		seenSchemes[schemeKey] = struct{}{}

		normalized := NormalizedFloorScheme{
			Entrance: scheme.Entrance, Floor: scheme.Floor,
			ImageURL: scheme.ImageURL, ImageSHA256: scheme.ImageSHA256, ImageBytes: scheme.ImageBytes,
			Width: scheme.Width, Height: scheme.Height, SourceScreenshotSHA256: scheme.SourceScreenshot.SHA256,
			SourceCrop: floorSchemeImageRectangle{
				X:     scheme.SourceScreenshot.Canvas.X + scheme.SourceScreenshot.TightCrop.X,
				Y:     scheme.SourceScreenshot.Canvas.Y + scheme.SourceScreenshot.TightCrop.Y,
				Width: scheme.SourceScreenshot.TightCrop.Width, Height: scheme.SourceScreenshot.TightCrop.Height,
			},
			Zones: make([]NormalizedFloorSchemeZone, 0, len(scheme.Zones)),
		}
		seenUnits := make(map[string]struct{}, len(scheme.Zones))
		for zoneIndex, zone := range scheme.Zones {
			if err := validateFloorSchemeZone(scheme, zone); err != nil {
				return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d: %w", schemeIndex+1, zoneIndex+1, err)
			}
			if _, duplicate := seenUnits[zone.UnitNumber]; duplicate {
				return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d duplicates apartment %q", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
			}
			seenUnits[zone.UnitNumber] = struct{}{}
			locationKey := floorSchemeUnitKey(scheme.Entrance, scheme.Floor, zone.UnitNumber)
			matches := unitsByLocation[locationKey]
			assignment, expected := expectedByLocation[locationKey]
			unitSourceKey := ""
			evidence := "locked-snapshot"
			if len(matches) == 1 {
				unitSourceKey = strings.TrimSpace(matches[0].SourceKey)
				if unitSourceKey == "" || unitSourceKey != matches[0].SourceKey {
					return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d apartment %q has no canonical locked-snapshot source key", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
				}
				if expected && (assignment.Evidence != evidence || assignment.UnitSourceKey != unitSourceKey) {
					return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d contradicts expected locked-snapshot identity", schemeIndex+1, zoneIndex+1)
				}
				if zone.UnitKey == nil || *zone.UnitKey != unitSourceKey {
					return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d sourceKey does not match its strict locked-snapshot tuple", schemeIndex+1, zoneIndex+1)
				}
				if _, duplicate := seenUnitSourceKeys[unitSourceKey]; duplicate {
					return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d duplicates canonical unit identity %q across the capture", schemeIndex+1, zoneIndex+1, unitSourceKey)
				}
				seenUnitSourceKeys[unitSourceKey] = struct{}{}
			} else if len(matches) == 0 && expected && assignment.Evidence == "official-public-companion" && assignment.UnitSourceKey == "" {
				evidence = assignment.Evidence
				if zone.UnitKey != nil {
					return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d companion-only apartment must keep unitKey null", schemeIndex+1, zoneIndex+1)
				}
			} else {
				return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d apartment %q has %d locked snapshot matches and no exact companion proof for entrance %q floor %d", schemeIndex+1, zoneIndex+1, zone.UnitNumber, len(matches), scheme.Entrance, scheme.Floor)
			}
			if _, duplicate := seenUnitNumbers[zone.UnitNumber]; duplicate {
				return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor scheme %d zone %d duplicates apartment %q across the capture", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
			}
			seenUnitNumbers[zone.UnitNumber] = struct{}{}
			normalized.Zones = append(normalized.Zones, NormalizedFloorSchemeZone{
				UnitSourceKey: unitSourceKey,
				UnitNumber:    zone.UnitNumber,
				Points:        zone.Points,
				LabelX:        zone.Label.X,
				LabelY:        zone.Label.Y,
				Evidence:      evidence,
			})
			hotspotCount++
		}
		schemes = append(schemes, normalized)
	}

	if hotspotCount != mapping.Validation.HotspotCount {
		return FloorSchemeMappingAudit{}, nil, fmt.Errorf("floor schemes contain %d hotspots, mapping declares %d", hotspotCount, mapping.Validation.HotspotCount)
	}
	if err := validateFloorSchemeCaptureCoverage(result, mapping, schemes, seenUnitSourceKeys, seenUnitNumbers); err != nil {
		return FloorSchemeMappingAudit{}, nil, err
	}
	blockEntranceMapping := map[string][]string(nil)
	if mapping.Validation.BlockEntranceMapping != nil {
		blockEntranceMapping = cloneBlockEntranceMapping(*mapping.Validation.BlockEntranceMapping)
	}
	audit := FloorSchemeMappingAudit{
		SchemaVersion:        mapping.SchemaVersion,
		ProjectSlug:          mapping.ProjectSlug,
		ObservedAt:           mapping.Source.ObservedAt,
		CapturedAt:           mapping.CapturedAt,
		CaptureStatus:        mapping.CaptureStatus,
		CaptureScope:         mapping.CaptureScope,
		SourceStatus:         mapping.Source.Status,
		BlockEntranceMapping: blockEntranceMapping,
		SchemeCount:          len(schemes),
		HotspotCount:         hotspotCount,
		ExpectedUniverse:     mapping.ExpectedUniverse,
		CompanionEvidence:    mapping.CompanionEvidence,
	}
	return audit, schemes, nil
}

func validateFloorSchemeMetadata(result *NormalizedSnapshot, mapping floorSchemeMapping) error {
	if mapping.Source.ObservedAt.IsZero() || strings.TrimSpace(mapping.Source.Method) == "" || strings.TrimSpace(mapping.Source.Note) == "" {
		return errors.New("floor-scheme source observation, method and note are required")
	}
	if mapping.Source.TenantOrigin != "https://pb21432.profitbase.ru" {
		return fmt.Errorf("floor-scheme tenant origin %q is not the official KAYAN tenant", mapping.Source.TenantOrigin)
	}
	wantHouseID, err := strconv.Atoi(result.House.SourceID)
	if err != nil || mapping.Source.HouseID != wantHouseID {
		return fmt.Errorf("floor-scheme houseId %d does not match snapshot house %q", mapping.Source.HouseID, result.House.SourceID)
	}
	if mapping.Source.AccountID != 21432 {
		return fmt.Errorf("floor-scheme accountId %d is not the KAYAN tenant", mapping.Source.AccountID)
	}
	wantRoutes := floorSchemeMappingSourceRoutes{
		Catalog: "/eco/catalog/house/154813/smallGrid?accountId=21432&context=agencyOffice",
		Floor:   "/api/v4/json/floor?houseId=154813",
		Board:   "/board?houseId=154813",
		Facade:  "/facade?houseId=154813",
	}
	if mapping.Source.Routes != wantRoutes {
		return fmt.Errorf("floor-scheme source routes do not match the verified Mirador routes")
	}
	if !mapping.Validation.LockedSnapshotCapturedAt.Equal(result.Snapshot.CapturedAt) {
		return fmt.Errorf("floor-scheme mapping locks snapshot %s, loaded snapshot is %s", mapping.Validation.LockedSnapshotCapturedAt, result.Snapshot.CapturedAt)
	}
	if mapping.Validation.LockedSnapshotRecordCount != len(result.Units) {
		return fmt.Errorf("floor-scheme mapping locks %d units, loaded snapshot has %d", mapping.Validation.LockedSnapshotRecordCount, len(result.Units))
	}
	if mapping.Validation.OfficialUniverseRecordCount != 209 {
		return fmt.Errorf("floor-scheme official universe count is %d, want 209", mapping.Validation.OfficialUniverseRecordCount)
	}
	if mapping.Validation.SchemeCount != len(mapping.Schemes) {
		return fmt.Errorf("floor-scheme mapping contains %d schemes, declares %d", len(mapping.Schemes), mapping.Validation.SchemeCount)
	}
	if mapping.Validation.SourceScreenshotCount != len(mapping.Schemes) {
		return fmt.Errorf("floor-scheme source screenshot count is %d, capture has %d", mapping.Validation.SourceScreenshotCount, len(mapping.Schemes))
	}
	if mapping.Validation.CoordinateSystem != "image-pixels" {
		return fmt.Errorf("unsupported floor-scheme coordinate system %q", mapping.Validation.CoordinateSystem)
	}
	if mapping.Validation.ImagePathPrefix != miradorFloorSchemeImagePrefix {
		return fmt.Errorf("floor-scheme image prefix %q is invalid", mapping.Validation.ImagePathPrefix)
	}

	if len(mapping.Schemes) == 0 {
		if mapping.CapturedAt != nil {
			return errors.New("empty floor-scheme artifact must have capturedAt=null")
		}
		if mapping.CaptureStatus != "blocked-by-authentication" || mapping.Source.Status != "blocked-by-authentication" {
			return fmt.Errorf("empty floor-scheme source status %q must be blocked-by-authentication", mapping.Source.Status)
		}
		if mapping.Validation.BlockEntranceMapping != nil {
			return errors.New("empty floor-scheme artifact must not assert a block-to-entrance mapping")
		}
		if mapping.Validation.CompanionEvidence != nil || mapping.CompanionEvidence != nil {
			return errors.New("empty floor-scheme artifact must not contain companion evidence")
		}
		if mapping.Validation.HotspotCount != 0 {
			return errors.New("empty floor-scheme artifact must declare zero hotspots")
		}
		return nil
	}

	if mapping.CapturedAt == nil || mapping.CapturedAt.Before(result.Snapshot.CapturedAt) {
		return errors.New("non-empty floor-scheme artifact needs capturedAt no older than the locked snapshot")
	}
	if mapping.Source.Status != "captured-read-only" {
		return fmt.Errorf("non-empty floor-scheme source status %q must be captured-read-only", mapping.Source.Status)
	}
	if mapping.Validation.BlockEntranceMapping != nil {
		return errors.New("block-to-entrance mapping must remain null because the official capture does not prove visual-block identity")
	}
	if mapping.CaptureStatus != "captured-complete" && mapping.CaptureStatus != "captured-partial" {
		return fmt.Errorf("non-empty floor-scheme capture status %q is invalid", mapping.CaptureStatus)
	}
	if mapping.CaptureStatus == "captured-partial" && mapping.ExpectedUniverse != nil {
		return errors.New("partial floor-scheme capture cannot contain an expected-universe manifest")
	}
	if mapping.CaptureStatus == "captured-complete" && mapping.ExpectedUniverse == nil {
		return errors.New("complete floor-scheme capture requires an expected-universe manifest")
	}
	if mapping.CaptureStatus == "captured-complete" && mapping.CompanionEvidence == nil {
		return errors.New("complete floor-scheme capture requires official public companion evidence for snapshot-missing apartments")
	}
	return nil
}

func validateFloorSchemeCaptureCoverage(result *NormalizedSnapshot, mapping floorSchemeMapping, schemes []NormalizedFloorScheme, seenUnitSourceKeys, seenUnitNumbers map[string]struct{}) error {
	scope := mapping.CaptureScope
	if scope.SchemeCount != len(schemes) || scope.SchemeCount != mapping.Validation.SchemeCount || scope.HotspotCount != mapping.Validation.HotspotCount {
		return fmt.Errorf("floor-scheme capture scope counts %d/%d do not match validation %d/%d", scope.SchemeCount, scope.HotspotCount, mapping.Validation.SchemeCount, mapping.Validation.HotspotCount)
	}
	for index, exclusion := range scope.AuditedExclusions {
		if strings.TrimSpace(exclusion.Kind) == "" || exclusion.Kind != strings.TrimSpace(exclusion.Kind) || strings.TrimSpace(exclusion.Reason) == "" || exclusion.Reason != strings.TrimSpace(exclusion.Reason) || strings.TrimSpace(exclusion.Evidence) == "" || exclusion.Evidence != strings.TrimSpace(exclusion.Evidence) {
			return fmt.Errorf("floor-scheme audited exclusion %d is incomplete", index+1)
		}
		if len(exclusion.Kind) > 80 || len(exclusion.Reason) > 160 || len(exclusion.Evidence) > 1000 || strings.ContainsAny(exclusion.Kind+exclusion.Reason+exclusion.Evidence, "\x00\r\n") {
			return fmt.Errorf("floor-scheme audited exclusion %d is unsafe", index+1)
		}
	}
	if len(schemes) == 0 {
		if mapping.CaptureStatus != "blocked-by-authentication" || scope.Mode != "blocked" {
			return errors.New("empty floor-scheme artifact must use blocked capture status/scope")
		}
		if len(scope.DeclaredBlocks) != 0 || len(scope.DeclaredEntrances) != 0 || len(scope.DeclaredFloors) != 0 || len(scope.DeclaredUnitHotspots) != 0 || scope.HotspotCount != 0 {
			return errors.New("blocked floor-scheme scope must declare empty captured sets")
		}
		if len(scope.AuditedExclusions) == 0 {
			return errors.New("blocked floor-scheme scope needs an audited exclusion")
		}
		return nil
	}

	if mapping.CaptureStatus == "captured-complete" {
		if scope.Mode != "complete" || len(scope.AuditedExclusions) != 0 {
			return errors.New("complete floor-scheme capture cannot contain audited exclusions")
		}
	} else if mapping.CaptureStatus == "captured-partial" {
		if scope.Mode != "partial" || len(scope.AuditedExclusions) == 0 {
			return errors.New("partial floor-scheme capture needs audited exclusions")
		}
	} else {
		return fmt.Errorf("unsupported floor-scheme capture status %q", mapping.CaptureStatus)
	}

	entrances := make(map[string]struct{})
	floors := make([]floorSchemeScopeFloor, 0, len(schemes))
	hotspots := make([]floorSchemeScopeUnitHotspot, 0, scope.HotspotCount)
	for _, scheme := range schemes {
		entrances[scheme.Entrance] = struct{}{}
		floors = append(floors, floorSchemeScopeFloor{Entrance: scheme.Entrance, Floor: scheme.Floor})
		for _, zone := range scheme.Zones {
			hotspots = append(hotspots, floorSchemeScopeUnitHotspot{Entrance: scheme.Entrance, Floor: scheme.Floor, UnitNumber: zone.UnitNumber})
		}
	}
	actualEntrances := make([]string, 0, len(entrances))
	for entrance := range entrances {
		actualEntrances = append(actualEntrances, entrance)
	}
	sort.Strings(actualEntrances)
	sort.Slice(floors, func(left, right int) bool {
		if floors[left].Entrance != floors[right].Entrance {
			return floors[left].Entrance < floors[right].Entrance
		}
		return floors[left].Floor < floors[right].Floor
	})
	sort.Slice(hotspots, func(left, right int) bool {
		if hotspots[left].Entrance != hotspots[right].Entrance {
			return hotspots[left].Entrance < hotspots[right].Entrance
		}
		if hotspots[left].Floor != hotspots[right].Floor {
			return hotspots[left].Floor < hotspots[right].Floor
		}
		return compareUnitNumbers(hotspots[left].UnitNumber, hotspots[right].UnitNumber) < 0
	})
	if mapping.CaptureStatus == "captured-complete" {
		if len(scope.DeclaredBlocks) != 0 {
			return errors.New("complete floor-scheme capture must keep visual blocks outside the block-independent CRM scheme artifact")
		}
		if err := validateCompleteExpectedUniverse(result, mapping, schemes, seenUnitSourceKeys, seenUnitNumbers); err != nil {
			return err
		}
	}
	if !equalStrings(scope.DeclaredEntrances, actualEntrances) || !equalScopeFloors(scope.DeclaredFloors, floors) || !equalScopeHotspots(scope.DeclaredUnitHotspots, hotspots) {
		return errors.New("floor-scheme declared capture sets do not exactly cover the normalized schemes/hotspots")
	}
	return nil
}

func compareUnitNumbers(left, right string) int {
	leftNumber, leftErr := strconv.Atoi(left)
	rightNumber, rightErr := strconv.Atoi(right)
	if leftErr == nil && rightErr == nil && leftNumber != rightNumber {
		if leftNumber < rightNumber {
			return -1
		}
		return 1
	}
	return strings.Compare(left, right)
}

func validateCompleteExpectedUniverse(result *NormalizedSnapshot, mapping floorSchemeMapping, schemes []NormalizedFloorScheme, seenUnitSourceKeys, seenUnitNumbers map[string]struct{}) error {
	expected := mapping.ExpectedUniverse
	if expected == nil {
		return errors.New("complete floor-scheme capture requires an independently checksummed expected-universe manifest")
	}
	if !expected.SourceObservedAt.Equal(mapping.Source.ObservedAt) || validateLowerSHA256(expected.ExpectedManifestByteSHA256) != nil || expected.SchemeCount != 34 || expected.UnitCount != 209 || expected.LockedSnapshotUnitCount != 199 || expected.CompanionUnitCount != 10 || expected.LockedSnapshotUnitCount+expected.CompanionUnitCount != expected.UnitCount || expected.UnitCount != len(expected.Assignments) {
		return errors.New("complete floor-scheme expected-universe provenance/counts are invalid")
	}
	companion := mapping.CompanionEvidence
	if companion == nil || companion.Source != miradorFloorSchemeCompanionSource || companion.SourceObservedAt.IsZero() || companion.SourceObservedAt.After(mapping.Source.ObservedAt) || companion.RecordCount != len(miradorFloorSchemeCompanionUnits) || !equalStrings(companion.UnitNumbers, miradorFloorSchemeCompanionUnits) || companion.RecordsSHA256 != miradorFloorSchemeCompanionSHA256 {
		return errors.New("complete floor-scheme companion evidence is invalid")
	}

	eligibleBySourceKey := make(map[string]NormalizedUnit)
	eligibleByNumber := make(map[string]NormalizedUnit)
	for _, unit := range result.Units {
		if unit.PhaseSlug == result.House.PhaseSlug && unit.PropertyType == "apartment" {
			wantEntrance, wantFloor, official := officialMiradorUnitLocation(unit.Number)
			if !official || wantEntrance != unit.Entrance || wantFloor != unit.Floor || strings.TrimSpace(unit.SourceKey) == "" {
				return fmt.Errorf("locked snapshot apartment %q is outside the official floor universe", unit.Number)
			}
			if _, duplicate := eligibleBySourceKey[unit.SourceKey]; duplicate {
				return fmt.Errorf("locked snapshot repeats canonical unitKey %q", unit.SourceKey)
			}
			if _, duplicate := eligibleByNumber[unit.Number]; duplicate {
				return fmt.Errorf("locked snapshot repeats apartment number %q", unit.Number)
			}
			eligibleBySourceKey[unit.SourceKey] = unit
			eligibleByNumber[unit.Number] = unit
		}
	}
	if len(eligibleBySourceKey) != 199 {
		return fmt.Errorf("floor capture is locked to 199 snapshot apartments plus 10 companion records, snapshot has %d eligible apartments", len(eligibleBySourceKey))
	}
	expectedUnitKeys := make(map[string]struct{}, len(expected.Assignments))
	expectedUnitNumbers := make(map[string]struct{}, len(expected.Assignments))
	expectedAssignmentKeys := make(map[string]struct{}, len(expected.Assignments))
	expectedSchemeKeys := make(map[string]struct{})
	for index, assignment := range expected.Assignments {
		wantEntrance, wantFloor, official := officialMiradorUnitLocation(assignment.UnitNumber)
		if !official || assignment.Entrance != wantEntrance || assignment.Floor != wantFloor {
			return fmt.Errorf("expected-universe assignment %d is outside the exact 1..209 official universe", index+1)
		}
		if _, duplicate := expectedUnitNumbers[assignment.UnitNumber]; duplicate {
			return fmt.Errorf("expected-universe assignment %d duplicates apartment %q", index+1, assignment.UnitNumber)
		}
		expectedUnitNumbers[assignment.UnitNumber] = struct{}{}
		switch assignment.Evidence {
		case "locked-snapshot":
			unit, matched := eligibleBySourceKey[assignment.UnitSourceKey]
			if !matched || unit.Entrance != assignment.Entrance || unit.Floor != assignment.Floor || unit.Number != assignment.UnitNumber || containsString(companion.UnitNumbers, assignment.UnitNumber) {
				return fmt.Errorf("expected-universe assignment %d does not strictly match one locked-snapshot apartment", index+1)
			}
			if _, duplicate := expectedUnitKeys[assignment.UnitSourceKey]; duplicate {
				return fmt.Errorf("expected-universe assignment %d duplicates unitKey %q", index+1, assignment.UnitSourceKey)
			}
			expectedUnitKeys[assignment.UnitSourceKey] = struct{}{}
		case "official-public-companion":
			if assignment.UnitSourceKey != "" || !containsString(companion.UnitNumbers, assignment.UnitNumber) {
				return fmt.Errorf("expected-universe assignment %d has unsupported companion identity", index+1)
			}
			if _, exists := eligibleByNumber[assignment.UnitNumber]; exists {
				return fmt.Errorf("expected-universe assignment %d companion unit unexpectedly exists in the locked snapshot", index+1)
			}
		default:
			return fmt.Errorf("expected-universe assignment %d has unsupported evidence %q", index+1, assignment.Evidence)
		}
		expectedAssignmentKeys[floorSchemeAssignmentKey(assignment.Entrance, assignment.Floor, assignment.UnitNumber, assignment.UnitSourceKey, assignment.Evidence)] = struct{}{}
		expectedSchemeKeys[strings.Join([]string{assignment.Entrance, strconv.Itoa(assignment.Floor)}, "\x1f")] = struct{}{}
	}
	if len(expectedUnitKeys) != len(eligibleBySourceKey) || len(seenUnitSourceKeys) != len(eligibleBySourceKey) {
		return fmt.Errorf("complete floor-scheme expected/payload units %d/%d do not cover %d eligible locked-snapshot apartments", len(expectedUnitKeys), len(seenUnitSourceKeys), len(eligibleBySourceKey))
	}
	if len(expectedUnitNumbers) != 209 || len(seenUnitNumbers) != 209 {
		return fmt.Errorf("complete floor-scheme expected/payload unit numbers %d/%d do not cover official apartments 1..209", len(expectedUnitNumbers), len(seenUnitNumbers))
	}
	for number := 1; number <= 209; number++ {
		key := strconv.Itoa(number)
		if _, present := expectedUnitNumbers[key]; !present {
			return fmt.Errorf("expected-universe is missing official apartment %q", key)
		}
		if _, present := seenUnitNumbers[key]; !present {
			return fmt.Errorf("floor-scheme payload is missing official apartment %q", key)
		}
	}
	for unitKey := range eligibleBySourceKey {
		if _, present := expectedUnitKeys[unitKey]; !present {
			return fmt.Errorf("expected-universe is missing eligible apartment %q", unitKey)
		}
		if _, present := seenUnitSourceKeys[unitKey]; !present {
			return fmt.Errorf("floor-scheme payload is missing eligible apartment %q", unitKey)
		}
	}
	actualAssignmentKeys := make(map[string]struct{}, len(seenUnitNumbers))
	actualSchemeKeys := make(map[string]struct{}, len(schemes))
	for _, scheme := range schemes {
		schemeKey := strings.Join([]string{scheme.Entrance, strconv.Itoa(scheme.Floor)}, "\x1f")
		actualSchemeKeys[schemeKey] = struct{}{}
		for _, zone := range scheme.Zones {
			actualAssignmentKeys[floorSchemeAssignmentKey(scheme.Entrance, scheme.Floor, zone.UnitNumber, zone.UnitSourceKey, zone.Evidence)] = struct{}{}
		}
	}
	if expected.SchemeCount != len(expectedSchemeKeys) || len(actualSchemeKeys) != len(expectedSchemeKeys) || len(actualAssignmentKeys) != len(expectedAssignmentKeys) {
		return errors.New("complete floor-scheme scheme/unit universe counts differ from the expected manifest")
	}
	for key := range expectedSchemeKeys {
		if _, present := actualSchemeKeys[key]; !present {
			return fmt.Errorf("floor-scheme payload is missing expected scheme %q", key)
		}
	}
	for key := range expectedAssignmentKeys {
		if _, present := actualAssignmentKeys[key]; !present {
			return errors.New("floor-scheme payload does not exactly match expected unit assignments")
		}
	}
	return nil
}

func floorSchemeAssignmentKey(entrance string, floor int, unitNumber, unitKey, evidence string) string {
	return strings.Join([]string{entrance, strconv.Itoa(floor), unitNumber, unitKey, evidence}, "\x1f")
}

func officialMiradorUnitLocation(unitNumber string) (string, int, bool) {
	number, err := strconv.Atoi(unitNumber)
	if err != nil || strconv.Itoa(number) != unitNumber || number < 1 || number > 209 {
		return "", 0, false
	}
	switch {
	case number <= 49:
		return "1", 2 + (number-1)/7, true
	case number <= 53:
		return "2", 2, true
	case number <= 119:
		return "2", 3 + (number-54)/6, true
	default:
		return "3", 2 + (number-120)/6, true
	}
}

func equalScopeFloors(left, right []floorSchemeScopeFloor) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func equalScopeHotspots(left, right []floorSchemeScopeUnitHotspot) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func cloneBlockEntranceMapping(source map[string][]string) map[string][]string {
	if source == nil {
		return nil
	}
	result := make(map[string][]string, len(source))
	for block, entrances := range source {
		result[block] = append([]string(nil), entrances...)
	}
	return result
}

func validateBlockEntranceMapping(mapping map[string][]string) error {
	for block, entrances := range mapping {
		blockNumber, err := strconv.Atoi(block)
		if err != nil || blockNumber < 1 || blockNumber > 7 {
			return fmt.Errorf("block-to-entrance mapping has invalid block %q", block)
		}
		if len(entrances) == 0 {
			return fmt.Errorf("block-to-entrance mapping block %s has no entrances", block)
		}
		seen := make(map[string]struct{}, len(entrances))
		for _, entrance := range entrances {
			if strings.TrimSpace(entrance) == "" || entrance != strings.TrimSpace(entrance) {
				return fmt.Errorf("block-to-entrance mapping block %s has invalid entrance %q", block, entrance)
			}
			if _, duplicate := seen[entrance]; duplicate {
				return fmt.Errorf("block-to-entrance mapping block %s repeats entrance %q", block, entrance)
			}
			seen[entrance] = struct{}{}
		}
	}
	return nil
}

func validateFloorScheme(mapping floorSchemeMapping, scheme floorScheme) error {
	if scheme.Entrance == "" || scheme.Entrance != strings.TrimSpace(scheme.Entrance) {
		return fmt.Errorf("entrance %q is invalid", scheme.Entrance)
	}
	if scheme.Floor <= 0 {
		return fmt.Errorf("floor %d must be positive", scheme.Floor)
	}
	if scheme.Width <= 0 || scheme.Height <= 0 || scheme.Width > maxFloorSchemeImageDimension || scheme.Height > maxFloorSchemeImageDimension || scheme.Width*scheme.Height > maxFloorSchemeImagePixels {
		return fmt.Errorf("image dimensions %dx%d are invalid", scheme.Width, scheme.Height)
	}
	if scheme.ImageBytes < 1024 || scheme.ImageBytes > maxFloorSchemeImageBytes {
		return fmt.Errorf("image byte size %d is outside the safe range", scheme.ImageBytes)
	}
	decodedHash, err := hex.DecodeString(scheme.ImageSHA256)
	if err != nil || len(decodedHash) != sha256.Size || scheme.ImageSHA256 != strings.ToLower(scheme.ImageSHA256) {
		return fmt.Errorf("image SHA-256 %q is invalid", scheme.ImageSHA256)
	}
	if len(scheme.Zones) == 0 {
		return errors.New("an official floor scheme needs at least one apartment hotspot")
	}
	if err := validateLocalFloorSchemeURL(mapping.Validation.ImagePathPrefix, scheme.ImageURL); err != nil {
		return err
	}
	if !officialMiradorScheme(scheme.Entrance, scheme.Floor) {
		return fmt.Errorf("entrance %q floor %d is outside the official 34-scheme universe", scheme.Entrance, scheme.Floor)
	}
	return nil
}

func officialMiradorScheme(entrance string, floor int) bool {
	switch entrance {
	case "1":
		return floor >= 2 && floor <= 8
	case "2":
		return floor >= 2 && floor <= 13
	case "3":
		return floor >= 2 && floor <= 16
	default:
		return false
	}
}

func validateLocalFloorSchemeURL(prefix, value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.IsAbs() || parsed.Host != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != value {
		return fmt.Errorf("floor-scheme image URL %q must be a local public path", value)
	}
	if !strings.HasPrefix(value, prefix) || !strings.HasSuffix(value, ".webp") || pathpkg.Clean(value) != value || strings.ContainsAny(value, "\\%") {
		return fmt.Errorf("floor-scheme image URL %q is outside %q or malformed", value, prefix)
	}
	relativePath := strings.TrimPrefix(value, prefix)
	if pathpkg.Base(value) == ".webp" || relativePath == "" || strings.Contains(relativePath, "//") {
		return fmt.Errorf("floor-scheme image URL %q has no filename", value)
	}
	for _, character := range strings.TrimSuffix(relativePath, ".webp") {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '/' || character == '_' || character == '-' {
			continue
		}
		return fmt.Errorf("floor-scheme image URL %q contains unsupported characters", value)
	}
	return nil
}

func validateFloorSchemeZone(scheme floorScheme, zone floorSchemeZone) error {
	if zone.UnitNumber == "" || zone.UnitNumber != strings.TrimSpace(zone.UnitNumber) {
		return fmt.Errorf("unitNumber %q is invalid", zone.UnitNumber)
	}
	if err := validateFloorSchemePolygon(zone.Points, scheme.Width, scheme.Height); err != nil {
		return err
	}
	if !finiteCoordinate(zone.Label.X, float64(scheme.Width)) || !finiteCoordinate(zone.Label.Y, float64(scheme.Height)) {
		return fmt.Errorf("label (%v,%v) is outside %dx%d", zone.Label.X, zone.Label.Y, scheme.Width, scheme.Height)
	}
	return nil
}

func validateFloorSchemePolygon(value string, width, height int) error {
	if value == "" || value != strings.TrimSpace(value) {
		return errors.New("polygon points are empty or not canonical")
	}
	pairs := strings.Fields(value)
	if len(pairs) < 3 || strings.Join(pairs, " ") != value {
		return errors.New("polygon points need at least three canonical x,y pairs")
	}
	type point struct{ x, y float64 }
	points := make([]point, 0, len(pairs))
	unique := make(map[string]struct{}, len(pairs))
	for _, pair := range pairs {
		coordinates := strings.Split(pair, ",")
		if len(coordinates) != 2 || coordinates[0] == "" || coordinates[1] == "" {
			return fmt.Errorf("polygon pair %q is malformed", pair)
		}
		x, errX := strconv.ParseFloat(coordinates[0], 64)
		y, errY := strconv.ParseFloat(coordinates[1], 64)
		if errX != nil || errY != nil || !finiteCoordinate(x, float64(width)) || !finiteCoordinate(y, float64(height)) {
			return fmt.Errorf("polygon pair %q is outside %dx%d or non-numeric", pair, width, height)
		}
		points = append(points, point{x: x, y: y})
		unique[pair] = struct{}{}
	}
	if len(unique) < 3 {
		return errors.New("polygon needs at least three distinct points")
	}
	area := 0.0
	for index, current := range points {
		next := points[(index+1)%len(points)]
		area += current.x*next.y - next.x*current.y
	}
	if math.Abs(area) < 0.000001 {
		return errors.New("polygon has zero area")
	}
	return nil
}

func finiteCoordinate(value, maximum float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= maximum
}

func floorSchemeUnitKey(entrance string, floor int, number string) string {
	return strings.Join([]string{entrance, strconv.Itoa(floor), number}, "\x1f")
}

func equalInts(left, right []int) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
