package domain

import "time"

type Developer struct {
	ID   int64  `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type ProjectSummary struct {
	ID             int64      `json:"id"`
	DeveloperSlug  string     `json:"developerSlug"`
	Slug           string     `json:"slug"`
	Name           string     `json:"name"`
	TotalUnits     int64      `json:"totalUnits"`
	AvailableUnits int64      `json:"availableUnits"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}

type PhaseSummary struct {
	ID             int64      `json:"id"`
	Slug           string     `json:"slug"`
	Name           string     `json:"name"`
	SourceID       string     `json:"sourceId"`
	PropertyType   string     `json:"propertyType"`
	SortOrder      int        `json:"sortOrder"`
	Address        string     `json:"address,omitempty"`
	ImageURL       string     `json:"imageUrl,omitempty"`
	FloorsTotal    int        `json:"floorsTotal"`
	TotalUnits     int64      `json:"totalUnits"`
	AvailableUnits int64      `json:"availableUnits"`
	UpdatedAt      *time.Time `json:"updatedAt,omitempty"`
}

type Project struct {
	ProjectSummary
	Phases []PhaseSummary `json:"phases"`
}

type Unit struct {
	ID              int64     `json:"id"`
	SourceKey       string    `json:"sourceKey"`
	ProjectSlug     string    `json:"projectSlug"`
	PhaseSlug       string    `json:"phaseSlug"`
	PhaseName       string    `json:"phaseName"`
	PropertyType    string    `json:"propertyType"`
	RawPropertyType string    `json:"rawPropertyType"`
	Status          string    `json:"status"`
	RawStatus       string    `json:"rawStatus"`
	Number          string    `json:"number"`
	Entrance        string    `json:"entrance,omitempty"`
	Floor           int       `json:"floor"`
	Area            float64   `json:"area"`
	Rooms           *int      `json:"rooms,omitempty"`
	Price           *int64    `json:"price,omitempty"`
	PricePerM2      *float64  `json:"pricePerM2,omitempty"`
	Currency        string    `json:"currency"`
	PlanImageURL    string    `json:"planImageUrl,omitempty"`
	IsActive        bool      `json:"isActive"`
	SourceUpdatedAt time.Time `json:"sourceUpdatedAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Layout struct {
	ID             int64  `json:"id"`
	SourceID       string `json:"sourceId"`
	ProjectSlug    string `json:"projectSlug"`
	PhaseSlug      string `json:"phaseSlug"`
	Rooms          *int   `json:"rooms,omitempty"`
	AvailableCount int    `json:"availableCount"`
	Title          string `json:"title"`
	Address        string `json:"address,omitempty"`
	PriceText      string `json:"priceText,omitempty"`
	ImageURL       string `json:"imageUrl"`
	ThumbnailURL   string `json:"thumbnailUrl,omitempty"`
}

type UnitFilter struct {
	ProjectSlug  string
	PhaseSlug    string
	Status       string
	PropertyType string
	Rooms        *int
	FloorFrom    *int
	FloorTo      *int
	PriceFrom    *int64
	PriceTo      *int64
	Limit        int
	Offset       int
}

type UnitPage struct {
	Items  []Unit `json:"items"`
	Total  int64  `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

type Availability struct {
	Status string `json:"status"`
	Count  int64  `json:"count"`
}

type SyncStatus struct {
	Source       string     `json:"source"`
	Status       string     `json:"status"`
	StartedAt    time.Time  `json:"startedAt"`
	FinishedAt   *time.Time `json:"finishedAt,omitempty"`
	RecordsRead  int        `json:"recordsRead"`
	RecordsSaved int        `json:"recordsSaved"`
	Error        string     `json:"error,omitempty"`
}

type CatalogProviderSyncStatus struct {
	Provider      string                     `json:"provider"`
	Status        string                     `json:"status"`
	Freshness     string                     `json:"freshness"`
	LastAttemptAt time.Time                  `json:"lastAttemptAt"`
	LastSuccessAt *time.Time                 `json:"lastSuccessAt,omitempty"`
	FreshUntil    *time.Time                 `json:"freshUntil,omitempty"`
	ErrorCode     string                     `json:"errorCode,omitempty"`
	Projects      []CatalogProjectSyncStatus `json:"projects"`
}

type CatalogProjectSyncStatus struct {
	ProjectSlug    string     `json:"projectSlug"`
	Status         string     `json:"status"`
	Freshness      string     `json:"freshness"`
	LastAttemptAt  time.Time  `json:"lastAttemptAt"`
	LastSuccessAt  *time.Time `json:"lastSuccessAt,omitempty"`
	LastCapturedAt *time.Time `json:"lastCapturedAt,omitempty"`
	FreshUntil     *time.Time `json:"freshUntil,omitempty"`
	RecordCount    *int       `json:"recordCount,omitempty"`
	ErrorCode      string     `json:"errorCode,omitempty"`
}

type CatalogReadiness struct {
	Projects       int64      `json:"projects"`
	ActiveUnits    int64      `json:"activeUnits"`
	SuccessfulRuns int64      `json:"successfulRuns"`
	LastImportedAt *time.Time `json:"lastImportedAt,omitempty"`
}

type UnitReferenceNamespace string

const (
	UnitReferenceInternalID UnitReferenceNamespace = "internal_id"
	UnitReferenceSourceID   UnitReferenceNamespace = "source_id"
	UnitReferenceSourceKey  UnitReferenceNamespace = "source_key"
)

// UnitReference keeps public lead identities in their declared namespace.
// Values from different namespaces must never be combined into a fallback
// lookup: internal IDs are deployment-local, while source IDs and source keys
// are upstream identities with different compatibility guarantees.
type UnitReference struct {
	Namespace UnitReferenceNamespace
	Value     string
}

type CreateLeadInput struct {
	ProjectSlug          string
	UnitReferences       []UnitReference
	LastViewedReferences []UnitReference
	Name                 string
	Phone                string
	Goal                 string
	Language             string
	FormContext          string
	LandingURL           string
	ReferrerURL          string
	Metadata             []byte
	ConsentGiven         bool
	ConsentAt            time.Time
	MinimumInterval      time.Duration
}

type Lead struct {
	ID               int64     `json:"id"`
	ProjectSlug      string    `json:"projectSlug"`
	UnitID           *int64    `json:"-"`
	LastViewedUnitID *int64    `json:"-"`
	HasUnit          bool      `json:"hasUnit"`
	HasLastViewed    bool      `json:"hasLastViewed"`
	Name             string    `json:"name"`
	Phone            string    `json:"phone"`
	Goal             string    `json:"goal"`
	Language         string    `json:"language"`
	FormContext      string    `json:"formContext"`
	ConsentGiven     bool      `json:"consentGiven"`
	ConsentAt        time.Time `json:"consentAt"`
	CreatedAt        time.Time `json:"createdAt"`
}
