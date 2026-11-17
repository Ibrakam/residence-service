#!/usr/bin/env bash
set -euo pipefail

# Run on the production host with a verified checkout/release as the argument.
if [[ $# -ne 1 || ! -f "$1/website/scripts/capture-dormon-plans.mjs" ]]; then
  echo 'Usage: sudo bash install-dormon-plan-sync.sh /absolute/repository/root' >&2
  exit 2
fi
if [[ "$EUID" -ne 0 ]]; then
  echo 'The installer must run as root to install the systemd service.' >&2
  exit 2
fi

project_root="$(cd "$1" && pwd)"
runtime_root=/opt/residence-dormon-plan-sync
data_root=/var/lib/residence-dormon-plans
if ! id residence-catalog-sync >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/residence-catalog-sync --shell /usr/sbin/nologin residence-catalog-sync
fi

install -d -m 0755 "$runtime_root/scripts" "$runtime_root/lib"
install -d -o residence-catalog-sync -g residence-catalog-sync -m 0755 "$data_root"
systemctl stop residence-dormon-plan-sync.timer 2>/dev/null || true
systemctl stop residence-dormon-plan-sync.service 2>/dev/null || true
install -m 0644 "$project_root/automation/deploy/dormon-plan-sync/package.json" "$runtime_root/package.json"
install -m 0644 "$project_root/automation/deploy/dormon-plan-sync/package-lock.json" "$runtime_root/package-lock.json"
(cd "$runtime_root" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)

install -m 0644 "$project_root/website/scripts/capture-dormon-plans.mjs" "$runtime_root/scripts/capture-dormon-plans.mjs"
install -m 0644 "$project_root/website/lib/dormon-plans-contract.mjs" "$runtime_root/lib/dormon-plans-contract.mjs"
install -m 0644 "$project_root/automation/deploy/systemd/residence-dormon-plan-sync.service" /etc/systemd/system/residence-dormon-plan-sync.service
install -m 0644 "$project_root/automation/deploy/systemd/residence-dormon-plan-sync.timer" /etc/systemd/system/residence-dormon-plan-sync.timer
systemctl daemon-reload
systemctl enable --now residence-dormon-plan-sync.timer
systemctl start residence-dormon-plan-sync.service
test -s "$data_root/current.json"
runuser -u residence-frontend -- test -r "$data_root/current.json"
systemctl list-timers residence-dormon-plan-sync.timer --no-pager
