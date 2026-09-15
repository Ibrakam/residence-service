CREATE TABLE IF NOT EXISTS project_queues (
    id bigserial PRIMARY KEY,
    project_id bigint NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_id text NOT NULL,
    queue_key text NOT NULL,
    queue_label text NOT NULL,
    display_code text NOT NULL DEFAULT '',
    sort_order integer NOT NULL,
    source_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT project_queues_source_id_not_blank CHECK (btrim(source_id) <> ''),
    CONSTRAINT project_queues_key_not_blank CHECK (btrim(queue_key) <> ''),
    CONSTRAINT project_queues_key_format CHECK (queue_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT project_queues_label_not_blank CHECK (btrim(queue_label) <> ''),
    CONSTRAINT project_queues_sort_order_positive CHECK (sort_order > 0),
    UNIQUE (project_id, queue_key),
    UNIQUE (project_id, source_id)
);

ALTER TABLE phases
    ADD COLUMN IF NOT EXISTS queue_id bigint REFERENCES project_queues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS phases_queue_id_idx ON phases (queue_id);
