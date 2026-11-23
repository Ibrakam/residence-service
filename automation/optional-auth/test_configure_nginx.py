import importlib.util
from pathlib import Path
import re
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('optional', Path(__file__).with_name('configure-nginx.py'))
config = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config)


class OptionalAccessTests(unittest.TestCase):
    def test_only_reviewed_published_catalog_paths_are_public(self):
        selector = next(m['selector'] for m, _ in config.locations(config.public_catalog()))
        pattern = selector.removeprefix('~ ')
        for prefix in ['/residence-api/catalog', '/tencrop/api/catalog']:
            for slug in config.PUBLISHED_PROJECTS.split('|'):
                for suffix in ['', '/units', '/layouts', '/availability', '/floor-schemes']:
                    self.assertTrue(re.match(pattern, prefix + '/v1/projects/' + slug + suffix))
            for path in ['/v1/projects/new-secret-import', '/v1/units/1', '/v1/projects',
                         '/v1/analytics/monthly-sales', '/v1/project-registry', '/v1/sync/status',
                         '/v1/sync/catalog-status', '/v1/projects/4u/secrets']:
                self.assertFalse(re.match(pattern, prefix + path), path)

    def test_catalog_health_uses_only_filtered_frontend_projection(self):
        text = config.public_catalog_health()
        self.assertEqual(text.count('proxy_pass http://127.0.0.1:4320/api/public-catalog-status;'), 2)
        self.assertNotIn('proxy_pass http://127.0.0.1:4300', text)

    def test_public_reads_cannot_post_and_strip_credentials(self):
        text = config.read_snippet()
        self.assertIn('auth_request off;', text)
        self.assertIn('GET|HEAD|OPTIONS', text)
        for header in ['Cookie', 'Authorization', 'X-Auth-User-ID', 'X-Auth-Telegram-ID', 'X-Auth-Phone']:
            self.assertIn('proxy_set_header ' + header + ' "";', text)

    def test_public_leads_keep_guard_nonce_cookie_at_loopback_only(self):
        text = config.write_snippet()
        self.assertIn('auth_request off;', text)
        self.assertNotIn('proxy_set_header Cookie "";', text)
        self.assertIn('Turnstile', text)

    def test_marker_only_for_consumer_html(self):
        text = config.markup_map()
        self.assertIn('200:', text)
        self.assertIn('tencorp-auth-mode', text)
        self.assertIn('sanat|tencrop', text)
        self.assertNotIn('|analytics|', text)
        self.assertNotIn('|__auth|', text)

    def test_parser_handles_nested_if_and_quoted_braces(self):
        text = '''location = /published {
    include /etc/nginx/snippets/tencorp-auth-protect-page.conf;
    if ($uri ~ "/\\.") { return 404; }
    add_header X-Test "quoted { braces }";
}
location = /private {
    include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
}
'''
        new = config.patch_locations(text, {'= /published'})
        self.assertEqual(new.count(config.READ_INCLUDE), 1)
        self.assertIn('include /etc/nginx/snippets/tencorp-auth-protect-api.conf;', new)
        self.assertIn('if ($uri ~ "/\\.") { return 404; }', new)
        with self.assertRaises(ValueError): config.patch_locations(text, {'= /unknown'})

    def test_analytics_bundles_open_without_opening_generic_framework_or_data(self):
        private = '''location ^~ /_next/ {
    include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
    proxy_pass http://127.0.0.1:3000;
}
location = /analytics {
    proxy_pass http://127.0.0.1:3000;
}
'''
        static = '''location ^~ /_next/static/ {
    include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
    proxy_pass http://127.0.0.1:3000;
}
'''
        result = config.patch_analytics_assets(static + private)
        self.assertTrue(result.endswith(private))
        self.assertIn('GET|HEAD)$', result)
        self.assertIn('proxy_set_header Authorization "";', result)
        self.assertIn('proxy_set_header Cookie "";', result)
        self.assertIn('proxy_hide_header Set-Cookie;', result)
        self.assertNotIn('GET|HEAD|OPTIONS', result)
        with self.assertRaises(ValueError): config.patch_analytics_assets(result)

    def test_edge_verification_checks_public_and_private_without_credentials(self):
        seen = []
        def probe(path):
            seen.append(path)
            return 200 if path in ['/4u', '/dormon-hills', '/sanat/flats',
                '/residence-api/catalog/v1/projects/4u/units',
                '/tencrop/api/catalog/v1/projects/avalon-residence/units'] else 401
        with patch.object(config, 'edge_status', side_effect=probe): config.verify_edge()
        self.assertIn('/__auth/me', seen)
        self.assertIn('/tencorp/assets/projects-map.js', seen)
        self.assertIn('/residence-api/catalog/v1/units/1', seen)
        with patch.object(config, 'edge_status', return_value=200), patch.object(config.time, 'monotonic', side_effect=[0, 31]):
            with self.assertRaises(ValueError): config.verify_edge()

    def test_source_published_contracts_stay_aligned(self):
        source = (Path(__file__).parents[2] / 'backend/internal/httpapi/project_registry.go').read_text()
        block = source.split('var publishedSalesSiteRoutes =', 1)[1].split('\n}', 1)[0]
        expected = set(re.findall(r'^\s*"([a-z0-9-]+)":', block, re.M))
        self.assertEqual(set(config.PUBLISHED_PROJECTS.split('|')), expected)


if __name__ == '__main__':
    unittest.main()
