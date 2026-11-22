#!/usr/bin/env python3
"""Allow verified search crawlers only on the public TenCorp homepage.

This does not exempt bots from residence, account, map or API authentication.
"""
import argparse
import datetime as dt
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import time

SPEC = importlib.util.spec_from_file_location('geo', Path(__file__).with_name('configure-nginx.py'))
geo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geo)
PUBLIC_INCLUDE = 'include /etc/nginx/snippets/tencorp-seo-public.conf;'
GATEWAY_INCLUDE = '    include /etc/nginx/snippets/tencorp-seo-gateway.conf;'
CONTENT = Path('/opt/tencorp-geo-access/seo')
MARKER = geo.ROOT / 'seo-main-enabled'


def robots():
    return '''# Only the public TenCorp homepage is open for indexing.
User-agent: *
Disallow: /
Allow: /$
Allow: /tencorp/assets/
Disallow: /tencorp/assets/projects-map.js
Allow: /tencorp/images/
Allow: /tencorp/fonts/
Allow: /site-typography/
Allow: /lead-security/client.js$
Allow: /telegram-contact.js$
Allow: /web-analytics.js$
Allow: /robots.txt$
Allow: /sitemap.xml$
Sitemap: https://form.tencorp.uz/sitemap.xml
'''


def sitemap():
    return '''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://form.tencorp.uz/</loc></url></urlset>
'''


def public_snippet():
    return '''# Only include in already-public main-homepage content locations.
# UZ/local requests return 204 in Nginx without calling the DNS verifier.
auth_request /__tencorp-seo-crawler-check;
error_page 403 = @tencorp_geo_denied;
error_page 500 502 503 504 = @tencorp_seo_verification_unavailable;
proxy_set_header Cookie "";
proxy_set_header X-Auth-User-ID "";
proxy_set_header X-Auth-Telegram-ID "";
proxy_set_header X-Auth-Phone "";
proxy_hide_header Set-Cookie;
'''


def gateway_snippet():
    return '''location = /__tencorp-seo-crawler-check {
    internal;
    auth_request off;
    if ($tencorp_geo_uz) { return 204; }
    if ($tencorp_geo_internal) { return 204; }
    proxy_pass http://127.0.0.1:4360/verify;
    proxy_method GET;
    proxy_pass_request_body off;
    proxy_pass_request_headers off;
    proxy_set_header Content-Length "";
    proxy_set_header Host "crawler-verifier";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header User-Agent $http_user_agent;
    proxy_set_header Cookie "";
    proxy_set_header Authorization "";
    proxy_set_header Connection "";
    proxy_connect_timeout 1s;
    proxy_read_timeout 6s;
    proxy_send_timeout 2s;
    proxy_intercept_errors off;
    access_log off;
    error_log /dev/null emerg;
}
location @tencorp_seo_verification_unavailable {
    auth_request off;
    default_type text/plain;
    add_header Cache-Control "private, no-store" always;
    add_header Retry-After "60" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    return 503 'Crawler verification is temporarily unavailable. Please retry.\n';
}
'''


def replace_public_block(text, signature):
    pattern = re.compile(r'(' + re.escape(signature) + r' \{\n)(.*?)(\n\})', re.S)
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise ValueError('Unexpected public location: ' + signature)
    match = matches[0]
    body = match[2]
    old_include = 'include /etc/nginx/snippets/tencorp-auth-exempt.conf;'
    if body.count(old_include) == 1:
        body = body.replace(old_include, PUBLIC_INCLUDE)
    elif body.count('auth_request off;') == 1:
        body = body.replace('auth_request off;', PUBLIC_INCLUDE)
    else:
        raise ValueError('Expected an already-public auth boundary: ' + signature)
    return text[:match.start()] + match[1] + body + match[3] + text[match.end():]


def patch_site(text):
    if GATEWAY_INCLUDE in text:
        raise ValueError('Homepage SEO already installed')
    if text.count(geo.INCLUDE) != 2:
        raise ValueError('Expected installed geo protection on both form virtual hosts')
    text = text.replace(geo.INCLUDE, geo.INCLUDE + '\n' + GATEWAY_INCLUDE, 1)
    old_robots = '''    location = /robots.txt {
        include /etc/nginx/snippets/tencorp-auth-exempt.conf;
        default_type text/plain;
        return 200 "User-agent: *\\nDisallow: /\\n";
    }'''
    old_sitemap = '''    location = /sitemap.xml {
        return 404;
    }'''
    if text.count(old_robots) != 1 or text.count(old_sitemap) != 1:
        raise ValueError('Unexpected prior robots/sitemap contract')
    for name, old, mime in [('robots.txt', old_robots, 'text/plain'), ('sitemap.xml', old_sitemap, 'application/xml')]:
        new = f'''    location = /{name} {{
        {PUBLIC_INCLUDE}
        if ($request_method !~ ^(?:GET|HEAD)$) {{ return 405; }}
        alias {CONTENT}/{name};
        types {{ }}
        default_type {mime};
        add_header Cache-Control "public, max-age=300" always;
        add_header Strict-Transport-Security "max-age=31536000" always;
        add_header X-Content-Type-Options "nosniff" always;
    }}'''
        text = text.replace(old, new)
    return text


def install():
    if os.geteuid() != 0:
        raise PermissionError('Root required')
    # Fail before changing Nginx if the verifier is not healthy.
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*',
                    '--max-time', '3', 'http://127.0.0.1:4360/health'], check=True, capture_output=True)
    site = geo.SITE.resolve(strict=True)
    snippets = Path('/etc/nginx/snippets')
    home = snippets / 'residence-root-route.conf'
    typography = snippets / 'tencorp-typography.conf'
    lead = snippets / 'tencorp-lead-security-locations.conf'
    analytics = snippets / 'tencorp-web-analytics-locations.conf'
    workflow = snippets / 'tencorp-workflow-locations.conf'
    old_http = geo.HTTP.read_text()
    if old_http != geo.http_config(geo.current_addresses(), seo=False):
        raise ValueError('Geo configuration changed; review before replacing it')
    home_text = home.read_text()
    for location in ['location = /', 'location ^~ /tencorp/assets/',
                     'location ^~ /tencorp/fonts/', 'location ^~ /tencorp/images/']:
        home_text = replace_public_block(home_text, location)
    typography_text = typography.read_text()
    for version in ['20261119-1', '20261122-1']:
        typography_text = replace_public_block(typography_text, f'location ^~ /site-typography/{version}/')
    paths = {
        geo.HTTP: geo.http_config(geo.current_addresses(), seo=True).encode(),
        snippets / 'tencorp-seo-public.conf': public_snippet().encode(),
        snippets / 'tencorp-seo-gateway.conf': gateway_snippet().encode(),
        site: patch_site(site.read_text()).encode(), home: home_text.encode(),
        typography: typography_text.encode(),
        lead: replace_public_block(lead.read_text(), 'location = /lead-security/client.js').encode(),
        analytics: replace_public_block(analytics.read_text(), 'location = /web-analytics.js').encode(),
        workflow: replace_public_block(workflow.read_text(), 'location = /telegram-contact.js').encode(),
        CONTENT / 'robots.txt': robots().encode(), CONTENT / 'sitemap.xml': sitemap().encode(),
        MARKER: b'main-only-v1\n',
    }
    backup = Path('/root/tencorp-geo-access-backups') / ('seo-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(parents=True, mode=0o700)
    index = []
    for i, path in enumerate(paths):
        old = path.read_bytes() if path.exists() else None
        index.append({'path': str(path), 'backup': str(i) if old is not None else None})
        if old is not None:
            (backup / str(i)).write_bytes(old)
    (backup / 'paths.json').write_text(json.dumps(index, indent=2))
    try:
        for path, content in paths.items():
            if path != MARKER:
                geo.atomic(path, content)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        for name, expected in [('robots.txt', robots()), ('sitemap.xml', sitemap())]:
            # `nginx -s reload` acknowledges the signal before new workers have
            # replaced old keep-alive listeners. Poll the exact contract rather
            # than treating one old-worker response as a failed deployment.
            matched = False
            for _attempt in range(20):
                result = subprocess.run(['curl', '--fail', '--silent', '--show-error', '--noproxy', '*',
                    '--max-time', '3', '--resolve', 'form.tencorp.uz:443:127.0.0.1',
                    '--dump-header', '-', 'https://form.tencorp.uz/' + name], check=False, capture_output=True)
                headers, _separator, body = result.stdout.partition(b'\r\n\r\n')
                mime = b'text/plain' if name == 'robots.txt' else b'application/xml'
                if (result.returncode == 0 and body == expected.encode()
                        and b'\r\ncontent-type: ' + mime in headers.lower()):
                    matched = True
                    break
                time.sleep(.25)
            if not matched:
                raise ValueError('Live main-only SEO contract failed: ' + name)
        geo.atomic(MARKER, paths[MARKER])
        MARKER.chmod(0o600)
    except BaseException:
        geo.restore(backup)
        raise
    print(json.dumps({'seoScope': 'main-homepage-only', 'backup': str(backup),
                      'authBypassForBots': False, 'sitemapURLs': 1}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_mutually_exclusive_group(required=True)
    actions.add_argument('--apply', action='store_true')
    actions.add_argument('--rollback', type=Path)
    args = parser.parse_args()
    fd = os.open('/run/lock/tencorp-geo-access.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    info = os.fstat(fd)
    if info.st_uid != 0 or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_nlink != 1:
        os.close(fd)
        raise ValueError('Unsafe shared geo lock')
    with os.fdopen(fd, 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.apply:
            install()
        else:
            geo.restore(args.rollback)


if __name__ == '__main__':
    main()
