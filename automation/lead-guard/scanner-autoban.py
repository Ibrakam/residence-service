#!/usr/bin/env python3
"""Fixed privileged enforcement. No shell, arbitrary commands or untrusted XFF."""
import argparse
import datetime
import fcntl
import hashlib
import ipaddress
import json
import os
import re
import shlex
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

from scanner_io import atomic_json, private_json, recent_access_events, root_policy_json
from scanner_policy import BAN_SECONDS, MAX_ACTIVE_BANS, MAX_NEW_BANS, WINDOW, canonical_ip, eligible, policy_networks, protected_ip

ROOT = Path('/var/lib/tencorp-scanner-autoban')
POLICY = Path('/etc/tencorp-scanner-autoban/policy.json')
QUEUE = Path('/var/lib/tencorp-security-monitor/scanner-candidates.json')
STATE = ROOT / 'scanner-bans.json'
DENY = Path('/etc/nginx/conf.d/tencorp-autoblocked-ips.conf')
MANUAL = Path('/etc/nginx/conf.d/tencorp-blocked-ips.conf')
HEADER = '# Managed by tencorp-scanner-autoban v1; manual bans live separately.\n'
COMMENT = 'tencorp-autoban-v1'


def command(args, timeout=10):
    return subprocess.run(args, capture_output=True, text=True, check=True, timeout=timeout)


def kernel_rule(address):
    tool = '/usr/sbin/ip6tables' if ipaddress.ip_address(address).version == 6 else '/usr/sbin/iptables'
    return subprocess.run([tool, '-C', 'ufw6-user-input' if ipaddress.ip_address(address).version == 6 else 'ufw-user-input', '-s', address, '-j', 'DROP'], capture_output=True, timeout=5).returncode == 0



def local_protected_networks():
    result=[]
    data=json.loads(command(['/usr/sbin/ip','-j','address','show']).stdout)
    for link in data:
        for item in link.get('addr_info',[]):
            address=canonical_ip(item.get('local'))
            if address:
                result.append(ipaddress.ip_network(address))
    return result

def manual_networks():
    text = MANUAL.read_text() if MANUAL.exists() else ''
    return [ipaddress.ip_network(v, strict=False) for v in re.findall(r'^\s*deny\s+([^; ]+);', text, re.M) if v != 'all']


def owned_rules(text):
    result = set()
    for line in text.splitlines():
        try:
            words = shlex.split(line)
        except ValueError:
            continue
        if len(words) >= 6 and words[:3] == ['ufw', 'deny', 'from']:
            tail = words[4:]
            if tail[:2] == ['to', 'any']:
                tail = tail[2:]
            address = canonical_ip(words[3])
            if address and tail == ['comment', COMMENT]:
                result.add(address)
    return result


def proof_path(item):
    return ROOT / 'proofs' / (str(int(item['createdAt'])) + '-' + item['ip'].replace(':', '_') + '.json')


def validated_lease(item, networks, now):
    try:
        if item['createdAt'] > now + 5 or item['until'] > item['createdAt'] + BAN_SECONDS:
            return False
        path = proof_path(item)
        proof = private_json(path, max_bytes=100_000)
        if hashlib.sha256(path.read_bytes()).hexdigest() != item['proofSHA256']:
            return False
        verified = eligible(proof['events'], item['lastEventAt'] + 1, networks)
        return len(verified) == 1 and verified[0]['ip'] == item['ip'] and item['lastEventAt'] <= item['createdAt'] + 5
    except (ValueError, TypeError, KeyError, OSError):
        return False


def render_denies(bans):
    addresses = sorted((v for v, item in bans.items() if item.get('leaseVerified')), key=lambda a: (ipaddress.ip_address(a).version, int(ipaddress.ip_address(a))))
    if any(canonical_ip(a) != a for a in addresses):
        raise ValueError('Non-canonical stored address')
    return HEADER + ''.join('deny ' + address + ';\n' for address in addresses)


def install_denies(bans):
    prior = DENY.read_bytes() if DENY.exists() else None
    if prior is not None and not prior.startswith(HEADER.encode()):
        raise ValueError('Unmanaged deny file exists')
    new = render_denies(bans).encode()
    if prior == new:
        return
    fd, temporary = tempfile.mkstemp(prefix='.tencorp-autoban-', suffix='.pending', dir=DENY.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o644)
            stream.write(new); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, DENY)
        try:
            command(['/usr/sbin/nginx', '-t'])
            command(['/usr/bin/systemctl', 'reload', 'nginx'])
        except Exception:
            if prior is None:
                DENY.unlink(missing_ok=True)
            else:
                DENY.write_bytes(prior)
            raise
    finally:
        Path(temporary).unlink(missing_ok=True)


def origin_is_direct(config):
    # If DNS is moved behind an unreviewed CDN, stop NEW bans rather than
    # accidentally banning a shared edge. Existing exact bans remain intact.
    try:
        output = command(['/usr/bin/getent', 'ahosts', config['originHost']], timeout=4).stdout
        addresses = {canonical_ip(line.split()[0]) for line in output.splitlines() if line.split()}
        addresses.discard(None)
        return bool(addresses) and addresses <= {canonical_ip(v) for v in config['originIps']}
    except Exception:
        return False


def telegram_text(text):
    token = Path(os.environ['CREDENTIALS_DIRECTORY'], 'telegram-token').read_text().strip()
    request = urllib.request.Request('https://api.telegram.org/bot' + token + '/sendMessage', data=json.dumps({'chat_id': os.environ['CRM_ALERT_CHAT_ID'], 'text': text}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=8) as response:
        if json.load(response).get('ok') is not True:
            raise RuntimeError('Telegram rejected notification')


def send_notification(item):
    until = datetime.datetime.fromtimestamp(item['until'], ZoneInfo('Asia/Tashkent')).strftime('%d.%m.%Y %H:%M')
    protection = 'UFW и Nginx' if item.get('nginxVerified') else 'UFW; применение Nginx будет повторено'
    text = ('TenCorp · сканер заблокирован\nIP: ' + item['ip'] +
            '\nПричина: серия запросов к секретным файлам и известным уязвимостям.' +
            '\nПодтверждено: ' + str(item['count']) + ' подозрительных запросов, ' + str(item['distinctPaths']) + ' разных путей за 3 минуты.' +
            '\nЗащита: ' + protection + '\nБлокировка до ' + until + ' (Ташкент).\nТела запросов и персональные данные посетителей не включены.')
    telegram_text(text)


def announce_enabled():
    require_root()
    config=root_policy_json(POLICY)
    if config.get('enabled') is not True:
        raise RuntimeError('Policy is not enabled')
    for unit in ['tencorp-security-monitor.timer','tencorp-scanner-autoban.path','tencorp-scanner-autoban.timer']:
        command(['/usr/bin/systemctl','is-active','--quiet',unit])
    command(['/usr/sbin/nginx','-t'])
    state=private_json(STATE,{'schemaVersion':1,'bans':{}})
    if state.get('activationNoticeVersion')==1:
        print(json.dumps({'activationNotification':'already-confirmed'}));return
    telegram_text('TenCorp · автоблокировка включена\nЯвные сканеры уязвимостей будут блокироваться на 7 дней. О каждом фактическом блокировании бот сообщит сюда.\nОбычные ошибки404 и обращения к API-документации сами по себе не вызывают блокировку. Ручные блокировки сохранены.')
    state['activationNoticeVersion']=1;state['activationNoticeAt']=time.time();atomic_json(STATE,state)
    print(json.dumps({'activationNotification':'confirmed','fakeBlockNotification':False}))


def audit(item, action):
    directory = ROOT / 'scanner-evidence'
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = str(int(item['createdAt'])) + '-' + item['ip'].replace(':', '_') + '.json'
    atomic_json(directory / name, {'action': action, **item})
    # Only helper-owned bounded evidence, never arbitrary files or symlinks.
    files = sorted(directory.glob('*.json'), key=lambda p: p.name)
    excess = set(files[:max(0, len(files) - 500)])
    for p in files:
        if not p.is_symlink() and (p.stat().st_mtime < time.time() - 90 * 86400 or p in excess):
            p.unlink()


def require_root():
    if os.geteuid() != 0:
        raise PermissionError('Root service required')


def enforce(now=None, unban=None):
    require_root()
    now = time.time() if now is None else now
    config = root_policy_json(POLICY)
    networks = policy_networks(config) + local_protected_networks()
    state = private_json(STATE, {'schemaVersion': 1, 'bans': {}})
    if state.get('schemaVersion') != 1 or not isinstance(state.get('bans'), dict) or len(state['bans']) > MAX_ACTIVE_BANS:
        raise ValueError('Invalid managed ban state')
    bans = state['bans']
    for address, item in bans.items():
        if canonical_ip(address) != address or item.get('ip') != address:
            raise ValueError('Unsafe stored ban')
        if protected_ip(address, networks):
            item['until'] = 0  # A new safety allowlist always removes our ban.
    ufw = command(['/usr/sbin/ufw', 'status', 'numbered']).stdout
    firewall_active = 'Status: active' in ufw
    owned = owned_rules(command(['/usr/sbin/ufw', 'show', 'added']).stdout)
    manual = manual_networks()
    removed = []
    for address, item in list(bans.items()):
        if unban != address and item['until'] > now:
            continue
        if len(removed) >= MAX_NEW_BANS:
            break
        if address in owned:
            # Exact rule specification, not mutable numbered-rule deletion.
            command(['/usr/sbin/ufw', '--force', 'delete', 'deny', 'from', address, 'to', 'any', 'comment', COMMENT])
        removed.append(address)
        audit(item, 'expired' if not unban else 'operator-unban')
        del bans[address]
        proof_path(item).unlink(missing_ok=True)
    if unban:
        atomic_json(STATE, state)
        install_denies(bans)
        print(json.dumps({'unbanned': unban, 'managedRecordRemoved': unban in removed}))
        return
    candidates = []
    if config.get('enabled') is True and firewall_active:
        # Queue events are only hints. Recompute evidence from root/Nginx-owned
        # logs so a compromised detector cannot forge an arbitrary victim IP.
        real_events = recent_access_events(Path('/var/log/nginx/access.log.1'), now)
        real_events += recent_access_events(Path('/var/log/nginx/access.log'), now)
        verified = eligible(real_events, now, networks)
        if verified and origin_is_direct(config):
            candidates = verified
        elif verified:
            print(json.dumps({'autoban': 'paused', 'reason': 'origin-dns-not-direct'}))
    for candidate in candidates:
        address = candidate['ip']
        if address in bans or len(bans) >= MAX_ACTIVE_BANS:
            continue
        if kernel_rule(address) or any(ipaddress.ip_address(address).version == n.version and ipaddress.ip_address(address) in n for n in manual):
            continue  # Existing manual blocks are never claimed as new autobans.
        item = {'ip': address, 'createdAt': now, 'until': now + BAN_SECONDS, 'count': candidate['count'],
                'distinctPaths': candidate['distinctPaths'], 'families': candidate['families'],
                'lastEventAt': candidate['last'], 'leaseVerified': False, 'firewallVerified': False, 'nginxVerified': False,
                'notified': False, 'notificationAttemptAt': 0, 'firewallAttemptAt': now}
        atomic_json(proof_path(item), {'schemaVersion': 1, 'events': candidate['events']})
        item['proofSHA256'] = hashlib.sha256(proof_path(item).read_bytes()).hexdigest()
        bans[address] = item
        atomic_json(STATE, state)  # Pending state survives a process interruption.
        try:
            command(['/usr/sbin/ufw', 'insert', '1', 'deny', 'from', address, 'to', 'any', 'comment', COMMENT])
            owned.add(address)
            item['firewallVerified'] = kernel_rule(address)
            item['leaseVerified'] = item['firewallVerified']
            if not item['firewallVerified']:
                raise RuntimeError('Kernel deny rule not found')
        except Exception as error:
            print(json.dumps({'autoban': 'firewall-failed', 'errorType': type(error).__name__}))
        atomic_json(STATE, state)
    # State belongs only to this privileged service, not to the detector UID.
    # Revalidate its bounded original proof and persisted owned UFW rule.
    for address, item in list(bans.items()):
        if not validated_lease(item, networks, now):
            item['leaseVerified'] = False
            item['firewallVerified'] = False
            continue
        item['firewallVerified'] = firewall_active and address in owned and kernel_rule(address)
        item['leaseVerified'] = address in owned
        if not item['firewallVerified'] and firewall_active and now - item.get('firewallAttemptAt', 0) >= 30:
            item['firewallAttemptAt'] = now
            atomic_json(STATE, state)
            try:
                command(['/usr/sbin/ufw', 'insert', '1', 'deny', 'from', address, 'to', 'any', 'comment', COMMENT])
                owned.add(address)
                item['firewallVerified'] = kernel_rule(address)
                item['leaseVerified'] = address in owned
            except Exception as error:
                print(json.dumps({'autoban': 'firewall-retry-failed', 'errorType': type(error).__name__}))
    atomic_json(STATE, state)
    try:
        install_denies(bans)
    except Exception as error:
        print(json.dumps({'autoban': 'nginx-failed', 'errorType': type(error).__name__}))
    else:
        for item in bans.values():
            if item.get('leaseVerified'):
                item['nginxVerified'] = True
    atomic_json(STATE, state)
    for item in list(bans.values()):
        if not item.get('firewallVerified') or item.get('notified') or now - item.get('notificationAttemptAt', 0) < 300:
            continue
        item['notificationAttemptAt'] = now
        atomic_json(STATE, state)
        try:
            send_notification(item)
        except Exception as error:
            print(json.dumps({'autobanNotification': 'failed', 'errorType': type(error).__name__}))
        else:
            item['notified'] = True
            audit(item, 'blocked-and-notified')
        atomic_json(STATE, state)
    print(json.dumps({'autoban': 'checked', 'activeManagedBans': len(bans), 'newEligibleSources': len(candidates), 'expired': len(removed), 'firewallActive': firewall_active}))


def replay(path):
    data = private_json(path)
    address = canonical_ip(data['sourceIp'])
    events = []
    for item in data['requests']:
        stamp = item['time']
        if isinstance(stamp, (int, float)):
            t = float(stamp)
        else:
            try:
                t = datetime.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
            except ValueError:
                t = datetime.datetime.strptime(stamp, '%d/%b/%Y:%H:%M:%S %z').timestamp()
        events.append({'ip': address, 'time': t, 'path': item['path'], 'method': item['method'], 'status': item['status']})
    now = max(e['time'] for e in events) + 1
    config = root_policy_json(POLICY)
    result = eligible(events, now, policy_networks(config))
    print(json.dumps({'readOnlyReplay': True, 'sourceCount': len(result), 'eligible': bool(result),
                      'matchedRequests': result[0]['count'] if result else 0,
                      'distinctPaths': result[0]['distinctPaths'] if result else 0,
                      'families': result[0]['families'] if result else [], 'firewallChanged': False, 'notificationSent': False}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--replay', type=Path)
    parser.add_argument('--unban')
    parser.add_argument('--announce-enabled',action='store_true')
    args = parser.parse_args()
    if args.replay:
        replay(args.replay)
    elif args.announce_enabled:
        try:
            ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
            with (ROOT / 'autoban.lock').open('a') as lock:
                os.chmod(lock.name, 0o600)
                fcntl.flock(lock, fcntl.LOCK_EX)
                announce_enabled()
        except Exception as error:
            print(json.dumps({'activationNotification':'failed','errorType':type(error).__name__}));raise SystemExit(1)
    else:
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (ROOT / 'autoban.lock').open('a') as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.unban:
                if canonical_ip(args.unban) != args.unban:
                    parser.error('Canonical single IP required')
            enforce(unban=args.unban)
