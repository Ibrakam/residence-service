package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/tencorp/real-estate-platform/backend/internal/domain"
)

// GetFloorSchemeArtifact returns the sanitized, versioned floor-scheme
// projection persisted by the KAYAN importer. Raw CRM provenance is never
// stored in this table and therefore cannot leak through this read path.
func (s *Store) GetFloorSchemeArtifact(ctx context.Context, projectSlug string) (domain.FloorSchemeArtifact, error) {
	var artifact domain.FloorSchemeArtifact
	var capturedAt sql.NullTime
	var captureScopeJSON []byte
	var blockEntranceMappingJSON []byte
	var schemesJSON []byte
	var expectedUniverseJSON []byte
	var companionEvidenceJSON []byte
	err := s.pool.QueryRow(ctx, `
		SELECT a.schema_version, p.slug, a.captured_at, a.capture_status,
		       a.capture_scope, a.source_status, a.source_observed_at,
		       a.floor_scheme_count, a.hotspot_count,
		       a.block_entrance_mapping, a.schemes, a.expected_universe, a.companion_evidence,
		       COALESCE(a.sidecar_byte_sha256,''), a.artifact_sha256
		FROM project_floor_scheme_artifacts a
		JOIN projects p ON p.id=a.project_id
		WHERE p.slug=$1`, projectSlug).Scan(
		&artifact.SchemaVersion, &artifact.ProjectSlug, &capturedAt, &artifact.CaptureStatus,
		&captureScopeJSON, &artifact.SourceStatus, &artifact.SourceObservedAt,
		&artifact.FloorSchemeCount, &artifact.HotspotCount,
		&blockEntranceMappingJSON, &schemesJSON, &expectedUniverseJSON, &companionEvidenceJSON,
		&artifact.SidecarByteSHA256, &artifact.BackendAPIArtifactSHA256,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.FloorSchemeArtifact{}, ErrNotFound
	}
	if err != nil {
		return domain.FloorSchemeArtifact{}, err
	}
	if capturedAt.Valid {
		artifact.CapturedAt = &capturedAt.Time
	}
	if err := json.Unmarshal(captureScopeJSON, &artifact.CaptureScope); err != nil {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("decode persisted floor-scheme capture scope: %w", err)
	}
	if len(blockEntranceMappingJSON) > 0 {
		if err := json.Unmarshal(blockEntranceMappingJSON, &artifact.BlockEntranceMapping); err != nil {
			return domain.FloorSchemeArtifact{}, fmt.Errorf("decode persisted floor-scheme block mapping: %w", err)
		}
	}
	if err := json.Unmarshal(schemesJSON, &artifact.Schemes); err != nil {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("decode persisted floor schemes: %w", err)
	}
	if artifact.Schemes == nil {
		artifact.Schemes = make([]domain.FloorScheme, 0)
	}
	if len(expectedUniverseJSON) > 0 {
		if err := json.Unmarshal(expectedUniverseJSON, &artifact.ExpectedUniverse); err != nil {
			return domain.FloorSchemeArtifact{}, fmt.Errorf("decode persisted floor-scheme expected universe: %w", err)
		}
	}
	if len(companionEvidenceJSON) > 0 {
		if err := json.Unmarshal(companionEvidenceJSON, &artifact.CompanionEvidence); err != nil {
			return domain.FloorSchemeArtifact{}, fmt.Errorf("decode persisted floor-scheme companion evidence: %w", err)
		}
	}
	canonicalizeFloorSchemeArtifactTimes(&artifact)
	storedChecksum := artifact.BackendAPIArtifactSHA256
	artifact.BackendAPIArtifactSHA256 = ""
	checksumPayload, err := json.Marshal(artifact)
	if err != nil {
		return domain.FloorSchemeArtifact{}, fmt.Errorf("encode persisted floor-scheme integrity payload: %w", err)
	}
	digest := sha256.Sum256(checksumPayload)
	artifact.BackendAPIArtifactSHA256 = storedChecksum
	if hex.EncodeToString(digest[:]) != storedChecksum {
		return domain.FloorSchemeArtifact{}, errors.New("persisted floor-scheme API artifact checksum mismatch")
	}
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
