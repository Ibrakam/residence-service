#!/usr/bin/env python3
"""Stop the reviewed orphan previews, preserving private restart metadata."""
from pathlib import Path
import subprocess,re,json,os,signal,time
rows=[(3012928,4398,'/var/www/tencorp-candidates/20260917T061126Z-auth-users'),(1553815,4287,'/var/www/avalon-residence/repository/website'),(1554618,4291,'/var/www/avalon-residence/repository/website'),(1566068,4293,'/var/www/avalon-residence/repository/website'),(1566280,4294,'/var/www/avalon-residence/repository/website')]
nginx=subprocess.run(['nginx','-T'],capture_output=True,text=True,check=True).stdout
backup=Path('/root/tencorp-maintenance-backups/unused-previews-20261120')
backup.mkdir(parents=True,exist_ok=True,mode=0o700)
for pid,port,expected in rows:
    p=Path('/proc')/str(pid)
    if not p.exists():continue
    assert str((p/'cwd').resolve())==expected
    assert not re.search(r':'+str(port)+r'\b',nginx)
    assert '/session-' in (p/'cgroup').read_text(), 'Not an orphan user-session process'
    con=subprocess.run(['ss','-tnH','state','established','(','sport','=',':'+str(port),')'],capture_output=True,text=True,check=True)
    assert not con.stdout.strip(), 'Preview has active clients'
    args=(p/'cmdline').read_bytes().decode().rstrip('\0').split('\0')
    f=backup/(str(pid)+'.json');f.write_text(json.dumps({'cwd':expected,'args':args,'port':port}));f.chmod(0o600)
    os.kill(pid,signal.SIGTERM)
    print(json.dumps({'stoppedPid':pid,'port':port,'privateRestartMetadata':str(f)}))
time.sleep(1)
for pid,port,expected in rows:
    con=subprocess.run(['ss','-ltnH','(','sport','=',':'+str(port),')'],capture_output=True,text=True,check=True)
    assert not con.stdout.strip(), 'Preview listener remains'
