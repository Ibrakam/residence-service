#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 0027

readonly SERVICE_ROOT="/var/www/residence-service"
readonly RELEASES_DIR="${SERVICE_ROOT}/root-releases"
readonly CURRENT_LINK="${SERVICE_ROOT}/root-current"
readonly SERVICE_UNIT="residence-root-frontend.service"
readonly SERVICE_USER="residence-frontend"
readonly SERVICE_GROUP="residence-frontend"
readonly NGINX_USER="www-data"
readonly SERVICE_ENV_FILE="/etc/residence-frontend/root-frontend.env"
readonly DEPLOY_LOCK="/run/lock/residence-root-deploy.lock"
readonly REPOSITORY_LOCK="/run/lock/residence-root-remote-worktree.lock"
readonly NODE_BIN="/usr/bin/node"
readonly CANDIDATE_PORT="4399"
readonly PRODUCTION_PORT="4320"
readonly PUBLIC_ORIGIN="https://form.tencorp.uz"
readonly HOST_HEADER="form.tencorp.uz"
readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/residence-service.git"
readonly MIN_FREE_KB=10485760
readonly AUTH_GATE_MODE_FILE="/etc/tencorp-auth-gateway/public-gate-enabled"
readonly AUTH_GATE_MODE_VALUE="tencorp-auth-gate-v1"
readonly AUTH_SMOKE_SESSION_FILE="/etc/tencorp-auth-gateway/deploy-smoke-session"

WORKTREE=""
COMMIT=""
RELEASE_ID=""
FINAL_RELEASE=""
STAGING_RELEASE=""
PREVIOUS_RELEASE=""
CANDIDATE_UNIT=""
CANDIDATE_STARTED=0
CURRENT_SWITCHED=0
DEPLOYMENT_CONFIRMED=0
PUBLIC_AUTH_GATE_ENABLED=0
AUTH_SMOKE_CURL_CONFIG=""
AUTH_SMOKE_IDENTITY_FILE=""
FRAMEWORK_ASSET_PATH=""

declare -a SMOKE_ROUTES=()
readonly -a DIRECT_PROJECTS=(
  4u
  bayterak
  botanika-saroyi
  flagman
  jomiy
  maftun-makon
  meros
  mirador
  ofiyat
  regnum-plaza
  sado
  sun
  voha
  yangibaxt
  zamon
)

log() {
  printf '[deploy-residence-root] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-residence-root.sh WORKTREE COMMIT

WORKTREE must be a root-owned, non-writable-by-group/others Git worktree at
COMMIT. COMMIT must be the full 40-character commit currently at origin/main.
The prebuilt Vinext artifact must exist at website/dist/standalone.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

safe_remove_staging() {
  local path="${1:-}"
  [[ -n "$path" && -d "$path" ]] || return 0
  case "$path" in
    "${RELEASES_DIR}"/.incoming-*)
      rm -rf --one-file-system -- "$path"
      ;;
    *)
      log "Refusing to remove unexpected staging path: $path"
      return 1
      ;;
  esac
}

cleanup_auth_smoke_config() {
  local path="${AUTH_SMOKE_CURL_CONFIG:-}"

  if [[ -n "$path" && -f "$path" && ! -L "$path" ]]; then
    case "$path" in
      /run/tencorp-auth-smoke.*)
        rm -f -- "$path"
        AUTH_SMOKE_CURL_CONFIG=""
        ;;
      *)
        log "Refusing to remove unexpected auth smoke config: $path"
        return 1
        ;;
    esac
  fi

  path="${AUTH_SMOKE_IDENTITY_FILE:-}"
  if [[ -n "$path" && -f "$path" && ! -L "$path" ]]; then
    case "$path" in
      /run/residence-auth-me.*|/run/residence-auth-account.*)
        rm -f -- "$path"
        AUTH_SMOKE_IDENTITY_FILE=""
        ;;
      *)
        log "Refusing to remove unexpected auth identity smoke response: $path"
        return 1
        ;;
    esac
  fi
}

stop_candidate() {
  (( CANDIDATE_STARTED == 1 )) || return 0
  systemctl stop --quiet "$CANDIDATE_UNIT" >/dev/null 2>&1 || true
  systemctl reset-failed "$CANDIDATE_UNIT" >/dev/null 2>&1 || true
  CANDIDATE_STARTED=0
}

atomic_switch() {
  local target="$1"
  local temporary_link="${SERVICE_ROOT}/.root-current.${RELEASE_ID}.$$"

  [[ -d "$target/frontend" ]] || return 1
  case "$target" in
    "${RELEASES_DIR}"/*) ;;
    *) return 1 ;;
  esac

  ln -s -- "$target" "$temporary_link"
  if ! mv -Tf -- "$temporary_link" "$CURRENT_LINK"; then
    rm -f -- "$temporary_link"
    return 1
  fi
}

http_status() {
  local url="$1"
  curl \
    --silent \
    --show-error \
    --output /dev/null \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 12 \
    --header "Host: ${HOST_HEADER}" \
    "$url"
}

status_is_healthy() {
  [[ "$1" =~ ^2[0-9][0-9]$ ]]
}

configure_public_auth_smoke_mode() {
  local owner_uid mode marker_value session_token

  if [[ ! -e "$AUTH_GATE_MODE_FILE" && ! -L "$AUTH_GATE_MODE_FILE" ]]; then
    PUBLIC_AUTH_GATE_ENABLED=0
    log "Public smoke mode: open-site-v1"
    return 0
  fi

  [[ -f "$AUTH_GATE_MODE_FILE" && ! -L "$AUTH_GATE_MODE_FILE" ]] \
    || die "auth gate mode marker must be a regular non-symlink file"
  owner_uid="$(stat -c '%u' -- "$AUTH_GATE_MODE_FILE")"
  mode="$(stat -c '%a' -- "$AUTH_GATE_MODE_FILE")"
  [[ "$owner_uid" == 0 ]] || die "auth gate mode marker must be owned by root"
  (( (8#$mode & 0022) == 0 )) || die "auth gate mode marker must not be writable by group or others"
  marker_value="$(<"$AUTH_GATE_MODE_FILE")"
  [[ "$marker_value" == "$AUTH_GATE_MODE_VALUE" ]] \
    || die "auth gate mode marker has an unsupported value"

  [[ -f "$AUTH_SMOKE_SESSION_FILE" && ! -L "$AUTH_SMOKE_SESSION_FILE" ]] \
    || die "gated public smoke requires a regular non-symlink session fixture"
  owner_uid="$(stat -c '%u' -- "$AUTH_SMOKE_SESSION_FILE")"
  mode="$(stat -c '%a' -- "$AUTH_SMOKE_SESSION_FILE")"
  [[ "$owner_uid" == 0 && "$mode" == 600 ]] \
    || die "auth smoke session fixture must be root-owned mode 0600"
  session_token="$(<"$AUTH_SMOKE_SESSION_FILE")"
  [[ "$session_token" =~ ^[A-Za-z0-9_-]{43}$ ]] \
    || die "auth smoke session fixture has an invalid opaque token"

  AUTH_SMOKE_CURL_CONFIG="$(mktemp /run/tencorp-auth-smoke.XXXXXX)"
  chmod 0600 -- "$AUTH_SMOKE_CURL_CONFIG"
  # curl receives only this root-only filename in argv. The opaque session is
  # never exported, logged, or placed on a command line.
  printf 'noproxy = "*"\ncookie = "__Host-tencorp_session=%s"\n' "$session_token" > "$AUTH_SMOKE_CURL_CONFIG"
  session_token=""
  PUBLIC_AUTH_GATE_ENABLED=1
  log "Public smoke mode: ${AUTH_GATE_MODE_VALUE}"
}

wait_for_http() {
  local origin="$1"
  local route="$2"
  local attempts="${3:-30}"
  local status="000"
  local attempt

  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    status="000"
    if status="$(http_status "${origin}${route}" 2>/dev/null)" && status_is_healthy "$status"; then
      log "HTTP smoke passed: ${origin}${route} (${status})"
      return 0
    fi
    sleep 1
  done

  log "HTTP smoke failed: ${origin}${route} (last status ${status})"
  return 1
}

wait_for_service_release() {
  local expected_frontend="$1"
  local attempts="${2:-30}"
  local attempt main_pid process_cwd

  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    if systemctl is-active --quiet "$SERVICE_UNIT"; then
      main_pid="$(systemctl show "$SERVICE_UNIT" --property=MainPID --value)"
      if [[ "$main_pid" =~ ^[1-9][0-9]*$ && -d "/proc/${main_pid}" ]]; then
        process_cwd="$(readlink -f -- "/proc/${main_pid}/cwd" 2>/dev/null || true)"
        if [[ "$process_cwd" == "$expected_frontend" ]]; then
          log "${SERVICE_UNIT} is running release ${expected_frontend}"
          return 0
        fi
      fi
    fi
    sleep 1
  done

  log "${SERVICE_UNIT} did not start from ${expected_frontend}"
  return 1
}

add_smoke_route() {
  local candidate="$1"
  local existing

  [[ "$candidate" == /* && "$candidate" != *$'\n'* && "$candidate" != *$'\r'* ]] || return 1
  for existing in "${SMOKE_ROUTES[@]:-}"; do
    [[ "$existing" == "$candidate" ]] && return 0
  done
  SMOKE_ROUTES+=("$candidate")
}

verify_origin_main() {
  local origin_url origin_commit

  origin_url="$(git -C "$WORKTREE" remote get-url origin)"
  [[ "$origin_url" == "$EXPECTED_ORIGIN" ]] || die "WORKTREE origin does not match the approved repository"
  GIT_TERMINAL_PROMPT=0 git -C "$WORKTREE" fetch --quiet --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main'
  origin_commit="$(git -C "$WORKTREE" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  [[ "$origin_commit" == "$COMMIT" ]] || die "origin/main (${origin_commit}) does not equal COMMIT (${COMMIT})"
}

deployed_commit() {
  local marker="${PREVIOUS_RELEASE}/DEPLOY_COMMIT"
  local value=""
  local release_name short_candidate resolved=""

  if [[ -r "$marker" ]]; then
    IFS= read -r value < "$marker" || true
    if [[ "$value" =~ ^[0-9a-f]{40}$ ]] && git -C "$WORKTREE" cat-file -e "${value}^{commit}" 2>/dev/null; then
      printf '%s\n' "$value"
      return 0
    fi
  fi

  release_name="$(basename -- "$PREVIOUS_RELEASE")"
  short_candidate="${release_name##*-}"
  if [[ "$short_candidate" =~ ^[0-9a-f]{7,40}$ ]]; then
    resolved="$(git -C "$WORKTREE" rev-parse --verify "${short_candidate}^{commit}" 2>/dev/null || true)"
    if [[ "$resolved" =~ ^[0-9a-f]{40}$ ]]; then
      printf '%s\n' "$resolved"
      return 0
    fi
  fi

  return 1
}

infer_smoke_routes() {
  local base_commit=""
  local parent_commit=""
  local project route

  # Every release must keep every direct project landing and catalog healthy,
  # not only the project inferred from the current diff.
  add_smoke_route "/"

  base_commit="$(deployed_commit || true)"
  if [[ -n "$base_commit" ]] && ! git -C "$WORKTREE" merge-base --is-ancestor "$base_commit" "$COMMIT"; then
    die "currently deployed commit is not an ancestor of ${COMMIT}"
  fi
  if [[ -z "$base_commit" ]]; then
    parent_commit="$(git -C "$WORKTREE" rev-parse --verify "${COMMIT}^" 2>/dev/null || true)"
    base_commit="$parent_commit"
  fi

  for project in "${DIRECT_PROJECTS[@]}"; do
    route="/${project}"
    [[ -f "${WORKTREE}/website/app/${project}/page.tsx" || -f "${WORKTREE}/website/app/${project}/page.jsx" ]] \
      || die "required landing source is missing for ${project}"
    [[ -f "${WORKTREE}/website/app/${project}/apartments/page.tsx" || -f "${WORKTREE}/website/app/${project}/apartments/page.jsx" ]] \
      || die "required apartments source is missing for ${project}"
    add_smoke_route "$route"
    add_smoke_route "${route}/apartments"
  done

  log "Smoke routes: ${SMOKE_ROUTES[*]}"
}

validate_artifact() {
  local artifact="$1"
  local canonical_artifact unsafe_entry writable_entry sensitive_entry link resolved

  canonical_artifact="$(realpath -e -- "$artifact")"
  case "$canonical_artifact" in
    "${WORKTREE}"/*) ;;
    *) die "standalone artifact escapes WORKTREE" ;;
  esac

  [[ -f "$artifact/server.js" ]] || die "standalone server.js is missing"
  [[ -f "$artifact/package.json" ]] || die "standalone package.json is missing"
  [[ -f "$artifact/STANDALONE_RUNTIME.json" ]] || die "STANDALONE_RUNTIME.json is missing; run the complete website build"
  [[ -d "$artifact/dist/client" ]] || die "standalone dist/client directory is missing"
  [[ -d "$artifact/dist/client/residence-assets/_next/static" ]] || \
    die "standalone artifact is missing the production /residence-assets framework tree"

  "$NODE_BIN" -e '
    const fs = require("node:fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.packages)) {
      throw new Error("unsupported standalone runtime manifest");
    }
  ' "$artifact/STANDALONE_RUNTIME.json"

  unsafe_entry="$(find "$artifact" -mindepth 1 ! -type d ! -type f ! -type l -print -quit)"
  [[ -z "$unsafe_entry" ]] || die "artifact contains a non-file/directory/symlink entry: $unsafe_entry"

  writable_entry="$(find "$artifact" -mindepth 1 ! -type l -perm /0022 -print -quit)"
  [[ -z "$writable_entry" ]] || die "artifact contains a group/world-writable entry: $writable_entry"

  sensitive_entry="$(find "$artifact" -type f \( \
    -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o \
    -name '*.p12' -o -name '*.pfx' \
  \) -print -quit)"
  [[ -z "$sensitive_entry" ]] || die "artifact contains a forbidden secret-like file: $sensitive_entry"

  while IFS= read -r -d '' link; do
    resolved="$(realpath -e -- "$link" 2>/dev/null || true)"
    [[ -n "$resolved" ]] || die "artifact contains a dangling symlink: $link"
    case "$resolved" in
      "${canonical_artifact}"/*) ;;
      *) die "artifact symlink escapes standalone root: $link" ;;
    esac
  done < <(find "$artifact" -type l -print0)
}

assert_release_capacity() {
  local artifact="$1"
  local artifact_kb available_kb required_kb

  artifact_kb="$(du -sk -- "$artifact" | awk '{print $1}')"
  available_kb="$(df -Pk -- "$RELEASES_DIR" | awk 'NR == 2 {print $4}')"
  [[ "$artifact_kb" =~ ^[0-9]+$ && "$available_kb" =~ ^[0-9]+$ ]] \
    || die "could not determine artifact size and release filesystem capacity"
  required_kb=$((MIN_FREE_KB + artifact_kb))
  log "Capacity preflight: artifact=${artifact_kb} KiB available=${available_kb} KiB required=${required_kb} KiB"
  (( available_kb >= required_kb )) \
    || die "release filesystem needs artifact size plus a 10 GiB safety reserve"
}

assert_nginx_can_read_artifact() {
  local frontend="$1"
  local representative_asset

  representative_asset="$(find "$frontend/dist/client/residence-assets/_next/static" -type f -print -quit)"
  [[ -n "$representative_asset" ]] || die "could not find a framework asset for nginx permission validation"
  runuser -u "$NGINX_USER" -- /usr/bin/test -x "$frontend" \
    || die "nginx user cannot traverse the release frontend directory"
  runuser -u "$NGINX_USER" -- /usr/bin/test -r "$representative_asset" \
    || die "nginx user cannot read the release framework assets"
  log "Nginx permission preflight passed for ${representative_asset}"
}

start_candidate() {
  local frontend="$1"

  if ss -H -ltn "sport = :${CANDIDATE_PORT}" | grep -q .; then
    die "fixed candidate port ${CANDIDATE_PORT} is already in use"
  fi

  systemd-run \
    --quiet \
    --unit="${CANDIDATE_UNIT%.service}" \
    --service-type=exec \
    --uid="$SERVICE_USER" \
    --gid="$SERVICE_GROUP" \
    --working-directory="$frontend" \
    --property="EnvironmentFile=${SERVICE_ENV_FILE}" \
    --property="Restart=no" \
    --property="TimeoutStartSec=30s" \
    --property="TimeoutStopSec=15s" \
    --property="KillSignal=SIGTERM" \
    --property="UMask=0027" \
    --property="NoNewPrivileges=yes" \
    --property="PrivateTmp=yes" \
    --property="PrivateDevices=yes" \
    --property="ProtectSystem=strict" \
    --property="ProtectHome=yes" \
    --property="ProtectKernelTunables=yes" \
    --property="ProtectKernelModules=yes" \
    --property="ProtectControlGroups=yes" \
    --property="ProtectProc=invisible" \
    --property="ProcSubset=pid" \
    --property="RestrictSUIDSGID=yes" \
    --property="RestrictNamespaces=yes" \
    --property="LockPersonality=yes" \
    --property="InaccessiblePaths=/etc/residence-service" \
    --property="CapabilityBoundingSet=" \
    --property="RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6" \
    --property="SystemCallArchitectures=native" \
    /usr/bin/env \
      NODE_ENV=production \
      HOST=127.0.0.1 \
      PORT="$CANDIDATE_PORT" \
      "$NODE_BIN" "$frontend/server.js"
  CANDIDATE_STARTED=1
}

smoke_routes() {
  local origin="$1"
  local attempts="$2"
  local route

  for route in "${SMOKE_ROUTES[@]}"; do
    wait_for_http "$origin" "$route" "$attempts"
  done
}

smoke_asset_contract() {
  local origin="$1"
  local route="$2"
  local frontend="${3:-}"
  local html_file headers_file asset_path asset_request_path asset_file resolved_frontend resolved_asset status content_type

  html_file="$(mktemp /run/residence-asset-html.XXXXXX)"
  headers_file="$(mktemp /run/residence-asset-headers.XXXXXX)"

  if ! curl \
    --fail \
    --silent \
    --show-error \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    --output "$html_file" \
    "${origin}${route}"; then
    rm -f -- "$html_file" "$headers_file"
    die "could not fetch rendered HTML for framework asset smoke: ${origin}${route}"
  fi

  if grep -Eq '(src|href)="/_next/' "$html_file"; then
    rm -f -- "$html_file" "$headers_file"
    die "rendered HTML contains an unprefixed /_next asset: ${origin}${route}"
  fi
  asset_path="$(grep -Eo '(src|href)="/residence-assets/_next/static/[^"?]+\.(css|js)(\?[^" ]*)?"' "$html_file" \
    | head -n 1 \
    | sed -E 's/^[^=]+="([^"]+)"$/\1/' || true)"
  if [[ "$asset_path" != /residence-assets/_next/static/* ]]; then
    rm -f -- "$html_file" "$headers_file"
    die "rendered HTML has no production-prefixed framework asset: ${origin}${route}"
  fi
  FRAMEWORK_ASSET_PATH="${asset_path%%\?*}"

  # The standalone Node candidate renders the final production-prefixed URLs,
  # but framework assets are intentionally served by Nginx from dist/client.
  # Before the atomic switch, prove that the exact rendered asset exists in
  # the candidate release and is readable by Nginx. The public-origin check
  # below separately proves the live HTTP mapping and content type.
  if [[ -n "$frontend" ]]; then
    [[ -d "$frontend" && ! -L "$frontend" ]] || {
      rm -f -- "$html_file" "$headers_file"
      die "framework asset smoke received an unsafe frontend directory"
    }
    resolved_frontend="$(realpath -e -- "$frontend")"
    asset_request_path="${asset_path%%\?*}"
    asset_file="${resolved_frontend}/dist/client${asset_request_path}"
    [[ -f "$asset_file" ]] || {
      rm -f -- "$html_file" "$headers_file"
      die "rendered framework asset is absent from the candidate release: ${asset_request_path}"
    }
    resolved_asset="$(realpath -e -- "$asset_file")"
    case "$resolved_asset" in
      "${resolved_frontend}"/*) ;;
      *)
        rm -f -- "$html_file" "$headers_file"
        die "rendered framework asset escapes the candidate release"
        ;;
    esac
    runuser -u "$NGINX_USER" -- /usr/bin/test -r "$resolved_asset" || {
      rm -f -- "$html_file" "$headers_file"
      die "rendered framework asset is not readable by Nginx: ${asset_request_path}"
    }
    rm -f -- "$html_file" "$headers_file"
    log "Framework asset file smoke passed: ${asset_request_path}"
    return 0
  fi

  status="$(curl \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    "${origin}${asset_path}")"
  if ! status_is_healthy "$status"; then
    rm -f -- "$html_file" "$headers_file"
    die "framework asset smoke returned ${status}: ${origin}${asset_path}"
  fi
  content_type="$(awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  case "$asset_path:$content_type" in
    *.css:text/css*|*.js:*javascript*) ;;
    *)
      rm -f -- "$html_file" "$headers_file"
      die "framework asset has an unexpected content type (${content_type}): ${origin}${asset_path}"
      ;;
  esac

  rm -f -- "$html_file" "$headers_file"
  log "Framework asset smoke passed: ${origin}${asset_path} (${status}, ${content_type})"
}

smoke_public_login_page() {
  local route="$1"
  local attempts="${2:-5}"
  local attempt status cache_control
  local body_file headers_file

  body_file="$(mktemp /run/residence-auth-page.XXXXXX)"
  headers_file="$(mktemp /run/residence-auth-headers.XXXXXX)"
  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    : > "$body_file"
    : > "$headers_file"
    status="000"
    if status="$(curl \
      --disable \
      --silent \
      --show-error \
      --output "$body_file" \
      --dump-header "$headers_file" \
      --write-out '%{http_code}' \
      --connect-timeout 3 \
      --max-time 15 \
      --header "Host: ${HOST_HEADER}" \
      --header 'Accept: text/html' \
      "${PUBLIC_ORIGIN}${route}" 2>/dev/null)" \
      && [[ "$status" == 200 ]] \
      && grep -Fq 'method="post" action="/__auth/telegram/start"' "$body_file" \
      && grep -Fq "name=\"return_to\" value=\"${route}\"" "$body_file"; then
      cache_control="$(awk 'BEGIN { IGNORECASE=1 } /^Cache-Control:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
      if [[ "$cache_control" == *no-store* ]] \
        && ! grep -Eiq '^Location:' "$headers_file" \
        && ! grep -Eiq '^Set-Cookie:[[:space:]]*__Host-tencorp_session=' "$headers_file"; then
        rm -f -- "$body_file" "$headers_file"
        log "Public auth wall smoke passed: ${route} (${status})"
        return 0
      fi
    fi
    sleep 1
  done

  rm -f -- "$body_file" "$headers_file"
  die "public auth wall smoke failed: ${PUBLIC_ORIGIN}${route} (last status ${status})"
}

smoke_public_unauthorized_resource() {
  local path="$1"
  local accept="$2"
  local method="${3:-GET}"
  local status cache_control
  local body_file headers_file
  local -a method_args=()

  case "$method" in
    GET) method_args=(--request GET) ;;
    POST) method_args=(--request POST --data '') ;;
    *) die "unsupported public unauthorized smoke method: ${method}" ;;
  esac

  body_file="$(mktemp /run/residence-auth-resource.XXXXXX)"
  headers_file="$(mktemp /run/residence-auth-resource-headers.XXXXXX)"
  status="$(curl \
    --disable \
    --silent \
    --show-error \
    --output "$body_file" \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    "${method_args[@]}" \
    --header "Host: ${HOST_HEADER}" \
    --header "Accept: ${accept}" \
    "${PUBLIC_ORIGIN}${path}")" || {
      rm -f -- "$body_file" "$headers_file"
      die "could not query protected public resource: ${path}"
    }
  cache_control="$(awk 'BEGIN { IGNORECASE=1 } /^Cache-Control:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  if [[ "$status" != 401 ]] \
    || [[ "$cache_control" != *no-store* ]] \
    || grep -Eiq '^Location:' "$headers_file" \
    || ! grep -Fq '"error":"authentication_required"' "$body_file"; then
    rm -f -- "$body_file" "$headers_file"
    die "protected public resource did not return the non-cacheable 401 contract: ${path} (${status})"
  fi
  rm -f -- "$body_file" "$headers_file"
  log "Public unauthorized resource smoke passed: ${method} ${path} (${status})"
}

smoke_public_exact_status() {
  local path="$1"
  local expected="$2"
  local accept="${3:-*/*}"
  local headers_file="${4:-}"
  local status
  local -a output_args=(--output /dev/null)

  if [[ -n "$headers_file" ]]; then
    output_args+=(--dump-header "$headers_file")
  fi
  status="$(curl \
    --disable \
    --silent \
    --show-error \
    "${output_args[@]}" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    --header "Accept: ${accept}" \
    "${PUBLIC_ORIGIN}${path}")" \
    || die "could not query public contract path: ${path}"
  [[ " ${expected} " == *" ${status} "* ]] \
    || die "unexpected public status for ${path}: expected one of [${expected}], got ${status}"
}

smoke_public_immutable_auth_asset() {
  local path="$1"
  local expected_content_type="$2"
  local headers_file status content_type cache_control hsts

  headers_file="$(mktemp /run/residence-auth-asset-headers.XXXXXX)"
  status="$(curl \
    --disable \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    "${PUBLIC_ORIGIN}${path}")" || {
      rm -f -- "$headers_file"
      die "could not query public authorization asset: ${path}"
    }
  content_type="$(awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  cache_control="$(awk 'BEGIN { IGNORECASE=1 } /^Cache-Control:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  hsts="$(awk 'BEGIN { IGNORECASE=1 } /^Strict-Transport-Security:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  rm -f -- "$headers_file"
  if [[ "$status" != 200 ]] \
    || [[ "$content_type" != "$expected_content_type"* ]] \
    || [[ "$cache_control" != *public* || "$cache_control" != *max-age=31536000* || "$cache_control" != *immutable* ]] \
    || [[ "$cache_control" == *no-store* || "$cache_control" == *private* ]] \
    || [[ "$hsts" != *max-age=31536000* ]]; then
    die "authorization asset contract failed: ${path} (${status}, ${content_type}, ${cache_control})"
  fi
}

smoke_public_unauthenticated_contract() {
  local route status body_file headers_file ticket_headers_file

  [[ -n "$FRAMEWORK_ASSET_PATH" ]] \
    || die "framework asset path was not captured before public auth smoke"
  for route in "${SMOKE_ROUTES[@]}"; do
    smoke_public_login_page "$route" 5
  done
  for route in /sanat/ /sanat/flats /avalon/ /tencorp/ /tencrop/; do
    smoke_public_login_page "$route" 5
  done

  smoke_public_immutable_auth_asset '/__auth/assets/brand-city-v1.webp' 'image/webp'
  smoke_public_immutable_auth_asset '/__auth/assets/manrope-cyrillic-v1.woff2' 'font/woff2'
  smoke_public_immutable_auth_asset '/__auth/assets/cormorant-cyrillic-v1.woff2' 'font/woff2'
  smoke_public_immutable_auth_asset '/__auth/assets/cormorant-italic-cyrillic-v1.woff2' 'font/woff2'

  smoke_public_unauthorized_resource "$FRAMEWORK_ASSET_PATH" 'text/css,*/*;q=0.1'
  # POSTing an empty body to a static framework asset cannot create a lead or
  # invoke a business webhook, but proves non-GET failures stay a plain 401.
  smoke_public_unauthorized_resource "$FRAMEWORK_ASSET_PATH" 'application/json' POST
  smoke_public_unauthorized_resource '/residence-api/catalog/' 'application/json'
  smoke_public_unauthorized_resource '/api/kayan/ofiyat-explorer' 'application/json'

  smoke_public_exact_status '/__tencorp-auth/check' 404
  smoke_public_exact_status '/privacy' 200 'text/html'
  smoke_public_exact_status '/sitemap.xml' 404 'application/xml'
  # These read-only probes distinguish the two external integration
  # exemptions from the browser gate without sending a webhook secret,
  # request body, or a real ACME challenge.
  smoke_public_exact_status '/api/amo-webhook' 405 'application/json'
  smoke_public_exact_status '/.well-known/acme-challenge/tencorp-auth-smoke-missing' 404 'text/plain'
  ticket_headers_file="$(mktemp /run/residence-auth-ticket-headers.XXXXXX)"
  : > "$ticket_headers_file"
  smoke_public_exact_status \
    '/__residence-ticket-worker/internal/ticket-runner/health' \
    401 \
    'application/json' \
    "$ticket_headers_file"
  if ! grep -Eiq '^WWW-Authenticate:[[:space:]]*Bearer[[:space:]]+realm="ticket-runner"([,[:space:]]|$)' "$ticket_headers_file"; then
    rm -f -- "$ticket_headers_file"
    die "ticket-worker Bearer authentication contract was weakened"
  fi
  rm -f -- "$ticket_headers_file"
  # Disabled webhook: 404. Enabled POST-only webhook: GET receives 405. Both
  # prove the auth prefix is public without sending an update or secret.
  smoke_public_exact_status '/__auth/telegram/bot-webhook' '404 405' 'application/json'

  body_file="$(mktemp /run/residence-auth-robots.XXXXXX)"
  status="$(curl \
    --disable \
    --silent \
    --show-error \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    "${PUBLIC_ORIGIN}/robots.txt")" || {
      rm -f -- "$body_file"
      die "could not query public robots policy"
    }
  if [[ "$status" != 200 ]] \
    || ! grep -Fqx 'User-agent: *' "$body_file" \
    || ! grep -Fqx 'Disallow: /' "$body_file"; then
    rm -f -- "$body_file"
    die "public robots policy does not close indexing"
  fi
  rm -f -- "$body_file"

  headers_file="$(mktemp /run/residence-auth-operator-headers.XXXXXX)"
  : > "$headers_file"
  smoke_public_exact_status '/market-map/' 401 'text/html' "$headers_file"
  if ! grep -Eiq '^WWW-Authenticate:[[:space:]]*Basic[[:space:]]+realm="TENCORP Market Map"' "$headers_file"; then
    rm -f -- "$headers_file"
    die "market-map Basic authentication contract was weakened"
  fi
  rm -f -- "$headers_file"

  headers_file="$(mktemp /run/residence-auth-analytics-headers.XXXXXX)"
  : > "$headers_file"
  smoke_public_exact_status '/analytics' 401 'text/html' "$headers_file"
  if ! grep -Eiq '^WWW-Authenticate:[[:space:]]*Basic[[:space:]]+realm="TenCorp Analytics"([,[:space:]]|$)' "$headers_file" \
    || ! grep -Eiq '^Cache-Control:.*no-store' "$headers_file"; then
    rm -f -- "$headers_file"
    die "analytics Basic authentication contract was weakened"
  fi
  rm -f -- "$headers_file"
  log "Public unauthenticated auth-gate contract passed"
}

smoke_public_authenticated_contract() {
  local route status content_type
  local body_file headers_file

  [[ -n "$AUTH_SMOKE_CURL_CONFIG" && -f "$AUTH_SMOKE_CURL_CONFIG" ]] \
    || die "authenticated public smoke has no protected curl config"
  [[ -n "$FRAMEWORK_ASSET_PATH" ]] \
    || die "framework asset path was not captured before authenticated public smoke"

  for route in "${SMOKE_ROUTES[@]}"; do
    status="$(curl \
      --disable \
      --config "$AUTH_SMOKE_CURL_CONFIG" \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --connect-timeout 3 \
      --max-time 15 \
      --header "Host: ${HOST_HEADER}" \
      --header 'Accept: text/html' \
      "${PUBLIC_ORIGIN}${route}")" \
      || die "authenticated public page request failed: ${route}"
    status_is_healthy "$status" \
      || die "authenticated public page did not return 2xx: ${route} (${status})"
  done

  for route in /sanat/ /sanat/flats /avalon/ /tencorp/ /tencrop/; do
    status="$(curl \
      --disable \
      --config "$AUTH_SMOKE_CURL_CONFIG" \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --connect-timeout 3 \
      --max-time 15 \
      --header "Host: ${HOST_HEADER}" \
      --header 'Accept: text/html' \
      "${PUBLIC_ORIGIN}${route}")" \
      || die "authenticated public page request failed: ${route}"
    status_is_healthy "$status" \
      || die "authenticated public page did not return 2xx: ${route} (${status})"
  done

  headers_file="$(mktemp /run/residence-auth-authenticated-headers.XXXXXX)"
  status="$(curl \
    --disable \
    --config "$AUTH_SMOKE_CURL_CONFIG" \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    "${PUBLIC_ORIGIN}${FRAMEWORK_ASSET_PATH}")" || {
      rm -f -- "$headers_file"
      die "authenticated public framework asset request failed"
    }
  content_type="$(awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  rm -f -- "$headers_file"
  status_is_healthy "$status" \
    || die "authenticated public framework asset did not return 2xx (${status})"
  case "$FRAMEWORK_ASSET_PATH:$content_type" in
    *.css:text/css*|*.js:*javascript*) ;;
    *) die "authenticated public framework asset has unexpected content type: ${content_type}" ;;
  esac

  headers_file="$(mktemp /run/residence-auth-catalog-headers.XXXXXX)"
  status="$(curl \
    --disable \
    --config "$AUTH_SMOKE_CURL_CONFIG" \
    --silent \
    --show-error \
    --output /dev/null \
    --dump-header "$headers_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    --header 'Accept: application/json' \
    "${PUBLIC_ORIGIN}/residence-api/catalog/")" || {
      rm -f -- "$headers_file"
      die "authenticated public catalog request failed"
    }
  content_type="$(awk 'BEGIN { IGNORECASE=1 } /^Content-Type:/ { value=$0 } END { sub(/^[^:]+:[[:space:]]*/, "", value); sub(/\r$/, "", value); print tolower(value) }' "$headers_file")"
  rm -f -- "$headers_file"
  status_is_healthy "$status" && [[ "$content_type" == application/json* ]] \
    || die "authenticated public catalog contract failed (${status}, ${content_type})"

  body_file="$(mktemp /run/residence-auth-me.XXXXXX)"
  AUTH_SMOKE_IDENTITY_FILE="$body_file"
  status="$(curl \
    --disable \
    --config "$AUTH_SMOKE_CURL_CONFIG" \
    --silent \
    --show-error \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    --header 'Accept: application/json' \
    "${PUBLIC_ORIGIN}/__auth/me")" || {
      rm -f -- "$body_file"
      die "authenticated identity smoke request failed"
    }
  if [[ "$status" != 200 ]] \
    || ! grep -Eq '"telegramId"[[:space:]]*:[[:space:]]*[1-9][0-9]*' "$body_file" \
    || ! grep -Eq '"phoneNumberVerified"[[:space:]]*:[[:space:]]*true' "$body_file" \
    || grep -Eq '"(id|phoneNumber|pictureUrl)"[[:space:]]*:' "$body_file"; then
    rm -f -- "$body_file"
    die "authenticated identity smoke lacks a Telegram id/verified-phone status or exposes unnecessary PII"
  fi
  rm -f -- "$body_file"
  AUTH_SMOKE_IDENTITY_FILE=""

  body_file="$(mktemp /run/residence-auth-account.XXXXXX)"
  AUTH_SMOKE_IDENTITY_FILE="$body_file"
  status="$(curl \
    --disable \
    --config "$AUTH_SMOKE_CURL_CONFIG" \
    --silent \
    --show-error \
    --output "$body_file" \
    --write-out '%{http_code}' \
    --connect-timeout 3 \
    --max-time 15 \
    --header "Host: ${HOST_HEADER}" \
    --header 'Accept: text/html' \
    "${PUBLIC_ORIGIN}/__auth/account")" || {
      rm -f -- "$body_file"
      die "authenticated account-page smoke request failed"
    }
  if [[ "$status" != 200 ]] \
    || ! grep -Fq 'action="/__auth/logout"' "$body_file" \
    || ! grep -Fq 'action="/__auth/logout-all"' "$body_file"; then
    rm -f -- "$body_file"
    die "authenticated account page lacks the sign-out controls"
  fi
  rm -f -- "$body_file"
  AUTH_SMOKE_IDENTITY_FILE=""
  log "Public authenticated auth-gate contract passed"
}

rollback_current() {
  log "Rolling back root-current to ${PREVIOUS_RELEASE}"
  if ! atomic_switch "$PREVIOUS_RELEASE"; then
    log "CRITICAL: atomic rollback switch failed"
    return 1
  fi
  if ! systemctl restart "$SERVICE_UNIT"; then
    log "CRITICAL: ${SERVICE_UNIT} could not restart after rollback"
    return 1
  fi
  if ! wait_for_service_release "${PREVIOUS_RELEASE}/frontend" 30; then
    log "CRITICAL: rolled-back service did not start from the previous release"
    return 1
  fi
  if ! wait_for_http "http://127.0.0.1:${PRODUCTION_PORT}" "${SMOKE_ROUTES[0]}" 30; then
    log "CRITICAL: rolled-back service failed its local smoke check"
    return 1
  fi
  log "Rollback completed"
}

on_exit() {
  local status=$?
  local rollback_status=0

  trap - EXIT INT TERM
  set +e
  stop_candidate
  safe_remove_staging "$STAGING_RELEASE"
  cleanup_auth_smoke_config

  if (( status != 0 && CURRENT_SWITCHED == 1 && DEPLOYMENT_CONFIRMED == 0 )); then
    rollback_current
    rollback_status=$?
    if (( rollback_status != 0 )); then
      log "CRITICAL: automatic rollback was incomplete; operator intervention is required"
    fi
  fi

  exit "$status"
}

main() {
  local supplied_worktree artifact top_level owner_uid mode head_commit
  local timestamp short_commit current_target bad_owner

  if (( $# != 2 )); then
    usage
    exit 64
  fi
  (( EUID == 0 )) || die "this deployment script must run as root"

  supplied_worktree="$1"
  [[ "$2" =~ ^[0-9a-fA-F]{40}$ ]] || die "COMMIT must contain exactly 40 hexadecimal characters"
  COMMIT="${2,,}"

  for command in awk basename chmod chown curl date df du find flock getent git grep head id install ln mktemp mv readlink realpath rm rsync runuser sed sleep ss stat sync systemctl systemd-run; do
    require_command "$command"
  done
  [[ -x "$NODE_BIN" ]] || die "Node runtime is unavailable at ${NODE_BIN}"
  [[ -r "$SERVICE_ENV_FILE" ]] || die "service environment file is missing: ${SERVICE_ENV_FILE}"
  id "$SERVICE_USER" >/dev/null 2>&1 || die "service user does not exist: ${SERVICE_USER}"
  id "$NGINX_USER" >/dev/null 2>&1 || die "nginx user does not exist: ${NGINX_USER}"
  getent group "$SERVICE_GROUP" >/dev/null 2>&1 || die "service group does not exist: ${SERVICE_GROUP}"

  # This explicit root-owned marker selects the public contract before any
  # release is created or switched. A malformed marker/session fails closed.
  configure_public_auth_smoke_mode

  exec 9>"$DEPLOY_LOCK"
  flock -n 9 || die "another residence root deployment holds ${DEPLOY_LOCK}"
  exec 8>"$REPOSITORY_LOCK"
  flock -w 120 8 || die "timed out waiting for ${REPOSITORY_LOCK}"

  WORKTREE="$(realpath -e -- "$supplied_worktree")"
  [[ -d "$WORKTREE" ]] || die "WORKTREE is not a directory"
  owner_uid="$(stat -c '%u' "$WORKTREE")"
  mode="$(stat -c '%a' "$WORKTREE")"
  [[ "$owner_uid" == "0" ]] || die "WORKTREE must be owned by root"
  (( (8#$mode & 0022) == 0 )) || die "WORKTREE must not be writable by group or others"

  top_level="$(git -C "$WORKTREE" rev-parse --show-toplevel)"
  [[ "$(realpath -e -- "$top_level")" == "$WORKTREE" ]] || die "WORKTREE must be the top level of the Git worktree"
  git -C "$WORKTREE" cat-file -e "${COMMIT}^{commit}" 2>/dev/null || die "COMMIT is not present in WORKTREE"
  head_commit="$(git -C "$WORKTREE" rev-parse --verify 'HEAD^{commit}')"
  [[ "$head_commit" == "$COMMIT" ]] || die "WORKTREE HEAD does not equal COMMIT"
  git -C "$WORKTREE" diff --quiet -- || die "WORKTREE has unstaged tracked changes"
  git -C "$WORKTREE" diff --cached --quiet -- || die "WORKTREE has staged changes"

  log "Refreshing origin/main for provenance validation"
  verify_origin_main

  [[ -L "$CURRENT_LINK" ]] || die "current release pointer is not a symlink: ${CURRENT_LINK}"
  current_target="$(readlink -f -- "$CURRENT_LINK")"
  case "$current_target" in
    "${RELEASES_DIR}"/*) ;;
    *) die "current release points outside ${RELEASES_DIR}" ;;
  esac
  [[ -f "$current_target/frontend/server.js" ]] || die "current release is incomplete: ${current_target}"
  PREVIOUS_RELEASE="$current_target"

  artifact="${WORKTREE}/website/dist/standalone"
  validate_artifact "$artifact"
  infer_smoke_routes
  assert_release_capacity "$artifact"

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  short_commit="${COMMIT:0:7}"
  RELEASE_ID="${timestamp}-${short_commit}"
  FINAL_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"
  STAGING_RELEASE="${RELEASES_DIR}/.incoming-${RELEASE_ID}-$$"
  CANDIDATE_UNIT="residence-root-candidate-${timestamp}-${short_commit}.service"

  [[ ! -e "$FINAL_RELEASE" && ! -L "$FINAL_RELEASE" ]] || die "release already exists: ${FINAL_RELEASE}"
  [[ ! -e "$STAGING_RELEASE" && ! -L "$STAGING_RELEASE" ]] || die "staging path already exists: ${STAGING_RELEASE}"

  install -d -o root -g root -m 0755 "$RELEASES_DIR" "$STAGING_RELEASE"
  install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0755 "$STAGING_RELEASE/frontend"

  log "Copying prebuilt standalone artifact into ${RELEASE_ID}"
  rsync \
    --archive \
    --delete \
    --delay-updates \
    --safe-links \
    --chown="${SERVICE_USER}:${SERVICE_GROUP}" \
    --link-dest="${CURRENT_LINK}/frontend" \
    -- "$artifact/" "$STAGING_RELEASE/frontend/"

  # The upload spool is deliberately private. Normalize the copied public
  # application tree after rsync so nginx can traverse/read it without making
  # any release content writable.
  find "$STAGING_RELEASE/frontend" -type d -exec chmod 0555 -- {} +
  find "$STAGING_RELEASE/frontend" -type f -exec chmod 0444 -- {} +
  chmod 0755 "$STAGING_RELEASE/frontend"

  bad_owner="$(find "$STAGING_RELEASE/frontend" \( ! -user "$SERVICE_USER" -o ! -group "$SERVICE_GROUP" \) -print -quit)"
  [[ -z "$bad_owner" ]] || die "rsync produced an entry with unexpected ownership: $bad_owner"
  assert_nginx_can_read_artifact "$STAGING_RELEASE/frontend"
  printf '%s\n' "$COMMIT" > "$STAGING_RELEASE/DEPLOY_COMMIT"
  printf '%s\n' "$RELEASE_ID" > "$STAGING_RELEASE/DEPLOY_RELEASE"
  chown root:root "$STAGING_RELEASE/DEPLOY_COMMIT" "$STAGING_RELEASE/DEPLOY_RELEASE"
  chmod 0444 "$STAGING_RELEASE/DEPLOY_COMMIT" "$STAGING_RELEASE/DEPLOY_RELEASE"

  mv -T -- "$STAGING_RELEASE" "$FINAL_RELEASE"
  STAGING_RELEASE=""

  log "Starting isolated candidate on 127.0.0.1:${CANDIDATE_PORT}"
  start_candidate "$FINAL_RELEASE/frontend"
  smoke_routes "http://127.0.0.1:${CANDIDATE_PORT}" 30
  smoke_asset_contract "http://127.0.0.1:${CANDIDATE_PORT}" "/4u/apartments" "$FINAL_RELEASE/frontend"
  stop_candidate

  log "Rechecking origin/main immediately before the production switch"
  verify_origin_main
  log "Switching root-current atomically to ${FINAL_RELEASE}"
  atomic_switch "$FINAL_RELEASE"
  CURRENT_SWITCHED=1
  systemctl restart "$SERVICE_UNIT"
  wait_for_service_release "$FINAL_RELEASE/frontend" 30
  smoke_routes "http://127.0.0.1:${PRODUCTION_PORT}" 30
  smoke_asset_contract "http://127.0.0.1:${PRODUCTION_PORT}" "/4u/apartments" "$FINAL_RELEASE/frontend"
  if (( PUBLIC_AUTH_GATE_ENABLED == 1 )); then
    smoke_public_unauthenticated_contract
    smoke_public_authenticated_contract
  else
    smoke_routes "$PUBLIC_ORIGIN" 5
    smoke_asset_contract "$PUBLIC_ORIGIN" "/4u/apartments"
  fi

  # DEPLOY_COMMIT identifies release content, while DEPLOY_CONFIRMED is the
  # durable publication authority. Never create it until every post-switch and
  # public smoke has passed.
  printf '%s\n' "$COMMIT" > "$FINAL_RELEASE/.DEPLOY_CONFIRMED.$$"
  chown root:root "$FINAL_RELEASE/.DEPLOY_CONFIRMED.$$"
  chmod 0444 "$FINAL_RELEASE/.DEPLOY_CONFIRMED.$$"
  sync -f "$FINAL_RELEASE/.DEPLOY_CONFIRMED.$$"
  mv -T -- "$FINAL_RELEASE/.DEPLOY_CONFIRMED.$$" "$FINAL_RELEASE/DEPLOY_CONFIRMED"
  sync -f "$FINAL_RELEASE"
  DEPLOYMENT_CONFIRMED=1
  log "Deployment completed: commit=${COMMIT} release=${FINAL_RELEASE}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  main "$@"
fi
