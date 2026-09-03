#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly TEST_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
readonly BOT_SCRIPT="${TEST_DIR}/configure-tencorp-auth-bot.sh"
readonly DEPLOYER="${TEST_DIR}/deploy-residence-root.sh"
readonly NGINX_DIR="${TEST_DIR}/nginx"
readonly NGINX_ASSET_PROXY="${NGINX_DIR}/tencorp-auth-assets-proxy.conf"
readonly SYSTEMD_UNIT="${TEST_DIR}/systemd/tencorp-auth-gateway.service"
readonly BOT_SYSTEMD_DROPIN="${TEST_DIR}/systemd/tencorp-auth-gateway-bot-webhook.conf"
readonly GRANTS_SQL="${TEST_DIR}/postgresql/tencorp-auth-gateway-grants.sql"
readonly NGINX_TEST_CONFIG="${TEST_DIR}/test-fixtures/tencorp-auth-nginx.conf"
readonly NGINX_BOOTSTRAP_TEST_CONFIG="${TEST_DIR}/test-fixtures/tencorp-auth-bootstrap-nginx.conf"

TEST_ROOT="$(mktemp -d)"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [[ -n "${TEST_ROOT:-}" && -d "$TEST_ROOT" ]]; then
    chmod -R u+w -- "$TEST_ROOT" 2>/dev/null || true
    rm -rf -- "$TEST_ROOT"
  fi
}

trap cleanup EXIT HUP INT TERM

bash -n "$BOT_SCRIPT"
bash -n "$DEPLOYER"
[[ -f "$NGINX_TEST_CONFIG" ]] || fail "Nginx syntax-test fixture is missing"
[[ -f "$NGINX_BOOTSTRAP_TEST_CONFIG" ]] || fail "Nginx bootstrap syntax-test fixture is missing"

grep -Fq 'User=tencorp-auth-gateway' "$SYSTEMD_UNIT" \
  || fail "systemd unit does not use the dedicated identity"
grep -Fq 'AUTH_GATEWAY_ADDR=127.0.0.1:4340' "$SYSTEMD_UNIT" \
  || fail "systemd unit does not force the loopback listener"
grep -Fq 'AUTH_AUTO_MIGRATE=false' "$SYSTEMD_UNIT" \
  || fail "systemd unit permits runtime migrations"
grep -Fq 'ProtectSystem=strict' "$SYSTEMD_UNIT" \
  || fail "systemd unit lacks filesystem hardening"
grep -Fq 'CapabilityBoundingSet=' "$SYSTEMD_UNIT" \
  || fail "systemd unit does not drop capabilities"
if grep -Fq 'bot.env' "$SYSTEMD_UNIT"; then
  fail "disabled base service must not inherit the Bot API token"
fi
grep -Fq 'EnvironmentFile=/etc/tencorp-auth-gateway/bot.env' "$BOT_SYSTEMD_DROPIN" \
  || fail "bot webhook drop-in does not load its protected env"
grep -Fq 'Environment=AUTH_BOT_WEBHOOK_ENABLED=true' "$BOT_SYSTEMD_DROPIN" \
  || fail "bot webhook drop-in does not explicitly enable the handler"

grep -Fq 'limit_req_zone $binary_remote_addr zone=tencorp_auth_start_per_ip' \
  "$NGINX_DIR/tencorp-auth-rate-limits.conf" \
  || fail "auth start rate-limit zone is missing"
grep -Fqx 'auth_request /__tencorp-auth/check;' "$NGINX_DIR/tencorp-auth-gate.conf" \
  || fail "separate public gate is not fail-closed at server scope"
if grep -Fqx 'auth_request /__tencorp-auth/check;' "$NGINX_DIR/tencorp-auth-gateway.conf"; then
  fail "OIDC bootstrap routes unexpectedly enable the public gate"
fi
grep -Fq 'include /etc/nginx/snippets/tencorp-auth-gateway.conf;' "$NGINX_BOOTSTRAP_TEST_CONFIG" \
  || fail "bootstrap fixture does not expose the auth routes"
if grep -Fq 'include /etc/nginx/snippets/tencorp-auth-gate.conf;' "$NGINX_BOOTSTRAP_TEST_CONFIG"; then
  fail "bootstrap fixture closes the sites before a real OIDC session exists"
fi
grep -Fq 'include /etc/nginx/snippets/tencorp-auth-gate.conf;' "$NGINX_TEST_CONFIG" \
  || fail "gated fixture does not enable the separate public gate"
grep -Fq 'zone=tencorp_auth_login_per_ip burst=60 nodelay;' \
  "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "login burst cannot accommodate the complete gated deploy smoke"
grep -Fq 'location = /__auth/telegram/callback' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "exact callback location is missing"
grep -Fq 'location = /__auth/telegram/bot-webhook' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "exact bot webhook location is missing"
grep -Fq 'location ^~ /__auth/assets/' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "dedicated immutable auth-asset location is missing"
grep -Fq 'tencorp-auth-assets-proxy.conf' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "auth assets do not use their dedicated proxy contract"
grep -Fq 'auth_request off;' "$NGINX_ASSET_PROXY" \
  || fail "auth assets do not override the public gate"
if grep -Eiq 'no-store|private' "$NGINX_ASSET_PROXY"; then
  fail "immutable auth assets are overwritten with a private/no-store policy"
fi
grep -Fq 'Strict-Transport-Security' "$NGINX_ASSET_PROXY" \
  || fail "auth assets lack HSTS at their location level"
grep -Fq 'Strict-Transport-Security' "$NGINX_DIR/tencorp-auth-public-proxy.conf" \
  || fail "public auth responses lose HSTS at their location level"
if grep -Fq 'add_header Referrer-Policy' "$NGINX_DIR/tencorp-auth-public-proxy.conf"; then
  fail "Nginx must preserve the callback-specific backend referrer policy"
fi
grep -Fq 'location = /__tencorp-auth/check' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "private auth check location is missing"
grep -Fq 'proxy_pass http://127.0.0.1:4340/internal/check;' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "Nginx check does not map to the backend endpoint"
grep -Fq 'proxy_set_header X-Original-URI $request_uri;' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "internal login render does not overwrite the original URI"
if sed -n '/location = \/__tencorp-auth\/check {/,/^}/p' "$NGINX_DIR/tencorp-auth-gateway.conf" \
  | grep -Eq 'limit_req[[:space:]]'; then
  fail "internal session checks must not be rate-limited"
fi
for public_location in '/__auth' '/__auth/login' '/__auth/telegram/start' '/__auth/telegram/callback' '/__auth/telegram/bot-webhook'; do
  location_block="$(sed -n "\\|location = ${public_location} {|,/^}/p" "$NGINX_DIR/tencorp-auth-gateway.conf")"
  [[ "$location_block" == *'auth_request off;'* || "$location_block" == *'tencorp-auth-public-proxy.conf'* ]] \
    || fail "public auth location does not override the server gate: ${public_location}"
done
grep -Fq 'error_page 401 = @tencorp_auth_page_unauthorized;' \
  "$NGINX_DIR/tencorp-auth-protect-page.conf" \
  || fail "browser page auth handler is missing"
grep -Fq 'error_page 401 = @tencorp_auth_api_unauthorized;' \
  "$NGINX_DIR/tencorp-auth-protect-api.conf" \
  || fail "API auth handler is missing"
for protection in tencorp-auth-protect-page.conf tencorp-auth-protect-api.conf; do
  grep -Fq 'proxy_set_header Cookie "";' "$NGINX_DIR/$protection" \
    || fail "protected upstream receives the shared session cookie: ${protection}"
  grep -Fq 'proxy_set_header Authorization "";' "$NGINX_DIR/$protection" \
    || fail "protected upstream receives an ambient Authorization header: ${protection}"
  grep -Fq 'proxy_hide_header Cache-Control;' "$NGINX_DIR/$protection" \
    || fail "protected upstream can expose a reusable cache policy: ${protection}"
  grep -Fq 'proxy_hide_header Set-Cookie;' "$NGINX_DIR/$protection" \
    || fail "protected upstream can overwrite the shared session cookie: ${protection}"
  grep -Fq 'add_header Cache-Control "private, no-store" always;' "$NGINX_DIR/$protection" \
    || fail "protected response is not private/no-store: ${protection}"
done
grep -Fq 'proxy_hide_header Set-Cookie;' "$NGINX_DIR/tencorp-auth-exempt.conf" \
  || fail "auth-exempt upstream can overwrite the shared session cookie"
grep -Fq 'proxy_hide_header Set-Cookie;' "$NGINX_DIR/tencorp-ticket-worker-api.conf" \
  || fail "ticket-worker upstream can overwrite the shared session cookie"
grep -Fq 'return 401 '\''{"error":"authentication_required"}\n'\'';' \
  "$NGINX_DIR/tencorp-auth-gateway.conf" \
  || fail "non-HTML page requests do not receive the JSON 401 contract"
grep -Fq 'auth_request off;' "$NGINX_DIR/tencorp-auth-exempt.conf" \
  || fail "explicit auth exemption is missing"
for stripped_header in Cookie X-Auth-User-ID X-Auth-Telegram-ID X-Auth-Phone; do
  grep -Fq "proxy_set_header ${stripped_header} \"\";" "$NGINX_DIR/tencorp-auth-exempt.conf" \
    || fail "auth-exempt upstream receives the shared credential header: ${stripped_header}"
  grep -Fq "proxy_set_header ${stripped_header} \"\";" "$NGINX_DIR/tencorp-ticket-worker-api.conf" \
    || fail "ticket-worker upstream receives the shared credential header: ${stripped_header}"
done
grep -Fq 'proxy_set_header Authorization "";' "$NGINX_DIR/tencorp-auth-public-proxy.conf" \
  || fail "public auth gateway receives an ambient Authorization header"
grep -Fq 'auth_request off;' "$NGINX_DIR/tencorp-ticket-worker-api.conf" \
  || fail "ticket worker did not retain its independent Bearer boundary"

if grep -Eq '^#[^!]' "$GRANTS_SQL"; then
  fail "PostgreSQL grants contain a non-SQL shell comment"
fi
for relation in web_auth_users web_auth_login_transactions web_auth_sessions web_auth_users_id_seq; do
  grep -Fq "$relation" "$GRANTS_SQL" || fail "PostgreSQL grants omit ${relation}"
done
grep -Fq "class.relname NOT IN (" "$GRANTS_SQL" \
  || fail "PostgreSQL grants do not fail closed on unrelated tables"
grep -Fq "has_sequence_privilege('tencorp_auth_gateway', relation.oid" "$GRANTS_SQL" \
  || fail "PostgreSQL grants do not reject access to unrelated sequences"
grep -Fq "has_function_privilege('tencorp_auth_gateway', routine.oid, 'EXECUTE')" "$GRANTS_SQL" \
  || fail "PostgreSQL grants do not reject inherited EXECUTE on public routines"
grep -Fq "has_column_privilege('tencorp_auth_gateway', 'web_auth_users', column_name, 'SELECT')" "$GRANTS_SQL" \
  || fail "PostgreSQL grants do not verify column-level user reads"
if grep -Eq '^GRANT[[:space:]]+SELECT,[[:space:]]+INSERT,[[:space:]]+UPDATE[[:space:]]+ON[[:space:]]+TABLE[[:space:]]+web_auth_users' "$GRANTS_SQL"; then
  fail "auth role has obsolete table-wide user privileges"
fi

bot_env="${TEST_ROOT}/bot.env"
fake_bot_id="123456789"
fake_bot_token="${fake_bot_id}:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
cat > "$bot_env" <<EOF
TELEGRAM_AUTH_BOT_TOKEN=${fake_bot_token}
TELEGRAM_AUTH_WEBHOOK_SECRET=GENERATE_ME
TELEGRAM_BOT_EXPECTED_ID=${fake_bot_id}
TELEGRAM_BOT_PROFILE_PHOTO_FILE=
EOF
chmod 0600 "$bot_env"

TENCORP_AUTH_BOT_ENV_FILE="$bot_env" "$BOT_SCRIPT" --initialize-webhook-secret >/dev/null
webhook_secret="$(sed -n 's/^TELEGRAM_AUTH_WEBHOOK_SECRET=//p' "$bot_env")"
(( ${#webhook_secret} >= 32 && ${#webhook_secret} <= 256 )) \
  && [[ "$webhook_secret" =~ ^[A-Za-z0-9_-]+$ ]] \
  || fail "webhook secret initialization produced an invalid value"
TENCORP_AUTH_BOT_ENV_FILE="$bot_env" "$BOT_SCRIPT" --check >/dev/null

bot_bin="${TEST_ROOT}/bot-bin"
bot_call_log="${TEST_ROOT}/bot-calls"
mkdir -p "$bot_bin"
cat > "$bot_bin/curl" <<'FAKE_BOT_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
output=""
config=""
previous=""
for argument in "$@"; do
  printf '%s\n' "$argument" >> "$BOT_CALL_LOG"
  case "$previous" in
    output) output="$argument" ;;
    config) config="$argument" ;;
  esac
  previous=""
  case "$argument" in
    --output) previous=output ;;
    --config) previous=config ;;
  esac
done
[[ -n "$output" && -n "$config" ]]
if grep -Fq '/getMe"' "$config"; then
  printf '{"ok":true,"result":{"id":123456789,"is_bot":true}}\n' > "$output"
else
  printf '{"ok":true,"result":true}\n' > "$output"
fi
FAKE_BOT_CURL
chmod 0700 "$bot_bin/curl"
: > "$bot_call_log"

bot_output="$({
  BOT_CALL_LOG="$bot_call_log" \
  TENCORP_AUTH_BOT_CURL_BIN="$bot_bin/curl" \
  TENCORP_AUTH_BOT_ENV_FILE="$bot_env" \
  "$BOT_SCRIPT" --apply
} 2>&1)" || fail "bot profile apply harness failed"
[[ "$bot_output" != *"$fake_bot_token"* && "$bot_output" != *"$webhook_secret"* ]] \
  || fail "bot script exposed a credential in output"
if grep -Fq "$fake_bot_token" "$bot_call_log" || grep -Fq "$webhook_secret" "$bot_call_log"; then
  fail "bot script exposed a credential in process arguments"
fi
grep -Fq 'secret_token@' "$bot_call_log" \
  || fail "webhook secret is not passed through a protected file"
grep -Fq 'drop_pending_updates=true' "$bot_call_log" \
  || fail "initial webhook registration does not discard stale updates"

chmod 0644 "$bot_env"
if TENCORP_AUTH_BOT_ENV_FILE="$bot_env" "$BOT_SCRIPT" --check >/dev/null 2>&1; then
  fail "bot script accepted a world-readable credential file"
fi
chmod 0600 "$bot_env"

# Source a test-only transformed copy of the deployer. Fixed production paths
# stay immutable in the real script; only this disposable harness points them
# at local fixtures and a deterministic curl/stat implementation.
deploy_run="${TEST_ROOT}/run"
deploy_etc="${TEST_ROOT}/etc"
deploy_bin="${TEST_ROOT}/deploy-bin"
mkdir -p "$deploy_run" "$deploy_etc" "$deploy_bin"
transformed_deployer="${TEST_ROOT}/deploy-residence-root"
sed \
  -e "s|readonly AUTH_GATE_MODE_FILE=.*|readonly AUTH_GATE_MODE_FILE=\"${deploy_etc}/public-gate-enabled\"|" \
  -e "s|readonly AUTH_SMOKE_SESSION_FILE=.*|readonly AUTH_SMOKE_SESSION_FILE=\"${deploy_etc}/deploy-smoke-session\"|" \
  -e "s|/run/|${deploy_run}/|g" \
  -e 's|chmod 0600 --|chmod 0600|g' \
  "$DEPLOYER" > "$transformed_deployer"
chmod 0700 "$transformed_deployer"

cat > "$deploy_bin/stat" <<'FAKE_STAT'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$2" in
  %u) printf '0\n' ;;
  %a)
    case "${4##*/}" in
      public-gate-enabled) printf '644\n' ;;
      *) printf '600\n' ;;
    esac
    ;;
  *) exit 64 ;;
esac
FAKE_STAT

cat > "$deploy_bin/curl" <<'FAKE_DEPLOY_CURL'
#!/usr/bin/env bash
set -Eeuo pipefail
output="/dev/null"
headers=""
config=""
method="GET"
url=""
previous=""
for argument in "$@"; do
  case "$previous" in
    output) output="$argument" ;;
    headers) headers="$argument" ;;
    config) config="$argument" ;;
    method) method="$argument" ;;
  esac
  previous=""
  case "$argument" in
    --output) previous=output ;;
    --dump-header) previous=headers ;;
    --config) previous=config ;;
    --request) previous=method ;;
    http://*|https://*) url="$argument" ;;
  esac
done

path="${url#https://form.tencorp.uz}"
[[ -n "$path" ]] || path="/"
authenticated=false
[[ -n "$config" && -f "$config" ]] && authenticated=true
status=200
content_type='text/html; charset=utf-8'
body='ok'
immutable=false

case "$path" in
  /__auth/assets/brand-city-v1.webp)
    content_type='image/webp'; immutable=true ;;
  /__auth/assets/*.woff2)
    content_type='font/woff2'; immutable=true ;;
esac

if [[ "$authenticated" == true ]]; then
  case "$path" in
    /residence-assets/_next/static/*) content_type='text/css' ;;
    /residence-api/catalog/) content_type='application/json'; body='{}' ;;
    /__auth/me) content_type='application/json'; body='{"telegramId":42,"phoneNumberVerified":true}' ;;
    /__auth/account) body='<form action="/__auth/logout"></form><form action="/__auth/logout-all"></form>' ;;
  esac
else
  case "$path" in
    /|/4u|/4u/apartments|/sanat/|/avalon/|/tencorp/|/tencrop/)
      body="<form method=\"post\" action=\"/__auth/telegram/start\"><input name=\"return_to\" value=\"${path}\"></form>"
      ;;
    /residence-assets/_next/static/*|/residence-api/catalog/|/api/kayan/ofiyat-explorer)
      status=401; content_type='application/json'; body='{"error":"authentication_required"}'
      ;;
    /__tencorp-auth/check) status=404 ;;
    /privacy) status=200 ;;
    /sitemap.xml) status=404 ;;
    /api/amo-webhook) status=405; content_type='application/json' ;;
    /.well-known/acme-challenge/tencorp-auth-smoke-missing) status=404; content_type='text/plain' ;;
    /__residence-ticket-worker/internal/ticket-runner/health)
      status=401; content_type='application/json'
      ;;
    /__auth/telegram/bot-webhook) status=405; content_type='application/json' ;;
    /robots.txt) content_type='text/plain'; body=$'User-agent: *\nDisallow: /\n' ;;
    /market-map/|/analytics) status=401 ;;
    /*) body="<form method=\"post\" action=\"/__auth/telegram/start\"><input name=\"return_to\" value=\"${path}\"></form>" ;;
  esac
fi

if [[ "$output" != /dev/null ]]; then
  printf '%s' "$body" > "$output"
fi
if [[ -n "$headers" ]]; then
  {
    printf 'HTTP/1.1 %s fixture\r\n' "$status"
    printf 'Content-Type: %s\r\n' "$content_type"
    if [[ "$immutable" == true ]]; then
      printf 'Cache-Control: public, max-age=31536000, immutable\r\n'
    elif [[ "$status" == 401 || "$authenticated" == false && "$content_type" == text/html* ]]; then
      printf 'Cache-Control: private, no-store\r\n'
    fi
    printf 'Strict-Transport-Security: max-age=31536000\r\n'
    if [[ "$path" == /market-map/ ]]; then
      printf 'WWW-Authenticate: Basic realm="TENCORP Market Map"\r\n'
    fi
    if [[ "$path" == /analytics ]]; then
      printf 'WWW-Authenticate: Basic realm="TenCorp Analytics", charset="UTF-8"\r\n'
    fi
    if [[ "$path" == /__residence-ticket-worker/internal/ticket-runner/health ]]; then
      printf 'WWW-Authenticate: Bearer realm="ticket-runner"\r\n'
    fi
    printf '\r\n'
  } > "$headers"
fi
printf '%s' "$status"
FAKE_DEPLOY_CURL
chmod 0700 "$deploy_bin/stat" "$deploy_bin/curl"

printf 'tencorp-auth-gate-v1\n' > "$deploy_etc/public-gate-enabled"
printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n' > "$deploy_etc/deploy-smoke-session"
chmod 0644 "$deploy_etc/public-gate-enabled"
chmod 0600 "$deploy_etc/deploy-smoke-session"

PATH="${deploy_bin}:$PATH"
# shellcheck disable=SC1090
source "$transformed_deployer"
SMOKE_ROUTES=(/)
for project in "${DIRECT_PROJECTS[@]}"; do
  SMOKE_ROUTES+=("/${project}" "/${project}/apartments")
done
FRAMEWORK_ASSET_PATH='/residence-assets/_next/static/css/fixture.css'
configure_public_auth_smoke_mode
[[ "$PUBLIC_AUTH_GATE_ENABLED" == 1 && -f "$AUTH_SMOKE_CURL_CONFIG" ]] \
  || fail "deployer did not enable the explicit fixture mode"
fixture_config="$AUTH_SMOKE_CURL_CONFIG"
grep -Fqx 'noproxy = "*"' "$fixture_config" \
  || fail "authenticated deployment smoke can leak its cookie through a proxy"
smoke_public_unauthenticated_contract
smoke_public_authenticated_contract
cleanup_auth_smoke_config
[[ ! -e "$fixture_config" ]] || fail "deployer did not remove its temporary cookie config"

printf 'auth gateway deployment tests passed\n'
