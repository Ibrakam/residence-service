ALTER TABLE project_floor_scheme_artifacts
    ADD COLUMN IF NOT EXISTS companion_evidence jsonb;

ALTER TABLE project_floor_scheme_artifacts
    DROP CONSTRAINT IF EXISTS project_floor_scheme_artifacts_companion_evidence_check;

ALTER TABLE project_floor_scheme_artifacts
    ADD CONSTRAINT project_floor_scheme_artifacts_companion_evidence_check
    CHECK (
        companion_evidence IS NULL
        OR (
            jsonb_typeof(companion_evidence) = 'object'
            AND pg_column_size(companion_evidence) <= 65536
        )
    );
