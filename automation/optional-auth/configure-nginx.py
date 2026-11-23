#!/usr/bin/env python3
"""Open only consumer websites while retaining account/operator/map gates.

Run after deploying the optional-aware Residence frontend. No production changes
are made by importing this module. The existing geo gate and main-only SEO stay.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time

ROOT = Path('/opt/tencorp-optional-auth')
MARKER = Path('/etc/tencorp-auth-gateway/optional-consumer-enabled')
GEO_LOCK = Path('/run/lock/tencorp-geo-access.lock')
PROJECTS = 'avalon|4u|bayterak|botanika-saroyi|c1|dormon-hills|flagman|jomiy|maftun-makon|meros|mirador|ofiyat|pushkin|regnum-plaza|saadiyat|sarbon|sado|soy-boyi|sun|voha|yangibaxt|zamon|sanat|tencrop'
RESIDENCE_SELECTOR = '~ ^/(?:4u|bayterak|botanika-saroyi|c1|dormon-hills|flagman|jomiy|maftun-makon|meros|mirador|ofiyat|pushkin|regnum-plaza|saadiyat|sarbon|sado|soy-boyi|sun|voha|yangibaxt|zamon)(?:/|$)'
PUBLISHED_PROJECTS = PROJECTS.replace('avalon|', 'avalon-residence|').replace('|sanat|tencrop', '')
READ_INCLUDE = 'include /etc/nginx/snippets/tencorp-optional-consumer-read.conf;'
WRITE_INCLUDE = 'include /etc/nginx/snippets/tencorp-optional-consumer-write.conf;'
OPTIONAL_HEAD = '<meta name="tencorp-auth-mode" content="optional"><script defer src="/optional-auth/client.js?v=20261124-1"></script>'


def atomic(path, data, mode=0o644):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def locations(text):
    """Yield multiline location bodies, ignoring quoted/commented braces."""
    pattern = re.compile(r'(?m)^(?P<indent>[ \t]*)location[ \t]+(?P<selector>[^\n]+?)[ \t]+\{[ \t]*\n')
    for match in pattern.finditer(text):
        depth, quote, escaped, comment = 1, '', False, False
        for i in range(match.end(), len(text)):
            ch = text[i]
            if comment:
                if ch == '\n': comment = False
                continue
            if escaped: escaped = False; continue
            if ch == '\\': escaped = True; continue
            if quote:
                if ch == quote: quote = ''
                continue
            if ch in ('"', "'"): quote = ch; continue
            if ch == '#': comment = True; continue
            if ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    yield match, i
                    break
        else:
            raise ValueError('Unclosed Nginx location')


def patch_locations(text, selectors, write=False, inherited=False):
    include = WRITE_INCLUDE if write else READ_INCLUDE
    changes, found = [], set()
    for match, end in locations(text):
        selector = match['selector'].strip()
        if selector not in selectors: continue
        body = text[match.end():end]
        before = body
        protection = re.compile(r'include /etc/nginx/snippets/tencorp-auth-protect-(?:page|api)\.conf;')
        count = len(protection.findall(body))
        if count == 1:
            body = protection.sub(include, body)
        elif count == 0 and inherited:
            body = match['indent'] + '    ' + include + '\n' + body
        else:
            raise ValueError('Unexpected authentication boundary: ' + selector)
        if body == before: raise ValueError('No optional access change: ' + selector)
        found.add(selector); changes.append((match.end(), end, body))
    if found != set(selectors):
        raise ValueError('Missing reviewed locations: ' + ','.join(sorted(set(selectors)-found)))
    for start, end, body in sorted(changes, reverse=True): text = text[:start] + body + text[end:]
    return text


def read_snippet():
    return '''# Consumer data and media only; country restrictions still run first.
auth_request off;
if ($request_method !~ ^(?:GET|HEAD|OPTIONS)$) { return 405; }
proxy_set_header Cookie "";
proxy_set_header Authorization "";
proxy_set_header X-Auth-User-ID "";
proxy_set_header X-Auth-Telegram-ID "";
proxy_set_header X-Auth-Phone "";
proxy_hide_header Set-Cookie;
'''


def write_snippet():
    return '''# Existing public lead guard still validates anonymous nonce, origin,
# consent, Turnstile and per-IP/session/phone rates before forwarding.
auth_request off;
proxy_set_header Authorization "";
proxy_set_header X-Auth-User-ID "";
proxy_set_header X-Auth-Telegram-ID "";
proxy_set_header X-Auth-Phone "";
'''


def markup_map():
    return '''limit_req_zone $binary_remote_addr zone=tencorp_public_nrg_per_ip:10m rate=30r/m;
# Only successful consumer HTML receives the optional-mode bootstrap.
map "$status:$request_uri" $tencorp_optional_auth_markup {
    default "";
    ~^200:/(?:''' + PROJECTS + ''')(?:/|[?]|$) 'ИМПОРТ';
}
'''.replace('ИМПОРТ', OPTIONAL_HEAD)


def public_catalog():
    return '''# Do NOT exempt the entire catalog API: operational sales/registry/sync
# endpoints keep their existing default authentication boundary.
location ~ ^/(?:residence-api/catalog|tencrop/api/catalog)/v1/(?:projects/(?:''' + PUBLISHED_PROJECTS + ''')(?:/(?:units|layouts|availability|floor-schemes))?|construction-passports/(?:''' + PUBLISHED_PROJECTS + '''))$ {
    include /etc/nginx/snippets/tencorp-optional-consumer-read.conf;
    rewrite ^/(?:residence-api/catalog|tencrop/api/catalog)(/.*)$ $1 break;
    proxy_pass http://127.0.0.1:4300;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /residence-api/catalog;
    proxy_connect_timeout 2s;
    proxy_read_timeout 15s;
}
'''


def public_catalog_health():
    result = []
    for prefix in ['/residence-api/catalog', '/tencrop/api/catalog']:
        result.append('''location = ''' + prefix + '''/v1/sync/catalog-status {
    include /etc/nginx/snippets/tencorp-optional-consumer-read.conf;
    proxy_pass http://127.0.0.1:4320/api/public-catalog-status;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 2s;
    proxy_read_timeout 7s;
}
''')
    return '\n'.join(result)


def patch_site(text):
    if 'tencorp_optional_auth_markup' in text:
        raise ValueError('Optional consumer browsing is already installed')
    read = {
        '^~ /residence-assets/_next/static/',
        '= /api/dormon-plans', '= /api/pushkin-catalog', '= /api/kayan/ofiyat-explorer',
        '= /icon.svg', '/kayan/', RESIDENCE_SELECTOR, '^~ /tencrop/_next/static/',
        '^~ /tencrop/', '^~ /sanat-assets/', '= /sanat/', '= /sanat/flats',
        '^~ /tencorp/', '^~ /assets/', '~* ^/(?:images|fonts)/', '= /favicon.svg',
    }
    text = patch_locations(text, read)
    text = patch_locations(text, {'= /v1/leads', '= /tencrop/v1/leads', '= /api/submit'}, write=True)
    # NRG's external placement-list POST is read-only. It never creates leads.
    text = patch_locations(text, {'= /api/nrg-apartments'}, write=True, inherited=True)
    nrg = next((m, end) for m, end in locations(text) if m['selector'].strip() == '= /api/nrg-apartments')
    match, end = nrg; body = text[match.end():end]
    body = body.replace(WRITE_INCLUDE, WRITE_INCLUDE + '\n        if ($request_method != POST) { return 405; }\n        client_max_body_size 4k;\n        proxy_set_header Cookie "";\n        limit_req zone=tencorp_public_nrg_per_ip burst=8 nodelay;\n        limit_req_status 429;')
    expected_nrg = 'proxy_pass $catalog_origin/sales-picker/microfe-v3/placementList;'
    if body.count(expected_nrg) != 1: raise ValueError('Unexpected SANAT placement-list upstream')
    body = body.replace(expected_nrg, 'proxy_pass http://127.0.0.1:4320/api/public-nrg-apartments;')
    body = body.replace('proxy_set_header Host apigw.bi.group;', 'proxy_set_header Host $host;')
    text = text[:match.end()] + body + text[end:]
    # A plain protected fallback lets the narrowly anchored public regex win.
    expected = 'location ^~ /residence-api/catalog/ {'
    if text.count(expected) != 1: raise ValueError('Unexpected catalog fallback')
    text = text.replace(expected, 'location /residence-api/catalog/ {')
    legacy_catalog = 'location ^~ /tencrop/api/catalog/ {'
    if text.count(legacy_catalog) != 1: raise ValueError('Unexpected legacy catalog fallback')
    text = text.replace(legacy_catalog, 'location /tencrop/api/catalog/ {')
    old = '<head><script defer src="/lead-security/client.js?v=20261119-1"></script>$tencorp_typography_markup'
    if text.count(old) != 1: raise ValueError('Unexpected shared HTML security filter')
    text = text.replace(old, old + '$tencorp_optional_auth_markup')
    anchor = '    include /etc/nginx/snippets/tencorp-auth-gate.conf;'
    if text.count(anchor) != 1: raise ValueError('Missing default private route boundary')
    text = text.replace(anchor, anchor + '\n    include /etc/nginx/snippets/tencorp-optional-consumer-locations.conf;')
    return text


def frontend_preflight():
    client = Path('/var/www/residence-service/root-current/frontend/dist/client/residence-assets/_next/static')
    if not client.is_dir(): raise ValueError('Namespaced Residence frontend is not deployed')
    # Opening the edge before deploying the new client would let an old
    # SessionRevocationGuard immediately redirect every guest back to login.
    found = False
    for path in client.rglob('*.js'):
        if path.stat().st_size > 4 * 1024 * 1024: continue
        source = path.read_text()
        if all(marker in source for marker in ['tencorp-auth-mode', '__tencorpOptionalConsumerReady', 'tencorp:consumer-ready']):
            found = True; break
    if not found: raise ValueError('Deploy the optional-aware frontend before opening consumer access')


def edge_status(path):
    result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '10',
        '--resolve', 'form.tencorp.uz:443:127.0.0.1', '--output', '/dev/null',
        '--write-out', '%{http_code}', 'https://form.tencorp.uz' + path],
        check=True, capture_output=True, text=True)
    return int(result.stdout)


def verify_edge():
    # No cookies or authorization are supplied. Wait out graceful Nginx old
    # workers, and fail closed if any private boundary accidentally opens.
    expected = {'/4u': 200, '/dormon-hills': 200, '/sanat/flats': 200,
        '/residence-api/catalog/v1/projects/4u/units': 200,
        '/tencrop/api/catalog/v1/projects/avalon-residence/units': 200,
        '/tencorp/assets/projects-map.js': 401,
        '/residence-api/catalog/v1/project-registry': 401,
        '/residence-api/catalog/v1/analytics/monthly-sales': 401,
        '/residence-api/catalog/v1/units/1': 401,
        '/residence-api/catalog/v1/projects/not-a-published-project': 401,
        '/__auth/me': 401}
    deadline = time.monotonic() + 30
    while True:
        actual = {path: edge_status(path) for path in expected}
        failures = {path: code for path, code in actual.items() if code != expected[path]}
        if not failures: return
        if time.monotonic() >= deadline: raise ValueError('Optional consumer contract failed: ' + json.dumps(failures))
        time.sleep(1)


def install():
    frontend_preflight()
    site = Path('/etc/nginx/sites-enabled/tencorp').resolve(strict=True)
    snippets = Path('/etc/nginx/snippets')
    avalon = snippets / 'residence-avalon-and-agency.conf'
    avalon_text = patch_locations(avalon.read_text(), {'= /avalon', '^~ /avalon/', '^~ /avalon/_next/static/', '^~ /avalon-assets/'})
    media = snippets / 'tencorp-auth-protect-dormon-media.conf'
    media_text = media.read_text()
    if media_text.count('auth_request /__tencorp-auth/check;') != 1: raise ValueError('Unexpected Do‘rmon media boundary')
    media_text = media_text.replace('auth_request /__tencorp-auth/check;', 'auth_request off;')
    public = '''location = /optional-auth/client.js {
    auth_request off;
    if ($request_method !~ ^(?:GET|HEAD)$) { return 405; }
    alias /opt/tencorp-optional-auth/client.js;
    default_type application/javascript;
    add_header Cache-Control "no-cache" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
}
''' + public_catalog() + public_catalog_health()
    paths = {
        site: patch_site(site.read_text()).encode(), avalon: avalon_text.encode(), media: media_text.encode(),
        snippets / 'tencorp-optional-consumer-read.conf': read_snippet().encode(),
        snippets / 'tencorp-optional-consumer-write.conf': write_snippet().encode(),
        snippets / 'tencorp-optional-consumer-locations.conf': public.encode(),
        Path('/etc/nginx/conf.d/tencorp-optional-auth.conf'): markup_map().encode(),
        MARKER: b'optional-consumer-v1\n',
    }
    backup = Path('/root/tencorp-optional-auth-backups') / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, mode=0o700)
    originals = []
    for i, path in enumerate(paths):
        data = path.read_bytes() if path.exists() else None
        originals.append({'path': str(path), 'file': str(i) if data is not None else None,
                          'mode': stat.S_IMODE(path.stat().st_mode) if data is not None else 0o644})
        if data is not None: (backup / str(i)).write_bytes(data)
    (backup / 'paths.json').write_text(json.dumps(originals, indent=2))
    try:
        for path, data in paths.items():
            if path != MARKER: atomic(path, data)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        verify_edge()
        atomic(MARKER, paths[MARKER], 0o600)
    except BaseException:
        restore(backup)
        raise
    print(json.dumps({'mode': 'optional-consumer-v1', 'backup': str(backup),
                      'mainMapStillPrivate': True, 'operatorsStillPrivate': True}))


def restore(backup):
    backup = backup.resolve(strict=True)
    if backup.parent != Path('/root/tencorp-optional-auth-backups'): raise ValueError('Unexpected backup')
    for item in json.loads((backup / 'paths.json').read_text()):
        path = Path(item['path'])
        if item['file'] is None: path.unlink(missing_ok=True)
        else: atomic(path, (backup / item['file']).read_bytes(), item['mode'])
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--apply', action='store_true')
    action.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0: raise PermissionError('Root required')
    if not (ROOT / 'client.js').is_file(): raise ValueError('Client bootstrap not installed')
    fd = os.open(GEO_LOCK, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    metadata = os.fstat(fd)
    if metadata.st_uid != 0 or not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077 or metadata.st_nlink != 1:
        os.close(fd); raise ValueError('Unsafe shared Nginx mutation lock')
    with os.fdopen(fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.apply: install()
        else: restore(args.rollback)


if __name__ == '__main__':
    main()
