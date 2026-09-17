CREATE SCHEMA IF NOT EXISTS auth_reporting;

REVOKE ALL ON SCHEMA auth_reporting FROM PUBLIC;

-- Explicit security-invoker metadata keeps the privilege boundary reviewable.
-- PostgreSQL 15 or newer is required for this view option.
CREATE OR REPLACE VIEW auth_reporting.authorized_users
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
    users.telegram_user_id,
    users.status,
    users.display_name,
    users.given_name,
    users.family_name,
    users.username,
    users.picture_url,
    users.phone_number,
    users.phone_number_verified,
    users.created_at,
    users.updated_at,
    users.last_login_at,
    (
        SELECT count(*)::integer
        FROM public.web_auth_sessions AS sessions
        WHERE sessions.user_id = users.id
          AND users.status = 'active'
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > transaction_timestamp()
    ) AS active_session_count
FROM public.web_auth_users AS users
WHERE users.issuer = 'https://oauth.telegram.org';

CREATE OR REPLACE VIEW auth_reporting.active_sessions
WITH (security_barrier = true, security_invoker = false)
AS
SELECT
    users.telegram_user_id,
    sessions.created_at,
    sessions.expires_at
FROM public.web_auth_sessions AS sessions
JOIN public.web_auth_users AS users ON users.id = sessions.user_id
WHERE users.issuer = 'https://oauth.telegram.org'
  AND users.status = 'active'
  AND sessions.revoked_at IS NULL
  AND sessions.expires_at > transaction_timestamp();

REVOKE ALL ON TABLE auth_reporting.authorized_users FROM PUBLIC;
REVOKE ALL ON TABLE auth_reporting.active_sessions FROM PUBLIC;

-- These are trigger-only SECURITY DEFINER routines. Trigger execution does not
-- require callers to have EXECUTE, so removing PostgreSQL's default PUBLIC
-- grant narrows the reporting credential without changing trigger behavior.
REVOKE EXECUTE ON FUNCTION public.record_explicit_apartment_sale() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_explicit_apartment_sold_fact() FROM PUBLIC;

COMMENT ON SCHEMA auth_reporting IS
    'Minimal read-only reporting surface for protected operator tools.';
COMMENT ON VIEW auth_reporting.authorized_users IS
    'Telegram user profiles without internal OIDC identifiers or session secrets.';
COMMENT ON VIEW auth_reporting.active_sessions IS
    'Currently active Telegram sessions without token hashes or internal user IDs.';
