#!/usr/bin/env python3
"""Stage a small public-static patch without mutating the previous release."""
from pathlib import Path
import hashlib,json,os,re,shutil,subprocess,time,urllib.request,urllib.error,fcntl
assert os.geteuid()==0
lock=os.open('/run/lock/tencorp-public-home-deploy.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
assert os.fstat(lock).st_uid==0
fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
ROOT=Path('/var/www/tencorp-preview')
SOURCE=Path('/opt/tencorp-public-home-performance')
VERSION='20261122-cold-1'
current=ROOT/'current';previous=current.resolve(strict=True)
assert previous.parent==ROOT/'releases'
final=ROOT/'releases'/VERSION
backup=Path('/root/tencorp-public-home-backups')/VERSION
backup.mkdir(parents=True,exist_ok=True,mode=0o700)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=json.loads((SOURCE/'patch/images-manifest.json').read_text())
assert manifest['schemaVersion']==1 and len(manifest['files'])==10
if previous==final:
    assert (backup/'verification.json').is_file(), 'Unconfirmed existing release'
    print((backup/'verification.json').read_text());raise SystemExit()
assert not final.exists(), 'Destination already exists'
assert current.is_symlink()
assert (previous/'assets/projects-map.js').is_file()
for item in manifest['files']:
    assert re.fullmatch(r'images/[a-z0-9_-]+\.(?:jpe?g|webp)',item['path'])
    assert sha(previous/item['path'])==item['sourceSha256'], 'Source image changed'
    if item['changed']:
        assert sha(SOURCE/'patch'/item['path'])==item['outputSha256']
loader=SOURCE/'projects-map-loader.js'
subprocess.run(['/usr/bin/node','--check',str(loader)],check=True)
private_hash=sha(previous/'assets/projects-map.js')
original_files={str(p.relative_to(previous)):sha(p) for p in previous.rglob('*') if p.is_file()}
(backup/'before.json').write_text(json.dumps({'previous':str(previous),'files':original_files,'newRelease':str(final)},indent=2))
incoming=ROOT/'releases'/('.incoming-'+VERSION+'-'+str(os.getpid()))
assert not incoming.exists()
shutil.copytree(previous,incoming,symlinks=True,copy_function=os.link)
def replace_bytes(path,data):
    # Atomic replacement breaks hardlinks; the previous release stays immutable.
    temp=path.with_name(path.name+'.new-'+str(os.getpid()))
    temp.write_bytes(data);temp.chmod(0o644);temp.replace(path)
changed=[]
for item in manifest['files']:
    if item['changed']:
        replace_bytes(incoming/item['path'],(SOURCE/'patch'/item['path']).read_bytes());changed.append(item['path'])
replace_bytes(incoming/'assets/projects-map-loader.js',loader.read_bytes());changed.append('assets/projects-map-loader.js')
index=(incoming/'index.html').read_text()
index,n=re.subn(r'/tencorp/assets/projects-map-loader\.js(?:\?[^"\s>]*)?', '/tencorp/assets/projects-map-loader.js?v='+VERSION,index)
assert n==1
replace_bytes(incoming/'index.html',index.encode());changed.append('index.html')
assert sha(incoming/'assets/projects-map.js')==private_hash
for name,digest in original_files.items():
    if name not in changed:assert sha(incoming/name)==digest, name
for name in changed+['assets/projects-map.js']:
    subprocess.run(['runuser','-u','www-data','--','test','-r',str(incoming/name)],check=True)
subprocess.run(['nginx','-t'],check=True)
incoming.rename(final)
temporary=ROOT/('.current-'+VERSION+'-'+str(os.getpid()))
temporary.symlink_to(final)
try:
    assert current.resolve()==previous, 'Concurrent public release change'
    temporary.replace(current)
    # Fetch only normal page/resources; never generate leads or revoke a fixture.
    with urllib.request.urlopen('https://form.tencorp.uz/',timeout=15) as r:
        html=r.read();assert r.status==200 and ('projects-map-loader.js?v='+VERSION).encode() in html
        assert html.count(b'/site-typography/20261122-1/site-fonts.css')==1
        assert html.count(b'/lead-security/client.js?v=20261119-1')==1
    with urllib.request.urlopen('https://form.tencorp.uz/tencorp/assets/projects-map-loader.js?v='+VERSION,timeout=15) as r:
        assert r.status==200 and hashlib.sha256(r.read()).hexdigest()==sha(loader)
    try:
        urllib.request.urlopen('https://form.tencorp.uz/tencorp/assets/projects-map.js',timeout=15)
        raise AssertionError('Private module was public')
    except urllib.error.HTTPError as error:assert error.code==401
    cookie=Path('/etc/tencorp-auth-gateway/deploy-smoke-session').read_text().strip()
    req=urllib.request.Request('https://form.tencorp.uz/tencorp/assets/projects-map.js',headers={'Cookie':'__Host-tencorp_session='+cookie})
    with urllib.request.urlopen(req,timeout=15) as r:assert r.status==200 and hashlib.sha256(r.read()).hexdigest()==private_hash
    assert all(sha(previous/name)==digest for name,digest in original_files.items()), 'Previous release mutated'
except Exception:
    temporary.unlink(missing_ok=True)
    if current.resolve()==final:
        temporary.symlink_to(previous);temporary.replace(current)
    raise
result={'installed':True,'release':str(final),'previous':str(previous),'changedFiles':changed,'protectedModuleUnchanged':True,'privateModuleGuestStatus':401,'authenticatedStatus':200,'previousReleaseUnchanged':True,'photoBytesSaved':manifest['sourceBytes']-manifest['outputBytes'],'backup':str(backup)}
(backup/'verification.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result))
