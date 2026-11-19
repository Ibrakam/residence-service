#!/usr/bin/env python3
"""Install scoped authenticated browser revalidation for Do‘rmon images."""
from pathlib import Path
import json
import subprocess
import time


def install():
    source = Path(__file__).resolve().parent
    site = Path('/etc/nginx/sites-enabled/tencorp').resolve()
    snippets = Path('/etc/nginx/snippets')
    files = {
        snippets / name: (source / 'nginx' / name).read_bytes()
        for name in ['tencorp-auth-protect-dormon-media.conf', 'dormon-media-cache.conf']
    }
    files[Path('/etc/nginx/conf.d/tencorp-dormon-media-cache.conf')] = (source / 'nginx/tencorp-dormon-media-cache.conf').read_bytes()
    original = site.read_text()
    marker = '    include /etc/nginx/snippets/residence-avalon-and-agency.conf;'
    include = '    include /etc/nginx/snippets/dormon-media-cache.conf;'
    assert marker in original and 'dormon-hills|' in original, 'Unexpected production route layout'
    updated = original if include in original else original.replace(marker, include + '\n' + marker)
    assert updated.index(include) < updated.index('location ~ ^/(?:4u|'), 'Image regex would be shadowed'
    files[site] = updated.encode()
    originals = {p: p.read_bytes() if p.exists() else None for p in files}
    backup = Path('/root/tencorp-dormon-media-backups') / str(int(time.time()))
    backup.mkdir(parents=True, mode=0o700)
    (backup / 'paths.json').write_text(json.dumps([str(p) for p in files]))
    for index, (p, data) in enumerate(originals.items()):
        if data is not None:
            (backup / str(index)).write_bytes(data)
    try:
        for p, data in files.items():
            p.write_bytes(data)
            p.chmod(0o644)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        for p, data in originals.items():
            if data is None:
                p.unlink(missing_ok=True)
            else:
                p.write_bytes(data)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
        raise
    print(json.dumps({'installed': True, 'backup': str(backup), 'scope': 'dormon-images-only'}))


if __name__ == '__main__':
    install()
