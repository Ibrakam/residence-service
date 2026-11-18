#!/usr/bin/env python3
"""Promote the scoped Next candidate after source guards; restore the old build on failure."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.request

app = Path('/var/www/tencorp')
candidate = Path('/var/www/tencorp-candidates/20261118-web-analytics')
backup = Path('/root/tencorp-workflow-backups/20261118-web-analytics')
manifest = json.loads((backup / 'source-manifest.json').read_text())
assert (candidate / '.next/BUILD_ID').is_file()
assert not (backup / 'next').exists(), 'A promotion already happened; inspect its result before retrying'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

for relative, expected in manifest['baseline'].items():
    assert digest(app / relative) == expected, 'Live source changed: ' + relative
for relative, expected in manifest['changed'].items():
    assert not Path(relative).is_absolute() and '..' not in Path(relative).parts
    assert digest(candidate / relative) == expected, 'Candidate changed: ' + relative
    if relative not in manifest['baseline']:
        assert not (app / relative).exists(), 'New source conflicts with an existing file: ' + relative
assert (app / '.env.local').read_bytes() == (candidate / '.env.local').read_bytes(), 'Runtime environment changed'

originals = backup / 'source-originals'
originals.mkdir(mode=0o700)
for relative in manifest['changed']:
    path = app / relative
    if path.is_file():
        original = originals / relative
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, original)

def replace_source(relative):
    target = app / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(target.name + '.web-analytics-tmp')
    shutil.copy2(candidate / relative, temporary)
    temporary.chmod(0o644)
    os.replace(temporary, target)

def status(route):
    try:
        with urllib.request.urlopen('http://127.0.0.1:3000' + route, timeout=3) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code
    except OSError:
        return 0

with Path('/run/lock/tencorp-web-analytics-deploy.lock').open('w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    subprocess.run(['cp', '-an', str(app / '.next/static') + '/.', str(candidate / '.next/static') + '/'], check=True)
    subprocess.run(['chmod', '-R', 'a+rX', str(candidate / '.next')], check=True)
    switched = False
    try:
        subprocess.run(['pm2', 'stop', 'tencorp'], check=True, stdout=subprocess.DEVNULL)
        (app / '.next').rename(backup / 'next')
        for relative in manifest['changed']:
            replace_source(relative)
        (candidate / '.next').rename(app / '.next')
        switched = True
        subprocess.run(['pm2', 'restart', 'tencorp', '--update-env'], check=True, stdout=subprocess.DEVNULL)
        for _ in range(30):
            if status('/api/web-events') == 405:
                break
            time.sleep(1)
        assert status('/api/web-events') == 405, 'Collector route did not start'
        assert status('/api/analytics/web') == 401, 'Operator report protection failed'
        (backup / 'AGENCY_CONFIRMED').write_text((app / '.next/BUILD_ID').read_text())
    except BaseException:
        subprocess.run(['pm2', 'stop', 'tencorp'], stdout=subprocess.DEVNULL)
        if switched:
            (app / '.next').rename(backup / 'failed-next')
        if (backup / 'next').exists():
            (backup / 'next').rename(app / '.next')
        for relative in manifest['changed']:
            original = originals / relative
            if original.exists():
                shutil.copy2(original, app / relative)
            elif relative not in manifest['baseline']:
                (app / relative).unlink(missing_ok=True)
        subprocess.run(['pm2', 'restart', 'tencorp', '--update-env'], stdout=subprocess.DEVNULL)
        raise
print('Website analytics application promoted; operator Basic protection passed; rollback build retained.')
