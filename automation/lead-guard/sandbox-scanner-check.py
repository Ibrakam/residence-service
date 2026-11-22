#!/usr/bin/env python3
"""Sandbox checks only; never inserts a real firewall rule or sends a message."""
from pathlib import Path
import json,os,subprocess,sys,fcntl,urllib.request,ipaddress
sys.path.insert(0,str(Path(__file__).resolve().parent))
from scanner_io import root_policy_json,atomic_json

kind=sys.argv[1]
config=root_policy_json('/etc/tencorp-scanner-autoban/policy.json')
assert config['enabled'] is False
cred=Path(os.environ['CREDENTIALS_DIRECTORY'])/'telegram-token'
assert len(cred.read_text().strip())>20
if kind=='helper':
 assert os.geteuid()==0
 own=[]
 addresses=json.loads(subprocess.run(['/usr/sbin/ip','-j','address','show'],capture_output=True,text=True,check=True).stdout)
 for link in addresses:
  for item in link.get('addr_info',[]):
   address=ipaddress.ip_address(item['local'])
   if address.is_global:own.append(str(address))
 assert set(own)<=set(config['originIps'])
 with open('/run/ufw.lock','a') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX);fcntl.flock(lock,fcntl.LOCK_UN)
 for args in [['/usr/sbin/ufw','status'],['/usr/sbin/ufw','show','added'],['/usr/sbin/iptables','-S','ufw-user-input'],['/usr/sbin/ip6tables','-S','ufw6-user-input'],['/usr/sbin/ufw','--dry-run','insert','1','deny','from','203.0.113.253','to','any','comment','sandbox-dryrun-only'],['/usr/sbin/nginx','-t']]:
  p=subprocess.run(args,capture_output=True,text=True,timeout=15)
  assert p.returncode==0, str(args[:2])+': '+p.stderr[:300]
 p=Path('/var/lib/tencorp-scanner-autoban/.sandbox-state');atomic_json(p,{'test':True});p.unlink()
 print(json.dumps({'helperSandbox':True,'netfilterRead':True,'ufwDryRunOnly':True,'nginxSyntax':True,'credentialReadable':True,'realBlocks':0,'messagesSent':0,'ownGlobalIPv4Protected':any(ipaddress.ip_address(a).version==4 for a in own),'ownGlobalIPv6Protected':any(ipaddress.ip_address(a).version==6 for a in own)}))
elif kind=='detector':
 assert os.geteuid()!=0
 token=cred.read_text().strip()
 try:
  with urllib.request.urlopen('https://api.telegram.org/bot'+token+'/getMe',timeout=8) as response:
   assert json.load(response).get('ok') is True
 except Exception as error:
  print(json.dumps({'botReadOnlyAuthFailed':type(error).__name__}));raise SystemExit(1)
 status=Path('/proc/self/status').read_text()
 assert int(next(l.split()[1] for l in status.splitlines() if l.startswith('CapEff:')),16)==0
 with Path('/var/log/nginx/access.log').open('rb') as f:f.read(1)
 p=subprocess.run(['journalctl','-u','tencorp-lead-guard','-n','1','-o','cat','--no-pager'],capture_output=True,text=True,timeout=10)
 assert p.returncode==0
 atomic_json('/var/lib/tencorp-security-monitor-check/state.json',{'test':True})
 assert not os.access('/var/lib/tencorp-scanner-autoban/sandbox-root-marker',os.R_OK)
 assert not os.access('/var/lib/tencorp-scanner-autoban',os.W_OK)
 assert not os.access('/etc/ufw/user.rules',os.W_OK)
 assert not os.access('/etc/nginx/conf.d',os.W_OK)
 assert not os.access('/run/systemd/private',os.W_OK)
 assert not os.access('/run/dbus/system_bus_socket',os.W_OK)
 print(json.dumps({'detectorSandbox':True,'uidNonRoot':True,'capabilitiesEmpty':True,'accessLogReadable':True,'journalReadable':True,'helperStateInaccessible':True,'firewallAndNginxReadOnly':True,'systemdControlDenied':True,'credentialReadable':True,'botReadOnlyAuth':True,'messagesSent':0}))
else:raise ValueError('Unknown check')
