#!/usr/bin/env python3
"""Exercise actual Nginx in an isolated loopback-only instance.

The synthetic source-IP header is trusted ONLY by this temporary test server.
Production uses the socket peer address and contains no such trust directive.
No application endpoints, leads or real scanner bans are invoked.
"""
import argparse
import importlib.util
import ipaddress
import json
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

SPEC = importlib.util.spec_from_file_location('configure_geo', Path(__file__).with_name('configure-nginx.py'))
geo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geo)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('prepared', type=Path)
    parser.add_argument('--port', type=int, default=18087)
    args = parser.parse_args()
    networks = [ipaddress.ip_network(x.split()[0]) for x in
                (args.prepared / 'uz-networks.conf').read_text().splitlines()
                if x.strip() and not x.startswith('#')]
    uz4 = next(str(x.network_address + 1) for x in networks if x.version == 4)
    uz6 = next(str(x.network_address + 1) for x in networks if x.version == 6)
    checks = []
    with tempfile.TemporaryDirectory(prefix='tencorp-geo-nginx-test-') as directory:
        root = Path(directory)
        config = root / 'nginx.conf'
        config.write_text('''pid ''' + str(root / 'nginx.pid') + ''';
error_log ''' + str(root / 'error.log') + ''';
events { worker_connections 32; }
http {
    access_log off;
''' + geo.http_config(['127.0.0.1', '::1', '46.62.227.229'], args.prepared / 'uz-networks.conf') + '''
server {
    listen 127.0.0.1:''' + str(args.port) + ''';
    # TEST ONLY: emulate clients without sending packets from spoofed IPs.
    set_real_ip_from 127.0.0.1;
    real_ip_header X-Test-Address;
''' + geo.gate_snippet() + '''
    location / { return 200 'test-upstream'; }
}
}
''')
        subprocess.run(['nginx', '-t', '-c', str(config), '-p', str(root)], check=True)
        subprocess.run(['nginx', '-c', str(config), '-p', str(root)], check=True)
        try:
            time.sleep(.1)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def check(ip, path, expected, method='GET', headers=None):
                request = urllib.request.Request(f'http://127.0.0.1:{args.port}' + path,
                    method=method, headers={'X-Test-Address': ip, **(headers or {})})
                try:
                    response = opener.open(request, timeout=5)
                except urllib.error.HTTPError as error:
                    response = error
                body = response.read().decode()
                assert response.code == expected, (path, method, response.code, expected)
                if expected == 403:
                    assert response.headers.get('Cache-Control') == 'private, no-store'
                    if method != 'HEAD':
                        assert 'Доступ только из Узбекистана' in body
                    assert response.headers.get('Location') is None
                checks.append({'source': 'uz' if ip in [uz4, uz6] else 'test-foreign-or-internal',
                               'path': path, 'method': method, 'status': response.code})

            for ip in [uz4, uz6, '127.0.0.1', '::1', '46.62.227.229']:
                for path in ['/', '/dormon-hills', '/4u/apartments', '/analytics']:
                    check(ip, path, 200)
            for ip in ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '192.0.2.1']:
                for path in ['/', '/__auth/login', '/__auth/telegram/callback?code=fixture',
                             '/tencorp/assets/projects-map.js', '/site-typography/20261122-1/site-fonts.css',
                             '/residence-api/catalog/', '/api/telegram/start-link', '/dormon-hills/media/example.avif']:
                    check(ip, path, 403)
            for method in ['GET', 'HEAD', 'POST', 'OPTIONS']:
                check('8.8.8.8', '/', 403, method,
                      {'X-Forwarded-For': uz4, 'X-Real-IP': uz4, 'CF-IPCountry': 'UZ', 'CF-Connecting-IP': uz4})
            for path in ['/api/amo-webhook', '/__auth/telegram/bot-webhook', '/api/amocrm/chats/channel_account']:
                check('8.8.8.8', path, 200, 'POST')
                check('8.8.8.8', path, 403, 'GET')
                check('8.8.8.8', path + '/extra', 403, 'POST')
            media = '/api/amocrm/chat-media/12345678-1234-1234-1234-123456789abc'
            for method in ['GET', 'HEAD']:
                check('8.8.8.8', media, 200, method)
                check('8.8.8.8', '/.well-known/acme-challenge/test-token', 200, method)
            check('8.8.8.8', media, 403, 'POST')
            check('8.8.8.8', '/.well-known/acme-challenge/../index.html', 403)
            check('8.8.8.8', '/.well-known/acme-challenge/', 403)
            check('8.8.8.8', '/__residence-ticket-worker/internal/ticket-runner/health', 200)
            check('8.8.8.8', '/__residence-ticket-worker/internal/ticket-runner/lease', 200, 'POST')
            check('8.8.8.8', '/__residence-ticket-worker/analytics', 403)
            print(json.dumps({'passed': len(checks), 'checks': checks}))
        finally:
            subprocess.run(['nginx', '-s', 'quit', '-c', str(config), '-p', str(root)], check=True)
            for _ in range(30):
                if not (root / 'nginx.pid').exists():
                    break
                time.sleep(.1)


if __name__ == '__main__':
    main()
