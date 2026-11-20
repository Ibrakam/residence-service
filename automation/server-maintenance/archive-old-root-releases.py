#!/usr/bin/env python3
"""Archive immutable inactive legacy releases, verify contents, then remove copies."""
import json, os, pathlib, shutil, subprocess, time
ROOT=pathlib.Path('/var/www/residence-service/root-releases')
SERVICE=pathlib.Path('/var/www/residence-service')
def in_use():
    paths=set()
    for name in ['root-current','current']:
        paths.add(str((SERVICE/name).resolve()))
    for p in pathlib.Path('/proc').iterdir():
        if p.name.isdigit():
            try: paths.add(str((p/'cwd').resolve(strict=True)))
            except (OSError,RuntimeError): pass
    return paths
# Fixed legacy cohort only. Never automatically select new/recent releases.
names=[p.name for p in sorted(ROOT.iterdir()) if p.is_dir() and not p.is_symlink() and p.name[:8]<'20261001'][:10]
assert len(names)==10 and all(n.startswith('202609') for n in names)
for n in names:
    assert not any(p==str(ROOT/n) or p.startswith(str(ROOT/n)+'/') for p in in_use()), n
assert shutil.disk_usage(ROOT).free > 8*1024**3
backup=pathlib.Path('/var/backups/residence-release-archives/20261120')
backup.mkdir(parents=True,exist_ok=True,mode=0o700)
archive=backup/'inactive-root-releases-september-first10.tar.zst'
assert not archive.exists()
manifest=backup/'manifest.json'
manifest.write_text(json.dumps({'createdAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'root':str(ROOT),'names':names,'verified':False},indent=2))
# Long-window compression deduplicates identical assets across these releases.
# Monitor free space while packing; an interrupted pack never removes originals.
reader=subprocess.Popen(['nice','-n','15','ionice','-c','3','tar','-cf','-','-C',str(ROOT),'--',*names],stdout=subprocess.PIPE)
writer=subprocess.Popen(['nice','-n','15','zstd','-q','--long=31','-T1','-3','-o',str(archive)],stdin=subprocess.PIPE)
try:
    while chunk:=reader.stdout.read(1024*1024):
        if shutil.disk_usage(ROOT).free<2*1024**3:raise RuntimeError('Archive reserve exhausted')
        writer.stdin.write(chunk)
    writer.stdin.close()
    assert reader.wait()==0 and writer.wait()==0
    subprocess.run(['zstd','--long=31','-q','-t',str(archive)],check=True)
    subprocess.run(['nice','-n','15','ionice','-c','3','tar','--use-compress-program=zstd --long=31 -T1','--compare','--file',str(archive),'-C',str(ROOT)],check=True)
except Exception:
    reader.kill();writer.kill();archive.unlink(missing_ok=True);raise
for n in names:
    assert (ROOT/n).is_dir() and not (ROOT/n).is_symlink()
    assert not any(p==str(ROOT/n) or p.startswith(str(ROOT/n)+'/') for p in in_use()), n
# Archive comparison must finish successfully before removal of exact validated paths.
for n in names: shutil.rmtree(ROOT/n)
data=json.loads(manifest.read_text());data.update(verified=True,unpackedCopiesRemoved=True,archiveBytes=archive.stat().st_size,freeBytesAfter=shutil.disk_usage(ROOT).free)
manifest.write_text(json.dumps(data,indent=2))
print(json.dumps(data))
