#!/usr/bin/env python3
"""Apply scoped security gateway routing to existing production configuration."""
from pathlib import Path
import re
import shutil
import subprocess
import time

backup = Path('/root/tencorp-security-backups') / str(int(time.time()))
backup.mkdir(parents=True, mode=0o700)
paths = [Path('/etc/nginx/sites-enabled/tencorp'), Path('/etc/nginx/snippets/residence-avalon-and-agency.conf')]
try:
    for path in paths:
        original = path.read_text()
        shutil.copy2(path, backup / path.name)
        def replace(match):
            block = match.group(0)
            block = re.sub(r'proxy_pass http://127\.0\.0\.1:(?:4320|4310|3000);', 'proxy_pass http://127.0.0.1:4350;', block)
            block = block.replace('proxy_set_header Cookie "";', 'proxy_set_header Cookie $http_cookie;')
            if 'proxy_set_header Cookie' not in block:
                block = block.replace('proxy_set_header Connection "";', 'proxy_set_header Connection "";\n        proxy_set_header Cookie $http_cookie;')
            block = block.replace('proxy_read_timeout 10s;', 'proxy_read_timeout 20s;')
            return block
        updated = re.sub(r'location = /(?:v1/leads|v1/agency-leads|tencrop/v1/leads|api/submit) \{.*?\n\s*\}', replace, original, flags=re.S)
        # proxy_set_header inheritance is all-or-nothing. Set this beside each
        # proxy_pass so HTML arrives uncompressed for the response filter.
        updated = re.sub(r'(proxy_pass http://127\.0\.0\.1:\d+;)(?!\n\s*proxy_set_header Accept-Encoding)', r'\1\n        proxy_set_header Accept-Encoding "";', updated)
        if path.name == 'tencorp':
            marker = '    include /etc/nginx/snippets/residence-root-route.conf;'
            assert marker in updated
            if 'tencorp-lead-security-locations.conf' not in updated:
                updated = updated.replace(marker, '''    include /etc/nginx/snippets/tencorp-lead-security-locations.conf;
    # Script wraps only lead POSTs; no challenge is required to read content.
    sub_filter_once on;
    sub_filter '<head>' '<head><script defer src="/lead-security/client.js?v=20261119-1"></script>';
    proxy_set_header Accept-Encoding "";
''' + marker)
        for match in re.finditer(r'location = /(?:v1/leads|v1/agency-leads|tencrop/v1/leads|api/submit) \{.*?\n\s*\}', updated, re.S):
            assert 'proxy_pass http://127.0.0.1:4350;' in match.group(0), 'Unprotected lead route'
        path.write_text(updated)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except Exception:
    for path in paths:
        saved = backup / path.name
        if saved.exists():
            shutil.copy2(saved, path)
    subprocess.run(['nginx', '-t'], check=True)
    raise
print('Security configuration backup:', backup)
