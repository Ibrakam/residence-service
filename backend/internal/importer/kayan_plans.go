package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	pathpkg "path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const planMappingSchemaVersion = 1

var strictPlanMatchFields = []string{"projectName", "number", "entrance", "floor", "area", "rooms"}

// PlanMappingAudit records what a companion mapping proved without changing the
// authoritative inventory timestamp, prices, or statuses in the raw snapshot.
type PlanMappingAudit struct {
	Path                       string
	Checksum                   string
	CapturedAt                 time.Time
	SourceURL                  string
	CaptureCount               int
	StrictMatches              int
	Rejected                   int
	UniqueCapturedImages       int
	RepresentativeLayouts      int
	UniqueRepresentativeImages int
	FloorSchemes               int
	UnmatchedNumbers           []string
}

type planMapping struct {
	SchemaVersion         int                         `json:"schemaVersion"`
	ProjectSlug           string                      `json:"projectSlug"`
	CapturedAt            time.Time                   `json:"capturedAt"`
	Source                planMappingSource           `json:"source"`
	Validation            planMappingValidation       `json:"validation"`
	ProjectImage          planMappingProjectImage     `json:"projectImage"`
	Associations          []planAssociation           `json:"associations"`
	RepresentativeLayouts []representativePlanMapping `json:"representativeLayouts"`
}

type planMappingSource struct {
	URL            string `json:"url"`
	Method         string `json:"method"`
	ListingCount   int    `json:"listingCount"`
	PageSize       int    `json:"pageSize"`
	PagesObserved  int    `json:"pagesObserved"`
	FinalPageItems int    `json:"finalPageItems"`
	Scope          string `json:"scope"`
}

type planMappingValidation struct {
	SnapshotRecordCount        int                `json:"snapshotRecordCount"`
	CaptureCount               int                `json:"captureCount"`
	StrictMatchCount           int                `json:"strictMatchCount"`
	UnmatchedCount             int                `json:"unmatchedCount"`
	UniqueCapturedImages       int                `json:"uniqueCapturedImages"`
	RepresentativeLayoutCount  int                `json:"representativeLayoutCount"`
	UniqueRepresentativeImages int                `json:"uniqueRepresentativeImages"`
	FloorSchemeCount           int                `json:"floorSchemeCount"`
	BlockEntranceMapping       *map[string]string `json:"blockEntranceMapping"`
	StrictMatchFields          []string           `json:"strictMatchFields"`
	AssociationsSHA256         string             `json:"associationsSha256"`
}

type planMappingProjectImage struct {
	SourceImageURL string `json:"sourceImageUrl"`
	LocalImageURL  string `json:"localImageUrl"`
	Note           string `json:"note"`
}

type planAssociation struct {
	Number                string  `json:"number"`
	Entrance              string  `json:"entrance"`
	Floor                 int     `json:"floor"`
	Area                  float64 `json:"area"`
	Rooms                 int     `json:"rooms"`
	ProjectName           string  `json:"projectName"`
	SourceImageURL        string  `json:"sourceImageUrl"`
	LocalImageURL         string  `json:"localImageUrl"`
	ExpectedSnapshotMatch bool    `json:"expectedSnapshotMatch"`
	UnmatchedReason       string  `json:"unmatchedReason,omitempty"`
}

type representativePlanMapping struct {
	SourceID           string `json:"sourceId"`
	Rooms              *int   `json:"rooms"`
	SourceImageURL     string `json:"sourceImageUrl"`
	SourceThumbnailURL string `json:"sourceThumbnailUrl"`
	LocalImageURL      string `json:"localImageUrl"`
}

func loadAndApplyPlanMapping(snapshotPath string, snapshotBody []byte, result *NormalizedSnapshot) error {
	mappingPath := filepath.Join(filepath.Dir(snapshotPath), "mappings", result.House.ProjectSlug+"-plans.json")
	mappingBody, err := os.ReadFile(mappingPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read KAYAN plan mapping %s: %w", mappingPath, err)
	}

	var mapping planMapping
	if err := json.Unmarshal(mappingBody, &mapping); err != nil {
		return fmt.Errorf("decode KAYAN plan mapping %s: %w", mappingPath, err)
	}
	audit, err := applyPlanMapping(result, mapping)
	if err != nil {
		return fmt.Errorf("apply KAYAN plan mapping %s: %w", mappingPath, err)
	}
	mappingHash := sha256.Sum256(mappingBody)
	audit.Path = mappingPath
	audit.Checksum = hex.EncodeToString(mappingHash[:])
	result.PlanMapping = &audit

	// The database source snapshot checksum covers both the inventory and its
	// verified plan companion. The inventory capturedAt intentionally remains the
	// older full-snapshot timestamp because the companion is a partial overlay.
	combined := sha256.New()
	_, _ = combined.Write(snapshotBody)
	_, _ = combined.Write([]byte{0})
	_, _ = combined.Write(mappingBody)
	result.Snapshot.Checksum = hex.EncodeToString(combined.Sum(nil))
	return nil
}

func applyPlanMapping(result *NormalizedSnapshot, mapping planMapping) (PlanMappingAudit, error) {
	if mapping.SchemaVersion != planMappingSchemaVersion {
		return PlanMappingAudit{}, fmt.Errorf("unsupported plan mapping schema version %d", mapping.SchemaVersion)
	}
	if mapping.ProjectSlug != result.House.ProjectSlug {
		return PlanMappingAudit{}, fmt.Errorf("mapping project %q does not match snapshot project %q", mapping.ProjectSlug, result.House.ProjectSlug)
	}
	if mapping.CapturedAt.IsZero() || mapping.CapturedAt.Before(result.Snapshot.CapturedAt) {
		return PlanMappingAudit{}, errors.New("mapping capturedAt must be present and no older than the full snapshot")
	}
	if err := validatePlanMappingMetadata(result, mapping); err != nil {
		return PlanMappingAudit{}, err
	}

	audit := PlanMappingAudit{
		CapturedAt:                 mapping.CapturedAt,
		SourceURL:                  mapping.Source.URL,
		CaptureCount:               len(mapping.Associations),
		UniqueCapturedImages:       uniqueAssociationImages(mapping.Associations),
		RepresentativeLayouts:      len(mapping.RepresentativeLayouts),
		UniqueRepresentativeImages: uniqueRepresentativeImages(mapping.RepresentativeLayouts),
		FloorSchemes:               mapping.Validation.FloorSchemeCount,
	}

	unitMatches := make(map[string][]*NormalizedUnit, len(result.Units))
	for index := range result.Units {
		unit := &result.Units[index]
		if unit.Rooms == nil {
			continue
		}
		key := planTupleKey(unit.ProjectName, unit.Number, unit.Entrance, unit.Floor, unit.Area, *unit.Rooms)
		unitMatches[key] = append(unitMatches[key], unit)
	}
	seenAssociations := make(map[string]struct{}, len(mapping.Associations))
	for index, association := range mapping.Associations {
		if err := validateAssociation(mapping.ProjectSlug, association); err != nil {
			return PlanMappingAudit{}, fmt.Errorf("association %d: %w", index+1, err)
		}
		key := planTupleKey(association.ProjectName, association.Number, association.Entrance, association.Floor, association.Area, association.Rooms)
		if _, duplicate := seenAssociations[key]; duplicate {
			return PlanMappingAudit{}, fmt.Errorf("association %d duplicates strict tuple %q", index+1, key)
		}
		seenAssociations[key] = struct{}{}
		matches := unitMatches[key]
		if len(matches) > 1 {
			return PlanMappingAudit{}, fmt.Errorf("association %d has %d strict snapshot matches", index+1, len(matches))
		}
		matched := len(matches) == 1
		if matched != association.ExpectedSnapshotMatch {
			return PlanMappingAudit{}, fmt.Errorf("association %d expectedSnapshotMatch=%t but strict match=%t", index+1, association.ExpectedSnapshotMatch, matched)
		}
		if matched {
			matches[0].PlanImageURL = association.LocalImageURL
			audit.StrictMatches++
			continue
		}
		if strings.TrimSpace(association.UnmatchedReason) == "" {
			return PlanMappingAudit{}, fmt.Errorf("association %d is unmatched without evidence reason", index+1)
		}
		audit.Rejected++
		audit.UnmatchedNumbers = append(audit.UnmatchedNumbers, association.Number)
	}

	if audit.StrictMatches != mapping.Validation.StrictMatchCount || audit.Rejected != mapping.Validation.UnmatchedCount {
		return PlanMappingAudit{}, fmt.Errorf("strict result %d matched/%d unmatched does not match declared %d/%d", audit.StrictMatches, audit.Rejected, mapping.Validation.StrictMatchCount, mapping.Validation.UnmatchedCount)
	}
	if err := applyRepresentativePlanMapping(result, mapping); err != nil {
		return PlanMappingAudit{}, err
	}
	if err := applyProjectImageMapping(result, mapping); err != nil {
		return PlanMappingAudit{}, err
	}
	if err := ensureMiradorImagesAreLocal(result); err != nil {
		return PlanMappingAudit{}, err
	}
	return audit, nil
}

func validatePlanMappingMetadata(result *NormalizedSnapshot, mapping planMapping) error {
	if len(result.Units) != mapping.Validation.SnapshotRecordCount {
		return fmt.Errorf("snapshot has %d units, mapping requires %d", len(result.Units), mapping.Validation.SnapshotRecordCount)
	}
	if len(mapping.Associations) != mapping.Source.ListingCount || len(mapping.Associations) != mapping.Validation.CaptureCount {
		return fmt.Errorf("capture has %d associations but source/validation declare %d/%d", len(mapping.Associations), mapping.Source.ListingCount, mapping.Validation.CaptureCount)
	}
	if mapping.Source.PageSize <= 0 || mapping.Source.PagesObserved <= 0 || mapping.Source.FinalPageItems <= 0 || mapping.Source.FinalPageItems >= mapping.Source.PageSize {
		return errors.New("capture pagination evidence is invalid")
	}
	if (mapping.Source.PagesObserved-1)*mapping.Source.PageSize+mapping.Source.FinalPageItems != len(mapping.Associations) {
		return errors.New("capture pagination does not reproduce the association count")
	}
	if strings.TrimSpace(mapping.Source.Method) == "" || strings.TrimSpace(mapping.Source.Scope) == "" {
		return errors.New("capture method and scope are required")
	}
	parsedSource, err := url.Parse(mapping.Source.URL)
	if err != nil || parsedSource.Scheme != "https" || parsedSource.Hostname() != "kayan.uz" {
		return fmt.Errorf("mapping source URL %q is not the official KAYAN host", mapping.Source.URL)
	}
	if !equalStrings(mapping.Validation.StrictMatchFields, strictPlanMatchFields) {
		return fmt.Errorf("strict match fields are %v, want %v", mapping.Validation.StrictMatchFields, strictPlanMatchFields)
	}
	if mapping.Validation.BlockEntranceMapping != nil {
		return errors.New("block-to-entrance mapping must remain null until an official source proves it")
	}
	if mapping.Validation.FloorSchemeCount != 0 {
		return errors.New("apartment presets must not be represented as floor schemes")
	}
	if len(mapping.Associations) != mapping.Validation.StrictMatchCount+mapping.Validation.UnmatchedCount {
		return errors.New("declared strict and unmatched counts do not cover the capture")
	}
	if unique := uniqueAssociationImages(mapping.Associations); unique != mapping.Validation.UniqueCapturedImages {
		return fmt.Errorf("capture has %d unique images, mapping declares %d", unique, mapping.Validation.UniqueCapturedImages)
	}
	if len(mapping.RepresentativeLayouts) != mapping.Validation.RepresentativeLayoutCount {
		return fmt.Errorf("mapping has %d representative layouts, declares %d", len(mapping.RepresentativeLayouts), mapping.Validation.RepresentativeLayoutCount)
	}
	if unique := uniqueRepresentativeImages(mapping.RepresentativeLayouts); unique != mapping.Validation.UniqueRepresentativeImages {
		return fmt.Errorf("mapping has %d unique representative images, declares %d", unique, mapping.Validation.UniqueRepresentativeImages)
	}
	if checksum := associationChecksum(mapping.Associations); checksum != mapping.Validation.AssociationsSHA256 {
		return fmt.Errorf("association checksum %s does not match %s", checksum, mapping.Validation.AssociationsSHA256)
	}
	return nil
}

func validateAssociation(projectSlug string, association planAssociation) error {
	if association.ProjectName == "" || association.Number == "" || association.Entrance == "" || association.Floor <= 0 || association.Area <= 0 || association.Rooms <= 0 {
		return errors.New("strict tuple is incomplete")
	}
	if err := validateSourcePlanURL(association.SourceImageURL); err != nil {
		return err
	}
	if err := validateDeterministicLocalPlanURL(projectSlug, "exact", association.SourceImageURL, association.LocalImageURL); err != nil {
		return err
	}
	return nil
}

func applyRepresentativePlanMapping(result *NormalizedSnapshot, mapping planMapping) error {
	byKey := make(map[string][]representativePlanMapping, len(mapping.RepresentativeLayouts))
	for index, item := range mapping.RepresentativeLayouts {
		if item.SourceID == "" {
			return fmt.Errorf("representative layout %d has no sourceId", index+1)
		}
		if err := validateSourcePlanURL(item.SourceImageURL); err != nil {
			return fmt.Errorf("representative layout %d: %w", index+1, err)
		}
		if err := validateDeterministicLocalPlanURL(mapping.ProjectSlug, "representative", item.SourceImageURL, item.LocalImageURL); err != nil {
			return fmt.Errorf("representative layout %d: %w", index+1, err)
		}
		if item.SourceThumbnailURL == "" {
			return fmt.Errorf("representative layout %d has no source thumbnail provenance", index+1)
		}
		key := item.SourceID + "\x1f" + item.SourceImageURL
		byKey[key] = append(byKey[key], item)
	}
	used := make(map[string]struct{}, len(result.Layouts))
	for index := range result.Layouts {
		layout := &result.Layouts[index]
		key := layout.SourceID + "\x1f" + layout.ImageURL
		matches := byKey[key]
		if len(matches) != 1 {
			return fmt.Errorf("layout %s has %d representative mapping matches", layout.SourceID, len(matches))
		}
		match := matches[0]
		if !equalOptionalInt(layout.Rooms, match.Rooms) {
			return fmt.Errorf("layout %s rooms do not match representative mapping", layout.SourceID)
		}
		if layout.ThumbnailURL != match.SourceThumbnailURL {
			return fmt.Errorf("layout %s thumbnail provenance does not match", layout.SourceID)
		}
		if _, duplicate := used[key]; duplicate {
			return fmt.Errorf("layout %s mapping was used more than once", layout.SourceID)
		}
		used[key] = struct{}{}
		layout.ImageURL = match.LocalImageURL
		layout.ThumbnailURL = match.LocalImageURL
	}
	if len(used) != len(mapping.RepresentativeLayouts) {
		return fmt.Errorf("used %d of %d representative mappings", len(used), len(mapping.RepresentativeLayouts))
	}
	return nil
}

func applyProjectImageMapping(result *NormalizedSnapshot, mapping planMapping) error {
	if mapping.ProjectImage.SourceImageURL == "" || mapping.ProjectImage.LocalImageURL == "" || strings.TrimSpace(mapping.ProjectImage.Note) == "" {
		return errors.New("project image mapping is incomplete")
	}
	if result.ImageURL != mapping.ProjectImage.SourceImageURL {
		return fmt.Errorf("project image source %q does not match snapshot %q", mapping.ProjectImage.SourceImageURL, result.ImageURL)
	}
	wantPrefix := "/kayan/" + mapping.ProjectSlug + "/"
	if !strings.HasPrefix(mapping.ProjectImage.LocalImageURL, wantPrefix) || strings.Contains(mapping.ProjectImage.LocalImageURL, "://") {
		return fmt.Errorf("project image local URL %q is invalid", mapping.ProjectImage.LocalImageURL)
	}
	result.ImageURL = mapping.ProjectImage.LocalImageURL
	return nil
}

func validateSourcePlanURL(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "pb21432.profitbase.ru" || !strings.HasPrefix(parsed.Path, "/uploads/preset/21432/") {
		return fmt.Errorf("source plan URL %q is not an official KAYAN Profitbase preset", value)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("source plan URL %q must not contain query or fragment", value)
	}
	return nil
}

func validateDeterministicLocalPlanURL(projectSlug, kind, sourceURL, localURL string) error {
	parsed, _ := url.Parse(sourceURL)
	filename := pathpkg.Base(parsed.Path)
	stem := strings.TrimSuffix(filename, pathpkg.Ext(filename))
	want := "/kayan/" + projectSlug + "/plans/" + kind + "/" + stem + ".webp"
	if localURL != want {
		return fmt.Errorf("local plan URL %q is not deterministic, want %q", localURL, want)
	}
	return nil
}

func ensureMiradorImagesAreLocal(result *NormalizedSnapshot) error {
	if result.House.ProjectSlug != "mirador" {
		return nil
	}
	if isProfitbaseURL(result.ImageURL) {
		return errors.New("Mirador project image still points to Profitbase")
	}
	for _, unit := range result.Units {
		if isProfitbaseURL(unit.PlanImageURL) {
			return fmt.Errorf("Mirador unit %s plan still points to Profitbase", unit.Number)
		}
	}
	for _, layout := range result.Layouts {
		if isProfitbaseURL(layout.ImageURL) || isProfitbaseURL(layout.ThumbnailURL) {
			return fmt.Errorf("Mirador layout %s still points to Profitbase", layout.SourceID)
		}
	}
	return nil
}

func planTupleKey(projectName, number, entrance string, floor int, area float64, rooms int) string {
	return strings.Join([]string{
		strings.TrimSpace(projectName), strings.TrimSpace(number), strings.TrimSpace(entrance),
		strconv.Itoa(floor), strconv.FormatFloat(area, 'f', -1, 64), strconv.Itoa(rooms),
	}, "\x1f")
}

func associationChecksum(items []planAssociation) string {
	lines := make([]string, 0, len(items))
	for _, item := range items {
		lines = append(lines, strings.Join([]string{
			item.ProjectName, item.Number, item.Entrance, strconv.Itoa(item.Floor),
			strconv.FormatFloat(item.Area, 'f', -1, 64), strconv.Itoa(item.Rooms),
			item.SourceImageURL, item.LocalImageURL, strconv.FormatBool(item.ExpectedSnapshotMatch),
		}, "\t"))
	}
	hash := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(hash[:])
}

func uniqueAssociationImages(items []planAssociation) int {
	values := make(map[string]struct{}, len(items))
	for _, item := range items {
		values[item.SourceImageURL] = struct{}{}
	}
	return len(values)
}

func uniqueRepresentativeImages(items []representativePlanMapping) int {
	values := make(map[string]struct{}, len(items))
	for _, item := range items {
		values[item.SourceImageURL] = struct{}{}
	}
	return len(values)
}

func equalStrings(left, right []string) bool {
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

func equalOptionalInt(left, right *int) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func isProfitbaseURL(value string) bool {
	return strings.Contains(strings.ToLower(value), "profitbase.ru")
}
