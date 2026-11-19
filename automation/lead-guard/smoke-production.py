#!/usr/bin/env python3
"""Production checks never submit a valid lead and never print credentials."""
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

ORIGIN = 'https://form.tencorp.uz'
session = Path('/etc/tencorp-auth-gateway/deploy-smoke-session').read_text().strip()

def request(path, auth=False, payload=None, extra=None):
    if payload is not None:
        time.sleep(13)  # Keep smoke below the real edge limit; no bypass key.
    headers = {'Cookie': '__Host-tencorp_session=' + session} if auth else {}
    if payload is not None:
        headers.update({'Origin': ORIGIN, 'Referer': ORIGIN + '/', 'Content-Type': 'application/json'})
    headers.update(extra or {})
    req = urllib.request.Request(ORIGIN + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, response.read(), response.headers
    except urllib.error.HTTPError as error:
        return error.code, error.read(), error.headers

pages = ['/', '/tencorp/', '/tencrop/', '/sanat', '/avalon', '/4u', '/bayterak', '/botanika-saroyi', '/c1', '/flagman', '/jomiy', '/maftun-makon', '/meros', '/mirador', '/ofiyat', '/regnum-plaza', '/saadiyat', '/sado', '/sarbon', '/soy-boyi', '/sun', '/voha', '/yangibaxt', '/zamon', '/pushkin', '/dormon-hills', '/dormon-hills/apartments']
checked = []
for path in pages:
    code, body, _ = request(path, auth=True)
    assert code == 200 and b'/lead-security/client.js' in body, (path, code, 'missing client')
    checked.append(path)
for path in ['/v1/leads', '/tencrop/v1/leads', '/api/submit']:
    code, _, _ = request(path, payload={})
    assert code == 401, (path, 'guest boundary', code)
    code, body, _ = request(path, auth=True, payload={})
    assert code == 400, (path, 'guard validation', code)
code, body, _ = request('/v1/agency-leads', payload={'name':'Guard Probe', 'phone':'+998901234567', 'interest':'Инвестиции', 'consent':True})
assert code == 403 and b'verification_required' in body, (code, body)
code, body, headers = request('/lead-security/challenge?page=%2F', extra={'Referer':ORIGIN+'/'})
assert code == 200 and json.loads(body)['token'] and 'HttpOnly' in headers['Set-Cookie']
assert request('/lead-security/client.js')[0] == 200
assert request('/api/sun-lead', auth=True, payload={})[0] == 404
print(json.dumps({'verified':True, 'htmlPagesWithProtection':checked, 'missingTokenBlocked':True, 'guestBoundariesPreserved':True, 'validCrmLeadsCreated':0, 'turnstileConfigured':bool(json.loads(body)['sitekey'])}))
