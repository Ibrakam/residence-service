#!/bin/zsh
set -euo pipefail

mode="${1:---dry-run}"
if [[ "$mode" != "--dry-run" && "$mode" != "--install" ]]; then
  print -u2 "usage: $0 [--dry-run|--install]"
  exit 2
fi

script_dir="$(cd -- "$(dirname -- "$0")" && pwd -P)"
automation_root="$(cd -- "$script_dir/.." && pwd -P)"
template_file="$script_dir/com.tencorp.residence-ticket-runner.plist.template"
renderer="$script_dir/render-plist.mjs"
runner_entry="$automation_root/src/index.mjs"
preferred_node_bin="$HOME/.nvm/versions/node/v22.22.0/bin/node"
if [[ -n "${RUNNER_NODE_BIN:-}" ]]; then
  node_bin="$RUNNER_NODE_BIN"
elif [[ -x "$preferred_node_bin" ]]; then
  node_bin="$preferred_node_bin"
else
  node_bin="$(command -v node)"
fi
runner_env_file="${RUNNER_ENV_FILE:-$HOME/Library/Application Support/AvalonTicketRunner/runner.env}"
log_dir="$HOME/Library/Logs/AvalonTicketRunner"
destination="$HOME/Library/LaunchAgents/com.tencorp.residence-ticket-runner.plist"
temporary_file="$(mktemp -t residence-ticket-runner-plist)"
trap 'rm -f -- "$temporary_file"' EXIT

if [[ "$node_bin" != /* ]]; then
  print -u2 "Node executable must be an absolute path: $node_bin"
  exit 1
fi
if [[ ! -x "$node_bin" ]]; then
  print -u2 "Node executable is missing or not executable: $node_bin"
  exit 1
fi
node_dir="$(cd -- "$(dirname -- "$node_bin")" && pwd -P)"
node_bin="$node_dir/$(basename -- "$node_bin")"
if [[ ! -f "$runner_env_file" ]]; then
  print -u2 "Runner env file is missing: $runner_env_file"
  exit 1
fi
env_mode="$(stat -f '%Lp' "$runner_env_file")"
if [[ "$env_mode" != "600" ]]; then
  print -u2 "Runner env file must be chmod 600 (current mode: $env_mode)"
  exit 1
fi

values_json="$(NODE_BIN_VALUE="$node_bin" NODE_DIR_VALUE="$node_dir" RUNNER_ENTRY_VALUE="$runner_entry" AUTOMATION_ROOT_VALUE="$automation_root" RUNNER_ENV_FILE_VALUE="$runner_env_file" STDOUT_LOG_VALUE="$log_dir/stdout.log" STDERR_LOG_VALUE="$log_dir/stderr.log" "$node_bin" -e '
const keys = ["NODE_BIN", "NODE_DIR", "RUNNER_ENTRY", "AUTOMATION_ROOT", "RUNNER_ENV_FILE", "STDOUT_LOG", "STDERR_LOG"];
const result = {};
for (const key of keys) result[key] = process.env[`${key}_VALUE`];
process.stdout.write(JSON.stringify(result));
')"
"$node_bin" "$renderer" "$template_file" "$temporary_file" "$values_json"
/usr/bin/plutil -lint "$temporary_file" >/dev/null

if [[ "$mode" == "--dry-run" ]]; then
  /bin/cat "$temporary_file"
  exit 0
fi

/bin/mkdir -p "$HOME/Library/LaunchAgents" "$log_dir"
/bin/chmod 700 "$log_dir"
/bin/cp "$temporary_file" "$destination"
/bin/chmod 644 "$destination"
/bin/launchctl bootout "gui/$(id -u)/com.tencorp.residence-ticket-runner" 2>/dev/null || true
/bin/launchctl bootstrap "gui/$(id -u)" "$destination"
/bin/launchctl kickstart -k "gui/$(id -u)/com.tencorp.residence-ticket-runner"
print "Installed com.tencorp.residence-ticket-runner"
print "Logs: $log_dir"
