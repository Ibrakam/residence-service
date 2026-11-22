#!/usr/bin/env python3
"""Install a country gate before every public location, preserving app auth.

No client-supplied forwarding/country header is trusted. Only exact local
addresses and independently authenticated machine endpoints are exempt.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

ROOT = Path('/etc/tencorp-geo-access')
HTTP = Path('/etc/nginx/conf.d/tencorp-geo-access.conf')
SNIPPET = Path('/etc/nginx/snippets/tencorp-geo-access.conf')
SITE = Path('/etc/nginx/sites-enabled/tencorp')
DEFAULT = Path('/etc/nginx/sites-enabled/default')
INCLUDE = '    include /etc/nginx/snippets/tencorp-geo-access.conf;'
ATTRIBUTION = '<div data-geo-attribution><small><a href="https://db-ip.com" rel="external noopener">IP Geolocation by DB-IP</a></small></div>'
FILTER = "sub_filter '</body>' '" + ATTRIBUTION + "</body>';"

# Patterns operate on Nginx's normalized path, never on query/header values.
# Every exception retains the existing backend authentication and body limits.
UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
EXCEPTIONS = [
    r'^(?:GET|HEAD):/\.well-known/acme-challenge/[A-Za-z0-9_-]{1,256}$',
    r'^POST:/__auth/telegram/bot-webhook$',
    r'^POST:/api/amo-webhook$',
    r'^POST:/api/amocrm/chats/[A-Za-z0-9_-]{1,128}$',
    r'^(?:GET|HEAD):/api/amocrm/chat-media/' + UUID + '$',
    r'^GET:/__residence-ticket-worker/internal/ticket-runner/health$',
    r'^POST:/__residence-ticket-worker/internal/ticket-runner/(?:lease|test-tickets)$',
    r'^POST:/__residence-ticket-worker/internal/ticket-runner/tickets/[1-9][0-9]*/(?:heartbeat|progress|complete|fail)$',
    r'^GET:/__residence-ticket-worker/internal/ticket-runner/tickets/[1-9][0-9]*/attachments/[1-9][0-9]*$',
]

# Main TenCorp page only. A candidate UA is not proof: every matching public
# location performs a bounded reverse + forward DNS check before serving bytes.
SEO_EXACT = ['/', '/robots.txt', '/sitemap.xml', '/lead-security/client.js',
             '/web-analytics.js', '/telegram-contact.js']
SEO_RESOURCES = [r'^/tencorp/(?:assets|images|fonts)/',
                 r'^/site-typography/(?:20261119-1|20261122-1)/']
CRAWLER_UA = r'(?:Googlebot(?:-[A-Za-z]+)?|Google-InspectionTool|bingbot|Yandex(?:Bot|MobileBot|Images|Video|RenderResourcesBot|Webmaster|CheckBot))(?:[/;\s)]|$)'


def http_config(addresses, networks_path=ROOT / 'uz-networks.conf', seo=False):
    addresses = sorted({str(ipaddress.ip_address(x)) for x in addresses})
    rules = '\n'.join('    ' + json.dumps('~' + x) + ' 1;' for x in EXCEPTIONS)
    base = '''# DB-IP Country Lite, CC BY 4.0, https://db-ip.com/db/download/ip-to-country-lite
# Generated UZ data; unknown and foreign addresses fail closed.
geo $remote_addr $tencorp_geo_uz {
    default 0;
    include ''' + str(networks_path) + ''';
}
geo $remote_addr $tencorp_geo_internal {
    default 0;
''' + ''.join(f'    {x}/{32 if ":" not in x else 128} 1;\n' for x in addresses) + '''}
map "$request_method:$uri" $tencorp_geo_machine {
    default 0;
''' + rules + '''
}
'''
    if not seo:
        return base + '''map "$tencorp_geo_uz:$tencorp_geo_internal:$tencorp_geo_machine" $tencorp_geo_block {
    default 1;
    ~^1: 0;
    ~^0:1: 0;
    "0:0:1" 0;
}
'''
    return base + '''# Candidate screening is followed by auth_request DNS proof in public SEO locations.
map $uri $tencorp_geo_seo_path {
    default 0;
    /tencorp/assets/projects-map.js 0;
''' + ''.join('    ' + json.dumps(x) + ' 1;\n' for x in SEO_EXACT) + ''.join(
        '    ' + json.dumps('~' + x) + ' 1;\n' for x in SEO_RESOURCES) + '''}
map $http_user_agent $tencorp_geo_crawler_ua {
    default 0;
    ''' + json.dumps('~*' + CRAWLER_UA) + ''' 1;
}
map "$request_method:$tencorp_geo_seo_path:$tencorp_geo_crawler_ua" $tencorp_geo_crawler_candidate {
    default 0;
    ~^(?:GET|HEAD):1:1$ 1;
}
# This URI has an internal-only location. Direct external requests receive 404.
map $uri $tencorp_geo_verification_subrequest {
    default 0;
    /__tencorp-seo-crawler-check 1;
}
map "$tencorp_geo_uz:$tencorp_geo_internal:$tencorp_geo_machine:$tencorp_geo_crawler_candidate:$tencorp_geo_verification_subrequest" $tencorp_geo_block {
    default 1;
    ~^1: 0;
    ~^0:1: 0;
    ~^0:0:1: 0;
    "0:0:0:1:0" 0;
    "0:0:0:0:1" 0;
}
'''


def gate_snippet():
    body = ('<!doctype html><html lang="ru"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Доступ ограничен · TenCorp</title><body>'
            '<main style="max-width:560px;margin:15vh auto;padding:24px;font:17px/1.6 sans-serif">'
            '<p>TenCorp</p><h1>Доступ только из Узбекистана</h1>'
            '<p>Сайт доступен с узбекских IP-адресов. Если вы в Узбекистане, '
            'отключите VPN с зарубежным адресом и попробуйте снова.</p>'
            '<p lang="uz">Sayt faqat O‘zbekiston IP-manzillaridan ochiladi.</p>'
            '<p><a href="https://db-ip.com">IP Geolocation by DB-IP</a></p>'
            '</main></body></html>')
    return '''# A server rewrite gate precedes location returns, static cache and auth.
# A named error handler cannot be invoked as a public URI or query bypass.
error_page 418 = @tencorp_geo_denied;
if ($tencorp_geo_block) { return 418; }
location @tencorp_geo_denied {
    auth_request off;
    default_type text/html;
    charset utf-8;
    add_header Cache-Control "private, no-store" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    return 403 \'''' + body + "';\n}\n"


def patch_site(text):
    if INCLUDE in text:
        raise ValueError('Country gate already installed; run updater, not installer')
    tls = '    server_name form.tencorp.uz;'
    if text.count(tls) != 2:
        raise ValueError('Unexpected production virtual hosts')
    text = text.replace(tls, tls + '\n' + INCLUDE, 1)
    # The existing server-level and privacy filters have separate inheritance.
    lines = text.splitlines()
    output = []
    for line in lines:
        output.append(line)
        if re.match(r"\s*sub_filter '<head>'", line):
            output.append(line[:len(line)-len(line.lstrip())] + FILTER)
    text = '\n'.join(output) + '\n'
    if text.count(FILTER) != 2:
        raise ValueError('Review new sub_filter inheritance before adding attribution')
    # Keep HTTP-01 independent of country and of the canonical HTTPS redirect.
    marker = '\nserver {\n    if ($host = form.tencorp.uz)'
    start = text.find(marker)
    if start < 0:
        raise ValueError('Unexpected HTTP redirect server')
    tail = ' '.join(re.sub(r'#[^\n]*', '', text[start:]).split())
    expected = ('server { if ($host = form.tencorp.uz) { return 301 https://$host$request_uri; } '
                'listen 80; server_name form.tencorp.uz; return 404; }')
    if tail != expected:
        raise ValueError('Unexpected directives after HTTP redirect; review rather than truncate')
    text = text[:start] + '''
server {
    listen 80;
    server_name form.tencorp.uz;
''' + INCLUDE + '''
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
        try_files $uri =404;
    }
    location / { return 301 https://form.tencorp.uz$request_uri; }
}
'''
    return text


def default_site():
    return '''# No unrelated welcome page or alternate hostname bypass.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
''' + INCLUDE + '''
    location / { return 404; }
}
'''


def atomic(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def current_addresses():
    data = json.loads(subprocess.check_output(['ip', '-j', 'addr', 'show', 'scope', 'global']))
    addresses = {'127.0.0.1', '::1'}
    for interface in data:
        for value in interface.get('addr_info', []):
            if value.get('scope') == 'global' and value.get('local'):
                address = ipaddress.ip_address(value['local'])
                if address.is_global:
                    addresses.add(str(address))
    return addresses


def apply(prepared):
    if os.geteuid() != 0:
        raise RuntimeError('Root required')
    ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    rules = (prepared / 'uz-networks.conf').read_bytes()
    manifest = json.loads((prepared / 'manifest.json').read_bytes())
    if manifest.get('configSHA256') != hashlib.sha256(rules).hexdigest():
        raise ValueError('Prepared rules do not match validated manifest')
    # Candidate is produced by the separately tested updater. Revalidate syntax
    # here too; no provider text can become an Nginx directive.
    nets = []
    for line in rules.decode().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if not re.fullmatch(r'[0-9a-fA-F:./]+ 1;', line):
            raise ValueError('Invalid candidate rule')
        nets.append(ipaddress.ip_network(line.split()[0], strict=True))
    if len(nets) < 50 or not any(x.version == 6 for x in nets):
        raise ValueError('Insufficient UZ coverage')
    # No real-IP header trust is presently configured. Adding a CDN must be a
    # separate reviewed change of both geo gate and scanner source-IP policy.
    full = subprocess.check_output(['nginx', '-T'], stderr=subprocess.DEVNULL).decode()
    if re.search(r'^\s*(?:set_real_ip_from|real_ip_header|real_ip_recursive|geoip_proxy)\b', full, re.M):
        raise ValueError('Unexpected real-IP trust configuration; review required')
    site = SITE.resolve(strict=True)
    default = DEFAULT.resolve(strict=True)
    paths = {HTTP: http_config(current_addresses()).encode(), SNIPPET: gate_snippet().encode(),
             site: patch_site(site.read_text()).encode(), default: default_site().encode(),
             ROOT / 'uz-networks.conf': rules,
             ROOT / 'manifest.json': (json.dumps(manifest, indent=2) + '\n').encode()}
    backup = Path('/root/tencorp-geo-access-backups') / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup.mkdir(parents=True, mode=0o700)
    originals = {p: p.read_bytes() if p.exists() else None for p in paths}
    index = []
    for i, (path, value) in enumerate(originals.items()):
        index.append({'path': str(path), 'backup': str(i) if value is not None else None})
        if value is not None:
            (backup / str(i)).write_bytes(value)
    (backup / 'paths.json').write_text(json.dumps(index, indent=2))
    try:
        for path, content in paths.items():
            atomic(path, content)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except BaseException:
        restore(backup)
        raise
    print(json.dumps({'installed': True, 'backup': str(backup),
                      'networks': len(nets), 'rulesSHA256': hashlib.sha256(rules).hexdigest()}))


def restore(backup):
    backup = backup.resolve(strict=True)
    if backup.parent != Path('/root/tencorp-geo-access-backups'):
        raise ValueError('Unexpected rollback directory')
    for item in json.loads((backup / 'paths.json').read_text()):
        path = Path(item['path'])
        if item['backup'] is None:
            path.unlink(missing_ok=True)
        else:
            atomic(path, (backup / item['backup']).read_bytes())
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--apply', type=Path, metavar='PREPARED_DIR')
    group.add_argument('--rollback', type=Path, metavar='BACKUP_DIR')
    args = parser.parse_args()
    fd = os.open('/run/lock/tencorp-geo-access.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
        os.close(fd)
        raise ValueError('Unsafe installer/updater lock')
    with os.fdopen(fd, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.apply:
            apply(args.apply)
        else:
            restore(args.rollback)


if __name__ == '__main__':
    main()
