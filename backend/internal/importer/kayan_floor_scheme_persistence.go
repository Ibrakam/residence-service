package importer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

type floorSchemeUnitResolver func(sourceKey, entrance string, floor int, unitNumber string) (string, error)

// buildPublicFloorSchemeArtifact creates the only representation that may be
// persisted or returned by the API. The raw companion's tenant, account,
// house and route metadata is intentionally unavailable here.
func buildPublicFloorSchemeArtifact(snapshot NormalizedSnapshot, resolveUnit floorSchemeUnitResolver) (domain.FloorSchemeArtifact, error) {
	if snapshot.FloorSchemeAudit == nil {
		return domain.FloorSchemeArtifact{}, errors.New("floor-scheme audit is missing")
	}
	audit := snapshot.FloorSchemeAudit
	if audit.ProjectSlug != snapshot.House.ProjectSlug {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("floor-scheme audit project %q does not match snapshot project %q", audit.ProjectSlug, snapshot.House.ProjectSlug)
	}
	if audit.SchemeCount != len(snapshot.FloorSchemes) {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("floor-scheme audit declares %d schemes, normalized snapshot has %d", audit.SchemeCount, len(snapshot.FloorSchemes))
	}

	artifact := domain.FloorSchemeArtifact{
		SchemaVersion:        audit.SchemaVersion,
		ProjectSlug:          audit.ProjectSlug,
		CapturedAt:           cloneTime(audit.CapturedAt),
		CaptureStatus:        audit.CaptureStatus,
		CaptureScope:         publicFloorSchemeCaptureScope(audit.CaptureScope),
		SourceStatus:         audit.SourceStatus,
		SourceObservedAt:     audit.ObservedAt,
		FloorSchemeCount:     audit.SchemeCount,
		HotspotCount:         audit.HotspotCount,
		BlockEntranceMapping: cloneBlockEntranceMapping(audit.BlockEntranceMapping),
		Schemes:              make([]domain.FloorScheme, 0, len(snapshot.FloorSchemes)),
	}
	if audit.CompanionEvidence != nil {
		artifact.CompanionEvidence = &domain.FloorSchemeCompanionEvidence{
			Source: audit.CompanionEvidence.Source, SourceObservedAt: audit.CompanionEvidence.SourceObservedAt,
			RecordCount: audit.CompanionEvidence.RecordCount, UnitNumbers: append([]string(nil), audit.CompanionEvidence.UnitNumbers...),
			RecordsSHA256: audit.CompanionEvidence.RecordsSHA256,
		}
	}
	if audit.ExpectedUniverse != nil {
		artifact.ExpectedUniverse = &domain.FloorSchemeExpectedUniverse{
			SourceObservedAt:           audit.ExpectedUniverse.SourceObservedAt,
			ExpectedManifestByteSHA256: audit.ExpectedUniverse.ExpectedManifestByteSHA256,
			SchemeCount:                audit.ExpectedUniverse.SchemeCount,
			UnitCount:                  audit.ExpectedUniverse.UnitCount,
			LockedSnapshotUnitCount:    audit.ExpectedUniverse.LockedSnapshotUnitCount,
			CompanionUnitCount:         audit.ExpectedUniverse.CompanionUnitCount,
			Assignments:                make([]domain.FloorSchemeExpectedUniverseAssignment, 0, len(audit.ExpectedUniverse.Assignments)),
		}
		for _, assignment := range audit.ExpectedUniverse.Assignments {
			var unitKey *string
			if assignment.UnitSourceKey != "" {
				value := assignment.UnitSourceKey
				unitKey = &value
			}
			artifact.ExpectedUniverse.Assignments = append(artifact.ExpectedUniverse.Assignments, domain.FloorSchemeExpectedUniverseAssignment{
				Entrance: assignment.Entrance, Floor: assignment.Floor,
				UnitNumber: assignment.UnitNumber, UnitKey: unitKey, Evidence: assignment.Evidence,
			})
		}
	}

	hotspotCount := 0
	seenUnitKeys := make(map[string]struct{}, audit.HotspotCount)
	seenUnitNumbers := make(map[string]struct{}, audit.HotspotCount)
	for schemeIndex, scheme := range snapshot.FloorSchemes {
		item := domain.FloorScheme{
			Entrance: scheme.Entrance, Floor: scheme.Floor,
			ImageURL: scheme.ImageURL, ImageSHA256: scheme.ImageSHA256, ImageBytes: scheme.ImageBytes,
			Width: scheme.Width, Height: scheme.Height, SourceScreenshotSHA256: scheme.SourceScreenshotSHA256,
			SourceCrop: domain.FloorSchemeImageRectangle{X: scheme.SourceCrop.X, Y: scheme.SourceCrop.Y, Width: scheme.SourceCrop.Width, Height: scheme.SourceCrop.Height},
			Zones:      make([]domain.FloorSchemeZone, 0, len(scheme.Zones)),
		}
		for zoneIndex, zone := range scheme.Zones {
			var publicUnitKey *string
			if zone.UnitSourceKey != "" {
				if resolveUnit == nil {
					return domain.FloorSchemeArtifact{}, errors.New("floor-scheme unit resolver is required for locked-snapshot zones")
				}
				unitKey, err := resolveUnit(zone.UnitSourceKey, scheme.Entrance, scheme.Floor, zone.UnitNumber)
				if err != nil {
					return domain.FloorSchemeArtifact{}, fmt.Errorf("floor scheme %d zone %d verify canonical unit: %w", schemeIndex+1, zoneIndex+1, err)
				}
				if unitKey == "" || unitKey != zone.UnitSourceKey {
					return domain.FloorSchemeArtifact{}, fmt.Errorf("floor scheme %d zone %d resolved inconsistent canonical unitKey", schemeIndex+1, zoneIndex+1)
				}
				if _, duplicate := seenUnitKeys[unitKey]; duplicate {
					return domain.FloorSchemeArtifact{}, fmt.Errorf("floor scheme %d zone %d repeats canonical unitKey %q", schemeIndex+1, zoneIndex+1, unitKey)
				}
				seenUnitKeys[unitKey] = struct{}{}
				value := unitKey
				publicUnitKey = &value
			} else if zone.Evidence != "official-public-companion" || audit.CompanionEvidence == nil || !containsString(audit.CompanionEvidence.UnitNumbers, zone.UnitNumber) {
				return domain.FloorSchemeArtifact{}, fmt.Errorf("floor scheme %d zone %d has no locked sourceKey or official companion proof", schemeIndex+1, zoneIndex+1)
			}
			if _, duplicate := seenUnitNumbers[zone.UnitNumber]; duplicate {
				return domain.FloorSchemeArtifact{}, fmt.Errorf("floor scheme %d zone %d repeats apartment %q", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
			}
			seenUnitNumbers[zone.UnitNumber] = struct{}{}
			item.Zones = append(item.Zones, domain.FloorSchemeZone{
				UnitKey:    publicUnitKey,
				UnitNumber: zone.UnitNumber,
				Points:     zone.Points,
				Label:      domain.FloorSchemeLabel{X: zone.LabelX, Y: zone.LabelY},
			})
			hotspotCount++
		}
		artifact.Schemes = append(artifact.Schemes, item)
	}
	if hotspotCount != artifact.HotspotCount {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("floor-scheme audit declares %d hotspots, public artifact has %d", artifact.HotspotCount, hotspotCount)
	}
	canonicalizeFloorSchemeArtifactTimes(&artifact)

	checksum, err := floorSchemeArtifactChecksum(artifact)
	if err != nil {
		return domain.FloorSchemeArtifact{}, err
	}
	artifact.BackendAPIArtifactSHA256 = checksum
	return artifact, nil
}

func canonicalizeFloorSchemeArtifactTimes(artifact *domain.FloorSchemeArtifact) {
	if artifact.CapturedAt != nil {
		value := artifact.CapturedAt.UTC().Truncate(time.Microsecond)
		artifact.CapturedAt = &value
	}
	artifact.SourceObservedAt = artifact.SourceObservedAt.UTC().Truncate(time.Microsecond)
	if artifact.ExpectedUniverse != nil {
		artifact.ExpectedUniverse.SourceObservedAt = artifact.ExpectedUniverse.SourceObservedAt.UTC().Truncate(time.Microsecond)
	}
	if artifact.CompanionEvidence != nil {
		artifact.CompanionEvidence.SourceObservedAt = artifact.CompanionEvidence.SourceObservedAt.UTC().Truncate(time.Microsecond)
	}
}

func floorSchemeArtifactChecksum(artifact domain.FloorSchemeArtifact) (string, error) {
	artifact.BackendAPIArtifactSHA256 = ""
	body, err := json.Marshal(artifact)
	if err != nil {
		return "", fmt.Errorf("encode sanitized floor-scheme checksum payload: %w", err)
	}
	digest := sha256.Sum256(body)
	return hex.EncodeToString(digest[:]), nil
}

func publicFloorSchemeCaptureScope(scope floorSchemeCaptureScope) domain.FloorSchemeCaptureScope {
	result := domain.FloorSchemeCaptureScope{
		Mode:                 scope.Mode,
		DeclaredBlocks:       append([]int(nil), scope.DeclaredBlocks...),
		DeclaredEntrances:    append([]string(nil), scope.DeclaredEntrances...),
		DeclaredFloors:       make([]domain.FloorSchemeScopeFloor, 0, len(scope.DeclaredFloors)),
		DeclaredUnitHotspots: make([]domain.FloorSchemeScopeUnitHotspot, 0, len(scope.DeclaredUnitHotspots)),
		SchemeCount:          scope.SchemeCount,
		HotspotCount:         scope.HotspotCount,
		AuditedExclusions:    make([]domain.FloorSchemeAuditedExclusion, 0, len(scope.AuditedExclusions)),
	}
	for _, floor := range scope.DeclaredFloors {
		result.DeclaredFloors = append(result.DeclaredFloors, domain.FloorSchemeScopeFloor{
			Entrance: floor.Entrance, Floor: floor.Floor,
		})
	}
	for _, hotspot := range scope.DeclaredUnitHotspots {
		result.DeclaredUnitHotspots = append(result.DeclaredUnitHotspots, domain.FloorSchemeScopeUnitHotspot{
			Entrance: hotspot.Entrance, Floor: hotspot.Floor, UnitNumber: hotspot.UnitNumber,
		})
	}
	for _, exclusion := range scope.AuditedExclusions {
		result.AuditedExclusions = append(result.AuditedExclusions, domain.FloorSchemeAuditedExclusion{
			Kind: exclusion.Kind, Reason: exclusion.Reason, Evidence: exclusion.Evidence,
		})
	}
	return result
}

func cloneTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func persistFloorSchemeArtifact(ctx context.Context, tx pgx.Tx, projectID, phaseID int64, snapshot NormalizedSnapshot) error {
	if snapshot.FloorSchemeAudit == nil {
		return nil
	}
	artifact, err := buildPublicFloorSchemeArtifact(snapshot, func(sourceKey, entrance string, floor int, unitNumber string) (string, error) {
		var verifiedSourceKey string
		err := tx.QueryRow(ctx, `
			SELECT source_key
			FROM units
			WHERE phase_id=$1 AND is_active AND source_key=$2 AND entrance=$3 AND floor=$4 AND number=$5`,
			phaseID, sourceKey, entrance, floor, unitNumber,
		).Scan(&verifiedSourceKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("active unit %q does not match entrance %q floor %d apartment %q", sourceKey, entrance, floor, unitNumber)
		}
		if err != nil {
			return "", err
		}
		return verifiedSourceKey, nil
	})
	if err != nil {
		return err
	}
	return upsertFloorSchemeArtifact(ctx, tx, projectID, artifact)
}

const generatedFloorSchemeUnitLookupSQL = `
	SELECT u.source_key
	FROM units u
	JOIN phases ph ON ph.id=u.phase_id
	WHERE ph.project_id=$1 AND ph.slug=$2 AND u.is_active
	  AND u.property_type='apartment' AND u.source_key=$3
	  AND u.entrance=$4 AND u.floor=$5 AND u.number=$6`

func persistGeneratedFloorSchemeArtifact(ctx context.Context, tx pgx.Tx, projectID int64, artifact domain.FloorSchemeArtifact) error {
	for schemeIndex, scheme := range artifact.Schemes {
		phaseSlug := scheme.PhaseSlug
		if artifact.SchemaVersion == floorSchemeMappingSchemaVersion {
			phaseSlug = "main"
		}
		if phaseSlug == "" {
			return fmt.Errorf("floor scheme %d has no phaseSlug", schemeIndex+1)
		}
		for zoneIndex, zone := range scheme.Zones {
			if zone.UnitKey == nil {
				if artifact.SchemaVersion == floorSchemeMappingSchemaVersion {
					if artifact.CompanionEvidence == nil || !containsString(artifact.CompanionEvidence.UnitNumbers, zone.UnitNumber) {
						return fmt.Errorf("floor scheme %d zone %d apartment %q has null unitKey without official companion evidence", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
					}
					wantEntrance, wantFloor, official := officialMiradorUnitLocation(zone.UnitNumber)
					if !official || wantEntrance != scheme.Entrance || wantFloor != scheme.Floor {
						return fmt.Errorf("floor scheme %d zone %d companion apartment is outside the official tuple universe", schemeIndex+1, zoneIndex+1)
					}
				} else if artifact.SchemaVersion != floorSchemeMappingSchemaVersionV3 || !containsFloorSchemeCompanionRecord(artifact.CompanionEvidence, phaseSlug, scheme.Entrance, scheme.Floor, zone.UnitNumber) {
					return fmt.Errorf("floor scheme %d zone %d apartment %q has null unitKey without exact phase-aware companion evidence", schemeIndex+1, zoneIndex+1, zone.UnitNumber)
				}
				continue
			}
			var verifiedSourceKey string
			err := tx.QueryRow(ctx, generatedFloorSchemeUnitLookupSQL,
				projectID, phaseSlug, *zone.UnitKey, scheme.Entrance, scheme.Floor, zone.UnitNumber,
			).Scan(&verifiedSourceKey)
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("floor scheme %d zone %d canonical unitKey %q no longer matches the imported unit tuple", schemeIndex+1, zoneIndex+1, *zone.UnitKey)
			}
			if err != nil {
				return err
			}
			if verifiedSourceKey != *zone.UnitKey {
				return fmt.Errorf("floor scheme %d zone %d resolved inconsistent canonical unitKey", schemeIndex+1, zoneIndex+1)
			}
		}
	}
	return upsertFloorSchemeArtifact(ctx, tx, projectID, artifact)
}

func containsFloorSchemeCompanionRecord(companion *domain.FloorSchemeCompanionEvidence, phaseSlug, entrance string, floor int, unitNumber string) bool {
	if companion == nil {
		return false
	}
	for _, record := range companion.Records {
		if record.PhaseSlug == phaseSlug && record.Entrance == entrance && record.Floor == floor && record.UnitNumber == unitNumber {
			return true
		}
	}
	return false
}

const upsertFloorSchemeArtifactSQL = `
	INSERT INTO project_floor_scheme_artifacts(
		project_id, schema_version, capture_status, capture_scope, captured_at,
		source_status, source_observed_at, floor_scheme_count, hotspot_count,
		block_entrance_mapping, schemes, expected_universe, companion_evidence, sidecar_byte_sha256, artifact_sha256
	) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15)
	ON CONFLICT(project_id) DO UPDATE SET
		schema_version=EXCLUDED.schema_version,
		capture_status=EXCLUDED.capture_status,
		capture_scope=EXCLUDED.capture_scope,
		captured_at=EXCLUDED.captured_at,
		source_status=EXCLUDED.source_status,
		source_observed_at=EXCLUDED.source_observed_at,
		floor_scheme_count=EXCLUDED.floor_scheme_count,
		hotspot_count=EXCLUDED.hotspot_count,
		block_entrance_mapping=EXCLUDED.block_entrance_mapping,
		schemes=EXCLUDED.schemes,
		expected_universe=EXCLUDED.expected_universe,
		companion_evidence=EXCLUDED.companion_evidence,
		sidecar_byte_sha256=EXCLUDED.sidecar_byte_sha256,
		artifact_sha256=EXCLUDED.artifact_sha256,
		updated_at=now()
	WHERE
		EXCLUDED.schema_version >= project_floor_scheme_artifacts.schema_version
		AND (
		(project_floor_scheme_artifacts.capture_status='blocked-by-authentication'
		 AND EXCLUDED.capture_status='blocked-by-authentication'
		 AND EXCLUDED.source_observed_at >= project_floor_scheme_artifacts.source_observed_at)
		OR
		(project_floor_scheme_artifacts.capture_status='blocked-by-authentication'
		 AND EXCLUDED.capture_status='not-published-by-source'
		 AND EXCLUDED.source_observed_at >= project_floor_scheme_artifacts.source_observed_at)
		OR
		(project_floor_scheme_artifacts.capture_status='not-published-by-source'
		 AND EXCLUDED.capture_status='not-published-by-source'
		 AND EXCLUDED.source_observed_at >= project_floor_scheme_artifacts.source_observed_at)
		OR
		(project_floor_scheme_artifacts.capture_status='blocked-by-authentication'
		 AND EXCLUDED.capture_status IN ('captured-complete','captured-partial'))
		OR
		(project_floor_scheme_artifacts.capture_status='not-published-by-source'
		 AND EXCLUDED.capture_status IN ('captured-complete','captured-partial')
		 AND EXCLUDED.source_observed_at >= project_floor_scheme_artifacts.source_observed_at)
		OR
		(project_floor_scheme_artifacts.capture_status IN ('captured-complete','captured-partial')
		 AND EXCLUDED.capture_status IN ('captured-complete','captured-partial')
		 AND EXCLUDED.captured_at >= project_floor_scheme_artifacts.captured_at
		 AND NOT (project_floor_scheme_artifacts.capture_status='captured-complete' AND EXCLUDED.capture_status='captured-partial')))`

func floorSchemeArtifactMayReplace(existing, incoming domain.FloorSchemeArtifact) bool {
	if incoming.SchemaVersion < existing.SchemaVersion {
		return false
	}
	if existing.CaptureStatus == "blocked-by-authentication" {
		if incoming.CaptureStatus == "blocked-by-authentication" {
			return !incoming.SourceObservedAt.Before(existing.SourceObservedAt)
		}
		if incoming.CaptureStatus == "not-published-by-source" {
			return !incoming.SourceObservedAt.Before(existing.SourceObservedAt)
		}
		return isCapturedFloorSchemeStatus(incoming.CaptureStatus)
	}
	if existing.CaptureStatus == "not-published-by-source" {
		if incoming.CaptureStatus == "not-published-by-source" {
			return !incoming.SourceObservedAt.Before(existing.SourceObservedAt)
		}
		return isCapturedFloorSchemeStatus(incoming.CaptureStatus) && !incoming.SourceObservedAt.Before(existing.SourceObservedAt)
	}
	if !isCapturedFloorSchemeStatus(incoming.CaptureStatus) || existing.CapturedAt == nil || incoming.CapturedAt == nil {
		return false
	}
	if incoming.CapturedAt.Before(*existing.CapturedAt) {
		return false
	}
	return existing.CaptureStatus != "captured-complete" || incoming.CaptureStatus != "captured-partial"
}

func isCapturedFloorSchemeStatus(status string) bool {
	return status == "captured-complete" || status == "captured-partial"
}

func upsertFloorSchemeArtifact(ctx context.Context, tx pgx.Tx, projectID int64, artifact domain.FloorSchemeArtifact) error {
	canonicalizeFloorSchemeArtifactTimes(&artifact)
	checksum, err := floorSchemeArtifactChecksum(artifact)
	if err != nil {
		return err
	}
	artifact.BackendAPIArtifactSHA256 = checksum
	captureScopeJSON, err := json.Marshal(artifact.CaptureScope)
	if err != nil {
		return fmt.Errorf("encode floor-scheme capture scope: %w", err)
	}
	schemesJSON, err := json.Marshal(artifact.Schemes)
	if err != nil {
		return fmt.Errorf("encode floor schemes: %w", err)
	}
	var blockEntranceMappingJSON any
	if artifact.BlockEntranceMapping != nil {
		body, err := json.Marshal(artifact.BlockEntranceMapping)
		if err != nil {
			return fmt.Errorf("encode floor-scheme block-to-entrance mapping: %w", err)
		}
		blockEntranceMappingJSON = string(body)
	}
	var expectedUniverseJSON any
	if artifact.ExpectedUniverse != nil {
		body, err := json.Marshal(artifact.ExpectedUniverse)
		if err != nil {
			return fmt.Errorf("encode floor-scheme expected universe: %w", err)
		}
		expectedUniverseJSON = string(body)
	}
	var companionEvidenceJSON any
	if artifact.CompanionEvidence != nil {
		body, err := json.Marshal(artifact.CompanionEvidence)
		if err != nil {
			return fmt.Errorf("encode floor-scheme companion evidence: %w", err)
		}
		companionEvidenceJSON = string(body)
	}
	var sidecarByteSHA256 any
	if artifact.SidecarByteSHA256 != "" {
		sidecarByteSHA256 = artifact.SidecarByteSHA256
	}

	_, err = tx.Exec(ctx, upsertFloorSchemeArtifactSQL,
		projectID, artifact.SchemaVersion, artifact.CaptureStatus, string(captureScopeJSON), artifact.CapturedAt,
		artifact.SourceStatus, artifact.SourceObservedAt, artifact.FloorSchemeCount, artifact.HotspotCount,
		blockEntranceMappingJSON, string(schemesJSON), expectedUniverseJSON, companionEvidenceJSON, sidecarByteSHA256, artifact.BackendAPIArtifactSHA256,
	)
	if err != nil {
		return fmt.Errorf("upsert sanitized floor-scheme artifact: %w", err)
	}
	return nil
}
