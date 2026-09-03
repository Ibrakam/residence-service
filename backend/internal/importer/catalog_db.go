package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

// PreparedCatalogImport is the fully decoded and validated input to a catalog
// database transaction. Preparing once prevents the guard and the importer
// from observing different file contents if a producer modifies its output.
type PreparedCatalogImport struct {
	Bundles        []CatalogBundle
	FloorArtifacts map[string]domain.FloorSchemeArtifact
}

// CatalogImportOptions lets a coordinator associate an atomic catalog import
// with a provider-specific sync run that started before the capture step.
// Existing callers can continue to use ImportCatalogDirectory, which creates a
// versioned-website-catalog run automatically.
type CatalogImportOptions struct {
	Source    string
	SyncRunID int64
	Finalize  func(context.Context, pgx.Tx, CatalogImportResult) error
}

type CatalogImportResult struct {
	SyncRunID            int64 `json:"syncRunId"`
	Files                int   `json:"files"`
	Projects             int   `json:"projects"`
	RecordsRead          int   `json:"recordsRead"`
	RecordsSaved         int   `json:"recordsSaved"`
	DuplicatesSkipped    int   `json:"duplicatesSkipped"`
	PartialRecords       int   `json:"partialRecords"`
	FloorSchemeArtifacts int   `json:"floorSchemeArtifacts"`
}

func ImportCatalogDirectory(ctx context.Context, pool *pgxpool.Pool, dir string) (CatalogImportResult, error) {
	prepared, err := PrepareCatalogDirectory(dir)
	if err != nil {
		return CatalogImportResult{}, err
	}
	return ImportPreparedCatalog(ctx, pool, prepared, CatalogImportOptions{Source: CatalogSource})
}

// PrepareCatalogDirectory loads every catalog and companion artifact before a
// database run starts. No database state is changed if preparation fails.
func PrepareCatalogDirectory(dir string) (PreparedCatalogImport, error) {
	bundles, err := LoadCatalogDirectory(dir)
	if err != nil {
		return PreparedCatalogImport{}, err
	}
	floorArtifacts, err := LoadGeneratedFloorSchemeArtifacts(dir, bundles)
	if err != nil {
		return PreparedCatalogImport{}, err
	}
	return PreparedCatalogImport{Bundles: bundles, FloorArtifacts: floorArtifacts}, nil
}

// ImportPreparedCatalog applies one prepared provider payload in a single
// PostgreSQL transaction. Unit deactivation, upserts, provenance, and the
// successful run marker commit together; any failure preserves the previous
// accepted catalog.
func ImportPreparedCatalog(ctx context.Context, pool *pgxpool.Pool, prepared PreparedCatalogImport, options CatalogImportOptions) (CatalogImportResult, error) {
	source := strings.TrimSpace(options.Source)
	if source == "" || strings.ContainsRune(source, '\x00') {
		return CatalogImportResult{}, errors.New("catalog import source is required")
	}
	bundles := prepared.Bundles
	floorArtifacts := prepared.FloorArtifacts
	if len(bundles) == 0 {
		return CatalogImportResult{}, errors.New("prepared catalog has no bundles")
	}
	result := CatalogImportResult{Files: len(bundles), FloorSchemeArtifacts: len(floorArtifacts)}
	for _, bundle := range bundles {
		result.Projects += len(bundle.Projects)
		for _, project := range bundle.Projects {
			result.RecordsRead += len(project.Units) + project.DuplicateUnits
			result.DuplicatesSkipped += project.DuplicateUnits
			if !project.Complete {
				result.PartialRecords += len(project.Units)
			}
		}
	}
	result.SyncRunID = options.SyncRunID
	if result.SyncRunID == 0 {
		if err := pool.QueryRow(ctx, `
			INSERT INTO sync_runs(source,status,records_read)
			VALUES($1,'running',$2)
			RETURNING id`, source, result.RecordsRead).Scan(&result.SyncRunID); err != nil {
			return CatalogImportResult{}, fmt.Errorf("start catalog sync run: %w", err)
		}
	} else {
		tag, err := pool.Exec(ctx, `
			UPDATE sync_runs SET records_read=$3
			WHERE id=$1 AND source=$2 AND status='running'`, result.SyncRunID, source, result.RecordsRead)
		if err != nil {
			return result, fmt.Errorf("attach catalog sync run: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return result, errors.New("catalog sync run is missing, completed, or belongs to another source")
		}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("begin catalog import: %w", err))
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('catalog_import',0))`); err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("lock catalog import: %w", err))
	}

	developerIDs := make(map[string]int64)
	for _, bundle := range bundles {
		for _, project := range bundle.Projects {
			projectContentChecksum, err := CatalogProjectContentChecksum(project)
			if err != nil {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("checksum catalog project %s: %w", project.Slug, err))
			}
			developerID, ok := developerIDs[project.DeveloperSlug]
			if !ok {
				if err := tx.QueryRow(ctx, `
					INSERT INTO developers(slug,name) VALUES($1,$2)
					ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,updated_at=now()
					RETURNING id`, project.DeveloperSlug, project.DeveloperName).Scan(&developerID); err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("upsert developer %s: %w", project.DeveloperSlug, err))
				}
				developerIDs[project.DeveloperSlug] = developerID
			}

			var projectID int64
			if err := tx.QueryRow(ctx, `
				INSERT INTO projects(developer_id,slug,name,source_id,source_url,source_payload)
				VALUES($1,$2,$3,$4,$5,$6::jsonb)
				ON CONFLICT(developer_id,slug) DO UPDATE SET
					name=EXCLUDED.name,
					source_id=COALESCE(NULLIF(EXCLUDED.source_id,''),projects.source_id),
					source_url=COALESCE(NULLIF(EXCLUDED.source_url,''),projects.source_url),
					source_payload=EXCLUDED.source_payload,
					updated_at=now()
				RETURNING id`, developerID, project.Slug, project.Name, project.SourceID,
				project.SourceURL, jsonText(project.SourcePayload)).Scan(&projectID); err != nil {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("upsert project %s: %w", project.Slug, err))
			}
			var lastAcceptedAt *time.Time
			if err := tx.QueryRow(ctx, `
				SELECT max(units.source_updated_at)
				FROM units
				JOIN phases ON phases.id=units.phase_id
				WHERE phases.project_id=$1`, projectID).Scan(&lastAcceptedAt); err != nil {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("read accepted capture time for %s: %w", project.Slug, err))
			}
			if lastAcceptedAt != nil && project.CapturedAt.Before(*lastAcceptedAt) {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("catalog project %s capture time regressed", project.Slug))
			}

			if project.Complete {
				if _, err := tx.Exec(ctx, `
					UPDATE units SET is_active=false,updated_at=now()
					WHERE phase_id IN (SELECT id FROM phases WHERE project_id=$1)`, projectID); err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("deactivate complete project %s: %w", project.Slug, err))
				}
			}

			phaseIDs := make(map[string]int64, len(project.Phases))
			for _, phase := range project.Phases {
				phaseID, err := upsertCatalogPhase(ctx, tx, projectID, phase, project.CapturedAt)
				if err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("upsert phase %s/%s: %w", project.Slug, phase.Slug, err))
				}
				phaseIDs[phase.Slug] = phaseID
			}

			for _, unit := range project.Units {
				phaseID, ok := phaseIDs[unit.PhaseSlug]
				if !ok {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("unit %s references unknown phase %s", unit.SourceKey, unit.PhaseSlug))
				}
				if err := upsertUnit(ctx, tx, phaseID, project.CapturedAt, unit); err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("upsert unit %s/%s: %w", project.Slug, unit.SourceKey, err))
				}
				result.RecordsSaved++
			}
			if artifact, ok := floorArtifacts[project.Slug]; ok {
				if err := persistGeneratedFloorSchemeArtifact(ctx, tx, projectID, artifact); err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("persist generated floor-scheme artifact for %s: %w", project.Slug, err))
				}
			}

			if len(project.Layouts) > 0 {
				if project.Complete {
					if _, err := tx.Exec(ctx, `DELETE FROM layouts WHERE phase_id IN (SELECT id FROM phases WHERE project_id=$1)`, projectID); err != nil {
						return failCatalogRun(ctx, pool, result, fmt.Errorf("replace layouts for %s: %w", project.Slug, err))
					}
				}
				for _, layout := range project.Layouts {
					phaseID := phaseIDs[layout.PhaseSlug]
					if phaseID == 0 && len(project.Phases) == 1 {
						phaseID = phaseIDs[project.Phases[0].Slug]
					}
					if phaseID == 0 {
						return failCatalogRun(ctx, pool, result, fmt.Errorf("layout %s references unknown phase %s", layout.SourceID, layout.PhaseSlug))
					}
					if _, err := tx.Exec(ctx, `
						INSERT INTO layouts(phase_id,source_id,rooms,available_count,title,address,price_text,image_url,thumbnail_url,source_updated_at)
						VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
						ON CONFLICT(phase_id,source_id) DO UPDATE SET
							rooms=EXCLUDED.rooms,available_count=EXCLUDED.available_count,title=EXCLUDED.title,
							address=EXCLUDED.address,price_text=EXCLUDED.price_text,image_url=EXCLUDED.image_url,
							thumbnail_url=EXCLUDED.thumbnail_url,source_updated_at=EXCLUDED.source_updated_at,updated_at=now()`,
						phaseID, layout.SourceID, layout.Rooms, layout.AvailableCount, layout.Title,
						layout.Address, layout.PriceText, layout.ImageURL, layout.ThumbnailURL, project.CapturedAt); err != nil {
						return failCatalogRun(ctx, pool, result, fmt.Errorf("upsert layout %s: %w", layout.SourceID, err))
					}
				}
			}

			snapshotSourceID := project.Slug
			if project.SourceID != "" {
				snapshotSourceID += ":" + project.SourceID
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO source_snapshots(
					sync_run_id,source,source_id,path,checksum_sha256,record_count,captured_at,
					project_slug,source_url,schema_name,is_complete,official_record_count,metadata,
					content_checksum_sha256
				) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)
				ON CONFLICT(source,source_id,checksum_sha256) DO NOTHING`,
				result.SyncRunID, source, snapshotSourceID, filepath.Base(bundle.Path), bundle.Checksum,
				len(project.Units), project.CapturedAt, project.Slug, project.SourceURL, bundle.SchemaName,
				project.Complete, project.OfficialCount, jsonText(project.SourcePayload), projectContentChecksum); err != nil {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("record catalog snapshot %s: %w", project.Slug, err))
			}
		}
	}

	if options.Finalize != nil {
		if err := options.Finalize(ctx, tx, result); err != nil {
			return failCatalogRun(ctx, pool, result, fmt.Errorf("finalize catalog provider state: %w", err))
		}
	}

	tag, err := tx.Exec(ctx, `
		UPDATE sync_runs
		SET status='succeeded',finished_at=now(),records_read=$3,records_saved=$4,error=''
		WHERE id=$1 AND source=$2 AND status='running'`,
		result.SyncRunID, source, result.RecordsRead, result.RecordsSaved)
	if err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("finish catalog sync run: %w", err))
	}
	if tag.RowsAffected() != 1 {
		return failCatalogRun(ctx, pool, result, errors.New("catalog sync run changed while importing"))
	}
	if err := tx.Commit(ctx); err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("commit catalog import: %w", err))
	}
	return result, nil
}

// upsertCatalogPhase reconciles the two stable phase identities before
// writing. Older versioned catalogs used human-readable slugs while live
// providers may use a different slug for the same source ID. Updating the
// existing row preserves unit/layout foreign keys and avoids conflicting with
// the independent (project_id, source_id) and (project_id, slug) constraints.
func upsertCatalogPhase(ctx context.Context, tx pgx.Tx, projectID int64, phase CatalogPhase, capturedAt time.Time) (int64, error) {
	rows, err := tx.Query(ctx, `
		SELECT id
		FROM phases
		WHERE project_id=$1 AND (source_id=$2 OR slug=$3)
		ORDER BY id
		FOR UPDATE`, projectID, phase.SourceID, phase.Slug)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var phaseIDs []int64
	for rows.Next() {
		var phaseID int64
		if err := rows.Scan(&phaseID); err != nil {
			return 0, err
		}
		phaseIDs = append(phaseIDs, phaseID)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(phaseIDs) > 1 {
		return 0, fmt.Errorf("source ID %q and slug %q resolve to different phase rows", phase.SourceID, phase.Slug)
	}

	if len(phaseIDs) == 1 {
		var phaseID int64
		if err := tx.QueryRow(ctx, `
			UPDATE phases SET
				source_id=$2,slug=$3,name=$4,property_type=$5,sort_order=$6,address=$7,image_url=$8,
				floors_total=$9,source_updated_at=$10,source_url=$11,source_payload=$12::jsonb,updated_at=now()
			WHERE id=$1
			RETURNING id`, phaseIDs[0], phase.SourceID, phase.Slug, phase.Name, phase.PropertyType,
			phase.SortOrder, phase.Address, phase.ImageURL, phase.FloorsTotal, capturedAt,
			phase.SourceURL, jsonText(phase.SourcePayload)).Scan(&phaseID); err != nil {
			return 0, err
		}
		return phaseID, nil
	}

	var phaseID int64
	if err := tx.QueryRow(ctx, `
		INSERT INTO phases(
			project_id,source_id,slug,name,property_type,sort_order,address,image_url,
			floors_total,source_updated_at,source_url,source_payload
		) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
		RETURNING id`, projectID, phase.SourceID, phase.Slug, phase.Name, phase.PropertyType,
		phase.SortOrder, phase.Address, phase.ImageURL, phase.FloorsTotal, capturedAt,
		phase.SourceURL, jsonText(phase.SourcePayload)).Scan(&phaseID); err != nil {
		return 0, err
	}
	return phaseID, nil
}

func failCatalogRun(ctx context.Context, pool *pgxpool.Pool, result CatalogImportResult, cause error) (CatalogImportResult, error) {
	// Every mutation is rolled back with the import transaction, so a failed
	// run must never claim that partially attempted rows were saved.
	result.RecordsSaved = 0
	_, _ = pool.Exec(ctx, `
		UPDATE sync_runs SET status='failed',finished_at=now(),records_saved=$2,error=$3 WHERE id=$1`,
		result.SyncRunID, result.RecordsSaved, cause.Error())
	return result, cause
}

func jsonText(value json.RawMessage) string {
	if len(value) == 0 || !json.Valid(value) {
		return "{}"
	}
	return string(value)
}
