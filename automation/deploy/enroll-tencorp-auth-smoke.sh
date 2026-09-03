#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 077

readonly AUTH_USER="tencorp-auth-gateway"
readonly AUTH_GROUP="tencorp-auth-gateway"
readonly PUBLIC_ORIGIN="https://form.tencorp.uz"
readonly HELPER_BIN="/opt/tencorp-auth-gateway/current/auth-smoke-capture"
readonly AUTH_SNIPPET="/etc/nginx/snippets/tencorp-auth-gateway.conf"
readonly PUBLIC_PROXY_SNIPPET="/etc/nginx/snippets/tencorp-auth-public-proxy.conf"
readonly CAPTURE_PROXY_SNIPPET="/etc/nginx/snippets/tencorp-auth-smoke-callback-proxy.conf"
readonly CAPTURE_OUTPUT="/run/tencorp-auth-gateway/deploy-smoke-session.captured"
readonly FIXTURE="/etc/tencorp-auth-gateway/deploy-smoke-session"
readonly DEPLOY_LOCK="/run/lock/residence-root-deploy.lock"

readonly AWK_BIN="/usr/bin/awk"
readonly CMP_BIN="/usr/bin/cmp"
readonly CURL_BIN="/usr/bin/curl"
readonly ENV_BIN="/usr/bin/env"
readonly FLOCK_BIN="/usr/bin/flock"
readonly GREP_BIN="/usr/bin/grep"
readonly HEAD_BIN="/usr/bin/head"
readonly ID_BIN="/usr/bin/id"
readonly INSTALL_BIN="/usr/bin/install"
readonly LN_BIN="/usr/bin/ln"
readonly MKTEMP_BIN="/usr/bin/mktemp"
readonly MV_BIN="/usr/bin/mv"
readonly NGINX_BIN="/usr/sbin/nginx"
readonly OPENSSL_BIN="/usr/bin/openssl"
readonly PYTHON_BIN="/usr/bin/python3"
readonly RM_BIN="/usr/bin/rm"
readonly RUNUSER_BIN="/usr/sbin/runuser"
readonly SED_BIN="/usr/bin/sed"
readonly SLEEP_BIN="/usr/bin/sleep"
readonly SS_BIN="/usr/bin/ss"
readonly STAT_BIN="/usr/bin/stat"
readonly SYSTEMCTL_BIN="/usr/bin/systemctl"
readonly TIMEOUT_BIN="/usr/bin/timeout"
readonly WC_BIN="/usr/bin/wc"

WORK_DIR=""
ORIGINAL_AUTH_SNIPPET=""
GATEWAY_CANDIDATE=""
CAPTURE_PROXY_CANDIDATE=""
CAPTURE_SNAPSHOT=""
CURL_CONFIG=""
ME_RESPONSE=""
FIXTURE_STAGE=""
HELPER_RUNNER_PID=""
EXPECTED_TELEGRAM_ID=""
CALLBACK_SWITCHED=0
CAPTURE_PROXY_CREATED=0
FIXTURE_CREATED=0
FIXTURE_INSTALLED=0

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

atomic_install() {
  local source="$1"
  local destination="$2"
  local mode="$3"
  local staged="${destination}.enroll.$$"

  "$INSTALL_BIN" -o root -g root -m "$mode" -- "$source" "$staged" \
    || return 1
  "$MV_BIN" -Tf -- "$staged" "$destination"
}

restore_callback() {
  local attempt

  (( CALLBACK_SWITCHED == 1 )) || return 0
  for attempt in 1 2 3; do
    if atomic_install "$ORIGINAL_AUTH_SNIPPET" "$AUTH_SNIPPET" 0644 \
      && "$NGINX_BIN" -t >/dev/null \
      && "$SYSTEMCTL_BIN" reload nginx \
      && "$CMP_BIN" --silent -- "$ORIGINAL_AUTH_SNIPPET" "$AUTH_SNIPPET"; then
      CALLBACK_SWITCHED=0
      printf 'Telegram callback restored to the primary auth gateway.\n'
      return 0
    fi
    "$SLEEP_BIN" 1
  done
  printf 'CRITICAL: could not restore the Telegram callback; keep the capture helper running and repair Nginx immediately.\n' >&2
  return 1
}

stop_helper() {
  local attempt

  [[ -n "$HELPER_RUNNER_PID" ]] || return 0
  for (( attempt = 0; attempt < 50; attempt += 1 )); do
    kill -0 "$HELPER_RUNNER_PID" 2>/dev/null || break
    "$SLEEP_BIN" 0.1
  done
  if kill -0 "$HELPER_RUNNER_PID" 2>/dev/null; then
    kill -TERM "$HELPER_RUNNER_PID" 2>/dev/null || true
  fi
  wait "$HELPER_RUNNER_PID" 2>/dev/null || true
  HELPER_RUNNER_PID=""
}

remove_work_files() {
  [[ -n "$WORK_DIR" ]] || return 0
  case "$WORK_DIR" in
    /run/tencorp-auth-enroll.*)
      "$RM_BIN" -rf -- "$WORK_DIR"
      ;;
    *)
      printf 'ERROR: refusing to remove an unexpected work directory.\n' >&2
      return 1
      ;;
  esac
  WORK_DIR=""
}

cleanup() {
  local status=$?
  local restored=1

  trap - EXIT HUP INT TERM
  set +e
  if ! restore_callback; then
    restored=0
    status=70
  fi
  # Never stop the only callback target until the primary 4340 route has been
  # restored and reloaded successfully.
  if (( restored == 1 )); then
    stop_helper
    if (( CAPTURE_PROXY_CREATED == 1 )); then
      "$RM_BIN" -f -- "$CAPTURE_PROXY_SNIPPET"
      CAPTURE_PROXY_CREATED=0
    fi
    if (( FIXTURE_INSTALLED == 0 )); then
      "$RM_BIN" -f -- "$CAPTURE_OUTPUT"
      if (( FIXTURE_CREATED == 1 )); then
        "$RM_BIN" -f -- "$FIXTURE"
        FIXTURE_CREATED=0
      fi
    fi
    "$RM_BIN" -f -- \
      "${AUTH_SNIPPET}.enroll.$$" \
      "${CAPTURE_PROXY_SNIPPET}.enroll.$$"
    if [[ -n "$FIXTURE_STAGE" ]]; then
      "$RM_BIN" -f -- "$FIXTURE_STAGE"
      FIXTURE_STAGE=""
    fi
    remove_work_files || status=70
  fi
  EXPECTED_TELEGRAM_ID=""
  exit "$status"
}

trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

require_regular_file() {
  local path="$1"
  local expected_uid="$2"
  local metadata uid mode

  [[ -f "$path" && ! -L "$path" ]] || return 1
  metadata="$($STAT_BIN -c '%u:%a' -- "$path" 2>/dev/null)" || return 1
  uid="${metadata%%:*}"
  mode="${metadata##*:}"
  [[ "$uid" == "$expected_uid" ]] || return 1
  (( (8#$mode & 0022) == 0 ))
}

check_preconditions() {
  local auth_uid auth_gid directory_metadata directory_uid directory_gid directory_mode

  (( EUID == 0 )) || {
    printf 'ERROR: enrollment must be run as root.\n' >&2
    exit 77
  }
  [[ "$#" == 0 ]] || fail "usage: ${0##*/}"
  for binary in \
    "$AWK_BIN" "$CMP_BIN" "$CURL_BIN" "$ENV_BIN" "$FLOCK_BIN" "$GREP_BIN" \
    "$HEAD_BIN" "$ID_BIN" "$INSTALL_BIN" "$LN_BIN" "$MKTEMP_BIN" \
    "$MV_BIN" "$NGINX_BIN" "$OPENSSL_BIN" "$PYTHON_BIN" "$RM_BIN" "$RUNUSER_BIN" "$SED_BIN" \
    "$SLEEP_BIN" "$SS_BIN" "$STAT_BIN" "$SYSTEMCTL_BIN" "$TIMEOUT_BIN" "$WC_BIN"; do
    [[ -x "$binary" ]] || fail "required system tool is unavailable"
  done

  auth_uid="$($ID_BIN -u "$AUTH_USER")" || fail "auth service user is unavailable"
  auth_gid="$($ID_BIN -g "$AUTH_USER")" || fail "auth service group is unavailable"
  [[ "$($ID_BIN -gn "$AUTH_USER")" == "$AUTH_GROUP" ]] \
    || fail "auth service primary group is unexpected"
  require_regular_file "$HELPER_BIN" 0 || fail "capture helper is not a protected root-owned executable"
  [[ -x "$HELPER_BIN" ]] || fail "capture helper is not executable"
  require_regular_file "$AUTH_SNIPPET" 0 || fail "auth gateway Nginx snippet is unsafe"
  require_regular_file "$PUBLIC_PROXY_SNIPPET" 0 || fail "auth proxy Nginx snippet is unsafe"

  [[ -d /run/tencorp-auth-gateway && ! -L /run/tencorp-auth-gateway ]] \
    || fail "auth runtime directory is unavailable"
  directory_metadata="$($STAT_BIN -c '%u:%g:%a' -- /run/tencorp-auth-gateway)" \
    || fail "could not inspect auth runtime directory"
  directory_uid="${directory_metadata%%:*}"
  directory_metadata="${directory_metadata#*:}"
  directory_gid="${directory_metadata%%:*}"
  directory_mode="${directory_metadata##*:}"
  [[ "$directory_uid" == "$auth_uid" && "$directory_gid" == "$auth_gid" && "$directory_mode" == 700 ]] \
    || fail "auth runtime directory has unsafe ownership or permissions"

  [[ ! -e "$CAPTURE_OUTPUT" && ! -L "$CAPTURE_OUTPUT" ]] \
    || fail "capture output already exists; review it manually before retrying"
  [[ ! -e "$FIXTURE" && ! -L "$FIXTURE" ]] \
    || fail "deployment smoke fixture already exists; enrollment will not overwrite it"
  [[ ! -e "$CAPTURE_PROXY_SNIPPET" && ! -L "$CAPTURE_PROXY_SNIPPET" ]] \
    || fail "temporary callback proxy snippet already exists"
  "$SYSTEMCTL_BIN" is-active --quiet tencorp-auth-gateway \
    || fail "auth gateway is not active"
  "$SYSTEMCTL_BIN" is-active --quiet nginx || fail "Nginx is not active"
  "$CURL_BIN" --disable --noproxy '*' --silent --show-error --fail \
    --connect-timeout 2 --max-time 5 --output /dev/null \
    http://127.0.0.1:4340/healthz \
    || fail "primary auth gateway health check failed"
  if "$SS_BIN" -ltnH | "$AWK_BIN" '$4 == "127.0.0.1:4341" { found = 1 } END { exit !found }'; then
    fail "capture listener address is already occupied"
  fi
  "$NGINX_BIN" -t >/dev/null || fail "current Nginx configuration is invalid"
}

read_expected_identity() {
  printf 'Dedicated smoke account Telegram ID: ' >&2
  IFS= read -r -s EXPECTED_TELEGRAM_ID \
    || fail "could not read the expected Telegram ID"
  printf '\n' >&2
  [[ "$EXPECTED_TELEGRAM_ID" =~ ^[1-9][0-9]{0,18}$ ]] \
    || fail "expected Telegram ID has an invalid format"
}

create_marker() {
  local raw marker

  raw="$($OPENSSL_BIN rand -base64 32)" || fail "could not generate enrollment marker"
  marker="${raw//+/-}"
  marker="${marker//\//_}"
  marker="${marker//=}"
  marker="${marker//$'\n'/}"
  raw=""
  [[ ${#marker} == 43 && "$marker" =~ ^[A-Za-z0-9_-]+$ ]] \
    || fail "generated enrollment marker is invalid"
  printf '%s' "$marker"
}

prepare_candidates() {
  local source_target_count capture_target_count

  WORK_DIR="$($MKTEMP_BIN -d /run/tencorp-auth-enroll.XXXXXX)" \
    || fail "could not create protected enrollment workspace"
  chmod 0700 -- "$WORK_DIR"
  ORIGINAL_AUTH_SNIPPET="${WORK_DIR}/tencorp-auth-gateway.original.conf"
  GATEWAY_CANDIDATE="${WORK_DIR}/tencorp-auth-gateway.capture.conf"
  CAPTURE_PROXY_CANDIDATE="${WORK_DIR}/tencorp-auth-smoke-callback-proxy.conf"
  CAPTURE_SNAPSHOT="${WORK_DIR}/deploy-smoke-session.snapshot"
  CURL_CONFIG="${WORK_DIR}/curl.conf"
  ME_RESPONSE="${WORK_DIR}/me.json"

  "$INSTALL_BIN" -o root -g root -m 0600 -- "$AUTH_SNIPPET" "$ORIGINAL_AUTH_SNIPPET" \
    || fail "could not preserve the original auth snippet"
  source_target_count="$($GREP_BIN -Fc 'proxy_pass http://127.0.0.1:4340;' "$PUBLIC_PROXY_SNIPPET" || true)"
  [[ "$source_target_count" == 1 ]] \
    || fail "shared auth proxy has an unexpected upstream contract"
  "$SED_BIN" 's#proxy_pass http://127.0.0.1:4340;#proxy_pass http://127.0.0.1:4341;#' \
    "$PUBLIC_PROXY_SNIPPET" > "$CAPTURE_PROXY_CANDIDATE"
  capture_target_count="$($GREP_BIN -Fc 'proxy_pass http://127.0.0.1:4341;' "$CAPTURE_PROXY_CANDIDATE" || true)"
  [[ "$capture_target_count" == 1 ]] \
    || fail "temporary callback proxy does not target the capture helper exactly once"
  if "$GREP_BIN" -Fq 'proxy_pass http://127.0.0.1:4340;' "$CAPTURE_PROXY_CANDIDATE"; then
    fail "temporary callback proxy still targets the primary gateway"
  fi

  "$AWK_BIN" '
    $0 == "location = /__auth/telegram/callback {" { in_callback = 1 }
    in_callback && $0 == "    include /etc/nginx/snippets/tencorp-auth-public-proxy.conf;" {
      print "    include /etc/nginx/snippets/tencorp-auth-smoke-callback-proxy.conf;"
      changed += 1
      next
    }
    { print }
    in_callback && $0 == "}" { in_callback = 0 }
    END { if (changed != 1) exit 64 }
  ' "$AUTH_SNIPPET" > "$GATEWAY_CANDIDATE" \
    || fail "could not isolate the exact Telegram callback location"
  [[ "$($GREP_BIN -Fc 'include /etc/nginx/snippets/tencorp-auth-smoke-callback-proxy.conf;' "$GATEWAY_CANDIDATE" || true)" == 1 ]] \
    || fail "capture include was not isolated to one location"
}

start_helper() {
  local marker="$1"
  local attempt status

  "$TIMEOUT_BIN" --foreground --signal=TERM --kill-after=5s 30m \
    "$RUNUSER_BIN" --user "$AUTH_USER" -- \
    "$ENV_BIN" -i PATH=/usr/bin:/bin "$HELPER_BIN" "$marker" &
  HELPER_RUNNER_PID=$!
  for (( attempt = 0; attempt < 50; attempt += 1 )); do
    status="$($CURL_BIN \
      --disable \
      --noproxy '*' \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --connect-timeout 1 \
      --max-time 2 \
      "http://127.0.0.1:4341/__auth-smoke/ready/${marker}" 2>/dev/null || true)"
    if [[ "$status" == 204 ]] && kill -0 "$HELPER_RUNNER_PID" 2>/dev/null; then
      return 0
    fi
    kill -0 "$HELPER_RUNNER_PID" 2>/dev/null \
      || fail "capture helper stopped before becoming ready"
    "$SLEEP_BIN" 0.1
  done
  fail "capture helper did not bind its loopback listener"
}

switch_callback() {
  CAPTURE_PROXY_CREATED=1
  "$INSTALL_BIN" -o root -g root -m 0644 -- \
    "$CAPTURE_PROXY_CANDIDATE" "${CAPTURE_PROXY_SNIPPET}.enroll.$$" \
    || fail "could not stage the temporary callback proxy"
  "$MV_BIN" -Tf -- "${CAPTURE_PROXY_SNIPPET}.enroll.$$" "$CAPTURE_PROXY_SNIPPET" \
    || fail "could not install the temporary callback proxy"

  CALLBACK_SWITCHED=1
  atomic_install "$GATEWAY_CANDIDATE" "$AUTH_SNIPPET" 0644 \
    || fail "could not stage the temporary callback route"
  "$NGINX_BIN" -t >/dev/null || fail "temporary callback configuration failed validation"
  "$SYSTEMCTL_BIN" reload nginx || fail "could not activate the temporary callback route"
  "$SYSTEMCTL_BIN" is-active --quiet nginx || fail "Nginx is not active after callback reload"
}

wait_for_capture() {
  while kill -0 "$HELPER_RUNNER_PID" 2>/dev/null; do
    if [[ -e "$CAPTURE_OUTPUT" || -L "$CAPTURE_OUTPUT" ]]; then
      return 0
    fi
    "$SLEEP_BIN" 0.2
  done
  [[ -e "$CAPTURE_OUTPUT" || -L "$CAPTURE_OUTPUT" ]]
}

validate_capture() {
  local auth_uid auth_gid metadata uid gid mode size byte_count

  auth_uid="$($ID_BIN -u "$AUTH_USER")" || fail "could not resolve auth service owner"
  auth_gid="$($ID_BIN -g "$AUTH_USER")" || fail "could not resolve auth service group"
  [[ -f "$CAPTURE_OUTPUT" && ! -L "$CAPTURE_OUTPUT" ]] \
    || fail "capture helper did not create a regular session file"
  metadata="$($STAT_BIN -c '%u:%g:%a:%s' -- "$CAPTURE_OUTPUT")" \
    || fail "could not inspect captured session"
  uid="${metadata%%:*}"
  metadata="${metadata#*:}"
  gid="${metadata%%:*}"
  metadata="${metadata#*:}"
  mode="${metadata%%:*}"
  size="${metadata##*:}"
  [[ "$uid" == "$auth_uid" && "$gid" == "$auth_gid" && "$mode" == 600 && "$size" == 44 ]] \
    || fail "captured session has unsafe ownership, permissions, or length"
  "$GREP_BIN" -Eq '^[A-Za-z0-9_-]{43}$' "$CAPTURE_OUTPUT" \
    || fail "captured session token has an invalid format"
  byte_count="$($WC_BIN -c < "$CAPTURE_OUTPUT")"
  (( byte_count == 44 )) || fail "captured session has an invalid record boundary"

  "$INSTALL_BIN" -o root -g root -m 0600 -- "$CAPTURE_OUTPUT" "$CAPTURE_SNAPSHOT" \
    || fail "could not snapshot the captured session"
  "$CMP_BIN" --silent -- "$CAPTURE_OUTPUT" "$CAPTURE_SNAPSHOT" \
    || fail "captured session changed while it was secured"
  "$RM_BIN" -f -- "$CAPTURE_OUTPUT"
}

validate_public_session() {
  local status

  {
    printf '%s' 'cookie = "__Host-tencorp_session='
    "$HEAD_BIN" -c 43 -- "$CAPTURE_SNAPSHOT"
    printf '"\n'
  } > "$CURL_CONFIG"
  chmod 0600 -- "$CURL_CONFIG"
  : > "$ME_RESPONSE"
  chmod 0600 -- "$ME_RESPONSE"
  status="$($CURL_BIN \
    --disable \
    --noproxy '*' \
    --silent \
    --show-error \
    --output "$ME_RESPONSE" \
    --write-out '%{http_code}' \
    --connect-timeout 5 \
    --max-time 20 \
    --header 'Accept: application/json' \
    --config "$CURL_CONFIG" \
    "${PUBLIC_ORIGIN}/__auth/me")" \
    || fail "captured session could not reach the public identity endpoint"
  [[ "$status" == 200 ]] || fail "captured session was not accepted by the public identity endpoint"
  "$PYTHON_BIN" - "$ME_RESPONSE" "$EXPECTED_TELEGRAM_ID" <<'PY' || fail "captured session does not belong to the expected verified smoke account"
import json
import sys

path, expected_id = sys.argv[1:]
try:
    with open(path, "r", encoding="utf-8") as response_file:
        payload = json.load(response_file)
except (OSError, ValueError):
    raise SystemExit(1)
if not isinstance(payload, dict):
    raise SystemExit(1)
if str(payload.get("telegramId", "")) != expected_id:
    raise SystemExit(1)
if payload.get("phoneNumberVerified") is not True:
    raise SystemExit(1)
expires_at = payload.get("sessionExpiresAt")
if not isinstance(expires_at, str) or not expires_at:
    raise SystemExit(1)
if {"id", "phoneNumber", "pictureUrl"}.intersection(payload):
    raise SystemExit(1)
PY
}

install_fixture() {
  local metadata

  [[ ! -e "$FIXTURE" && ! -L "$FIXTURE" ]] \
    || fail "deployment smoke fixture appeared during enrollment"
  FIXTURE_STAGE="${FIXTURE}.enroll.$$"
  "$INSTALL_BIN" -o root -g root -m 0600 -- "$CAPTURE_SNAPSHOT" "$FIXTURE_STAGE" \
    || fail "could not stage the deployment smoke fixture"
  metadata="$($STAT_BIN -c '%u:%g:%a:%s' -- "$FIXTURE_STAGE")" \
    || fail "could not inspect the staged deployment smoke fixture"
  [[ "$metadata" == 0:0:600:44 ]] \
    || fail "staged deployment smoke fixture has unsafe metadata"
  "$CMP_BIN" --silent -- "$CAPTURE_SNAPSHOT" "$FIXTURE_STAGE" \
    || fail "staged deployment smoke fixture changed"
  FIXTURE_CREATED=1
  "$LN_BIN" -- "$FIXTURE_STAGE" "$FIXTURE" \
    || fail "deployment smoke fixture already exists"
  "$RM_BIN" -f -- "$FIXTURE_STAGE"
  FIXTURE_STAGE=""
  metadata="$($STAT_BIN -c '%u:%g:%a:%s' -- "$FIXTURE")" \
    || fail "could not inspect the installed deployment smoke fixture"
  [[ "$metadata" == 0:0:600:44 ]] \
    || fail "installed deployment smoke fixture has unsafe metadata"
  "$CMP_BIN" --silent -- "$CAPTURE_SNAPSHOT" "$FIXTURE" \
    || fail "installed deployment smoke fixture changed"
  FIXTURE_INSTALLED=1
}

main() {
  local marker capture_ready=0

  (( EUID == 0 )) || {
    printf 'ERROR: enrollment must be run as root.\n' >&2
    exit 77
  }
  [[ "$#" == 0 ]] || fail "usage: ${0##*/}"
  [[ -x "$FLOCK_BIN" ]] || fail "required system tool is unavailable"
  exec 9>"$DEPLOY_LOCK"
  "$FLOCK_BIN" -n 9 || fail "a Residence deployment or enrollment is already running"
  check_preconditions "$@"
  read_expected_identity
  prepare_candidates
  marker="$(create_marker)"
  start_helper "$marker"
  switch_callback

  printf 'Open this URL in a private browser and sign in with the dedicated smoke account (valid for 30 minutes):\n'
  printf '%s/__auth/login?return_to=%%2F__auth%%2Faccount%%3Fsmoke_enroll%%3D%s\n' \
    "$PUBLIC_ORIGIN" "$marker"
  if wait_for_capture; then
    capture_ready=1
  fi

  # This ordering is a hard safety invariant: public callbacks return to 4340
  # before the helper is stopped and before captured credentials are inspected.
  restore_callback || fail "primary callback restoration failed"
  stop_helper
  (( capture_ready == 1 )) || fail "no qualifying Telegram session was captured within 30 minutes"

  validate_capture
  validate_public_session
  install_fixture
  EXPECTED_TELEGRAM_ID=""
  printf 'Authenticated deployment smoke fixture installed; public gate configuration was not changed.\n'
}

main "$@"
