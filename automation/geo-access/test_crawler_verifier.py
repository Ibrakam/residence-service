import concurrent.futures
import importlib.util
import json
from pathlib import Path
import socket
import subprocess
import threading
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('crawler', Path(__file__).with_name('crawler-verifier.py'))
crawler = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(crawler)

V4 = '66.249.66.1'
V6 = '2001:4860:4801:10::1'


class DNS(unittest.TestCase):
    def answer(self, ip, host, forward, provider='google'):
        family = socket.AF_INET6 if ':' in forward else socket.AF_INET
        with patch.object(socket, 'gethostbyaddr', return_value=(host, [], [ip])), \
             patch.object(socket, 'getaddrinfo', return_value=[(family, 1, 6, '', (forward, 0))]):
            return crawler.dns_status(ip, provider)

    def test_valid_reverse_and_forward_v4_v6(self):
        for ip in (V4, V6):
            self.assertEqual(self.answer(ip, 'crawl-1.googlebot.com.', ip), 204)

    def test_suffix_spoofs_and_bare_domain(self):
        for host in ('evilgooglebot.com', 'googlebot.com', 'crawl.googlebot.com.evil.com',
                     'crawl..googlebot.com', '-crawl.googlebot.com', 'a_googlebot.com',
                     'crawl.googlébot.com', 'crawl.google.com'):
            with self.subTest(host=host):
                self.assertEqual(self.answer(V4, host, V4), 403)

    def test_forward_mismatch(self):
        self.assertEqual(self.answer(V4, 'crawl.googlebot.com', '8.8.8.8'), 403)
        self.assertEqual(self.answer(V6, 'crawl.googlebot.com', '2001:4860:4801:10::2'), 403)

    def test_provider_suffix_separation(self):
        for provider, host in [('bing', 'crawler.search.msn.com'), ('yandex', 'spider.yandex.ru'),
                               ('yandex', 'spider.yandex.net'), ('yandex', 'spider.yandex.com'),
                               ('google-inspection', 'rate-limited-proxy-1.google.com'),
                               ('google-inspection', 'google-proxy-1.google.com'),
                               ('google-inspection', 'crawl.googlebot.com')]:
            self.assertEqual(self.answer(V4, host, V4, provider), 204)
        self.assertEqual(self.answer(V4, 'crawl.googlebot.com', V4, 'bing'), 403)
        self.assertEqual(self.answer(V4, 'crawl.google.com', V4, 'google'), 403)
        self.assertEqual(self.answer(V4, 'unrelated.google.com', V4, 'google-inspection'), 403)
        self.assertEqual(self.answer(V4, 'google-proxy-1.googleusercontent.com', V4, 'google-inspection'), 403)

    def test_nxdomain_vs_transient_reverse(self):
        for error, expected in [(socket.herror(1, 'absent'), 403), (socket.herror(2, 'retry'), 503),
                                (TimeoutError(), 503), (OSError(), 503)]:
            with patch.object(socket, 'gethostbyaddr', side_effect=error):
                self.assertEqual(crawler.dns_status(V4, 'google'), expected)

    def test_nxdomain_vs_transient_forward(self):
        with patch.object(socket, 'gethostbyaddr', return_value=('crawl.googlebot.com', [], [])):
            for error, expected in [(socket.gaierror(socket.EAI_NONAME, 'absent'), 403),
                                    (socket.gaierror(socket.EAI_AGAIN, 'retry'), 503)]:
                with patch.object(socket, 'getaddrinfo', side_effect=error):
                    self.assertEqual(crawler.dns_status(V4, 'google'), expected)

    def test_bad_addresses_never_resolve(self):
        with patch.object(socket, 'gethostbyaddr') as resolve:
            for address in ('127.0.0.1', '10.1.1.1', '::1', 'fe80::1', '192.0.2.1',
                            '224.0.0.1', 'ff02::1', '240.1.2.3', '0.0.0.0',
                            '8.8.8.8/32', '8.8.8.8 ', '8.8.8.8%lo', None):
                self.assertEqual(crawler.dns_status(address, 'google'), 403)
            resolve.assert_not_called()

    def test_child_timeout_and_malformed_output(self):
        with patch.object(subprocess, 'run', side_effect=subprocess.TimeoutExpired('dns', 4)):
            self.assertEqual(crawler.resolve_subprocess(V4, 'google'), 503)
        for body in (b'{}', b'{"status":true}', b'{"status":200}', b'x' * 129, b'not json'):
            with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, body)):
                self.assertEqual(crawler.resolve_subprocess(V4, 'google'), 503)

    def test_child_process_command_is_bounded_and_no_shell(self):
        with patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'{"status":204}')) as run:
            self.assertEqual(crawler.resolve_subprocess(V4, 'google'), 204)
        args, kw = run.call_args
        self.assertEqual(args[0][-3:], ['--resolve', V4, 'google'])
        self.assertEqual(kw['timeout'], 4)
        self.assertFalse(kw.get('shell', False))
        self.assertEqual(kw['stderr'], subprocess.DEVNULL)


class Cache(unittest.TestCase):
    def test_UA_candidates_and_rejection(self):
        for ua, expected in [('Googlebot/2.1', 'google'), ('Googlebot-Image/1.0', 'google'),
                              ('Googlebot-Video/1.0', 'google'), ('Google-InspectionTool/1.0', 'google-inspection'),
                              ('bingbot/2.0', 'bing'), ('YandexBot/3.0', 'yandex'),
                              ('YandexMobileBot/3.0', 'yandex'), ('YandexImages/3.0', 'yandex'),
                              ('YandexVideo/3.0', 'yandex'), ('YandexRenderResourcesBot/1.0', 'yandex'),
                              ('YandexWebmaster/2.0', 'yandex'), ('YandexCheckBot/2.0', 'yandex')]:
            self.assertEqual(crawler.provider_for(ua), expected)
        for ua in ('Googlebot-Fake', 'notGooglebot', 'Yandex', 'YandexAccessibilityBot',
                   'Googlebot bingbot', 'GoogleOther', 'Googlebot\n', 'a' * 1025, None):
            self.assertIsNone(crawler.provider_for(ua))

    def test_UA_alone_never_grants(self):
        verifier = crawler.Verifier(resolver=lambda *_: 403)
        self.assertEqual(verifier.verify(V4, 'Googlebot'), 403)

    def test_each_ttl_and_lru_bounds(self):
        now = [0]
        calls = []
        for status, ttl in crawler.TTL.items():
            verifier = crawler.Verifier(resolver=lambda *args: calls.append(args) or status,
                                        clock=lambda: now[0], max_cache=2)
            count = len(calls)
            self.assertEqual(verifier.verify(V4, 'Googlebot'), status)
            now[0] += ttl - 1
            self.assertEqual(verifier.verify(V4, 'Googlebot'), status)
            self.assertEqual(len(calls), count + 1)
            now[0] += 2
            self.assertEqual(verifier.verify(V4, 'Googlebot'), status)
            self.assertEqual(len(calls), count + 2)
            verifier.verify('8.8.8.8', 'Googlebot')
            verifier.verify('1.1.1.1', 'Googlebot')
            self.assertEqual(len(verifier.cache), 2)
            self.assertNotIn((V4, 'google'), verifier.cache)

    def test_negative_ip_UA_no_DNS_or_cache(self):
        calls = []
        verifier = crawler.Verifier(resolver=lambda *args: calls.append(args) or 204)
        self.assertEqual(verifier.verify('127.0.0.1', 'Googlebot'), 403)
        self.assertEqual(verifier.verify(V4, 'Mozilla'), 403)
        self.assertFalse(calls)
        self.assertFalse(verifier.cache)

    def test_inflight_deduplicated(self):
        entered, release = threading.Event(), threading.Event()
        calls = []
        def resolve(*args):
            calls.append(args)
            entered.set()
            release.wait(2)
            return 204
        verifier = crawler.Verifier(resolver=resolve)
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            results = [pool.submit(verifier.verify, V4, 'Googlebot') for _ in range(12)]
            self.assertTrue(entered.wait(1))
            time.sleep(0.03)
            release.set()
            self.assertEqual([result.result(2) for result in results], [204] * 12)
        self.assertEqual(len(calls), 1)
        self.assertFalse(verifier.inflight)

    def test_distinct_DNS_slots_and_exception_release(self):
        entered, release = threading.Event(), threading.Event()
        def resolve(*_args):
            entered.set()
            release.wait(2)
            raise RuntimeError('private detail')
        verifier = crawler.Verifier(resolver=resolve, slots=1)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(verifier.verify, V4, 'Googlebot')
            self.assertTrue(entered.wait(1))
            self.assertEqual(verifier.verify('8.8.8.8', 'Googlebot'), 503)
            release.set()
            self.assertEqual(first.result(2), 503)
        self.assertFalse(verifier.inflight)
        self.assertTrue(verifier.slots.acquire(blocking=False))


class HTTP(unittest.TestCase):
    def setUp(self):
        self.calls = []
        verifier = crawler.Verifier(resolver=lambda *args: self.calls.append(args) or 204)
        self.server = crawler.BoundedServer(('127.0.0.1', 0), verifier, max_handlers=2)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, raw):
        with socket.create_connection(self.server.server_address, timeout=2) as client:
            client.sendall(raw)
            result = b''
            while True:
                try:
                    chunk = client.recv(65536)
                except ConnectionResetError:
                    # A saturated listener closes without consuming input. TCP
                    # can deliver its fixed 503 followed by a reset.
                    if result:
                        break
                    raise
                if not chunk:
                    break
                result += chunk
            return int(result.split(b' ', 2)[1]), result

    def test_health_verify_missing_headers_unknownpath(self):
        for path, status in [('/health', 200), ('/verify', 403), ('/verify?ip=x', 404), ('/no', 404)]:
            self.assertEqual(self.request(f'GET {path} HTTP/1.1\r\nHost: local\r\n\r\n'.encode())[0], status)
        code, response = self.request(f'GET /verify HTTP/1.1\r\nX-Real-IP: {V4}\r\nUser-Agent: Googlebot\r\n\r\n'.encode())
        self.assertEqual(code, 204)
        self.assertNotIn(V4.encode(), response)
        self.assertNotIn(b'Googlebot', response)
        self.assertEqual(len(self.calls), 1)

    def test_reject_method_body_duplicate_fold_and_controls(self):
        cases = [(b'POST /verify HTTP/1.1\r\n\r\n', 405),
                 (b'GET /verify HTTP/1.1\r\nContent-Length: 1\r\n\r\nx', 400),
                 (b'GET /verify HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n', 400),
                 (b'GET /verify HTTP/1.1\r\nX-Real-IP: 8.8.8.8\r\nx-real-ip: 1.1.1.1\r\n\r\n', 400),
                 (b'GET /verify HTTP/1.1\r\n User-Agent: Googlebot\r\n\r\n', 400),
                 (b'GET /verify HTTP/1.1\r\nUser-Agent: Googlebot\x00\r\n\r\n', 400)]
        for raw, expected in cases:
            self.assertEqual(self.request(raw)[0], expected)
        self.assertFalse(self.calls)

    def test_header_and_request_size_limits(self):
        for raw, expected in [
            (b'GET /' + b'a' * 1024 + b' HTTP/1.1\r\n\r\n', 414),
            (b'GET /health HTTP/1.1\r\nX: ' + b'a' * 4096 + b'\r\n\r\n', 431),
            (b'GET /health HTTP/1.1\r\n' + b''.join(f'X-{i}: a\r\n'.encode() for i in range(34)) + b'\r\n', 431),
            (b'GET /health HTTP/1.1\r\n' + b''.join(f'X-{i}: '.encode() + b'a' * 4000 + b'\r\n' for i in range(5)) + b'\r\n', 431)]:
            self.assertEqual(self.request(raw)[0], expected)

    def test_handler_concurrency_bound(self):
        clients = [socket.create_connection(self.server.server_address, timeout=2) for _ in range(2)]
        try:
            for client in clients:
                client.sendall(b'GET /health HTTP/1.1\r\n')
            time.sleep(0.04)
            self.assertEqual(self.request(b'GET /health HTTP/1.1\r\n\r\n')[0], 503)
        finally:
            for client in clients:
                client.close()


if __name__ == '__main__':
    unittest.main()
