#!/usr/bin/env python3
"""Read-only HTTP coverage and unchanged Do‘rmon assets. No CRM writes."""
from pathlib import Path
import hashlib
import json
import urllib.request
import urllib.error

ORIGIN = 'https://form.tencorp.uz'
VERSION = '20261119-1'
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

before = json.loads(Path('/root/tencorp-typography-dormon-before.json').read_text())
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
