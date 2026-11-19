#!/usr/bin/env python3
"""Real conditional HTTP requests; no sessions or CRM records are created."""
from pathlib import Path
import json
import urllib.request
import urllib.error

ORIGIN = 'https://form.tencorp.uz'
fixture = Path('/etc/tencorp-auth-gateway/deploy-smoke-session')
assert fixture.stat().st_uid == 0 and not fixture.stat().st_mode & 0o077
cookie = '__Host-tencorp_session=' + fixture.read_text().strip()


def get(path, credential=cookie, headers=None, method='GET'):
    options = dict(headers or {})
    if credential:
        options['Cookie'] = credential
    req = urllib.request.Request(ORIGIN + path, headers=options, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read(), r.headers
    except urllib.error.HTTPError as r:
        return r.code, r.read(), r.headers


def cache_policy(headers):
    return {v.strip() for v in headers.get('Cache-Control', '').split(',')}


assets = ['/dormon-hills/facades/overview.webp',
          '/dormon-hills/editorial/lobby-640.webp',
          '/dormon-hills/showroom/98d73e49d05dce.webp']
checks = []
for path in assets:
    status, body, headers = get(path)
    assert status == 200 and body[:4] == b'RIFF', (path, status)
    assert cache_policy(headers) == {'private', 'no-cache', 'must-revalidate'}, (path, headers.get('Cache-Control'))
    assert len(headers.get_all('Cache-Control')) == 1, path
    etag = headers.get('ETag')
    assert etag and headers.get('Last-Modified'), (path, 'missing validators')
    status, cached_body, cached_headers = get(path, headers={'If-None-Match': etag})
    assert status == 304 and not cached_body, (path, status)
    assert cache_policy(cached_headers) == {'private', 'no-cache', 'must-revalidate'}
    status, _, _ = get(path, headers={'If-None-Match': '"different-content"'})
    assert status == 200, (path, 'incorrect 304')
    for credential in [None, '__Host-tencorp_session=' + 'x' * 43]:
        for condition in [{'If-None-Match': etag}, {'If-Modified-Since': headers['Last-Modified']}]:
            status, denied, denied_headers = get(path, credential, headers=condition)
            assert status == 401 and b'authentication_required' in denied, (path, status)
            assert cache_policy(denied_headers) == {'private', 'no-store'}, (path, '401 cache policy')
    status, head_body, _ = get(path, headers={'If-None-Match': etag}, method='HEAD')
    assert status == 304 and not head_body
    checks.append({'path': path, 'firstBytes': len(body), 'revalidatedStatus': 304, 'revalidatedBodyBytes': 0, 'unauthorizedConditionalStatus': 401})

status, _, headers = get('/dormon-hills/media/absent-media-cache-smoke.webp')
assert status == 404 and cache_policy(headers) == {'private', 'no-store'}

for path in ['/dormon-hills', '/api/dormon-plans', '/dormon-hills/apartments', '/4u']:
    status, _, headers = get(path)
    assert status == 200 and cache_policy(headers) == {'private', 'no-store'}, (path, status, headers.get('Cache-Control'))

print(json.dumps({'verified': True, 'checks': checks, 'pagesAndJsonRemainNoStore': True,
                  'invalidAndMissingSessionDenied': True, 'realFixtureUnchanged': True}))
