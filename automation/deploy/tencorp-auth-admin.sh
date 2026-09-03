#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 0077

export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD \
  PGPASSFILE PGSERVICE PGSERVICEFILE PGOPTIONS

readonly RUNUSER_BIN="/usr/sbin/runuser"
readonly PSQL_BIN="/usr/bin/psql"
readonly ENV_BIN="/usr/bin/env"
readonly DATABASE_NAME="residence_service"
readonly DATABASE_SOCKET="/var/run/postgresql"
readonly MAX_BIGINT="9223372036854775807"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage:
  tencorp-auth-admin.sh list [--all]
  tencorp-auth-admin.sh block TELEGRAM_ID
  tencorp-auth-admin.sh unblock TELEGRAM_ID
  tencorp-auth-admin.sh delete TELEGRAM_ID
  tencorp-auth-admin.sh export [--all]

`list` and `export` include active users by default. Add `--all` to include
blocked users. `export` writes CSV to stdout.
USAGE
  exit 64
}

validate_telegram_id() {
  local value="$1"
  local length="${#1}"

  [[ "$value" =~ ^[1-9][0-9]*$ ]] \
    || fail "TELEGRAM_ID must be a positive base-10 integer"
  (( length <= 19 )) \
    || fail "TELEGRAM_ID is outside the PostgreSQL bigint range"
  if (( length == 19 )) && [[ "$value" > "$MAX_BIGINT" ]]; then
    fail "TELEGRAM_ID is outside the PostgreSQL bigint range"
  fi
}

psql_local() {
  "$ENV_BIN" -i \
    PATH="/usr/sbin:/usr/bin:/sbin:/bin" \
    LANG=C \
    LC_ALL=C \
    "$RUNUSER_BIN" -u postgres -- \
    "$PSQL_BIN" \
      -X \
      --no-password \
      --host="$DATABASE_SOCKET" \
      --username=postgres \
      --dbname="$DATABASE_NAME" \
      --set=ON_ERROR_STOP=1 \
      --set=VERBOSITY=terse \
      --quiet \
      --pset=pager=off \
      --pset=footer=off \
      --pset=null= \
      --file=- \
      "$@"
}

list_active_users() {
  psql_local <<'SQL' || fail "PostgreSQL list operation failed"
SELECT
    users.telegram_user_id AS telegram_id,
    users.status,
    users.display_name,
    NULLIF(users.username, '') AS telegram_username,
    users.phone_number AS verified_phone,
    users.phone_number_verified AS phone_verified,
    users.last_login_at,
    sessions.active_session_count AS active_sessions
FROM public.web_auth_users AS users
CROSS JOIN LATERAL (
    SELECT count(*)::bigint AS active_session_count
    FROM public.web_auth_sessions AS sessions
    WHERE sessions.user_id = users.id
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > statement_timestamp()
) AS sessions
WHERE users.issuer = 'https://oauth.telegram.org'
  AND users.status = 'active'
ORDER BY users.last_login_at DESC, users.telegram_user_id;
SQL
}

list_all_users() {
  psql_local <<'SQL' || fail "PostgreSQL list operation failed"
SELECT
    users.telegram_user_id AS telegram_id,
    users.status,
    users.display_name,
    NULLIF(users.username, '') AS telegram_username,
    users.phone_number AS verified_phone,
    users.phone_number_verified AS phone_verified,
    users.last_login_at,
    sessions.active_session_count AS active_sessions
FROM public.web_auth_users AS users
CROSS JOIN LATERAL (
    SELECT count(*)::bigint AS active_session_count
    FROM public.web_auth_sessions AS sessions
    WHERE sessions.user_id = users.id
      AND sessions.revoked_at IS NULL
      AND sessions.expires_at > statement_timestamp()
) AS sessions
WHERE users.issuer = 'https://oauth.telegram.org'
ORDER BY users.last_login_at DESC, users.telegram_user_id;
SQL
}

export_active_users() {
  psql_local <<'SQL' || fail "PostgreSQL CSV export failed"
COPY (
    SELECT
        users.telegram_user_id AS telegram_id,
        users.status,
        -- Always prefix profile-controlled text with the spreadsheet text
        -- marker. Conditional checks are unsafe because spreadsheet engines
        -- disagree about which leading whitespace/control characters they skip
        -- before interpreting =, +, -, or @ as a formula.
        '''' || users.display_name AS display_name,
        CASE
            WHEN users.username = '' THEN NULL
            ELSE '''' || users.username
        END AS telegram_username,
        users.phone_number AS verified_phone,
        users.phone_number_verified AS phone_verified,
        users.last_login_at,
        sessions.active_session_count AS active_sessions
    FROM public.web_auth_users AS users
    CROSS JOIN LATERAL (
        SELECT count(*)::bigint AS active_session_count
        FROM public.web_auth_sessions AS sessions
        WHERE sessions.user_id = users.id
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > statement_timestamp()
    ) AS sessions
    WHERE users.issuer = 'https://oauth.telegram.org'
      AND users.status = 'active'
    ORDER BY users.last_login_at DESC, users.telegram_user_id
) TO STDOUT WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8');
SQL
}

export_all_users() {
  psql_local <<'SQL' || fail "PostgreSQL CSV export failed"
COPY (
    SELECT
        users.telegram_user_id AS telegram_id,
        users.status,
        -- Keep the leading apostrophe unconditional so formulas remain inert
        -- even after unusual leading whitespace or control characters.
        '''' || users.display_name AS display_name,
        CASE
            WHEN users.username = '' THEN NULL
            ELSE '''' || users.username
        END AS telegram_username,
        users.phone_number AS verified_phone,
        users.phone_number_verified AS phone_verified,
        users.last_login_at,
        sessions.active_session_count AS active_sessions
    FROM public.web_auth_users AS users
    CROSS JOIN LATERAL (
        SELECT count(*)::bigint AS active_session_count
        FROM public.web_auth_sessions AS sessions
        WHERE sessions.user_id = users.id
          AND sessions.revoked_at IS NULL
          AND sessions.expires_at > statement_timestamp()
    ) AS sessions
    WHERE users.issuer = 'https://oauth.telegram.org'
    ORDER BY users.last_login_at DESC, users.telegram_user_id
) TO STDOUT WITH (FORMAT CSV, HEADER TRUE, ENCODING 'UTF8');
SQL
}

block_user() {
  local telegram_id="$1"

  psql_local --set="telegram_id=${telegram_id}" <<'SQL' \
    || fail "PostgreSQL block operation failed"
BEGIN;
SELECT set_config('tencorp_auth_admin.telegram_id', :'telegram_id', true) AS ignored
\gset
DO $tencorp_auth_admin$
DECLARE
    target_user_id bigint;
BEGIN
    SELECT users.id
    INTO target_user_id
    FROM public.web_auth_users AS users
    WHERE users.issuer = 'https://oauth.telegram.org'
      AND users.telegram_user_id = current_setting('tencorp_auth_admin.telegram_id')::bigint
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'Telegram auth user not found';
    END IF;

    UPDATE public.web_auth_users
    SET status = 'blocked', updated_at = now()
    WHERE id = target_user_id;

    UPDATE public.web_auth_sessions
    SET revoked_at = now()
    WHERE user_id = target_user_id
      AND revoked_at IS NULL;
END
$tencorp_auth_admin$;
COMMIT;
\echo Account blocked; all sessions revoked.
SQL
}

unblock_user() {
  local telegram_id="$1"

  psql_local --set="telegram_id=${telegram_id}" <<'SQL' \
    || fail "PostgreSQL unblock operation failed"
BEGIN;
SELECT set_config('tencorp_auth_admin.telegram_id', :'telegram_id', true) AS ignored
\gset
DO $tencorp_auth_admin$
DECLARE
    target_user_id bigint;
BEGIN
    SELECT users.id
    INTO target_user_id
    FROM public.web_auth_users AS users
    WHERE users.issuer = 'https://oauth.telegram.org'
      AND users.telegram_user_id = current_setting('tencorp_auth_admin.telegram_id')::bigint
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'Telegram auth user not found';
    END IF;

    UPDATE public.web_auth_users
    SET status = 'active', updated_at = now()
    WHERE id = target_user_id;
END
$tencorp_auth_admin$;
COMMIT;
\echo Account unblocked. A new sign-in is required.
SQL
}

delete_user() {
  local telegram_id="$1"

  psql_local --set="telegram_id=${telegram_id}" <<'SQL' \
    || fail "PostgreSQL delete operation failed"
BEGIN;
SELECT set_config('tencorp_auth_admin.telegram_id', :'telegram_id', true) AS ignored
\gset
DO $tencorp_auth_admin$
DECLARE
    deleted_user_id bigint;
BEGIN
    DELETE FROM public.web_auth_users AS users
    WHERE users.issuer = 'https://oauth.telegram.org'
      AND users.telegram_user_id = current_setting('tencorp_auth_admin.telegram_id')::bigint
    RETURNING users.id INTO deleted_user_id;

    IF deleted_user_id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'Telegram auth user not found';
    END IF;
END
$tencorp_auth_admin$;
COMMIT;
\echo Account and all sessions deleted.
SQL
}

main() {
  local command="${1:-}"
  local telegram_id

  if (( EUID != 0 )); then
    printf 'ERROR: this command must be run as root\n' >&2
    exit 77
  fi
  [[ -x "$ENV_BIN" && -x "$RUNUSER_BIN" && -x "$PSQL_BIN" ]] \
    || fail "required local PostgreSQL tools are unavailable"

  case "$command" in
    list)
      case "$#" in
        1) list_active_users ;;
        2)
          [[ "$2" == "--all" ]] || usage
          list_all_users
          ;;
        *) usage ;;
      esac
      ;;
    export)
      case "$#" in
        1) export_active_users ;;
        2)
          [[ "$2" == "--all" ]] || usage
          export_all_users
          ;;
        *) usage ;;
      esac
      ;;
    block|unblock|delete)
      (( $# == 2 )) || usage
      telegram_id="$2"
      validate_telegram_id "$telegram_id"
      case "$command" in
        block) block_user "$telegram_id" ;;
        unblock) unblock_user "$telegram_id" ;;
        delete) delete_user "$telegram_id" ;;
      esac
      ;;
    help|-h|--help)
      (( $# == 1 )) || usage
      usage
      ;;
    *) usage ;;
  esac
}

main "$@"
