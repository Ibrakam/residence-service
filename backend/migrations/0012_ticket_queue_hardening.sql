CREATE OR REPLACE FUNCTION ticket_cap_body(existing_body text, incoming_body text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    combined text;
    low integer := 0;
    high integer;
    middle integer;
BEGIN
    combined := CASE
        WHEN incoming_body = '' THEN existing_body
        WHEN existing_body = '' THEN incoming_body
        ELSE existing_body || E'\n\n' || incoming_body
    END;
    IF octet_length(combined) <= 65536 THEN
        RETURN combined;
    END IF;

    high := char_length(combined);
    WHILE low < high LOOP
        middle := (low + high + 1) / 2;
        IF octet_length(left(combined, middle)) <= 65536 THEN
            low := middle;
        ELSE
            high := middle - 1;
        END IF;
    END LOOP;
    RETURN left(combined, low);
END;
$$;

REVOKE ALL ON FUNCTION ticket_cap_body(text, text) FROM PUBLIC;

ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS status_synced_at timestamptz,
    ADD COLUMN IF NOT EXISTS finalization_token_hash bytea;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tickets_finalization_token_hash_length_check'
          AND conrelid = 'tickets'::regclass
    ) THEN
        ALTER TABLE tickets
            ADD CONSTRAINT tickets_finalization_token_hash_length_check
            CHECK (finalization_token_hash IS NULL OR octet_length(finalization_token_hash) = 32);
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS tickets_status_sync_idx
    ON tickets (updated_at, id)
    WHERE status_synced_at IS NULL OR status_synced_at < updated_at;
