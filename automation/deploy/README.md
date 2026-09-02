# Production deployment assets

These files define the production boundary for the direct-project Residence
frontend and the Telegram ticket service. They contain no credentials and are
not an instruction to grant the Telegram-facing process shell or root access.

## Layout and trust boundary

The intended server layout is:

```text
/var/www/residence-service/root-releases/<UTC timestamp>-<commit>/frontend
/var/www/residence-service/root-current -> root-releases/<active release>

/opt/tencorp-ticket-bot/releases/<UTC timestamp>-<commit>/
/opt/tencorp-ticket-bot/current -> releases/<active release>
/etc/tencorp-ticket-bot/bot.env
/var/lib/tencorp-ticket-bot/attachments/
```

Application releases are created by root. Runtime processes use dedicated
unprivileged users. The ticket bot only receives Telegram updates, persists the
queue, downloads attachments, and exposes the authenticated worker API. The
coding/deployment runner is a separate trusted process and must not run as the
Telegram bot user.

The production host has no Codex runtime. Keep the coding runner on its trusted
macOS host and let it call the HTTPS worker API. The reviewed macOS wrapper
stages the already-built artifact over SSH; only the narrowly scoped root-side
deployment command may switch a release.

## Install the Residence root deployer

1. Copy `deploy-residence-root.sh` to
   `/usr/local/sbin/deploy-residence-root` and install it as `root:root` mode
   `0750`.
2. Install `systemd/residence-root-frontend.service` as
   `/etc/systemd/system/residence-root-frontend.service`, review its diff
   against the live unit, run `systemd-analyze verify`, then reload systemd.
3. Keep `/etc/residence-frontend/root-frontend.env` root-controlled. Its
   production listener must remain `127.0.0.1:4320`.
4. Create a root-owned deployment checkout/worktree on the production host.
   It must not be writable by group or others. Build on a non-production host,
   then transfer only the completed `website/dist/standalone` tree into the
   matching detached worktree for the same commit. Do not build on production.

For automated runs, `deploy-residence-root-remote.sh` performs step 4 using the
fixed host, SSH identity, repository origin, and server paths. Install it outside
the agent-editable repository as
`/usr/local/libexec/tencorp/deploy-residence-root-remote`, owned by `root:admin`
and mode `0750`. The runner user must be an `admin` group member but must not
have write access to that installed file. The runner passes its worktree and
commit through
`TICKET_RUNNER_WORKTREE` and `TICKET_RUNNER_COMMIT_SHA`; an operator may instead
provide the same two values as positional arguments.

The wrapper independently validates local and remote `origin/main`, creates one
exact root-managed worktree below `/srv/residence-deploy/worktrees`, transfers
only `website/dist/standalone`, invokes the server-side gate, and removes that
exact worktree on exit. Its rsync uses the active frontend as `--link-dest` and
forces `residence-frontend` ownership on the remote artifact without recursively
changing ownership of hard-linked production files. Git worktree mutation and
deployment share `/run/lock/residence-root-remote-worktree.lock`, preventing a
fetch/remove race with the active deployment worktree.

The deployer deliberately requires:

- exactly two arguments: the server-side worktree and a full 40-character SHA;
- a clean tracked worktree whose `HEAD` equals that SHA;
- a fresh fetch proving `origin/main` equals that SHA;
- a complete standalone runtime manifest;
- a root-owned worktree with no group/world write permission;
- an existing, valid `root-current` release for automatic rollback;
- a free fixed candidate port, `127.0.0.1:4399`.

Example after the artifact has been transferred to the server-side worktree:

```bash
sudo /usr/local/sbin/deploy-residence-root \
  /srv/residence-deploy/worktrees/0123456789abcdef0123456789abcdef01234567 \
  0123456789abcdef0123456789abcdef01234567
```

The script uses a non-blocking `flock`, rsyncs to an `.incoming-*` directory
with `--link-dest` against the current frontend, checks ownership, and renames
the completed directory into place. It then:

1. starts the candidate as a hardened transient systemd service on port 4399;
2. runs local GET-only smoke checks against inferred routes plus the default
   `/4u/apartments` and `/sun` canaries;
3. stops the candidate;
4. atomically switches `root-current`;
5. restarts `residence-root-frontend` and verifies its actual process working
   directory is the new release;
6. repeats the smokes on port 4320 and through
   `https://form.tencorp.uz`.

Any failure after the symlink switch restores the exact previous symlink,
restarts the old release, and performs a local rollback smoke. Failed immutable
release directories are retained for diagnosis; incomplete `.incoming-*`
directories created by the current invocation are removed safely.

## Manual Residence rollback

Automatic rollback is the normal path. For a manual rollback:

1. Take `/run/lock/residence-root-deploy.lock` with `flock` so a bot deployment
   cannot race the operator.
2. Resolve and record the current absolute target with
   `readlink -f /var/www/residence-service/root-current`.
3. Select one exact directory directly below
   `/var/www/residence-service/root-releases`; verify that it contains
   `frontend/server.js`. Never use a glob or an unresolved environment variable.
4. Create a temporary symlink inside `/var/www/residence-service`, then replace
   `root-current` with `mv -Tf`. This keeps the switch atomic.
5. Restart `residence-root-frontend.service`.
6. Verify the service MainPID working directory points to the selected
   release, then check `http://127.0.0.1:4320/4u/apartments` with Host
   `form.tencorp.uz` and finally the public HTTPS URL.

Do not delete the failed or previous release until the incident is understood.
Database migrations are outside this frontend switch and must remain backward
compatible with both releases.

## Install the ticket bot

1. Create the service identity without a login shell:

   ```bash
   sudo useradd --system --user-group --home-dir /nonexistent \
     --shell /usr/sbin/nologin tencorp-ticket-bot
   ```

2. Create `/opt/tencorp-ticket-bot/releases`, install a release containing the
   `ticket-bot` binary and `migrations/`, and atomically point
   `/opt/tencorp-ticket-bot/current` at it. Release content stays root-owned and
   read-only to the service.
3. Copy `tencorp-ticket-bot.env.example` to
   `/etc/tencorp-ticket-bot/bot.env`, replace all placeholders, and set
   `root:root` mode `0600`. Rotate any Telegram token that has appeared in chat,
   logs, shell history, or source control. `bot.env` must contain its own
   `DATABASE_URL` for the dedicated `tencorp_ticket_bot` PostgreSQL role. The
   unit deliberately never loads `/etc/residence-service/backend.env`.
   `TELEGRAM_ALLOWED_USER_IDS` is mandatory and must contain the two exact,
   positive human Telegram user IDs separated by a comma. Do not use usernames,
   chat IDs, wildcards, duplicates, or a bot ID. Updates from any other user are
   persisted only for Telegram offset/dedupe and receive no bot response.
4. Provision the `tencorp_ticket_bot` role as `NOINHERIT`, `NOSUPERUSER`,
   `NOCREATEDB`, `NOCREATEROLE`, and `NOREPLICATION`. Apply all pending
   migrations through `0013` separately as the migration owner, then run
   `postgresql/tencorp-ticket-bot-grants.sql` as that owner. It grants only the
   ticket tables/sequences and `EXECUTE` on `ticket_cap_body(text,text)`, and
   aborts if the role can read or write `leads` or an optional `integrations`
   table. Runtime `TICKET_AUTO_MIGRATE` is forced off by the unit.

   Create the role without placing its password in shell history, then install
   and verify the grants:

   ```sql
   CREATE ROLE tencorp_ticket_bot LOGIN NOINHERIT NOSUPERUSER
     NOCREATEDB NOCREATEROLE NOREPLICATION;
   \password tencorp_ticket_bot
   GRANT CONNECT ON DATABASE residence_service TO tencorp_ticket_bot;
   \connect residence_service
   ```

   Then, from the trusted deployment checkout, run:

   ```bash
   psql -X -v ON_ERROR_STOP=1 "$DATABASE_ADMIN_URL" \
     -f automation/deploy/postgresql/tencorp-ticket-bot-grants.sql
   ```

   Run the grants verifier again after every schema migration. A future table
   named `integrations` is treated as forbidden just like `leads`; the script
   fails closed if either becomes reachable by the bot role.
5. Install `systemd/tencorp-ticket-bot.service`,
   `systemd/tencorp-ticket-attachment-cleanup.service`, and
   `systemd/tencorp-ticket-attachment-cleanup.timer`; run
   `systemd-analyze verify`, reload systemd, enable and start it. Confirm with
   `systemctl is-active`, `systemctl list-timers`, and `ss` that the bot listens
   only on `127.0.0.1:4330`. Run the cleanup service once with
   `cleanup-attachments --dry-run` before enabling its daily timer. It removes
   only terminal attachment files older than `TICKET_ATTACHMENT_RETENTION`,
   fails on symlinks/path escapes, and leaves ticket/message audit rows intact.
6. Include `nginx/tencorp-ticket-worker-api.conf` inside the existing TLS
   `server` block for `form.tencorp.uz`. Run `nginx -t` before an atomic config
   replacement and reload.

The public API base for the trusted runner is:

```text
https://form.tencorp.uz/__residence-ticket-worker/
```

The runner appends `internal/ticket-runner/...` to that base. Nginx strips only
the private public prefix and sends the resulting path to
`http://127.0.0.1:4330/`. Only GET/HEAD and POST are accepted. Request bodies are
capped at 128 KiB, access logging is disabled, and the `Authorization` and
`X-Ticket-Lease` headers are forwarded unchanged. The application remains
responsible for constant-time bearer/lease validation and must never include
either value in errors or logs.

The service uses Telegram long polling; no Telegram webhook or additional
public route is required.

## Install the trusted macOS runner

1. Copy `automation/.env.example` outside the repository, replace placeholders,
   and set mode `0600`. Store the bearer token in the separate file referenced
   by `RUNNER_API_TOKEN_FILE`, also mode `0600`; never put it in a plist.
2. Install the reviewed remote wrapper at the absolute path configured by
   `RUNNER_DEPLOY_SCRIPT`. Keep it outside the repository and do not make it
   writable by the agent.
3. Create the configured state directory and its `logs` and `worktrees`
   children with mode `0700`.
4. Render and validate the single reviewed LaunchAgent with
   `automation/launchd/install-launch-agent.sh --dry-run`; the renderer runs
   `plutil -lint` and never embeds credentials in the plist.
5. Install it with the same command's `--install` mode, then inspect
   `launchctl print gui/$(id -u)/com.tencorp.residence-ticket-runner`.

Before enabling continuous work, run the runner once with `--config-check`, then
with the provided synthetic `--test-ticket` in dry-run mode. To stop or roll
back the runner itself, use `launchctl bootout` for the exact plist, restore the
previous reviewed runner checkout/config, and bootstrap it again. This does not
alter queued tickets; their leases expire and become recoverable.

## Ticket-bot release and rollback

Build the Go binary off-server for Linux amd64, run its tests, and package the
binary and migrations into a new immutable release. Before switching `current`:

- verify its SHA-256 digest against the trusted build output;
- verify all required migrations are already applied;
- stop if another bot instance is polling the same Telegram token;
- preserve the currently resolved release path.

Switch `current` atomically and restart the unit. Validate all of the following:

- systemd MainPID runs from the new release;
- port 4330 is bound only to `127.0.0.1`;
- the authenticated internal health request succeeds;
- one synthetic dry-run ticket completes queue transitions without invoking a
  production deployment.

If validation fails, atomically restore the recorded previous `current` target
and restart the service. Do not roll back migration `0011`: it is additive and
the previous application must tolerate the new tables. Keep attachments and
queue state under `/var/lib/tencorp-ticket-bot`; neither code deployment nor
rollback may replace or delete that directory.

## Post-install security checks

Run these checks after any template change:

```bash
sudo systemd-analyze verify /etc/systemd/system/residence-root-frontend.service
sudo systemd-analyze verify /etc/systemd/system/tencorp-ticket-bot.service
sudo systemd-analyze verify /etc/systemd/system/tencorp-ticket-attachment-cleanup.service
sudo systemd-analyze verify /etc/systemd/system/tencorp-ticket-attachment-cleanup.timer
sudo nginx -t
sudo ss -lntp
sudo systemctl list-timers tencorp-ticket-attachment-cleanup.timer
```

Expected public listeners remain 22, 80, and 443. Ports 4320, 4330, and the
temporary candidate port 4399 must never bind to a non-loopback address.
