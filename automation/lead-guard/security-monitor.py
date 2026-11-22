#!/usr/bin/env python3
"""Read-only detection; privileged enforcement runs in a separate fixed service."""
import collections
import fcntl
import json
import os
import subprocess
import sys
import time
import stat
import urllib.request
from pathlib import Path

from scanner_io import atomic_json, private_json, root_policy_json
from scanner_policy import MAX_EVENTS, WINDOW, bounded_events, eligible, family, parse_access, policy_networks, safe_event

ROOT = Path('/var/lib/tencorp-security-monitor')
STATE = ROOT / 'state.json'
QUEUE = ROOT / 'scanner-candidates.json'
CONFIG = Path('/etc/tencorp-scanner-autoban/policy.json')
MAX_READ = 4_000_000


def read_slice(path, offset, now):
    """Read only complete lines, bounded even after outages or log truncation."""
    events, signals = [], collections.Counter()
    with path.open('rb') as stream:
        size = os.fstat(stream.fileno()).st_size
        offset = offset if 0 <= offset <= size else 0
        start = max(offset, size - MAX_READ)
        stream.seek(start)
        if start > offset:
            stream.readline()  # Do not parse a partial line after a bounded seek.
        data_start = stream.tell()
        data = stream.read(MAX_READ)
        last_newline = data.rfind(b'\n')
        if last_newline < 0:
            return events, signals, data_start
        consumed = data[:last_newline + 1]
        for raw in consumed.decode('utf-8', errors='replace').splitlines():
            event = parse_access(raw, now)
            if not event:
                continue
            if event['path'] in ('/.env', '/.git/head', '/openapi.json'):
                signals['scanner:secret_probe'] += 1
            if event['status'] == 429:
                signals['traffic:rate_limited'] += 1
            if safe_event(event, now):
                events.append(event)
        return events, signals, data_start + len(consumed)


def scan_access(log, state, now):
    events, signals = [], collections.Counter()
    current = log.stat()
    same = state.get('inode') == current.st_ino
    if not same and state.get('inode'):
        # Standard delaycompress rotation preserves the old inode as .1.
        previous = log.with_name(log.name + '.1')
        if previous.exists() and previous.stat().st_ino == state['inode']:
            old_events, old_signals, _ = read_slice(previous, int(state.get('offset', 0)), now)
            events.extend(old_events); signals.update(old_signals)
    new, counts, offset = read_slice(log, int(state.get('offset', 0)) if same else 0, now)
    events.extend(new); signals.update(counts)
    return events, signals, offset, current.st_ino


def telegram(text):
    token = Path(os.environ['CREDENTIALS_DIRECTORY'], 'telegram-token').read_text().strip()
    body = json.dumps({'chat_id': os.environ['CRM_ALERT_CHAT_ID'], 'text': text}).encode()
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=8) as response:
        if json.load(response).get('ok') is not True:
            raise RuntimeError('Telegram rejected notification')



def load_state(now):
    try:
        state = private_json(STATE, {'since': now, 'sent': {}})
        if not isinstance(state, dict) or not isinstance(state.get('sent', {}), dict):
            raise ValueError('Invalid monitor state')
        return state
    except (ValueError, UnicodeDecodeError):
        info = STATE.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise
        print(json.dumps({'monitorState': 'reset', 'reason': 'invalid-or-oversized'}))
        return {'since': now, 'sent': {}}

def run():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (ROOT / 'monitor.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        now = time.time()
        state = load_state(now)
        if '--test' in sys.argv:
            telegram('TenCorp · проверка уведомлений защиты\nЭто тестовое сообщение, действий не требуется.')
            print('Security notification accepted by Telegram')
            return
        since = max(float(state.get('since', now)), now - WINDOW)
        signals = collections.Counter()
        journal = subprocess.run(['journalctl', '-u', 'tencorp-lead-guard', '--since', '@' + str(int(since)), '-o', 'cat', '--no-pager'], capture_output=True, text=True, timeout=10).stdout
        for line in journal.splitlines()[-2000:]:
            try:
                event = json.loads(line)
                if event.get('security_event') and event.get('status', 0) >= 400:
                    signals['form:' + str(event['security_event'])[:60]] += 1
                if event.get('security_event') == 'lead_confirmed':
                    signals['traffic:lead_volume'] += 1
            except (ValueError, TypeError):
                continue
        events, counts, offset, inode = scan_access(Path('/var/log/nginx/access.log'), state, now)
        signals.update(counts)
        retained = [safe_event(e, now) for e in state.get('scanner_events', [])[-MAX_EVENTS:]]
        retained = [e for e in retained if e] + events
        retained = bounded_events(sorted(retained, key=lambda e: e['time']))
        config = root_policy_json(CONFIG)
        candidates = eligible(retained, now, policy_networks(config)) if config.get('enabled') is True else []
        atomic_json(QUEUE, {'schemaVersion': 1, 'generatedAt': now, 'candidates': candidates})
        alerts, sent = [], state.get('sent', {})
        for kind, count in signals.items():
            threshold = 10 if kind == 'traffic:lead_volume' else 3 if kind.startswith('form:') else 5
            if count >= threshold and now - float(sent.get(kind, 0)) >= 900:
                alerts.append(f'{kind}: {count}')
        # Persist log cursors before external delivery: a Telegram outage must
        # never replay hours of old scanner requests as a fresh incident.
        state.update(since=now, offset=offset, inode=inode, scanner_events=retained)
        atomic_json(STATE, state)
        if alerts:
            try:
                telegram('TenCorp · защита сайта\nЗафиксированы подозрительные запросы за последние 3 минуты:\n' + '\n'.join(alerts[:10]) + '\nИсточники: Nginx access.log; журнал tencorp-lead-guard для форм. Персональные данные не включены.')
            except Exception as error:
                print(json.dumps({'notification': 'failed', 'errorType': type(error).__name__}))
            else:
                for alert in alerts:
                    sent[alert.rsplit(': ', 1)[0]] = now
                state['sent'] = sent
                atomic_json(STATE, state)


if __name__ == '__main__':
    run()
