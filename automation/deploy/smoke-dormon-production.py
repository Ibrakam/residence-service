#!/usr/bin/env python3
"""Read-only production smoke; the existing private fixture never leaves memory."""
import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

origin = 'https://form.tencorp.uz'
fixture = Path('/etc/tencorp-auth-gateway/deploy-smoke-session')
assert fixture.stat().st_uid == 0 and not fixture.stat().st_mode & 0o077
token = fixture.read_text().strip()
assert re.fullmatch(r'[A-Za-z0-9_-]{43}', token)

def get(route, authenticated=True):
    headers = {'Cookie': '__Host-tencorp_session=' + token} if authenticated else {}
    request = urllib.request.Request(origin + route, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, response.read(8_000_001), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, error.read(8_000_001), dict(error.headers)

assert get('/__auth/me')[0] == 200
assert get('/api/dormon-plans', False)[0] == 401
assert get('/api/dormon-plans/')[0] == 404
status, body, _ = get('/api/dormon-plans')
assert status == 200
state = json.loads(body)
assert state['source'] == 'https://millenniumhouse.uz/dormon-hills'
assert state['freshness'] == 'current' and state['plans']
for route in ['/dormon-hills', '/dormon-hills/apartments']:
    for language in ['ru', 'uz', 'en']:
        status, document, _ = get(route + '?lang=' + language)
        assert status == 200 and b'dormon-hills' in document and b'__Host-tencorp_session' not in document
        assert re.search(rb'<html[^>]+lang="' + language.encode() + rb'"', document)
        assert b'/dormon-hills/plans/live/' in document
        if route.endswith('/apartments'):
            assert len(re.findall(rb'<li\b[^>]*class="dh-plan-card"', document)) == len(state['plans'])
            assert b'Floor plan source:' not in document
            assert 'Источник планировок:'.encode() not in document
            assert b'Rejalar manbasi:' not in document
    guest = get(route, False)
    assert guest[0] in [200, 401] and b'/dormon-hills/plans/live/' not in guest[1]

plan = state['plans'][0]
legacy = urllib.parse.urlencode({'lang': 'ru', 'block': plan['block'], 'rooms': plan['rooms'],
                                'minArea': plan['area'], 'maxArea': plan['area']})
status, document, _ = get('/dormon-hills/apartments?' + legacy)
assert status == 200
assert len(re.findall(rb'<li\b[^>]*class="dh-plan-card"', document)) == len(state['plans'])

assets = set(url for plan in state['plans'] for url in [plan['plan'], plan['floorPlan']])
for asset in sorted(assets):
    status, image, headers = get(asset)
    assert status == 200 and headers.get('Content-Type', '').startswith('image/webp'), asset
    assert image[:4] == b'RIFF' and image[8:12] == b'WEBP', asset
    assert hashlib.sha256(image).hexdigest()[:12] in asset, asset
guest_asset = get(next(iter(assets)), False)
assert guest_asset[0] in [200, 401] and guest_asset[1][:4] != b'RIFF'
assert get('/tencorp/assets/projects-map.js', False)[0] == 401
status, map_js, _ = get('/tencorp/assets/projects-map.js')
assert status == 200
assert b'slug: `dormon-hills`' in map_js
assert b'coordinates: [41.3753333333, 69.4316388889]' in map_js
assert len(re.findall(rb'slug:\s*`[^`]+`', map_js)) == 23
assert get('/', False)[0] == 200
print(json.dumps({'verified': True, 'plans': len(state['plans']), 'images': len(assets),
                  'capturedAt': state['capturedAt'], 'freshness': state['freshness'],
                  'languages': ['ru', 'uz', 'en'], 'mapProjects': 23,
                  'guestProtection': True, 'source': state['source']}, ensure_ascii=False))
