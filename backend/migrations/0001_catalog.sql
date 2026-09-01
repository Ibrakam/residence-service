CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS developers (
    id bigserial PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id bigserial PRIMARY KEY,
    developer_id bigint NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
    slug text NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (developer_id, slug)
);

CREATE TABLE IF NOT EXISTS phases (
    id bigserial PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    property_type text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    address text NOT NULL DEFAULT '',
    image_url text NOT NULL DEFAULT '',
    floors_total integer NOT NULL DEFAULT 0,
    source_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, slug),
    UNIQUE (project_id, source_id)
);

CREATE TABLE IF NOT EXISTS units (
    id bigserial PRIMARY KEY,
    phase_id bigint NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    source_key text NOT NULL,
    source_id text,
    property_type text NOT NULL,
    raw_property_type text NOT NULL,
    status text NOT NULL,
    raw_status text NOT NULL,
    number text NOT NULL,
    entrance text NOT NULL DEFAULT '',
    floor integer NOT NULL DEFAULT 0,
    house_name text NOT NULL DEFAULT '',
    area numeric(12, 2) NOT NULL,
    rooms integer,
    price bigint,
    price_per_m2 numeric(18, 2),
    currency text NOT NULL DEFAULT 'UZS',
    plan_image_url text NOT NULL DEFAULT '',
    is_active boolean NOT NULL DEFAULT true,
    source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_updated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (phase_id, source_key)
);

CREATE INDEX IF NOT EXISTS units_phase_status_idx ON units (phase_id, status) WHERE is_active;
CREATE INDEX IF NOT EXISTS units_floor_idx ON units (phase_id, floor) WHERE is_active;
CREATE INDEX IF NOT EXISTS units_rooms_idx ON units (phase_id, rooms) WHERE is_active;
CREATE INDEX IF NOT EXISTS units_price_idx ON units (phase_id, price) WHERE is_active AND price IS NOT NULL;

CREATE TABLE IF NOT EXISTS layouts (
    id bigserial PRIMARY KEY,
    phase_id bigint NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
    source_id text NOT NULL,
    rooms integer,
    available_count integer NOT NULL DEFAULT 0,
    title text NOT NULL DEFAULT '',
    address text NOT NULL DEFAULT '',
    price_text text NOT NULL DEFAULT '',
    image_url text NOT NULL DEFAULT '',
    thumbnail_url text NOT NULL DEFAULT '',
    source_updated_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (phase_id, source_id)
);

CREATE TABLE IF NOT EXISTS sync_runs (
    id bigserial PRIMARY KEY,
    source text NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    records_read integer NOT NULL DEFAULT 0,
    records_saved integer NOT NULL DEFAULT 0,
    error text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS source_snapshots (
    id bigserial PRIMARY KEY,
    sync_run_id bigint REFERENCES sync_runs(id) ON DELETE SET NULL,
    source text NOT NULL,
    source_id text NOT NULL,
    path text NOT NULL,
    checksum_sha256 text NOT NULL,
    record_count integer NOT NULL,
    captured_at timestamptz NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (source, source_id, checksum_sha256)
);

CREATE TABLE IF NOT EXISTS unit_status_history (
    id bigserial PRIMARY KEY,
    unit_id bigint NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    old_status text,
    new_status text NOT NULL,
    observed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS unit_price_history (
    id bigserial PRIMARY KEY,
    unit_id bigint NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    old_price bigint,
    new_price bigint,
    currency text NOT NULL,
    observed_at timestamptz NOT NULL
);
