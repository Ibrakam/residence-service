ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS project_key text NOT NULL DEFAULT 'residence';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_project_key_check'
          AND conrelid = 'tickets'::regclass
    ) THEN
        ALTER TABLE tickets
            ADD CONSTRAINT tickets_project_key_check
            CHECK (project_key IN ('residence', 'market-map'));
    END IF;
END;
$$;
