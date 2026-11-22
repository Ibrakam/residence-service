#!/usr/bin/env python3
"""Validate DB-IP Country Lite and atomically update only Uzbekistan geo CIDRs."""
import argparse
import csv
import datetime as dt
import fcntl
import gzip
import hashlib
import ipaddress
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE_URL = 'https://download.db-ip.com/free/'
SOURCE_PAGE = 'https://db-ip.com/db/download/ip-to-country-lite'
STATE = Path('/var/lib/tencorp-geo-access')
TARGET = Path('/etc/tencorp-geo-access/uz-networks.conf')
MANIFEST = Path('/etc/tencorp-geo-access/manifest.json')
LOCK = Path('/run/lock/tencorp-geo-access.lock')
MAX_COMPRESSED = 32 * 1024 * 1024
MAX_UNCOMPRESSED = 256 * 1024 * 1024
MAX_LINE = 512
MAX_AGE_DAYS = 65
COUNTRIES = set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK ZZ').split())
V4_EXCLUDED = [ipaddress.ip_network(n) for n in ['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.88.99.0/24','192.168.0.0/16','198.18.0.0/15','198.51.100.0/24','203.0.113.0/24','224.0.0.0/4','240.0.0.0/4']]
V6_PUBLIC = ipaddress.ip_network('2000::/3')
V6_EXCLUDED = [ipaddress.ip_network(n) for n in ['2001::/23','2001:db8::/32','2002::/16','3fff::/20']]


class ValidationError(ValueError):
    pass


class Limits:
    min_rows = 500_000
    max_rows = 2_000_000
    min_family_rows = 100_000
    min_countries = 200
    min_uz_v4_ranges = 50
    min_uz_v6_ranges = 1
    max_uz_ranges = 5000
    min_v4_addresses = 100_000
    max_v4_addresses = 5_000_000
    min_v6_addresses = 2 ** 80
    max_v6_addresses = 2 ** 108
    min_prefix_v4 = 16
    min_prefix_v6 = 24


def month_start(value):
    if not re.fullmatch(r'20[0-9]{2}-(?:0[1-9]|1[0-2])', value):
        raise ValidationError('Invalid source month')
    return dt.date.fromisoformat(value + '-01')


def permitted_months(today):
    first = today.replace(day=1)
    previous = (first - dt.timedelta(days=1)).replace(day=1)
    return [first.strftime('%Y-%m'), previous.strftime('%Y-%m')]


def validate_month(value, today):
    first = month_start(value)
    age = (today - first).days
    if value not in permitted_months(today) or not 0 <= age < MAX_AGE_DAYS:
        raise ValidationError('Source month is not current/previous or is too old')
    return age


def address(value):
    if value != value.strip():
        raise ValidationError('Whitespace in address')
    result = ipaddress.ip_address(value)
    if getattr(result, 'scope_id', None):
        raise ValidationError('Scoped address is invalid')
    return result


def validate_uz_network(network, limits):
    if not network.network_address.is_global or not network.broadcast_address.is_global:
        raise ValidationError('UZ range includes non-global addresses')
    if network.version == 4:
        if network.prefixlen < limits.min_prefix_v4 or any(network.overlaps(n) for n in V4_EXCLUDED):
            raise ValidationError('UZ IPv4 range is unsafe or too broad')
    elif network.prefixlen < limits.min_prefix_v6 or not network.subnet_of(V6_PUBLIC) or any(network.overlaps(n) for n in V6_EXCLUDED):
        raise ValidationError('UZ IPv6 range is unsafe or too broad')


def parse_database(path, source_month, today=None, limits=None):
    today = dt.datetime.now(dt.timezone.utc).date() if today is None else today
    limits = Limits() if limits is None else limits
    age = validate_month(source_month, today)
    path = Path(path)
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size < 20 or info.st_size > MAX_COMPRESSED:
        raise ValidationError('Compressed source size is invalid')
    gz_sha = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            gz_sha.update(chunk)
    raw_sha, raw_sha1 = hashlib.sha256(), hashlib.sha1()
    total_bytes = rows = 0
    countries = set()
    family_rows = {4: 0, 6: 0}
    uz_ranges, uz_space = {4: 0, 6: 0}, {4: 0, 6: 0}
    previous_end = {4: -1, 6: -1}
    first_address, last_address = {}, {}
    highest_family = 4
    uz = {4: [], 6: []}
    try:
        with gzip.open(path, 'rb') as stream:
            while True:
                line = stream.readline(MAX_LINE + 1)
                if not line:
                    break
                total_bytes += len(line)
                if len(line) > MAX_LINE or total_bytes > MAX_UNCOMPRESSED:
                    raise ValidationError('Uncompressed source exceeds safe bounds')
                raw_sha.update(line); raw_sha1.update(line)
                text = line.decode('ascii', errors='strict')
                parsed = list(csv.reader([text], strict=True))
                if len(parsed) != 1 or len(parsed[0]) != 3:
                    raise ValidationError('Source must contain exactly three CSV fields')
                start, end, country = parsed[0]
                if country not in COUNTRIES:
                    raise ValidationError('Invalid ISO country code')
                low, high = address(start), address(end)
                if low.version != high.version or int(low) > int(high):
                    raise ValidationError('Invalid address range')
                version = low.version
                if version < highest_family or int(low) <= previous_end[version]:
                    raise ValidationError('Ranges must be sorted and non-overlapping')
                highest_family = version
                previous_end[version] = int(high)
                first_address.setdefault(version, int(low)); last_address[version] = int(high)
                countries.add(country); family_rows[version] += 1; rows += 1
                if rows > limits.max_rows:
                    raise ValidationError('Too many source records')
                if country == 'UZ':
                    uz_ranges[version] += 1
                    if uz_ranges[version] > limits.max_uz_ranges:
                        raise ValidationError('Too many UZ ranges')
                    uz_space[version] += int(high) - int(low) + 1
                    for network in ipaddress.summarize_address_range(low, high):
                        validate_uz_network(network, limits)
                        uz[version].append(network)
    except (OSError, EOFError, UnicodeError, csv.Error, ValueError) as error:
        if isinstance(error, ValidationError):
            raise
        raise ValidationError('Invalid gzip/CSV/address source') from error
    if not limits.min_rows <= rows <= limits.max_rows or len(countries) < limits.min_countries:
        raise ValidationError('Source record/country coverage is incomplete')
    if any(count < limits.min_family_rows for count in family_rows.values()):
        raise ValidationError('Source must cover both address families')
    if not limits.min_uz_v4_ranges <= uz_ranges[4] <= limits.max_uz_ranges or not limits.min_uz_v6_ranges <= uz_ranges[6] <= limits.max_uz_ranges:
        raise ValidationError('UZ source coverage is incomplete')
    if not limits.min_v4_addresses <= uz_space[4] <= limits.max_v4_addresses or not limits.min_v6_addresses <= uz_space[6] <= limits.max_v6_addresses:
        raise ValidationError('UZ address-space size is implausible')
    networks = []
    for version in (4, 6):
        collapsed = list(ipaddress.collapse_addresses(uz[version]))
        for network in collapsed:
            validate_uz_network(network, limits)
        networks.extend(collapsed)
    body = ('# DB-IP Country Lite ' + source_month + '; Uzbekistan only.\n' +
            '# Source: ' + SOURCE_PAGE + '\n' +
            ''.join(str(network) + ' 1;\n' for network in networks)).encode('ascii')
    manifest = {'schemaVersion': 1, 'provider': 'DB-IP Country Lite', 'sourcePage': SOURCE_PAGE,
                'sourceUrl': BASE_URL + 'dbip-country-lite-' + source_month + '.csv.gz',
                'sourceMonth': source_month, 'sourceAgeDaysAtValidation': age,
                'validatedAtUTC': dt.datetime.now(dt.timezone.utc).isoformat(),
                'compressedSHA256': gz_sha.hexdigest(), 'compressedBytes': info.st_size,
                'csvSHA256': raw_sha.hexdigest(), 'csvSHA1': raw_sha1.hexdigest(), 'csvBytes': total_bytes,
                'recordCount': rows, 'countryCount': len(countries),
                'familyRecordCounts': {str(k): v for k, v in family_rows.items()},
                'uzRangeCounts': {str(k): v for k, v in uz_ranges.items()},
                'uzAddressCounts': {str(k): str(v) for k, v in uz_space.items()},
                'uzCIDRCounts': {str(k): sum(n.version == k for n in networks) for k in (4, 6)},
                'configSHA256': hashlib.sha256(body).hexdigest()}
    return body, manifest, networks


def changed_addresses(old, new):
    """Exact symmetric-difference size without enumerating any addresses."""
    left = [(int(n.network_address), int(n.broadcast_address)) for n in old]
    right = [(int(n.network_address), int(n.broadcast_address)) for n in new]
    overlap = i = j = 0
    while i < len(left) and j < len(right):
        a, b = left[i]; c, d = right[j]
        overlap += max(0, min(b, d) - max(a, c) + 1)
        if b < d: i += 1
        else: j += 1
    return sum(b-a+1 for a,b in left) + sum(b-a+1 for a,b in right) - 2*overlap


def load_network_config(body, limits=None):
    limits = Limits() if limits is None else limits
    result = []
    for line in body.decode('ascii').splitlines():
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([0-9a-fA-F:./]+) 1;', line)
        if not match:
            raise ValidationError('Existing geo configuration is malformed')
        network = ipaddress.ip_network(match[1], strict=True)
        validate_uz_network(network, limits)
        result.append(network)
    if not result:
        raise ValidationError('Existing geo configuration is empty')
    return result


def validate_change(new_manifest, new_networks, old_manifest=None, old_body=None):
    if old_manifest is None and old_body is None:
        return
    if old_manifest is None or old_body is None or old_manifest.get('schemaVersion') != 1:
        raise ValidationError('Incomplete last-known-good metadata')
    if hashlib.sha256(old_body).hexdigest() != old_manifest.get('configSHA256'):
        raise ValidationError('Last-known-good configuration checksum mismatch')
    if new_manifest['sourceMonth'] < old_manifest.get('sourceMonth', ''):
        raise ValidationError('Cannot downgrade a newer source release')
    old_networks = load_network_config(old_body)
    old_rows = old_manifest.get('recordCount', 0)
    if not old_rows or not .70 <= new_manifest['recordCount'] / old_rows <= 1.40:
        raise ValidationError('Global source size changed unexpectedly')
    for version in (4, 6):
        key = str(version)
        count = old_manifest.get('uzRangeCounts', {}).get(key, 0)
        addresses = int(old_manifest.get('uzAddressCounts', {}).get(key, 0))
        if not count or not addresses:
            raise ValidationError('Last-known-good UZ coverage metadata is invalid')
        if not .65 <= new_manifest['uzRangeCounts'][key] / count <= 1.50:
            raise ValidationError('UZ range count changed unexpectedly')
        new_addresses = int(new_manifest['uzAddressCounts'][key])
        if not .65 <= new_addresses / addresses <= 1.50:
            raise ValidationError('UZ address space changed unexpectedly')
        old = [n for n in old_networks if n.version == version]
        new = [n for n in new_networks if n.version == version]
        if changed_addresses(old, new) > max(addresses, new_addresses) * .50:
            raise ValidationError('UZ address allocation changed unexpectedly')


def atomic_write(path, data, mode=0o644):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.pending', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), mode)
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def metadata_bytes(data):
    return (json.dumps(data, sort_keys=True, indent=2) + '\n').encode('utf-8')


def download_month(month, destination, today, opener=urllib.request.urlopen):
    validate_month(month, today)
    url = BASE_URL + 'dbip-country-lite-' + month + '.csv.gz'
    request = urllib.request.Request(url, headers={'User-Agent': 'TenCorp-CountryFeed/1.0', 'Accept-Encoding': 'identity'})
    started = time.monotonic()
    try:
        with opener(request, timeout=20) as response:
            if response.geturl() != url:
                raise ValidationError('Unexpected source redirect')
            length = response.headers.get('Content-Length')
            if length is not None and (not length.isdigit() or not 20 <= int(length) <= MAX_COMPRESSED):
                raise ValidationError('Download size is invalid')
            received = 0
            with Path(destination).open('wb') as output:
                while True:
                    if time.monotonic() - started > 75:
                        raise ValidationError('Download deadline exceeded')
                    chunk = response.read1(65536)
                    if not chunk:
                        break
                    received += len(chunk)
                    if received > MAX_COMPRESSED:
                        raise ValidationError('Download exceeds safe bounds')
                    output.write(chunk)
            if length is not None and received != int(length):
                raise ValidationError('Download is incomplete')
    except Exception:
        Path(destination).unlink(missing_ok=True)
        raise
    return url


def download_source(directory, today, opener=urllib.request.urlopen):
    current, previous = permitted_months(today)
    path = Path(directory) / ('dbip-country-lite-' + current + '.csv.gz')
    try:
        download_month(current, path, today, opener)
        return path, current, False
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    # A network error, 403 or malformed current release must not silently use
    # an old database. Only an unpublished-current-month404 permits fallback.
    validate_month(previous, today)
    path = Path(directory) / ('dbip-country-lite-' + previous + '.csv.gz')
    download_month(previous, path, today, opener)
    return path, previous, True


def apply_candidate(body, manifest, target=TARGET, manifest_path=MANIFEST, state_dir=STATE, runner=subprocess.run):
    target, manifest_path, state_dir = Path(target), Path(manifest_path), Path(state_dir)
    if os.geteuid() != 0:
        raise PermissionError('Root is required to update Nginx geo data')
    if not target.exists() or not manifest_path.exists():
        raise ValidationError('Initial geo configuration must be installed before automatic updates')
    if hashlib.sha256(body).hexdigest() != manifest.get('configSHA256'):
        raise ValidationError('Candidate configuration checksum mismatch')
    old_body, old_metadata = target.read_bytes(), manifest_path.read_bytes()
    old_manifest = json.loads(old_metadata)
    validate_change(manifest, load_network_config(body), old_manifest, old_body)
    if body == old_body:
        # Do not reload Nginx for identical monthly CIDRs. Metadata still records
        # the verified download/check time and original release age.
        atomic_write(manifest_path, metadata_bytes(manifest))
        return {'changed': False, 'nginxReloaded': False}
    backup = state_dir / 'backups' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup.mkdir(parents=True, mode=0o700)
    (backup / 'uz-networks.conf').write_bytes(old_body)
    (backup / 'manifest.json').write_bytes(old_metadata)
    try:
        atomic_write(target, body)
        atomic_write(manifest_path, metadata_bytes(manifest))
        runner(['/usr/sbin/nginx', '-t'], check=True, capture_output=True, text=True, timeout=20)
        runner(['/usr/bin/systemctl', 'reload', 'nginx'], check=True, capture_output=True, text=True, timeout=20)
    except Exception:
        atomic_write(target, old_body)
        atomic_write(manifest_path, old_metadata)
        # A failed reload retains old workers; revalidate/reload restored bytes
        # as well so any partial platform reload is reconciled explicitly.
        runner(['/usr/sbin/nginx', '-t'], check=True, capture_output=True, text=True, timeout=20)
        runner(['/usr/bin/systemctl', 'reload', 'nginx'], check=True, capture_output=True, text=True, timeout=20)
        raise
    backups = sorted((state_dir / 'backups').iterdir())
    for old in backups[:-3]:
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)
    return {'changed': True, 'nginxReloaded': True, 'backup': str(backup)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--check', action='store_true')
    action.add_argument('--prepare', type=Path, metavar='OUTPUT_DIR')
    action.add_argument('--update', action='store_true')
    parser.add_argument('--source', type=Path, help='Reviewed local gzip CSV, never fetched from arbitrary URLs')
    parser.add_argument('--month', help='YYYY-MM, required with --source')
    parser.add_argument('--expect-gzip-sha256')
    args = parser.parse_args()
    if args.source is not None and args.month is None:
        parser.error('--source requires --month')
    if args.source is None and args.month is not None:
        parser.error('--month requires --source')
    if args.expect_gzip_sha256 and not re.fullmatch('[0-9a-f]{64}', args.expect_gzip_sha256):
        parser.error('Expected digest must be lowercase SHA-256')
    today = dt.datetime.now(dt.timezone.utc).date()
    if args.update:
        STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077 or info.st_nlink != 1:
            os.close(fd); raise ValidationError('Unsafe shared updater lock')
        lock = os.fdopen(fd, 'a')
        fcntl.flock(lock, fcntl.LOCK_EX)
    else:
        lock = None
    try:
        with tempfile.TemporaryDirectory(prefix='country-', dir=STATE if args.update else None) as temporary:
            if args.source:
                source, month, fallback = args.source, args.month, False
            else:
                source, month, fallback = download_source(Path(temporary), today)
            body, manifest, networks = parse_database(source, month, today)
            if args.expect_gzip_sha256 and manifest['compressedSHA256'] != args.expect_gzip_sha256:
                raise ValidationError('Reviewed source digest mismatch')
            manifest['previousMonthFallback'] = fallback
            if args.prepare:
                args.prepare.mkdir(parents=True, exist_ok=True, mode=0o755)
                previous = args.prepare / 'manifest.json'
                config = args.prepare / 'uz-networks.conf'
                if previous.exists() or config.exists():
                    validate_change(manifest, networks, json.loads(previous.read_text()) if previous.exists() else None, config.read_bytes() if config.exists() else None)
                atomic_write(config, body)
                atomic_write(previous, metadata_bytes(manifest))
                result = {'prepared': str(args.prepare), 'nginxReloaded': False}
            elif args.update:
                result = apply_candidate(body, manifest)
                # Cache only the accepted source; at most current/previous month
                # are retained. The cache is not used to bypass download failure.
                cache = STATE / ('dbip-country-lite-' + month + '.csv.gz')
                if source.resolve() != cache.resolve():
                    shutil.copyfile(source, cache); cache.chmod(0o600)
                for cached in STATE.glob('dbip-country-lite-*.csv.gz'):
                    if cached.name not in {'dbip-country-lite-' + value + '.csv.gz' for value in permitted_months(today)} and cached.is_file() and not cached.is_symlink():
                        cached.unlink()
            else:
                result = {'checked': True, 'nginxReloaded': False}
            print(json.dumps({'ok': True, **result, 'sourceMonth': month, 'recordCount': manifest['recordCount'], 'countryCount': manifest['countryCount'], 'uzRangeCounts': manifest['uzRangeCounts'], 'uzCIDRCounts': manifest['uzCIDRCounts'], 'configSHA256': manifest['configSHA256'], 'compressedSHA256': manifest['compressedSHA256']}))
    finally:
        if lock:
            lock.close()


if __name__ == '__main__':
    main()
