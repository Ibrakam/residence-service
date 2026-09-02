# Avalon ticket runner

This directory contains the trusted macOS worker that turns one leased Telegram ticket at a time into an isolated Codex task and sends the result back to Telegram. It uses only Node.js 22 built-ins and the local Codex CLI; there is no Codex SDK dependency.

**Current operating mode is review-only.** `RUNNER_DRY_RUN=true` is mandatory and startup rejects `false`. The runner never pushes, deploys, or changes production. Successful worktrees are retained by the canonical example so an operator can review the local commit.

The Codex agent is allowed to diagnose and edit a disposable worktree. It is never allowed to deploy, push, commit, read secrets, or change release configuration. The runner owns every privileged transition:

1. Lease one ticket and keep the lease alive.
2. Fetch `origin/main` and create a detached root-repository worktree.
3. Download bounded, allowlisted attachments into a temporary worktree directory. Images are also passed with repeated Codex `-i` flags.
4. Send the ticket to non-ephemeral `codex exec --json` over stdin, capture `thread.started.thread_id`, and persist it for resume.
5. Delete ticket inputs, freeze and scan a staged tree, reject forbidden paths/secrets/history or linked-worktree metadata changes, then remove ignored agent artifacts.
6. Run fixed verification commands under macOS Seatbelt. `npm ci` uses an empty HOME and `--ignore-scripts --no-audit --no-fund`; lint/build have no network access.
7. Create one hook-free local review commit with `git commit-tree`; no remote ref is changed.
8. Report the redacted Codex summary and local review commit id to the worker API, which replies in Telegram, then take the next ticket.

## Security boundaries

- Ticket text and attachments are explicitly delimited as untrusted data. The prompt is written to Codex stdin, never interpolated into a shell or exposed in process arguments/logs.
- Structured logs contain ticket ids, phases, timings, hashes, and safe errors, but never the ticket body, attachment URL, lease/API token, or command output.
- The Codex child receives a minimal environment and a temporary runtime containing only a short-lived copy of its login. A single deny-by-default Seatbelt profile limits writes to the isolated worktree/runtime and explicitly denies SSH/cloud credentials, the original Codex configuration/history, runner token/env files, Docker sockets, Keychains, and browser profiles while leaving only the Codex API network path available.
- Changed paths default to `website/`. `automation/`, `.github/`, `.git*` control files, package manifests/locks, `.npmrc`, executable/symlink files, scripts, env/credential/key files, configuration, and deploy/release paths are rejected. `RUNNER_ALLOWED_PATHS` may narrow or deliberately expand the application allowlist, but it does not override the deny rules.
- Verification commands are operator configuration, never ticket or agent output. They get no secret-like environment variables. Preflight runs before every command and its staged tree must be byte-identical after verification.
- Verification is macOS-only and fail-closed on `/usr/bin/sandbox-exec`. Filesystem reads are limited to the worktree, a per-command temp HOME, and required system/Node/npm runtime paths; writes are limited to the worktree/temp. Only the fixed `npm ci` dependency-download phase has outbound network, while lint/build deny all network.
- The deploy script is invoked directly without a shell. It must be an absolute executable, non-symlink path outside the ticket worktree, owned by root or the runner user, and not group/world writable. Its device/inode/SHA-256 are pinned at startup and checked immediately before execution. Only explicitly allowlisted deploy environment variables are passed.
- Attachments require HTTPS, an exact hostname allowlist, supported MIME types, count/byte limits, and (when supplied) a SHA-256 match. Lease credentials are only sent back to the worker API origin.
- A local process lock and the server lease enforce one active ticket at a time.

The Telegram bot token previously pasted into chat must be rotated before production. Do not place the replacement token in this directory; it belongs to the server-side ticket bot configuration.

## Prerequisites

- macOS user session with Node 22.
- `/Applications/ChatGPT.app/Contents/Resources/codex` (or another absolute `CODEX_BIN`) logged in and able to run `codex exec`.
- A clean root clone whose `origin/main` is the production source branch.
- A worker API token in a separate `chmod 600` file.
- No deploy credentials are needed in the current review-only mode.

The installed `/opt/homebrew/bin/codex` on this Mac is currently broken. The example intentionally uses the native CLI bundled with ChatGPT Desktop. launchd has a minimal PATH, so all critical executable paths are absolute.

## Configure

Copy `.env.example` outside the repository, replace every placeholder, and protect both files:

```sh
mkdir -p "$HOME/Library/Application Support/AvalonTicketRunner"
cp automation/.env.example "$HOME/Library/Application Support/AvalonTicketRunner/runner.env"
chmod 600 "$HOME/Library/Application Support/AvalonTicketRunner/runner.env"
printf '%s\n' 'replace-with-worker-api-token' > "$HOME/Library/Application Support/AvalonTicketRunner/worker-api-token"
chmod 600 "$HOME/Library/Application Support/AvalonTicketRunner/worker-api-token"
```

The API base URL must retain its proxy prefix and end in `/`:

```text
https://form.tencorp.uz/__residence-ticket-worker/
```

The client appends `internal/ticket-runner/...` relative to that URL. Leading slashes are stripped so the protected prefix cannot be accidentally discarded.

Validate configuration without leasing a ticket:

```sh
RUNNER_ENV_FILE="$HOME/Library/Application Support/AvalonTicketRunner/runner.env" \
  /usr/local/bin/node automation/src/index.mjs --config-check
```

## Tests and synthetic dry-run

The automated suite uses a temporary bare Git remote and a fake Codex executable. It proves the complete one-ticket path creates an isolated worktree, receives the prompt over stdin, captures a thread id, verifies and commits the change, and leaves remote `main` untouched:

```sh
cd automation
npm test
```

To exercise the real local Codex login with a harmless synthetic ticket, use the checked-in fixture. This fetches `origin/main`, edits only an isolated worktree, creates a local disposable commit, and cannot push or deploy because test mode forces dry-run:

```sh
cd automation
node src/index.mjs --test-ticket examples/test-ticket.json --once
```

The result is written under `~/Library/Application Support/AvalonTicketRunner/test-results/`. Dry-run against the live queue is discouraged because the current server contract marks a reported dry-run as completed; use the local fixture instead.

## launchd

Render and inspect the LaunchAgent first:

```sh
RUNNER_ENV_FILE="$HOME/Library/Application Support/AvalonTicketRunner/runner.env" \
  automation/launchd/install-launch-agent.sh --dry-run
```

On this Mac the installer prefers `$HOME/.nvm/versions/node/v22.22.0/bin/node`; set the shell-only `RUNNER_NODE_BIN` override to another absolute Node 22 path if that installation moves. The selected executable's directory is inserted into the LaunchAgent `PATH` through the rendered `NODE_DIR` placeholder.

Install it only after the config check, tests, trusted deploy audit, and real-Codex dry-run pass:

```sh
RUNNER_ENV_FILE="$HOME/Library/Application Support/AvalonTicketRunner/runner.env" \
  automation/launchd/install-launch-agent.sh --install
```

Inspect it with:

```sh
launchctl print "gui/$(id -u)/com.tencorp.residence-ticket-runner"
tail -f "$HOME/Library/Logs/AvalonTicketRunner/stdout.log"
```

This is a per-user LaunchAgent. It starts at login, is restarted by launchd, and wraps the worker in `/usr/bin/caffeinate -s` to prevent system sleep while the worker is active and the Mac is on AC power. The installer also prepends the directory containing `RUNNER_NODE_BIN` to launchd's fixed `PATH`, so the configured Node 22/npm toolchain remains available to verification and Codex child processes. Battery sleep and uptime/power policy remain an owner decision.

## Recovery and operating notes

- Each ticket gets its own isolated Codex runtime. The runner stores the thread id as soon as `thread.started` arrives so an interrupted attempt can resume inside that runtime; these isolated tasks are not guaranteed to appear in the desktop app sidebar.
- Failed worktrees are retained by default for inspection. Successful worktrees are removed through `git worktree remove --force`; temporary ticket inputs are always deleted before staging.
- If `origin/main` changes after the worktree base is recorded, the push fails with `REMOTE_MAIN_MOVED`. Resolve or requeue the ticket; the runner never rebases an unreviewed agent change automatically.
- A trusted deploy-script failure after push is recorded and triggers a lease-protected source rollback. If another writer moved `main`, rollback stops without overwriting it. A failure after the deploy script reported success (including external smoke failure) is recorded but never source-rolled back automatically.
- Codex rollout history on this Mac already occupies several gigabytes. Monitor `~/.codex` and free disk space as part of operations.

## Residual trust and hardening

The Codex process needs a short-lived copied login file and Codex API network access. The original `~/.codex`, personal SSH/cloud/browser data, Docker sockets, and runner secrets are denied by Seatbelt; the copied credential can still exist briefly in process memory. The production ideal remains a dedicated macOS account with a separately scoped Codex login and no personal files.

The trusted deploy wrapper may be runner-user-owned because this Mac cannot install a root-owned file non-interactively. SHA-256/inode/permissions pinning closes mutation after startup, but root ownership remains stronger. Install the reviewed wrapper as root-owned mode `0755` when administrative access is available, then restart the runner so it records the new pin.

`npm ci` is the sole verification network exception because a fresh Git worktree has no dependency tree. It cannot run lifecycle scripts, sees an empty HOME/npm config, and cannot read outside the sandbox allowlist, but it still trusts the registry content selected by the frozen lockfile. Lint and build remain fully offline. The dormant publishing code is intentionally unreachable until a separate security review removes the configuration guard.
