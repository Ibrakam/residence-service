import importlib.util
from pathlib import Path
import re
import unittest
import xml.etree.ElementTree as ET


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


seo = module('seo', 'configure-seo-main.py')
geo = seo.geo


def seo_path(path):
    if path == '/tencorp/assets/projects-map.js':
        return False
    return path in geo.SEO_EXACT or any(re.match(pattern, path) for pattern in geo.SEO_RESOURCES)


class MainSEOTests(unittest.TestCase):
    def test_only_main_page_and_public_render_resources(self):
        for path in ['/', '/robots.txt', '/sitemap.xml', '/tencorp/assets/index-abc.js',
                     '/tencorp/images/hero.jpeg', '/tencorp/fonts/manrope.woff2',
                     '/site-typography/20261122-1/site-fonts.css', '/lead-security/client.js']:
            self.assertTrue(seo_path(path), path)
        for path in ['/4u', '/dormon-hills', '/analytics', '/privacy', '/tencorp/',
                     '/residence-api/catalog/', '/__auth/me', '/v1/leads',
                     '/tencorp/assets/projects-map.js', '/lead-security/challenge',
                     '/site-typography/unknown/font.woff2']:
            self.assertFalse(seo_path(path), path)

    def test_robots_open_only_homepage(self):
        text = seo.robots()
        self.assertIn('Disallow: /\n', text)
        self.assertIn('Allow: /$\n', text)
        self.assertIn('Disallow: /tencorp/assets/projects-map.js\n', text)
        self.assertNotIn('Allow: /\n', text)
        self.assertNotIn('Allow: /4u', text)
        self.assertEqual(text.count('Sitemap:'), 1)

    def test_sitemap_contains_exactly_root(self):
        tree = ET.fromstring(seo.sitemap())
        urls = [node.text for node in tree.findall('.//{*}loc')]
        self.assertEqual(urls, ['https://form.tencorp.uz/'])

    def test_geo_candidate_requires_read_method_and_dns_auth_request(self):
        config = geo.http_config(['127.0.0.1'], seo=True)
        self.assertIn('~^(?:GET|HEAD):1:1$', config)
        self.assertIn('/tencorp/assets/projects-map.js 0;', config)
        self.assertIn('auth_request /__tencorp-seo-crawler-check;', seo.public_snippet())
        self.assertNotIn('auth_request off', seo.public_snippet())
        self.assertIn('proxy_set_header X-Real-IP $remote_addr;', seo.gateway_snippet())
        self.assertIn('proxy_set_header Cookie "";', seo.gateway_snippet())
        self.assertIn('internal;', seo.gateway_snippet())
        self.assertIn('proxy_pass http://127.0.0.1:4360/verify;', seo.gateway_snippet())

    def test_verifier_failure_never_becomes_cacheable_content(self):
        self.assertIn('error_page 403 = @tencorp_geo_denied;', seo.public_snippet())
        self.assertIn('error_page 500 502 503 504 = @tencorp_seo_verification_unavailable;', seo.public_snippet())
        self.assertIn('return 503', seo.gateway_snippet())
        self.assertIn('Cache-Control "private, no-store"', seo.gateway_snippet())

    def test_public_location_replacement_preserves_other_auth(self):
        text = '''location = / {
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    root /public;
}
location = /tencorp/assets/projects-map.js {
    include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
}
'''
        new = seo.replace_public_block(text, 'location = /')
        self.assertEqual(new.count(seo.PUBLIC_INCLUDE), 1)
        self.assertIn('include /etc/nginx/snippets/tencorp-auth-protect-api.conf;', new)
        with self.assertRaises(ValueError):
            seo.replace_public_block(text, 'location = /not-existing')


if __name__ == '__main__':
    unittest.main()
