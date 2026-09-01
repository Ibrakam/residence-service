-- Replace the two unnamed 0008 checks that enumerate capture_status. The
-- migration is forward-only and keeps all captured Mirador rows intact.
DO $$
DECLARE
    constraint_name text;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'project_floor_scheme_artifacts'::regclass
          AND contype = 'c'
          AND position('capture_status' IN pg_get_constraintdef(oid)) > 0
    LOOP
        EXECUTE format(
            'ALTER TABLE project_floor_scheme_artifacts DROP CONSTRAINT %I',
            constraint_name
        );
    END LOOP;
END $$;

ALTER TABLE project_floor_scheme_artifacts
    ADD CONSTRAINT project_floor_scheme_artifacts_capture_status_check
        CHECK (
            capture_status IN (
                'blocked-by-authentication',
                'not-published-by-source',
                'captured-complete',
                'captured-partial'
            )
        ),
    ADD CONSTRAINT project_floor_scheme_artifacts_capture_consistency_check
        CHECK (
            (
                capture_status = 'blocked-by-authentication'
                AND captured_at IS NULL
                AND floor_scheme_count = 0
                AND hotspot_count = 0
            )
            OR
            (
                capture_status = 'not-published-by-source'
                AND schema_version >= 3
                AND captured_at IS NOT NULL
                AND captured_at >= source_observed_at
                AND source_status = 'captured-read-only'
                AND capture_scope->>'mode' = 'unavailable'
                AND floor_scheme_count = 0
                AND hotspot_count = 0
                AND schemes = '[]'::jsonb
                AND block_entrance_mapping IS NULL
                AND expected_universe IS NULL
                AND companion_evidence IS NULL
            )
            OR
            (
                capture_status IN ('captured-complete', 'captured-partial')
                AND captured_at IS NOT NULL
                AND floor_scheme_count > 0
                AND hotspot_count > 0
            )
        );
