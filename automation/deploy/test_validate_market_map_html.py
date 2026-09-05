import importlib.util
import os
import pathlib
import tempfile
import unittest


VALIDATOR_PATH = pathlib.Path(__file__).with_name("validate-market-map-html.py")
SPEC = importlib.util.spec_from_file_location("validate_market_map_html", VALIDATOR_PATH)
VALIDATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VALIDATOR)


class RenderTests(unittest.TestCase):
    def test_key_readiness_requires_a_private_operator_key(self):
        with tempfile.TemporaryDirectory() as directory:
            key_file = pathlib.Path(directory) / "yandex-key"
            key_file.write_text("AQVN-example-domain-key-1234567890\n", encoding="ascii")
            key_file.chmod(0o600)
            self.assertEqual(
                VALIDATOR.read_operator_api_key(key_file.resolve(), required_owner_uid=os.getuid()),
                "AQVN-example-domain-key-1234567890",
            )

    def test_render_substitutes_one_operator_key_and_revalidates_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "source.html"
            destination = root / "rendered.html"
            key_file = root / "yandex-key"
            api_key = "AQVN-example-domain-key-1234567890"
            source.write_text(
                '<!doctype html><html><head><script src="https://api-maps.yandex.ru/2.1/'
                '?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU" defer></script></head>'
                '<body><script>const ready = true;</script></body></html>',
                encoding="utf-8",
            )
            key_file.write_text(f"{api_key}\n", encoding="ascii")
            key_file.chmod(0o600)

            provider = VALIDATOR.render(
                source,
                destination,
                key_file.resolve(),
                required_owner_uid=os.getuid(),
            )
            rendered = destination.read_text(encoding="utf-8")
            self.assertEqual(provider, "yandex-maps-js-2.1")
            self.assertIn(api_key, rendered)
            self.assertNotIn(VALIDATOR.YANDEX_KEY_PLACEHOLDER, rendered)
            self.assertEqual(VALIDATOR.validate(destination, expected_api_key=api_key), provider)

    def test_render_rejects_an_insecure_operator_key_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source = root / "source.html"
            destination = root / "rendered.html"
            key_file = root / "yandex-key"
            source.write_text(
                '<html><head><script src="https://api-maps.yandex.ru/2.1/'
                '?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU" defer></script></head>'
                '<body><script>const ready = true;</script></body></html>',
                encoding="utf-8",
            )
            key_file.write_text("AQVN-example-domain-key-1234567890\n", encoding="ascii")
            key_file.chmod(0o644)

            with self.assertRaisesRegex(SystemExit, "root-owned with mode 0600"):
                VALIDATOR.render(
                    source,
                    destination,
                    key_file.resolve(),
                    required_owner_uid=os.getuid(),
                )
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
