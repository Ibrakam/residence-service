#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
app=/var/www/tencorp
candidate=/var/www/tencorp-candidates/dormon-hills
backup="/root/tencorp-workflow-backups/$(date -u +%Y%m%dT%H%M%SZ)-dormon"
test -f "$candidate/.next/BUILD_ID"
mkdir -p "$backup"
python3 - <<'PY'
from pathlib import Path
a=Path('/var/www/tencorp'); c=Path('/var/www/tencorp-candidates/dormon-hills')
for p in (a/'src').rglob('*'):
    if p.is_file() and '.backup' not in p.name and '.pre-' not in p.name:
        q=p.relative_to(a)
        if str(q)!='src/lib/lead-contract.ts':
            assert (c/q).read_bytes()==p.read_bytes(),str(q)
for name in ['.env.local','package.json','package-lock.json']:
    assert (a/name).read_bytes()==(c/name).read_bytes(),name
base=(a/'src/lib/lead-contract.ts').read_text()
anchor="  pushkin: 'PUSHKIN',"
assert base.count(anchor)==1
assert (c/'src/lib/lead-contract.ts').read_text()==base.replace(anchor,anchor+"\n  'dormon-hills': 'DO‘RMON HILLS',")
print('Agency source conflict guard passed')
PY
cp -p "$app/src/lib/lead-contract.ts" "$backup/lead-contract.ts"
rollback() {
  local code=$?
  trap - ERR
  if [ -d "$backup/next" ]; then
    pm2 stop tencorp >/dev/null || true
    [ ! -e "$app/.next" ] || mv "$app/.next" "$backup/failed-next"
    mv "$backup/next" "$app/.next"
    cp -p "$backup/lead-contract.ts" "$app/src/lib/lead-contract.ts"
    pm2 restart tencorp >/dev/null || true
  fi
  exit "$code"
}
trap rollback ERR
cp -an "$app/.next/static/." "$candidate/.next/static/"
chmod -R a+rX "$candidate/.next"
pm2 stop tencorp >/dev/null
mv "$app/.next" "$backup/next"
# Replace source atomically: a previous candidate can have hardlinked sources.
cp -p "$candidate/src/lib/lead-contract.ts" "$app/src/lib/lead-contract.ts.dormon-tmp"
mv "$app/src/lib/lead-contract.ts.dormon-tmp" "$app/src/lib/lead-contract.ts"
mv "$candidate/.next" "$app/.next"
pm2 restart tencorp >/dev/null
for i in $(seq 1 25); do
  if curl -sf http://127.0.0.1:3000/telegram-contact.js >/dev/null; then break; fi
  sleep 1
done
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/submit)" = 400
printf 'Do‘rmon agency allowlist live; rollback backup: %s\n' "$backup"
