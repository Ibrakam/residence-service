#!/usr/bin/env python3
"""Root operator preflight; does not enable bans or send test messages."""
from pathlib import Path
import grp,json,os,pwd,re,shutil,subprocess,datetime

SOURCE=Path(__file__).resolve().parent
USER='tencorp-security-monitor'
CLOUDFLARE=['173.245.48.0/20','103.21.244.0/22','103.22.200.0/22','103.31.4.0/22','141.101.64.0/18','108.162.192.0/18','190.93.240.0/20','188.114.96.0/20','197.234.240.0/22','198.41.128.0/17','162.158.0.0/15','104.16.0.0/13','104.24.0.0/14','172.64.0.0/13','131.0.72.0/22','2400:cb00::/32','2606:4700::/32','2803:f800::/32','2405:b500::/32','2405:8100::/32','2a06:98c0::/29','2c0f:f248::/32']

def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=40)

def main():
 assert os.geteuid()==0
 assert 'nf_tables' in run(['iptables','--version']).stdout
 lock_config=Path('/etc/tmpfiles.d/tencorp-scanner-autoban.conf')
 shutil.copyfile(SOURCE/'tencorp-scanner-autoban.tmpfiles',lock_config);lock_config.chmod(0o644)
 run(['systemd-tmpfiles','--create',str(lock_config)])
 try:account=pwd.getpwnam(USER)
 except KeyError:
  run(['useradd','--system','--user-group','--no-create-home','--home-dir','/nonexistent','--shell','/usr/sbin/nologin',USER]);account=pwd.getpwnam(USER)
 assert account.pw_uid!=0 and account.pw_shell in ['/usr/sbin/nologin','/bin/false']
 group=grp.getgrnam(USER).gr_gid
 assert set(os.getgrouplist(USER,group))<={group,grp.getgrnam('adm').gr_gid,grp.getgrnam('systemd-journal').gr_gid}
 root=Path('/var/lib/tencorp-scanner-autoban');root.mkdir(mode=0o700,exist_ok=True);root.chmod(0o700)
 marker=root/'sandbox-root-marker';marker.write_text('sandbox permissions only');marker.chmod(0o600)
 local_addresses=[]
 import ipaddress
 for link in json.loads(run(['ip','-j','address','show']).stdout):
  for item in link.get('addr_info',[]):
   address=ipaddress.ip_address(item['local'])
   if address.is_global:local_addresses.append(str(address))
 assert local_addresses
 config=Path('/etc/tencorp-scanner-autoban/policy.json')
 config.parent.mkdir(parents=True,exist_ok=True,mode=0o750);os.chown(config.parent,0,group);config.parent.chmod(0o750)
 if not config.exists():
  import ipaddress
  operator=str(ipaddress.ip_address(os.environ['SSH_CONNECTION'].split()[0]))
  ng=run(['nginx','-T']).stdout
  proxies=re.findall(r'^\s*set_real_ip_from\s+([^; ]+);',ng,re.M)
  for value in proxies:ipaddress.ip_network(value,strict=False)
  data={'schemaVersion':1,'enabled':False,'originHost':'form.tencorp.uz','originIps':sorted(set(local_addresses)),'operatorCidrs':[operator],'protectedCidrs':sorted(set(CLOUDFLARE+proxies)),'proxyRangesReviewedAt':'2026-11-22','proxySources':['https://www.cloudflare.com/ips-v4/','https://www.cloudflare.com/ips-v6/']}
  config.write_text(json.dumps(data,indent=2));os.chown(config,0,group);config.chmod(0o640)
 else:
  data=json.loads(config.read_text());assert data.get('enabled') is False,'Do not alter active config in preflight'
  data['originIps']=sorted(set(local_addresses));config.write_text(json.dumps(data,indent=2))
 run(['/usr/bin/python3',str(SOURCE/'test_scanner_autoban.py')])
 # Same hardening profile as the real helper, with read-only/preflight actions.
 profile=(SOURCE/'tencorp-scanner-autoban.service').read_text()
 profile=profile.replace('Description=Block confirmed TenCorp vulnerability scanners','Description=Validate scanner helper sandbox without blocking')
 profile=profile.replace('/opt/tencorp-lead-guard/scanner-autoban.py',str(SOURCE/'sandbox-scanner-check.py')+' helper')
 helper=Path('/run/systemd/system/tencorp-scanner-autoban-check.service');helper.write_text(profile)
 profile=(SOURCE/'tencorp-security-monitor.service').read_text()
 profile=profile.replace('StateDirectory=tencorp-security-monitor','StateDirectory=tencorp-security-monitor-check').replace('ReadWritePaths=/var/lib/tencorp-security-monitor','ReadWritePaths=/var/lib/tencorp-security-monitor-check')
 profile=profile.replace('/opt/tencorp-lead-guard/security-monitor.py',str(SOURCE/'sandbox-scanner-check.py')+' detector')
 detector=Path('/run/systemd/system/tencorp-security-monitor-check.service');detector.write_text(profile)
 run(['systemctl','daemon-reload'])
 for unit in ['tencorp-scanner-autoban-check.service','tencorp-security-monitor-check.service']:
  started=datetime.datetime.now(datetime.timezone.utc).timestamp()
  run(['systemctl','start',unit])
  print(run(['journalctl','-u',unit,'--since','@'+str(int(started)),'-o','cat','--no-pager']).stdout.strip())
 replay=run(['/usr/bin/python3',str(SOURCE/'scanner-autoban.py'),'--replay','/root/tencorp-secret-probe-20261122-0710.json'])
 print(replay.stdout.strip())
 marker.unlink()
 print(json.dumps({'staged':True,'policyEnabled':data['enabled'],'servicesActivated':False,'operatorProtected':True,'source':str(SOURCE)}))

if __name__=='__main__':main()
