#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
app=/var/www/tencorp
candidate=/srv/tencorp-security-deps-20261119
backup=/root/tencorp-security-backups/dependencies-20261119
test -f "$candidate/.next/BUILD_ID"
test ! -e "$backup"
python3 - <<'PY'
from pathlib import Path
a=Path('/var/www/tencorp'); c=Path('/srv/tencorp-security-deps-20261119')
for folder in ['src','scripts','tests','analytics','public']:
 for p in (a/folder).rglob('*'):
  if p.is_file() and '.backup' not in p.name and '.pre-' not in p.name and not p.name.startswith('._'):
   q=c/p.relative_to(a)
   assert q.exists() and q.read_bytes()==p.read_bytes(),str(p)
for name in ['next.config.ts','tsconfig.json','postcss.config.mjs']:
 assert (a/name).read_bytes()==(c/name).read_bytes(),name
print('Production source conflict check passed')
PY
mkdir -p "$backup"
cp -p "$app/package.json" "$app/package-lock.json" "$backup/"
cp -an "$app/.next/static/." "$candidate/.next/static/"
rollback() {
 local code=$?
 trap - ERR
 pm2 stop tencorp >/dev/null || true
 for part in node_modules .next; do
  if test -d "$backup/$part"; then
   test ! -e "$app/$part" || mv "$app/$part" "$backup/failed-${part#.}"
   mv "$backup/$part" "$app/$part"
  fi
 done
 cp -p "$backup/package.json" "$backup/package-lock.json" "$app/"
 pm2 restart tencorp >/dev/null || true
 exit "$code"
}
trap rollback ERR
pm2 stop tencorp >/dev/null
for part in node_modules .next; do
 mv "$app/$part" "$backup/$part"
 mv "$candidate/$part" "$app/$part"
done
cp -p "$candidate/package.json" "$candidate/package-lock.json" "$app/"
pm2 restart tencorp >/dev/null
for i in $(seq 1 25); do
 if curl -sf http://127.0.0.1:3000/telegram-contact.js >/dev/null; then break; fi
 sleep 1
done
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/submit)" = 400
test "$(curl -s -o /dev/null -w '%{http_code}' https://form.tencorp.uz/)" = 200
trap - ERR
echo 'Dependency update promoted; rollback preserved at /root/tencorp-security-backups/dependencies-20261119'
