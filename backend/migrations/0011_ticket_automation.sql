CREATE TABLE IF NOT EXISTS ticket_automation_updates (
    consumer text NOT NULL,
    update_id bigint NOT NULL CHECK (update_id >= 0),
    accepted boolean NOT NULL DEFAULT false,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer, update_id)
);

CREATE TABLE IF NOT EXISTS ticket_automation_offsets (
    consumer text PRIMARY KEY,
    last_update_id bigint NOT NULL CHECK (last_update_id >= 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
    id bigserial PRIMARY KEY,
    chat_id bigint NOT NULL,
    message_thread_id bigint,
    first_message_id bigint NOT NULL,
    media_group_id text,
    source text NOT NULL DEFAULT 'telegram'
        CHECK (source IN ('telegram', 'operator_test')),
    body text NOT NULL DEFAULT '' CHECK (octet_length(body) <= 65536),
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'working', 'completed', 'failed', 'cancelled')),
    ready_after timestamptz NOT NULL DEFAULT now(),
    status_message_id bigint,
    last_status_text text NOT NULL DEFAULT '' CHECK (octet_length(last_status_text) <= 16384),
    progress_summary text NOT NULL DEFAULT '' CHECK (octet_length(progress_summary) <= 16384),
    result_summary text NOT NULL DEFAULT '' CHECK (octet_length(result_summary) <= 16384),
    failure_summary text NOT NULL DEFAULT '' CHECK (octet_length(failure_summary) <= 16384),
    commit_sha text NOT NULL DEFAULT '' CHECK (octet_length(commit_sha) <= 128),
    production_url text NOT NULL DEFAULT '' CHECK (octet_length(production_url) <= 2048),
    lease_owner text,
    lease_token text,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz,
    completed_at timestamptz,
    CHECK ((lease_owner IS NULL) = (lease_token IS NULL)),
    CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_chat_media_group_unique_idx
    ON tickets (chat_id, media_group_id)
    WHERE media_group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS tickets_claim_idx
    ON tickets (created_at, id)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS tickets_active_lease_idx
    ON tickets (lease_expires_at)
    WHERE status = 'working';

CREATE TABLE IF NOT EXISTS ticket_messages (
    id bigserial PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    update_id bigint NOT NULL,
    chat_id bigint NOT NULL,
    message_id bigint NOT NULL,
    message_thread_id bigint,
    reply_to_message_id bigint,
    body text NOT NULL DEFAULT '' CHECK (octet_length(body) <= 65536),
    telegram_created_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS ticket_messages_ticket_idx
    ON ticket_messages (ticket_id, message_id);

CREATE TABLE IF NOT EXISTS ticket_attachments (
    id bigserial PRIMARY KEY,
    ticket_id bigint NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    message_id bigint NOT NULL,
    telegram_file_id text NOT NULL CHECK (octet_length(telegram_file_id) <= 2048),
    telegram_file_unique_id text NOT NULL DEFAULT '' CHECK (octet_length(telegram_file_unique_id) <= 512),
    kind text NOT NULL CHECK (kind IN ('photo', 'document', 'video', 'animation', 'audio', 'voice')),
    mime_type text NOT NULL DEFAULT '' CHECK (octet_length(mime_type) <= 255),
    original_file_name text NOT NULL DEFAULT '' CHECK (octet_length(original_file_name) <= 1024),
    declared_size bigint CHECK (declared_size IS NULL OR declared_size >= 0),
    download_status text NOT NULL DEFAULT 'pending'
        CHECK (download_status IN ('pending', 'ready', 'failed')),
    local_path text NOT NULL DEFAULT '' CHECK (octet_length(local_path) <= 4096),
    byte_size bigint CHECK (byte_size IS NULL OR byte_size >= 0),
    sha256 text NOT NULL DEFAULT '' CHECK (sha256 = '' OR sha256 ~ '^[0-9a-f]{64}$'),
    download_attempts integer NOT NULL DEFAULT 0 CHECK (download_attempts >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    downloaded_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ticket_id, message_id, telegram_file_id)
);

CREATE INDEX IF NOT EXISTS ticket_attachments_pending_idx
    ON ticket_attachments (next_attempt_at, id)
    WHERE download_status = 'pending';

CREATE INDEX IF NOT EXISTS ticket_attachments_ticket_idx
    ON ticket_attachments (ticket_id, id);

CREATE TABLE IF NOT EXISTS ticket_worker_lease (
    lease_key boolean PRIMARY KEY DEFAULT true CHECK (lease_key),
    owner text,
    lease_token text,
    current_ticket_id bigint REFERENCES tickets(id) ON DELETE SET NULL,
    acquired_at timestamptz,
    heartbeat_at timestamptz,
    expires_at timestamptz,
    CHECK ((owner IS NULL) = (lease_token IS NULL)),
    CHECK ((owner IS NULL) = (expires_at IS NULL))
);

INSERT INTO ticket_worker_lease (lease_key)
VALUES (true)
ON CONFLICT (lease_key) DO NOTHING;
