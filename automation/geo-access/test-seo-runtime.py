#!/usr/bin/env python3
"""Isolated Nginx + real loopback verifier; no production request spoofing."""
import argparse
import importlib.util
import ipaddress
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

SPEC = importlib.util.spec_from_file_location('seo', Path(__file__).with_name('configure-seo-main.py'))
seo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(seo)
geo = seo.geo


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--networks', type=Path, default=Path('/etc/tencorp-geo-access/uz-networks.conf'))
    parser.add_argument('--port', type=int, default=18088)
    args = parser.parse_args()
    uz = next(str(ipaddress.ip_network(x.split()[0]).network_address + 1)
              for x in args.networks.read_text().splitlines() if x and not x.startswith('#') and ':' not in x)
    checks = []
    with tempfile.TemporaryDirectory(prefix='tencorp-seo-runtime-') as directory:
        root = Path(directory)
        root.chmod(0o755)
        for name, content in [('public.html', 'public-main-only'), ('private.txt', 'private-test-fixture'),
                              ('robots.txt', seo.robots()), ('sitemap.xml', seo.sitemap()), ('public.js', '/*public*/')]:
            (root / name).write_text(content)
            (root / name).chmod(0o644)
        for name in ['tencorp/assets/index-test.js', 'site-typography/20261122-1/site-fonts.css']:
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            file.write_text('/*public*/')
            file.chmod(0o644)
        config = root / 'nginx.conf'

        def write_config(unavailable=False):
            gateway = seo.gateway_snippet().replace('127.0.0.1:4360', '127.0.0.1:1') if unavailable else seo.gateway_snippet()
            config.write_text(f'''pid {root}/nginx.pid;
error_log {root}/error.log;
events {{ worker_connections 64; }}
http {{
access_log off;
''' + geo.http_config(['127.0.0.1', '::1'], args.networks, seo=True) + f'''
server {{
listen 127.0.0.1:{args.port};
# Synthetic source header belongs only to this temporary loopback test instance.
set_real_ip_from 127.0.0.1;
real_ip_header X-Test-Address;
''' + geo.gate_snippet() + gateway + f'''
location = / {{
{seo.public_snippet()}
root {root};
try_files /public.html =404;
}}
location = /robots.txt {{
{seo.public_snippet()}
alias {root}/robots.txt;
}}
location = /sitemap.xml {{
{seo.public_snippet()}
alias {root}/sitemap.xml;
}}
location = /tencorp/assets/projects-map.js {{
auth_request /__test-protected;
alias {root}/private.txt;
}}
location = /__test-protected {{ internal; return 401; }}
location ^~ /tencorp/assets/ {{
{seo.public_snippet()}
root {root};
}}
location ^~ /site-typography/20261122-1/ {{
{seo.public_snippet()}
root {root};
}}
location / {{ return 404; }}
}}
}}
''')

        write_config()
        subprocess.run(['nginx', '-t', '-c', str(config), '-p', str(root)], check=True)
        subprocess.run(['nginx', '-c', str(config), '-p', str(root)], check=True)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def check(ip, ua, path, status, method='GET', extra=None):
            request = urllib.request.Request(f'http://127.0.0.1:{args.port}' + path, method=method,
                headers={'X-Test-Address': ip, 'User-Agent': ua, **(extra or {})})
            try:
                response = opener.open(request, timeout=12)
            except urllib.error.HTTPError as error:
                response = error
            body = response.read()
            assert response.code == status, (path, ua, response.code, status)
            if status in [403, 503]:
                assert response.headers.get('Cache-Control') == 'private, no-store'
                assert b'public-main-only' not in body and b'private-test-fixture' not in body
            if status == 503:
                assert response.headers.get('Retry-After') == '60'
            if status == 200 and path == '/sitemap.xml':
                assert [n.text for n in ET.fromstring(body).findall('.//{*}loc')] == ['https://form.tencorp.uz/']
            checks.append({'path': path, 'status': status, 'method': method,
                           'identity': 'test-' + ('UZ' if ip == uz else ua.split('/')[0])})

        try:
            time.sleep(.1)
            for path in ['/', '/robots.txt', '/sitemap.xml']:
                check(uz, 'Mozilla/5.0', path, 200)
                check('8.8.8.8', 'Mozilla/5.0', path, 403)
            for ua in ['Googlebot/2.1', 'bingbot/2.0', 'YandexBot/3.0']:
                check('8.8.8.8', ua, '/', 403, extra={'X-Forwarded-For': uz, 'X-Real-IP': uz, 'CF-IPCountry': 'UZ'})
            for path in ['/', '/tencorp/assets/index-test.js']:
                for method in ['GET', 'HEAD']:
                    for headers in [{'If-None-Match': '*'}, {'Range': 'bytes=0-4'},
                                    {'If-Modified-Since': 'Wed, 01 Jan 2031 00:00:00 GMT'}]:
                        check('8.8.8.8', 'Googlebot/2.1', path, 403, method=method, extra=headers)
                check('66.249.66.1', 'Googlebot/2.1', path, 304, extra={'If-None-Match': '*'})
                check('66.249.66.1', 'Googlebot/2.1', path, 206, extra={'Range': 'bytes=0-4'})
            for ip, ua in [('66.249.66.1', 'Googlebot/2.1'), ('157.55.39.1', 'bingbot/2.0'), ('77.88.5.251', 'YandexBot/3.0')]:
                for path in ['/', '/robots.txt', '/sitemap.xml', '/tencorp/assets/index-test.js', '/site-typography/20261122-1/site-fonts.css']:
                    check(ip, ua, path, 200)
                check(ip, ua, '/', 200, method='HEAD')
                check(ip, 'Mozilla/5.0', '/', 403)
                for path in ['/4u', '/dormon-hills', '/analytics', '/__auth/me', '/residence-api/catalog/', '/tencorp/assets/projects-map.js']:
                    check(ip, ua, path, 403)
                check(ip, ua, '/', 403, method='POST')
            check('2001:4860:4860::8888', 'Googlebot/2.1', '/', 403)
            check(uz, 'Mozilla/5.0', '/tencorp/assets/projects-map.js', 401)
            check('8.8.8.8', 'Googlebot/2.1', '/__tencorp-seo-crawler-check', 404)
            # A stopped verifier never opens the page or makes UZ visitors wait.
            write_config(unavailable=True)
            subprocess.run(['nginx', '-t', '-c', str(config), '-p', str(root)], check=True)
            subprocess.run(['nginx', '-s', 'reload', '-c', str(config), '-p', str(root)], check=True)
            time.sleep(.3)
            check('66.249.66.1', 'Googlebot/2.1', '/', 503)
            check(uz, 'Mozilla/5.0', '/', 200)
            check('66.249.66.1', 'Googlebot/2.1', '/4u', 403)
            print(json.dumps({'passed': len(checks), 'realDNSProviders': ['Google', 'Bing', 'Yandex'], 'checks': checks}))
        except BaseException:
            print((root / 'error.log').read_text()[-8000:], file=sys.stderr)
            raise
        finally:
            subprocess.run(['nginx', '-s', 'quit', '-c', str(config), '-p', str(root)], check=True)
            for _ in range(30):
                if not (root / 'nginx.pid').exists():
                    break
                time.sleep(.1)


if __name__ == '__main__':
    main()
