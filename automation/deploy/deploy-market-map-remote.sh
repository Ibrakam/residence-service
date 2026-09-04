#!/bin/bash

set -Eeuo pipefail
umask 0077

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS

readonly PROJECT_KEY="market-map"
readonly REMOTE_HOST="root@46.62.227.229"
readonly SSH_BIN="/usr/bin/ssh"
readonly RSYNC_BIN="/usr/bin/rsync"
readonly NODE_BIN="/usr/local/bin/node"
readonly PYTHON_BIN="/usr/bin/python3"
readonly SSH_KEY="/Users/ibragimkadamzanov/.ssh/tencorp_market_map_deploy_ed25519"
readonly LEGACY_ROOT_PUBLIC_KEY="/Users/ibragimkadamzanov/.ssh/id_ed25519.pub"
readonly SSH_KEYGEN_BIN="/usr/bin/ssh-keygen"
readonly KNOWN_HOSTS="/Users/ibragimkadamzanov/.ssh/known_hosts"
readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/tencorp-market-map.git"
readonly REMOTE_UPLOAD_ROOT="/srv/tencorp-market-map-deploy/uploads"
readonly STATUS_CONFIRM_ATTEMPTS=6
readonly STATUS_CONFIRM_DELAY_SECONDS=5

LOCAL_WORKTREE=""
COMMIT=""
REMOTE_UPLOAD=""
REMOTE_UPLOAD_NAME=""
REMOTE_PREPARED=0
DEPLOYMENT_CONFIRMED=0
PREFLIGHT_ONLY=0

readonly -a SSH_OPTIONS=(
  -F /dev/null
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o ClearAllForwardings=yes
  -o IdentitiesOnly=yes
  -o RequestTTY=no
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=${KNOWN_HOSTS}"
  -o ConnectTimeout=10
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=3
  -o LogLevel=ERROR
)

log() {
  printf '[deploy-market-map-remote] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-market-map-remote.sh [WORKTREE COMMIT]
       deploy-market-map-remote.sh --preflight WORKTREE COMMIT
       deploy-market-map-remote.sh --status COMMIT
       deploy-market-map-remote.sh --policy-version

With no arguments, WORKTREE and COMMIT are read from TICKET_RUNNER_WORKTREE
and TICKET_RUNNER_COMMIT_SHA. TICKET_RUNNER_PROJECT_KEY must be market-map.
The script accepts no repository, remote host, key, or deployment-path override.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

validate_project_context() {
  [[ "${TICKET_RUNNER_PROJECT_KEY:-}" == "$PROJECT_KEY" ]] \
    || die "TICKET_RUNNER_PROJECT_KEY must be ${PROJECT_KEY}"
}

validate_ssh_material() {
  local key_mode key_owner known_hosts_mode known_hosts_owner
  local legacy_public_mode legacy_public_owner dedicated_public dedicated_public_raw legacy_public
  local command

  for command in id realpath stat "$SSH_BIN" "$SSH_KEYGEN_BIN"; do
    require_command "$command"
  done
  [[ -f "$SSH_KEY" && ! -L "$SSH_KEY" ]] || die "fixed market-map SSH identity is missing or is a symlink"
  [[ -f "$LEGACY_ROOT_PUBLIC_KEY" && ! -L "$LEGACY_ROOT_PUBLIC_KEY" ]] || die "personal root public-key reference is missing or unsafe"
  [[ -f "$KNOWN_HOSTS" && ! -L "$KNOWN_HOSTS" ]] || die "fixed known_hosts file is missing or is a symlink"
  key_mode="$(stat -f '%Lp' "$SSH_KEY")"
  key_owner="$(stat -f '%u' "$SSH_KEY")"
  [[ "$key_owner" == "$(id -u)" ]] || die "fixed market-map SSH identity must be owned by the runner user"
  (( (8#$key_mode & 0077) == 0 )) || die "fixed market-map SSH identity must not be accessible by group or others"
  known_hosts_mode="$(stat -f '%Lp' "$KNOWN_HOSTS")"
  known_hosts_owner="$(stat -f '%u' "$KNOWN_HOSTS")"
  [[ "$known_hosts_owner" == "$(id -u)" ]] || die "fixed known_hosts file must be owned by the runner user"
  (( (8#$known_hosts_mode & 0022) == 0 )) || die "fixed known_hosts file must not be writable by group or others"
  legacy_public_mode="$(stat -f '%Lp' "$LEGACY_ROOT_PUBLIC_KEY")"
  legacy_public_owner="$(stat -f '%u' "$LEGACY_ROOT_PUBLIC_KEY")"
  [[ "$legacy_public_owner" == "$(id -u)" ]] || die "personal root public-key reference must be owned by the runner user"
  (( (8#$legacy_public_mode & 0022) == 0 )) || die "personal root public-key reference must not be writable by group or others"

  dedicated_public_raw="$(SSH_ASKPASS_REQUIRE=never "$SSH_KEYGEN_BIN" -y -P '' -f "$SSH_KEY" </dev/null)" \
    || die "fixed market-map SSH identity is unreadable, encrypted, or invalid"
  dedicated_public="$(printf '%s\n' "$dedicated_public_raw" | /usr/bin/awk 'NF >= 2 { print $1 " " $2; exit }')"
  [[ "$dedicated_public" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || die "fixed market-map SSH identity must be Ed25519"
  legacy_public="$(/usr/bin/awk 'NF >= 2 { print $1 " " $2; exit }' "$LEGACY_ROOT_PUBLIC_KEY")"
  [[ "$legacy_public" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || die "personal root public-key reference is malformed"
  [[ "$dedicated_public" != "$legacy_public" ]] || die "market-map deploy identity duplicates the personal root SSH key"
}

ssh_remote() {
  "$SSH_BIN" "${SSH_OPTIONS[@]}" "$REMOTE_HOST" "$@"
}

cleanup_remote_upload() {
  local original_status=$?
  local cleanup_status=0

  trap - EXIT INT TERM
  set +e
  if (( REMOTE_PREPARED == 1 )); then
    log "Removing exact remote upload ${REMOTE_UPLOAD}"
    ssh_remote cleanup "$REMOTE_UPLOAD" >/dev/null
    cleanup_status=$?
    if (( cleanup_status != 0 )); then
      log "CRITICAL: remote upload cleanup failed; remove only this exact path manually: ${REMOTE_UPLOAD}"
    fi
  fi

  if (( original_status != 0 )); then
    exit "$original_status"
  fi
  if (( DEPLOYMENT_CONFIRMED == 1 )); then
    exit 0
  fi
  exit "$cleanup_status"
}

validate_local_artifact() {
  local artifact="$1"
  local manifest="$2"
  local expected_digest="$3"
  local canonical_artifact canonical_manifest artifact_owner artifact_mode
  local source_file

  canonical_artifact="$(realpath "$artifact")"
  canonical_manifest="$(realpath "$manifest")"
  case "$canonical_artifact" in
    "${LOCAL_WORKTREE}"/*) die "market-map artifact must be a verifier-owned seal outside the worktree" ;;
  esac
  case "$canonical_manifest" in
    "$(dirname "$canonical_artifact")"/*) ;;
    *) die "artifact manifest is not colocated with the sealed artifact" ;;
  esac
  [[ -d "$canonical_artifact" && ! -L "$canonical_artifact" ]] || die "sealed market-map artifact is unsafe"
  [[ -f "$canonical_manifest" && ! -L "$canonical_manifest" ]] || die "sealed artifact manifest is unsafe"
  [[ "$expected_digest" =~ ^[0-9a-f]{64}$ ]] || die "sealed artifact digest is invalid"
  artifact_owner="$(stat -f '%u' "$canonical_artifact")"
  artifact_mode="$(stat -f '%Lp' "$canonical_artifact")"
  [[ "$artifact_owner" == "$(id -u)" ]] || die "sealed artifact is not owned by the runner user"
  (( (8#$artifact_mode & 0022) == 0 )) || die "sealed artifact is group/world writable"

  "$NODE_BIN" - "$canonical_artifact" "$canonical_manifest" "$expected_digest" <<'VERIFY_SEAL'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [root, manifestPath, expectedDigest] = process.argv.slice(2);
const raw = fs.readFileSync(manifestPath, "utf8");
const digest = crypto.createHash("sha256").update(raw).digest("hex");
if (digest !== expectedDigest) throw new Error("sealed manifest digest mismatch");
const manifest = JSON.parse(raw);
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) throw new Error("unsupported sealed manifest");
const allowed = new Set([
  "server.py",
  "dshk_sync.py",
  "leadora_carto_map.html",
  "data.json",
  "vendor",
  "vendor/leaflet.css",
  "vendor/leaflet.js",
]);
const expected = new Map();
for (const entry of manifest.entries) {
  if (!entry || typeof entry.path !== "string" || !allowed.has(entry.path) || expected.has(entry.path)) {
    throw new Error("unsafe, unexpected, or duplicate market-map manifest path");
  }
  expected.set(entry.path, entry);
}
if (expected.size !== allowed.size || [...allowed].some((entry) => !expected.has(entry))) {
  throw new Error("sealed market-map artifact is incomplete");
}
const seen = new Set();
function fileHash(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}
function visit(directory, relativeDirectory = "") {
  const children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    const relative = path.posix.join(relativeDirectory, child.name);
    const stat = fs.lstatSync(absolute);
    const entry = expected.get(relative);
    if (!entry) throw new Error(`unmanifested artifact entry: ${relative}`);
    seen.add(relative);
    if ((stat.mode & 0o7777) !== entry.mode) throw new Error(`artifact mode changed: ${relative}`);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      if (entry.type !== "directory") throw new Error(`artifact type changed: ${relative}`);
      visit(absolute, relative);
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      if (entry.type !== "file" || stat.size !== entry.size || fileHash(absolute) !== entry.sha256) {
        throw new Error(`artifact file changed: ${relative}`);
      }
    } else {
      throw new Error(`unsupported artifact entry: ${relative}`);
    }
  }
}
visit(root);
if (seen.size !== expected.size) throw new Error("sealed market-map artifact entries are missing");
JSON.parse(fs.readFileSync(path.join(root, "data.json"), "utf8"));
VERIFY_SEAL

  for source_file in \
    server.py \
    dshk_sync.py \
    leadora_carto_map.html \
    data.json \
    vendor/leaflet.css \
    vendor/leaflet.js; do
    [[ -f "${LOCAL_WORKTREE}/${source_file}" && ! -L "${LOCAL_WORKTREE}/${source_file}" ]] \
      || die "tracked market-map source is missing or unsafe: ${source_file}"
    git -C "$LOCAL_WORKTREE" ls-files --error-unmatch -- "$source_file" >/dev/null \
      || die "market-map source is not tracked by Git: ${source_file}"
    /usr/bin/cmp -s -- "${LOCAL_WORKTREE}/${source_file}" "${canonical_artifact}/${source_file}" \
      || die "sealed artifact differs from committed source: ${source_file}"
  done

  PYTHONDONTWRITEBYTECODE=1 "$PYTHON_BIN" - \
    "$canonical_artifact/server.py" "$canonical_artifact/dshk_sync.py" <<'VERIFY_PYTHON'
import ast
import pathlib
import sys
for filename in sys.argv[1:]:
    source = pathlib.Path(filename).read_text(encoding="utf-8")
    ast.parse(source, filename=filename)
VERIFY_PYTHON
}

query_remote_deployment_status() {
  local commit="$1"
  local output=""
  local transport_status=0

  if output="$(ssh_remote status "$commit")"; then
    transport_status=0
  else
    transport_status=$?
  fi
  if (( transport_status == 0 )) && [[ "$output" == "market-map-deployed ${commit}" ]]; then
    return 0
  fi
  if (( transport_status == 3 )) && [[ "$output" == "market-map-not-deployed" ]]; then
    return 3
  fi
  log "Remote market-map status query was not authoritative (transport status ${transport_status})"
  return 75
}

confirm_remote_deployment() {
  local commit="$1"
  local attempts="${2:-$STATUS_CONFIRM_ATTEMPTS}"
  local delay_seconds="${3:-$STATUS_CONFIRM_DELAY_SECONDS}"
  local attempt status=75

  for (( attempt = 1; attempt <= attempts; attempt += 1 )); do
    if query_remote_deployment_status "$commit"; then
      return 0
    else
      status=$?
    fi
    if (( attempt < attempts )); then
      /bin/sleep "$delay_seconds"
    fi
  done
  return "$status"
}

deployment_status_unknown() {
  log "DEPLOYMENT_STATUS_UNKNOWN: $*"
  exit 75
}

status_only() {
  local commit="$1"
  local status

  if query_remote_deployment_status "$commit"; then
    printf 'deployed\n'
    return 0
  else
    status=$?
  fi
  if (( status == 3 )); then
    printf 'not-deployed\n'
    return 3
  fi
  deployment_status_unknown "could not establish the market-map production marker for ${commit}"
}

policy_version_only() {
  local output=""
  local transport_status=0

  if output="$(ssh_remote policy)"; then
    transport_status=0
  else
    transport_status=$?
  fi
  if (( transport_status != 0 )) || [[ ! "$output" =~ ^market-map-policy\ v1\ [0-9a-f]{64}\ yandex-key-(present|unavailable)$ ]]; then
    die "remote market-map policy version is unavailable or malformed"
  fi
  printf '%s\n' "$output"
}

main() {
  local supplied_worktree supplied_commit top_level head_commit origin_url origin_commit
  local commit_line
  local -a commit_parts
  local artifact manifest artifact_digest timestamp short_commit ticket_component rsync_shell
  local preflight_status=0 deploy_transport_status=0 confirmation_status output

  validate_project_context

  if [[ "${1:-}" == "--policy-version" ]]; then
    if (( $# != 1 )); then
      usage
      exit 64
    fi
    validate_ssh_material
    policy_version_only
    return
  fi

  if [[ "${1:-}" == "--status" ]]; then
    if (( $# != 2 )); then
      usage
      exit 64
    fi
    [[ "$2" =~ ^[0-9a-fA-F]{40}$ ]] || die "COMMIT must contain exactly 40 hexadecimal characters"
    COMMIT="$(printf '%s' "$2" | /usr/bin/tr '[:upper:]' '[:lower:]')"
    validate_ssh_material
    status_only "$COMMIT"
    return
  fi

  if [[ "${1:-}" == "--preflight" ]]; then
    if (( $# != 3 )); then
      usage
      exit 64
    fi
    PREFLIGHT_ONLY=1
    supplied_worktree="$2"
    supplied_commit="$3"
  elif (( $# == 0 )); then
    supplied_worktree="${TICKET_RUNNER_WORKTREE:-}"
    supplied_commit="${TICKET_RUNNER_COMMIT_SHA:-}"
  elif (( $# == 2 )); then
    supplied_worktree="$1"
    supplied_commit="$2"
  else
    usage
    exit 64
  fi

  [[ -n "$supplied_worktree" ]] || die "WORKTREE is required"
  [[ "$supplied_commit" =~ ^[0-9a-fA-F]{40}$ ]] || die "COMMIT must contain exactly 40 hexadecimal characters"
  COMMIT="$(printf '%s' "$supplied_commit" | /usr/bin/tr '[:upper:]' '[:lower:]')"

  for command in cmp date git id realpath stat "$RSYNC_BIN" "$SSH_BIN" "$NODE_BIN" "$PYTHON_BIN" tr; do
    require_command "$command"
  done
  validate_ssh_material

  LOCAL_WORKTREE="$(realpath "$supplied_worktree")"
  [[ -d "$LOCAL_WORKTREE" ]] || die "WORKTREE is not a directory"
  top_level="$(git -C "$LOCAL_WORKTREE" rev-parse --show-toplevel)"
  [[ "$(realpath "$top_level")" == "$LOCAL_WORKTREE" ]] || die "WORKTREE must be the Git top level"
  head_commit="$(git -C "$LOCAL_WORKTREE" rev-parse --verify 'HEAD^{commit}')"
  [[ "$head_commit" == "$COMMIT" ]] || die "local WORKTREE HEAD does not equal COMMIT"
  git -C "$LOCAL_WORKTREE" diff --quiet -- || die "local WORKTREE has unstaged tracked changes"
  git -C "$LOCAL_WORKTREE" diff --cached --quiet -- || die "local WORKTREE has staged changes"
  origin_url="$(git -C "$LOCAL_WORKTREE" remote get-url origin)"
  [[ "$origin_url" == "$EXPECTED_ORIGIN" ]] || die "local origin is not the fixed market-map repository"

  log "Refreshing market-map origin/main for provenance validation"
  GIT_TERMINAL_PROMPT=0 git -C "$LOCAL_WORKTREE" fetch --quiet --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main'
  origin_commit="$(git -C "$LOCAL_WORKTREE" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  if (( PREFLIGHT_ONLY == 1 )); then
    commit_line="$(git -C "$LOCAL_WORKTREE" rev-list --parents -n 1 "$COMMIT")"
    read -r -a commit_parts <<< "$commit_line"
    (( ${#commit_parts[@]} == 2 )) || die "market-map preflight commit must have exactly one parent"
    [[ "${commit_parts[0]}" == "$COMMIT" && "${commit_parts[1]}" == "$origin_commit" ]] \
      || die "market-map preflight commit is not based on the current origin/main"
  else
    [[ "$origin_commit" == "$COMMIT" ]] || die "market-map origin/main does not equal COMMIT"
  fi

  artifact="${TICKET_RUNNER_ARTIFACT_DIR:-}"
  manifest="${TICKET_RUNNER_ARTIFACT_MANIFEST:-}"
  artifact_digest="${TICKET_RUNNER_ARTIFACT_SHA256:-}"
  [[ -n "$artifact" && -n "$manifest" && -n "$artifact_digest" ]] \
    || die "sealed artifact path, manifest, and digest are required"
  validate_local_artifact "$artifact" "$manifest" "$artifact_digest"

  if (( PREFLIGHT_ONLY == 0 )); then
    if query_remote_deployment_status "$COMMIT"; then
      DEPLOYMENT_CONFIRMED=1
      log "Market-map production already reports commit ${COMMIT}; no upload is needed"
      return 0
    else
      preflight_status=$?
    fi
    if (( preflight_status == 75 )); then
      deployment_status_unknown "could not establish the market-map production marker before deployment"
    fi
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  short_commit="${COMMIT:0:7}"
  ticket_component="${TICKET_RUNNER_TICKET_ID:-manual}"
  [[ "$ticket_component" =~ ^[0-9]{1,18}$ ]] || ticket_component="manual"
  REMOTE_UPLOAD_NAME="${timestamp}-${short_commit}-${ticket_component}-$$"
  REMOTE_UPLOAD="${REMOTE_UPLOAD_ROOT}/${REMOTE_UPLOAD_NAME}"

  trap cleanup_remote_upload EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  REMOTE_PREPARED=1
  log "Preparing root-owned market-map upload for ${COMMIT}"
  ssh_remote prepare "$COMMIT" "$REMOTE_UPLOAD" >/dev/null

  rsync_shell="${SSH_BIN} -F /dev/null -i ${SSH_KEY} -o BatchMode=yes -o ClearAllForwardings=yes -o IdentitiesOnly=yes -o RequestTTY=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o LogLevel=ERROR"
  log "Transferring the sealed market-map source artifact"
  "$RSYNC_BIN" \
    --recursive \
    --links \
    --times \
    --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= \
    --delete-delay \
    --delay-updates \
    --safe-links \
    --rsh="$rsync_shell" \
    -- "$artifact/" "${REMOTE_HOST}:${REMOTE_UPLOAD_NAME}/artifact/"

  if (( PREFLIGHT_ONLY == 1 )); then
    log "Requesting server-side market-map validation before publication"
    output="$(ssh_remote validate "$REMOTE_UPLOAD" "$COMMIT")" \
      || die "server-side market-map preflight rejected the sealed artifact"
    [[ "$output" == "market-map-valid ${COMMIT}" ]] \
      || die "server-side market-map preflight returned an invalid success marker"
    printf 'preflight-ok\n'
    return 0
  fi

  log "Requesting market-map deployment through the forced-command SSH gate"
  if ssh_remote deploy "$REMOTE_UPLOAD" "$COMMIT"; then
    deploy_transport_status=0
  else
    deploy_transport_status=$?
    log "Deploy transport returned ${deploy_transport_status}; querying the immutable production marker"
  fi
  if confirm_remote_deployment "$COMMIT"; then
    confirmation_status=0
  else
    confirmation_status=$?
  fi
  if (( confirmation_status == 75 )); then
    deployment_status_unknown "could not establish the market-map marker after deploy transport status ${deploy_transport_status}"
  fi
  if (( confirmation_status == 3 )); then
    printf 'DEPLOYMENT_NOT_DEPLOYED\n' >&2
    exit 3
  fi
  if (( confirmation_status != 0 )); then
    deployment_status_unknown "unexpected market-map status ${confirmation_status} after deploy transport status ${deploy_transport_status}"
  fi
  DEPLOYMENT_CONFIRMED=1
  log "Market-map deployment marker confirms ${COMMIT}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
