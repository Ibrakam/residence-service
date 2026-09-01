package importer

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const CatalogSource = "versioned-website-catalog"

type CatalogBundle struct {
	Path       string
	Checksum   string
	SchemaName string
	SourceURL  string
	CapturedAt time.Time
	Metadata   json.RawMessage
	Projects   []CatalogProject
}

type CatalogProject struct {
	DeveloperSlug  string
	DeveloperName  string
	Slug           string
	Name           string
	SourceID       string
	SourceURL      string
	SourcePayload  json.RawMessage
	CapturedAt     time.Time
	Complete       bool
	OfficialCount  *int
	Phases         []CatalogPhase
	Units          []NormalizedUnit
	Layouts        []NormalizedLayout
	DuplicateUnits int
}

type CatalogPhase struct {
	SourceID      string
	Slug          string
	Name          string
	PropertyType  string
	SortOrder     int
	Address       string
	ImageURL      string
	FloorsTotal   int
	SourceURL     string
	SourcePayload json.RawMessage
}

type CatalogAudit struct {
	Files                int                   `json:"files"`
	Projects             int                   `json:"projects"`
	Records              int                   `json:"records"`
	CompleteRecords      int                   `json:"completeRecords"`
	PartialRecords       int                   `json:"partialRecords"`
	DuplicatesSkipped    int                   `json:"duplicatesSkipped"`
	OfficialRecordsKnown int                   `json:"officialRecordsKnown"`
	Items                []CatalogAuditProject `json:"items"`
	FloorSchemeArtifacts int                   `json:"floorSchemeArtifacts"`
	FloorSchemes         int                   `json:"floorSchemes"`
	FloorSchemeHotspots  int                   `json:"floorSchemeHotspots"`
}

type CatalogAuditProject struct {
	File          string `json:"file"`
	ProjectSlug   string `json:"projectSlug"`
	ProjectName   string `json:"projectName"`
	Schema        string `json:"schema"`
	Records       int    `json:"records"`
	OfficialCount *int   `json:"officialCount,omitempty"`
	Complete      bool   `json:"complete"`
	Phases        int    `json:"phases"`
	Layouts       int    `json:"layouts"`
}

func DiscoverCatalogFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read catalog directory %s: %w", dir, err)
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if name == "avalon-units.json" || strings.HasSuffix(name, "-catalog.json") || strings.HasSuffix(name, "-client.json") {
			paths = append(paths, filepath.Join(dir, name))
		}
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		return nil, fmt.Errorf("no versioned catalog snapshots found in %s", dir)
	}
	return paths, nil
}

func LoadCatalogDirectory(dir string) ([]CatalogBundle, error) {
	paths, err := DiscoverCatalogFiles(dir)
	if err != nil {
		return nil, err
	}
	bundles := make([]CatalogBundle, 0, len(paths))
	for _, path := range paths {
		bundle, err := LoadCatalogFile(path)
		if err != nil {
			return nil, err
		}
		bundles = append(bundles, bundle)
	}
	return bundles, nil
}

func LoadCatalogFile(path string) (CatalogBundle, error) {
	body, err := os.ReadFile(path)
	if err != nil {
		return CatalogBundle{}, fmt.Errorf("read catalog %s: %w", path, err)
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(body, &root); err != nil {
		return CatalogBundle{}, fmt.Errorf("decode catalog %s: %w", path, err)
	}
	hash := sha256.Sum256(body)
	bundle := CatalogBundle{
		Path:       path,
		Checksum:   hex.EncodeToString(hash[:]),
		SchemaName: catalogSchemaName(filepath.Base(path), root),
		SourceURL:  sourceURL(root),
		Metadata:   catalogMetadata(root),
	}
	bundle.CapturedAt, err = catalogCapturedAt(root)
	if err != nil {
		return CatalogBundle{}, fmt.Errorf("catalog %s: %w", path, err)
	}

	if rawProjects, ok := root["projects"]; ok {
		var projects []json.RawMessage
		if err := json.Unmarshal(rawProjects, &projects); err != nil {
			return CatalogBundle{}, fmt.Errorf("catalog %s projects: %w", path, err)
		}
		for index, rawProject := range projects {
			var node map[string]json.RawMessage
			if err := json.Unmarshal(rawProject, &node); err != nil {
				return CatalogBundle{}, fmt.Errorf("catalog %s project %d: %w", path, index+1, err)
			}
			project, err := normalizeCatalogProject(filepath.Base(path), root, node, bundle.CapturedAt, bundle.SourceURL)
			if err != nil {
				return CatalogBundle{}, fmt.Errorf("catalog %s project %d: %w", path, index+1, err)
			}
			bundle.Projects = append(bundle.Projects, project)
		}
	} else {
		project, err := normalizeCatalogProject(filepath.Base(path), root, root, bundle.CapturedAt, bundle.SourceURL)
		if err != nil {
			return CatalogBundle{}, fmt.Errorf("catalog %s: %w", path, err)
		}
		bundle.Projects = append(bundle.Projects, project)
	}
	if len(bundle.Projects) == 0 {
		return CatalogBundle{}, errors.New("catalog has no projects")
	}
	return bundle, nil
}

func AuditCatalogDirectory(dir string) (CatalogAudit, error) {
	bundles, err := LoadCatalogDirectory(dir)
	if err != nil {
		return CatalogAudit{}, err
	}
	floorArtifacts, err := LoadGeneratedFloorSchemeArtifacts(dir, bundles)
	if err != nil {
		return CatalogAudit{}, err
	}
	audit := CatalogAudit{Files: len(bundles), Items: make([]CatalogAuditProject, 0)}
	audit.FloorSchemeArtifacts = len(floorArtifacts)
	for _, artifact := range floorArtifacts {
		audit.FloorSchemes += artifact.FloorSchemeCount
		audit.FloorSchemeHotspots += artifact.HotspotCount
	}
	for _, bundle := range bundles {
		for _, project := range bundle.Projects {
			records := len(project.Units)
			audit.Projects++
			audit.Records += records
			audit.DuplicatesSkipped += project.DuplicateUnits
			if project.Complete {
				audit.CompleteRecords += records
			} else {
				audit.PartialRecords += records
			}
			if project.OfficialCount != nil {
				audit.OfficialRecordsKnown += *project.OfficialCount
			}
			audit.Items = append(audit.Items, CatalogAuditProject{
				File: filepath.Base(bundle.Path), ProjectSlug: project.Slug, ProjectName: project.Name,
				Schema: bundle.SchemaName, Records: records, OfficialCount: project.OfficialCount,
				Complete: project.Complete, Phases: len(project.Phases), Layouts: len(project.Layouts),
			})
		}
	}
	return audit, nil
}

func normalizeCatalogProject(filename string, root, node map[string]json.RawMessage, capturedAt time.Time, fallbackSource string) (CatalogProject, error) {
	projectMeta := node
	if raw, ok := node["project"]; ok && rawObject(raw) != nil {
		projectMeta = rawObject(raw)
	}
	projectCapturedAt, err := catalogProjectCapturedAt(projectMeta, capturedAt)
	if err != nil {
		return CatalogProject{}, err
	}

	slug := firstString(node, "projectSlug")
	if slug == "" {
		slug = firstString(projectMeta, "slug")
	}
	if slug == "" {
		slug = projectSlugFromFilename(filename)
	}
	name := firstString(projectMeta, "name")
	if name == "" {
		name = rawString(node["project"])
	}
	if name == "" {
		name = projectName(slug)
	}
	developerSlug, developerName := catalogDeveloper(slug, projectMeta)
	source := sourceURL(node)
	if source == "" {
		source = fallbackSource
	}
	project := CatalogProject{
		DeveloperSlug: developerSlug, DeveloperName: developerName,
		Slug: slug, Name: name, SourceURL: source, CapturedAt: projectCapturedAt,
		SourcePayload: catalogMetadata(node),
		Complete:      filename == "avalon-units.json" || !strings.HasSuffix(filename, "-client.json"),
	}
	project.SourceID = firstString(node, "realEstateUUID", "sourceProjectUuid", "projectId", "houseId")
	if project.SourceID == "" {
		project.SourceID = firstString(projectMeta, "realEstateUUID", "sourceId", "id")
	}

	var unitRows []json.RawMessage
	if err := json.Unmarshal(node["units"], &unitRows); err != nil {
		return CatalogProject{}, fmt.Errorf("decode units: %w", err)
	}
	if len(unitRows) == 0 {
		return CatalogProject{}, errors.New("project has no units")
	}
	project.OfficialCount = officialCount(node, projectMeta)
	if project.OfficialCount != nil {
		project.Complete = *project.OfficialCount == len(unitRows)
	}

	phaseDefinitions := phaseDefinitions(projectMeta)
	phaseByKey := make(map[string]*CatalogPhase)
	phaseSlugOwner := make(map[string]string)
	seenUnits := make(map[string]string, len(unitRows))
	for index, rawUnit := range unitRows {
		var values map[string]json.RawMessage
		if err := json.Unmarshal(rawUnit, &values); err != nil {
			return CatalogProject{}, fmt.Errorf("unit %d: %w", index+1, err)
		}
		phase := catalogPhase(values, phaseDefinitions, source)
		phaseKey := phase.SourceID
		if phaseKey == "" {
			phaseKey = phase.Slug
		}
		if owner, exists := phaseSlugOwner[phase.Slug]; exists && owner != phaseKey {
			phase.Slug += "-" + opaqueSuffix(phaseKey, 8)
		}
		phaseSlugOwner[phase.Slug] = phaseKey
		storedPhase, exists := phaseByKey[phaseKey]
		if !exists {
			copy := phase
			storedPhase = &copy
			phaseByKey[phaseKey] = storedPhase
		}
		unit, err := normalizeCatalogUnit(project.Slug, storedPhase.Slug, rawUnit, values)
		if err != nil {
			return CatalogProject{}, fmt.Errorf("unit %d: %w", index+1, err)
		}
		if existing, duplicate := seenUnits[unit.SourceKey]; duplicate {
			if existing == string(unit.SourcePayload) {
				project.DuplicateUnits++
				continue
			}
			return CatalogProject{}, fmt.Errorf("unit %d: conflicting duplicate identity %q", index+1, unit.SourceKey)
		}
		seenUnits[unit.SourceKey] = string(unit.SourcePayload)
		if floorTotal := firstInt(values, "totalFloors", "maxFloor"); floorTotal > storedPhase.FloorsTotal {
			storedPhase.FloorsTotal = floorTotal
		}
		if unit.Floor > storedPhase.FloorsTotal {
			storedPhase.FloorsTotal = unit.Floor
		}
		if storedPhase.Address == "" {
			storedPhase.Address = firstString(values, "rawAddress", "addressRaw", "address")
		}
		project.Units = append(project.Units, unit)
	}

	project.Phases = make([]CatalogPhase, 0, len(phaseByKey))
	for _, phase := range phaseByKey {
		project.Phases = append(project.Phases, *phase)
	}
	sort.Slice(project.Phases, func(i, j int) bool {
		if project.Phases[i].SortOrder != project.Phases[j].SortOrder {
			return project.Phases[i].SortOrder < project.Phases[j].SortOrder
		}
		return project.Phases[i].Slug < project.Phases[j].Slug
	})
	for index := range project.Phases {
		if project.Phases[index].SortOrder == 0 {
			project.Phases[index].SortOrder = (index + 1) * 10
		}
	}
	project.Layouts = catalogLayouts(node)
	return project, nil
}

func normalizeCatalogUnit(projectSlug, phaseSlug string, raw json.RawMessage, values map[string]json.RawMessage) (NormalizedUnit, error) {
	sourceID := firstString(values, "id", "sourceId", "uuid")
	if sourceID == "" {
		return NormalizedUnit{}, errors.New("official unit id is required")
	}
	number := firstString(values, "number", "title")
	if number == "" {
		return NormalizedUnit{}, fmt.Errorf("unit %s has no number", sourceID)
	}
	area := firstFloat(values, "area")
	if area <= 0 {
		return NormalizedUnit{}, fmt.Errorf("unit %s has invalid area", sourceID)
	}
	floor := firstInt(values, "floor")
	rooms, hasRooms := optionalInt(values, "rooms")
	price, hasPrice := optionalInt64(values, "price", "effectivePrice")
	pricePerM2, hasPricePerM2 := optionalFloat(values, "pricePerM2", "currentPricePerM2")
	if !hasPricePerM2 && hasPrice && area > 0 {
		value := float64(price) / area
		pricePerM2 = value
		hasPricePerM2 = true
	}
	rawStatus := firstString(values, "rawStatus", "statusOriginal", "sourceStatus", "status")
	status := normalizeCatalogStatus(firstString(values, "status"), rawStatus, optionalBoolDefault(values, true, "isSale"))
	propertyType := normalizePropertyType(firstString(values, "rawPropertyType", "propertyType"))
	if propertyType == "other" {
		propertyType = "apartment"
	}
	sourceKey := firstString(values, "sourceKey")
	if sourceKey == "" {
		sourceKey = "catalog:" + projectSlug + ":" + phaseSlug + ":" + opaqueSuffix(sourceID, 20)
	}
	unit := NormalizedUnit{
		SourceID: sourceID, PhaseSlug: phaseSlug, SourceKey: sourceKey, PropertyType: propertyType,
		RawPropertyType: firstString(values, "rawPropertyType", "propertyType"),
		Status:          status, RawStatus: rawStatus, Number: number,
		Entrance: firstString(values, "entrance", "section"), Floor: floor,
		HouseName: firstString(values, "building", "buildingDisplay", "block", "blockName", "phaseName", "phase"),
		Area:      area, Currency: firstString(values, "currency"),
		PlanImageURL:  firstString(values, "planImageUrl", "plan", "planUrl", "thumbnail", "planPublicPath", "primaryPlanPath", "planSource"),
		SourcePayload: append(json.RawMessage(nil), raw...),
	}
	if unit.RawPropertyType == "" {
		unit.RawPropertyType = "Квартира"
	}
	if unit.Currency == "" {
		unit.Currency = "UZS"
	}
	if hasRooms {
		unit.Rooms = &rooms
	}
	if hasPrice {
		unit.Price = &price
	}
	if hasPricePerM2 {
		unit.PricePerM2 = &pricePerM2
	}
	return unit, nil
}

func catalogPhase(unit map[string]json.RawMessage, definitions map[string]CatalogPhase, sourceURL string) CatalogPhase {
	explicitSlug := firstString(unit, "phaseSlug")
	if explicitSlug != "" {
		if phase, ok := definitions[explicitSlug]; ok {
			return phase
		}
	}
	name := firstString(unit, "phaseName", "phase", "block", "buildingDisplay", "building")
	if name == "" {
		if queue := firstString(unit, "queue"); queue != "" {
			name = "Queue " + queue
		}
	}
	if name == "" {
		name = "Main"
	}
	sourceID := firstString(unit, "buildingId", "blockId", "houseId")
	if sourceID == "" {
		sourceID = explicitSlug
	}
	if sourceID == "" {
		sourceID = name
	}
	slug := explicitSlug
	if slug == "" {
		slug = slugify(name)
	}
	return CatalogPhase{
		SourceID: sourceID, Slug: slug, Name: name, PropertyType: "apartment",
		SourceURL: sourceURL, SourcePayload: json.RawMessage(`{}`),
	}
}

func phaseDefinitions(project map[string]json.RawMessage) map[string]CatalogPhase {
	result := make(map[string]CatalogPhase)
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(project["phases"], &rows); err != nil {
		return result
	}
	for _, row := range rows {
		slug := firstString(row, "slug")
		if slug == "" {
			continue
		}
		payload, _ := json.Marshal(row)
		phase := CatalogPhase{
			SourceID: firstString(row, "sourceId", "id"), Slug: slug,
			Name: firstString(row, "name"), PropertyType: firstString(row, "propertyType"),
			SortOrder: firstInt(row, "sortOrder"), Address: firstString(row, "address"),
			ImageURL: firstString(row, "imageUrl"), FloorsTotal: firstInt(row, "floorsTotal"),
			SourcePayload: payload,
		}
		if phase.SourceID == "" {
			phase.SourceID = slug
		}
		if phase.Name == "" {
			phase.Name = slug
		}
		if phase.PropertyType == "" {
			phase.PropertyType = "apartment"
		}
		result[slug] = phase
	}
	return result
}

func catalogLayouts(node map[string]json.RawMessage) []NormalizedLayout {
	var rows []map[string]json.RawMessage
	if err := json.Unmarshal(node["layouts"], &rows); err != nil {
		return nil
	}
	result := make([]NormalizedLayout, 0, len(rows))
	for _, row := range rows {
		sourceID := firstString(row, "sourceId", "id")
		imageURL := firstString(row, "imageUrl", "plan", "planImageUrl")
		if sourceID == "" || imageURL == "" {
			continue
		}
		rooms, hasRooms := optionalInt(row, "rooms")
		layout := NormalizedLayout{
			SourceID: sourceID, PhaseSlug: firstString(row, "phaseSlug"), AvailableCount: firstInt(row, "availableCount"),
			Title: firstString(row, "title"), Address: firstString(row, "address"),
			PriceText: firstString(row, "priceText"), ImageURL: imageURL,
			ThumbnailURL: firstString(row, "thumbnailUrl"),
		}
		if hasRooms {
			layout.Rooms = &rooms
		}
		result = append(result, layout)
	}
	return result
}

func catalogCapturedAt(root map[string]json.RawMessage) (time.Time, error) {
	value := firstString(root, "capturedAt", "captureCompletedAt", "generatedAt", "dbUpdatedAt")
	if value == "" {
		return time.Time{}, errors.New("capturedAt/generatedAt is required")
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid capture timestamp %q", value)
	}
	return parsed, nil
}

func catalogProjectCapturedAt(project map[string]json.RawMessage, fallback time.Time) (time.Time, error) {
	raw, ok := project["updatedAt"]
	if !ok {
		return fallback, nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil || strings.TrimSpace(value) == "" {
		return time.Time{}, errors.New("project updatedAt must be an RFC3339 timestamp")
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid project updatedAt %q", value)
	}
	return parsed, nil
}

func officialCount(node, project map[string]json.RawMessage) *int {
	for _, key := range []string{"officialTotalAtCapture", "sourceCount", "totalUnits"} {
		if value, ok := optionalInt(node, key); ok {
			return &value
		}
		if value, ok := optionalInt(project, key); ok {
			return &value
		}
	}
	if source := rawObject(node["source"]); source != nil {
		if value, ok := optionalInt(source, "visibleListingCount"); ok {
			return &value
		}
	}
	if summary := rawObject(node["summary"]); summary != nil {
		if value, ok := optionalInt(summary, "publicCatalogRecords", "officialTotalAtCapture"); ok {
			return &value
		}
	}
	return nil
}

func catalogSchemaName(filename string, root map[string]json.RawMessage) string {
	if _, ok := root["projects"]; ok {
		return "kayan-client-export-v1"
	}
	if filename == "avalon-units.json" {
		return "avalon-showroom-v1"
	}
	if strings.HasSuffix(filename, "-client.json") {
		return "sanitized-client-v1"
	}
	return "website-catalog-v1"
}

func catalogMetadata(root map[string]json.RawMessage) json.RawMessage {
	copy := make(map[string]json.RawMessage, len(root))
	for key, value := range root {
		if key == "units" || key == "layouts" || key == "projects" || key == "matrix" {
			continue
		}
		copy[key] = value
	}
	body, _ := json.Marshal(copy)
	return body
}

func sourceURL(values map[string]json.RawMessage) string {
	if value := rawString(values["source"]); value != "" {
		return value
	}
	if source := rawObject(values["source"]); source != nil {
		if value := firstString(source, "catalog", "landing", "url"); value != "" {
			return value
		}
	}
	return firstString(values, "sourceLanding")
}

func catalogDeveloper(slug string, project map[string]json.RawMessage) (string, string) {
	if developer := firstString(project, "developerSlug"); developer != "" {
		name := strings.ToUpper(developer)
		if developer == "kayan" {
			name = "KAYAN"
		}
		return developer, name
	}
	switch slug {
	case "mirador", "ofiyat":
		return "kayan", "KAYAN"
	case "regnum-plaza":
		return "murad-buildings", "Murad Buildings"
	case "sun":
		return "human2human", "Human2Human"
	case "avalon-residence":
		return "tencorp", "Tencorp"
	default:
		return "nrg-bi", "NRG-BI"
	}
}

func projectSlugFromFilename(filename string) string {
	name := strings.TrimSuffix(filename, ".json")
	name = strings.TrimSuffix(name, "-catalog")
	name = strings.TrimSuffix(name, "-client")
	name = strings.TrimSuffix(name, "-units")
	if name == "avalon" {
		return "avalon-residence"
	}
	return name
}

func projectName(slug string) string {
	names := map[string]string{
		"4u": "4U Tashkent", "avalon-residence": "Avalon Residence",
		"botanika-saroyi": "Botanika Saroyi", "flagman": "Flagman Tashkent",
		"maftun-makon": "Maftun Makon", "regnum-plaza": "REGNUM PLAZA",
		"sado": "Sad'O", "sun": "SUN", "voha": "Voha", "yangibaxt": "Yangi Baxt",
	}
	if value := names[slug]; value != "" {
		return value
	}
	return strings.ReplaceAll(strings.Title(strings.ReplaceAll(slug, "-", " ")), "  ", " ") //nolint:staticcheck
}

func normalizeCatalogStatus(status, raw string, isSale bool) string {
	canonical := strings.ToLower(strings.TrimSpace(status))
	switch canonical {
	case "available", "free":
		return "available"
	case "reserved", "booking", "booked":
		return "reserved"
	case "sold":
		return "sold"
	case "unavailable", "occupied", "closed":
		return "unavailable"
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "свободно", "снятие брони", "снятие резерва", "расторжение":
		return "available"
	case "бронь", "бронирование", "договор составлен", "договор согласован":
		return "reserved"
	case "продано":
		return "sold"
	}
	if isSale {
		return "available"
	}
	return "unavailable"
}

func slugify(value string) string {
	var builder strings.Builder
	lastDash := false
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(char) || unicode.IsDigit(char) {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash && builder.Len() > 0 {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	result := strings.Trim(builder.String(), "-")
	if result == "" {
		return "main"
	}
	return result
}

func opaqueSuffix(value string, length int) string {
	hash := sha256.Sum256([]byte(value))
	encoded := hex.EncodeToString(hash[:])
	if length > len(encoded) {
		length = len(encoded)
	}
	return encoded[:length]
}

func rawObject(value json.RawMessage) map[string]json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(value, &result); err != nil {
		return nil
	}
	return result
}

func rawString(value json.RawMessage) string {
	if len(value) == 0 || string(value) == "null" {
		return ""
	}
	var result string
	if err := json.Unmarshal(value, &result); err == nil {
		return strings.TrimSpace(result)
	}
	text := strings.TrimSpace(string(value))
	if _, err := strconv.ParseFloat(text, 64); err == nil {
		return text
	}
	return ""
}

func firstString(values map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		if value := rawString(values[key]); value != "" {
			return value
		}
	}
	return ""
}

func firstInt(values map[string]json.RawMessage, keys ...string) int {
	value, _ := optionalInt(values, keys...)
	return value
}

func optionalInt(values map[string]json.RawMessage, keys ...string) (int, bool) {
	for _, key := range keys {
		value := values[key]
		if len(value) == 0 || string(value) == "null" {
			continue
		}
		var result int
		if err := json.Unmarshal(value, &result); err == nil {
			return result, true
		}
		if text := rawString(value); text != "" {
			if result, err := strconv.Atoi(text); err == nil {
				return result, true
			}
		}
	}
	return 0, false
}

func optionalInt64(values map[string]json.RawMessage, keys ...string) (int64, bool) {
	for _, key := range keys {
		value := values[key]
		if len(value) == 0 || string(value) == "null" {
			continue
		}
		var result int64
		if err := json.Unmarshal(value, &result); err == nil {
			return result, true
		}
		if text := rawString(value); text != "" {
			if result, err := strconv.ParseInt(text, 10, 64); err == nil {
				return result, true
			}
		}
	}
	return 0, false
}

func firstFloat(values map[string]json.RawMessage, keys ...string) float64 {
	value, _ := optionalFloat(values, keys...)
	return value
}

func optionalFloat(values map[string]json.RawMessage, keys ...string) (float64, bool) {
	for _, key := range keys {
		value := values[key]
		if len(value) == 0 || string(value) == "null" {
			continue
		}
		var result float64
		if err := json.Unmarshal(value, &result); err == nil {
			return result, true
		}
		if text := rawString(value); text != "" {
			if result, err := strconv.ParseFloat(strings.ReplaceAll(text, ",", "."), 64); err == nil {
				return result, true
			}
		}
	}
	return 0, false
}

func optionalBoolDefault(values map[string]json.RawMessage, fallback bool, keys ...string) bool {
	for _, key := range keys {
		value := values[key]
		if len(value) == 0 || string(value) == "null" {
			continue
		}
		var result bool
		if err := json.Unmarshal(value, &result); err == nil {
			return result
		}
	}
	return fallback
}
