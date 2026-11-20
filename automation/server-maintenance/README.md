# November 2026 server maintenance

These are operator-run, reviewed one-time scripts with fixed scopes. They are
not periodic cleanup jobs. Do not rerun against another release cohort without
reviewing active process paths, release links, Nginx references and disk reserve.

- `archive-old-root-releases.py`: packs the first ten September root releases,
  compares the archive with the originals, checks that they are inactive again,
  then removes their unpacked copies. Current and recent releases are excluded.
  Long-window Zstandard deduplicates repeated assets. Packing aborts below a
  2 GiB reserve without deleting originals.
- `compact-release-archive.py`: migration for the initially created conventional
  archive. It compares SHA-256 of both complete decompressed tar streams before
  deleting the larger archive. The final verified archive is
  `/var/backups/residence-release-archives/20261120/inactive-root-releases-september-first10-long.tar.zst`.
  Its manifest records every old release, SHA-256 and verification status.
- `configure-dns-and-timings.py`: exact-file backups, validated Nginx reload,
  additional timing log with no query strings or credentials, seven-file log
  rotation and DNS-only networkd drop-in. Runtime DNS uses `resolvectl`; the
  network interface is not restarted. Existing combined security logs remain.
- `stop-unused-previews.py`: stops only five reviewed orphan session processes
  after validating their cwd, lack of Nginx references and no established
  clients. Private restart metadata is under
  `/root/tencorp-maintenance-backups/unused-previews-20261120`.

Nginx rollback restores the numbered files listed by `paths.json` under the
reported `/root/tencorp-maintenance-backups/<timestamp>` directory, removes files
absent from that backup, validates with `nginx -t` and reloads. DNS rollback
restores the networkd drop-in and the servers recorded in `previous-dns.txt`
using `resolvectl dns eth0 ...`. No interface reboot is needed.

To restore an old archived release, first verify the manifest's tar SHA-256
with `zstd --long=31 -dc ... | sha256sum`, then extract only the reviewed old
release directory into `root-releases` with root ownership. Never extract over
an active/new release. This archive does not replace the retained current and
previous unpacked releases or database backups.
