ALTER TABLE ticket_attachments
    DROP CONSTRAINT IF EXISTS ticket_attachments_download_status_check;

ALTER TABLE ticket_attachments
    ADD CONSTRAINT ticket_attachments_download_status_check
    CHECK (download_status IN ('pending', 'ready', 'failed', 'purged')),
    ADD COLUMN IF NOT EXISTS purged_at timestamptz;

CREATE INDEX IF NOT EXISTS ticket_attachments_retention_idx
    ON ticket_attachments (ticket_id, id)
    WHERE download_status = 'ready' AND local_path <> '';
