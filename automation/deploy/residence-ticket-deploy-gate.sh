#!/bin/bash

# Forced command for the one-purpose Residence deployment SSH key. Install as
# /usr/local/sbin/residence-ticket-deploy-gate, root:root mode 0755, and bind it
# with authorized_keys `restrict,command="..."`. It intentionally never invokes
# a caller-supplied shell command.

# Re-exec once with a minimal environment. The forced authorized_keys command
# supplies no positional arguments, so a remote caller cannot inject or skip
# the private entry marker. The local --validate-only test follows the same
# sanitized path.
if [[ "${1:-}" != "--residence-gate-clean-entry" ]]; then
  exec /usr/bin/env -i \
    PATH=/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C \
    LC_ALL=C \
    SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND:-}" \
    /bin/bash --noprofile --norc "$0" --residence-gate-clean-entry "$@"
fi
shift

set -Eeuo pipefail
umask 0027

export PATH="/usr/sbin:/usr/bin:/sbin:/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS

readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/residence-service.git"
readonly DEPLOYMENT_ROOT="/srv/residence-deploy"
readonly REPOSITORY="${DEPLOYMENT_ROOT}/repository"
readonly WORKTREE_ROOT="${DEPLOYMENT_ROOT}/worktrees"
readonly RELEASES_DIR="/var/www/residence-service/root-releases"
readonly CURRENT_LINK="/var/www/residence-service/root-current"
readonly SERVICE_UNIT="residence-root-frontend.service"
readonly DEPLOYER="/usr/local/sbin/deploy-residence-root"
readonly REPOSITORY_LOCK="/run/lock/residence-root-remote-worktree.lock"
readonly DEPLOY_LOCK="/run/lock/residence-root-deploy.lock"
readonly RSYNC="/usr/bin/rsync"
readonly GIT="/usr/bin/git"
readonly FLOCK="/usr/bin/flock"
readonly REALPATH="/usr/bin/realpath"
readonly STAT="/usr/bin/stat"
readonly INSTALL="/usr/bin/install"
readonly RM="/usr/bin/rm"
readonly MV="/usr/bin/mv"
readonly SYSTEMCTL="/usr/bin/systemctl"
readonly READLINK="/usr/bin/readlink"

readonly COMMIT_RE='^[0-9a-f]{40}$'
readonly WORKTREE_NAME_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{7}-(manual|[0-9]{1,18})-[0-9]{1,10}$'
readonly ADMIN_COMMAND_RE='^[A-Za-z0-9/._ -]+$'
readonly RSYNC_COMMAND_PREFIX='rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . '

PARSED_ACTION=""
PARSED_COMMIT=""
PARSED_WORKTREE=""
PARSED_RSYNC_WORKTREE=""

log() {
  printf '[residence-ticket-deploy-gate] %s\n' "$*" >&2
}

die() {
  log "DENIED: $*"
  exit 64
}

git_trusted() {
  env -i \
    HOME=/nonexistent \
    PATH="$PATH" \
    LANG=C \
    LC_ALL=C \
    GIT_CONFIG_NOSYSTEM=1 \
    GIT_CONFIG_GLOBAL=/dev/null \
    GIT_TERMINAL_PROMPT=0 \
    "$GIT" -c core.hooksPath=/dev/null "$@"
}

validate_commit() {
  [[ "$1" =~ $COMMIT_RE ]] || die "commit must be 40 lowercase hexadecimal characters"
}

validate_worktree_path() {
  local candidate="$1"
  local name timestamp short_commit ticket_component process_component extra

  [[ "$candidate" == "${WORKTREE_ROOT}/"* ]] || die "worktree is outside the fixed root"
  [[ "$(/usr/bin/dirname -- "$candidate")" == "$WORKTREE_ROOT" ]] || die "worktree must be a direct child of the fixed root"
  name="$(/usr/bin/basename -- "$candidate")"
  [[ "$name" =~ $WORKTREE_NAME_RE ]] || die "worktree name does not match the deployment protocol"
  IFS=- read -r timestamp short_commit ticket_component process_component extra <<< "$name"
  [[ -z "${extra:-}" ]] || die "worktree name has unexpected components"
  printf '%s\n' "$name"
}

validate_worktree_commit_pair() {
  local worktree="$1"
  local commit="$2"
  local name remainder encoded_short

  name="$(validate_worktree_path "$worktree")"
  remainder="${name#*-}"
  encoded_short="${remainder%%-*}"
  [[ "$encoded_short" == "${commit:0:7}" ]] || die "worktree name is not bound to the requested commit"
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
      (( ${#fields[@]} == 3 )) || die "prepare requires COMMIT and WORKTREE"
      validate_commit "${fields[1]}"
      validate_worktree_commit_pair "${fields[2]}" "${fields[1]}"
      PARSED_ACTION="prepare"
      PARSED_COMMIT="${fields[1]}"
      PARSED_WORKTREE="${fields[2]}"
      ;;
    deploy)
      (( ${#fields[@]} == 3 )) || die "deploy requires WORKTREE and COMMIT"
      validate_worktree_path "${fields[1]}" >/dev/null
      validate_commit "${fields[2]}"
      validate_worktree_commit_pair "${fields[1]}" "${fields[2]}"
      PARSED_ACTION="deploy"
      PARSED_WORKTREE="${fields[1]}"
      PARSED_COMMIT="${fields[2]}"
      ;;
    status)
      (( ${#fields[@]} == 2 )) || die "status requires COMMIT"
      validate_commit "${fields[1]}"
      PARSED_ACTION="status"
      PARSED_COMMIT="${fields[1]}"
      ;;
    cleanup)
      (( ${#fields[@]} == 2 )) || die "cleanup requires WORKTREE"
      validate_worktree_path "${fields[1]}" >/dev/null
      PARSED_ACTION="cleanup"
      PARSED_WORKTREE="${fields[1]}"
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

assert_repository() {
  local repository_owner repository_mode origin

  assert_safe_directory "$REPOSITORY" "deployment repository"
  [[ -d "$REPOSITORY/.git" && ! -L "$REPOSITORY/.git" ]] || die "deployment repository has no regular .git directory"
  origin="$(git_trusted -C "$REPOSITORY" remote get-url origin)"
  [[ "$origin" == "$EXPECTED_ORIGIN" ]] || die "deployment repository origin mismatch"
  repository_owner="$($STAT -c '%u' -- "$REPOSITORY/.git")"
  repository_mode="$($STAT -c '%a' -- "$REPOSITORY/.git")"
  [[ "$repository_owner" == "0" ]] || die "deployment repository metadata is not root-owned"
  (( (8#$repository_mode & 0022) == 0 )) || die "deployment repository metadata is writable by group or others"
}

ensure_repository() {
  local incoming="${DEPLOYMENT_ROOT}/.repository-incoming-$$"

  if [[ -e "$REPOSITORY" || -L "$REPOSITORY" ]]; then
    assert_repository
    return
  fi
  [[ ! -e "$incoming" && ! -L "$incoming" ]] || die "temporary repository path already exists"
  if ! git_trusted clone --quiet --no-checkout -- "$EXPECTED_ORIGIN" "$incoming"; then
    "$RM" -rf --one-file-system -- "$incoming"
    die "could not clone the fixed deployment repository"
  fi
  "$MV" -T -- "$incoming" "$REPOSITORY"
  /usr/bin/chown -R root:root -- "$REPOSITORY"
  /usr/bin/chmod 0750 -- "$REPOSITORY"
  assert_repository
}

validate_existing_worktree() {
  local worktree="$1"
  local resolved top_level owner mode

  validate_worktree_path "$worktree" >/dev/null
  [[ -d "$worktree" && ! -L "$worktree" ]] || die "worktree is absent or is a symlink"
  resolved="$($REALPATH -e -- "$worktree")"
  [[ "$resolved" == "$worktree" ]] || die "worktree path is not canonical"
  owner="$($STAT -c '%u' -- "$worktree")"
  mode="$($STAT -c '%a' -- "$worktree")"
  [[ "$owner" == "0" ]] || die "worktree must be root-owned"
  (( (8#$mode & 0022) == 0 )) || die "worktree must not be writable by group or others"
  top_level="$(git_trusted -C "$worktree" rev-parse --show-toplevel)"
  [[ "$($REALPATH -e -- "$top_level")" == "$worktree" ]] || die "worktree is not a Git top level"
}

prepare_worktree() {
  local commit="$1"
  local worktree="$2"
  local origin_commit tracked_output

  ensure_directory "$DEPLOYMENT_ROOT" 0750 "deployment root"
  ensure_directory "$WORKTREE_ROOT" 0750 "worktree root"
  exec 8>"$REPOSITORY_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for repository lock"

  ensure_repository
  [[ ! -e "$worktree" && ! -L "$worktree" ]] || die "worktree already exists"
  git_trusted -C "$REPOSITORY" fetch --quiet --prune --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main'
  origin_commit="$(git_trusted -C "$REPOSITORY" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  [[ "$origin_commit" == "$commit" ]] || die "origin/main does not equal the requested commit"
  git_trusted -C "$REPOSITORY" cat-file -e "${commit}^{commit}"
  git_trusted -C "$REPOSITORY" worktree prune --expire=now
  git_trusted -C "$REPOSITORY" worktree add --quiet --detach "$worktree" "$commit"
  validate_existing_worktree "$worktree"
  [[ "$(git_trusted -C "$worktree" rev-parse --verify 'HEAD^{commit}')" == "$commit" ]] || die "prepared worktree HEAD mismatch"
  [[ -d "$worktree/website" && ! -L "$worktree/website" ]] || die "prepared worktree has no regular website directory"
  tracked_output="$(git_trusted -C "$worktree" ls-files -- 'website/dist/standalone')"
  [[ -z "$tracked_output" ]] || die "standalone output must not be tracked by Git"
  if [[ -e "$worktree/website/dist" || -L "$worktree/website/dist" ]]; then
    [[ -d "$worktree/website/dist" && ! -L "$worktree/website/dist" ]] || die "website/dist is not a regular directory"
  else
    "$INSTALL" -d -o root -g root -m 0750 -- "$worktree/website/dist"
  fi
  [[ ! -e "$worktree/website/dist/standalone" && ! -L "$worktree/website/dist/standalone" ]] || die "standalone upload directory already exists"
  "$INSTALL" -d -o root -g root -m 0750 -- "$worktree/website/dist/standalone"
  printf 'prepared %s\n' "$commit"
}

validate_rsync_syntax() {
  local original="$1"
  local target name

  [[ "$original" != *$'\n'* && "$original" != *$'\r'* && "$original" != *$'\t'* ]] || die "rsync command contains control characters"
  [[ "$original" == "${RSYNC_COMMAND_PREFIX}"* ]] || die "unsupported rsync server command"
  target="${original#"$RSYNC_COMMAND_PREFIX"}"
  name="${target%%/*}"
  [[ "$name" =~ $WORKTREE_NAME_RE && "$target" == "${name}/website/dist/standalone/" ]] || die "rsync target is outside a prepared standalone directory"
  PARSED_RSYNC_WORKTREE="${WORKTREE_ROOT}/${name}"
}

validate_rsync_command() {
  local original="$1"
  local worktree upload_root

  validate_rsync_syntax "$original"
  worktree="$PARSED_RSYNC_WORKTREE"
  validate_existing_worktree "$worktree"
  upload_root="$($REALPATH -e -- "$worktree/website/dist/standalone")"
  [[ "$upload_root" == "$worktree/website/dist/standalone" ]] || die "standalone upload directory is not canonical"
}

run_restricted_rsync() {
  local original="$1"
  local worktree_name target

  exec 8>"$REPOSITORY_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for repository lock"
  assert_safe_directory "$WORKTREE_ROOT" "worktree root"
  validate_rsync_command "$original"
  worktree_name="$(/usr/bin/basename -- "$PARSED_RSYNC_WORKTREE")"
  target="${worktree_name}/website/dist/standalone/"

  # Ubuntu's packaged rrsync rejects the stock macOS rsync wire flag
  # `--dirs`, even though the underlying rsync supports it. Do not pass the
  # caller's command to a shell or relax the protocol: reconstruct the single
  # reviewed write-side server command from the validated worktree name.
  cd -- "$WORKTREE_ROOT"
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

deploy_worktree() {
  local commit="$1"
  local worktree="$2"
  local head origin deployer_mode

  validate_existing_worktree "$worktree"
  head="$(git_trusted -C "$worktree" rev-parse --verify 'HEAD^{commit}')"
  [[ "$head" == "$commit" ]] || die "worktree HEAD does not equal the requested commit"
  origin="$(git_trusted -C "$worktree" remote get-url origin)"
  [[ "$origin" == "$EXPECTED_ORIGIN" ]] || die "worktree origin mismatch"
  [[ -x "$DEPLOYER" && ! -L "$DEPLOYER" ]] || die "fixed deployer is absent or unsafe"
  [[ "$($STAT -c '%u' -- "$DEPLOYER")" == "0" ]] || die "fixed deployer must be root-owned"
  deployer_mode="$($STAT -c '%a' -- "$DEPLOYER")"
  (( (8#$deployer_mode & 0022) == 0 )) || die "fixed deployer is writable by group or others"
  exec "$DEPLOYER" "$worktree" "$commit"
}

status_commit() {
  local commit="$1"
  local current content_marker confirmed_marker marker_owner marker_mode actual confirmed main_pid process_cwd

  exec 9>"$DEPLOY_LOCK"
  "$FLOCK" -s -w 180 9 || {
    log "deployment status is still busy"
    exit 75
  }
  if [[ ! -L "$CURRENT_LINK" ]]; then
    log "current release pointer is absent; deployment state is unknown"
    return 75
  fi
  current="$($REALPATH -e -- "$CURRENT_LINK")"
  case "$current" in
    "${RELEASES_DIR}"/*) ;;
    *) die "current release pointer escapes the fixed releases directory" ;;
  esac
  [[ "$(/usr/bin/dirname -- "$current")" == "$RELEASES_DIR" ]] || die "current release is not a direct child of the releases directory"
  content_marker="${current}/DEPLOY_COMMIT"
  if [[ ! -f "$content_marker" || -L "$content_marker" ]]; then
    log "current release has no trustworthy content marker"
    return 75
  fi
  marker_owner="$($STAT -c '%u' -- "$content_marker")"
  marker_mode="$($STAT -c '%a' -- "$content_marker")"
  [[ "$marker_owner" == "0" ]] || die "content marker is not root-owned"
  (( (8#$marker_mode & 0022) == 0 )) || die "content marker is writable by group or others"
  IFS= read -r actual < "$content_marker" || die "content marker is unreadable or empty"
  [[ "$actual" =~ $COMMIT_RE ]] || die "content marker is malformed"
  # DEPLOY_COMMIT exists before the candidate and post-switch smoke tests. It
  # identifies bytes only and must never be treated as proof of a healthy
  # publication. DEPLOY_CONFIRMED is written by the root deployer only after
  # those checks complete successfully.
  confirmed_marker="${current}/DEPLOY_CONFIRMED"
  if [[ ! -f "$confirmed_marker" || -L "$confirmed_marker" ]]; then
    log "active release has no trustworthy completion marker"
    return 75
  fi
  marker_owner="$($STAT -c '%u' -- "$confirmed_marker")"
  marker_mode="$($STAT -c '%a' -- "$confirmed_marker")"
  [[ "$marker_owner" == "0" ]] || die "completion marker is not root-owned"
  (( (8#$marker_mode & 0022) == 0 )) || die "completion marker is writable by group or others"
  IFS= read -r confirmed < "$confirmed_marker" || die "completion marker is unreadable or empty"
  [[ "$confirmed" =~ $COMMIT_RE ]] || die "completion marker is malformed"
  if [[ "$confirmed" != "$actual" ]]; then
    log "active release completion marker does not match its content"
    return 75
  fi

  # A late marker alone is not sufficient if the service was subsequently
  # restarted from another directory. Confirm the live MainPID is executing
  # from this exact release before reporting the commit as deployed.
  if ! "$SYSTEMCTL" is-active --quiet "$SERVICE_UNIT"; then
    log "active release is marked complete but the frontend service is inactive"
    return 75
  fi
  main_pid="$($SYSTEMCTL show "$SERVICE_UNIT" --property=MainPID --value 2>/dev/null || true)"
  if [[ ! "$main_pid" =~ ^[1-9][0-9]*$ || ! -d "/proc/${main_pid}" ]]; then
    log "active release is marked complete but the frontend MainPID is unavailable"
    return 75
  fi
  process_cwd="$($READLINK -f -- "/proc/${main_pid}/cwd" 2>/dev/null || true)"
  if [[ "$process_cwd" != "${current}/frontend" ]]; then
    log "frontend service cwd does not match the requested completed release"
    return 75
  fi

  if [[ "$actual" == "$commit" ]]; then
    printf 'deployed %s\n' "$commit"
    return 0
  fi
  printf 'not-deployed\n'
  return 3
}

cleanup_worktree() {
  local worktree="$1"

  validate_worktree_path "$worktree" >/dev/null
  ensure_directory "$DEPLOYMENT_ROOT" 0750 "deployment root"
  ensure_directory "$WORKTREE_ROOT" 0750 "worktree root"
  exec 8>"$REPOSITORY_LOCK"
  "$FLOCK" -w 120 8 || die "timed out waiting for repository lock"
  if [[ -d "$REPOSITORY/.git" && ! -L "$REPOSITORY/.git" ]]; then
    assert_repository
    git_trusted -C "$REPOSITORY" worktree remove --force -- "$worktree" >/dev/null 2>&1 || true
  fi
  if [[ -e "$worktree" || -L "$worktree" ]]; then
    "$RM" -rf --one-file-system -- "$worktree"
  fi
  if [[ -d "$REPOSITORY/.git" && ! -L "$REPOSITORY/.git" ]]; then
    git_trusted -C "$REPOSITORY" worktree prune --expire=now
  fi
  printf 'cleaned\n'
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
    prepare) prepare_worktree "$PARSED_COMMIT" "$PARSED_WORKTREE" ;;
    deploy) deploy_worktree "$PARSED_COMMIT" "$PARSED_WORKTREE" ;;
    status) status_commit "$PARSED_COMMIT" ;;
    cleanup) cleanup_worktree "$PARSED_WORKTREE" ;;
    *) die "internal command dispatch failure" ;;
  esac
}

main "$@"
