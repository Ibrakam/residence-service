#!/usr/bin/env bash

set -Eeuo pipefail
set +x
umask 0027

export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS

readonly SERVICE_ROOT="/var/www/tencorp-market-map"
readonly RELEASES_DIR="${SERVICE_ROOT}/releases"
readonly CURRENT_LINK="${SERVICE_ROOT}/current"
readonly STATE_DIR="/var/lib/tencorp-market-map"
readonly LIVE_DB="${STATE_DIR}/market_map.db"
readonly SERVICE_UNIT="tencorp-market-map.service"
readonly SERVICE_USER="www-data"
readonly SERVICE_GROUP="www-data"
readonly UPLOAD_ROOT="/srv/tencorp-market-map-deploy/uploads"
readonly DEPLOY_LOCK="/run/lock/tencorp-market-map-deploy.lock"
readonly PYTHON_BIN="/usr/bin/python3"
readonly CURL_BIN="/usr/bin/curl"
readonly LOOPBACK_ORIGIN="http://127.0.0.1:8765"
readonly MIN_FREE_KB=1048576
readonly COMMIT_RE='^[0-9a-f]{40}$'
readonly UPLOAD_NAME_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}-(manual|[0-9]{1,18})-[0-9]{1,10}$'

UPLOAD=""
ARTIFACT=""
COMMIT=""
RELEASE_ID=""
STAGING_RELEASE=""
FINAL_RELEASE=""
PREVIOUS_RELEASE=""
PROBE_DIR=""
CURRENT_SWITCHED=0
DEPLOYMENT_CONFIRMED=0

log() {
  printf '[deploy-tencorp-market-map] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-tencorp-market-map.sh UPLOAD COMMIT

UPLOAD must be the root-owned direct child prepared by the market-map forced
command gate. Its artifact directory contains only the approved application
files. The live database under /var/lib/tencorp-market-map is never copied,
replaced, or removed by this deployer.
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
      /usr/bin/rm -rf --one-file-system -- "$path"
      ;;
    *)
      log "Refusing to remove unexpected staging path: ${path}"
      return 1
      ;;
  esac
}

safe_remove_probe() {
  local path="${1:-}"

  [[ -n "$path" && -d "$path" ]] || return 0
  case "$path" in
    /run/tencorp-market-map-probe.*)
      /usr/bin/rm -rf --one-file-system -- "$path"
      PROBE_DIR=""
      ;;
    *)
      log "Refusing to remove unexpected probe path: ${path}"
      return 1
      ;;
  esac
}

atomic_switch() {
  local target="$1"
  local temporary_link="${SERVICE_ROOT}/.current.${RELEASE_ID}.$$"

  [[ -d "$target" && ! -L "$target" ]] || return 1
  case "$target" in
    "${RELEASES_DIR}"/*) ;;
    *) return 1 ;;
  esac
  [[ "$(dirname -- "$target")" == "$RELEASES_DIR" ]] || return 1

  /usr/bin/ln -s -- "$target" "$temporary_link"
  if ! /usr/bin/mv -Tf -- "$temporary_link" "$CURRENT_LINK"; then
    /usr/bin/rm -f -- "$temporary_link"
    return 1
  fi
}

wait_for_service_release() {
  local expected_release="$1"
  local attempts="${2:-30}"
  local attempt main_pid process_cwd

  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    if /usr/bin/systemctl is-active --quiet "$SERVICE_UNIT"; then
      main_pid="$(/usr/bin/systemctl show "$SERVICE_UNIT" --property=MainPID --value 2>/dev/null || true)"
      if [[ "$main_pid" =~ ^[1-9][0-9]*$ && -d "/proc/${main_pid}" ]]; then
        process_cwd="$(/usr/bin/readlink -f -- "/proc/${main_pid}/cwd" 2>/dev/null || true)"
        if [[ "$process_cwd" == "$expected_release" ]]; then
          log "${SERVICE_UNIT} is running release ${expected_release}"
          return 0
        fi
      fi
    fi
    /usr/bin/sleep 1
  done

  log "${SERVICE_UNIT} did not start from ${expected_release}"
  return 1
}

smoke_endpoints_once() {
  local smoke_dir health_file meta_file points_file root_file status

  smoke_dir="$(/usr/bin/mktemp -d /run/tencorp-market-map-smoke.XXXXXX)"
  health_file="${smoke_dir}/health.json"
  meta_file="${smoke_dir}/meta.json"
  points_file="${smoke_dir}/points.json"
  root_file="${smoke_dir}/root.html"

  status="$($CURL_BIN --noproxy '*' --silent --show-error --output "$root_file" \
    --write-out '%{http_code}' --connect-timeout 3 --max-time 15 "${LOOPBACK_ORIGIN}/")" || {
      /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
      return 1
    }
  if [[ "$status" != 200 ]] || ! /usr/bin/grep -Eiq '<html|<!doctype[[:space:]]+html' "$root_file"; then
    /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
    return 1
  fi

  for endpoint in health meta points; do
    status="$($CURL_BIN --noproxy '*' --silent --show-error \
      --output "${smoke_dir}/${endpoint}.json" --write-out '%{http_code}' \
      --connect-timeout 3 --max-time 20 "${LOOPBACK_ORIGIN}/api/${endpoint}")" || {
        /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
        return 1
      }
    if [[ "$status" != 200 ]]; then
      /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
      return 1
    fi
  done

  if ! "$PYTHON_BIN" - "$health_file" "$meta_file" "$points_file" "$LIVE_DB" <<'VERIFY_SMOKE'
import json
import math
import pathlib
import sys

health = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
meta = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
points = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
expected_db = sys.argv[4]

if not isinstance(health, dict) or health.get("ok") is not True or health.get("database") != expected_db:
    raise SystemExit("invalid health response")
if not isinstance(meta, dict) or meta.get("source") != "DSHK":
    raise SystemExit("invalid metadata response")
total = meta.get("total")
if not isinstance(total, int) or isinstance(total, bool) or total <= 0:
    raise SystemExit("market-map database is unexpectedly empty")
if not isinstance(points, list) or len(points) != total:
    raise SystemExit("point count does not match metadata total")
ids = []
for point in points:
    if not isinstance(point, dict):
        raise SystemExit("point is not an object")
    point_id = point.get("id")
    lat = point.get("lat")
    lon = point.get("lon")
    if not isinstance(point_id, int) or isinstance(point_id, bool) or point_id <= 0:
        raise SystemExit("point id is invalid")
    if not isinstance(lat, (int, float)) or isinstance(lat, bool) or not math.isfinite(lat) or not -90 <= lat <= 90:
        raise SystemExit("point latitude is invalid")
    if not isinstance(lon, (int, float)) or isinstance(lon, bool) or not math.isfinite(lon) or not -180 <= lon <= 180:
        raise SystemExit("point longitude is invalid")
    ids.append(point_id)
if len(ids) != len(set(ids)):
    raise SystemExit("point ids are not unique")
for collection_name in ("regions", "statuses"):
    collection = meta.get(collection_name)
    if not isinstance(collection, list):
        raise SystemExit(f"{collection_name} metadata is invalid")
    counts = [item.get("count") for item in collection if isinstance(item, dict)]
    if len(counts) != len(collection) or any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts):
        raise SystemExit(f"{collection_name} counts are invalid")
    if sum(counts) != total:
        raise SystemExit(f"{collection_name} counts do not match total")
VERIFY_SMOKE
  then
    /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
    return 1
  fi

  /usr/bin/rm -rf --one-file-system -- "$smoke_dir"
  return 0
}

smoke_endpoints() {
  local attempts="${1:-5}"
  local attempt

  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    if smoke_endpoints_once; then
      log "Loopback smoke passed: /, /api/health, /api/meta, /api/points"
      return 0
    fi
    /usr/bin/sleep 1
  done
  log "Loopback smoke failed after ${attempts} attempts"
  return 1
}

rollback_on_failure() {
  local original_status=$?
  local rollback_status=0

  trap - EXIT INT TERM
  set +e
  safe_remove_probe "$PROBE_DIR"
  safe_remove_staging "$STAGING_RELEASE"

  if (( original_status != 0 && CURRENT_SWITCHED == 1 && DEPLOYMENT_CONFIRMED == 0 )); then
    log "Deployment failed after the current pointer changed; rolling back"
    if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" && ! -L "$PREVIOUS_RELEASE" ]]; then
      atomic_switch "$PREVIOUS_RELEASE"
      rollback_status=$?
      if (( rollback_status == 0 )); then
        /usr/bin/systemctl restart "$SERVICE_UNIT"
        rollback_status=$?
      fi
      if (( rollback_status == 0 )); then
        wait_for_service_release "$PREVIOUS_RELEASE" 30
        rollback_status=$?
      fi
      if (( rollback_status == 0 )); then
        smoke_endpoints 5
        rollback_status=$?
      fi
    else
      log "CRITICAL: no safe previous market-map release is available"
      /usr/bin/systemctl stop "$SERVICE_UNIT" >/dev/null 2>&1 || true
      rollback_status=1
    fi
    if (( rollback_status != 0 )); then
      log "CRITICAL: automatic market-map rollback did not recover a healthy previous release"
    else
      log "Rollback restored ${PREVIOUS_RELEASE}"
    fi
  fi

  exit "$original_status"
}

validate_upload_path() {
  local candidate="$1"
  local name remainder encoded_short owner mode

  [[ "$candidate" == "${UPLOAD_ROOT}/"* ]] || die "UPLOAD is outside the fixed upload root"
  [[ "$(dirname -- "$candidate")" == "$UPLOAD_ROOT" ]] || die "UPLOAD must be a direct child of the fixed upload root"
  name="$(basename -- "$candidate")"
  [[ "$name" =~ $UPLOAD_NAME_RE ]] || die "UPLOAD name does not match the market-map protocol"
  remainder="${name#*-}"
  encoded_short="${remainder%%-*}"
  [[ "$encoded_short" == "${COMMIT:0:7}" ]] || die "UPLOAD name is not bound to COMMIT"
  [[ -d "$candidate" && ! -L "$candidate" ]] || die "UPLOAD is absent or is a symlink"
  [[ "$(realpath -e -- "$candidate")" == "$candidate" ]] || die "UPLOAD path is not canonical"
  owner="$(stat -c '%u' -- "$candidate")"
  mode="$(stat -c '%a' -- "$candidate")"
  [[ "$owner" == 0 ]] || die "UPLOAD must be root-owned"
  (( (8#$mode & 0022) == 0 )) || die "UPLOAD must not be writable by group or others"
}

validate_artifact() {
  local artifact="$1"
  local canonical owner mode unsafe_entry writable_entry foreign_owner sensitive_entry

  [[ -d "$artifact" && ! -L "$artifact" ]] || die "market-map artifact directory is absent or unsafe"
  canonical="$(realpath -e -- "$artifact")"
  [[ "$canonical" == "${UPLOAD}/artifact" ]] || die "market-map artifact path is not canonical"
  owner="$(stat -c '%u' -- "$artifact")"
  mode="$(stat -c '%a' -- "$artifact")"
  [[ "$owner" == 0 ]] || die "market-map artifact must be root-owned"
  (( (8#$mode & 0022) == 0 )) || die "market-map artifact must not be writable by group or others"

  unsafe_entry="$(find "$artifact" -mindepth 1 ! -type d ! -type f -print -quit)"
  [[ -z "$unsafe_entry" ]] || die "market-map artifact contains a symlink or special entry: ${unsafe_entry}"
  writable_entry="$(find "$artifact" -mindepth 1 -perm /0022 -print -quit)"
  [[ -z "$writable_entry" ]] || die "market-map artifact contains a group/world-writable entry: ${writable_entry}"
  foreign_owner="$(find "$artifact" -mindepth 1 ! -user root -print -quit)"
  [[ -z "$foreign_owner" ]] || die "market-map artifact contains a non-root-owned entry: ${foreign_owner}"
  sensitive_entry="$(find "$artifact" -type f \( \
    -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o \
    -name '*.p12' -o -name '*.pfx' -o -name '*.db' -o -name '*.sqlite*' \
  \) -print -quit)"
  [[ -z "$sensitive_entry" ]] || die "market-map artifact contains a forbidden state or secret-like file: ${sensitive_entry}"

  "$PYTHON_BIN" - "$artifact" <<'VERIFY_LAYOUT'
import json
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
allowed = {
    "server.py",
    "dshk_sync.py",
    "leadora_carto_map.html",
    "data.json",
    "vendor",
    "vendor/leaflet.css",
    "vendor/leaflet.js",
}
seen = set()
for current, directories, files in os.walk(root, followlinks=False):
    current_path = pathlib.Path(current)
    for name in directories + files:
        relative = (current_path / name).relative_to(root).as_posix()
        seen.add(relative)
if seen != allowed:
    raise SystemExit(f"unexpected market-map artifact layout: {sorted(seen ^ allowed)}")
for relative in allowed - {"vendor"}:
    path = root / relative
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"unsafe required market-map file: {relative}")
for filename in ("server.py", "dshk_sync.py"):
    source = (root / filename).read_text(encoding="utf-8")
    compile(source, filename, "exec")
data = json.loads((root / "data.json").read_text(encoding="utf-8"))
if not isinstance(data, (dict, list)):
    raise SystemExit("data.json must contain an object or array")
html = (root / "leadora_carto_map.html").read_text(encoding="utf-8")
if "<html" not in html.lower() or "vendor/leaflet" not in html:
    raise SystemExit("market-map HTML entrypoint is incomplete")
VERIFY_LAYOUT
}

assert_state_is_external() {
  local state_owner state_mode db_resolved

  [[ -d "$STATE_DIR" && ! -L "$STATE_DIR" ]] || die "live market-map state directory is absent or unsafe"
  state_owner="$(stat -c '%U' -- "$STATE_DIR")"
  state_mode="$(stat -c '%a' -- "$STATE_DIR")"
  [[ "$state_owner" == "$SERVICE_USER" ]] || die "live market-map state directory owner is unexpected"
  (( (8#$state_mode & 0002) == 0 )) || die "live market-map state directory is world-writable"
  if [[ -e "$LIVE_DB" || -L "$LIVE_DB" ]]; then
    [[ -f "$LIVE_DB" && ! -L "$LIVE_DB" ]] || die "live market-map database is not a regular file"
    db_resolved="$(realpath -e -- "$LIVE_DB")"
    [[ "$db_resolved" == "$LIVE_DB" ]] || die "live market-map database path is not canonical"
  fi
}

assert_release_capacity() {
  local artifact_kb available_kb required_kb

  artifact_kb="$(du -sk -- "$ARTIFACT" | awk '{print $1}')"
  available_kb="$(df -Pk -- "$RELEASES_DIR" | awk 'NR == 2 {print $4}')"
  [[ "$artifact_kb" =~ ^[0-9]+$ && "$available_kb" =~ ^[0-9]+$ ]] \
    || die "could not determine market-map artifact size and filesystem capacity"
  required_kb=$((MIN_FREE_KB + artifact_kb))
  (( available_kb >= required_kb )) || die "market-map releases need artifact size plus a 1 GiB safety reserve"
}

copy_release() {
  /usr/bin/install -d -o root -g root -m 0755 -- "$STAGING_RELEASE" "${STAGING_RELEASE}/vendor"
  /usr/bin/install -o root -g root -m 0644 -- \
    "${ARTIFACT}/server.py" \
    "${ARTIFACT}/dshk_sync.py" \
    "${ARTIFACT}/leadora_carto_map.html" \
    "${ARTIFACT}/data.json" \
    "$STAGING_RELEASE/"
  /usr/bin/install -o root -g root -m 0644 -- \
    "${ARTIFACT}/vendor/leaflet.css" \
    "${ARTIFACT}/vendor/leaflet.js" \
    "${STAGING_RELEASE}/vendor/"
  printf '%s\n' "$COMMIT" > "${STAGING_RELEASE}/DEPLOY_COMMIT"
  /usr/bin/chown root:root -- "${STAGING_RELEASE}/DEPLOY_COMMIT"
  /usr/bin/chmod 0644 -- "${STAGING_RELEASE}/DEPLOY_COMMIT"
}

runtime_probe() {
  PROBE_DIR="$(/usr/bin/mktemp -d /run/tencorp-market-map-probe.XXXXXX)"
  /usr/bin/chown "$SERVICE_USER:$SERVICE_GROUP" -- "$PROBE_DIR"
  /usr/bin/chmod 0700 -- "$PROBE_DIR"

  /usr/sbin/runuser -u "$SERVICE_USER" -- /usr/bin/env -i \
    HOME=/nonexistent \
    PATH=/usr/bin:/bin \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="$STAGING_RELEASE" \
    DB_PATH="${PROBE_DIR}/market_map.db" \
    CSV_PATH="${PROBE_DIR}/missing.csv" \
    DATA_JSON_PATH="${STAGING_RELEASE}/data.json" \
    "$PYTHON_BIN" - <<'PROBE_PYTHON'
import dshk_sync
import server

bootstrap = dshk_sync.bootstrap()
meta = server.query_meta()
points = server.query_points()
if not isinstance(bootstrap, dict):
    raise SystemExit("bootstrap result is invalid")
if not isinstance(meta, dict) or not isinstance(points, list):
    raise SystemExit("runtime queries returned invalid values")
if meta.get("total") != len(points):
    raise SystemExit("runtime probe point count mismatch")
PROBE_PYTHON

  safe_remove_probe "$PROBE_DIR"
  log "Offline runtime probe passed"
}

resolve_previous_release() {
  local resolved

  if [[ ! -e "$CURRENT_LINK" && ! -L "$CURRENT_LINK" ]]; then
    PREVIOUS_RELEASE=""
    return 0
  fi
  [[ -L "$CURRENT_LINK" ]] || die "current market-map pointer must be a symlink"
  resolved="$(realpath -e -- "$CURRENT_LINK")"
  case "$resolved" in
    "${RELEASES_DIR}"/*) ;;
    *) die "current market-map pointer escapes the releases directory" ;;
  esac
  [[ "$(dirname -- "$resolved")" == "$RELEASES_DIR" ]] \
    || die "current market-map release must be a direct child of the releases directory"
  [[ -d "$resolved" && ! -L "$resolved" ]] || die "current market-map release is unsafe"
  PREVIOUS_RELEASE="$resolved"
}

main() {
  local supplied_upload supplied_commit timestamp

  (( $# == 2 )) || {
    usage
    exit 64
  }
  supplied_upload="$1"
  supplied_commit="$2"
  [[ "$supplied_commit" =~ $COMMIT_RE ]] || die "COMMIT must be 40 lowercase hexadecimal characters"
  COMMIT="$supplied_commit"

  for command in awk basename date dirname df du find grep realpath stat \
    "$PYTHON_BIN" "$CURL_BIN" /usr/bin/flock /usr/bin/install /usr/bin/systemctl /usr/sbin/runuser; do
    require_command "$command"
  done

  UPLOAD="$(realpath -e -- "$supplied_upload")"
  [[ "$UPLOAD" == "$supplied_upload" ]] || die "UPLOAD must use its canonical fixed-root path"
  validate_upload_path "$UPLOAD"
  ARTIFACT="${UPLOAD}/artifact"
  validate_artifact "$ARTIFACT"
  assert_state_is_external

  [[ -d "$SERVICE_ROOT" && ! -L "$SERVICE_ROOT" ]] || die "market-map service root is absent or unsafe"
  [[ -d "$RELEASES_DIR" && ! -L "$RELEASES_DIR" ]] || die "market-map releases directory is absent or unsafe"
  [[ "$(stat -c '%u' -- "$SERVICE_ROOT")" == 0 && "$(stat -c '%u' -- "$RELEASES_DIR")" == 0 ]] \
    || die "market-map release roots must be root-owned"
  (( (8#$(stat -c '%a' -- "$SERVICE_ROOT") & 0022) == 0 )) || die "market-map service root is writable by group or others"
  (( (8#$(stat -c '%a' -- "$RELEASES_DIR") & 0022) == 0 )) || die "market-map releases directory is writable by group or others"

  exec 9>"$DEPLOY_LOCK"
  /usr/bin/flock -w 180 9 || die "timed out waiting for the market-map deployment lock"
  resolve_previous_release
  assert_release_capacity

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  RELEASE_ID="${timestamp}-${COMMIT:0:12}"
  FINAL_RELEASE="${RELEASES_DIR}/${RELEASE_ID}"
  STAGING_RELEASE="${RELEASES_DIR}/.incoming-${RELEASE_ID}.$$"
  [[ ! -e "$FINAL_RELEASE" && ! -L "$FINAL_RELEASE" ]] || die "market-map release already exists"
  [[ ! -e "$STAGING_RELEASE" && ! -L "$STAGING_RELEASE" ]] || die "market-map staging release already exists"

  trap rollback_on_failure EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  copy_release
  runtime_probe
  /usr/bin/mv -T -- "$STAGING_RELEASE" "$FINAL_RELEASE"
  STAGING_RELEASE=""

  atomic_switch "$FINAL_RELEASE"
  CURRENT_SWITCHED=1
  /usr/bin/systemctl restart "$SERVICE_UNIT"
  wait_for_service_release "$FINAL_RELEASE" 30
  smoke_endpoints 8

  printf '%s\n' "$COMMIT" > "${FINAL_RELEASE}/DEPLOY_CONFIRMED"
  /usr/bin/chown root:root -- "${FINAL_RELEASE}/DEPLOY_CONFIRMED"
  /usr/bin/chmod 0644 -- "${FINAL_RELEASE}/DEPLOY_CONFIRMED"
  DEPLOYMENT_CONFIRMED=1
  log "Market-map deployment confirmed: ${COMMIT}"
}

main "$@"
