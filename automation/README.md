# Avalon ticket runner

This directory contains the trusted macOS worker that turns one leased Telegram ticket at a time into an isolated Codex task and sends the result back to Telegram. It uses only Node.js 22 built-ins and the local Codex CLI; there is no Codex SDK dependency.

The safe default is review-only: `RUNNER_DRY_RUN` defaults to `true`, so a missing or stale setting cannot publish. Production is available only through the explicit multi-part opt-in documented below. Review worktrees may be retained for inspection; successful production worktrees must be removed.

The Codex agent is allowed to diagnose and edit a disposable worktree. It is never allowed to deploy, push, commit, read secrets, or change release configuration. The runner owns every privileged transition:

1. Lease one ticket and keep the lease alive.
2. Fetch `origin/main` and create a detached root-repository worktree.
3. Download bounded, allowlisted attachments into a temporary worktree directory. Images are also passed with repeated Codex `-i` flags.
4. Send the ticket to non-ephemeral `codex exec --json` over stdin, capture `thread.started.thread_id`, and persist it for resume.
5. Delete ticket inputs, freeze and scan a staged tree, reject forbidden paths/secrets/history or linked-worktree metadata changes, then remove ignored agent artifacts.
6. In review mode, run fixed verification commands under macOS Seatbelt. `npm ci --include=dev` uses an empty HOME and cannot execute lifecycle scripts; lint/build have no network access.
7. In production mode, export the exact staged Git tree into the reviewed pinned native-Linux Docker image through a labeled runner-owned volume, install dev dependencies without lifecycle scripts, disconnect the container network, run lint/build, confirm the complete PID namespace stopped, export through a separate networkless read-only container, reject native runtime content, and seal the standalone artifact outside the worktree.
8. Create one hook-free commit with `git commit-tree`. Review mode leaves it local. Production uses a commit lease to push that direct child to `origin/main`, invokes the fixed trusted wrapper with the sealed artifact, and then runs public smoke checks.
9. Report the redacted result to the worker API, which replies in Telegram, then take the next ticket.

## Security boundaries

- Ticket text and attachments are explicitly delimited as untrusted data. The prompt is written to Codex stdin, never interpolated into a shell or exposed in process arguments/logs.
- Structured logs contain ticket ids, phases, timings, hashes, and safe errors, but never the ticket body, attachment URL, lease/API token, or command output.
- The Codex child receives a minimal environment and a temporary runtime containing only a short-lived copy of its login. A single deny-by-default Seatbelt profile limits writes to the isolated worktree/runtime and explicitly denies SSH/cloud credentials, the original Codex configuration/history, runner token/env files, Docker sockets, Keychains, and browser profiles while leaving only the Codex API network path available.
- Changed paths default to `website/`. `automation/`, `.github/`, `.git*` control files, `website/app/api/**`, `website/app/v1/**`, `website/proxy.*`, package manifests/locks, `.npmrc`, executable/symlink files, scripts, env/credential/key files, configuration, and deploy/release paths are rejected. Production fixes are capped at 25 files, 3,000 added/deleted lines, and 16 MiB per changed blob. Production requires the exact `website` prefix; it cannot be widened by runner configuration.
- Review verification commands are operator configuration, never ticket or agent output. They get no secret-like environment variables. Production uses the fixed container sequence instead. Preflight runs before verification and the staged tree must remain byte-identical through commit.
- Review verification is macOS-only and fail-closed on `/usr/bin/sandbox-exec`. Production verification is a fixed, resource-limited native-Linux Docker build from the exact staged Git tree (`linux/arm64` on Apple silicon, `linux/amd64` on Intel Mac). The OCI index, host-specific child manifest/image ID, and Docker CLI identity/SHA-256 are pinned and rechecked. Image/index resolution and `npm ci --include=dev` are the only verification network uses; lint/build deny network. The LaunchAgent deliberately does not set a global `NODE_ENV`.
- The deploy script is invoked directly without a shell from the fixed `$RUNNER_STATE_DIR/bin/deploy-residence-root-remote` path. That state directory is outside the agent sandbox; the wrapper must be owned by the runner user, be a non-symlink with mode `0700`, and its device, inode, mode, and SHA-256 are pinned at startup and checked immediately before execution. No configurable arguments or inherited deployment environment are allowed.
- Attachments require HTTPS, an exact hostname allowlist, supported MIME types, count/byte limits, and (when supplied) a SHA-256 match. Lease credentials are only sent back to the worker API origin.
- A local process lock and the server lease enforce one active ticket at a time.

The Telegram bot token previously pasted into chat must be rotated before production. Do not place the replacement token in this directory; it belongs to the server-side ticket bot configuration.

## Prerequisites

- macOS user session with Node 22.
- `/Applications/ChatGPT.app/Contents/Resources/codex` (or another absolute `CODEX_BIN`) logged in and able to run `codex exec`.
- A clean root clone whose `origin` is exactly `https://github.com/Ibrakam/residence-service.git` for production.
- A worker API token in a separate `chmod 600` file.
- Review mode needs no deployment access. Production requires the pinned GitHub CLI login and the separately installed fixed deploy wrapper.

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

### Production opt-in

Keep review mode enabled until the current ticket has finished and the trusted deployment assets have been installed. Production startup fails closed unless all of these conditions hold at the same time:

- `RUNNER_DRY_RUN=false`, `RUNNER_AUTO_DEPLOY_ENABLED=true`, and `RUNNER_AUTO_DEPLOY_CONFIRM=DEPLOY_FORM_TENCORP_UZ_MAIN` are present in the protected runner env file;
- `RUNNER_KEEP_SUCCESSFUL_WORKTREES=false` and `RUNNER_ALLOWED_PATHS=website` remain fixed;
- the worker API is exactly `https://form.tencorp.uz/__residence-ticket-worker/` and the Git origin is exactly the approved Residence repository;
- `/opt/homebrew/bin/gh` resolves to an executable pinned at startup, the GitHub CLI login is available, and only that fixed helper is enabled for trusted fetch/push commands;
- `$RUNNER_STATE_DIR/bin/deploy-residence-root-remote` is a runner-owned mode-`0700` non-symlink whose identity, mode, and SHA-256 stay pinned from startup through deployment;
- deploy arguments/environment are empty, the reviewed Docker index/host-specific child/image-ID mapping matches exactly, and every smoke URL is a clean HTTPS path on `form.tencorp.uz`.

Production verification does not use ticket-configurable commands. It always runs the fixed Linux `npm ci --include=dev --ignore-scripts`, lint, and build sequence, seals the artifact, pushes with `--force-with-lease`, deploys through the fixed wrapper, and smoke-checks production. Source rollback is allowed only when the wrapper authoritatively returns `DEPLOYMENT_NOT_DEPLOYED`; a timeout, signal, transport ambiguity, failed rollback, or unknown acknowledgement creates a durable `publish_reconciliation_required` checkpoint and stops the worker before another lease. The server deployer also requires artifact size plus 10 GiB free, checks every direct project landing and apartment catalog, and rolls the active release back if any candidate or post-switch smoke fails.

On this Apple-silicon runner, provision the reviewed child with `docker pull --platform linux/arm64 docker.io/library/node@sha256:8d342e46d3b2883df69f797cb60fc71d8a0b65de65ddfbf4bf63fdc02049615f`. The verifier checks that the pinned index maps arm64 to that child and that its image ID is `sha256:97aaa653fb55806b0d7acc6c93dd4f3f06b373a286c988bd68c0527d4310bb05`. Before sealing, it rejects native-library extensions, valid ELF/Mach-O/PE headers (including symlink targets), and packages outside the reviewed pure-JavaScript runtime closure. The production x64 candidate remains the final execution and all-route/asset validation of the exact sealed bytes.

## Tests and synthetic dry-run

The automated suite uses a temporary bare Git remote and a fake Codex executable. It proves the complete one-ticket path creates an isolated worktree, receives the prompt over stdin, captures a thread id, verifies and commits the change, and leaves remote `main` untouched:

```sh
cd automation
npm test
npm run test:docker
npm run test:docker:website
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
- A trusted deploy-script failure after push triggers a lease-protected source rollback only after the wrapper proves the commit is not deployed. If another writer moved `main`, rollback stops without overwriting it. Any indeterminate push/deploy/rollback or post-deploy reporting state is preserved and blocks all later tickets.
- To reconcile a blocked checkpoint, stop the LaunchAgent, inspect the exact private ticket-state JSON, compare `git ls-remote origin refs/heads/main`, and run `"$RUNNER_STATE_DIR/bin/deploy-residence-root-remote" --status <full-commit-sha>`. A `committing` state may lack `commitSha`; first audit `git -C <exact-worktree-from-state> rev-parse HEAD` and its tree. Do not delete or edit the checkpoint while either result is unknown or inconsistent. After source, production, and Telegram are operator-confirmed consistent, create a private mode-`0700` `tickets/reconciled/` archive and move only that exact state file; run `--config-check` before restarting launchd.
- Failed worktrees intentionally remain for diagnosis. Keep a bounded operator policy (at most three or a fixed disk quota): list exact paths with `git worktree list`, archive required evidence, and remove only individually reviewed terminal worktrees with `git worktree remove --force <exact-path>`. Never remove a worktree or sealed artifact referenced by an unresolved publication checkpoint.
- Codex rollout history on this Mac already occupies several gigabytes. Monitor `~/.codex` and free disk space as part of operations.

## Residual trust and hardening

The Codex process needs a short-lived copied login file and Codex API network access. The original `~/.codex`, personal SSH/cloud/browser data, Docker sockets, and runner secrets are denied by Seatbelt; the copied credential can still exist briefly in process memory. The production ideal remains a dedicated macOS account with a separately scoped Codex login and no personal files.

Install the reviewed wrapper into the private runner state directory as the runner user with mode `0700`. The runner refuses production mode if that exact ownership, path, or mode differs and rechecks the pinned identity and digest immediately before every deployment. The wrapper itself uses only a dedicated forced-command SSH key, never a general interactive server key.

`npm ci --include=dev` is the sole verification network exception because a fresh Git tree has no dependency tree. It cannot run lifecycle scripts and trusts only registry content selected by the frozen lockfile. Lint and build remain fully offline. Publishing remains unreachable unless every explicit production opt-in and fixed-identity check passes.
