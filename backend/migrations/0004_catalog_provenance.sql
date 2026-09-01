ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS source_id text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE phases
    ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE source_snapshots
    ADD COLUMN IF NOT EXISTS project_slug text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS source_url text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS schema_name text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_complete boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS official_record_count integer,
    ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS units_phase_source_id_unique_idx
    ON units (phase_id, source_id)
    WHERE source_id IS NOT NULL AND source_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS projects_slug_unique_idx
    ON projects (slug);

CREATE INDEX IF NOT EXISTS units_source_id_active_idx
    ON units (source_id)
    WHERE is_active AND source_id IS NOT NULL AND source_id <> '';

CREATE INDEX IF NOT EXISTS source_snapshots_project_captured_idx
    ON source_snapshots (project_slug, captured_at DESC);
