#!/usr/bin/env python3
"""Long-window compression deduplicates repeated assets across archived releases."""
import pathlib,subprocess,hashlib,json,shutil
root=pathlib.Path('/var/backups/residence-release-archives/20261120')
old=root/'inactive-root-releases-september-first10.tar.zst'
new=root/'inactive-root-releases-september-first10-long.tar.zst'
manifest=root/'manifest.json'
data=json.loads(manifest.read_text())
assert data['verified'] and data['unpackedCopiesRemoved']
assert old.exists() and not new.exists() and shutil.disk_usage(root).free>8*1024**3
reader=subprocess.Popen(['nice','-n','15','zstd','-q','-dc',str(old)],stdout=subprocess.PIPE)
writer=subprocess.Popen(['nice','-n','15','zstd','-q','--long=31','-T1','-3','-o',str(new)],stdin=subprocess.PIPE)
h=hashlib.sha256()
try:
    while chunk:=reader.stdout.read(1024*1024):
        if shutil.disk_usage(root).free<2*1024**3:raise RuntimeError('Archive reserve exhausted')
        h.update(chunk);writer.stdin.write(chunk)
    writer.stdin.close()
    assert reader.wait()==0 and writer.wait()==0
    check=subprocess.Popen(['nice','-n','15','zstd','-q','--long=31','-dc',str(new)],stdout=subprocess.PIPE)
    actual=hashlib.sha256()
    while chunk:=check.stdout.read(1024*1024):actual.update(chunk)
    assert check.wait()==0 and h.digest()==actual.digest(), 'Archive byte comparison failed'
except Exception:
    reader.kill();writer.kill();new.unlink(missing_ok=True);raise
before=old.stat().st_size;after=new.stat().st_size
# The original archive is removed only after comparing the full decompressed bytes.
old.unlink()
data.update(archive=str(new),archiveBytes=after,originalArchiveBytes=before,tarSHA256=h.hexdigest(),longWindowVerified=True,freeBytesAfter=shutil.disk_usage(root).free)
manifest.write_text(json.dumps(data,indent=2))
print(json.dumps(data))
