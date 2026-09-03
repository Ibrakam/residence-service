#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
readonly ENROLL="${TEST_DIR}/enroll-tencorp-auth-smoke.sh"
readonly NGINX_GATEWAY="${TEST_DIR}/nginx/tencorp-auth-gateway.conf"
readonly PUBLIC_PROXY="${TEST_DIR}/nginx/tencorp-auth-public-proxy.conf"

TEST_ROOT="$(mktemp -d /tmp/tencorp-auth-enroll-contract.XXXXXX)"

cleanup() {
  chmod -R u+w -- "$TEST_ROOT" 2>/dev/null || true
  rm -rf -- "$TEST_ROOT"
}

trap cleanup EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

bash -n "$ENROLL"
if (( EUID != 0 )); then
  set +e
  root_output="$(bash "$ENROLL" 2>&1)"
  root_status=$?
  set -e
  [[ "$root_status" == 77 ]] || fail "non-root enrollment did not use EX_NOPERM"
  [[ "$root_output" == *'must be run as root'* ]] || fail "non-root denial is unclear"
fi
[[ "$(grep -Fc 'proxy_pass http://127.0.0.1:4340;' "$PUBLIC_PROXY" || true)" == 1 ]] \
  || fail "shared public proxy no longer has one fixed primary upstream"
callback_block="$(sed -n '/^location = \/__auth\/telegram\/callback {$/,/^}$/p' "$NGINX_GATEWAY")"
[[ "$callback_block" == *'include /etc/nginx/snippets/tencorp-auth-public-proxy.conf;'* ]] \
  || fail "tracked callback no longer uses the shared primary proxy"

sed 's#proxy_pass http://127.0.0.1:4340;#proxy_pass http://127.0.0.1:4341;#' \
  "$PUBLIC_PROXY" > "$TEST_ROOT/capture-proxy.conf"
sed 's#proxy_pass http://127.0.0.1:4341;#proxy_pass http://127.0.0.1:4340;#' \
  "$TEST_ROOT/capture-proxy.conf" > "$TEST_ROOT/round-trip-proxy.conf"
cmp --silent -- "$PUBLIC_PROXY" "$TEST_ROOT/round-trip-proxy.conf" \
  || fail "temporary proxy derivation changes more than the callback upstream"
for stripped_header in 'Authorization ""' 'X-Original-URI ""' 'X-Auth-User-ID ""' 'X-Auth-Telegram-ID ""' 'X-Auth-Phone ""'; do
  grep -Fq "proxy_set_header ${stripped_header};" "$TEST_ROOT/capture-proxy.conf" \
    || fail "temporary callback proxy loses a shared header-stripping rule"
done

grep -Fq 'set +x' "$ENROLL" || fail "enrollment may inherit shell tracing"
grep -Fq 'if ! restore_callback; then' "$ENROLL" \
  || fail "exit cleanup does not restore the primary callback first"
grep -Fq 'readonly HELPER_BIN="/opt/tencorp-auth-gateway/current/auth-smoke-capture"' "$ENROLL" \
  || fail "capture helper path is not fixed"
grep -Fq '"$RUNUSER_BIN" --user "$AUTH_USER" --' "$ENROLL" \
  || fail "capture helper does not run as the dedicated service user"
grep -Fq '"$ENV_BIN" -i PATH=/usr/bin:/bin "$HELPER_BIN" "$marker"' "$ENROLL" \
  || fail "capture helper inherits ambient environment variables"
grep -Fq '"$TIMEOUT_BIN" --foreground --signal=TERM --kill-after=5s 30m' "$ENROLL" \
  || fail "capture helper lacks the fixed 30-minute timeout"
grep -Fq 'fail "capture listener address is already occupied"' "$ENROLL" \
  || fail "enrollment does not require an unused capture listener"
grep -Fq '"http://127.0.0.1:4341/__auth-smoke/ready/${marker}"' "$ENROLL" \
  || fail "capture readiness is not bound to the generated marker"
grep -Fq 'proxy_pass http://127.0.0.1:4340;' "$ENROLL" \
  || fail "enrollment does not verify the primary callback upstream"
grep -Fq 'proxy_pass http://127.0.0.1:4341;' "$ENROLL" \
  || fail "temporary callback proxy does not select the capture helper"
grep -Fq '$0 == "location = /__auth/telegram/callback {"' "$ENROLL" \
  || fail "Nginx edit is not scoped to the exact callback location"
grep -Fq 'END { if (changed != 1) exit 64 }' "$ENROLL" \
  || fail "Nginx edit does not require exactly one callback change"
grep -Fq '"$NGINX_BIN" -t >/dev/null' "$ENROLL" \
  || fail "temporary and restored Nginx configurations are not validated"
grep -Fq '"$SYSTEMCTL_BIN" reload nginx' "$ENROLL" \
  || fail "Nginx callback changes are not reloaded"
grep -Fq '[[ "$uid" == "$auth_uid" && "$gid" == "$auth_gid" && "$mode" == 600 && "$size" == 44 ]]' "$ENROLL" \
  || fail "captured session metadata is not pinned"
grep -Fq "'^[A-Za-z0-9_-]{43}$'" "$ENROLL" \
  || fail "captured session token shape is not validated"
grep -Fq '"${PUBLIC_ORIGIN}/__auth/me"' "$ENROLL" \
  || fail "captured session is not checked through the public identity endpoint"
grep -Fq 'if str(payload.get("telegramId", "")) != expected_id:' "$ENROLL" \
  || fail "captured session identity is not matched to the expected smoke account"
grep -Fq 'if payload.get("phoneNumberVerified") is not True:' "$ENROLL" \
  || fail "captured account phone verification is not required"
grep -Fq '"$INSTALL_BIN" -o root -g root -m 0600 -- "$CAPTURE_SNAPSHOT" "$FIXTURE_STAGE"' "$ENROLL" \
  || fail "persistent fixture is not staged as root:root mode 0600"
if grep -Eq 'public-gate-enabled|tencorp-auth-gate\.conf' "$ENROLL"; then
  fail "enrollment script may enable the public gate"
fi
if grep -Eq '(^|[[:space:]])(cat|head)[[:space:]]+[^#\n]*CAPTURE_(OUTPUT|SNAPSHOT)([[:space:]]|$)' "$ENROLL"; then
  fail "enrollment script may print the captured token"
fi

main_body="$(sed -n '/^main() {/,/^}/p' "$ENROLL")"
restore_line="$(printf '%s\n' "$main_body" | grep -nF 'restore_callback || fail' | cut -d: -f1)"
validate_line="$(printf '%s\n' "$main_body" | grep -nF 'validate_capture' | cut -d: -f1)"
install_line="$(printf '%s\n' "$main_body" | grep -nF 'install_fixture' | cut -d: -f1)"
[[ -n "$restore_line" && -n "$validate_line" && -n "$install_line" ]] \
  || fail "main enrollment sequence is incomplete"
(( restore_line < validate_line && validate_line < install_line )) \
  || fail "credentials are inspected or installed before callback restoration"

printf 'tencorp auth smoke enrollment contract: ok\n'
