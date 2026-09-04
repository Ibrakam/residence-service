import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupSealedArtifact, sealExternalSourceArtifact, verifySealedArtifact } from "../src/artifact-seal.mjs";
import {
  MARKET_MAP_ARTIFACT_PATHS,
  MARKET_MAP_CHANGED_PATHS,
  MARKET_MAP_ORIGIN,
  MARKET_MAP_PUBLIC_URL,
  DEFAULT_MARKET_MAP_VERIFY_COMMANDS,
  loadConfig,
} from "../src/config.mjs";
import { processLease } from "../src/pipeline.mjs";
import { ProjectRuntimeRegistry, normalizeProjectKey } from "../src/project-profiles.mjs";
import { runMarketMapVerification } from "../src/market-map-verification.mjs";
import { normalizeLease } from "../src/server-client.mjs";
import { assertSafeChangedPaths } from "../src/sanitize.mjs";
import { runSmokeChecks } from "../src/verification.mjs";

test("ticket project keys are normalized without deriving routing from report text", () => {
  assert.equal(normalizeProjectKey(), "residence");
  assert.equal(normalizeProjectKey(" MARKET_map "), "market-map");
  assert.throws(() => normalizeProjectKey("../../market-map"), /invalid/);

  const lease = normalizeLease({
    leaseToken: "lease",
    ticket: { id: "TNC-PROJECT", projectKey: "MARKET_map", body: "mentions another project" },
  });
  assert.equal(lease.ticket.projectKey, "market-map");
  assert.equal(normalizeLease({ leaseToken: "lease", ticket: { id: "TNC-LEGACY", body: "market-map" } }).ticket.projectKey, "residence");
});

test("market-map config is opt-in and keeps a fixed repository, route, and file scope", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-profile-config-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ticketFile = path.join(root, "ticket.json");
  await fs.writeFile(ticketFile, JSON.stringify({ id: "TNC-LOCAL", body: "fixture" }));
  const baseEnv = { CODEX_BIN: process.execPath };
  const disabled = loadConfig({ env: baseEnv, argv: ["--test-ticket", ticketFile] });
  assert.equal(disabled.projectProfiles["market-map"].enabled, false);
  assert.throws(() => loadConfig({
    env: { ...baseEnv, RUNNER_MARKET_MAP_ENABLED: "true" },
    argv: ["--test-ticket", ticketFile],
  }), /RUNNER_MARKET_MAP_REPO_ROOT/);

  const enabled = loadConfig({
    env: {
      ...baseEnv,
      RUNNER_MARKET_MAP_ENABLED: "true",
      RUNNER_MARKET_MAP_REPO_ROOT: root,
    },
    argv: ["--test-ticket", ticketFile],
  }).projectProfiles["market-map"];
  assert.equal(enabled.expectedOrigin, MARKET_MAP_ORIGIN);
  assert.equal(enabled.productionPublicUrl.href, MARKET_MAP_PUBLIC_URL);
  assert.deepEqual(enabled.allowedPrefixes, [...MARKET_MAP_CHANGED_PATHS]);
  assert.deepEqual(enabled.allowedExactPaths, [...MARKET_MAP_CHANGED_PATHS]);
  assert.deepEqual(enabled.sourceArtifactPaths, [...MARKET_MAP_ARTIFACT_PATHS]);
  assert.equal(enabled.allowedPrefixes.includes("data.json"), false);
  assert.equal(enabled.sourceArtifactPaths.includes("test_dshk_sync.py"), false);
  assert.deepEqual(enabled.smokeChecks[0].expectedStatuses, [401]);
  assert.deepEqual(assertSafeChangedPaths(["vendor/leaflet.js"], {
    allowedPrefixes: enabled.allowedPrefixes,
    allowedExactPaths: enabled.allowedExactPaths,
    deniedPatterns: enabled.deniedPathPatterns,
  }), ["vendor/leaflet.js"]);
  assert.throws(() => assertSafeChangedPaths(["vendor/leaflet.js/payload"], {
    allowedPrefixes: enabled.allowedPrefixes,
    allowedExactPaths: enabled.allowedExactPaths,
    deniedPatterns: enabled.deniedPathPatterns,
  }), /outside the allowlist/);
});

test("one registry initializes an isolated workspace per enabled trusted profile", async () => {
  const initialized = [];
  const registry = new ProjectRuntimeRegistry({
    projectProfiles: {
      residence: {
        key: "residence", label: "Residence", enabled: true, productionVerifierKey: "fixture",
        repoRoot: "/tmp/profile-repos/residence", worktreeRoot: "/tmp/profile-worktrees/residence",
      },
      "market-map": {
        key: "market-map", label: "Market Map", enabled: true, productionVerifierKey: "fixture",
        repoRoot: "/tmp/profile-repos/market-map", worktreeRoot: "/tmp/profile-worktrees/market-map",
      },
      disabled: { key: "disabled", label: "Disabled", enabled: false, productionVerifierKey: "fixture" },
    },
  }, null, {
    workspaceFactory: (runtimeConfig) => ({
      initialize: async () => initialized.push(runtimeConfig.projectKey),
      marker: runtimeConfig.projectKey,
    }),
    productionVerifiers: { fixture: async () => ({}) },
  });
  await registry.initialize();
  assert.deepEqual(initialized, ["residence", "market-map"]);
  assert.equal(registry.resolve("market_map").gitWorkspace.marker, "market-map");
  assert.throws(() => registry.resolve("disabled"), /unknown or disabled/);
  assert.throws(() => registry.resolve("unknown"), /unknown or disabled/);
});

test("project smoke contracts can require the protected market-map HTTP 401", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const config = {
    smokeChecks: [{ url: new URL(MARKET_MAP_PUBLIC_URL), expectedStatuses: [401] }],
    smokeTimeoutMs: 1_000,
  };
  const checks = await runSmokeChecks({
    config,
    ticketId: "TNC-SMOKE",
    signal: new AbortController().signal,
    logger: { info() {} },
  });
  assert.equal(checks[0].status, 401);
  globalThis.fetch = async () => new Response(null, { status: 200 });
  await assert.rejects(runSmokeChecks({
    config,
    ticketId: "TNC-SMOKE",
    signal: new AbortController().signal,
    logger: { info() {} },
  }), /HTTP 200/);
});

test("ticket recovery is bound to its original project and fails before workspace use", async () => {
  let workspaceUsed = false;
  let failed = null;
  const writes = [];
  const result = await processLease({
    lease: {
      leaseToken: "lease",
      ticket: { id: "TNC-BOUND", attempt: 1, projectKey: "market-map", title: "fixture", body: "fixture", attachments: [] },
    },
    config: { heartbeatIntervalMs: 60_000, maxHeartbeatFailures: 3, commandTimeoutMs: 1_000, keepFailedWorktrees: true },
    client: {
      heartbeat: async () => ({}),
      progress: async () => {},
      fail: async (_id, _lease, report) => { failed = report; },
    },
    stateStore: {
      readTicket: async () => ({ ticketId: "TNC-BOUND", attempt: 1, projectKey: "residence", phase: "worktree_ready" }),
      writeTicket: async (_id, _attempt, state) => writes.push(state),
    },
    projectRegistry: {
      resolve: () => ({
        projectKey: "market-map",
        config: { heartbeatIntervalMs: 60_000, maxHeartbeatFailures: 3, commandTimeoutMs: 1_000, keepFailedWorktrees: true },
        gitWorkspace: { prepareWorktree: async () => { workspaceUsed = true; } },
        productionVerifier: async () => ({}),
      }),
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    shutdownSignal: new AbortController().signal,
  });
  assert.equal(result.outcome, "failed");
  assert.equal(result.error.code, "PROJECT_CHECKPOINT_MISMATCH");
  assert.equal(workspaceUsed, false);
  assert.equal(failed.error.code, "PROJECT_CHECKPOINT_MISMATCH");
  assert.equal(writes.at(-1).projectKey, "market-map");
});

test("reviewed source seals include read-only data but reject every extra path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-source-seal-"));
  let seal = null;
  t.after(async () => {
    await cleanupSealedArtifact(seal);
    await fs.rm(root, { recursive: true, force: true });
  });
  const source = path.join(root, "source");
  const stateDir = path.join(root, "state");
  await fs.mkdir(path.join(source, "vendor"), { recursive: true });
  for (const filename of ["server.py", "dshk_sync.py", "leadora_carto_map.html", "data.json", "vendor/leaflet.js"]) {
    await fs.writeFile(path.join(source, filename), "fixture\n");
  }
  seal = await sealExternalSourceArtifact({
    config: { stateDir },
    sourcePath: source,
    trustedSourceRoot: root,
    ticketId: "TNC-SEAL",
    treeSha: "a".repeat(40),
    allowedPaths: [...MARKET_MAP_ARTIFACT_PATHS],
    requiredPaths: ["server.py", "dshk_sync.py", "leadora_carto_map.html", "data.json"],
  });
  assert.equal(seal.kind, "reviewed-source");
  assert.equal(await verifySealedArtifact(seal), true);

  const badSource = path.join(root, "bad-source");
  await fs.cp(source, badSource, { recursive: true });
  await fs.writeFile(path.join(badSource, "vendor", "unexpected.js"), "not reviewed\n");
  await assert.rejects(sealExternalSourceArtifact({
    config: { stateDir },
    sourcePath: badSource,
    trustedSourceRoot: root,
    ticketId: "TNC-BAD-SEAL",
    treeSha: "b".repeat(40),
    allowedPaths: [...MARKET_MAP_ARTIFACT_PATHS],
    requiredPaths: ["server.py", "dshk_sync.py", "leadora_carto_map.html", "data.json"],
  }), /unreviewed path/);
});

test("market-map verifier tests code but seals only the exact staged runtime tree", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-market-verifier-"));
  let seal = null;
  t.after(async () => {
    await cleanupSealedArtifact(seal);
    await fs.rm(root, { recursive: true, force: true });
  });
  const worktree = path.join(root, "worktree");
  await fs.mkdir(path.join(worktree, "vendor"), { recursive: true });
  const fixtureFiles = new Map([
    ["server.py", "VALUE = 1\n"],
    ["dshk_sync.py", "def ready():\n    return True\n"],
    ["test_dshk_sync.py", "import unittest\nimport dshk_sync\nclass TestSync(unittest.TestCase):\n    def test_ready(self): self.assertTrue(dshk_sync.ready())\n"],
    ["leadora_carto_map.html", "<!doctype html><html><script>const ready = true;</script></html>\n"],
    ["data.json", "{\"points\":[]}\n"],
    ["vendor/leaflet.css", "/* css */\n"],
    ["vendor/leaflet.js", "/* js */\n"],
  ]);
  for (const [filename, content] of fixtureFiles) await fs.writeFile(path.join(worktree, filename), content);
  execFileSync("/usr/bin/git", ["init", "--initial-branch=main"], { cwd: worktree });
  execFileSync("/usr/bin/git", ["add", "."], { cwd: worktree });
  execFileSync("/usr/bin/git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "base"], { cwd: worktree });
  const treeSha = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).trim();
  const gitWorkspace = {
    exportTreeArchive: async ({ treeSha: selectedTree, destination, paths }) => {
      execFileSync("/usr/bin/git", ["archive", "--format=tar", `--output=${destination}`, selectedTree, "--", ...paths], { cwd: worktree });
    },
  };
  const result = await runMarketMapVerification({
    config: {
      stateDir: path.join(root, "state"),
      commandTimeoutMs: 10_000,
      verifyCommands: structuredClone(DEFAULT_MARKET_MAP_VERIFY_COMMANDS),
      verificationEnvironment: {},
      verificationRuntimePaths: ["/Applications/Xcode.app/Contents/Developer"],
      sourceArtifactPaths: [...MARKET_MAP_ARTIFACT_PATHS],
      sourceArtifactRequiredPaths: ["server.py", "dshk_sync.py", "leadora_carto_map.html", "data.json"],
    },
    gitWorkspace,
    worktreePath: worktree,
    treeSha,
    ticketId: "TNC-MARKET-VERIFY",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
  });
  seal = result.artifactSeal;
  assert.equal(result.verification.length, DEFAULT_MARKET_MAP_VERIFY_COMMANDS.length);
  await fs.access(path.join(seal.artifactPath, "data.json"));
  await assert.rejects(fs.access(path.join(seal.artifactPath, "test_dshk_sync.py")));
  assert.equal(await verifySealedArtifact(seal), true);
});
