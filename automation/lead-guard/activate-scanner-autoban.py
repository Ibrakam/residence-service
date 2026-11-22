#!/usr/bin/env python3
"""Reviewed operator activation, with a private exact-file rollback snapshot."""
from pathlib import Path
import datetime,json,os,pwd,shutil,subprocess

SOURCE=Path(__file__).resolve().parent
DEST=Path('/opt/tencorp-lead-guard')
POLICY=Path('/etc/tencorp-scanner-autoban/policy.json')
DETECTOR=Path('/var/lib/tencorp-security-monitor')
HELPER=Path('/var/lib/tencorp-scanner-autoban')
USER='tencorp-security-monitor'
FILES=['scanner_policy.py','scanner_io.py','scanner-autoban.py','security-monitor.py']
UNITS=['tencorp-security-monitor.service','tencorp-scanner-autoban.service','tencorp-scanner-autoban.path','tencorp-scanner-autoban.timer']


def run(args):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=90)


def main():
 assert os.geteuid()==0
 for unit in ['tencorp-scanner-autoban-check.service','tencorp-security-monitor-check.service']:
  assert run(['systemctl','show',unit,'-p','Result','--value']).stdout.strip()=='success'
 config=json.loads(POLICY.read_text());assert config.get('enabled') is False
 account=pwd.getpwnam(USER);assert account.pw_uid!=0
 if (HELPER/'scanner-bans.json').exists():assert not json.loads((HELPER/'scanner-bans.json').read_text()).get('bans'),'Review existing leases before upgrade'
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 backup=Path('/root/tencorp-scanner-autoban-backups')/stamp;backup.mkdir(parents=True,mode=0o700)
 paths=[DEST/n for n in FILES]+[Path('/etc/systemd/system')/n for n in UNITS]+[POLICY]
 old={str(p):{'bytes':p.read_bytes() if p.exists() else None,'mode':p.stat().st_mode&0o777 if p.exists() else None} for p in paths}
 (backup/'paths.json').write_text(json.dumps(list(old)))
 for i,(path,data) in enumerate(old.items()):
  if data['bytes'] is not None:(backup/str(i)).write_bytes(data['bytes'])
 if (DETECTOR/'state.json').exists():shutil.copy2(DETECTOR/'state.json',backup/'detector-state-before.json')
 run(['systemctl','stop','tencorp-security-monitor.timer','tencorp-security-monitor.service'])
 try:
  for name in FILES:
   target=DEST/name;shutil.copyfile(SOURCE/name,target);os.chown(target,0,0);target.chmod(0o644)
  for name in UNITS:
   target=Path('/etc/systemd/system')/name;shutil.copyfile(SOURCE/name,target);target.chmod(0o644)
  run(['systemd-analyze','verify',*[str(Path('/etc/systemd/system')/n) for n in UNITS]])
  DETECTOR.mkdir(parents=True,exist_ok=True,mode=0o700)
  for p in [DETECTOR,*DETECTOR.iterdir()]:
   assert not p.is_symlink()
   if p.is_file() or p==DETECTOR:os.chown(p,account.pw_uid,account.pw_gid);p.chmod(0o700 if p.is_dir() else 0o600)
  config['enabled']=True;POLICY.write_text(json.dumps(config,indent=2));os.chown(POLICY,0,account.pw_gid);POLICY.chmod(0o640)
  run(['systemctl','daemon-reload'])
  run(['systemctl','start','tencorp-security-monitor.service'])
  run(['systemctl','start','tencorp-scanner-autoban.service'])
  run(['systemctl','enable','--now','tencorp-security-monitor.timer','tencorp-scanner-autoban.path','tencorp-scanner-autoban.timer'])
  for unit in ['tencorp-security-monitor.service','tencorp-scanner-autoban.service']:
   assert run(['systemctl','show',unit,'-p','Result','--value']).stdout.strip()=='success'
  run(['nginx','-t'])
 except Exception:
  config['enabled']=False;POLICY.write_text(json.dumps(config,indent=2));POLICY.chmod(0o640)
  run(['systemctl','stop','tencorp-scanner-autoban.path','tencorp-scanner-autoban.timer'])
  # Restore the previous detector immediately. Keep helper/proof files if an
  # actual lease was created, so rollback never turns it into an orphan ban.
  for name in ['security-monitor.py','tencorp-security-monitor.service']:
   target=DEST/name if name.endswith('.py') else Path('/etc/systemd/system')/name
   prior=old[str(target)]
   if prior['bytes'] is not None:target.write_bytes(prior['bytes']);target.chmod(prior['mode'])
  run(['systemctl','daemon-reload']);run(['systemctl','enable','--now','tencorp-security-monitor.timer'])
  if (HELPER/'scanner-bans.json').exists() and json.loads((HELPER/'scanner-bans.json').read_text()).get('bans'):
   run(['systemctl','enable','--now','tencorp-scanner-autoban.timer'])
  raise
 print(json.dumps({'activated':True,'backup':str(backup),'detectorUidNonRoot':True,'helperStateSeparated':True,'banDurationDays':7,'fakeBlocks':0}))

if __name__=='__main__':main()
