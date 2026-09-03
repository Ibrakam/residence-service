package database

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

var ErrNotFound = errors.New("not found")
var ErrUnitNotFound = errors.New("unit reference not found")
var ErrUnitProjectMismatch = errors.New("unit does not belong to project")
var ErrAmbiguousUnitReference = errors.New("unit reference is ambiguous")
var ErrUnitReferenceMismatch = errors.New("unit identity fields resolve to different units")
var ErrConsentRequired = errors.New("lead consent is required")
var ErrLeadRateLimited = errors.New("lead submission is rate limited")

type Store struct {
	pool *pgxpool.Pool
}

func NewStore(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func (s *Store) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

func (s *Store) CatalogReadiness(ctx context.Context) (domain.CatalogReadiness, error) {
	var item domain.CatalogReadiness
	err := s.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM projects),
			(SELECT count(*) FROM units WHERE is_active),
			(SELECT count(*) FROM sync_runs WHERE (source=$1 OR source LIKE $2) AND status='succeeded'),
			(SELECT max(finished_at) FROM sync_runs WHERE (source=$1 OR source LIKE $2) AND status='succeeded')`,
		importerCatalogSource, liveCatalogSourcePattern).Scan(&item.Projects, &item.ActiveUnits, &item.SuccessfulRuns, &item.LastImportedAt)
	return item, err
}

const importerCatalogSource = "versioned-website-catalog"
const liveCatalogSourcePattern = "live-catalog/%"

func (s *Store) ListDevelopers(ctx context.Context) ([]domain.Developer, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, slug, name FROM developers ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Developer, 0)
	for rows.Next() {
		var item domain.Developer
		if err := rows.Scan(&item.ID, &item.Slug, &item.Name); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) ListProjects(ctx context.Context) ([]domain.ProjectSummary, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT p.id, d.slug, p.slug, p.name,
               count(u.id) FILTER (WHERE u.is_active),
               count(u.id) FILTER (WHERE u.is_active AND u.status='available'),
               max(u.source_updated_at)
        FROM projects p
        JOIN developers d ON d.id=p.developer_id
        LEFT JOIN phases ph ON ph.project_id=p.id
        LEFT JOIN units u ON u.phase_id=ph.id
        GROUP BY p.id, d.slug, p.slug, p.name
        ORDER BY p.name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.ProjectSummary, 0)
	for rows.Next() {
		var item domain.ProjectSummary
		if err := rows.Scan(&item.ID, &item.DeveloperSlug, &item.Slug, &item.Name, &item.TotalUnits, &item.AvailableUnits, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetProject(ctx context.Context, slug string) (domain.Project, error) {
	var project domain.Project
	err := s.pool.QueryRow(ctx, `
        SELECT p.id, d.slug, p.slug, p.name,
               count(u.id) FILTER (WHERE u.is_active),
               count(u.id) FILTER (WHERE u.is_active AND u.status='available'),
               max(u.source_updated_at)
        FROM projects p
        JOIN developers d ON d.id=p.developer_id
        LEFT JOIN phases ph ON ph.project_id=p.id
        LEFT JOIN units u ON u.phase_id=ph.id
        WHERE p.slug=$1
        GROUP BY p.id, d.slug, p.slug, p.name`, slug).Scan(
		&project.ID, &project.DeveloperSlug, &project.Slug, &project.Name,
		&project.TotalUnits, &project.AvailableUnits, &project.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Project{}, ErrNotFound
	}
	if err != nil {
		return domain.Project{}, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT ph.id, ph.slug, ph.name, ph.source_id, ph.property_type, ph.sort_order,
		       ph.address, ph.image_url, ph.floors_total,
		       count(u.id) FILTER (WHERE u.is_active),
		       count(u.id) FILTER (WHERE u.is_active AND u.status='available'),
               max(u.source_updated_at)
        FROM phases ph
        JOIN projects p ON p.id=ph.project_id
		LEFT JOIN units u ON u.phase_id=ph.id
		WHERE p.slug=$1
		GROUP BY ph.id
		HAVING count(u.id) FILTER (WHERE u.is_active) > 0
		ORDER BY ph.sort_order, ph.id`, slug)
	if err != nil {
		return domain.Project{}, err
	}
	defer rows.Close()
	project.Phases = make([]domain.PhaseSummary, 0)
	for rows.Next() {
		var phase domain.PhaseSummary
		if err := rows.Scan(
			&phase.ID, &phase.Slug, &phase.Name, &phase.SourceID, &phase.PropertyType,
			&phase.SortOrder,
			&phase.Address, &phase.ImageURL, &phase.FloorsTotal,
			&phase.TotalUnits, &phase.AvailableUnits, &phase.UpdatedAt,
		); err != nil {
			return domain.Project{}, err
		}
		project.Phases = append(project.Phases, phase)
	}
	return project, rows.Err()
}

func (s *Store) ListUnits(ctx context.Context, filter domain.UnitFilter) (domain.UnitPage, error) {
	var rooms, floorFrom, floorTo, priceFrom, priceTo any
	if filter.Rooms != nil {
		rooms = *filter.Rooms
	}
	if filter.FloorFrom != nil {
		floorFrom = *filter.FloorFrom
	}
	if filter.FloorTo != nil {
		floorTo = *filter.FloorTo
	}
	if filter.PriceFrom != nil {
		priceFrom = *filter.PriceFrom
	}
	if filter.PriceTo != nil {
		priceTo = *filter.PriceTo
	}
	args := []any{filter.ProjectSlug, filter.PhaseSlug, filter.Status, filter.PropertyType, rooms, floorFrom, floorTo, priceFrom, priceTo}
	where := `
        FROM units u
        JOIN phases ph ON ph.id=u.phase_id
        JOIN projects p ON p.id=ph.project_id
        WHERE p.slug=$1 AND u.is_active
          AND ($2='' OR ph.slug=$2)
          AND ($3='' OR u.status=$3)
          AND ($4='' OR u.property_type=$4)
          AND ($5::integer IS NULL OR u.rooms=$5)
          AND ($6::integer IS NULL OR u.floor >= $6)
          AND ($7::integer IS NULL OR u.floor <= $7)
          AND ($8::bigint IS NULL OR u.price >= $8)
          AND ($9::bigint IS NULL OR u.price <= $9)`

	var total int64
	if err := s.pool.QueryRow(ctx, "SELECT count(*) "+where, args...).Scan(&total); err != nil {
		return domain.UnitPage{}, err
	}
	query := `SELECT u.id, u.source_key, p.slug, ph.slug, ph.name,
                    u.property_type, u.raw_property_type, u.status, u.raw_status,
                    u.number, u.entrance, u.floor, u.area::float8, u.rooms,
                    u.price, u.price_per_m2::float8, u.currency, u.plan_image_url,
                    u.is_active, u.source_updated_at, u.updated_at ` + where + `
              ORDER BY ph.id, u.entrance, u.floor, u.number
              LIMIT $10 OFFSET $11`
	rows, err := s.pool.Query(ctx, query, append(args, filter.Limit, filter.Offset)...)
	if err != nil {
		return domain.UnitPage{}, err
	}
	defer rows.Close()
	items := make([]domain.Unit, 0, filter.Limit)
	for rows.Next() {
		item, err := scanUnit(rows)
		if err != nil {
			return domain.UnitPage{}, err
		}
		items = append(items, item)
	}
	return domain.UnitPage{Items: items, Total: total, Limit: filter.Limit, Offset: filter.Offset}, rows.Err()
}

func (s *Store) GetUnit(ctx context.Context, id int64) (domain.Unit, error) {
	row := s.pool.QueryRow(ctx, `
        SELECT u.id, u.source_key, p.slug, ph.slug, ph.name,
               u.property_type, u.raw_property_type, u.status, u.raw_status,
               u.number, u.entrance, u.floor, u.area::float8, u.rooms,
               u.price, u.price_per_m2::float8, u.currency, u.plan_image_url,
               u.is_active, u.source_updated_at, u.updated_at
        FROM units u
        JOIN phases ph ON ph.id=u.phase_id
        JOIN projects p ON p.id=ph.project_id
        WHERE u.id=$1 AND u.is_active`, id)
	item, err := scanUnit(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Unit{}, ErrNotFound
	}
	return item, err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUnit(row rowScanner) (domain.Unit, error) {
	var item domain.Unit
	var rooms sql.NullInt64
	var price sql.NullInt64
	var pricePerM2 sql.NullFloat64
	err := row.Scan(
		&item.ID, &item.SourceKey, &item.ProjectSlug, &item.PhaseSlug, &item.PhaseName,
		&item.PropertyType, &item.RawPropertyType, &item.Status, &item.RawStatus,
		&item.Number, &item.Entrance, &item.Floor, &item.Area, &rooms,
		&price, &pricePerM2, &item.Currency, &item.PlanImageURL,
		&item.IsActive, &item.SourceUpdatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return domain.Unit{}, err
	}
	if rooms.Valid {
		value := int(rooms.Int64)
		item.Rooms = &value
	}
	if price.Valid {
		value := price.Int64
		item.Price = &value
	}
	if pricePerM2.Valid {
		value := pricePerM2.Float64
		item.PricePerM2 = &value
	}
	return item, nil
}

func (s *Store) ListLayouts(ctx context.Context, projectSlug, phaseSlug string) ([]domain.Layout, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT l.id, concat('layout-',l.id), p.slug, ph.slug, l.rooms, l.available_count,
               l.title, l.address, l.price_text, l.image_url, l.thumbnail_url
        FROM layouts l
		JOIN phases ph ON ph.id=l.phase_id
		JOIN projects p ON p.id=ph.project_id
		WHERE p.slug=$1 AND ($2='' OR ph.slug=$2)
		  AND EXISTS(SELECT 1 FROM units u WHERE u.phase_id=ph.id AND u.is_active)
		ORDER BY ph.id, l.rooms NULLS LAST, l.id`, projectSlug, phaseSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Layout, 0)
	for rows.Next() {
		var item domain.Layout
		var rooms sql.NullInt64
		if err := rows.Scan(&item.ID, &item.SourceID, &item.ProjectSlug, &item.PhaseSlug, &rooms, &item.AvailableCount, &item.Title, &item.Address, &item.PriceText, &item.ImageURL, &item.ThumbnailURL); err != nil {
			return nil, err
		}
		if rooms.Valid {
			value := int(rooms.Int64)
			item.Rooms = &value
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) Availability(ctx context.Context, projectSlug, phaseSlug string) ([]domain.Availability, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT u.status, count(*)
        FROM units u
        JOIN phases ph ON ph.id=u.phase_id
        JOIN projects p ON p.id=ph.project_id
        WHERE p.slug=$1 AND u.is_active AND ($2='' OR ph.slug=$2)
        GROUP BY u.status
        ORDER BY u.status`, projectSlug, phaseSlug)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.Availability, 0)
	for rows.Next() {
		var item domain.Availability
		if err := rows.Scan(&item.Status, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) LatestSync(ctx context.Context) ([]domain.SyncStatus, error) {
	rows, err := s.pool.Query(ctx, `
        SELECT DISTINCT ON (source) source, status, started_at, finished_at, records_read, records_saved, error
        FROM sync_runs
        ORDER BY source, started_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.SyncStatus, 0)
	for rows.Next() {
		var item domain.SyncStatus
		if err := rows.Scan(&item.Source, &item.Status, &item.StartedAt, &item.FinishedAt, &item.RecordsRead, &item.RecordsSaved, &item.Error); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CatalogProviderSyncStatus(ctx context.Context) ([]domain.CatalogProviderSyncStatus, error) {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	rows, err := tx.Query(ctx, `
		SELECT provider,last_attempt_status,last_attempt_at,last_success_at,fresh_until,error_code,
		       CASE WHEN fresh_until IS NOT NULL AND fresh_until > CURRENT_TIMESTAMP
		            THEN 'fresh' ELSE 'stale' END
		FROM catalog_sync_providers
		ORDER BY provider`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.CatalogProviderSyncStatus, 0)
	for rows.Next() {
		var item domain.CatalogProviderSyncStatus
		if err := rows.Scan(
			&item.Provider, &item.Status, &item.LastAttemptAt, &item.LastSuccessAt,
			&item.FreshUntil, &item.ErrorCode, &item.Freshness,
		); err != nil {
			return nil, err
		}
		item.Projects = make([]domain.CatalogProjectSyncStatus, 0)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	byProvider := make(map[string]int, len(items))
	for index := range items {
		byProvider[items[index].Provider] = index
	}
	projectRows, err := tx.Query(ctx, `
		SELECT provider,project_slug,last_attempt_status,last_attempt_at,last_success_at,
		       last_captured_at,fresh_until,last_record_count,error_code,
		       CASE WHEN fresh_until IS NOT NULL AND fresh_until > CURRENT_TIMESTAMP
		            THEN 'fresh' ELSE 'stale' END
		FROM catalog_sync_projects
		ORDER BY provider,project_slug`)
	if err != nil {
		return nil, err
	}
	defer projectRows.Close()
	for projectRows.Next() {
		var provider string
		var item domain.CatalogProjectSyncStatus
		if err := projectRows.Scan(
			&provider, &item.ProjectSlug, &item.Status, &item.LastAttemptAt,
			&item.LastSuccessAt, &item.LastCapturedAt, &item.FreshUntil,
			&item.RecordCount, &item.ErrorCode, &item.Freshness,
		); err != nil {
			return nil, err
		}
		index, ok := byProvider[provider]
		if !ok {
			continue
		}
		items[index].Projects = append(items[index].Projects, item)
	}
	if err := projectRows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return items, nil
}

func (s *Store) CreateLead(ctx context.Context, input domain.CreateLeadInput) (domain.Lead, error) {
	if !input.ConsentGiven {
		return domain.Lead{}, ErrConsentRequired
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return domain.Lead{}, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	var projectID int64
	if err := tx.QueryRow(ctx, `SELECT id FROM projects WHERE slug=$1 ORDER BY id LIMIT 1`, input.ProjectSlug).Scan(&projectID); errors.Is(err, pgx.ErrNoRows) {
		return domain.Lead{}, ErrNotFound
	} else if err != nil {
		return domain.Lead{}, err
	}
	if err := enforceLeadCooldown(ctx, tx, projectID, input.Phone, input.MinimumInterval); err != nil {
		return domain.Lead{}, err
	}

	var unitID *int64
	if len(input.UnitReferences) > 0 {
		resolved, err := resolveLeadUnit(ctx, tx, projectID, input.UnitReferences)
		if err != nil {
			return domain.Lead{}, err
		}
		unitID = &resolved
	}
	var lastViewedUnitID *int64
	lastViewedReference := ""
	if len(input.LastViewedReferences) > 0 {
		resolved, err := resolveLeadUnit(ctx, tx, projectID, input.LastViewedReferences)
		if err == nil {
			lastViewedUnitID = &resolved
			lastViewedReference = storedLeadUnitReference(input.LastViewedReferences)
		} else if !isOptionalLastViewedReferenceError(err) {
			return domain.Lead{}, err
		}
	}
	consentAt := input.ConsentAt
	if consentAt.IsZero() {
		consentAt = time.Now().UTC()
	}
	var item domain.Lead
	err = tx.QueryRow(ctx, `
        INSERT INTO leads (
            project_id, unit_id, last_viewed_unit_id, name, phone, goal, language,
            form_context, landing_url, referrer_url, metadata,
			unit_reference, last_viewed_reference, consent_given, consent_at
        )
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15)
		RETURNING id, $16::text, unit_id, last_viewed_unit_id, name, phone, goal, language, form_context,
			consent_given, consent_at, created_at`,
		projectID, unitID, lastViewedUnitID, input.Name, input.Phone, input.Goal,
		input.Language, input.FormContext, input.LandingURL, input.ReferrerURL, input.Metadata,
		storedLeadUnitReference(input.UnitReferences), lastViewedReference,
		input.ConsentGiven, consentAt, input.ProjectSlug,
	).Scan(
		&item.ID, &item.ProjectSlug, &item.UnitID, &item.LastViewedUnitID, &item.Name, &item.Phone,
		&item.Goal, &item.Language, &item.FormContext, &item.ConsentGiven, &item.ConsentAt, &item.CreatedAt,
	)
	if err != nil {
		return domain.Lead{}, err
	}
	item.HasUnit = item.UnitID != nil
	item.HasLastViewed = item.LastViewedUnitID != nil
	if err := tx.Commit(ctx); err != nil {
		return domain.Lead{}, err
	}
	return item, nil
}

func isOptionalLastViewedReferenceError(err error) bool {
	return errors.Is(err, ErrUnitNotFound) ||
		errors.Is(err, ErrUnitProjectMismatch) ||
		errors.Is(err, ErrAmbiguousUnitReference) ||
		errors.Is(err, ErrUnitReferenceMismatch)
}

func enforceLeadCooldown(ctx context.Context, tx pgx.Tx, projectID int64, phone string, minimumInterval time.Duration) error {
	seconds := cooldownSeconds(minimumInterval)
	if seconds == 0 {
		return nil
	}

	// The transaction-scoped lock makes the check-and-insert sequence safe across
	// processes and replicas. The application never logs the key.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, strconv.FormatInt(projectID, 10)+"\x1f"+phone); err != nil {
		return err
	}
	var recent bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1
			FROM leads
			WHERE project_id=$1 AND phone=$2
			  AND created_at > now() - ($3::bigint * interval '1 second')
		)`, projectID, phone, seconds).Scan(&recent); err != nil {
		return err
	}
	if recent {
		return ErrLeadRateLimited
	}
	return nil
}

func cooldownSeconds(duration time.Duration) int64 {
	if duration <= 0 {
		return 0
	}
	return int64((duration-1)/time.Second) + 1
}

type leadUnitQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func resolveLeadUnit(ctx context.Context, query leadUnitQuerier, projectID int64, references []domain.UnitReference) (int64, error) {
	var resolvedID int64
	for _, reference := range references {
		candidateID, err := resolveLeadUnitReference(ctx, query, projectID, reference)
		if err != nil {
			return 0, err
		}
		if resolvedID != 0 && resolvedID != candidateID {
			return 0, ErrUnitReferenceMismatch
		}
		resolvedID = candidateID
	}
	if resolvedID == 0 {
		return 0, ErrUnitNotFound
	}
	return resolvedID, nil
}

func resolveLeadUnitReference(ctx context.Context, query leadUnitQuerier, projectID int64, reference domain.UnitReference) (int64, error) {
	var projectQuery string
	var globalQuery string
	var lookupValue any
	switch reference.Namespace {
	case domain.UnitReferenceInternalID:
		parsed, err := strconv.ParseInt(reference.Value, 10, 64)
		if err != nil || parsed <= 0 {
			return 0, ErrUnitNotFound
		}
		lookupValue = parsed
		projectQuery = `
			SELECT COALESCE(MIN(u.id), 0), COUNT(DISTINCT u.id)
			FROM units u
			JOIN phases ph ON ph.id=u.phase_id
			WHERE ph.project_id=$1 AND u.is_active AND u.id=$2`
		globalQuery = `SELECT EXISTS(SELECT 1 FROM units u WHERE u.is_active AND u.id=$1)`
	case domain.UnitReferenceSourceID:
		if reference.Value == "" {
			return 0, ErrUnitNotFound
		}
		lookupValue = reference.Value
		projectQuery = `
			SELECT COALESCE(MIN(u.id), 0), COUNT(DISTINCT u.id)
			FROM units u
			JOIN phases ph ON ph.id=u.phase_id
			WHERE ph.project_id=$1 AND u.is_active AND u.source_id=$2`
		globalQuery = `SELECT EXISTS(SELECT 1 FROM units u WHERE u.is_active AND u.source_id=$1)`
	case domain.UnitReferenceSourceKey:
		if reference.Value == "" {
			return 0, ErrUnitNotFound
		}
		lookupValue = reference.Value
		projectQuery = `
			SELECT COALESCE(MIN(u.id), 0), COUNT(DISTINCT u.id)
			FROM units u
			JOIN phases ph ON ph.id=u.phase_id
			WHERE ph.project_id=$1 AND u.is_active AND u.source_key=$2`
		globalQuery = `SELECT EXISTS(SELECT 1 FROM units u WHERE u.is_active AND u.source_key=$1)`
	default:
		return 0, ErrUnitNotFound
	}

	var candidateID int64
	var candidateCount int64
	if err := query.QueryRow(ctx, projectQuery, projectID, lookupValue).Scan(&candidateID, &candidateCount); err != nil {
		return 0, err
	}
	if candidateCount == 1 {
		return candidateID, nil
	}
	if candidateCount > 1 {
		return 0, ErrAmbiguousUnitReference
	}

	var existsElsewhere bool
	if err := query.QueryRow(ctx, globalQuery, lookupValue).Scan(&existsElsewhere); err != nil {
		return 0, err
	}
	return classifyUnitCandidates(nil, existsElsewhere)
}

func storedLeadUnitReference(references []domain.UnitReference) string {
	// Prefer the stable public source key for auditability. The legacy columns
	// are length-bounded text, so only one already-validated value is retained;
	// every supplied identity is still independently resolved above.
	for _, namespace := range []domain.UnitReferenceNamespace{
		domain.UnitReferenceSourceKey,
		domain.UnitReferenceSourceID,
		domain.UnitReferenceInternalID,
	} {
		for _, reference := range references {
			if reference.Namespace == namespace {
				return reference.Value
			}
		}
	}
	return ""
}

func classifyUnitCandidates(candidates []int64, existsElsewhere bool) (int64, error) {
	if len(candidates) == 1 {
		return candidates[0], nil
	}
	if len(candidates) > 1 {
		return 0, ErrAmbiguousUnitReference
	}
	if existsElsewhere {
		return 0, ErrUnitProjectMismatch
	}
	return 0, ErrUnitNotFound
}

func ClampPagination(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}
