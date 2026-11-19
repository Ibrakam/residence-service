#!/usr/bin/env python3
"""Bounded, deduplicated operational alerts. Never sends request bodies/queries."""
import collections
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

STATE = Path('/var/lib/tencorp-security-monitor/state.json')

def run():
    now = time.time()
    state = json.loads(STATE.read_text()) if STATE.exists() else {'since': now, 'sent': {}}
    if '--test' in sys.argv:
        token = Path(os.environ['CREDENTIALS_DIRECTORY'], 'telegram-token').read_text().strip()
        body = json.dumps({'chat_id': os.environ['CRM_ALERT_CHAT_ID'], 'text': 'TenCorp · проверка уведомлений защиты\nМониторинг атак подключён: подозрительные серии запросов, лимиты форм и всплески заявок. Это тестовое сообщение, действий не требуется.'}).encode()
        req = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=body, headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req, timeout=10) as response:
            assert json.load(response).get('ok') is True
        print('Security notification accepted by Telegram')
        return
    since = max(state.get('since', now), now - 180)
    signals = collections.Counter()
    journal = subprocess.run(['journalctl', '-u', 'tencorp-lead-guard', '--since', '@' + str(int(since)), '-o', 'cat', '--no-pager'], capture_output=True, text=True, timeout=10).stdout
    for line in journal.splitlines()[-2000:]:
        try:
            event = json.loads(line)
            if event.get('security_event') and event.get('status', 0) >= 400:
                signals['form:' + str(event['security_event'])[:60]] += 1
            if event.get('security_event') == 'lead_confirmed':
                signals['traffic:lead_volume'] += 1
        except ValueError:
            pass
    log = Path('/var/log/nginx/access.log')
    stat = log.stat()
    offset = state.get('offset', stat.st_size)
    if state.get('inode') != stat.st_ino or offset > stat.st_size:
        offset = 0 if STATE.exists() else stat.st_size
    with log.open('rb') as stream:
        stream.seek(max(offset, stat.st_size - 2_000_000))
        for raw in stream.read(2_000_000).decode(errors='replace').splitlines():
            match = re.search(r'"(?:GET|POST|HEAD) ([^ ?]+)[^\"]*" (\d{3}) ', raw)
            if not match:
                continue
            path, status = match.groups()
            if path in ('/.env', '/.git/HEAD', '/openapi.json'):
                signals['scanner:secret_probe'] += 1
            if status == '429':
                signals['traffic:rate_limited'] += 1
        offset = stream.tell()
    alerts = []
    for kind, count in signals.items():
        threshold = 10 if kind == 'traffic:lead_volume' else 3 if kind.startswith('form:') else 5
        if count >= threshold and now - state['sent'].get(kind, 0) >= 900:
            alerts.append(f'{kind}: {count}')
    if alerts:
        token = Path(os.environ['CREDENTIALS_DIRECTORY'], 'telegram-token').read_text().strip()
        body = json.dumps({'chat_id': os.environ['CRM_ALERT_CHAT_ID'], 'text': 'TenCorp · защита сайта\nЗафиксирована серия подозрительных запросов (до 3 минут):\n' + '\n'.join(alerts[:10]) + '\nПроверка: journalctl -u tencorp-lead-guard. Персональные данные не включены.'}).encode()
        request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=body, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=10) as response:
            if not json.load(response).get('ok'):
                raise RuntimeError('Telegram rejected security notification')
        for kind in signals:
            if any(a.startswith(kind + ':') for a in alerts):
                state['sent'][kind] = now
    state.update(since=now, offset=offset, inode=stat.st_ino)
    STATE.write_text(json.dumps(state))

if __name__ == '__main__':
    run()
