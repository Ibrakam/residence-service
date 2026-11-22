"""Pure scanner policy. Raw queries, headers and bodies never enter evidence."""
import collections
import datetime
import ipaddress
import re
import urllib.parse

WINDOW = 180
MAX_EVENTS = 4000
MAX_NEW_BANS = 3
MAX_ACTIVE_BANS = 250
BAN_SECONDS = 7 * 86400
FAILURES = {400, 401, 403, 404, 405, 410, 429}
LINE = re.compile(r'^(\S+) \S+ \S+ \[([^\]]+)\] "(GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS) ([^ ]+) HTTP/[0-9.]+" ([0-9]{3}) [0-9-]+(?: |$)')
FAMILIES = (
    ('environment', re.compile(r'^/(?:[a-z0-9_-]+/){0,3}\.env(?:[._-][a-z0-9._-]*)?/?$')),
    ('repository', re.compile(r'^/(?:\.git/(?:head|config|index|packed-refs|objects/[^?]+)|\.svn/(?:entries|wc\.db))/?$')),
    ('credentials', re.compile(r'^/(?:\.aws/(?:credentials|config)|\.azure/(?:credentials|accesstokens\.json)|\.ssh/(?:id_rsa|id_ed25519|authorized_keys)|\.docker/config\.json|\.kube/config)/?$')),
    ('backup', re.compile(r'^/(?:backup|database|dump|db|site|www|mysql|wordpress)(?:[-_.][a-z0-9_-]+)?\.(?:sql(?:\.(?:gz|zip))?|bak|tar\.gz|zip)/?$')),
    ('exploit', re.compile(r'^/(?:vendor/phpunit/|_ignition/|wp-admin/|wp-includes/|wp-content/|wp-login\.php$|xmlrpc\.php$|cgi-bin/|boaform/|actuator/(?:env|heapdump|configprops)|server-status(?:/|$))')),
)
SECRET_FAMILIES = {'environment', 'repository', 'credentials'}


def canonical_ip(value):
    try:
        ip = ipaddress.ip_address(value)
        if getattr(ip, 'scope_id', None):
            return None
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        return str(ip)
    except (ValueError, TypeError):
        return None


def protected_ip(value, networks):
    value = canonical_ip(value)
    if value is None:
        return True
    ip = ipaddress.ip_address(value)
    return not ip.is_global or any(ip.version == n.version and ip in n for n in networks)


def normalized_path(target):
    if not isinstance(target, str) or len(target) > 4096:
        return None
    # Only origin-form requests participate. Ignore proxy/CONNECT targets.
    if not target.startswith('/') or target.startswith('//'):
        return None
    path = target.split('?', 1)[0].split('#', 1)[0]
    for _ in range(3):
        new = urllib.parse.unquote(path, errors='replace')
        if new == path:
            break
        path = new
    if len(path) > 256 or not path.isascii() or any(ord(c) < 32 for c in path) or '\ufffd' in path:
        return None
    path = re.sub('/+', '/', path.replace('\\', '/')).lower()
    if not re.fullmatch(r'[a-z0-9/._~%+@:$!,;=()\[\]*-]+', path):
        return None
    return path


def family(path):
    for name, pattern in FAMILIES:
        if pattern.search(path):
            return name
    return None


def parse_access(line, now):
    match = LINE.match(line)
    if not match:
        return None
    address, stamp, method, target, status = match.groups()
    address = canonical_ip(address)
    path = normalized_path(target)
    if address is None or path is None:
        return None
    try:
        timestamp = datetime.datetime.strptime(stamp, '%d/%b/%Y:%H:%M:%S %z').timestamp()
    except ValueError:
        return None
    if not now - WINDOW <= timestamp <= now + 5:
        return None
    return {'ip': address, 'time': timestamp, 'method': method, 'path': path, 'status': int(status)}


def safe_event(event, now):
    if not isinstance(event, dict):
        return None
    try:
        address = canonical_ip(event.get('ip'))
        timestamp = float(event['time'])
        status = int(event['status'])
        path = normalized_path(event['path'])
    except (KeyError, ValueError, TypeError, OverflowError):
        return None
    if address is None or path is None or not now - WINDOW <= timestamp <= now + 5:
        return None
    if event.get('method') not in {'GET', 'POST', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'}:
        return None
    if status not in FAILURES or family(path) is None:
        return None
    return {'ip': address, 'time': timestamp, 'method': event['method'], 'path': path, 'status': status}


def eligible(events, now, networks):
    groups = collections.defaultdict(list)
    seen = set()
    for event in events[-MAX_EVENTS:]:
        item = safe_event(event, now)
        if item and not protected_ip(item['ip'], networks):
            key = tuple(item[k] for k in ('ip', 'time', 'method', 'path', 'status'))
            if key not in seen:
                groups[item['ip']].append(item)
                seen.add(key)
    candidates = []
    for address, items in groups.items():
        paths = {e['path'] for e in items}
        families = {family(e['path']) for e in items}
        # Require a genuine multi-family exploit burst including secret paths.
        # Ordinary missing images, API docs and search crawlers cannot trigger it.
        if len(items) >= 30 and len(paths) >= 8 and len(families) >= 2 and families & SECRET_FAMILIES:
            by_path = {e['path']: e for e in items}
            by_family = {family(e['path']): e for e in items}
            evidence = list(by_family.values()) + sorted(by_path.values(), key=lambda e: e['time'], reverse=True)[:32] + items[-128:]
            unique = {tuple(e[k] for k in ('ip', 'time', 'method', 'path', 'status')): e for e in evidence}
            evidence = sorted(unique.values(), key=lambda e: e['time'])
            candidates.append({'ip': address, 'count': len(items), 'distinctPaths': len(paths),
                               'families': sorted(families), 'first': min(e['time'] for e in items),
                               'last': max(e['time'] for e in items), 'events': evidence})
    return sorted(candidates, key=lambda e: (-e['count'], e['ip']))[:MAX_NEW_BANS]


def policy_networks(config):
    if config.get('schemaVersion') != 1:
        raise ValueError('Unsupported scanner policy')
    if config.get('enabled') and not config.get('operatorCidrs'):
        raise ValueError('Operator safety allowlist missing')
    values = config.get('protectedCidrs', []) + config.get('operatorCidrs', [])
    if not isinstance(values, list) or len(values) > 200:
        raise ValueError('Invalid protected networks')
    networks = [ipaddress.ip_network(v, strict=False) for v in values]
    if not config.get('originHost') or not config.get('originIps'):
        raise ValueError('Origin safety guard missing')
    for value in config['originIps']:
        address = canonical_ip(value)
        if address is None:
            raise ValueError('Invalid origin address')
        networks.append(ipaddress.ip_network(address))
    return networks


def bounded_events(events, max_bytes=1_000_000):
    import json
    selected, total = [], 2
    for event in reversed(events[-MAX_EVENTS:]):
        size = len(json.dumps(event, ensure_ascii=True, separators=(',', ':')).encode()) + 1
        if total + size > max_bytes:
            break
        selected.append(event); total += size
    return list(reversed(selected))
