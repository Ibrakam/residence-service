ALTER TABLE source_snapshots
    ADD COLUMN IF NOT EXISTS content_checksum_sha256 text NOT NULL DEFAULT '';

ALTER TABLE source_snapshots
    DROP CONSTRAINT IF EXISTS source_snapshots_content_checksum_shape;

ALTER TABLE source_snapshots
    ADD CONSTRAINT source_snapshots_content_checksum_shape CHECK (
        content_checksum_sha256 = '' OR content_checksum_sha256 ~ '^[0-9a-f]{64}$'
    );

CREATE TABLE IF NOT EXISTS catalog_sync_providers (
    provider text PRIMARY KEY,
    source text NOT NULL UNIQUE,
    freshness_window_seconds integer NOT NULL CHECK (freshness_window_seconds BETWEEN 60 AND 86400),
    project_count integer NOT NULL CHECK (project_count > 0),
    last_attempt_at timestamptz NOT NULL,
    last_attempt_run_id bigint REFERENCES sync_runs(id) ON DELETE SET NULL,
    last_attempt_status text NOT NULL CHECK (last_attempt_status IN ('running', 'succeeded', 'failed')),
    last_success_at timestamptz,
    last_success_run_id bigint REFERENCES sync_runs(id) ON DELETE SET NULL,
    fresh_until timestamptz,
    error_code text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (error_code ~ '^[a-z0-9_]*$'),
    CHECK ((last_success_at IS NULL) = (fresh_until IS NULL))
);

CREATE TABLE IF NOT EXISTS catalog_sync_projects (
    project_slug text PRIMARY KEY,
    provider text NOT NULL REFERENCES catalog_sync_providers(provider) ON DELETE CASCADE,
    minimum_records integer NOT NULL CHECK (minimum_records > 0),
    maximum_record_drop_percent numeric(5, 2) NOT NULL
        CHECK (maximum_record_drop_percent BETWEEN 0 AND 90),
    last_attempt_at timestamptz NOT NULL,
    last_attempt_run_id bigint REFERENCES sync_runs(id) ON DELETE SET NULL,
    last_attempt_status text NOT NULL CHECK (last_attempt_status IN ('running', 'succeeded', 'failed')),
    last_success_at timestamptz,
    last_success_run_id bigint REFERENCES sync_runs(id) ON DELETE SET NULL,
    last_captured_at timestamptz,
    last_record_count integer CHECK (last_record_count >= 0),
    fresh_until timestamptz,
    error_code text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (error_code ~ '^[a-z0-9_]*$'),
    CHECK ((last_success_at IS NULL) = (fresh_until IS NULL)),
    CHECK ((last_success_at IS NULL) = (last_captured_at IS NULL)),
    CHECK ((last_success_at IS NULL) = (last_record_count IS NULL))
);

CREATE INDEX IF NOT EXISTS catalog_sync_projects_provider_idx
    ON catalog_sync_projects (provider, project_slug);

CREATE INDEX IF NOT EXISTS catalog_sync_providers_freshness_idx
    ON catalog_sync_providers (fresh_until);

CREATE INDEX IF NOT EXISTS catalog_sync_projects_freshness_idx
    ON catalog_sync_projects (fresh_until);
