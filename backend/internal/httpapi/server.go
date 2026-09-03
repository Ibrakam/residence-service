package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tencorp/real-estate-platform/backend/internal/database"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

type Server struct {
	store               *database.Store
	logger              *slog.Logger
	allowedOrigins      map[string]struct{}
	leadWrites          bool
	requestTimeout      time.Duration
	leadDuplicateWindow time.Duration
	leadSlots           chan struct{}
}

type Options struct {
	AllowedOrigins      string
	LeadWrites          bool
	RequestTimeout      time.Duration
	LeadDuplicateWindow time.Duration
	LeadMaxInFlight     int
}

func New(store *database.Store, logger *slog.Logger, allowedOrigin string, leadWrites ...bool) http.Handler {
	writesEnabled := false
	if len(leadWrites) > 0 {
		writesEnabled = leadWrites[0]
	}
	return NewWithOptions(store, logger, Options{
		AllowedOrigins:      allowedOrigin,
		LeadWrites:          writesEnabled,
		RequestTimeout:      10 * time.Second,
		LeadDuplicateWindow: time.Minute,
		LeadMaxInFlight:     8,
	})
}

func NewWithOptions(store *database.Store, logger *slog.Logger, options Options) http.Handler {
	server := &Server{
		store:               store,
		logger:              logger,
		allowedOrigins:      parseAllowedOrigins(options.AllowedOrigins),
		leadWrites:          options.LeadWrites,
		requestTimeout:      options.RequestTimeout,
		leadDuplicateWindow: options.LeadDuplicateWindow,
	}
	if options.LeadMaxInFlight > 0 {
		server.leadSlots = make(chan struct{}, options.LeadMaxInFlight)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", server.serviceInfo)
	mux.HandleFunc("GET /healthz", server.health)
	mux.HandleFunc("GET /readyz", server.ready)
	mux.HandleFunc("GET /v1/developers", server.listDevelopers)
	mux.HandleFunc("GET /v1/projects", server.listProjects)
	mux.HandleFunc("GET /v1/projects/{slug}", server.getProject)
	mux.HandleFunc("GET /v1/projects/{slug}/units", server.listUnits)
	mux.HandleFunc("GET /v1/projects/{slug}/layouts", server.listLayouts)
	mux.HandleFunc("GET /v1/projects/{slug}/availability", server.availability)
	mux.HandleFunc("GET /v1/projects/{slug}/floor-schemes", server.getFloorSchemes)
	mux.HandleFunc("GET /v1/units/{id}", server.getUnit)
	mux.HandleFunc("GET /v1/sync/status", server.syncStatus)
	mux.HandleFunc("GET /v1/sync/catalog-status", server.catalogSyncStatus)
	mux.HandleFunc("POST /v1/leads", server.createLead)
	mux.HandleFunc("OPTIONS /", server.options)
	return server.withMiddleware(mux)
}

func (s *Server) serviceInfo(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"service":   "Tencorp real-estate catalog API",
		"version":   "v1",
		"health":    "/healthz",
		"readiness": "/readyz",
		"projects":  "/v1/projects",
	})
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		writeError(w, http.StatusServiceUnavailable, "database_unavailable", "PostgreSQL is unavailable")
		return
	}
	readiness, err := s.store.CatalogReadiness(r.Context())
	if err != nil {
		s.internalError(w, "catalog readiness", err)
		return
	}
	if readiness.Projects == 0 || readiness.ActiveUnits == 0 || readiness.SuccessfulRuns == 0 || readiness.LastImportedAt == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "catalog": readiness})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ready", "catalog": readiness})
}

func (s *Server) listDevelopers(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListDevelopers(r.Context())
	if err != nil {
		s.internalError(w, "list developers", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListProjects(r.Context())
	if err != nil {
		s.internalError(w, "list projects", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) getProject(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.GetProject(r.Context(), r.PathValue("slug"))
	if errors.Is(err, database.ErrNotFound) {
		writeError(w, http.StatusNotFound, "project_not_found", "Project was not found")
		return
	}
	if err != nil {
		s.internalError(w, "get project", err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) listUnits(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit, err := parseIntDefault(query.Get("limit"), 50)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_limit", "limit must be an integer")
		return
	}
	offset, err := parseIntDefault(query.Get("offset"), 0)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_offset", "offset must be an integer")
		return
	}
	limit, offset = database.ClampPagination(limit, offset)

	filter := domain.UnitFilter{
		ProjectSlug: r.PathValue("slug"), PhaseSlug: query.Get("phase"),
		Status: query.Get("status"), PropertyType: query.Get("propertyType"),
		Limit: limit, Offset: offset,
	}
	if filter.Rooms, err = parseOptionalInt(query.Get("rooms")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_rooms", "rooms must be an integer")
		return
	}
	if filter.FloorFrom, err = parseOptionalInt(query.Get("floorFrom")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_floor_from", "floorFrom must be an integer")
		return
	}
	if filter.FloorTo, err = parseOptionalInt(query.Get("floorTo")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_floor_to", "floorTo must be an integer")
		return
	}
	if filter.PriceFrom, err = parseOptionalInt64(query.Get("priceFrom")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_price_from", "priceFrom must be an integer")
		return
	}
	if filter.PriceTo, err = parseOptionalInt64(query.Get("priceTo")); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_price_to", "priceTo must be an integer")
		return
	}

	page, err := s.store.ListUnits(r.Context(), filter)
	if err != nil {
		s.internalError(w, "list units", err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (s *Server) getUnit(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_unit_id", "Unit id must be a positive integer")
		return
	}
	item, err := s.store.GetUnit(r.Context(), id)
	if errors.Is(err, database.ErrNotFound) {
		writeError(w, http.StatusNotFound, "unit_not_found", "Unit was not found")
		return
	}
	if err != nil {
		s.internalError(w, "get unit", err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) listLayouts(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListLayouts(r.Context(), r.PathValue("slug"), r.URL.Query().Get("phase"))
	if err != nil {
		s.internalError(w, "list layouts", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) availability(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Availability(r.Context(), r.PathValue("slug"), r.URL.Query().Get("phase"))
	if err != nil {
		s.internalError(w, "get availability", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) syncStatus(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.LatestSync(r.Context())
	if err != nil {
		s.internalError(w, "get sync status", err)
		return
	}
	// Import errors can contain filesystem paths or upstream details. The public
	// status endpoint exposes the state and counters, while full errors stay in
	// operator logs and PostgreSQL.
	for index := range items {
		items[index].Error = ""
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *Server) catalogSyncStatus(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.CatalogProviderSyncStatus(r.Context())
	if err != nil {
		s.internalError(w, "get catalog provider sync status", err)
		return
	}
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

var uzbekPhonePattern = regexp.MustCompile(`^\+998\d{9}$`)
var projectSlugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

type createLeadRequest struct {
	ProjectSlug string          `json:"projectSlug"`
	UnitID      json.RawMessage `json:"unitId"`
	UnitKey     json.RawMessage `json:"unitKey"`
	LastViewed  json.RawMessage `json:"lastViewedApartment"`
	Name        string          `json:"name"`
	Phone       string          `json:"phone"`
	Goal        string          `json:"goal"`
	Language    string          `json:"language"`
	Lang        string          `json:"lang"`
	FormContext string          `json:"formContext"`
	Context     string          `json:"context"`
	Consent     *bool           `json:"consent"`
	LandingURL  string          `json:"landing_url"`
	ReferrerURL string          `json:"referrer_url"`
	FBC         string          `json:"fbc"`
	FBP         string          `json:"fbp"`
	FBCLID      string          `json:"fbclid"`
	UTMSource   string          `json:"utm_source"`
	UTMMedium   string          `json:"utm_medium"`
	UTMCampaign string          `json:"utm_campaign"`
	UTMContent  string          `json:"utm_content"`
	UTMTerm     string          `json:"utm_term"`
	TCID        string          `json:"tcid"`
}

func (s *Server) createLead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store, max-age=0")
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var request createLeadRequest
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&request); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(w, http.StatusRequestEntityTooLarge, "request_too_large", "Request body exceeds 64 KiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must be valid JSON")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(w, http.StatusRequestEntityTooLarge, "request_too_large", "Request body exceeds 64 KiB")
			return
		}
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body must contain one JSON object")
		return
	}
	request.ProjectSlug = strings.TrimSpace(request.ProjectSlug)
	request.Name = strings.TrimSpace(request.Name)
	request.Phone = strings.TrimSpace(request.Phone)
	request.Goal = strings.TrimSpace(request.Goal)
	request.Language = strings.TrimSpace(request.Language)
	request.Lang = strings.TrimSpace(request.Lang)
	if request.Language == "" {
		request.Language = request.Lang
	} else if request.Lang != "" && request.Lang != request.Language {
		writeError(w, http.StatusBadRequest, "language_mismatch", "lang and language must match")
		return
	}
	if request.Language == "" {
		request.Language = "ru"
	}
	request.FormContext = strings.TrimSpace(request.FormContext)
	request.Context = strings.TrimSpace(request.Context)
	if request.FormContext == "" {
		request.FormContext = request.Context
	} else if request.Context != "" && request.Context != request.FormContext {
		writeError(w, http.StatusBadRequest, "context_mismatch", "context and formContext must match")
		return
	}
	unitReferences, err := parseUnitReferences(request.UnitID, request.UnitKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_unit_reference", err.Error())
		return
	}
	lastViewedReferences, err := parseLastViewedReferences(request.LastViewed)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_last_viewed_reference", err.Error())
		return
	}
	if message := validateLeadRequest(request); message != "" {
		writeError(w, http.StatusBadRequest, "invalid_lead", message)
		return
	}
	if !s.leadWrites {
		writeError(w, http.StatusServiceUnavailable, "lead_writes_disabled", "Lead storage is disabled in this environment")
		return
	}
	if !s.acquireLeadSlot() {
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusTooManyRequests, "lead_capacity_exceeded", "Too many lead submissions are in progress")
		return
	}
	defer s.releaseLeadSlot()
	metadata, err := json.Marshal(map[string]string{
		"fbc": request.FBC, "fbp": request.FBP, "fbclid": request.FBCLID,
		"utm_source": request.UTMSource, "utm_medium": request.UTMMedium,
		"utm_campaign": request.UTMCampaign, "utm_content": request.UTMContent,
		"utm_term": request.UTMTerm, "tcid": request.TCID,
	})
	if err != nil {
		s.internalError(w, "encode lead metadata", err)
		return
	}
	item, err := s.store.CreateLead(r.Context(), domain.CreateLeadInput{
		ProjectSlug: request.ProjectSlug, UnitReferences: unitReferences, LastViewedReferences: lastViewedReferences, Name: request.Name,
		Phone: request.Phone, Goal: request.Goal, Language: request.Language,
		FormContext: request.FormContext,
		LandingURL:  strings.TrimSpace(request.LandingURL), ReferrerURL: strings.TrimSpace(request.ReferrerURL),
		Metadata: metadata, ConsentGiven: request.Consent != nil && *request.Consent,
		MinimumInterval: s.leadDuplicateWindow,
	})
	if errors.Is(err, database.ErrNotFound) {
		writeError(w, http.StatusBadRequest, "project_not_found", "Project was not found")
		return
	}
	if errors.Is(err, database.ErrUnitNotFound) {
		writeError(w, http.StatusUnprocessableEntity, "unit_not_found", "Unit reference was not found")
		return
	}
	if errors.Is(err, database.ErrUnitProjectMismatch) {
		writeError(w, http.StatusUnprocessableEntity, "unit_project_mismatch", "Unit does not belong to project")
		return
	}
	if errors.Is(err, database.ErrAmbiguousUnitReference) {
		writeError(w, http.StatusUnprocessableEntity, "ambiguous_unit_reference", "Unit reference is ambiguous")
		return
	}
	if errors.Is(err, database.ErrUnitReferenceMismatch) {
		writeError(w, http.StatusUnprocessableEntity, "unit_reference_mismatch", "Unit identity fields do not identify the same unit")
		return
	}
	if errors.Is(err, database.ErrConsentRequired) {
		writeError(w, http.StatusBadRequest, "consent_required", "Consent must be true")
		return
	}
	if errors.Is(err, database.ErrLeadRateLimited) {
		w.Header().Set("Retry-After", retryAfterSeconds(s.leadDuplicateWindow))
		writeError(w, http.StatusTooManyRequests, "lead_rate_limited", "A recent request already exists for this project and phone")
		return
	}
	if err != nil {
		s.leadInternalError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"success": true,
		"lead": map[string]any{
			"id": item.ID, "projectSlug": item.ProjectSlug, "hasUnit": item.HasUnit, "hasLastViewed": item.HasLastViewed,
			"consentGiven": item.ConsentGiven, "createdAt": item.CreatedAt,
		},
	})
}

func validateLeadRequest(request createLeadRequest) string {
	if request.ProjectSlug == "" || len(request.ProjectSlug) > 80 || !projectSlugPattern.MatchString(request.ProjectSlug) {
		return "projectSlug is required"
	}
	if len(request.Name) < 2 || len(request.Name) > 120 || strings.ContainsAny(request.Name, "\x00\r\n") {
		return "name must contain 2 to 120 characters"
	}
	if !uzbekPhonePattern.MatchString(request.Phone) {
		return "phone must use +998XXXXXXXXX format"
	}
	if request.Goal != "live" && request.Goal != "invest" && request.Goal != "rent" {
		return "goal must be live, invest, or rent"
	}
	if request.Language != "ru" && request.Language != "uz" && request.Language != "en" {
		return "language must be ru, uz, or en"
	}
	if request.Consent == nil || !*request.Consent {
		return "consent must be true"
	}
	if len(request.FormContext) > 2048 || len(request.LandingURL) > 2048 || len(request.ReferrerURL) > 2048 {
		return "context and URLs must not exceed 2048 characters"
	}
	if containsUnsafeTextControl(request.FormContext) || containsUnsafeTextControl(request.LandingURL) || containsUnsafeTextControl(request.ReferrerURL) {
		return "context and URLs must not contain control characters"
	}
	trackingValues := []string{
		request.FBC, request.FBP, request.FBCLID, request.UTMSource, request.UTMMedium,
		request.UTMCampaign, request.UTMContent, request.UTMTerm, request.TCID,
	}
	for _, value := range trackingValues {
		if len(value) > 1024 || containsUnsafeTextControl(value) {
			return "tracking values must not exceed 1024 characters or contain control characters"
		}
	}
	return ""
}

func containsUnsafeTextControl(value string) bool {
	return strings.ContainsAny(value, "\x00\r\n")
}

func parseUnitReferences(unitID, unitKey json.RawMessage) ([]domain.UnitReference, error) {
	references := make([]domain.UnitReference, 0, 2)
	id, err := parseUnitIDReference(unitID, "unitId")
	if err != nil {
		return nil, err
	}
	if id != nil {
		references = append(references, *id)
	}
	key, err := parseSourceReference(unitKey, "unitKey", domain.UnitReferenceSourceKey)
	if err != nil {
		return nil, err
	}
	if key != nil {
		references = append(references, *key)
	}
	return references, nil
}

func parseUnitIDReference(raw json.RawMessage, field string) (*domain.UnitReference, error) {
	if isNullReference(raw) {
		return nil, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		text, err = safeUnitReferenceText(text, field)
		if err != nil {
			return nil, err
		}
		return &domain.UnitReference{Namespace: domain.UnitReferenceSourceID, Value: text}, nil
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err == nil {
		parsed, parseErr := strconv.ParseInt(number.String(), 10, 64)
		if parseErr != nil || parsed <= 0 {
			return nil, fmt.Errorf("%s numeric value must be a positive integer", field)
		}
		return &domain.UnitReference{Namespace: domain.UnitReferenceInternalID, Value: strconv.FormatInt(parsed, 10)}, nil
	}
	return nil, fmt.Errorf("%s must be a string, positive integer, or null", field)
}

func parseSourceReference(raw json.RawMessage, field string, namespace domain.UnitReferenceNamespace) (*domain.UnitReference, error) {
	if isNullReference(raw) {
		return nil, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, fmt.Errorf("%s must be a string or null", field)
	}
	text, err := safeUnitReferenceText(text, field)
	if err != nil {
		return nil, err
	}
	return &domain.UnitReference{Namespace: namespace, Value: text}, nil
}

func safeUnitReferenceText(value, field string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 200 || strings.ContainsAny(value, "\x00\r\n\t") {
		return "", fmt.Errorf("%s must contain 1 to 200 safe characters", field)
	}
	return value, nil
}

func isNullReference(raw json.RawMessage) bool {
	return len(raw) == 0 || strings.TrimSpace(string(raw)) == "null"
}

func appendDistinctUnitReference(references []domain.UnitReference, reference *domain.UnitReference) ([]domain.UnitReference, error) {
	if reference == nil {
		return references, nil
	}
	for _, existing := range references {
		if existing.Namespace != reference.Namespace {
			continue
		}
		if existing.Value != reference.Value {
			return nil, errors.New("identity fields in the same namespace must match")
		}
		return references, nil
	}
	return append(references, *reference), nil
}

func parseLastViewedReferences(raw json.RawMessage) ([]domain.UnitReference, error) {
	if isNullReference(raw) {
		return nil, nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil || values == nil {
		return nil, errors.New("lastViewedApartment must be an object or null")
	}
	references := make([]domain.UnitReference, 0, 3)
	uuid, err := parseSourceReference(values["uuid"], "lastViewedApartment.uuid", domain.UnitReferenceSourceID)
	if err != nil {
		return nil, err
	}
	if references, err = appendDistinctUnitReference(references, uuid); err != nil {
		return nil, fmt.Errorf("lastViewedApartment: %w", err)
	}
	id, err := parseUnitIDReference(values["unitId"], "lastViewedApartment.unitId")
	if err != nil {
		return nil, err
	}
	if references, err = appendDistinctUnitReference(references, id); err != nil {
		return nil, fmt.Errorf("lastViewedApartment: %w", err)
	}
	key, err := parseSourceReference(values["unitKey"], "lastViewedApartment.unitKey", domain.UnitReferenceSourceKey)
	if err != nil {
		return nil, err
	}
	if references, err = appendDistinctUnitReference(references, key); err != nil {
		return nil, fmt.Errorf("lastViewedApartment: %w", err)
	}
	if len(references) == 0 {
		return nil, errors.New("lastViewedApartment must contain uuid, unitKey, or unitId")
	}
	return references, nil
}

func (s *Server) options(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) internalError(w http.ResponseWriter, operation string, err error) {
	if errors.Is(err, context.DeadlineExceeded) {
		s.logger.Warn("request deadline exceeded", "operation", operation)
		writeError(w, http.StatusGatewayTimeout, "request_timeout", "Request timed out")
		return
	}
	s.logger.Error(operation, "error", err)
	writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
}

func (s *Server) leadInternalError(w http.ResponseWriter, err error) {
	if errors.Is(err, context.DeadlineExceeded) {
		s.logger.Warn("lead request deadline exceeded")
		writeError(w, http.StatusGatewayTimeout, "request_timeout", "Request timed out")
		return
	}
	// Database errors can include a failing row in their detail. Never attach the
	// raw error to a lead log because that row contains name and phone PII.
	s.logger.Error("create lead failed", "error_type", fmt.Sprintf("%T", err))
	writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
}

func (s *Server) acquireLeadSlot() bool {
	if s.leadSlots == nil {
		return true
	}
	select {
	case s.leadSlots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (s *Server) releaseLeadSlot() {
	if s.leadSlots != nil {
		<-s.leadSlots
	}
}

func retryAfterSeconds(duration time.Duration) string {
	if duration <= 0 {
		return "1"
	}
	seconds := int64((duration-1)/time.Second) + 1
	return strconv.FormatInt(seconds, 10)
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/v1/leads" {
			w.Header().Set("Cache-Control", "no-store, max-age=0")
		}
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			w.Header().Add("Vary", "Origin")
			_, allowed := s.allowedOrigins[origin]
			if allowed {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}
			if !allowed && (r.Method == http.MethodOptions || (r.Method == http.MethodPost && r.URL.Path == "/v1/leads")) {
				writeError(w, http.StatusForbidden, "origin_not_allowed", "Origin is not allowed")
				return
			}
			if allowed {
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
		}
		if s.requestTimeout > 0 {
			ctx, cancel := context.WithTimeout(r.Context(), s.requestTimeout)
			defer cancel()
			r = r.WithContext(ctx)
		}
		next.ServeHTTP(w, r)
	})
}

func parseAllowedOrigins(value string) map[string]struct{} {
	origins := make(map[string]struct{})
	for _, origin := range strings.Split(value, ",") {
		origin = strings.TrimSpace(origin)
		parsed, err := url.Parse(origin)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
			continue
		}
		origins[origin] = struct{}{}
	}
	return origins
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func parseIntDefault(value string, fallback int) (int, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	return strconv.Atoi(value)
}

func parseOptionalInt(value string) (*int, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}

func parseOptionalInt64(value string) (*int64, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
}
