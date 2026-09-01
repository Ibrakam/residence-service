ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS unit_reference text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS last_viewed_unit_id bigint REFERENCES units(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS last_viewed_reference text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS consent_given boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS consent_at timestamptz;

CREATE INDEX IF NOT EXISTS leads_unit_created_idx
    ON leads (unit_id, created_at DESC)
    WHERE unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_last_viewed_unit_created_idx
    ON leads (last_viewed_unit_id, created_at DESC)
    WHERE last_viewed_unit_id IS NOT NULL;
