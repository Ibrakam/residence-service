CREATE TABLE IF NOT EXISTS leads (
    id bigserial PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    unit_id bigint REFERENCES units(id) ON DELETE SET NULL,
    name text NOT NULL,
    phone text NOT NULL,
    goal text NOT NULL,
    language text NOT NULL DEFAULT 'ru',
    form_context text NOT NULL DEFAULT '',
    landing_url text NOT NULL DEFAULT '',
    referrer_url text NOT NULL DEFAULT '',
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_project_created_idx ON leads (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
