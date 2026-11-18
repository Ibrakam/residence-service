#!/usr/bin/env python3
"""Stage tracker references in both static sites without changing their current links."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import tempfile

backup = Path('/root/tencorp-workflow-backups/20261118-web-analytics')
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
stages = []
for name, root in [('portal', '/var/www/tencorp-preview'), ('sanat', '/var/www/sanat-subpath')]:
    root = Path(root)
    source = (root / 'current').resolve(strict=True)
    assert source.parent == root / 'releases'
    target = root / 'releases/20261118-web-analytics'
    assert not target.exists()
    original = (source / 'index.html').read_bytes()
    assert b'/web-analytics.js' not in original
    assert original.count(b'</body>') == 1
    updated = original.replace(b'</body>', b'<script defer src="/web-analytics.js?v=20261118-1"></script></body>')
    shutil.copytree(source, target, copy_function=os.link, symlinks=True)
    path = target / 'index.html'
    info = path.stat()
    descriptor, temporary = tempfile.mkstemp(dir=target, prefix='.index-web-')
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(updated)
        os.fchmod(handle.fileno(), info.st_mode & 0o777)
        os.fchown(handle.fileno(), info.st_uid, info.st_gid)
    os.replace(temporary, path)
    assert (source / 'index.html').read_bytes() == original
    assert path.stat().st_ino != (source / 'index.html').stat().st_ino
    stages.append({'name': name, 'root': str(root), 'source': str(source), 'target': str(target),
                   'before': hashlib.sha256(original).hexdigest(), 'after': hashlib.sha256(updated).hexdigest()})
(backup / 'static-stages.json').write_text(json.dumps(stages, indent=2) + '\n')
print(json.dumps(stages))
