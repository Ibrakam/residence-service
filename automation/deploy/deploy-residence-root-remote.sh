#!/bin/bash

set -Eeuo pipefail
umask 0077

export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin"
export LANG=C
export LC_ALL=C
unset BASH_ENV ENV CDPATH GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY \
  GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_SSH GIT_SSH_COMMAND SSH_ASKPASS

readonly REMOTE_HOST="root@46.62.227.229"
readonly SSH_BIN="/usr/bin/ssh"
readonly RSYNC_BIN="/usr/bin/rsync"
readonly NODE_BIN="/usr/local/bin/node"
readonly SSH_KEY="/Users/ibragimkadamzanov/.ssh/tencorp_ticket_deploy_ed25519"
readonly LEGACY_ROOT_PUBLIC_KEY="/Users/ibragimkadamzanov/.ssh/id_ed25519.pub"
readonly SSH_KEYGEN_BIN="/usr/bin/ssh-keygen"
readonly KNOWN_HOSTS="/Users/ibragimkadamzanov/.ssh/known_hosts"
readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/residence-service.git"
readonly REMOTE_WORKTREE_ROOT="/srv/residence-deploy/worktrees"
readonly STATUS_CONFIRM_ATTEMPTS=6
readonly STATUS_CONFIRM_DELAY_SECONDS=5

LOCAL_WORKTREE=""
COMMIT=""
REMOTE_WORKTREE=""
REMOTE_WORKTREE_NAME=""
REMOTE_PREPARED=0
DEPLOYMENT_CONFIRMED=0

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
  printf '[deploy-residence-root-remote] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Usage: deploy-residence-root-remote.sh [WORKTREE COMMIT]
       deploy-residence-root-remote.sh --status COMMIT

With no arguments, WORKTREE and COMMIT are read from TICKET_RUNNER_WORKTREE
and TICKET_RUNNER_COMMIT_SHA. Status mode performs only a durable production
marker query. The script accepts no remote host override.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
}

validate_ssh_material() {
  local key_mode key_owner known_hosts_mode known_hosts_owner
  local legacy_public_mode legacy_public_owner dedicated_public dedicated_public_raw legacy_public
  local command

  for command in id realpath stat "$SSH_BIN" "$SSH_KEYGEN_BIN"; do
    require_command "$command"
  done
  [[ -f "$SSH_KEY" && ! -L "$SSH_KEY" ]] || die "fixed SSH identity is missing or is a symlink"
  [[ -f "$LEGACY_ROOT_PUBLIC_KEY" && ! -L "$LEGACY_ROOT_PUBLIC_KEY" ]] || die "personal root public-key reference is missing or unsafe"
  [[ -f "$KNOWN_HOSTS" && ! -L "$KNOWN_HOSTS" ]] || die "fixed known_hosts file is missing or is a symlink"
  key_mode="$(stat -f '%Lp' "$SSH_KEY")"
  key_owner="$(stat -f '%u' "$SSH_KEY")"
  [[ "$key_owner" == "$(id -u)" ]] || die "fixed SSH identity must be owned by the runner user"
  (( (8#$key_mode & 0077) == 0 )) || die "fixed SSH identity must not be accessible by group or others"
  known_hosts_mode="$(stat -f '%Lp' "$KNOWN_HOSTS")"
  known_hosts_owner="$(stat -f '%u' "$KNOWN_HOSTS")"
  [[ "$known_hosts_owner" == "$(id -u)" ]] || die "fixed known_hosts file must be owned by the runner user"
  (( (8#$known_hosts_mode & 0022) == 0 )) || die "fixed known_hosts file must not be writable by group or others"
  legacy_public_mode="$(stat -f '%Lp' "$LEGACY_ROOT_PUBLIC_KEY")"
  legacy_public_owner="$(stat -f '%u' "$LEGACY_ROOT_PUBLIC_KEY")"
  [[ "$legacy_public_owner" == "$(id -u)" ]] || die "personal root public-key reference must be owned by the runner user"
  (( (8#$legacy_public_mode & 0022) == 0 )) || die "personal root public-key reference must not be writable by group or others"

  dedicated_public_raw="$(SSH_ASKPASS_REQUIRE=never "$SSH_KEYGEN_BIN" -y -P '' -f "$SSH_KEY" </dev/null)" \
    || die "fixed SSH identity is unreadable, encrypted, or invalid"
  # OpenSSH may preserve the private key comment in `ssh-keygen -y` output.
  # Compare only the canonical key type and base64 payload.
  dedicated_public="$(printf '%s\n' "$dedicated_public_raw" | /usr/bin/awk 'NF >= 2 { print $1 " " $2; exit }')"
  [[ "$dedicated_public" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || die "fixed SSH identity must be Ed25519"
  legacy_public="$(/usr/bin/awk 'NF >= 2 { print $1 " " $2; exit }' "$LEGACY_ROOT_PUBLIC_KEY")"
  [[ "$legacy_public" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+$ ]] || die "personal root public-key reference is malformed"
  [[ "$dedicated_public" != "$legacy_public" ]] || die "dedicated deploy identity duplicates the personal root SSH key"
}

ssh_remote() {
  "$SSH_BIN" "${SSH_OPTIONS[@]}" "$REMOTE_HOST" "$@"
}

cleanup_remote_worktree() {
  local original_status=$?
  local cleanup_status=0

  trap - EXIT INT TERM
  set +e
  if (( REMOTE_PREPARED == 1 )); then
    log "Removing exact remote worktree ${REMOTE_WORKTREE}"
    ssh_remote cleanup "$REMOTE_WORKTREE"
    cleanup_status=$?
    if (( cleanup_status != 0 )); then
      log "CRITICAL: remote worktree cleanup failed; remove only this exact path manually: ${REMOTE_WORKTREE}"
    fi
  fi

  if (( original_status != 0 )); then
    exit "$original_status"
  fi
  if (( DEPLOYMENT_CONFIRMED == 1 )); then
    # A cleanup transport failure after a confirmed atomic deployment must not
    # be misreported upstream as a failed deployment (which could roll back
    # source main while production is already on the new commit).
    exit 0
  fi
  exit "$cleanup_status"
}

validate_local_artifact() {
  local artifact="$1"
  local manifest="$2"
  local expected_digest="$3"
  local canonical_artifact canonical_manifest sensitive_entry link resolved artifact_owner artifact_mode

  [[ -f "$artifact/server.js" ]] || die "standalone server.js is missing"
  [[ -f "$artifact/package.json" ]] || die "standalone package.json is missing"
  [[ -f "$artifact/STANDALONE_RUNTIME.json" ]] || die "STANDALONE_RUNTIME.json is missing"
  [[ -d "$artifact/dist/client" ]] || die "standalone dist/client directory is missing"

  canonical_artifact="$(realpath "$artifact")"
  canonical_manifest="$(realpath "$manifest")"
  case "$canonical_artifact" in
    "${LOCAL_WORKTREE}"/*) die "standalone artifact must be a verifier-owned seal outside the worktree" ;;
  esac
  case "$canonical_manifest" in
    "$(dirname "$canonical_artifact")"/*) ;;
    *) die "artifact manifest is not colocated with the sealed artifact" ;;
  esac
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
const expected = new Map();
for (const entry of manifest.entries) {
  if (!entry || typeof entry.path !== "string" || entry.path === "" || path.posix.isAbsolute(entry.path)
      || path.posix.normalize(entry.path) !== entry.path || entry.path.startsWith("../") || /[\0\r\n]/.test(entry.path)
      || expected.has(entry.path)) throw new Error("unsafe or duplicate sealed manifest path");
  expected.set(entry.path, entry);
}
const seen = new Set();
function fileHash(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}
function visit(directory, relativeDirectory = "") {
  const children = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    const relative = path.posix.join(relativeDirectory.split(path.sep).join("/"), child.name);
    const stat = fs.lstatSync(absolute);
    const entry = expected.get(relative);
    if (!entry) throw new Error(`unmanifested artifact entry: ${relative}`);
    seen.add(relative);
    if ((stat.mode & 0o7777) !== entry.mode) throw new Error(`artifact mode changed: ${relative}`);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      if (entry.type !== "directory") throw new Error(`artifact type changed: ${relative}`);
      visit(absolute, relative);
    } else if (stat.isFile() && !stat.isSymbolicLink()) {
      if (entry.type !== "file" || stat.size !== entry.size || fileHash(absolute) !== entry.sha256) throw new Error(`artifact file changed: ${relative}`);
    } else if (stat.isSymbolicLink()) {
      if (entry.type !== "symlink" || fs.readlinkSync(absolute) !== entry.target) throw new Error(`artifact symlink changed: ${relative}`);
      const resolved = fs.realpathSync(absolute);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`artifact symlink escapes: ${relative}`);
    } else {
      throw new Error(`unsupported artifact entry: ${relative}`);
    }
  }
}
visit(root);
if (seen.size !== expected.size) throw new Error("sealed artifact entries are missing");
VERIFY_SEAL

  sensitive_entry="$(find "$artifact" -type f \( \
    -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' -o \
    -name '*.p12' -o -name '*.pfx' \
  \) -print -quit)"
  [[ -z "$sensitive_entry" ]] || die "artifact contains a forbidden secret-like file: $sensitive_entry"

  while IFS= read -r -d '' link; do
    resolved="$(realpath "$link" 2>/dev/null || true)"
    [[ -n "$resolved" && -e "$resolved" ]] || die "artifact contains a dangling symlink: $link"
    case "$resolved" in
      "${canonical_artifact}"/*) ;;
      *) die "artifact symlink escapes standalone root: $link" ;;
    esac
  done < <(find "$artifact" -type l -print0)
}

prepare_remote_worktree() {
  ssh_remote prepare "$COMMIT" "$REMOTE_WORKTREE"
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

  if (( transport_status == 0 )) && [[ "$output" == "deployed ${commit}" ]]; then
    return 0
  fi
  if (( transport_status == 3 )) && [[ "$output" == "not-deployed" ]]; then
    return 3
  fi

  log "Remote status query was not authoritative (transport status ${transport_status})"
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
  deployment_status_unknown "could not establish the production marker for ${commit}"
}

main() {
  local supplied_worktree supplied_commit top_level head_commit origin_url origin_commit
  local artifact manifest artifact_digest timestamp short_commit ticket_component rsync_shell
  local deploy_transport_status=0 preflight_status confirmation_status

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

  if (( $# == 0 )); then
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

  for command in date find git id realpath stat "$RSYNC_BIN" "$SSH_BIN" "$NODE_BIN" tr; do
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
  [[ "$origin_url" == "$EXPECTED_ORIGIN" ]] || die "local origin is not the fixed trusted repository"

  log "Refreshing local origin/main for provenance validation"
  GIT_TERMINAL_PROMPT=0 git -C "$LOCAL_WORKTREE" fetch --quiet --no-tags origin \
    '+refs/heads/main:refs/remotes/origin/main'
  origin_commit="$(git -C "$LOCAL_WORKTREE" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
  [[ "$origin_commit" == "$COMMIT" ]] || die "local origin/main does not equal COMMIT"

  artifact="${TICKET_RUNNER_ARTIFACT_DIR:-}"
  manifest="${TICKET_RUNNER_ARTIFACT_MANIFEST:-}"
  artifact_digest="${TICKET_RUNNER_ARTIFACT_SHA256:-}"
  [[ -n "$artifact" && -n "$manifest" && -n "$artifact_digest" ]] || die "sealed artifact path, manifest, and digest are required"
  validate_local_artifact "$artifact" "$manifest" "$artifact_digest"

  # A retry after a lost SSH acknowledgement is idempotent: the immutable
  # production marker is authoritative, not the prior transport exit code.
  if query_remote_deployment_status "$COMMIT"; then
    DEPLOYMENT_CONFIRMED=1
    log "Remote production already reports commit ${COMMIT}; no upload is needed"
    return 0
  else
    preflight_status=$?
  fi
  if (( preflight_status == 75 )); then
    deployment_status_unknown "could not establish the production marker before deployment"
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  short_commit="${COMMIT:0:7}"
  ticket_component="${TICKET_RUNNER_TICKET_ID:-manual}"
  [[ "$ticket_component" =~ ^[0-9]{1,18}$ ]] || ticket_component="manual"
  REMOTE_WORKTREE_NAME="${timestamp}-${short_commit}-${ticket_component}-$$"
  REMOTE_WORKTREE="${REMOTE_WORKTREE_ROOT}/${REMOTE_WORKTREE_NAME}"

  trap cleanup_remote_worktree EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  log "Preparing root-owned remote worktree at ${COMMIT}"
  # Cleanup is safe even if preparation stops halfway through, because the
  # path is generated locally and the remote cleanup revalidates its fixed root.
  REMOTE_PREPARED=1
  prepare_remote_worktree

  rsync_shell="${SSH_BIN} -F /dev/null -i ${SSH_KEY} -o BatchMode=yes -o ClearAllForwardings=yes -o IdentitiesOnly=yes -o RequestTTY=no -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o LogLevel=ERROR"
  log "Transferring the prebuilt standalone artifact"
  "$RSYNC_BIN" \
    --recursive \
    --links \
    --times \
    --chmod=Du=rwx,Dgo=,Fu=rw,Fgo= \
    --delete-delay \
    --delay-updates \
    --safe-links \
    --rsh="$rsync_shell" \
    -- "$artifact/" "${REMOTE_HOST}:${REMOTE_WORKTREE_NAME}/website/dist/standalone/"

  log "Requesting deployment through the forced-command SSH gate"
  if ssh_remote deploy "$REMOTE_WORKTREE" "$COMMIT"; then
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
    deployment_status_unknown "could not establish the production marker after deploy transport status ${deploy_transport_status}"
  fi
  if (( confirmation_status == 3 )); then
    # This is the only failure contract that authorizes the local runner to
    # roll origin/main back. Keep the marker and exit code machine-exact.
    printf 'DEPLOYMENT_NOT_DEPLOYED\n' >&2
    exit 3
  fi
  if (( confirmation_status != 0 )); then
    deployment_status_unknown "unexpected production status ${confirmation_status} after deploy transport status ${deploy_transport_status}"
  fi
  DEPLOYMENT_CONFIRMED=1
  log "Remote deployment marker confirms ${COMMIT}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  trap cleanup_remote_worktree EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  main "$@"
fi
