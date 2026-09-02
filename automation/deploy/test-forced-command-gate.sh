#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
readonly GATE="${TEST_DIR}/residence-ticket-deploy-gate.sh"
readonly WRAPPER="${TEST_DIR}/deploy-residence-root-remote.sh"
readonly AUTHORIZED_KEYS_EXAMPLE="${TEST_DIR}/ssh/tencorp-ticket-deploy.authorized_keys.example"
readonly TEST_COMMIT="0123456789abcdef0123456789abcdef01234567"
readonly WORKTREE="/srv/residence-deploy/worktrees/20260902T210000Z-0123456-123-999"
readonly WORKTREE_NAME="${WORKTREE##*/}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

expect_valid() {
  local expected="$1"
  local command="$2"
  local output

  output="$(bash "$GATE" --validate-only "$command")" || fail "expected valid command: $command"
  [[ "$output" == "$expected" ]] || fail "unexpected parser result for: $command"
}

expect_invalid() {
  local command="$1"

  if bash "$GATE" --validate-only "$command" >/dev/null 2>&1; then
    fail "expected command rejection: $command"
  fi
}

bash -n "$GATE"
bash -n "$WRAPPER"

expect_valid prepare "prepare ${TEST_COMMIT} ${WORKTREE}"
expect_valid deploy "deploy ${WORKTREE} ${TEST_COMMIT}"
expect_valid status "status ${TEST_COMMIT}"
expect_valid cleanup "cleanup ${WORKTREE}"
expect_valid rsync "rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . ${WORKTREE_NAME}/website/dist/standalone/"

expect_invalid ""
expect_invalid "bash -s"
expect_invalid "status ${TEST_COMMIT};id"
expect_invalid $'status 0123456789abcdef0123456789abcdef01234567\nid'
expect_invalid "status ABCDEF456789abcdef0123456789abcdef01234567"
expect_invalid "prepare ${TEST_COMMIT} /srv/residence-deploy/worktrees/../repository"
expect_invalid "prepare ${TEST_COMMIT} /srv/residence-deploy/worktrees-not/${WORKTREE_NAME}"
expect_invalid "prepare ${TEST_COMMIT} /srv/residence-deploy/worktrees/20260902T210000Z-fffffff-123-999"
expect_invalid "deploy ${TEST_COMMIT} ${WORKTREE}"
expect_invalid "cleanup /srv/residence-deploy/worktrees"
expect_invalid "rsync --server --sender -r . ${WORKTREE_NAME}/website/dist/standalone/"
expect_invalid "rsync --server --delete-delay -l -r -t --log-file=/tmp/out --dirs --delay-updates --safe-links . ${WORKTREE_NAME}/website/dist/standalone/"
expect_invalid "rsync --server --delete-delay -g -l -o -p -D -r -t --dirs --delay-updates --safe-links . ${WORKTREE_NAME}/website/dist/standalone/"
expect_invalid "rsync --server -r . ../repository/"
expect_invalid "rsync --server -r . ${WORKTREE_NAME}/website/dist/standalone/;id"

grep -Fqx 'restrict,command="/usr/local/sbin/residence-ticket-deploy-gate" ssh-ed25519 REPLACE_WITH_DEDICATED_PUBLIC_KEY tencorp-ticket-deploy' \
  "$AUTHORIZED_KEYS_EXAMPLE" || fail "authorized_keys example is not a restrict+forced-command entry"
grep -Fq 'readonly SSH_KEY="/Users/ibragimkadamzanov/.ssh/tencorp_ticket_deploy_ed25519"' "$WRAPPER" \
  || fail "wrapper does not pin the dedicated key"
if grep -Fq 'LEGACY_ROOT_SSH_KEY' "$WRAPPER"; then
  fail "wrapper must not read the personal root private key"
fi
grep -Fq -- '-F /dev/null' "$WRAPPER" || fail "wrapper does not ignore caller-controlled SSH configuration"
grep -Fq 'DEPLOYMENT_STATUS_UNKNOWN:' "$WRAPPER" || fail "wrapper has no machine-readable ambiguous-status marker"
if grep -Eq 'ssh_remote[[:space:]]+(bash|sh)|bash -s|--rsync-path|--link-dest' "$WRAPPER"; then
  fail "wrapper still exposes a remote shell or unrestricted rsync option"
fi
grep -Fq 'ssh_remote cleanup "$REMOTE_WORKTREE"' "$WRAPPER" || fail "cleanup is not routed through the gate"
grep -Fq 'ssh_remote status "$commit"' "$WRAPPER" || fail "deployment status is not routed through the gate"
grep -Fq 'exec "$RSYNC" \' "$GATE" || fail "gate does not exec the fixed write-side rsync server"
grep -Fq 'target="${worktree_name}/website/dist/standalone/"' "$GATE" \
  || fail "gate does not reconstruct the exact standalone upload target"
grep -Fq 'exec "$DEPLOYER" "$worktree" "$commit"' "$GATE" || fail "gate does not exec the fixed deployer"
grep -Fq "readonly RSYNC_COMMAND_PREFIX='rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . '" "$GATE" \
  || fail "gate does not pin the exact least-privilege rsync wire command"
if grep -Eq -- '--archive| -D([[:space:]]|$)|--devices|--specials|--owner|--group' "$WRAPPER"; then
  fail "upload wrapper requests unnecessary ownership or special-file rsync capabilities"
fi

(
  # Source without running main, then replace the network query to verify that
  # transient failures are accepted only after an exact deployed marker.
  source "$WRAPPER"
  calls=0
  query_remote_deployment_status() {
    calls=$((calls + 1))
    case "$calls" in
      1) return 75 ;;
      2) return 3 ;;
      *) return 0 ;;
    esac
  }
  confirm_remote_deployment "$TEST_COMMIT" 3 0 || fail "confirmation did not recover after transient status failures"
  [[ "$calls" == "3" ]] || fail "confirmation used an unexpected retry count"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 3; }
  set +e
  confirm_remote_deployment "$TEST_COMMIT" 2 0
  status=$?
  set -e
  [[ "$status" == "3" ]] || fail "confirmed not-deployed state did not remain distinguishable"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 0; }
  [[ "$(status_only "$TEST_COMMIT")" == "deployed" ]] || fail "status mode did not emit exact deployed output"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 3; }
  set +e
  output="$(status_only "$TEST_COMMIT")"
  status=$?
  set -e
  [[ "$status" == "3" && "$output" == "not-deployed" ]] || fail "status mode did not preserve exact not-deployed contract"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 75; }
  set +e
  output="$(status_only "$TEST_COMMIT" 2>&1)"
  status=$?
  set -e
  [[ "$status" == "75" && "$output" == *'DEPLOYMENT_STATUS_UNKNOWN'* ]] || fail "status mode did not preserve unknown contract"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 75; }
  set +e
  confirm_remote_deployment "$TEST_COMMIT" 2 0
  status=$?
  set -e
  [[ "$status" == "75" ]] || fail "unknown deployment state did not remain distinguishable"
)

(
  source "$WRAPPER"
  set +e
  output="$(deployment_status_unknown 'test ambiguity' 2>&1)"
  status=$?
  set -e
  [[ "$status" == "75" ]] || fail "unknown deployment state did not use EX_TEMPFAIL"
  [[ "$output" == *'DEPLOYMENT_STATUS_UNKNOWN'* ]] || fail "unknown deployment state did not emit its machine marker"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 1; }
  if confirm_remote_deployment "$TEST_COMMIT" 1 0; then
    fail "confirmation accepted an unconfirmed deployment marker"
  fi
)

# Execute the actual wrapper entrypoint end-to-end with fixed local stubs. This
# covers the machine contract across preflight status, prepare, rsync, a failed
# deploy transport, authoritative negative status, and trap cleanup instead of
# testing only a sourced helper function.
integration_root="$(mktemp -d)"
trap '/bin/chmod -R u+w -- "$integration_root" 2>/dev/null || true; /bin/rm -rf -- "$integration_root"' EXIT
integration_bin="${integration_root}/bin"
integration_remote="${integration_root}/remote.git"
integration_worktree="${integration_root}/worktree"
integration_seal="${integration_root}/seal"
mkdir -p "$integration_bin" "$integration_seal/standalone/dist/client"

cat > "$integration_bin/ssh" <<'STUB_SSH'
#!/bin/bash
for argument in "$@"; do
  case "$argument" in
    status) printf 'not-deployed\n'; exit 3 ;;
    prepare) printf 'prepared\n'; exit 0 ;;
    deploy) exit 7 ;;
    cleanup) printf 'cleaned\n'; exit 0 ;;
  esac
done
exit 64
STUB_SSH
cat > "$integration_bin/rsync" <<'STUB_RSYNC'
#!/bin/sh
exit 0
STUB_RSYNC
cat > "$integration_bin/ssh-keygen" <<'STUB_KEYGEN'
#!/bin/sh
printf 'ssh-ed25519 AAAATESTDEDICATEDKEYFORWRAPPERCONTRACT residence-ticket-deploy\n'
STUB_KEYGEN
chmod 0700 "$integration_bin/ssh" "$integration_bin/rsync" "$integration_bin/ssh-keygen"

printf 'test-only-private-key\n' > "$integration_root/deploy-key"
printf 'ssh-ed25519 AAAATESTLEGACYKEYFORWRAPPERCONTRACT\n' > "$integration_root/legacy-key.pub"
printf 'test.example ssh-ed25519 AAAATESTHOSTKEY\n' > "$integration_root/known-hosts"
chmod 0600 "$integration_root/deploy-key" "$integration_root/legacy-key.pub" "$integration_root/known-hosts"

git init --bare --quiet "$integration_remote"
git init --quiet "$integration_worktree"
mkdir -p "$integration_worktree/website"
printf 'fixture\n' > "$integration_worktree/website/fixture.txt"
git -C "$integration_worktree" add website/fixture.txt
git -C "$integration_worktree" -c user.name=Fixture -c user.email=fixture@example.test commit --quiet -m fixture
git -C "$integration_worktree" branch -M main
git -C "$integration_worktree" remote add origin "$integration_remote"
git -C "$integration_worktree" push --quiet origin main
integration_commit="$(git -C "$integration_worktree" rev-parse HEAD)"

printf 'process.exit(0);\n' > "$integration_seal/standalone/server.js"
printf '{}\n' > "$integration_seal/standalone/package.json"
printf '{"schemaVersion":2,"packages":[]}\n' > "$integration_seal/standalone/STANDALONE_RUNTIME.json"
find "$integration_seal/standalone" -type d -exec chmod 0555 {} +
find "$integration_seal/standalone" -type f -exec chmod 0444 {} +
integration_digest="$(/usr/local/bin/node - "$integration_seal/standalone" "$integration_seal/manifest.json" <<'MANIFEST_NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [root, manifestPath] = process.argv.slice(2);
const entries = [];
function visit(directory, relativeDirectory = "") {
  for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, child.name);
    const relative = path.posix.join(relativeDirectory, child.name);
    const stat = fs.lstatSync(absolute);
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      entries.push({ path: relative, type: "directory", mode });
      visit(absolute, relative);
    } else {
      const bytes = fs.readFileSync(absolute);
      entries.push({ path: relative, type: "file", mode, size: stat.size, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
    }
  }
}
visit(root);
const raw = JSON.stringify({ schemaVersion: 1, entries });
fs.writeFileSync(manifestPath, raw, { mode: 0o400 });
process.stdout.write(crypto.createHash("sha256").update(raw).digest("hex"));
MANIFEST_NODE
)"
chmod 0500 "$integration_seal"

integration_wrapper="$integration_root/deploy-residence-root-remote"
sed \
  -e "s|readonly REMOTE_HOST=.*|readonly REMOTE_HOST=\"test@example\"|" \
  -e "s|readonly SSH_BIN=.*|readonly SSH_BIN=\"${integration_bin}/ssh\"|" \
  -e "s|readonly RSYNC_BIN=.*|readonly RSYNC_BIN=\"${integration_bin}/rsync\"|" \
  -e "s|readonly NODE_BIN=.*|readonly NODE_BIN=\"/usr/local/bin/node\"|" \
  -e "s|readonly SSH_KEY=.*|readonly SSH_KEY=\"${integration_root}/deploy-key\"|" \
  -e "s|readonly LEGACY_ROOT_PUBLIC_KEY=.*|readonly LEGACY_ROOT_PUBLIC_KEY=\"${integration_root}/legacy-key.pub\"|" \
  -e "s|readonly SSH_KEYGEN_BIN=.*|readonly SSH_KEYGEN_BIN=\"${integration_bin}/ssh-keygen\"|" \
  -e "s|readonly KNOWN_HOSTS=.*|readonly KNOWN_HOSTS=\"${integration_root}/known-hosts\"|" \
  -e "s|readonly EXPECTED_ORIGIN=.*|readonly EXPECTED_ORIGIN=\"${integration_remote}\"|" \
  -e 's|readonly STATUS_CONFIRM_ATTEMPTS=.*|readonly STATUS_CONFIRM_ATTEMPTS=1|' \
  -e 's|readonly STATUS_CONFIRM_DELAY_SECONDS=.*|readonly STATUS_CONFIRM_DELAY_SECONDS=0|' \
  "$WRAPPER" > "$integration_wrapper"
chmod 0700 "$integration_wrapper"

set +e
integration_output="$(
  TICKET_RUNNER_TICKET_ID=123 \
  TICKET_RUNNER_ARTIFACT_DIR="$integration_seal/standalone" \
  TICKET_RUNNER_ARTIFACT_MANIFEST="$integration_seal/manifest.json" \
  TICKET_RUNNER_ARTIFACT_SHA256="$integration_digest" \
  "$integration_wrapper" "$integration_worktree" "$integration_commit" 2>&1
)"
integration_status=$?
set -e
[[ "$integration_status" == "3" ]] || fail "actual wrapper did not preserve authoritative not-deployed exit 3: $integration_output"
[[ "$(grep -Fxc 'DEPLOYMENT_NOT_DEPLOYED' <<< "$integration_output")" == "1" ]] \
  || fail "actual wrapper did not emit the exact authoritative not-deployed marker once"

printf 'forced-command deploy gate tests passed\n'
