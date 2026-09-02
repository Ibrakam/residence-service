#!/usr/bin/env bash

set -Eeuo pipefail
umask 0077

readonly REMOTE_HOST="root@46.62.227.229"
readonly SSH_BIN="/usr/bin/ssh"
readonly RSYNC_BIN="/usr/bin/rsync"
readonly NODE_BIN="/usr/local/bin/node"
readonly SSH_KEY="/Users/ibragimkadamzanov/.ssh/id_ed25519"
readonly KNOWN_HOSTS="/Users/ibragimkadamzanov/.ssh/known_hosts"
readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/residence-service.git"
readonly REMOTE_REPOSITORY="/srv/residence-deploy/repository"
readonly REMOTE_WORKTREE_ROOT="/srv/residence-deploy/worktrees"
readonly REMOTE_DEPLOYER="/usr/local/sbin/deploy-residence-root"
readonly REMOTE_LINK_DEST="/var/www/residence-service/root-current/frontend"

LOCAL_WORKTREE=""
COMMIT=""
REMOTE_WORKTREE=""
REMOTE_PREPARED=0

readonly -a SSH_OPTIONS=(
  -i "$SSH_KEY"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
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

With no arguments, WORKTREE and COMMIT are read from TICKET_RUNNER_WORKTREE
and TICKET_RUNNER_COMMIT_SHA. The script accepts no remote host override.
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command is unavailable: $1"
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
    ssh_remote bash -s -- "$REMOTE_WORKTREE" <<'REMOTE_CLEANUP'
set -Eeuo pipefail
umask 0027

readonly repository="/srv/residence-deploy/repository"
readonly worktree_root="/srv/residence-deploy/worktrees"
readonly repository_lock="/run/lock/residence-root-remote-worktree.lock"
readonly worktree="$1"

case "$worktree" in
  "${worktree_root}"/*) ;;
  *)
    printf 'Refusing unsafe cleanup path: %s\n' "$worktree" >&2
    exit 1
    ;;
esac
[[ "$(dirname -- "$worktree")" == "$worktree_root" ]] || {
  printf 'Cleanup path is not a direct child of %s\n' "$worktree_root" >&2
  exit 1
}
exec 8>"$repository_lock"
flock -w 120 8 || {
  printf 'Timed out waiting for remote repository lock\n' >&2
  exit 1
}
if [[ -d "$repository/.git" ]]; then
  git -C "$repository" worktree remove --force -- "$worktree" 2>/dev/null || true
fi
if [[ -e "$worktree" || -L "$worktree" ]]; then
  rm -rf --one-file-system -- "$worktree"
fi
if [[ -d "$repository/.git" ]]; then
  git -C "$repository" worktree prune --expire=now
fi
REMOTE_CLEANUP
    cleanup_status=$?
    if (( cleanup_status != 0 )); then
      log "CRITICAL: remote worktree cleanup failed; remove only this exact path manually: ${REMOTE_WORKTREE}"
    fi
  fi

  if (( original_status != 0 )); then
    exit "$original_status"
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
  ssh_remote bash -s -- "$COMMIT" "$REMOTE_WORKTREE" <<'REMOTE_PREPARE'
set -Eeuo pipefail
umask 0027

readonly expected_origin="https://github.com/Ibrakam/residence-service.git"
readonly repository="/srv/residence-deploy/repository"
readonly deployment_root="/srv/residence-deploy"
readonly worktree_root="/srv/residence-deploy/worktrees"
readonly repository_lock="/run/lock/residence-root-remote-worktree.lock"
readonly commit="$1"
readonly worktree="$2"

[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || {
  printf 'Invalid deployment commit\n' >&2
  exit 1
}
case "$worktree" in
  "${worktree_root}"/*) ;;
  *)
    printf 'Invalid remote worktree path\n' >&2
    exit 1
    ;;
esac
[[ "$(dirname -- "$worktree")" == "$worktree_root" ]] || {
  printf 'Remote worktree must be a direct child of its fixed root\n' >&2
  exit 1
}
[[ ! -e "$worktree" && ! -L "$worktree" ]] || {
  printf 'Remote worktree already exists\n' >&2
  exit 1
}

install -d -o root -g root -m 0750 "$deployment_root" "$worktree_root"
exec 8>"$repository_lock"
flock -w 120 8 || {
  printf 'Timed out waiting for remote repository lock\n' >&2
  exit 1
}
if [[ ! -d "$repository/.git" ]]; then
  [[ ! -e "$repository" && ! -L "$repository" ]] || {
    printf 'Unexpected object at trusted repository path\n' >&2
    exit 1
  }
  GIT_TERMINAL_PROMPT=0 git clone --quiet --no-checkout "$expected_origin" "$repository"
fi

[[ "$(stat -c '%u' "$repository")" == "0" ]] || {
  printf 'Trusted repository is not root-owned\n' >&2
  exit 1
}
repository_mode="$(stat -c '%a' "$repository")"
(( (8#$repository_mode & 0022) == 0 )) || {
  printf 'Trusted repository is writable by group or others\n' >&2
  exit 1
}
[[ "$(git -C "$repository" remote get-url origin)" == "$expected_origin" ]] || {
  printf 'Trusted repository origin mismatch\n' >&2
  exit 1
}

GIT_TERMINAL_PROMPT=0 git -C "$repository" fetch --quiet --prune --no-tags origin \
  '+refs/heads/main:refs/remotes/origin/main'
origin_commit="$(git -C "$repository" rev-parse --verify 'refs/remotes/origin/main^{commit}')"
[[ "$origin_commit" == "$commit" ]] || {
  printf 'Remote origin/main does not match requested commit\n' >&2
  exit 1
}
git -C "$repository" cat-file -e "${commit}^{commit}"
git -C "$repository" worktree prune --expire=now
git -C "$repository" worktree add --quiet --detach "$worktree" "$commit"

[[ "$(stat -c '%u' "$worktree")" == "0" ]] || {
  printf 'Created worktree is not root-owned\n' >&2
  exit 1
}
install -d -o root -g root -m 0755 "$worktree/website/dist"
install -d -o residence-frontend -g residence-frontend -m 0750 \
  "$worktree/website/dist/standalone"
REMOTE_PREPARE
}

main() {
  local supplied_worktree supplied_commit top_level head_commit origin_url origin_commit
  local artifact manifest artifact_digest timestamp short_commit ticket_component rsync_shell key_mode

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
  COMMIT="$(printf '%s' "$supplied_commit" | tr '[:upper:]' '[:lower:]')"

  for command in date find git id realpath stat "$RSYNC_BIN" "$SSH_BIN" "$NODE_BIN" tr; do
    require_command "$command"
  done
  [[ -f "$SSH_KEY" && ! -L "$SSH_KEY" ]] || die "fixed SSH identity is missing or is a symlink"
  [[ -f "$KNOWN_HOSTS" && ! -L "$KNOWN_HOSTS" ]] || die "fixed known_hosts file is missing or is a symlink"
  key_mode="$(stat -f '%Lp' "$SSH_KEY")"
  (( (8#$key_mode & 0077) == 0 )) || die "fixed SSH identity must not be accessible by group or others"

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

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  short_commit="${COMMIT:0:7}"
  ticket_component="${TICKET_RUNNER_TICKET_ID:-manual}"
  [[ "$ticket_component" =~ ^[0-9]{1,18}$ ]] || ticket_component="manual"
  REMOTE_WORKTREE="${REMOTE_WORKTREE_ROOT}/${timestamp}-${short_commit}-${ticket_component}-$$"

  trap cleanup_remote_worktree EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  log "Preparing root-owned remote worktree at ${COMMIT}"
  # Cleanup is safe even if preparation stops halfway through, because the
  # path is generated locally and the remote cleanup revalidates its fixed root.
  REMOTE_PREPARED=1
  prepare_remote_worktree

  # macOS openrsync does not implement --chown. Add it to the fixed remote
  # rsync command instead; matching ownership also permits safe hard-link reuse
  # from the current immutable frontend release.
  rsync_shell="${SSH_BIN} -i ${SSH_KEY} -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS} -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o LogLevel=ERROR"
  log "Transferring the prebuilt standalone artifact"
  "$RSYNC_BIN" \
    --archive \
    --delete-delay \
    --delay-updates \
    --safe-links \
    --link-dest="$REMOTE_LINK_DEST" \
    --rsync-path="/usr/bin/rsync --chown=residence-frontend:residence-frontend" \
    --rsh="$rsync_shell" \
    -- "$artifact/" "${REMOTE_HOST}:${REMOTE_WORKTREE}/website/dist/standalone/"

  log "Invoking the fixed server-side deployment gate"
  ssh_remote "$REMOTE_DEPLOYER" "$REMOTE_WORKTREE" "$COMMIT"
  log "Remote deployment completed for ${COMMIT}"
}

trap cleanup_remote_worktree EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

main "$@"
