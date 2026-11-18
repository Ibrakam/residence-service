#!/usr/bin/env python3
"""Install narrowly scoped first-party telemetry routes; preserve auth boundaries."""
import os
from pathlib import Path
import shutil
import subprocess

backup = Path('/root/tencorp-workflow-backups/20261118-web-analytics/nginx')
backup.mkdir(parents=True, exist_ok=True, mode=0o700)
main = Path('/etc/nginx/sites-enabled/tencorp').resolve(strict=True)
agency = Path('/etc/nginx/snippets/residence-avalon-and-agency.conf')
maps = Path('/etc/nginx/conf.d/tencorp-web-analytics.conf')
locations = Path('/etc/nginx/snippets/tencorp-web-analytics-locations.conf')
assert not maps.exists() and not locations.exists(), 'Telemetry already configured; inspect before changing'

headers = '''proxy_set_header X-Tencorp-Web-Visitor $tencorp_web_visitor_cookie;
{indent}proxy_set_header X-Tencorp-Web-Session $tencorp_web_session_cookie;
'''

def add_headers(source, route):
    import re
    match = re.search(r'(?m)^( *)location = ' + re.escape(route) + r' \{', source)
    assert match, 'Missing exact route: ' + route
    end = source.index('\n' + match[1] + '}', match.end())
    block = source[match.start():end]
    anchor = 'proxy_set_header X-Real-IP $remote_addr;'
    assert block.count(anchor) == 1
    indent = match[1] + '    '
    block = block.replace(anchor, anchor + '\n' + indent + headers.format(indent=indent).rstrip())
    return source[:match.start()] + block + source[end:]

main_source, agency_source = main.read_text(), agency.read_text()
updated = main_source
for route in ['/v1/leads', '/api/submit', '/tencrop/v1/leads']:
    updated = add_headers(updated, route)
anchor = '    include /etc/nginx/snippets/residence-root-route.conf;'
assert updated.count(anchor) == 1
updated = updated.replace(anchor, anchor + '\n    include /etc/nginx/snippets/tencorp-web-analytics-locations.conf;')
# Add a plain privacy link only. Login, OAuth and gateway CSP stay untouched.
privacy_anchor = '    location = /privacy {\n'
assert updated.count(privacy_anchor) == 1
updated = updated.replace(privacy_anchor, privacy_anchor + '''        sub_filter_once on;
        sub_filter '</main>' '<p><a href="/web-analytics-privacy">Статистика посещений / Website analytics / Tashriflar tahlili</a></p></main>';
        proxy_set_header Accept-Encoding "";
''')
agency_updated = add_headers(agency_source, '/v1/agency-leads')

map_source = '''# Http-level maps select ONLY signed analytics cookies, never the login session.
map $http_cookie $tencorp_web_visitor_cookie {
    default "";
    "~(?:^|;[[:space:]]*)__Host-tencorp_web_visitor=(?<tencorp_web_visitor_value>[A-Za-z0-9_.-]{1,400})(?:;|$)" $tencorp_web_visitor_value;
}
map $http_cookie $tencorp_web_session_cookie {
    default "";
    "~(?:^|;[[:space:]]*)__Host-tencorp_web_session=(?<tencorp_web_session_value>[A-Za-z0-9_.-]{1,400})(?:;|$)" $tencorp_web_session_value;
}
limit_req_zone $binary_remote_addr zone=tencorp_web_events_per_ip:10m rate=5r/s;
'''
location_source = '''# Anonymous bounded ingestion only; report routes retain existing operator Basic auth.
location = /api/web-events {
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    if ($request_method != POST) { return 405; }
    if ($args != "") { return 400; }
    client_max_body_size 16k;
    limit_req zone=tencorp_web_events_per_ip burst=20 nodelay;
    limit_req_status 429;
    access_log off;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Cookie "__Host-tencorp_web_visitor=$tencorp_web_visitor_cookie; __Host-tencorp_web_session=$tencorp_web_session_cookie";
    proxy_set_header X-Tencorp-Web-Visitor $tencorp_web_visitor_cookie;
    proxy_set_header X-Tencorp-Web-Session $tencorp_web_session_cookie;
    proxy_set_header Authorization "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 10s;
    proxy_send_timeout 10s;
}
location ^~ /api/web-events/ { return 404; }
location = /web-analytics.js {
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    if ($request_method !~ ^(?:GET|HEAD)$) { return 405; }
    alias /var/www/tencorp-web-analytics/current/web-analytics.js;
    default_type application/javascript;
    add_header Cache-Control "public, max-age=300" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000" always;
    access_log off;
}
location = /web-analytics-privacy {
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    if ($request_method !~ ^(?:GET|HEAD)$) { return 405; }
    alias /var/www/tencorp-web-analytics/current/privacy.html;
    default_type text/html;
    add_header Cache-Control "public, max-age=300" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Content-Security-Policy "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" always;
}
'''

def replace(path, content):
    temporary = path.with_name(path.name + '.web-analytics-tmp')
    temporary.write_text(content)
    temporary.chmod(0o644)
    os.replace(temporary, path)

shutil.copy2(main, backup / 'tencorp.conf')
shutil.copy2(agency, backup / 'residence-avalon-and-agency.conf')
try:
    replace(maps, map_source)
    replace(locations, location_source)
    replace(main, updated)
    replace(agency, agency_updated)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
except BaseException:
    replace(main, main_source)
    replace(agency, agency_source)
    maps.unlink(missing_ok=True)
    locations.unlink(missing_ok=True)
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    raise
print('Web analytics exact routes installed; project, analytics and OAuth authentication preserved.')
