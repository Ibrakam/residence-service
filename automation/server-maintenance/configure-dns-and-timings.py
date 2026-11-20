#!/usr/bin/env python3
"""Scoped DNS and request timing configuration with exact rollback backups."""
from pathlib import Path
import json,subprocess,time
backup=Path('/root/tencorp-maintenance-backups')/str(int(time.time()))
backup.mkdir(parents=True,mode=0o700)
site=Path('/etc/nginx/sites-enabled/tencorp').resolve()
original=site.read_text()
assert 'server_name form.tencorp.uz' in original
conf=Path('/etc/nginx/conf.d/tencorp-timings.conf')
rotation=Path('/etc/logrotate.d/tencorp-timings')
dns=Path('/etc/systemd/network/10-netplan-eth0.network.d/60-tencorp-dns.conf')
network=Path('/run/systemd/network/10-netplan-eth0.network')
assert network.exists()
# Extra timings deliberately omit query strings, IP, cookies, headers and bodies.
fmt='''log_format tencorp_timing escape=json '{"time":"$time_iso8601","request_id":"$request_id","method":"$request_method","uri":"$uri","status":$status,"bytes":$body_bytes_sent,"request_seconds":$request_time,"upstream_seconds":"$upstream_response_time","connect_seconds":"$upstream_connect_time","header_seconds":"$upstream_header_time","protocol":"$server_protocol"}';
'''
lines='''    # Keep security monitoring's existing combined log; add bounded timing diagnostics.
    access_log /var/log/nginx/access.log combined;
    access_log /var/log/nginx/tencorp-timing.log tencorp_timing;
'''
# Add only the TLS virtual host, preserving all location-specific log overrides.
marker='    server_name form.tencorp.uz;'
idx=original.index(marker)
# sites may define HTTP redirect first; select TLS block containing reviewed auth gate.
blocks=original.split('\nserver {')
found=0
for i,block in enumerate(blocks):
    if 'server_name form.tencorp.uz;' in block and 'ssl' in block and 'tencorp-auth-gate.conf' in block:
        if 'tencorp-timing.log' not in block:
            blocks[i]=block.replace(marker,marker+'\n'+lines,1)
        found+=1
assert found==1, 'Unexpected TLS vhost structure'
updated='\nserver {'.join(blocks)
# Framework files previously suppressed all logs. Preserve their auth/cache
# policy while recording transfer timings for diagnosing slow JS/CSS downloads.
static_marker='    location ^~ /residence-assets/_next/static/ {'
start=updated.index(static_marker)
end=updated.index('\n    }',start)
block=updated[start:end]
if 'access_log off;' in block:
    block=block.replace('access_log off;','access_log /var/log/nginx/tencorp-timing.log tencorp_timing;')
    updated=updated[:start]+block+updated[end:]
assert 'access_log /var/log/nginx/tencorp-timing.log tencorp_timing;' in updated[start:updated.index('\n    }',start)]
files={site:updated.encode(),conf:fmt.encode(),rotation:b'''/var/log/nginx/tencorp-timing.log {
    daily
    maxsize 50M
    rotate 7
    missingok
    notifempty
    compress
    delaycompress
    create 0640 www-data adm
    sharedscripts
    postrotate
        if [ -f /run/nginx.pid ]; then kill -USR1 $(cat /run/nginx.pid); fi
    endscript
}
''',dns:b'[Network]\nDNS=\nDNS=8.8.8.8 8.8.4.4\n\n[DHCPv4]\nUseDNS=no\n\n[DHCPv6]\nUseDNS=no\n\n[IPv6AcceptRA]\nUseDNS=no\n'}
old={p:p.read_bytes() if p.exists() else None for p in files}
(backup/'paths.json').write_text(json.dumps([str(p) for p in files]))
for i,(p,data) in enumerate(old.items()):
    if data is not None:(backup/str(i)).write_bytes(data)
previous_dns=subprocess.run(['resolvectl','dns','eth0'],capture_output=True,text=True,check=True).stdout
(backup/'previous-dns.txt').write_text(previous_dns)
try:
    for p,data in files.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);p.chmod(0o644)
    subprocess.run(['nginx','-t'],check=True)
    subprocess.run(['logrotate','--debug',str(rotation)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    subprocess.run(['resolvectl','dns','eth0','8.8.8.8','8.8.4.4'],check=True)
    subprocess.run(['resolvectl','flush-caches'],check=True)
    subprocess.run(['systemctl','reload','nginx'],check=True)
except Exception:
    for p,data in old.items():
        if data is None:p.unlink(missing_ok=True)
        else:p.write_bytes(data)
    prior=previous_dns.split(':',1)[1].strip().split()
    if prior:subprocess.run(['resolvectl','dns','eth0',*prior],check=False)
    subprocess.run(['nginx','-t'],check=True)
    subprocess.run(['systemctl','reload','nginx'],check=True)
    raise
print(json.dumps({'installed':True,'backup':str(backup),'dns':['8.8.8.8','8.8.4.4'],'timingLog':'/var/log/nginx/tencorp-timing.log','networkInterfaceRestarted':False}))
