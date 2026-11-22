#!/usr/bin/env python3
"""Read-only HTTP coverage and unchanged Do‘rmon assets. No CRM writes."""
from pathlib import Path
import hashlib
import json
import urllib.request
import urllib.error
import sys

ORIGIN = 'https://form.tencorp.uz'
VERSION = '20261122-1'
COOKIE = Path('/etc/tencorp-auth-gateway/deploy-smoke-session').read_text().strip()
PROJECTS = ['4u', 'bayterak', 'botanika-saroyi', 'c1', 'flagman', 'jomiy',
            'maftun-makon', 'meros', 'mirador', 'ofiyat', 'regnum-plaza',
            'saadiyat', 'sado', 'sarbon', 'soy-boyi', 'sun', 'voha',
            'yangibaxt', 'zamon', 'pushkin']


def get(route, auth=True):
    headers = {'Cookie': '__Host-tencorp_session=' + COOKIE} if auth else {}
    req = urllib.request.Request(ORIGIN + route, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.status, response.read(), response.headers


BEFORE = Path('/root/tencorp-typography-dormon-before-20261122.json')
if '--capture-before' in sys.argv:
    release = Path('/var/www/residence-service/root-current')
    h = hashlib.sha256(); count = 0
    for f in sorted((release / 'frontend/public/dormon-hills').rglob('*')):
        if f.is_file():
            h.update(str(f.relative_to(release)).encode()); h.update(hashlib.sha256(f.read_bytes()).digest()); count += 1
    before = {'release': str(release.resolve()), 'dormonAssets': {'count': count, 'sha256': h.hexdigest()}}
    for route in ['/dormon-hills', '/dormon-hills/apartments']:
        before[route] = {'htmlSha256': hashlib.sha256(get(route)[1]).hexdigest()}
    BEFORE.write_text(json.dumps(before)); BEFORE.chmod(0o600)
    print(json.dumps({'baselineCaptured': True, 'release': before['release']})); raise SystemExit()

checks = []
paths = ['/', '/tencorp/', '/tencrop/', '/avalon', '/sanat/', '/sanat/flats', '/privacy']
paths += [path for project in PROJECTS for path in ('/' + project, '/' + project + '/apartments')]
for route in paths:
    code, body, _ = get(route)
    assert code == 200, (route, code)
    assert body.count(('/site-typography/' + VERSION + '/site-fonts.css').encode()) == 1, (route, 'missing/duplicate font layer')
    if route != '/privacy':
        assert body.count(b'/lead-security/client.js?v=20261119-1') == 1, (route, 'lead protection changed')
    checks.append(route)
assert get('/', auth=False)[1].count(b'/site-typography/') == 1
for asset in ['site-fonts.css', 'montserrat.woff2', 'helvetica-neue-400.woff2',
              'helvetica-neue-500.woff2', 'helvetica-neue-700.woff2', 'helvetica-neue-italic.woff2']:
    code, body, headers = get('/site-typography/' + VERSION + '/' + asset, auth=False)
    assert code == 200 and len(body) > 100, (asset, code)
    if asset.endswith('woff2'):
        assert body[:4] == b'wOF2', (asset, 'font format')
    assert 'immutable' in headers.get('Cache-Control', ''), asset

manifest = json.loads(Path('/opt/tencorp-typography/releases/' + VERSION + '/manifest.json').read_text())
for font in manifest['fonts']:
    name = font.get('common')
    if name:
        code, body, headers = get('/site-typography/' + VERSION + '/' + name, auth=False)
        assert body[:4] == b'wOF2' and hashlib.sha256(body).hexdigest() == font['commonSHA256']
        assert 'immutable' in headers.get('Cache-Control', '')
# Legacy immutable URLs must keep their original bytes for cached clients.
for font in manifest['fonts']:
    assert hashlib.sha256(get('/site-typography/20261119-1/' + font['original'], auth=False)[1]).hexdigest() == font['originalSHA256']
try:
    get('/site-typography/' + VERSION + '/missing-font-smoke.woff2', auth=False)
    raise AssertionError('Missing font was served')
except urllib.error.HTTPError as error:
    assert error.code == 404 and error.headers.get('Cache-Control') == 'no-store'

before = json.loads(BEFORE.read_text())
release = Path('/var/www/residence-service/root-current')
assert str(release.resolve()) == before['release'], 'Application release changed'
h = hashlib.sha256()
count = 0
for f in sorted((release / 'frontend/public/dormon-hills').rglob('*')):
    if f.is_file():
        h.update(str(f.relative_to(release)).encode())
        h.update(hashlib.sha256(f.read_bytes()).digest())
        count += 1
assert {'count': count, 'sha256': h.hexdigest()} == before['dormonAssets'], 'Do‘rmon assets changed'
dormon = {}
for route in ['/dormon-hills', '/dormon-hills/apartments']:
    code, body, _ = get(route)
    assert code == 200 and b'/site-typography/' not in body, (route, 'Do‘rmon received font layer')
    dormon[route] = {'fontLayerAbsent': True,
                     'htmlIdentical': hashlib.sha256(body).hexdigest() == before[route]['htmlSha256']}

print(json.dumps({'verified': True, 'htmlPages': checks, 'publicFontAssets': 6,
                  'dormon': dormon, 'dormonAssetHashesUnchanged': True,
                  'applicationReleaseUnchanged': True, 'validCrmLeadsCreated': 0}, ensure_ascii=False))
