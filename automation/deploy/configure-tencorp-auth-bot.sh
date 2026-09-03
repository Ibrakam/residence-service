#!/usr/bin/env bash

set -Eeuo pipefail
set +x

readonly DEFAULT_ENV_FILE="/etc/tencorp-auth-gateway/bot.env"
readonly BOT_API_ORIGIN="https://api.telegram.org"
readonly PUBLIC_SITE_URL="https://form.tencorp.uz/"
readonly CURL_BIN="${TENCORP_AUTH_BOT_CURL_BIN:-/usr/bin/curl}"
readonly PYTHON_BIN="${TENCORP_AUTH_BOT_PYTHON_BIN:-/usr/bin/python3}"
readonly STAT_BIN="${TENCORP_AUTH_BOT_STAT_BIN:-/usr/bin/stat}"
readonly OPENSSL_BIN="${TENCORP_AUTH_BOT_OPENSSL_BIN:-/usr/bin/openssl}"

ENV_FILE="${TENCORP_AUTH_BOT_ENV_FILE:-$DEFAULT_ENV_FILE}"
MODE=""
TELEGRAM_AUTH_BOT_TOKEN=""
TELEGRAM_AUTH_WEBHOOK_SECRET=""
TELEGRAM_BOT_EXPECTED_ID=""
TELEGRAM_BOT_PROFILE_PHOTO_FILE=""
TOKEN_SEEN=false
WEBHOOK_SECRET_SEEN=false
EXPECTED_ID_SEEN=false
PHOTO_SEEN=false
TEMP_DIR=""

[[ "$ENV_FILE" == /* ]] || {
  printf 'ERROR: bot profile env path must be absolute\n' >&2
  exit 1
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

valid_webhook_secret() {
  local value="$1"
  local length="${#1}"

  # Keep the length check separate from the regular expression. macOS ships
  # Bash 3.2, whose regex implementation rejects a {32,256} repetition because
  # the POSIX RE_DUP_MAX upper bound is 255.
  (( length >= 32 && length <= 256 )) \
    && [[ "$value" =~ ^[A-Za-z0-9_-]+$ ]]
}

usage() {
  printf 'Usage: %s (--initialize-webhook-secret|--check|--apply)\n' "${0##*/}" >&2
  exit 64
}

cleanup() {
  if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
    chmod -R u+w "$TEMP_DIR" 2>/dev/null || true
    rm -rf "$TEMP_DIR"
  fi
}

read_private_env() {
  local metadata mode owner_uid current_uid raw_line line key value

  [[ -f "$ENV_FILE" && ! -L "$ENV_FILE" ]] \
    || fail "bot profile env must be a regular non-symlink file"

  if metadata="$($STAT_BIN -c '%a:%u' -- "$ENV_FILE" 2>/dev/null)"; then
    :
  elif metadata="$($STAT_BIN -f '%Lp:%u' -- "$ENV_FILE" 2>/dev/null)"; then
    :
  else
    fail "could not inspect bot profile env permissions"
  fi
  mode="${metadata%%:*}"
  owner_uid="${metadata##*:}"
  current_uid="$(id -u)"
  [[ "$mode" == "600" ]] || fail "bot profile env must have mode 0600"
  [[ "$owner_uid" == "$current_uid" ]] \
    || fail "bot profile env must be owned by the invoking user"

  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line%$'\r'}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail "bot profile env contains an invalid line"
    key="${line%%=*}"
    value="${line#*=}"
    case "$key" in
      TELEGRAM_AUTH_BOT_TOKEN)
        [[ "$TOKEN_SEEN" == false ]] || fail "bot profile env contains a duplicate token"
        TOKEN_SEEN=true
        TELEGRAM_AUTH_BOT_TOKEN="$value"
        ;;
      TELEGRAM_AUTH_WEBHOOK_SECRET)
        [[ "$WEBHOOK_SECRET_SEEN" == false ]] || fail "bot profile env contains a duplicate webhook secret"
        WEBHOOK_SECRET_SEEN=true
        TELEGRAM_AUTH_WEBHOOK_SECRET="$value"
        ;;
      TELEGRAM_BOT_EXPECTED_ID)
        [[ "$EXPECTED_ID_SEEN" == false ]] || fail "bot profile env contains a duplicate expected id"
        EXPECTED_ID_SEEN=true
        TELEGRAM_BOT_EXPECTED_ID="$value"
        ;;
      TELEGRAM_BOT_PROFILE_PHOTO_FILE)
        [[ "$PHOTO_SEEN" == false ]] || fail "bot profile env contains a duplicate photo path"
        PHOTO_SEEN=true
        TELEGRAM_BOT_PROFILE_PHOTO_FILE="$value"
        ;;
      *)
        fail "bot profile env contains an unsupported key"
        ;;
    esac
  done < "$ENV_FILE"

  [[ "$TOKEN_SEEN" == true && "$TELEGRAM_AUTH_BOT_TOKEN" =~ ^[1-9][0-9]*:[A-Za-z0-9_-]{20,}$ ]] \
    || fail "bot profile env contains an invalid token"
  [[ "$EXPECTED_ID_SEEN" == true && "$TELEGRAM_BOT_EXPECTED_ID" =~ ^[1-9][0-9]*$ ]] \
    || fail "bot profile env contains an invalid expected bot id"
  [[ "${TELEGRAM_AUTH_BOT_TOKEN%%:*}" == "$TELEGRAM_BOT_EXPECTED_ID" ]] \
    || fail "bot token id does not match TELEGRAM_BOT_EXPECTED_ID"
  [[ "$WEBHOOK_SECRET_SEEN" == true ]] \
    || fail "bot profile env is missing TELEGRAM_AUTH_WEBHOOK_SECRET"
  if [[ "$MODE" != initialize ]]; then
    valid_webhook_secret "$TELEGRAM_AUTH_WEBHOOK_SECRET" \
      || fail "initialize the Telegram webhook secret before continuing"
  elif [[ -n "$TELEGRAM_AUTH_WEBHOOK_SECRET" && "$TELEGRAM_AUTH_WEBHOOK_SECRET" != "GENERATE_ME" ]]; then
    valid_webhook_secret "$TELEGRAM_AUTH_WEBHOOK_SECRET" \
      || fail "bot profile env contains an invalid webhook secret"
  fi

  if [[ -n "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" ]]; then
    [[ "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" == /* ]] \
      || fail "bot profile photo path must be absolute"
    [[ -f "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" && ! -L "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" ]] \
      || fail "bot profile photo must be a regular non-symlink file"
    case "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" in
      *.jpg|*.jpeg|*.JPG|*.JPEG) ;;
      *) fail "bot profile photo must be a JPG file" ;;
    esac
  fi
}

initialize_webhook_secret() {
  local generated temporary raw_line line replaced=false

  if valid_webhook_secret "$TELEGRAM_AUTH_WEBHOOK_SECRET"; then
    printf 'Telegram webhook secret is already initialized.\n'
    return 0
  fi

  generated="$($OPENSSL_BIN rand -hex 32)" \
    || fail "could not generate Telegram webhook secret"
  valid_webhook_secret "$generated" \
    || fail "generated Telegram webhook secret has an invalid format"

  umask 077
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  TEMP_DIR="$temporary"
  trap cleanup_secret_file EXIT HUP INT TERM
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line%$'\r'}"
    if [[ "$line" == TELEGRAM_AUTH_WEBHOOK_SECRET=* ]]; then
      printf 'TELEGRAM_AUTH_WEBHOOK_SECRET=%s\n' "$generated" >> "$temporary"
      replaced=true
    else
      printf '%s\n' "$line" >> "$temporary"
    fi
  done < "$ENV_FILE"
  [[ "$replaced" == true ]] || fail "bot profile env has no webhook secret placeholder"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$ENV_FILE"
  TEMP_DIR=""
  trap - EXIT HUP INT TERM
  generated=""
  printf 'Telegram webhook secret initialized.\n'
}

cleanup_secret_file() {
  if [[ -n "$TEMP_DIR" && -f "$TEMP_DIR" && ! -L "$TEMP_DIR" ]]; then
    rm -f "$TEMP_DIR"
  fi
}

validate_response() {
  local method="$1"

  "$PYTHON_BIN" - "$TEMP_DIR/response.json" "$method" "$TELEGRAM_BOT_EXPECTED_ID" <<'PY'
import json
import sys

path, method, expected_id = sys.argv[1:]
try:
    with open(path, "r", encoding="utf-8") as response_file:
        payload = json.load(response_file)
except (OSError, ValueError):
    raise SystemExit(1)
if payload.get("ok") is not True:
    raise SystemExit(1)
if method == "getMe":
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("is_bot") is not True:
        raise SystemExit(1)
    if str(result.get("id", "")) != expected_id:
        raise SystemExit(1)
PY
}

bot_api() {
  local method="$1"
  shift

  # The token lives only in a mode-0600 curl config under a mode-0700
  # temporary directory. It is never placed in argv, stdout, or stderr.
  umask 077
  printf 'url = "%s/bot%s/%s"\n' "$BOT_API_ORIGIN" "$TELEGRAM_AUTH_BOT_TOKEN" "$method" \
    > "$TEMP_DIR/curl.conf"
  : > "$TEMP_DIR/response.json"

  if ! "$CURL_BIN" \
    --disable \
    --noproxy '*' \
    --silent \
    --request POST \
    --connect-timeout 5 \
    --max-time 20 \
    --output "$TEMP_DIR/response.json" \
    --config "$TEMP_DIR/curl.conf" \
    "$@"; then
    fail "Telegram Bot API request failed"
  fi
  validate_response "$method" || fail "Telegram Bot API rejected a profile update"
}

apply_profile() {
  TEMP_DIR="$(mktemp -d)"
  chmod 0700 "$TEMP_DIR"
  trap cleanup EXIT HUP INT TERM

  bot_api getMe

  bot_api setMyName --data-urlencode 'name=TENCORP Access'
  bot_api setMyName --data-urlencode 'name=TENCORP · Доступ' --data-urlencode 'language_code=ru'
  bot_api setMyName --data-urlencode 'name=TENCORP · Kirish' --data-urlencode 'language_code=uz'
  bot_api setMyName --data-urlencode 'name=TENCORP · Access' --data-urlencode 'language_code=en'

  bot_api setMyDescription \
    --data-urlencode 'description=Безопасный вход в TENCORP через Telegram. Нажмите «Открыть TENCORP» в меню.' \
    --data-urlencode 'language_code=ru'
  bot_api setMyDescription \
    --data-urlencode 'description=Telegram orqali TENCORP’ga xavfsiz kirish. Menyuda «TENCORP’ni ochish» tugmasini bosing.' \
    --data-urlencode 'language_code=uz'
  bot_api setMyDescription \
    --data-urlencode 'description=Secure sign-in to TENCORP through Telegram. Use “Open TENCORP” in the menu.' \
    --data-urlencode 'language_code=en'
  bot_api setMyDescription \
    --data-urlencode 'description=Secure sign-in to TENCORP through Telegram.'

  bot_api setMyShortDescription \
    --data-urlencode 'short_description=Безопасный вход в TENCORP через Telegram.' \
    --data-urlencode 'language_code=ru'
  bot_api setMyShortDescription \
    --data-urlencode 'short_description=Telegram orqali TENCORP’ga xavfsiz kirish.' \
    --data-urlencode 'language_code=uz'
  bot_api setMyShortDescription \
    --data-urlencode 'short_description=Secure sign-in to TENCORP through Telegram.' \
    --data-urlencode 'language_code=en'
  bot_api setMyShortDescription \
    --data-urlencode 'short_description=Secure sign-in to TENCORP through Telegram.'

  bot_api setMyCommands \
    --data-urlencode 'commands=[{"command":"start","description":"Открыть TENCORP"},{"command":"help","description":"Помощь со входом"}]' \
    --data-urlencode 'language_code=ru'
  bot_api setMyCommands \
    --data-urlencode 'commands=[{"command":"start","description":"TENCORP’ni ochish"},{"command":"help","description":"Kirish bo‘yicha yordam"}]' \
    --data-urlencode 'language_code=uz'
  bot_api setMyCommands \
    --data-urlencode 'commands=[{"command":"start","description":"Open TENCORP"},{"command":"help","description":"Sign-in help"}]' \
    --data-urlencode 'language_code=en'
  bot_api setMyCommands \
    --data-urlencode 'commands=[{"command":"start","description":"Open TENCORP"},{"command":"help","description":"Sign-in help"}]'

  bot_api setChatMenuButton \
    --data-urlencode "menu_button={\"type\":\"web_app\",\"text\":\"Открыть TENCORP\",\"web_app\":{\"url\":\"${PUBLIC_SITE_URL}\"}}"

  if [[ -n "$TELEGRAM_BOT_PROFILE_PHOTO_FILE" ]]; then
    bot_api setMyProfilePhoto \
      --form-string 'photo={"type":"static","photo":"attach://avatar"}' \
      --form "avatar=@${TELEGRAM_BOT_PROFILE_PHOTO_FILE};type=image/jpeg"
  fi

  # Keep the webhook secret out of argv. curl reads it from a mode-0600 file.
  printf '%s' "$TELEGRAM_AUTH_WEBHOOK_SECRET" > "$TEMP_DIR/webhook-secret"
  bot_api setWebhook \
    --data-urlencode "url=${PUBLIC_SITE_URL}__auth/telegram/bot-webhook" \
    --data-urlencode 'allowed_updates=["message"]' \
    --data-urlencode 'drop_pending_updates=true' \
    --data-urlencode "secret_token@${TEMP_DIR}/webhook-secret"

  printf 'Telegram bot profile configured.\n'
}

[[ "$#" == 1 ]] || usage
case "$1" in
  --check) MODE=check ;;
  --apply) MODE=apply ;;
  --initialize-webhook-secret) MODE=initialize ;;
  *) usage ;;
esac

read_private_env
if [[ "$MODE" == initialize ]]; then
  initialize_webhook_secret
  exit 0
fi
if [[ "$MODE" == check ]]; then
  printf 'Telegram bot profile input is valid.\n'
  exit 0
fi
apply_profile
