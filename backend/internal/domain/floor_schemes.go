package domain

import "time"

// FloorSchemeArtifact is the sanitized, API-safe projection of an audited
// official capture. CRM routes, tenant/account IDs and credentials never enter
// this representation.
type FloorSchemeArtifact struct {
	SchemaVersion            int                           `json:"schemaVersion"`
	ProjectSlug              string                        `json:"projectSlug"`
	CapturedAt               *time.Time                    `json:"capturedAt"`
	CaptureStatus            string                        `json:"captureStatus"`
	CaptureScope             FloorSchemeCaptureScope       `json:"captureScope"`
	SourceStatus             string                        `json:"sourceStatus"`
	SourceObservedAt         time.Time                     `json:"sourceObservedAt"`
	FloorSchemeCount         int                           `json:"floorSchemeCount"`
	HotspotCount             int                           `json:"hotspotCount"`
	BlockEntranceMapping     map[string][]string           `json:"blockEntranceMapping"`
	Schemes                  []FloorScheme                 `json:"schemes"`
	ExpectedUniverse         *FloorSchemeExpectedUniverse  `json:"expectedUniverse"`
	CompanionEvidence        *FloorSchemeCompanionEvidence `json:"companionEvidence"`
	SidecarByteSHA256        string                        `json:"sidecarByteSha256,omitempty"`
	BackendAPIArtifactSHA256 string                        `json:"backendApiArtifactSha256,omitempty"`
}

type FloorSchemeExpectedUniverse struct {
	SourceObservedAt           time.Time                               `json:"sourceObservedAt"`
	ExpectedManifestByteSHA256 string                                  `json:"expectedManifestByteSha256"`
	SchemeCount                int                                     `json:"schemeCount"`
	UnitCount                  int                                     `json:"unitCount"`
	CatalogUnitCount           *int                                    `json:"catalogUnitCount,omitempty"`
	LockedSnapshotUnitCount    int                                     `json:"lockedSnapshotUnitCount,omitempty"`
	CompanionUnitCount         int                                     `json:"companionUnitCount"`
	Assignments                []FloorSchemeExpectedUniverseAssignment `json:"assignments"`
}

type FloorSchemeExpectedUniverseAssignment struct {
	PhaseSlug  string  `json:"phaseSlug,omitempty"`
	Entrance   string  `json:"entrance"`
	Floor      int     `json:"floor"`
	UnitNumber string  `json:"unitNumber"`
	UnitKey    *string `json:"unitKey"`
	Evidence   string  `json:"evidence"`
}

// FloorSchemeCompanionEvidence is API-safe proof for official hotspots that
// have no strict catalog unitKey match. Schema v3 identifies each record by a
// phase-aware tuple; legacy Mirador v2 retains its historical number list. It
// deliberately contains no inferred price, availability or CRM identity.
type FloorSchemeCompanionEvidence struct {
	Source           string                       `json:"source"`
	SourceObservedAt time.Time                    `json:"sourceObservedAt"`
	RecordCount      int                          `json:"recordCount"`
	UnitNumbers      []string                     `json:"unitNumbers"`
	Records          []FloorSchemeCompanionRecord `json:"records,omitempty"`
	RecordsSHA256    string                       `json:"recordsSha256"`
}

// FloorSchemeCompanionRecord is the phase-aware identity used by schema v3
// when an official hotspot has no catalog unitKey. Mirador schema v2 keeps its
// historical unitNumbers-only evidence and therefore omits this field.
type FloorSchemeCompanionRecord struct {
	PhaseSlug  string `json:"phaseSlug"`
	Entrance   string `json:"entrance"`
	Floor      int    `json:"floor"`
	UnitNumber string `json:"unitNumber"`
}

type FloorSchemeCaptureScope struct {
	Mode                 string                        `json:"mode"`
	DeclaredBlocks       []int                         `json:"declaredBlocks"`
	DeclaredEntrances    []string                      `json:"declaredEntrances"`
	DeclaredFloors       []FloorSchemeScopeFloor       `json:"declaredFloors"`
	DeclaredUnitHotspots []FloorSchemeScopeUnitHotspot `json:"declaredUnitHotspots"`
	SchemeCount          int                           `json:"schemeCount"`
	HotspotCount         int                           `json:"hotspotCount"`
	AuditedExclusions    []FloorSchemeAuditedExclusion `json:"auditedExclusions"`
}

type FloorSchemeScopeFloor struct {
	PhaseSlug string `json:"phaseSlug,omitempty"`
	Entrance  string `json:"entrance"`
	Floor     int    `json:"floor"`
}

type FloorSchemeScopeUnitHotspot struct {
	PhaseSlug  string `json:"phaseSlug,omitempty"`
	Entrance   string `json:"entrance"`
	Floor      int    `json:"floor"`
	UnitNumber string `json:"unitNumber"`
}

type FloorSchemeAuditedExclusion struct {
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
	Evidence string `json:"evidence"`
}

type FloorScheme struct {
	PhaseSlug              string                    `json:"phaseSlug,omitempty"`
	Entrance               string                    `json:"entrance"`
	Floor                  int                       `json:"floor"`
	ImageURL               string                    `json:"imageUrl"`
	ImageSHA256            string                    `json:"imageSha256"`
	ImageBytes             int64                     `json:"imageBytes"`
	Width                  int                       `json:"width"`
	Height                 int                       `json:"height"`
	SourceScreenshotSHA256 string                    `json:"sourceScreenshotSha256"`
	SourceScreenshotWidth  int                       `json:"sourceScreenshotWidth,omitempty"`
	SourceScreenshotHeight int                       `json:"sourceScreenshotHeight,omitempty"`
	SourceCrop             FloorSchemeImageRectangle `json:"sourceCrop"`
	Zones                  []FloorSchemeZone         `json:"zones"`
}

type FloorSchemeImageRectangle struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type FloorSchemeZone struct {
	UnitKey    *string          `json:"unitKey"`
	UnitNumber string           `json:"unitNumber"`
	Points     string           `json:"points"`
	Label      FloorSchemeLabel `json:"label"`
}

type FloorSchemeLabel struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
