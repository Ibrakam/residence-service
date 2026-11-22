import importlib.util
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

SPEC = importlib.util.spec_from_file_location('typography', Path(__file__).parents[1] / 'typography/configure-nginx.py')
typography = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(typography)


class TypographyPolicyTests(unittest.TestCase):
    def test_missing_marker_keeps_legacy_font_access(self):
        marker = Mock()
        marker.lstat.side_effect = FileNotFoundError()
        self.assertEqual(typography.public_font_auth(marker), 'tencorp-auth-exempt.conf')

    def test_future_font_deploy_keeps_dns_verification_on_both_versions(self):
        marker = Mock()
        marker.lstat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0)
        marker.read_bytes.return_value = b'main-only-v1\n'
        include = typography.public_font_auth(marker)
        content = ''.join(typography.font_location(v, Path('/fonts'), include)
                          for v in ['20261119-1', '20261122-1'])
        self.assertEqual(content.count('include /etc/nginx/snippets/tencorp-seo-public.conf;'), 2)
        self.assertNotIn('tencorp-auth-exempt.conf', content)

    def test_bad_markers_fail_before_any_configuration_write(self):
        for mode, owner, value in [(stat.S_IFLNK | 0o777, 0, b'main-only-v1\n'),
                                   (stat.S_IFREG | 0o644, 0, b'main-only-v1\n'),
                                   (stat.S_IFREG | 0o600, 1000, b'main-only-v1\n'),
                                   (stat.S_IFREG | 0o600, 0, b'open-everything\n')]:
            marker = Mock()
            marker.lstat.return_value = SimpleNamespace(st_mode=mode, st_uid=owner)
            marker.read_bytes.return_value = value
            with self.assertRaises(ValueError):
                typography.public_font_auth(marker)


if __name__ == '__main__':
    unittest.main()
