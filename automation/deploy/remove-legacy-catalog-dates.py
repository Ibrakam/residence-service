#!/usr/bin/env python3
"""Build a versioned SAN'AT derivative without its client-side refresh-time label.
The historical SAN'AT source is unavailable locally; this narrow transform keeps
an exact expected render fragment and changes all JS/CSS URLs for cache safety.
It never edits or deletes the source release or switches production symlinks.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
parser.add_argument('--version', required=True)
args = parser.parse_args()
if not re.fullmatch(r'[a-z0-9-]{1,48}', args.version):
    parser.error('unsafe version')
source = args.source.resolve(strict=True)
destination = args.destination.absolute()
if destination.exists() or not destination.is_absolute() or source == destination:
    parser.error('destination must be a new absolute release directory')
fragment = 'A&&(0,M.jsxs)(`small`,{children:[`Обновлено сегодня, `,A.toLocaleTimeString(`ru-RU`,{hour:`2-digit`,minute:`2-digit`})]})'
matching = [p for p in (source / 'assets').glob('FlatsPage-*.js') if fragment in p.read_text()]
if len(matching) != 1 or matching[0].read_text().count(fragment) != 1:
    raise SystemExit('Expected one known legacy timestamp render; source changed, refusing patch')
shutil.copytree(source, destination)
files = list((destination / 'assets').glob('*.js')) + list((destination / 'assets').glob('*.css'))
renames = {p.name: f'{p.stem}-{args.version}{p.suffix}' for p in files}
for p in destination.rglob('*'):
    if not p.is_file() or p.suffix not in ('.js', '.css', '.html'):
        continue
    text = p.read_text()
    if p.name == matching[0].name:
        text = text.replace(fragment, 'false')
    for old, new in renames.items():
        text = text.replace(old, new)
    p.write_text(text)
for p in files:
    p.rename(p.with_name(renames[p.name]))
manifest = {str(p.relative_to(destination)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in destination.rglob('*') if p.is_file() and p.suffix in ('.js', '.css', '.html')}
(destination / 'public-catalog-transform.json').write_text(json.dumps({'version': args.version, 'files': manifest}, indent=2) + '\n')
print(json.dumps({'status': 'built', 'versionedAssets': len(renames), 'timestampRendersRemoved': 1}))
