#!/bin/bash

# Forced command for the one-purpose TENCORP market-map deployment SSH key.
# Install as /usr/local/sbin/tencorp-market-map-deploy-gate, root:root mode
# 0755, and bind it with authorized_keys `restrict,command="..."`.

if [[ "${1:-}" != "--market-map-gate-clean-entry" ]]; then
  exec /usr/bin/env -i \
    PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C \
    LC_ALL=C \
    SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}" \
    /bin/bash --noprofile --norc "$0" --market-map-gate-clean-entry "$@"
fi
shift

set -Eeuo pipefail
umask 0027

export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS

readonly DEPLOYMENT_ROOT="/srv/tencorp-market-map-deploy"
readonly UPLOAD_ROOT="${DEPLOYMENT_ROOT}/uploads"
readonly RELEASES_DIR="/var/www/tencorp-market-map/releases"
readonly CURRENT_LINK="/var/www/tencorp-market-map/current"
readonly SERVICE_UNIT="tencorp-market-map.service"
readonly DEPLOYER="/usr/local/sbin/deploy-tencorp-market-map"
readonly UPLOAD_LOCK="/run/lock/tencorp-market-map-upload.lock"
readonly DEPLOY_LOCK="/run/lock/tencorp-market-map-deploy.lock"
readonly RSYNC="/usr/bin/rsync"
readonly FLOCK="/usr/bin/flock"
readonly REALPATH="/usr/bin/realpath"
readonly STAT="/usr/bin/stat"
readonly INSTALL="/usr/bin/install"
readonly RM="/usr/bin/rm"
readonly SYSTEMCTL="/usr/bin/systemctl"
readonly READLINK="/usr/bin/readlink"

readonly COMMIT_RE='^[0-9a-f]{40}$'
readonly UPLOAD_NAME_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}-(manual|[0-9]{1,18})-[0-9]{1,10}$'
readonly ADMIN_COMMAND_RE='^[A-Za-z0-9/._ -]+$'
readonly RSYNC_COMMAND_PREFIX='rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . '

PARSED_ACTION=""
PARSED_COMMIT=""
PARSED_UPLOAD=""
PARSED_RSYNC_UPLOAD=""

log() {
  printf '[tencorp-market-map-deploy-gate] %s\n' "$*" >&2
}

die() {
  log "DENIED: $*"
  exit 64
}

validate_commit() {
  [[ "$1" =~ $COMMIT_RE ]] || die "commit must be 40 lowercase hexadecimal characters"
}

validate_upload_path() {
  local candidate="$1"
  local name timestamp short_commit ticket_component process_component extra

  [[ "$candidate" == "${UPLOAD_ROOT}/"* ]] || die "upload is outside the fixed root"
  [[ "$(/usr/bin/dirname -- "$candidate")" == "$UPLOAD_ROOT" ]] || die "upload must be a direct child of the fixed root"
  name="$(/usr/bin/basename -- "$candidate")"
  [[ "$name" =~ $UPLOAD_NAME_RE ]] || die "upload name does not match the deployment protocol"
  IFS=- read -r timestamp short_commit ticket_component process_component extra <<< "$name"
  [[ -z "${extra:-}" ]] || die "upload name has unexpected components"
  printf '%s\n' "$name"
}

validate_upload_commit_pair() {
  local upload="$1"
  local commit="$2"
  local name remainder encoded_short

  name="$(validate_upload_path "$upload")"
  remainder="${name#*-}"
  encoded_short="${remainder%%-*}"
  [[ "$encoded_short" == "${commit:0:7}" ]] || die "upload name is not bound to the requested commit"
}

parse_admin_command() {
  local original="$1"
  local -a fields=()

  [[ -n "$original" ]] || die "an SSH command is required"
  [[ "$original" != *$'\n'* && "$original" != *$'\r'* && "$original" != *$'\t'* ]] || die "control characters are forbidden"
  [[ "$original" =~ $ADMIN_COMMAND_RE ]] || die "command contains forbidden characters"
  read -r -a fields <<< "$original"
  [[ "${fields[*]}" == "$original" ]] || die "command must use one space between arguments"

  case "${fields[0]:-}" in
    prepare)
      (( ${#fields[@]} == 3 )) || die "prepare requires COMMIT and UPLOAD"
      validate_commit "${fields[1]}"
      validate_upload_commit_pair "${fields[2]}" "${fields[1]}"
      PARSED_ACTION="prepare"
      PARSED_COMMIT="${fields[1]}"
      PARSED_UPLOAD="${fields[2]}"
      ;;
    deploy)
      (( ${#fields[@]} == 3 )) || die "deploy requires UPLOAD and COMMIT"
      validate_upload_path "${fields[1]}" >/dev/null
      validate_commit "${fields[2]}"
      validate_upload_commit_pair "${fields[1]}" "${fields[2]}"
      PARSED_ACTION="deploy"
      PARSED_UPLOAD="${fields[1]}"
      PARSED_COMMIT="${fields[2]}"
      ;;
    status)
      (( ${#fields[@]} == 2 )) || die "status requires COMMIT"
      validate_commit "${fields[1]}"
      PARSED_ACTION="status"
      PARSED_COMMIT="${fields[1]}"
      ;;
    cleanup)
      (( ${#fields[@]} == 2 )) || die "cleanup requires UPLOAD"
      validate_upload_path "${fields[1]}" >/dev/null
      PARSED_ACTION="cleanup"
      PARSED_UPLOAD="${fields[1]}"
      ;;
    *)
      die "unsupported command"
      ;;
  esac
}

assert_safe_directory() {
  local directory="$1"
  local label="$2"
  local owner mode

  [[ -d "$directory" && ! -L "$directory" ]] || die "${label} must be a non-symlink directory"
  owner="$($STAT -c '%u' -- "$directory")"
  mode="$($STAT -c '%a' -- "$directory")"
  [[ "$owner" == "0" ]] || die "${label} must be root-owned"
  (( (8#$mode & 0022) == 0 )) || die "${label} must not be writable by group or others"
}

ensure_directory() {
  local directory="$1"
  local mode="$2"
  local label="$3"

  if [[ -e "$directory" || -L "$directory" ]]; then
    assert_safe_directory "$directory" "$label"
    return
  fi
  "$INSTALL" -d -o root -g root -m "$mode" -- "$directory"
  assert_safe_directory "$directory" "$label"
}

validate_existing_upload() {
  local upload="$1"
  local resolved owner mode artifact artifact_resolved artifact_owner artifact_mode

  validate_upload_path "$upload" >/dev/null
  [[ -d "$upload" && ! -L "$upload" ]] || die "upload is absent or is a symlink"
  resolved="$($REALPATH -e -- "$upload")"
  [[ "$resolved" == "$upload" ]] || die "upload path is not canonical"
  owner="$($STAT -c '%u' -- "$upload")"
  mode="$($STAT -c '%a' -- "$upload")"
  [[ "$owner" == "0" ]] || die "upload must be root-owned"
  (( (8#$mode & 0022) == 0 )) || die "upload must not be writable by group or others"

  artifact="${upload}/artifact"
  [[ -d "$artifact" && ! -L "$artifact" ]] || die "artifact upload directory is absent or unsafe"
  artifact_resolved="$($REALPATH -e -- "$artifact")"
  [[ "$artifact_resolved" == "$artifact" ]] || die "artifact upload path is not canonical"
  artifact_owner="$($STAT -c '%u' -- "$artifact")"
  artifact_mode="$($STAT -c '%a' -- "$artifact")"
  [[ "$artifact_owner" == "0" ]] || die "artifact upload directory must be root-owned"
  (( (8#$artifact_mode & 0022) == 0 )) || die "artifact upload directory must not be writable by group or others"
}

prepare_upload() {
  local commit="$1"
  local upload="$2"

  validate_upload_commit_pair "$upload" "$commit"
  ensure_directory "$DEPLOYMENT_ROOT" 0750 "market-map deployment root"
  ensure_directory "$UPLOAD_ROOT" 0750 "market-map upload root"
  exec 8>"$UPLOAD_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for the market-map upload lock"
  [[ ! -e "$upload" && ! -L "$upload" ]] || die "upload already exists"
  "$INSTALL" -d -o root -g root -m 0750 -- "$upload" "${upload}/artifact"
  validate_existing_upload "$upload"
  printf 'market-map-prepared %s\n' "$commit"
}

validate_rsync_syntax() {
  local original="$1"
  local target name

  [[ "$original" != *$'\n'* && "$original" != *$'\r'* && "$original" != *$'\t'* ]] || die "rsync command contains control characters"
  [[ "$original" == "${RSYNC_COMMAND_PREFIX}"* ]] || die "unsupported rsync server command"
  target="${original#"$RSYNC_COMMAND_PREFIX"}"
  name="${target%%/*}"
  [[ "$name" =~ $UPLOAD_NAME_RE && "$target" == "${name}/artifact/" ]] \
    || die "rsync target is outside a prepared market-map artifact directory"
  PARSED_RSYNC_UPLOAD="${UPLOAD_ROOT}/${name}"
}

validate_rsync_command() {
  local original="$1"

  validate_rsync_syntax "$original"
  validate_existing_upload "$PARSED_RSYNC_UPLOAD"
}

run_restricted_rsync() {
  local original="$1"
  local upload_name target

  exec 8>"$UPLOAD_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for the market-map upload lock"
  assert_safe_directory "$UPLOAD_ROOT" "market-map upload root"
  validate_rsync_command "$original"
  upload_name="$(/usr/bin/basename -- "$PARSED_RSYNC_UPLOAD")"
  target="${upload_name}/artifact/"

  cd -- "$UPLOAD_ROOT"
  exec "$RSYNC" \
    --server \
    --delete-delay \
    -l \
    -r \
    -t \
    --dirs \
    --delay-updates \
    --safe-links \
    -- \
    . \
    "$target"
}

deploy_upload() {
  local commit="$1"
  local upload="$2"
  local deployer_mode

  validate_upload_commit_pair "$upload" "$commit"
  validate_existing_upload "$upload"
  [[ -x "$DEPLOYER" && ! -L "$DEPLOYER" ]] || die "fixed market-map deployer is absent or unsafe"
  [[ "$($STAT -c '%u' -- "$DEPLOYER")" == "0" ]] || die "fixed market-map deployer must be root-owned"
  deployer_mode="$($STAT -c '%a' -- "$DEPLOYER")"
  (( (8#$deployer_mode & 0022) == 0 )) || die "fixed market-map deployer is writable by group or others"
  exec "$DEPLOYER" "$upload" "$commit"
}

status_commit() {
  local commit="$1"
  local current content_marker confirmed_marker marker marker_owner marker_mode actual confirmed
  local main_pid process_cwd

  exec 9>"$DEPLOY_LOCK"
  "$FLOCK" -s -w 180 9 || {
    log "market-map deployment status is still busy"
    exit 75
  }
  if [[ ! -L "$CURRENT_LINK" ]]; then
    log "current market-map release pointer is absent; deployment state is unknown"
    return 75
  fi
  current="$($REALPATH -e -- "$CURRENT_LINK")"
  case "$current" in
    "${RELEASES_DIR}"/*) ;;
    *) die "current market-map release pointer escapes the fixed releases directory" ;;
  esac
  [[ "$(/usr/bin/dirname -- "$current")" == "$RELEASES_DIR" ]] \
    || die "current market-map release is not a direct child of the releases directory"

  content_marker="${current}/DEPLOY_COMMIT"
  confirmed_marker="${current}/DEPLOY_CONFIRMED"
  for marker in "$content_marker" "$confirmed_marker"; do
    if [[ ! -f "$marker" || -L "$marker" ]]; then
      log "active market-map release has no trustworthy deployment markers"
      return 75
    fi
    marker_owner="$($STAT -c '%u' -- "$marker")"
    marker_mode="$($STAT -c '%a' -- "$marker")"
    [[ "$marker_owner" == "0" ]] || die "market-map deployment marker is not root-owned"
    (( (8#$marker_mode & 0022) == 0 )) || die "market-map deployment marker is writable by group or others"
  done
  IFS= read -r actual < "$content_marker" || die "market-map content marker is unreadable or empty"
  IFS= read -r confirmed < "$confirmed_marker" || die "market-map completion marker is unreadable or empty"
  [[ "$actual" =~ $COMMIT_RE && "$confirmed" =~ $COMMIT_RE ]] || die "market-map deployment marker is malformed"
  if [[ "$confirmed" != "$actual" ]]; then
    log "active market-map completion marker does not match its content"
    return 75
  fi

  if ! "$SYSTEMCTL" is-active --quiet "$SERVICE_UNIT"; then
    log "active market-map release is marked complete but the service is inactive"
    return 75
  fi
  main_pid="$($SYSTEMCTL show "$SERVICE_UNIT" --property=MainPID --value 2>/dev/null || true)"
  if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ || ! -d "/proc/${main_pid}" ]]; then
    log "active market-map release is marked complete but MainPID is unavailable"
    return 75
  fi
  process_cwd="$($READLINK -f -- "/proc/${main_pid}/cwd" 2>/dev/null || true)"
  if [[ "$process_cwd" != "$current" ]]; then
    log "market-map service cwd does not match the completed release"
    return 75
  fi

  if [[ "$actual" == "$commit" ]]; then
    printf 'market-map-deployed %s\n' "$commit"
    return 0
  fi
  printf 'market-map-not-deployed\n'
  return 3
}

cleanup_upload() {
  local upload="$1"

  validate_upload_path "$upload" >/dev/null
  ensure_directory "$DEPLOYMENT_ROOT" 0750 "market-map deployment root"
  ensure_directory "$UPLOAD_ROOT" 0750 "market-map upload root"
  exec 8>"$UPLOAD_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for the market-map upload lock"
  if [[ -e "$upload" || -L "$upload" ]]; then
    "$RM" -rf --one-file-system -- "$upload"
  fi
  printf 'market-map-cleaned\n'
}

validate_only() {
  local original="$1"

  if [[ "$original" == 'rsync --server '* ]]; then
    validate_rsync_syntax "$original"
    printf 'rsync\n'
    return
  fi
  parse_admin_command "$original"
  printf '%s\n' "$PARSED_ACTION"
}

main() {
  local original="${SSH_ORIGINAL_COMMAND:-}"

  if (( $# == 2 )) && [[ "$1" == "--validate-only" ]] && [[ -z "${SSH_CONNECTION:-}" && -z "${SSH_ORIGINAL_COMMAND:-}" ]]; then
    validate_only "$2"
    return
  fi
  (( $# == 0 )) || die "positional arguments are forbidden over the forced-command entrypoint"
  [[ -n "$original" ]] || die "interactive shells and subsystems are forbidden"

  if [[ "$original" == 'rsync --server '* ]]; then
    run_restricted_rsync "$original"
  fi
  parse_admin_command "$original"
  case "$PARSED_ACTION" in
    prepare) prepare_upload "$PARSED_COMMIT" "$PARSED_UPLOAD" ;;
    deploy) deploy_upload "$PARSED_COMMIT" "$PARSED_UPLOAD" ;;
    status) status_commit "$PARSED_COMMIT" ;;
    cleanup) cleanup_upload "$PARSED_UPLOAD" ;;
    *) die "internal command dispatch failure" ;;
  esac
}

main "$@"
