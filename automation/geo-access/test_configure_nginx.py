import importlib.util
from pathlib import Path
import re
import unittest

SPEC = importlib.util.spec_from_file_location('configure_geo', Path(__file__).with_name('configure-nginx.py'))
geo = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(geo)


class GateTests(unittest.TestCase):
    def exempt(self, method, path):
        return any(re.fullmatch(rule, method + ':' + path) for rule in geo.EXCEPTIONS)

    def test_machine_methods_are_narrow(self):
        for path in ['/api/amo-webhook', '/__auth/telegram/bot-webhook', '/api/amocrm/chats/channel_account']:
            self.assertTrue(self.exempt('POST', path))
            for method in ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']:
                self.assertFalse(self.exempt(method, path))
            self.assertFalse(self.exempt('POST', path + '/extra'))
            self.assertFalse(self.exempt('POST', path + '/'))

    def test_browser_routes_never_exempt(self):
        for path in ['/', '/4u', '/dormon-hills', '/analytics', '/__auth/me', '/__auth/login',
                     '/__auth/telegram/start', '/__auth/telegram/callback', '/api/telegram/start-link',
                     '/api/submit', '/v1/leads', '/__tencorp-auth/check', '/?country=UZ',
                     '/api/amocrm/chats/x/../../analytics']:
            for method in ['GET', 'HEAD', 'POST']:
                self.assertFalse(self.exempt(method, path), (method, path))

    def test_media_capabilities_only(self):
        path = '/api/amocrm/chat-media/12345678-1234-1234-1234-123456789abc'
        self.assertTrue(self.exempt('GET', path))
        self.assertTrue(self.exempt('HEAD', path))
        self.assertFalse(self.exempt('POST', path))
        self.assertFalse(self.exempt('GET', path + '/extra'))
        self.assertFalse(self.exempt('GET', '/api/amocrm/chat-media/invalid'))

    def test_acme_does_not_exempt_well_known_pages(self):
        self.assertTrue(self.exempt('GET', '/.well-known/acme-challenge/valid_Token-1'))
        self.assertTrue(self.exempt('HEAD', '/.well-known/acme-challenge/valid'))
        for path in ['/.well-known/', '/.well-known/acme-challenge/', '/.well-known/acme-challenge/x/../',
                     '/.well-known/acme-challenge/../index.html', '/.well-known/acme-challenge/.env']:
            self.assertFalse(self.exempt('GET', path))

    def test_worker_does_not_exempt_arbitrary_content(self):
        self.assertTrue(self.exempt('POST', '/__residence-ticket-worker/internal/ticket-runner/tickets/1/heartbeat'))
        self.assertTrue(self.exempt('GET', '/__residence-ticket-worker/internal/ticket-runner/tickets/1/attachments/2'))
        for path in ['/__residence-ticket-worker/', '/__residence-ticket-worker/analytics',
                     '/__residence-ticket-worker/internal/ticket-runner/tickets/1/attachments/2/extra']:
            self.assertFalse(self.exempt('GET', path))

    def test_real_connection_address_and_closed_defaults(self):
        config = geo.http_config(['127.0.0.1', '::1', '46.62.227.229'])
        self.assertEqual(config.count('geo $remote_addr'), 2)
        self.assertNotIn('$http_', config)
        self.assertNotIn('proxy_recursive', config)
        self.assertIn('default 1;', config)
        self.assertIn('46.62.227.229/32 1;', config)
        self.assertNotIn('46.62.227.0/24', config)
        self.assertNotIn('10.0.0.0/8', config)

    def test_denial_never_redirects_or_caches(self):
        config = geo.gate_snippet()
        self.assertIn('return 403', config)
        self.assertIn('private, no-store', config)
        self.assertIn('location @tencorp_geo_denied', config)
        self.assertNotIn('error_page 403', config)
        self.assertNotIn('$http_', config)

    def test_site_patch_preserves_security_and_acme(self):
        fixture = '''server {
    server_name form.tencorp.uz;
    sub_filter '<head>' '<head>SECURITY';
    location = /privacy {
        sub_filter '<head>' '<head>PRIVACY';
    }
    auth_request /__tencorp-auth/check;
    listen 443 ssl;
}
server {
    if ($host = form.tencorp.uz) {
        return 301 https://$host$request_uri;
    }
    listen 80;
    server_name form.tencorp.uz;
    return 404;
}
'''
        result = geo.patch_site(fixture)
        self.assertEqual(result.count(geo.INCLUDE), 2)
        self.assertEqual(result.count(geo.FILTER), 2)
        self.assertIn('<head>SECURITY', result)
        self.assertIn('auth_request /__tencorp-auth/check;', result)
        self.assertIn('location ^~ /.well-known/acme-challenge/', result)
        self.assertNotIn('if ($host', result)
        with self.assertRaises(ValueError):
            geo.patch_site(result)


if __name__ == '__main__':
    unittest.main()
