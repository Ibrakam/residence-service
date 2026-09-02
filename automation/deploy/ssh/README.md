# Dedicated production deploy key

The ticket runner must use a one-purpose Ed25519 key. It must never use or
copy the existing personal `~/.ssh/id_ed25519` identity. The private key stays
on the runner Mac; only its public half is installed on the server.

## One-time operator setup

1. On the runner Mac, generate the fixed identity while logged in as the user
   that runs the ticket runner:

   ```bash
   umask 077
   ssh-keygen -t ed25519 -N '' \
     -C tencorp-ticket-deploy \
     -f /Users/ibragimkadamzanov/.ssh/tencorp_ticket_deploy_ed25519
   chmod 0600 /Users/ibragimkadamzanov/.ssh/tencorp_ticket_deploy_ed25519
   ```

   Compare `ssh-keygen -lf` output for the new `.pub` file and the existing
   `id_ed25519.pub`; the fingerprints must differ. The wrapper derives the
   dedicated public key and compares it to `id_ed25519.pub` at runtime; it
   never opens the personal `id_ed25519` private key.

2. Through a separate interactive administrator session, install
   `residence-ticket-deploy-gate.sh` as
   `/usr/local/sbin/residence-ticket-deploy-gate`, owned by `root:root` and
   mode `0755`. Keep `/usr/local/sbin/deploy-residence-root` root-owned,
   non-symlinked, and non-writable by group or others. Confirm that the fixed
   `/usr/bin/rsync` executable exists. The gate reconstructs one exact
   write-side rsync server command after validating the prepared worktree;
   it never evaluates the caller's command through a shell.

3. Replace the placeholder in
   `tencorp-ticket-deploy.authorized_keys.example` with the base64 field from
   the new public key. Append that one line to `/root/.ssh/authorized_keys`.
   Do not remove unrelated administrator keys and do not omit either
   `restrict` or `command=`.

4. Verify SSH daemon policy before enabling the runner. `PermitUserEnvironment`
   must be disabled, and `AcceptEnv` must not include `BASH_ENV`, `ENV`,
   `LD_PRELOAD`, `LD_LIBRARY_PATH`, or wildcard names that match them. The
   standard `LANG`/`LC_*` policy is acceptable because the gate immediately
   re-executes with a clean environment.

## Acceptance checks

Run the repository-level parser and policy checks first:

```bash
automation/deploy/test-forced-command-gate.sh
```

Then test the installed public key from the runner Mac. An arbitrary command,
an interactive login, port forwarding, agent forwarding, and read-side rsync
must all be denied. The only accepted protocol is:

- `prepare COMMIT WORKTREE`
- write-side rsync into the prepared
  `WORKTREE/website/dist/standalone/`
- `deploy WORKTREE COMMIT`
- `status COMMIT`
- `cleanup WORKTREE`

`COMMIT` is a lowercase full SHA from the fixed GitHub `origin/main`.
`WORKTREE` is a direct child of `/srv/residence-deploy/worktrees` whose strict
name embeds the first seven characters of that commit. The client treats a
deployment as successful only when `status COMMIT` finds matching immutable
content/completion markers and proves the service MainPID cwd is the same
active release. Exit status `75` plus `DEPLOYMENT_STATUS_UNKNOWN` means the caller must
not infer or roll back production state until a later status query succeeds.

For crash reconciliation, invoke the pinned local wrapper as
`deploy-residence-root-remote --status COMMIT`. It intentionally does not need
a worktree or artifact. Its machine contract is exact: status `0` with stdout
`deployed`, status `3` with stdout `not-deployed`, or status `75` with
`DEPLOYMENT_STATUS_UNKNOWN` on stderr. A missing, malformed, or untrustworthy
server marker or marker/service-cwd mismatch is unknown, never a confirmed
negative.
