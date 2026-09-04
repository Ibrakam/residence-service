#!/usr/bin/env bash

set -Eeuo pipefail

readonly TEST_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
readonly GATE="${TEST_DIR}/tencorp-market-map-deploy-gate.sh"
readonly WRAPPER="${TEST_DIR}/deploy-market-map-remote.sh"
readonly DEPLOYER="${TEST_DIR}/deploy-tencorp-market-map.sh"
readonly HTML_VALIDATOR="${TEST_DIR}/validate-market-map-html.py"
readonly AUTHORIZED_KEYS_EXAMPLE="${TEST_DIR}/ssh/tencorp-market-map-deploy.authorized_keys.example"
readonly TEST_COMMIT="0123456789abcdef0123456789abcdef01234567"
readonly UPLOAD="/srv/tencorp-market-map-deploy/uploads/20260904T120000Z-0123456-123-999"
readonly UPLOAD_NAME="${UPLOAD##*/}"

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
bash -n "$DEPLOYER"
PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 "$TEST_DIR/test_validate_market_map_html.py"

expect_valid prepare "prepare ${TEST_COMMIT} ${UPLOAD}"
expect_valid deploy "deploy ${UPLOAD} ${TEST_COMMIT}"
expect_valid validate "validate ${UPLOAD} ${TEST_COMMIT}"
expect_valid status "status ${TEST_COMMIT}"
expect_valid policy "policy"
expect_valid cleanup "cleanup ${UPLOAD}"
expect_valid rsync "rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . ${UPLOAD_NAME}/artifact/"

expect_invalid ""
expect_invalid "bash -s"
expect_invalid "status ${TEST_COMMIT};id"
expect_invalid $'status 0123456789abcdef0123456789abcdef01234567\nid'
expect_invalid "status ABCDEF456789abcdef0123456789abcdef01234567"
expect_invalid "policy extra"
expect_invalid "prepare ${TEST_COMMIT} /srv/tencorp-market-map-deploy/uploads/../repository"
expect_invalid "prepare ${TEST_COMMIT} /srv/tencorp-market-map-deploy/uploads-not/${UPLOAD_NAME}"
expect_invalid "prepare ${TEST_COMMIT} /srv/tencorp-market-map-deploy/uploads/20260904T120000Z-fffffff-123-999"
expect_invalid "deploy ${TEST_COMMIT} ${UPLOAD}"
expect_invalid "validate ${TEST_COMMIT} ${UPLOAD}"
expect_invalid "cleanup /srv/tencorp-market-map-deploy/uploads"
expect_invalid "rsync --server --sender -r . ${UPLOAD_NAME}/artifact/"
expect_invalid "rsync --server --delete-delay -l -r -t --log-file=/tmp/out --dirs --delay-updates --safe-links . ${UPLOAD_NAME}/artifact/"
expect_invalid "rsync --server --delete-delay -g -l -o -p -D -r -t --dirs --delay-updates --safe-links . ${UPLOAD_NAME}/artifact/"
expect_invalid "rsync --server --delete-delay -l -r -t --dirs --delay-updates --safe-links . ${UPLOAD_NAME}/artifact/../"
expect_invalid "rsync --server -r . ../releases/"
expect_invalid "rsync --server -r . ${UPLOAD_NAME}/artifact/;id"

grep -Fqx 'restrict,command="/usr/local/sbin/tencorp-market-map-deploy-gate" ssh-ed25519 REPLACE_WITH_DEDICATED_MARKET_MAP_PUBLIC_KEY tencorp-market-map-deploy' \
  "$AUTHORIZED_KEYS_EXAMPLE" || fail "market-map authorized_keys example is not restrict+forced-command"
grep -Fq 'readonly PROJECT_KEY="market-map"' "$WRAPPER" || fail "wrapper does not pin the project key"
grep -Fq 'readonly EXPECTED_ORIGIN="https://github.com/Ibrakam/tencorp-market-map.git"' "$WRAPPER" \
  || fail "wrapper does not pin the market-map Git origin"
grep -Fq 'readonly SSH_KEY="/Users/ibragimkadamzanov/.ssh/tencorp_market_map_deploy_ed25519"' "$WRAPPER" \
  || fail "wrapper does not pin a separate market-map SSH identity"
grep -Fq -- '-F /dev/null' "$WRAPPER" || fail "wrapper does not ignore caller-controlled SSH configuration"
grep -Fq 'DEPLOYMENT_STATUS_UNKNOWN:' "$WRAPPER" || fail "wrapper has no ambiguous-status marker"
grep -Fq 'market-map-deployed ${commit}' "$WRAPPER" || fail "wrapper does not require the project-specific deployed marker"
grep -Fq 'market-map-not-deployed' "$WRAPPER" || fail "wrapper does not require the project-specific negative marker"
if grep -Eq 'ssh_remote[[:space:]]+(bash|sh)|bash -s|--rsync-path|--link-dest' "$WRAPPER"; then
  fail "wrapper exposes a remote shell or unrestricted rsync option"
fi
grep -Fq 'ssh_remote cleanup "$REMOTE_UPLOAD"' "$WRAPPER" || fail "cleanup is not routed through the market-map gate"
grep -Fq 'ssh_remote status "$commit"' "$WRAPPER" || fail "status is not routed through the market-map gate"
grep -Fq 'ssh_remote policy' "$WRAPPER" || fail "policy version is not routed through the market-map gate"
grep -Fq 'ssh_remote validate "$REMOTE_UPLOAD" "$COMMIT"' "$WRAPPER" \
  || fail "server-side pre-publication validation is not routed through the market-map gate"
grep -Fq 'exec "$RSYNC" \' "$GATE" || fail "gate does not exec fixed write-side rsync"
grep -Fq 'target="${upload_name}/artifact/"' "$GATE" || fail "gate does not reconstruct the exact artifact target"
grep -Fq 'exec "$DEPLOYER" "$upload" "$commit"' "$GATE" || fail "gate does not exec the fixed deployer"
grep -Fq 'exec "$DEPLOYER" --validate-upload "$upload" "$commit"' "$GATE" \
  || fail "gate does not expose fixed server-side pre-publication validation"
grep -Fq 'exec "$DEPLOYER" --policy-version' "$GATE" || fail "gate does not expose the fixed server policy version"
deploy_upload_body="$(sed -n '/^deploy_upload()/,/^}/p' "$GATE")"
case "$deploy_upload_body" in
  *'exec 8>"$UPLOAD_LOCK"'*'"$FLOCK" -w 120 8'*'validate_existing_upload "$upload"'*'exec "$DEPLOYER" "$upload" "$commit"'*) ;;
  *) fail "deploy does not hold the upload lock across validation and every artifact read" ;;
esac
validate_upload_body="$(sed -n '/^validate_upload()/,/^}/p' "$GATE")"
case "$validate_upload_body" in
  *'exec 8>"$UPLOAD_LOCK"'*'"$FLOCK" -w 120 8'*'validate_existing_upload "$upload"'*'exec "$DEPLOYER" --validate-upload "$upload" "$commit"'*) ;;
  *) fail "preflight validation does not hold the upload lock across every artifact read" ;;
esac
grep -Fq 'readonly LIVE_DB="${STATE_DIR}/market_map.db"' "$DEPLOYER" || fail "deployer does not pin the external live database"
grep -Fq 'readonly RELEASES_DIR="${SERVICE_ROOT}/releases"' "$DEPLOYER" || fail "deployer does not pin the release root"
grep -Fq 'readonly SERVICE_UNIT="tencorp-market-map.service"' "$DEPLOYER" || fail "deployer does not pin the service"
grep -Fq 'readonly HTML_VALIDATOR="/usr/local/libexec/tencorp-market-map/validate-market-map-html.py"' "$DEPLOYER" \
  || fail "deployer does not pin the shared HTML validator"
validator_digest="$(/usr/bin/shasum -a 256 "$HTML_VALIDATOR" | /usr/bin/awk '{print $1}')"
grep -Fq "readonly HTML_VALIDATOR_SHA256=\"${validator_digest}\"" "$DEPLOYER" \
  || fail "deployer does not pin the exact shared HTML validator content"
grep -Fq 'readonly YANDEX_API_KEY_FILE="/etc/tencorp-market-map/yandex-maps-api-key"' "$DEPLOYER" \
  || fail "deployer does not pin the operator-owned Yandex API key file"
grep -Fq '"$PYTHON_BIN" "$VALIDATOR_SNAPSHOT" --render' "$DEPLOYER" \
  || fail "deployer does not render the operator-owned Yandex API key into the release"
grep -Fq 'Deployment failed after the current pointer changed; rolling back' "$DEPLOYER" \
  || fail "deployer has no post-switch rollback path"
grep -Fq 'market-map-valid %s\n' "$DEPLOYER" \
  || fail "deployer has no server-side pre-publication success marker"
for endpoint in health meta points; do
  grep -Fq '"${LOOPBACK_ORIGIN}/api/${endpoint}"' "$DEPLOYER" \
    || fail "deployer does not smoke /api/${endpoint}"
done
if grep -Eq '/var/lib/tencorp-market-map.*(rm|mv|install|rsync)|((rm|mv|install|rsync).*/var/lib/tencorp-market-map)' "$DEPLOYER"; then
  fail "deployer appears to mutate the external live state directory"
fi

(
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
  [[ "$calls" == 3 ]] || fail "confirmation used an unexpected retry count"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 3; }
  set +e
  output="$(status_only "$TEST_COMMIT")"
  status=$?
  set -e
  [[ "$status" == 3 && "$output" == "not-deployed" ]] || fail "status-only did not preserve the negative contract"
)

(
  source "$WRAPPER"
  query_remote_deployment_status() { return 0; }
  [[ "$(status_only "$TEST_COMMIT")" == "deployed" ]] || fail "status-only did not preserve the deployed contract"
)

(
  source "$WRAPPER"
  ssh_remote() { printf 'market-map-policy v1 %064d yandex-key-present\n' 0; }
  [[ "$(policy_version_only)" == "market-map-policy v1 $(printf '%064d' 0) yandex-key-present" ]] \
    || fail "policy-version did not preserve the exact server contract"
)

if (
  source "$WRAPPER"
  ssh_remote() { printf 'market-map-policy malformed\n'; }
  policy_version_only
) >/dev/null 2>&1; then
  fail "policy-version accepted a malformed server response"
fi

if (
  source "$WRAPPER"
  unset TICKET_RUNNER_PROJECT_KEY
  validate_project_context
) >/dev/null 2>&1; then
  fail "wrapper accepted a missing project identity"
fi

fixture_root="$(mktemp -d)"
trap '/bin/chmod -R u+w -- "$fixture_root" 2>/dev/null || true; /bin/rm -rf -- "$fixture_root"' EXIT
provider_fixture="${fixture_root}/providers"
mkdir -p "$provider_fixture"
printf '<!doctype html><html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script></body></html>\n' \
  > "${provider_fixture}/leaflet.html"
/usr/bin/python3 "$HTML_VALIDATOR" "${provider_fixture}/leaflet.html" >/dev/null \
  || fail "deployer rejected pinned local Leaflet"
printf '<!doctype html><html><head><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></head><body><script>const ready = true;</script></body></html>\n' \
  > "${provider_fixture}/yandex.html"
/usr/bin/python3 "$HTML_VALIDATOR" "${provider_fixture}/yandex.html" >/dev/null \
  || fail "deployer rejected approved Yandex Maps"
printf '<html><script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU"></script></html>\n' \
  > "${provider_fixture}/yandex-without-key.html"
if /usr/bin/python3 "$HTML_VALIDATOR" "${provider_fixture}/yandex-without-key.html" >/dev/null 2>&1; then
  fail "deployer accepted Yandex Maps without an API key"
fi
printf '<html><script src="https://cdn.example.test/map.js"></script></html>\n' \
  > "${provider_fixture}/unapproved.html"
if /usr/bin/python3 "$HTML_VALIDATOR" "${provider_fixture}/unapproved.html" >/dev/null 2>&1; then
  fail "deployer accepted an unapproved remote script"
fi
printf '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script data-x="<script src=\x27./vendor/leaflet.js\x27>" src="https://evil.example/payload.js" src="./vendor/leaflet.js"></script></html>\n' \
  > "${provider_fixture}/parser-bypass.html"
if /usr/bin/python3 "$HTML_VALIDATOR" "${provider_fixture}/parser-bypass.html" >/dev/null 2>&1; then
  fail "shared validator accepted duplicate script sources through a parser differential"
fi
fixture_worktree="${fixture_root}/worktree"
fixture_seal="${fixture_root}/seal"
fixture_artifact="${fixture_seal}/artifact"
mkdir -p "$fixture_worktree/vendor" "$fixture_artifact/vendor"
printf 'value = 1\n' > "$fixture_worktree/server.py"
printf 'value = 2\n' > "$fixture_worktree/dshk_sync.py"
printf '<!doctype html><html><link href="vendor/leaflet.css"></html>\n' > "$fixture_worktree/leadora_carto_map.html"
printf '{"points": []}\n' > "$fixture_worktree/data.json"
printf '/* css */\n' > "$fixture_worktree/vendor/leaflet.css"
printf '/* js */\n' > "$fixture_worktree/vendor/leaflet.js"
cp -R "$fixture_worktree/server.py" "$fixture_worktree/dshk_sync.py" \
  "$fixture_worktree/leadora_carto_map.html" "$fixture_worktree/data.json" "$fixture_artifact/"
cp -R "$fixture_worktree/vendor/leaflet.css" "$fixture_worktree/vendor/leaflet.js" "$fixture_artifact/vendor/"
git init --quiet "$fixture_worktree"
git -C "$fixture_worktree" add server.py dshk_sync.py leadora_carto_map.html data.json vendor/leaflet.css vendor/leaflet.js
find "$fixture_artifact" -type d -exec chmod 0500 {} +
find "$fixture_artifact" -type f -exec chmod 0400 {} +

fixture_digest="$(/usr/local/bin/node - "$fixture_artifact" "$fixture_seal/manifest.json" <<'MANIFEST_NODE'
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
chmod 0500 "$fixture_seal"

(
  source "$WRAPPER"
  LOCAL_WORKTREE="$fixture_worktree"
  validate_local_artifact "$fixture_artifact" "$fixture_seal/manifest.json" "$fixture_digest"
) || fail "wrapper rejected a valid sealed market-map source artifact"

fixture_remote="${fixture_root}/remote.git"
fixture_bin="${fixture_root}/bin"
mkdir -p "$fixture_bin"
git -C "$fixture_worktree" -c user.name=Fixture -c user.email=fixture@example.test commit --quiet -m fixture
git -C "$fixture_worktree" branch -M main
git init --bare --quiet "$fixture_remote"
git -C "$fixture_worktree" remote add origin "$fixture_remote"
git -C "$fixture_worktree" push --quiet origin main
fixture_base_commit="$(git -C "$fixture_worktree" rev-parse HEAD)"

cat > "${fixture_bin}/ssh" <<'STUB_SSH'
#!/bin/bash
for argument in "$@"; do
  case "$argument" in
    status)
      [ -n "${STUB_SSH_CALL_LOG:-}" ] && printf 'status\n' >> "$STUB_SSH_CALL_LOG"
      [ "${STUB_STATUS_MODE:-}" = unknown ] && exit 75
      printf 'market-map-not-deployed\n'; exit 3
      ;;
    prepare)
      [ -n "${STUB_SSH_CALL_LOG:-}" ] && printf 'prepare\n' >> "$STUB_SSH_CALL_LOG"
      printf 'market-map-prepared\n'; exit 0
      ;;
    validate)
      [ -n "${STUB_SSH_CALL_LOG:-}" ] && printf 'validate\n' >> "$STUB_SSH_CALL_LOG"
      printf 'market-map-valid %s\n' "${@: -1}"; exit 0
      ;;
    deploy)
      [ -n "${STUB_SSH_CALL_LOG:-}" ] && printf 'deploy\n' >> "$STUB_SSH_CALL_LOG"
      exit 7
      ;;
    cleanup)
      [ -n "${STUB_SSH_CALL_LOG:-}" ] && printf 'cleanup\n' >> "$STUB_SSH_CALL_LOG"
      printf 'market-map-cleaned\n'; exit 0
      ;;
  esac
done
exit 64
STUB_SSH
cat > "${fixture_bin}/rsync" <<'STUB_RSYNC'
#!/bin/sh
exit 0
STUB_RSYNC
cat > "${fixture_bin}/ssh-keygen" <<'STUB_KEYGEN'
#!/bin/sh
printf 'ssh-ed25519 AAAATESTMARKETMAPKEYFORWRAPPERCONTRACT tencorp-market-map-deploy\n'
STUB_KEYGEN
chmod 0700 "${fixture_bin}/ssh" "${fixture_bin}/rsync" "${fixture_bin}/ssh-keygen"
printf 'test-only-private-key\n' > "${fixture_root}/deploy-key"
printf 'ssh-ed25519 AAAATESTLEGACYKEYFORWRAPPERCONTRACT\n' > "${fixture_root}/legacy-key.pub"
printf 'test.example ssh-ed25519 AAAATESTHOSTKEY\n' > "${fixture_root}/known-hosts"
chmod 0600 "${fixture_root}/deploy-key" "${fixture_root}/legacy-key.pub" "${fixture_root}/known-hosts"

fixture_wrapper="${fixture_root}/deploy-market-map-remote"
sed \
  -e 's|readonly REMOTE_HOST=.*|readonly REMOTE_HOST="test@example"|' \
  -e "s|readonly SSH_BIN=.*|readonly SSH_BIN=\"${fixture_bin}/ssh\"|" \
  -e "s|readonly RSYNC_BIN=.*|readonly RSYNC_BIN=\"${fixture_bin}/rsync\"|" \
  -e 's|readonly NODE_BIN=.*|readonly NODE_BIN="/usr/local/bin/node"|' \
  -e 's|readonly PYTHON_BIN=.*|readonly PYTHON_BIN="/usr/bin/python3"|' \
  -e "s|readonly SSH_KEY=.*|readonly SSH_KEY=\"${fixture_root}/deploy-key\"|" \
  -e "s|readonly LEGACY_ROOT_PUBLIC_KEY=.*|readonly LEGACY_ROOT_PUBLIC_KEY=\"${fixture_root}/legacy-key.pub\"|" \
  -e "s|readonly SSH_KEYGEN_BIN=.*|readonly SSH_KEYGEN_BIN=\"${fixture_bin}/ssh-keygen\"|" \
  -e "s|readonly KNOWN_HOSTS=.*|readonly KNOWN_HOSTS=\"${fixture_root}/known-hosts\"|" \
  -e "s|readonly EXPECTED_ORIGIN=.*|readonly EXPECTED_ORIGIN=\"${fixture_remote}\"|" \
  -e 's|readonly STATUS_CONFIRM_ATTEMPTS=.*|readonly STATUS_CONFIRM_ATTEMPTS=1|' \
  -e 's|readonly STATUS_CONFIRM_DELAY_SECONDS=.*|readonly STATUS_CONFIRM_DELAY_SECONDS=0|' \
  "$WRAPPER" > "$fixture_wrapper"
chmod 0700 "$fixture_wrapper"

git -C "$fixture_worktree" -c user.name=Fixture -c user.email=fixture@example.test \
  commit --quiet --allow-empty -m preflight
fixture_preflight_commit="$(git -C "$fixture_worktree" rev-parse HEAD)"
stub_call_log="${fixture_root}/ssh-calls.log"
: > "$stub_call_log"
preflight_output="$(
  STUB_SSH_CALL_LOG="$stub_call_log" \
  TICKET_RUNNER_PROJECT_KEY=market-map \
  TICKET_RUNNER_TICKET_ID=123 \
  TICKET_RUNNER_ARTIFACT_DIR="$fixture_artifact" \
  TICKET_RUNNER_ARTIFACT_MANIFEST="$fixture_seal/manifest.json" \
  TICKET_RUNNER_ARTIFACT_SHA256="$fixture_digest" \
  "$fixture_wrapper" --preflight "$fixture_worktree" "$fixture_preflight_commit"
)" || fail "actual wrapper rejected a valid server-side pre-publication preflight"
[[ "$preflight_output" == "preflight-ok" ]] \
  || fail "actual wrapper returned an invalid preflight success marker: $preflight_output"
[[ "$(grep -Fxc 'prepare' "$stub_call_log")" == 1 \
  && "$(grep -Fxc 'validate' "$stub_call_log")" == 1 \
  && "$(grep -Fxc 'cleanup' "$stub_call_log")" == 1 ]] \
  || fail "preflight did not prepare, validate, and clean exactly one remote upload"
if grep -Eq '^(status|deploy)$' "$stub_call_log"; then
  fail "preflight queried or changed production deployment state"
fi

git -C "$fixture_worktree" push --quiet origin main
fixture_commit="$fixture_preflight_commit"

set +e
integration_output="$(
  TICKET_RUNNER_PROJECT_KEY=market-map \
  TICKET_RUNNER_TICKET_ID=123 \
  TICKET_RUNNER_ARTIFACT_DIR="$fixture_artifact" \
  TICKET_RUNNER_ARTIFACT_MANIFEST="$fixture_seal/manifest.json" \
  TICKET_RUNNER_ARTIFACT_SHA256="$fixture_digest" \
  "$fixture_wrapper" "$fixture_worktree" "$fixture_commit" 2>&1
)"
integration_status=$?
set -e
[[ "$integration_status" == 3 ]] \
  || fail "actual wrapper did not preserve authoritative market-map not-deployed exit 3: $integration_output"
[[ "$(grep -Fxc 'DEPLOYMENT_NOT_DEPLOYED' <<< "$integration_output")" == 1 ]] \
  || fail "actual wrapper did not emit the exact authoritative not-deployed marker once"

: > "$stub_call_log"
set +e
unknown_output="$(
  STUB_STATUS_MODE=unknown \
  STUB_SSH_CALL_LOG="$stub_call_log" \
  TICKET_RUNNER_PROJECT_KEY=market-map \
  TICKET_RUNNER_TICKET_ID=123 \
  TICKET_RUNNER_ARTIFACT_DIR="$fixture_artifact" \
  TICKET_RUNNER_ARTIFACT_MANIFEST="$fixture_seal/manifest.json" \
  TICKET_RUNNER_ARTIFACT_SHA256="$fixture_digest" \
  "$fixture_wrapper" "$fixture_worktree" "$fixture_commit" 2>&1
)"
unknown_status=$?
set -e
[[ "$unknown_status" == 75 ]] \
  || fail "actual wrapper did not preserve an unknown initial deployment state: $unknown_output"
[[ "$(grep -Fxc 'status' "$stub_call_log")" == 1 ]] \
  || fail "unknown-state regression did not issue exactly one status query"
if grep -Eq '^(prepare|validate|deploy)$' "$stub_call_log"; then
  fail "wrapper uploaded or deployed after an unknown initial status"
fi

chmod 0600 "$fixture_artifact/server.py"
printf 'value = 999\n' > "$fixture_artifact/server.py"
chmod 0400 "$fixture_artifact/server.py"
if (
  source "$WRAPPER"
  LOCAL_WORKTREE="$fixture_worktree"
  validate_local_artifact "$fixture_artifact" "$fixture_seal/manifest.json" "$fixture_digest"
) >/dev/null 2>&1; then
  fail "wrapper accepted an artifact modified after sealing"
fi

printf 'market-map forced-command deploy gate tests passed\n'
