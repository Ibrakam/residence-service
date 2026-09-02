#!/usr/bin/env bash

set -Eeuo pipefail
umask 0027

readonly SERVICE_ROOT="/var/www/residence-service"
readonly RELEASES_DIR="${SERVICE_ROOT}/root-releases"
readonly CURRENT_LINK="${SERVICE_ROOT}/root-current"
readonly SERVICE_UNIT="residence-root-frontend.service"
readonly SERVICE_USER="residence-frontend"
readonly SERVICE_GROUP="residence-frontend"
readonly SERVICE_ENV_FILE="/etc/residence-frontend/root-frontend.env"
readonly DEPLOY_LOCK="/run/lock/residence-root-deploy.lock"
readonly REPOSITORY_LOCK="/run/lock/residence-root-remote-worktree.lock"
readonly NODE_BIN="/usr/bin/node"
readonly CANDIDATE_PORT="4399"
readonly PRODUCTION_PORT="4320"
readonly PUBLIC_ORIGIN="https://form.tencorp.uz"
readonly HOST_HEADER="form.tencorp.uz"

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

declare -a SMOKE_ROUTES=()

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
  local changed_files=""
  local project route
  local -a projects=(
    4u
    bayterak
    botanika-saroyi
    flagman
    jomiy
    kayan
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

  # Always exercise one catalog and one distinct landing route. Project routes
  # inferred from the deployed diff are appended below.
  add_smoke_route "/4u/apartments"
  add_smoke_route "/sun"

  base_commit="$(deployed_commit || true)"
  if [[ -n "$base_commit" ]] && ! git -C "$WORKTREE" merge-base --is-ancestor "$base_commit" "$COMMIT"; then
    die "currently deployed commit is not an ancestor of ${COMMIT}"
  fi
  if [[ -z "$base_commit" ]]; then
    parent_commit="$(git -C "$WORKTREE" rev-parse --verify "${COMMIT}^" 2>/dev/null || true)"
    base_commit="$parent_commit"
  fi

  if [[ -n "$base_commit" ]]; then
    changed_files="$(git -C "$WORKTREE" diff --name-only "$base_commit" "$COMMIT" -- website)"
  else
    changed_files="$(git -C "$WORKTREE" diff-tree --root --no-commit-id --name-only -r "$COMMIT" -- website)"
  fi

  for project in "${projects[@]}"; do
    if ! grep -Eq "(^|/)${project}(/|[-.])" <<< "$changed_files"; then
      continue
    fi

    if [[ "$project" == "kayan" ]]; then
      # The production Nginx contract intentionally rejects /kayan and the
      # current /kayan/ application response redirects there. Keep the global
      # canaries rather than accepting that dead redirect as a healthy smoke.
      continue
    fi

    route="/${project}"
    if [[ -f "${WORKTREE}/website/app/${project}/page.tsx" || -f "${WORKTREE}/website/app/${project}/page.jsx" ]]; then
      add_smoke_route "$route"
    fi
    if [[ -f "${WORKTREE}/website/app/${project}/apartments/page.tsx" || -f "${WORKTREE}/website/app/${project}/apartments/page.jsx" ]]; then
      add_smoke_route "${route}/apartments"
    fi
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

  writable_entry="$(find "$artifact" -mindepth 1 -perm /0022 -print -quit)"
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
  local html_file headers_file asset_path status content_type

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
  local supplied_worktree artifact top_level owner_uid mode origin_commit head_commit
  local timestamp short_commit current_target bad_owner

  if (( $# != 2 )); then
    usage
    exit 64
  fi
  (( EUID == 0 )) || die "this deployment script must run as root"

  supplied_worktree="$1"
  [[ "$2" =~ ^[0-9a-fA-F]{40}$ ]] || die "COMMIT must contain exactly 40 hexadecimal characters"
  COMMIT="${2,,}"

  for command in awk basename chmod chown curl date find flock getent git grep head id install ln mktemp mv readlink realpath rm rsync sed sleep ss stat systemctl systemd-run; do
    require_command "$command"
  done
  [[ -x "$NODE_BIN" ]] || die "Node runtime is unavailable at ${NODE_BIN}"
  [[ -r "$SERVICE_ENV_FILE" ]] || die "service environment file is missing: ${SERVICE_ENV_FILE}"
  id "$SERVICE_USER" >/dev/null 2>&1 || die "service user does not exist: ${SERVICE_USER}"
  getent group "$SERVICE_GROUP" >/dev/null 2>&1 || die "service group does not exist: ${SERVICE_GROUP}"

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
  GIT_TERMINAL_PROMPT=0 git -C "$WORKTREE" fetch --quiet --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main'
  origin_commit="$(git -C "$WORKTREE" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  [[ "$origin_commit" == "$COMMIT" ]] || die "origin/main (${origin_commit}) does not equal COMMIT (${COMMIT})"

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

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  short_commit="${COMMIT:0:7}"
  RELEASE_ID="${timestamp}-${short_commit}"
  FINAL_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"
  STAGING_RELEASE="${RELEASES_DIR}/.incoming-${RELEASE_ID}-$$"
  CANDIDATE_UNIT="residence-root-candidate-${timestamp}-${short_commit}.service"

  [[ ! -e "$FINAL_RELEASE" && ! -L "$FINAL_RELEASE" ]] || die "release already exists: ${FINAL_RELEASE}"
  [[ ! -e "$STAGING_RELEASE" && ! -L "$STAGING_RELEASE" ]] || die "staging path already exists: ${STAGING_RELEASE}"

  install -d -o root -g root -m 0755 "$RELEASES_DIR" "$STAGING_RELEASE"
  install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 0750 "$STAGING_RELEASE/frontend"

  log "Copying prebuilt standalone artifact into ${RELEASE_ID}"
  rsync \
    --archive \
    --delete \
    --delay-updates \
    --safe-links \
    --chown="${SERVICE_USER}:${SERVICE_GROUP}" \
    --link-dest="${CURRENT_LINK}/frontend" \
    -- "$artifact/" "$STAGING_RELEASE/frontend/"

  bad_owner="$(find "$STAGING_RELEASE/frontend" \( ! -user "$SERVICE_USER" -o ! -group "$SERVICE_GROUP" \) -print -quit)"
  [[ -z "$bad_owner" ]] || die "rsync produced an entry with unexpected ownership: $bad_owner"
  printf '%s\n' "$COMMIT" > "$STAGING_RELEASE/DEPLOY_COMMIT"
  printf '%s\n' "$RELEASE_ID" > "$STAGING_RELEASE/DEPLOY_RELEASE"
  chown root:root "$STAGING_RELEASE/DEPLOY_COMMIT" "$STAGING_RELEASE/DEPLOY_RELEASE"
  chmod 0444 "$STAGING_RELEASE/DEPLOY_COMMIT" "$STAGING_RELEASE/DEPLOY_RELEASE"

  mv -T -- "$STAGING_RELEASE" "$FINAL_RELEASE"
  STAGING_RELEASE=""

  log "Starting isolated candidate on 127.0.0.1:${CANDIDATE_PORT}"
  start_candidate "$FINAL_RELEASE/frontend"
  smoke_routes "http://127.0.0.1:${CANDIDATE_PORT}" 30
  smoke_asset_contract "http://127.0.0.1:${CANDIDATE_PORT}" "/4u/apartments"
  stop_candidate

  log "Switching root-current atomically to ${FINAL_RELEASE}"
  atomic_switch "$FINAL_RELEASE"
  CURRENT_SWITCHED=1
  systemctl restart "$SERVICE_UNIT"
  wait_for_service_release "$FINAL_RELEASE/frontend" 30
  smoke_routes "http://127.0.0.1:${PRODUCTION_PORT}" 30
  smoke_asset_contract "http://127.0.0.1:${PRODUCTION_PORT}" "/4u/apartments"
  smoke_routes "$PUBLIC_ORIGIN" 5
  smoke_asset_contract "$PUBLIC_ORIGIN" "/4u/apartments"

  DEPLOYMENT_CONFIRMED=1
  log "Deployment completed: commit=${COMMIT} release=${FINAL_RELEASE}"
}

trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

main "$@"
