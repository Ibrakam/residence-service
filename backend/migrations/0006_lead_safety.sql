-- Add checks without a long validation lock first. Migration 0007 validates
-- every legacy row and fails the release closed if remediation is required.
ALTER TABLE leads
    ADD CONSTRAINT leads_name_length_check
        CHECK (char_length(name) BETWEEN 2 AND 120 AND name !~ E'[\r\n]') NOT VALID,
    ADD CONSTRAINT leads_phone_format_check
        CHECK (phone ~ '^\+998[0-9]{9}$') NOT VALID,
    ADD CONSTRAINT leads_goal_check
        CHECK (goal IN ('live', 'invest', 'rent')) NOT VALID,
    ADD CONSTRAINT leads_language_check
        CHECK (language IN ('ru', 'uz', 'en')) NOT VALID,
    ADD CONSTRAINT leads_context_length_check
        CHECK (char_length(form_context) <= 2048 AND form_context !~ E'[\r\n]') NOT VALID,
    ADD CONSTRAINT leads_url_length_check
        CHECK (
            char_length(landing_url) <= 2048 AND landing_url !~ E'[\r\n]' AND
            char_length(referrer_url) <= 2048 AND referrer_url !~ E'[\r\n]'
        ) NOT VALID,
    ADD CONSTRAINT leads_unit_reference_length_check
        CHECK (
            char_length(unit_reference) <= 200 AND unit_reference !~ E'[\r\n\t]' AND
            char_length(last_viewed_reference) <= 200 AND last_viewed_reference !~ E'[\r\n\t]'
        ) NOT VALID,
    ADD CONSTRAINT leads_metadata_object_check
        CHECK (jsonb_typeof(metadata) = 'object' AND pg_column_size(metadata) <= 16384) NOT VALID,
    ADD CONSTRAINT leads_consent_check
        CHECK (consent_given AND consent_at IS NOT NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS leads_project_phone_created_idx
    ON leads (project_id, phone, created_at DESC);

CREATE INDEX IF NOT EXISTS sync_runs_source_status_finished_idx
    ON sync_runs (source, status, finished_at DESC);
