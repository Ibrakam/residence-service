#!/usr/bin/env python3
"""Publish a shared font layer without rebuilding unrelated frontends.

Run after copying this directory to /opt/tencorp-typography. Existing auth,
lead verification, map scripts, and application releases are preserved.
"""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import time

VERSION = '20261119-1'
ROOT = Path('/opt/tencorp-typography')
SITE = Path('/etc/nginx/sites-enabled/tencorp').resolve()
MAP = Path('/etc/nginx/conf.d/tencorp-typography.conf')
LOCATIONS = Path('/etc/nginx/snippets/tencorp-typography.conf')
BACKUP = Path('/root/tencorp-typography-backups') / str(int(time.time()))
PROJECTS = 'avalon|4u|bayterak|botanika-saroyi|c1|flagman|jomiy|maftun-makon|meros|mirador|ofiyat|regnum-plaza|saadiyat|sado|sarbon|soy-boyi|sun|voha|yangibaxt|zamon|pushkin|sanat|tencorp|tencrop|privacy|web-analytics-privacy'


def install():
    assert (ROOT / 'site-fonts.css').is_file()
    assert all((ROOT / 'assets' / name).is_file() for name in (
        'montserrat.woff2', 'helvetica-neue-400.woff2',
        'helvetica-neue-500.woff2', 'helvetica-neue-700.woff2',
        'helvetica-neue-italic.woff2'))
    BACKUP.mkdir(parents=True, mode=0o700)
    paths = (SITE, MAP, LOCATIONS)
    originals = {path: path.read_bytes() if path.exists() else None for path in paths}
    for index, (path, content) in enumerate(originals.items()):
        if content is not None:
            (BACKUP / str(index)).write_bytes(content)
    (BACKUP / 'paths.json').write_text(json.dumps([str(p) for p in paths]))
    try:
        # request_uri is deliberate: try_files rewrites $uri to /index.html.
        markup = f'<link rel="stylesheet" href="/site-typography/{VERSION}/site-fonts.css">'
        MAP.write_text('''# Shared marketing typography; first matching regex wins.
map $request_uri $tencorp_typography_markup {
    default "";
    ~^/(?:tencrop/)?dormon-hills(?:/|[?]|$) "";
''' + f"    ~^/(?:[?].*)?$ '{markup}';\n" +
            f"    ~^/(?:{PROJECTS})(?:/|[?]|$) '{markup}';\n" + '}\n')
        LOCATIONS.write_text(f'''# Public, immutable font files contain no application data.
location ^~ /site-typography/{VERSION}/ {{
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    alias {ROOT}/assets/;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
}}
''')
        # Keep the single existing security replacement; two rules for <head>
        # would compete with each other in sub_filter.
        text = originals[SITE].decode()
        old = '<head><script defer src="/lead-security/client.js?v=20261119-1"></script>'
        new = old + '$tencorp_typography_markup'
        if new not in text:
            assert text.count(old) == 1, 'Unexpected security filter; review manually'
            text = text.replace(old, new)
        marker = '    include /etc/nginx/snippets/tencorp-lead-security-locations.conf;'
        include = '    include /etc/nginx/snippets/tencorp-typography.conf;'
        assert marker in text
        if include not in text:
            text = text.replace(marker, include + '\n' + marker)
        # /privacy declares its own sub_filter, so it does not inherit the
        # server-level filters. Add typography there without altering its copy.
        privacy = '    location = /privacy {\n'
        if privacy in text:
            rule = "        sub_filter '<head>' '<head>$tencorp_typography_markup';\n"
            if privacy + rule not in text:
                text = text.replace(privacy, privacy + rule)
        SITE.write_text(text)
        subprocess.run(['nginx', '-t'], check=True)
        subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    except Exception:
        for path, content in originals.items():
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(content)
        subprocess.run(['nginx', '-t'], check=True)
        raise
    print(json.dumps({'backup': str(BACKUP), 'version': VERSION,
                      'stylesheetSha256': hashlib.sha256((ROOT / 'assets/site-fonts.css').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    install()
