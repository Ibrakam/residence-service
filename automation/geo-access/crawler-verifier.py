#!/usr/bin/env python3
"""Bounded FCrDNS verification for Nginx's public-homepage SEO subrequest.

X-Real-IP is trusted only because this listener is loopback-only and Nginx
overwrites it. This service grants no application session or account access.
No client addresses, hostnames or User-Agent strings are logged.
"""
import argparse
from collections import OrderedDict
from http.client import HTTPMessage
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import re
import socket
from socketserver import ThreadingMixIn
import subprocess
import sys
import threading
import time


SUFFIXES = {
    'google': ('googlebot.com',),
    'google-inspection': ('google.com', 'googlebot.com'),
    'bing': ('search.msn.com',),
    'yandex': ('yandex.ru', 'yandex.net', 'yandex.com'),
}
TOKENS = {
    'google': r'Googlebot(?:-Image|-Video)?',
    'google-inspection': r'Google-InspectionTool',
    'bing': r'bingbot',
    'yandex': r'Yandex(?:Bot|MobileBot|Images|Video|RenderResourcesBot|Webmaster|CheckBot)',
}
# A hyphen is part of a token: Googlebot-Fake must not become Googlebot.
BOT_PATTERNS = {name: re.compile(r'(?<![A-Za-z0-9_-])(?:' + token + r')(?![A-Za-z0-9_-])', re.I)
                for name, token in TOKENS.items()}
DNS_SECONDS = 4
MAX_CACHE = 4096
TTL = {204: 3600, 403: 300, 503: 10}


def canonical_ip(value):
    if not isinstance(value, str) or len(value) > 45 or '%' in value or value != value.strip():
        raise ValueError('Invalid address')
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    if (not address.is_global or address.is_multicast or address.is_reserved
            or address.is_unspecified or address.is_loopback or address.is_link_local):
        raise ValueError('Non-global address')
    return str(address)


def provider_for(ua):
    if not isinstance(ua, str) or len(ua) > 1024 or any(ord(c) < 32 or ord(c) > 126 for c in ua):
        return None
    matches = [name for name, regex in BOT_PATTERNS.items() if regex.search(ua)]
    return matches[0] if len(matches) == 1 else None


def approved_hostname(hostname, provider):
    if not isinstance(hostname, str):
        return False
    name = hostname.lower().removesuffix('.')
    if len(name) > 253 or not name or not name.isascii():
        return False
    if any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label)
           for label in name.split('.')):
        return False
    if provider == 'google-inspection' and name.endswith('.google.com'):
        return bool(re.fullmatch(r'(?:google-proxy|rate-limited-proxy)-[a-z0-9-]+\.google\.com', name))
    return any(name.endswith('.' + suffix) for suffix in SUFFIXES.get(provider, ()))


def dns_status(ip, provider):
    """Child-only DNS calls. Parent kills this process after four seconds."""
    try:
        ip = canonical_ip(ip)
        if provider not in SUFFIXES:
            return 403
        hostname = socket.gethostbyaddr(ip)[0]
        if not approved_hostname(hostname, provider):
            return 403
        answers = socket.getaddrinfo(hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM)
        for family, _kind, _protocol, _name, sockaddr in answers:
            if family not in (socket.AF_INET, socket.AF_INET6):
                continue
            try:
                if canonical_ip(sockaddr[0]) == ip:
                    return 204
            except ValueError:
                continue
        return 403
    except (ValueError, UnicodeError):
        return 403
    except socket.herror as error:
        # HOST_NOT_FOUND / NO_DATA are deterministic negative answers.
        return 403 if error.errno in (1, 4) else 503
    except socket.gaierror as error:
        return 403 if error.errno in (socket.EAI_NONAME, getattr(socket, 'EAI_NODATA', -999)) else 503
    except (OSError, RuntimeError):
        return 503


def resolve_subprocess(ip, provider):
    try:
        result = subprocess.run([sys.executable, __file__, '--resolve', ip, provider],
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=DNS_SECONDS, check=False,
                                env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C.UTF-8'})
        if result.returncode or len(result.stdout) > 128:
            return 503
        status = json.loads(result.stdout)['status']
        return status if type(status) is int and status in TTL else 503
    except (OSError, ValueError, KeyError, TypeError, subprocess.TimeoutExpired):
        return 503


class Verifier:
    def __init__(self, resolver=resolve_subprocess, clock=time.monotonic, max_cache=MAX_CACHE, slots=4):
        self.resolver = resolver
        self.clock = clock
        self.max_cache = max_cache
        self.cache = OrderedDict()
        self.inflight = {}
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(slots)

    def verify(self, ip, ua):
        try:
            ip = canonical_ip(ip)
        except (ValueError, TypeError):
            return 403
        provider = provider_for(ua)
        if not provider:
            return 403
        key = (ip, provider)
        with self.lock:
            cached = self.cache.get(key)
            if cached and cached[0] > self.clock():
                self.cache.move_to_end(key)
                return cached[1]
            self.cache.pop(key, None)
            event = self.inflight.get(key)
            if event is None:
                if not self.slots.acquire(blocking=False):
                    return 503
                event = threading.Event()
                self.inflight[key] = event
                leader = True
            else:
                leader = False
        if not leader:
            event.wait(DNS_SECONDS + 0.5)
            with self.lock:
                cached = self.cache.get(key)
                return cached[1] if cached and cached[0] > self.clock() else 503
        status = 503
        try:
            status = self.resolver(ip, provider)
            if type(status) is not int or status not in TTL:
                status = 503
        except Exception:
            # Never leak resolver exceptions, including IP-bearing error text.
            status = 503
        finally:
            with self.lock:
                self.cache[key] = (self.clock() + TTL[status], status)
                self.cache.move_to_end(key)
                while len(self.cache) > self.max_cache:
                    self.cache.popitem(last=False)
                self.inflight.pop(key, None)
                event.set()
            self.slots.release()
        return status


class Handler(BaseHTTPRequestHandler):
    server_version = 'CrawlerVerifier'
    sys_version = ''
    protocol_version = 'HTTP/1.1'
    timeout = 2

    def log_message(self, *_args):
        pass

    def parse_request(self):
        """Parse small, unambiguous, body-free subrequests; no header folding."""
        self.close_connection = True
        self.request_version = 'HTTP/1.1'
        self.command = None
        self.requestline = ''
        if len(self.raw_requestline) > 1024:
            self.send_error(414)
            return False
        try:
            line = self.raw_requestline.decode('ascii')
            if not line.endswith('\r\n'):
                raise ValueError()
            words = line[:-2].split(' ')
            if len(words) != 3 or words[2] not in ('HTTP/1.0', 'HTTP/1.1'):
                raise ValueError()
            self.command, self.path, self.request_version = words
            self.requestline = line[:-2]
            self.headers = HTTPMessage()
            budget = 0
            names = set()
            for _index in range(33):
                row = self.rfile.readline(4097)
                budget += len(row)
                if len(row) > 4096 or budget > 16384:
                    self.send_error(431)
                    return False
                if row == b'\r\n':
                    break
                if not row.endswith(b'\r\n') or row[:1] in (b' ', b'\t') or b':' not in row:
                    raise ValueError()
                name, value = row[:-2].split(b':', 1)
                name = name.decode('ascii')
                if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name):
                    raise ValueError()
                value = value.decode('ascii').strip(' \t')
                if any(ord(c) < 32 or ord(c) > 126 for c in value) or name.lower() in names:
                    raise ValueError()
                names.add(name.lower())
                self.headers[name] = value
            else:
                self.send_error(431)
                return False
            if 'transfer-encoding' in names or self.headers.get('Content-Length', '0') != '0':
                raise ValueError()
            if self.command != 'GET':
                self.reply(405, allow=True)
                return False
            return True
        except (ValueError, UnicodeError):
            self.send_error(400)
            return False

    def send_error(self, code, message=None, explain=None):
        # Fixed empty response, never reflect client input or exception details.
        self.reply(code)

    def reply(self, status, body=b'', allow=False):
        self.send_response(status)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Connection', 'close')
        if allow:
            self.send_header('Allow', 'GET')
        self.end_headers()
        if body:
            self.wfile.write(body)
        self.close_connection = True

    def do_GET(self):
        if self.path == '/health':
            self.reply(200, b'OK\n')
        elif self.path == '/verify':
            self.reply(self.server.verifier.verify(self.headers.get('X-Real-IP'),
                                                   self.headers.get('User-Agent')))
        else:
            self.reply(404)


class BoundedServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 32

    def __init__(self, address, verifier=None, max_handlers=32):
        self.verifier = verifier or Verifier()
        self.handlers = threading.BoundedSemaphore(max_handlers)
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(2)
        return connection, address

    def process_request(self, request, client_address):
        if not self.handlers.acquire(blocking=False):
            try:
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.handlers.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.handlers.release()

    def handle_error(self, request, client_address):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--serve', action='store_true')
    modes.add_argument('--resolve', nargs=2, metavar=('IP', 'PROVIDER'))
    args = parser.parse_args()
    if args.resolve:
        print(json.dumps({'status': dns_status(*args.resolve)}))
    else:
        with BoundedServer(('127.0.0.1', 4360)) as server:
            server.serve_forever(poll_interval=0.5)


if __name__ == '__main__':
    main()
