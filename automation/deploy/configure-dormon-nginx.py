#!/usr/bin/env python3
"""Add the guarded Do‘rmon paths, validate Nginx, restore the file on failure."""
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

p = Path('/etc/nginx/sites-enabled/tencorp').resolve(strict=True)
base = p.read_text()
anchor = 'location ~ ^/(?:4u|bayterak|botanika-saroyi|c1|flagman|'
assert base.count(anchor) == 1, 'Unexpected project route; inspect before editing'
assert 'location = /api/dormon-plans {' not in base, 'Do‘rmon already configured'
updated = base.replace(anchor, anchor.replace('|c1|flagman|', '|c1|dormon-hills|flagman|'))
api_anchor = '    location = /api/pushkin-catalog {'
assert updated.count(api_anchor) == 1
api = '''    location = /api/dormon-plans {
        include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
        if ($request_method !~ ^(?:GET|HEAD|OPTIONS)$) { return 405; }
        proxy_pass http://127.0.0.1:4320;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 2s;
        proxy_read_timeout 40s;
    }
    location ^~ /api/dormon-plans/ { return 404; }

'''
updated = updated.replace(api_anchor, api + api_anchor)
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup_dir = Path('/root/tencorp-workflow-backups') / (stamp + '-dormon-nginx')
backup_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
backup = backup_dir / 'nginx-tencorp.conf'
backup.write_bytes(p.read_bytes())
backup.chmod(0o600)

def replace(content):
    temporary = p.with_name(p.name + '.dormon-tmp')
    temporary.write_text(content)
    temporary.chmod(0o644)
    os.replace(temporary, p)

replace(updated)
try:
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    replace(base)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print('Do‘rmon guarded project/API routes installed; backup:', backup)
