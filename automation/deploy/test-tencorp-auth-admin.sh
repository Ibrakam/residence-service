#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
readonly ADMIN="${TEST_DIR}/tencorp-auth-admin.sh"
readonly MIGRATION="${TEST_DIR}/../../backend/migrations/0014_web_auth.sql"
readonly MAX_BIGINT="9223372036854775807"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

bash -n "$ADMIN"
grep -Fq 'if (( EUID != 0 )); then' "$ADMIN" \
  || fail "admin CLI does not enforce effective root identity"
grep -Fq 'readonly RUNUSER_BIN="/usr/sbin/runuser"' "$ADMIN" \
  || fail "admin CLI does not pin local runuser"
grep -Fq 'readonly PSQL_BIN="/usr/bin/psql"' "$ADMIN" \
  || fail "admin CLI does not pin local psql"
grep -Fq 'readonly DATABASE_NAME="residence_service"' "$ADMIN" \
  || fail "admin CLI does not pin the production database"
grep -Fq 'readonly DATABASE_SOCKET="/var/run/postgresql"' "$ADMIN" \
  || fail "admin CLI does not pin the local PostgreSQL socket"
if grep -Fq 'gateway.env' "$ADMIN"; then
  fail "admin CLI must not read the gateway environment"
fi
if grep -Fq 'token_hash' "$ADMIN"; then
  fail "admin CLI must not reference or expose session hashes"
fi
grep -Eq 'REFERENCES[[:space:]]+web_auth_users\(id\)[[:space:]]+ON[[:space:]]+DELETE[[:space:]]+CASCADE' "$MIGRATION" \
  || fail "auth sessions are not protected by the reviewed delete cascade"

if (( EUID != 0 )); then
  set +e
  root_output="$(bash "$ADMIN" list 2>&1)"
  root_status=$?
  set -e
  [[ "$root_status" == "77" ]] || fail "non-root execution did not use EX_NOPERM"
  [[ "$root_output" == *'must be run as root'* ]] || fail "non-root denial is unclear"
fi

fixture_root="$(mktemp -d /tmp/tencorp-auth-admin-test.XXXXXX)"
trap '/bin/chmod -R u+w -- "$fixture_root" 2>/dev/null || true; /bin/rm -rf -- "$fixture_root"' EXIT
readonly CAPTURE_DIR="${fixture_root}/capture"
readonly FAKE_RUNUSER="${fixture_root}/runuser"
readonly FAKE_PSQL="${fixture_root}/psql"
readonly TEST_ADMIN="${fixture_root}/tencorp-auth-admin"
mkdir -p "$CAPTURE_DIR"

{
  printf '%s\n' '#!/bin/bash' 'set -eu'
  printf 'readonly capture_dir=%q\n' "$CAPTURE_DIR"
  cat <<'STUB_RUNUSER'
printf '%s\n' "$@" > "${capture_dir}/runuser.args"
printf 'PGHOST=%s\n' "${PGHOST-unset}" > "${capture_dir}/runuser.env"
printf 'PGPASSWORD=%s\n' "${PGPASSWORD-unset}" >> "${capture_dir}/runuser.env"
[[ "$#" -ge 4 && "$1" == '-u' && "$2" == 'postgres' && "$3" == '--' ]] || exit 90
shift 3
exec "$@"
STUB_RUNUSER
} > "$FAKE_RUNUSER"

{
  printf '%s\n' '#!/bin/bash' 'set -eu'
  printf 'readonly capture_dir=%q\n' "$CAPTURE_DIR"
  cat <<'STUB_PSQL'
printf '%s\n' "$@" > "${capture_dir}/psql.args"
/bin/cat > "${capture_dir}/query.sql"
if /usr/bin/grep -Fq 'COPY (' "${capture_dir}/query.sql"; then
  printf '%s\n' 'telegram_id,status,display_name,telegram_username,verified_phone,phone_verified,last_login_at,active_sessions'
else
  printf '%s\n' 'fixture-ok'
fi
STUB_PSQL
} > "$FAKE_PSQL"
chmod 0700 "$FAKE_RUNUSER" "$FAKE_PSQL"

sed \
  -e "s|readonly RUNUSER_BIN=\"/usr/sbin/runuser\"|readonly RUNUSER_BIN=\"${FAKE_RUNUSER}\"|" \
  -e "s|readonly PSQL_BIN=\"/usr/bin/psql\"|readonly PSQL_BIN=\"${FAKE_PSQL}\"|" \
  -e 's/if (( EUID != 0 )); then/if (( 0 != 0 )); then/' \
  "$ADMIN" > "$TEST_ADMIN"
chmod 0700 "$TEST_ADMIN"
bash -n "$TEST_ADMIN"

clear_capture() {
  /bin/rm -f -- "$CAPTURE_DIR/runuser.args" "$CAPTURE_DIR/runuser.env" \
    "$CAPTURE_DIR/psql.args" "$CAPTURE_DIR/query.sql"
}

assert_common_contract() {
  grep -Fxq -- '-u' "$CAPTURE_DIR/runuser.args" || fail "runuser is missing -u"
  grep -Fxq -- 'postgres' "$CAPTURE_DIR/runuser.args" || fail "runuser does not select postgres"
  grep -Fxq -- '--' "$CAPTURE_DIR/runuser.args" || fail "runuser lacks its argv boundary"
  grep -Fxq -- "$FAKE_PSQL" "$CAPTURE_DIR/runuser.args" || fail "runuser does not invoke fixed psql"
  grep -Fxq -- '-X' "$CAPTURE_DIR/psql.args" || fail "psql does not ignore startup files"
  grep -Fxq -- '--no-password' "$CAPTURE_DIR/psql.args" || fail "psql may prompt for a password"
  grep -Fxq -- '--host=/var/run/postgresql' "$CAPTURE_DIR/psql.args" || fail "psql socket is not fixed"
  grep -Fxq -- '--username=postgres' "$CAPTURE_DIR/psql.args" || fail "psql role is not fixed"
  grep -Fxq -- '--dbname=residence_service' "$CAPTURE_DIR/psql.args" || fail "psql database is not fixed"
  grep -Fxq -- '--set=ON_ERROR_STOP=1' "$CAPTURE_DIR/psql.args" || fail "psql is not fail-fast"
  grep -Fxq -- 'PGHOST=unset' "$CAPTURE_DIR/runuser.env" || fail "PGHOST reached runuser"
  grep -Fxq -- 'PGPASSWORD=unset' "$CAPTURE_DIR/runuser.env" || fail "PGPASSWORD reached runuser"
  if grep -Fq 'token_hash' "$CAPTURE_DIR/query.sql"; then
    fail "SQL references session hashes"
  fi
}

assert_csv_formula_contract() {
  local query="$CAPTURE_DIR/query.sql"
  local payload protected

  grep -Fq "'''' || users.display_name AS display_name" "$query" \
    || fail "CSV export does not force profile display names to spreadsheet text"
  grep -Fq "ELSE '''' || users.username" "$query" \
    || fail "CSV export does not force Telegram usernames to spreadsheet text"
  grep -Fq "WHEN users.username = '' THEN NULL" "$query" \
    || fail "CSV export no longer preserves an absent Telegram username"
  if grep -Eq '^[[:space:]]*users\.display_name,' "$query" \
    || grep -Fq "NULLIF(users.username, '') AS telegram_username" "$query"; then
    fail "CSV export still contains an unsanitized profile-controlled text field"
  fi
  grep -Fq 'users.telegram_user_id AS telegram_id' "$query" \
    || fail "CSV formula defense changed the numeric Telegram ID"
  grep -Fq 'users.phone_number AS verified_phone' "$query" \
    || fail "CSV formula defense changed the constrained verified phone"

  # The SQL prefix is unconditional, so it remains the first cell character
  # even when a spreadsheet skips whitespace/control bytes before a formula.
  for payload in \
    '=HYPERLINK("https://attacker.invalid")' \
    '+1+1' \
    '-1+1' \
    '@SUM(1,1)' \
    '   =1+1' \
    $'\t@SUM(1,1)' \
    $'\r=1+1'; do
    protected="'${payload}"
    [[ "${protected:0:1}" == "'" && "${protected:1}" == "$payload" ]] \
      || fail "spreadsheet text prefix did not preserve a hostile profile value"
  done
}

expect_rejected() {
  local output status

  clear_capture
  set +e
  output="$(bash "$TEST_ADMIN" "$@" 2>&1)"
  status=$?
  set -e
  (( status != 0 )) || fail "invalid argv was accepted"
  [[ ! -e "$CAPTURE_DIR/runuser.args" ]] || fail "invalid argv reached runuser"
  [[ "$output" != *'SELECT '* ]] || fail "invalid argv exposed SQL"
}

clear_capture
list_output="$(PGHOST=attacker.example PGPASSWORD=do-not-leak bash "$TEST_ADMIN" list)"
[[ "$list_output" == "fixture-ok" ]] || fail "active list output contract changed"
assert_common_contract
grep -Fq "AND users.status = 'active'" "$CAPTURE_DIR/query.sql" \
  || fail "default list is not limited to active users"
grep -Fq 'users.phone_number AS verified_phone' "$CAPTURE_DIR/query.sql" \
  || fail "list omits the verified phone"
grep -Fq 'users.phone_number_verified AS phone_verified' "$CAPTURE_DIR/query.sql" \
  || fail "list omits phone verification state"
grep -Fq 'sessions.active_session_count AS active_sessions' "$CAPTURE_DIR/query.sql" \
  || fail "list omits active session count"
grep -Fq 'sessions.revoked_at IS NULL' "$CAPTURE_DIR/query.sql" \
  || fail "active session count includes revoked sessions"
grep -Fq 'sessions.expires_at > statement_timestamp()' "$CAPTURE_DIR/query.sql" \
  || fail "active session count includes expired sessions"

clear_capture
bash "$TEST_ADMIN" list --all >/dev/null
assert_common_contract
if grep -Fq "AND users.status = 'active'" "$CAPTURE_DIR/query.sql"; then
  fail "all-user list still filters blocked users"
fi

clear_capture
csv_output="$(bash "$TEST_ADMIN" export)"
assert_common_contract
assert_csv_formula_contract
[[ "$csv_output" == telegram_id,status,* ]] || fail "CSV export has no fixed header"
grep -Fq 'TO STDOUT WITH (FORMAT CSV, HEADER TRUE' "$CAPTURE_DIR/query.sql" \
  || fail "export does not use PostgreSQL CSV on stdout"
grep -Fq "AND users.status = 'active'" "$CAPTURE_DIR/query.sql" \
  || fail "default export is not limited to active users"

clear_capture
bash "$TEST_ADMIN" export --all >/dev/null
assert_common_contract
assert_csv_formula_contract
if grep -Fq "AND users.status = 'active'" "$CAPTURE_DIR/query.sql"; then
  fail "all-user export still filters blocked users"
fi

readonly VALID_ID="123456789"
clear_capture
bash "$TEST_ADMIN" block "$VALID_ID" >/dev/null
assert_common_contract
grep -Fxq -- "--set=telegram_id=${VALID_ID}" "$CAPTURE_DIR/psql.args" \
  || fail "validated Telegram ID is not passed as a psql variable"
if grep -Fq "$VALID_ID" "$CAPTURE_DIR/query.sql"; then
  fail "Telegram ID was interpolated into SQL text"
fi
grep -Fq "SET status = 'blocked'" "$CAPTURE_DIR/query.sql" \
  || fail "block does not set blocked status"
grep -Fq 'UPDATE public.web_auth_sessions' "$CAPTURE_DIR/query.sql" \
  || fail "block does not revoke sessions"
grep -Fq 'SET revoked_at = now()' "$CAPTURE_DIR/query.sql" \
  || fail "block does not timestamp session revocation"

clear_capture
bash "$TEST_ADMIN" unblock "$MAX_BIGINT" >/dev/null
assert_common_contract
grep -Fxq -- "--set=telegram_id=${MAX_BIGINT}" "$CAPTURE_DIR/psql.args" \
  || fail "maximum PostgreSQL bigint was rejected"
grep -Fq "SET status = 'active'" "$CAPTURE_DIR/query.sql" \
  || fail "unblock does not restore active status"

clear_capture
bash "$TEST_ADMIN" delete "$VALID_ID" >/dev/null
assert_common_contract
grep -Fq 'DELETE FROM public.web_auth_users' "$CAPTURE_DIR/query.sql" \
  || fail "delete does not remove the auth user"
grep -Fq "users.issuer = 'https://oauth.telegram.org'" "$CAPTURE_DIR/query.sql" \
  || fail "mutation is not scoped to the production Telegram issuer"

expect_rejected
expect_rejected list --active
expect_rejected list --all extra
expect_rejected export /tmp/users.csv
expect_rejected export --all extra
expect_rejected block
expect_rejected block 1 extra
expect_rejected unblock --all
expect_rejected delete 0
expect_rejected delete -1
expect_rejected delete 01
expect_rejected delete +1
expect_rejected delete 1.0
expect_rejected delete 1e3
expect_rejected delete 9223372036854775808
expect_rejected delete 99999999999999999999
expect_rejected delete '1;SELECT pg_sleep(1)'
expect_rejected delete '1 OR 1=1'
expect_rejected delete $'1\n2'
expect_rejected unknown 1

printf 'tencorp auth admin contract: ok\n'
