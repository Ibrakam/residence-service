CREATE TABLE IF NOT EXISTS project_floor_scheme_artifacts (
    project_id bigint PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    schema_version integer NOT NULL CHECK (schema_version > 0),
    capture_status text NOT NULL CHECK (capture_status IN ('blocked-by-authentication', 'captured-complete', 'captured-partial')),
    capture_scope jsonb NOT NULL CHECK (jsonb_typeof(capture_scope) = 'object'),
    captured_at timestamptz,
    source_status text NOT NULL,
    source_observed_at timestamptz NOT NULL,
    floor_scheme_count integer NOT NULL CHECK (floor_scheme_count >= 0),
    hotspot_count integer NOT NULL CHECK (hotspot_count >= 0),
    block_entrance_mapping jsonb CHECK (block_entrance_mapping IS NULL OR jsonb_typeof(block_entrance_mapping) = 'object'),
    schemes jsonb NOT NULL CHECK (jsonb_typeof(schemes) = 'array'),
    expected_universe jsonb CHECK (expected_universe IS NULL OR jsonb_typeof(expected_universe) = 'object'),
    sidecar_byte_sha256 text CHECK (sidecar_byte_sha256 IS NULL OR sidecar_byte_sha256 ~ '^[a-f0-9]{64}$'),
    artifact_sha256 text NOT NULL CHECK (artifact_sha256 ~ '^[a-f0-9]{64}$'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (pg_column_size(capture_scope) <= 262144),
    CHECK (pg_column_size(schemes) <= 4194304),
    CHECK (expected_universe IS NULL OR pg_column_size(expected_universe) <= 4194304),
    CHECK (
        (capture_status = 'blocked-by-authentication' AND captured_at IS NULL AND floor_scheme_count = 0 AND hotspot_count = 0)
        OR
        (capture_status IN ('captured-complete', 'captured-partial') AND captured_at IS NOT NULL AND floor_scheme_count > 0 AND hotspot_count > 0)
    )
);
