#!/usr/bin/env bash
# Builds an isolated candidate; does not change the running agency application.
set -Eeuo pipefail
umask 077
app=/var/www/tencorp
candidate=/var/www/tencorp-candidates/dormon-hills
test ! -e "$candidate"
mkdir -p "$candidate"
tar -C "$app" --exclude=./.next --exclude=./node_modules -cf - . | tar -C "$candidate" -xf -
cp -al "$app/node_modules" "$candidate/node_modules"
python3 - "$candidate" <<'PY'
import os, sys
from pathlib import Path
p=Path(sys.argv[1])/'src/lib/lead-contract.ts'
base=p.read_text()
anchor="  pushkin: 'PUSHKIN',"
assert base.count(anchor)==1 and "'dormon-hills'" not in base
tmp=p.with_suffix('.dormon.tmp')
tmp.write_text(base.replace(anchor, anchor+"\n  'dormon-hills': 'DO‘RMON HILLS',"))
tmp.chmod(p.stat().st_mode & 0o777)
os.replace(tmp,p)
PY
cd "$candidate"
npm run build
test -s .next/BUILD_ID
echo 'Do‘rmon agency candidate built; production is unchanged.'
