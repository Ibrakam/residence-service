import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createLogger } from "../src/logger.mjs";
import { GitWorkspace } from "../src/git-worktree.mjs";
import { processLease, runWorker } from "../src/pipeline.mjs";
import { StateStore } from "../src/state-store.mjs";
import { DEFAULT_DENIED_PATH_PATTERNS } from "../src/config.mjs";
import { cleanupSealedArtifact, sealBuildArtifact } from "../src/artifact-seal.mjs";
import { runVerification } from "../src/verification.mjs";

function git(cwd, ...args) {
  return execFileSync("/usr/bin/git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } }).trim();
}

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-runner-test-"));
  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const repo = path.join(root, "repo");
  await fs.mkdir(seed);
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(seed, "init", "--initial-branch=main");
  await fs.mkdir(path.join(seed, "website"));
  await fs.writeFile(path.join(seed, "website", "existing.txt"), "base\n");
  await fs.writeFile(path.join(seed, ".gitignore"), "website/dist/\n");
  git(seed, "add", ".");
  git(seed, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "origin", "HEAD:main");
  git(root, "clone", remote, repo);

  const fakeCodex = path.join(root, "fake-codex.mjs");
  await fs.writeFile(fakeCodex, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const cwd = args[args.indexOf("-C") + 1];
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
if (!prompt.includes("untrusted_ticket_report")) process.exit(9);
fs.writeFileSync(path.join(cwd, "website", "synthetic-fix.txt"), "fixed by synthetic codex\\n");
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "synthetic-thread-1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Added the isolated synthetic fix." } }) + "\\n");
`);
  await fs.chmod(fakeCodex, 0o700);
  const codexHome = path.join(root, "codex-home");
  await fs.mkdir(codexHome);
  await fs.writeFile(path.join(codexHome, "auth.json"), "{}", { mode: 0o600 });
  return { root, remote, repo, fakeCodex, codexHome };
}

async function deployScriptPin(filename) {
  const stat = await fs.lstat(filename);
  const realPath = await fs.realpath(filename);
  return {
    realPath,
    sha256: crypto.createHash("sha256").update(await fs.readFile(realPath)).digest("hex"),
    uid: stat.uid,
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
  };
}

async function setFakeCodexAction(fixture, actionCode) {
  await fs.writeFile(fixture.fakeCodex, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const cwd = args[args.indexOf("-C") + 1];
for await (const _chunk of process.stdin) {}
${actionCode}
process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "malicious-thread" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }) + "\\n");
`, { mode: 0o700 });
}

async function runRejectedAgentFixture(t, actionCode, ticketId, configOverrides = {}) {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  await setFakeCodexAction(fixture, actionCode);
  const stateDir = path.join(fixture.root, "state");
  const markerName = "verification-ran.txt";
  const config = {
    repoRoot: fixture.repo,
    worktreeRoot: path.join(fixture.root, "worktrees"),
    stateDir,
    codexBin: fixture.fakeCodex,
    codexHome: fixture.codexHome,
    codexModel: "",
    codexTimeoutMs: 10_000,
    commandTimeoutMs: 10_000,
    heartbeatIntervalMs: 1_000,
    maxHeartbeatFailures: 3,
    attachmentMaxCount: 0,
    attachmentMaxBytes: 1024,
    attachmentAllowedHosts: [],
    serverTimeoutMs: 5_000,
    allowedPrefixes: ["website"],
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    verifyCommands: [{
      name: "must-not-run",
      cwd: ".",
      argv: [process.execPath, "-e", `require("fs").writeFileSync("website/${markerName}", "ran")`],
      timeoutMs: 5_000,
    }],
    verificationEnvironment: {},
    gitAuthorName: "Ticket Test",
    gitAuthorEmail: "ticket-test@example.test",
    dryRun: true,
    keepSuccessfulWorktrees: true,
    keepFailedWorktrees: true,
    ...configOverrides,
  };
  const logger = createLogger({ runnerId: "test-runner", stream: { write() {} } });
  const stateStore = new StateStore(stateDir);
  await stateStore.initialize();
  const gitWorkspace = new GitWorkspace(config, logger);
  await gitWorkspace.initialize();
  const calls = [];
  const client = {
    heartbeat: async () => ({ ok: true }),
    progress: async () => {},
    complete: async (_id, _token, result) => calls.push(["complete", result]),
    fail: async (_id, _token, result) => calls.push(["fail", result]),
    attachmentHeaders: () => ({}),
  };
  const result = await processLease({
    lease: {
      leaseToken: "lease-test",
      ticket: { id: ticketId, attempt: 1, title: "Untrusted mutation", body: "test", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
  });
  const marker = path.join(gitWorkspace.worktreePath(ticketId, 1), "website", markerName);
  assert.equal(result.outcome, "failed");
  assert.equal(calls.some(([kind]) => kind === "complete"), false);
  await assert.rejects(fs.access(marker));
  return result;
}

test("one synthetic ticket runs Codex, verifies, commits, and never pushes in dry-run", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const stateDir = path.join(fixture.root, "state");
  const config = {
    repoRoot: fixture.repo,
    worktreeRoot: path.join(fixture.root, "worktrees"),
    stateDir,
    codexBin: fixture.fakeCodex,
    codexHome: fixture.codexHome,
    codexModel: "",
    codexTimeoutMs: 10_000,
    commandTimeoutMs: 10_000,
    heartbeatIntervalMs: 1_000,
    maxHeartbeatFailures: 3,
    attachmentMaxCount: 2,
    attachmentMaxBytes: 1024 * 1024,
    attachmentAllowedHosts: [],
    serverTimeoutMs: 5_000,
    allowedPrefixes: ["website"],
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    verifyCommands: [{ name: "node-smoke", cwd: ".", argv: [process.execPath, "-e", "process.exit(0)"], timeoutMs: 5_000 }],
    verificationEnvironment: {},
    gitAuthorName: "Ticket Test",
    gitAuthorEmail: "ticket-test@example.test",
    dryRun: true,
    keepSuccessfulWorktrees: false,
    keepFailedWorktrees: true,
  };
  let capturedLogs = "";
  const sink = { write(chunk) { capturedLogs += chunk; } };
  const logger = createLogger({ runnerId: "test-runner", stream: sink });
  const stateStore = new StateStore(stateDir);
  await stateStore.initialize();
  const gitWorkspace = new GitWorkspace(config, logger);
  await gitWorkspace.initialize();
  gitWorkspace.removeWorktree = async () => { throw new Error("synthetic successful cleanup failure"); };
  const calls = [];
  const client = {
    heartbeat: async () => ({ ok: true }),
    progress: async (_id, _token, phase) => calls.push(["progress", phase]),
    complete: async (_id, _token, result) => calls.push(["complete", result]),
    fail: async (_id, _token, result) => calls.push(["fail", result]),
    attachmentHeaders: () => ({}),
  };
  const lease = {
    leaseToken: "lease-test",
    ticket: { id: "TNC-TEST-1", attempt: 1, title: "Synthetic", body: "Create the synthetic test fix", attachments: [] },
  };
  const result = await processLease({
    lease,
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
  });
  assert.equal(result.outcome, "dry_run", `${JSON.stringify(calls)}\n${capturedLogs}`);
  assert.equal(result.threadId, "synthetic-thread-1");
  assert.deepEqual(result.changedPaths, ["website/synthetic-fix.txt"]);
  assert.equal(calls.some(([kind]) => kind === "fail"), false);
  assert.equal(calls.some(([kind]) => kind === "complete"), true);
  assert.equal(git(fixture.repo, "rev-parse", "refs/remotes/origin/main"), git(fixture.remote, "rev-parse", "refs/heads/main"));
  assert.notEqual(result.commitSha, git(fixture.remote, "rev-parse", "refs/heads/main"));
  const state = await stateStore.readTicket("TNC-TEST-1", 1);
  assert.equal(state.phase, "dry_run_complete");
  assert.equal(git(state.worktreePath, "rev-parse", "HEAD^{commit}"), result.commitSha);
  assert.equal(git(state.worktreePath, "write-tree"), git(state.worktreePath, "rev-parse", `${result.commitSha}^{tree}`));
  assert.equal(git(state.worktreePath, "status", "--porcelain", "--untracked-files=no"), "");
});

test("an unfinished publication from a prior attempt blocks every new lease", async () => {
  let leaseCalled = false;
  const logger = createLogger({ runnerId: "test-runner", stream: { write() {} } });
  await assert.rejects(runWorker({
    config: { dryRun: false, once: true },
    client: { lease: async () => { leaseCalled = true; return null; } },
    stateStore: {
      listTicketStates: async () => [{
        ticketId: "TNC-OLD",
        attempt: 1,
        phase: "pushed",
        baseSha: "a".repeat(40),
        commitSha: "b".repeat(40),
        worktreePath: "",
      }],
    },
    gitWorkspace: { resolveOriginMain: async () => "b".repeat(40) },
    logger,
    shutdownSignal: new AbortController().signal,
  }), /Unresolved publication checkpoint blocks new leases/);
  assert.equal(leaseCalled, false);
});

test("a deployment failure rolls main back with a commit lease", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const stateDir = path.join(fixture.root, "state");
  const deployScript = path.join(fixture.root, "trusted-deploy-failure.sh");
  await fs.writeFile(deployScript, `#!/bin/sh
if [ "\${TICKET_RUNNER_TICKET_ID:-}" = "TNC-PUSH-UNKNOWN" ]; then
  exit 75
fi
echo DEPLOYMENT_NOT_DEPLOYED >&2
exit 3
`, { mode: 0o700 });
  const baseSha = git(fixture.remote, "rev-parse", "refs/heads/main");
  const config = {
    repoRoot: fixture.repo,
    worktreeRoot: path.join(fixture.root, "worktrees"),
    stateDir,
    codexBin: fixture.fakeCodex,
    codexHome: fixture.codexHome,
    codexModel: "",
    codexTimeoutMs: 10_000,
    commandTimeoutMs: 10_000,
    heartbeatIntervalMs: 1_000,
    maxHeartbeatFailures: 3,
    attachmentMaxCount: 2,
    attachmentMaxBytes: 1024 * 1024,
    attachmentAllowedHosts: [],
    serverTimeoutMs: 5_000,
    allowedPrefixes: ["website"],
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    verifyCommands: [{
      name: "node-smoke",
      cwd: ".",
      argv: [process.execPath, "-e", `const fs=require("fs"),p=require("path");const r="website/dist/standalone";fs.mkdirSync(p.join(r,"dist/client"),{recursive:true});for(const [f,v] of [["server.js","ok"],["package.json","{}"],["STANDALONE_RUNTIME.json",'{"schemaVersion":2,"packages":[]}']])fs.writeFileSync(p.join(r,f),v)`],
      timeoutMs: 5_000,
    }],
    verificationEnvironment: {},
    gitAuthorName: "Ticket Test",
    gitAuthorEmail: "ticket-test@example.test",
    dryRun: false,
    expectedOrigin: fixture.remote,
    deployScript,
    requiredDeployOwnerUid: typeof process.getuid === "function" ? process.getuid() : 0,
    requiredDeployMode: 0o700,
    deployScriptPin: await deployScriptPin(deployScript),
    deployArgs: [],
    deployEnvironment: {},
    deployTimeoutMs: 5_000,
    smokeUrls: [],
    smokeTimeoutMs: 5_000,
    keepSuccessfulWorktrees: true,
    keepFailedWorktrees: true,
  };
  const logger = createLogger({ runnerId: "test-runner", stream: { write() {} } });
  const stateStore = new StateStore(stateDir);
  await stateStore.initialize();
  const gitWorkspace = new GitWorkspace(config, logger);
  await gitWorkspace.initialize();
  const calls = [];
  const client = {
    heartbeat: async () => ({ ok: true }),
    progress: async (_id, _token, phase) => calls.push(["progress", phase]),
    complete: async (_id, _token, result) => calls.push(["complete", result]),
    fail: async (_id, _token, result) => calls.push(["fail", result]),
    attachmentHeaders: () => ({}),
  };
  const productionVerifier = async ({ config: verifierConfig, worktreePath, treeSha, ticketId, signal, logger: verifierLogger }) => ({
    verification: await runVerification({
      config: verifierConfig,
      worktreePath,
      ticketId,
      signal,
      logger: verifierLogger,
    }),
    artifactSeal: await sealBuildArtifact({
      config: verifierConfig,
      worktreePath,
      ticketId,
      commitSha: treeSha,
    }),
  });
  const result = await processLease({
    lease: {
      leaseToken: "lease-test",
      ticket: { id: "TNC-PUSH-FAIL", attempt: 1, title: "Synthetic", body: "Create the synthetic test fix", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
    productionVerifier,
  });

  assert.equal(result.outcome, "failed");
  assert.equal(result.pushed, true);
  assert.equal(result.deployed, false);
  assert.equal(result.pushRolledBack, true);
  assert.equal(result.rollbackError, null);
  const failureCall = calls.find(([kind]) => kind === "fail");
  assert.equal(failureCall?.[1].pushed, true);
  assert.equal(failureCall?.[1].deployed, false);
  assert.equal(failureCall?.[1].pushRolledBack, true);
  assert.equal(calls.some(([kind]) => kind === "complete"), false);
  assert.equal(git(fixture.remote, "rev-parse", "refs/heads/main"), baseSha);
  const state = await stateStore.readTicket("TNC-PUSH-FAIL", 1);
  assert.equal(state.phase, "failed");
  assert.equal(state.pushed, true);
  assert.equal(state.deployed, false);
  assert.equal(state.pushRolledBack, true);

  const originalWriteTicket = stateStore.writeTicket.bind(stateStore);
  stateStore.writeTicket = async (ticketId, attempt, nextState) => {
    if (ticketId === "TNC-POST-PUSH-CHECKPOINT" && nextState.phase === "pushed") {
      const error = new Error("synthetic ENOSPC immediately after push");
      error.code = "ENOSPC";
      throw error;
    }
    return originalWriteTicket(ticketId, attempt, nextState);
  };
  const callsBeforePostPushCheckpoint = calls.length;
  const postPushCheckpointFailure = await processLease({
    lease: {
      leaseToken: "lease-test-post-push-checkpoint",
      ticket: { id: "TNC-POST-PUSH-CHECKPOINT", attempt: 1, title: "Synthetic", body: "Create the synthetic test fix", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
    productionVerifier,
  });
  stateStore.writeTicket = originalWriteTicket;
  assert.equal(postPushCheckpointFailure.outcome, "failed");
  assert.equal(postPushCheckpointFailure.pushed, true);
  assert.equal(postPushCheckpointFailure.deployed, false);
  assert.equal(postPushCheckpointFailure.pushRolledBack, true);
  assert.equal(postPushCheckpointFailure.haltWorker, false);
  assert.equal(calls.slice(callsBeforePostPushCheckpoint).some(([kind]) => kind === "fail"), true);
  assert.equal(git(fixture.remote, "rev-parse", "refs/heads/main"), baseSha);
  const postPushCheckpointState = await stateStore.readTicket("TNC-POST-PUSH-CHECKPOINT", 1);
  assert.equal(postPushCheckpointState.phase, "failed");
  assert.equal(postPushCheckpointState.pushRolledBack, true);

  stateStore.writeTicket = async (ticketId, attempt, nextState) => {
    if (ticketId === "TNC-CHECKPOINT-FAIL" && nextState.phase === "failed") {
      const error = new Error("synthetic ENOSPC while persisting terminal checkpoint");
      error.code = "ENOSPC";
      throw error;
    }
    return originalWriteTicket(ticketId, attempt, nextState);
  };
  const callsBeforeCheckpointFailure = calls.length;
  const checkpointFailure = await processLease({
    lease: {
      leaseToken: "lease-test-checkpoint-failure",
      ticket: { id: "TNC-CHECKPOINT-FAIL", attempt: 1, title: "Synthetic", body: "Create the synthetic test fix", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
    productionVerifier,
  });
  stateStore.writeTicket = originalWriteTicket;
  assert.equal(checkpointFailure.pushRolledBack, true);
  assert.equal(checkpointFailure.haltWorker, true);
  assert.equal(checkpointFailure.checkpointError.code, "ENOSPC");
  assert.equal(calls.slice(callsBeforeCheckpointFailure).some(([kind]) => kind === "fail"), false);
  assert.equal(git(fixture.remote, "rev-parse", "refs/heads/main"), baseSha);
  const checkpointFailureState = await stateStore.readTicket("TNC-CHECKPOINT-FAIL", 1);
  assert.equal(checkpointFailureState.phase, "deploying");
  await cleanupSealedArtifact(checkpointFailureState.artifactSeal);

  const callsBeforeUnknown = calls.length;
  const unknown = await processLease({
    lease: {
      leaseToken: "lease-test-unknown",
      ticket: { id: "TNC-PUSH-UNKNOWN", attempt: 1, title: "Synthetic", body: "Create the synthetic test fix", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
    productionVerifier,
  });
  assert.equal(unknown.outcome, "failed");
  assert.equal(unknown.pushed, true);
  assert.equal(unknown.deployed, false);
  assert.equal(unknown.pushRolledBack, false);
  assert.equal(unknown.haltWorker, true);
  assert.equal(git(fixture.remote, "rev-parse", "refs/heads/main"), unknown.commitSha);
  const unknownCalls = calls.slice(callsBeforeUnknown);
  assert.equal(unknownCalls.some(([kind]) => kind === "fail"), false);
  const unknownState = await stateStore.readTicket("TNC-PUSH-UNKNOWN", 1);
  assert.equal(unknownState.phase, "publish_reconciliation_required");
  assert.equal(unknownState.reconciliation.required, true);
  await cleanupSealedArtifact(unknownState.artifactSeal);

  await setFakeCodexAction(fixture, 'fs.writeFileSync(path.join(cwd, "website", "rollback-failure.txt"), "new change\\n");');
  gitWorkspace.rollbackPush = async () => { throw new Error("synthetic rollback transport failure"); };
  const callsBeforeRollbackFailure = calls.length;
  const rollbackFailure = await processLease({
    lease: {
      leaseToken: "lease-test-rollback-failure",
      ticket: { id: "TNC-ROLLBACK-FAIL", attempt: 1, title: "Synthetic", body: "Create another synthetic fix", attachments: [] },
    },
    config,
    client,
    stateStore,
    gitWorkspace,
    logger,
    shutdownSignal: new AbortController().signal,
    productionVerifier,
  });
  assert.equal(rollbackFailure.haltWorker, true);
  assert.equal(rollbackFailure.pushRolledBack, false);
  assert.equal(rollbackFailure.rollbackError.message, "synthetic rollback transport failure");
  assert.equal(calls.slice(callsBeforeRollbackFailure).some(([kind]) => kind === "fail"), false);
  const rollbackFailureState = await stateStore.readTicket("TNC-ROLLBACK-FAIL", 1);
  assert.equal(rollbackFailureState.phase, "publish_reconciliation_required");
  await cleanupSealedArtifact(rollbackFailureState.artifactSeal);
});

test("package manifest mutation is rejected before any verification command", async (t) => {
  const result = await runRejectedAgentFixture(
    t,
    'fs.writeFileSync(path.join(cwd, "website", "package.json"), "{\\"scripts\\":{\\"build\\":\\"cat ~/.ssh/id_ed25519\\"}}\\n");',
    "TNC-MAL-PACKAGE",
  );
  assert.match(result.error.message, /denied by policy/);
});

test("automatic tickets cannot alter lead/API handlers", async (t) => {
  const result = await runRejectedAgentFixture(
    t,
    'const target = path.join(cwd, "website", "app", "api", "probe"); fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "route.ts"), `export const GET = () => new Response("ok");\\n`);',
    "TNC-MAL-API",
  );
  assert.match(result.error.message, /denied by policy/);
});

test("automatic tickets cannot alter the global request proxy", async (t) => {
  const result = await runRejectedAgentFixture(
    t,
    'fs.writeFileSync(path.join(cwd, "website", "proxy.ts"), `export function proxy() { return null; }\\n`);',
    "TNC-MAL-PROXY",
  );
  assert.match(result.error.message, /denied by policy/);
});

test("preflight enforces changed-file, line, and blob limits", async (t) => {
  const tooMany = await runRejectedAgentFixture(
    t,
    'for (const name of ["one.txt", "two.txt", "three.txt"]) fs.writeFileSync(path.join(cwd, "website", name), "x\\n");',
    "TNC-LIMIT-FILES",
    { maxChangedFiles: 2 },
  );
  assert.match(tooMany.error.message, /maximum is 2/);

  const tooManyLines = await runRejectedAgentFixture(
    t,
    'fs.writeFileSync(path.join(cwd, "website", "lines.txt"), "1\\n2\\n3\\n4\\n5\\n6\\n");',
    "TNC-LIMIT-LINES",
    { maxChangedLines: 5 },
  );
  assert.match(tooManyLines.error.message, /maximum is 5/);

  const tooLarge = await runRejectedAgentFixture(
    t,
    'fs.writeFileSync(path.join(cwd, "website", "blob.bin"), Buffer.alloc(17, 1));',
    "TNC-LIMIT-BLOB",
    { maxChangedBlobBytes: 16 },
  );
  assert.match(tooLarge.error.message, /16-byte limit/);
});

test("new executable script is rejected before any verification command", async (t) => {
  const result = await runRejectedAgentFixture(
    t,
    'const target = path.join(cwd, "website", "pwn.sh"); fs.writeFileSync(target, "#!/bin/sh\\nexit 0\\n"); fs.chmodSync(target, 0o755);',
    "TNC-MAL-EXEC",
  );
  assert.match(result.error.message, /executable files are denied/);
});

test("tampered linked-worktree git pointer is rejected before trusted git or verification", async (t) => {
  const result = await runRejectedAgentFixture(
    t,
    'const fake = path.join(cwd, "fake-git"); fs.mkdirSync(fake); fs.writeFileSync(path.join(cwd, ".git"), `gitdir: ${fake}\\n`);',
    "TNC-MAL-GITDIR",
  );
  assert.match(result.error.message, /\.git pointer|metadata identity/);
});

test("rollback lease never overwrites a concurrent main update", async (t) => {
  const fixture = await createFixture();
  t.after(() => fs.rm(fixture.root, { recursive: true, force: true }));
  const config = {
    repoRoot: fixture.repo,
    worktreeRoot: path.join(fixture.root, "worktrees"),
    commandTimeoutMs: 10_000,
    allowedPrefixes: ["website"],
    deniedPathPatterns: DEFAULT_DENIED_PATH_PATTERNS,
    gitAuthorName: "Ticket Test",
    gitAuthorEmail: "ticket-test@example.test",
  };
  const gitWorkspace = new GitWorkspace(config, createLogger({ runnerId: "test", stream: { write() {} } }));
  await gitWorkspace.initialize();
  const ticket = { id: "TNC-ROLLBACK-RACE", attempt: 1 };
  const prepared = await gitWorkspace.prepareWorktree(ticket, null, new AbortController().signal);
  await fs.writeFile(path.join(prepared.worktreePath, "website", "race.txt"), "ticket\n");
  const preflight = await gitWorkspace.preflight({ ...prepared, signal: new AbortController().signal });
  const committed = await gitWorkspace.inspectAndCommit({
    ticket,
    ...prepared,
    expectedTreeSha: preflight.treeSha,
    signal: new AbortController().signal,
  });
  await gitWorkspace.safePush({ ...prepared, commitSha: committed.commitSha, signal: new AbortController().signal });

  const concurrent = path.join(fixture.root, "concurrent");
  git(fixture.root, "clone", fixture.remote, concurrent);
  await fs.writeFile(path.join(concurrent, "website", "concurrent.txt"), "newer\n");
  git(concurrent, "add", ".");
  git(concurrent, "-c", "user.name=Concurrent", "-c", "user.email=concurrent@example.test", "commit", "-m", "concurrent");
  git(concurrent, "push", "origin", "HEAD:main");
  const concurrentSha = git(fixture.remote, "rev-parse", "refs/heads/main");

  await assert.rejects(
    gitWorkspace.rollbackPush({ ...prepared, commitSha: committed.commitSha, signal: new AbortController().signal }),
    /moved after this ticket push/,
  );
  assert.equal(git(fixture.remote, "rev-parse", "refs/heads/main"), concurrentSha);
});
