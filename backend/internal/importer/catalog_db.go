package importer

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
	bundles, err := LoadCatalogDirectory(dir)
	if err != nil {
		return CatalogImportResult{}, err
	}
	floorArtifacts, err := LoadGeneratedFloorSchemeArtifacts(dir, bundles)
	if err != nil {
		return CatalogImportResult{}, err
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
	if err := pool.QueryRow(ctx, `
		INSERT INTO sync_runs(source,status,records_read)
		VALUES($1,'running',$2)
		RETURNING id`, CatalogSource, result.RecordsRead).Scan(&result.SyncRunID); err != nil {
		return CatalogImportResult{}, fmt.Errorf("start catalog sync run: %w", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("begin catalog import: %w", err))
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	developerIDs := make(map[string]int64)
	for _, bundle := range bundles {
		for _, project := range bundle.Projects {
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

			if project.Complete {
				if _, err := tx.Exec(ctx, `
					UPDATE units SET is_active=false,updated_at=now()
					WHERE phase_id IN (SELECT id FROM phases WHERE project_id=$1)`, projectID); err != nil {
					return failCatalogRun(ctx, pool, result, fmt.Errorf("deactivate complete project %s: %w", project.Slug, err))
				}
			}

			phaseIDs := make(map[string]int64, len(project.Phases))
			for _, phase := range project.Phases {
				var phaseID int64
				if err := tx.QueryRow(ctx, `
					INSERT INTO phases(
						project_id,source_id,slug,name,property_type,sort_order,address,image_url,
						floors_total,source_updated_at,source_url,source_payload
					) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
					ON CONFLICT(project_id,slug) DO UPDATE SET
						source_id=EXCLUDED.source_id,name=EXCLUDED.name,property_type=EXCLUDED.property_type,
						sort_order=EXCLUDED.sort_order,address=EXCLUDED.address,image_url=EXCLUDED.image_url,
						floors_total=EXCLUDED.floors_total,source_updated_at=EXCLUDED.source_updated_at,
						source_url=EXCLUDED.source_url,source_payload=EXCLUDED.source_payload,updated_at=now()
					RETURNING id`, projectID, phase.SourceID, phase.Slug, phase.Name, phase.PropertyType,
					phase.SortOrder, phase.Address, phase.ImageURL, phase.FloorsTotal, project.CapturedAt,
					phase.SourceURL, jsonText(phase.SourcePayload)).Scan(&phaseID); err != nil {
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
					project_slug,source_url,schema_name,is_complete,official_record_count,metadata
				) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb)
				ON CONFLICT(source,source_id,checksum_sha256) DO NOTHING`,
				result.SyncRunID, CatalogSource, snapshotSourceID, filepath.Base(bundle.Path), bundle.Checksum,
				len(project.Units), project.CapturedAt, project.Slug, project.SourceURL, bundle.SchemaName,
				project.Complete, project.OfficialCount, jsonText(project.SourcePayload)); err != nil {
				return failCatalogRun(ctx, pool, result, fmt.Errorf("record catalog snapshot %s: %w", project.Slug, err))
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return failCatalogRun(ctx, pool, result, fmt.Errorf("commit catalog import: %w", err))
	}
	if _, err := pool.Exec(ctx, `
		UPDATE sync_runs SET status='succeeded',finished_at=now(),records_saved=$2 WHERE id=$1`,
		result.SyncRunID, result.RecordsSaved); err != nil {
		return result, fmt.Errorf("finish catalog sync run: %w", err)
	}
	return result, nil
}

func failCatalogRun(ctx context.Context, pool *pgxpool.Pool, result CatalogImportResult, cause error) (CatalogImportResult, error) {
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
