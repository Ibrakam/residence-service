"""Private bounded state I/O shared by the two fixed services."""
import json
import os
from pathlib import Path
import stat
import tempfile


def private_json(path, default=None, max_bytes=2_000_000):
    path = Path(path)
    if not path.exists():
        if default is not None:
            return default
        raise FileNotFoundError(path.name)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > max_bytes:
        raise ValueError('Unsafe private state: ' + path.name)
    return json.loads(path.read_text())


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', suffix='.pending', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(data, stream, ensure_ascii=True, separators=(',', ':'))
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def recent_access_events(path, now, max_bytes=4_000_000):
    """Independent helper proof from Nginx-owned logs, not monitor queue data."""
    from scanner_policy import parse_access
    path = Path(path)
    if not path.exists():
        return []
    # Fixed paths only; reject symlinks and non-root/non-Nginx ownership.
    info = path.lstat()
    import pwd
    nginx_uid = pwd.getpwnam('www-data').pw_uid
    if not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, nginx_uid) or info.st_mode & 0o002:
        raise ValueError('Unsafe access-log source')
    with path.open('rb') as stream:
        start = max(0, info.st_size - max_bytes)
        stream.seek(start)
        if start:
            stream.readline()
        raw = stream.read(max_bytes)
    if not raw.endswith(b'\n'):
        raw = raw[:raw.rfind(b'\n') + 1]
    result = []
    for line in raw.decode('utf-8', errors='replace').splitlines():
        event = parse_access(line, now)
        if event:
            result.append(event)
    return result


def root_policy_json(path, max_bytes=100_000):
    path = Path(path)
    info = path.lstat()
    # Readable by the detector group, writable only by root.
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o027 or info.st_size > max_bytes:
        raise ValueError('Unsafe root-owned scanner policy')
    return json.loads(path.read_text())
