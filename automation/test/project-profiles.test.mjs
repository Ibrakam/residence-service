import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cleanupSealedArtifact, sealExternalSourceArtifact, verifySealedArtifact } from "../src/artifact-seal.mjs";
import {
  MARKET_MAP_ARTIFACT_PATHS,
  MARKET_MAP_CHANGED_PATHS,
  MARKET_MAP_ORIGIN,
  MARKET_MAP_PYTHON_BIN,
  MARKET_MAP_PUBLIC_URL,
  DEFAULT_MARKET_MAP_VERIFY_COMMANDS,
  loadConfig,
} from "../src/config.mjs";
import { processLease } from "../src/pipeline.mjs";
import { ProjectRuntimeRegistry, normalizeProjectKey } from "../src/project-profiles.mjs";
import { queryRemoteMarketMapPolicy, runMarketMapVerification } from "../src/market-map-verification.mjs";
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
  assert.equal(enabled.marketMapPythonBin, MARKET_MAP_PYTHON_BIN);
  assert.equal(enabled.prePushDeploymentValidation, true);
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

test("market-map HTML permits only one pinned provider and an operator-owned Yandex key placeholder", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-map-html-validator-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const validator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deploy/validate-market-map-html.py");
  const run = (filename) => execFileSync(MARKET_MAP_PYTHON_BIN, [validator, filename], { encoding: "utf8" }).trim();
  const write = async (name, html) => {
    const filename = path.join(root, name);
    await fs.writeFile(filename, html);
    return filename;
  };
  const leaflet = await write("leaflet.html", '<!doctype html><html><head><title>Market map</title><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script></body></html>');
  const yandex = await write("yandex.html", '<!doctype html><html><head><script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU&amp;apikey=__TENCORP_YANDEX_MAPS_API_KEY__"></script></head><body><script>const ready = true;</script></body></html>');
  assert.equal(run(leaflet), "leaflet");
  assert.equal(run(yandex), "yandex-maps-js-2.1");

  const rejected = new Map([
    ["missing-key.html", '<html><script src="https://api-maps.yandex.ru/2.1/?lang=ru_RU"></script></html>'],
    ["embedded-key.html", '<html><script src="https://api-maps.yandex.ru/2.1/?apikey=not-a-real-key&amp;lang=ru_RU"></script></html>'],
    ["encoded-placeholder.html", '<html><script src="https://api-maps.yandex.ru/2.1/?apikey=&#95;&#95;TENCORP_YANDEX_MAPS_API_KEY&#95;&#95;&amp;lang=ru_RU"></script><script>const ready = true;</script></html>'],
    ["unapproved.html", '<html><script src="https://cdn.example.test/map.js"></script></html>'],
    ["mixed.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></html>'],
    ["base.html", '<html><base href="https://evil.example/"><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></html>'],
    ["svg.html", '<html><svg><script href="https://evil.example/payload.js"></script></svg><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></html>'],
    ["inactive-type.html", '<html><script type="application/json" src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></html>'],
    ["template.html", '<html><template><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></template></html>'],
    ["self-closing-template.html", '<html><template/><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script><script>const ready = true;</script></html>'],
    ["nomodule.html", '<html><script nomodule src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></html>'],
    ["inline-module.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script><script type="module">import "https://evil.example/payload.js";</script></html>'],
    ["inline-legacy-mime.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script><script type="text/ecmascript">const = ;</script></html>'],
    ["inline-handler.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script onload="location=\'https://evil.example/\'">const ready = true;</script></html>'],
    ["inactive-css.html", '<html><link rel="stylesheet" media="not all" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></html>'],
    ["too-many-inline.html", `<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script>${"<script>const ready = true;</script>".repeat(9)}</html>`],
    ["parser-bypass.html", `<html><link rel="stylesheet" href="./vendor/leaflet.css"><script data-x="<script src='./vendor/leaflet.js'>" src="https://evil.example/payload.js" src="./vendor/leaflet.js"></script></html>`],
    ["textarea-provider.html", '<html><textarea><script src="./vendor/leaflet.js"></script></textarea><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script></html>'],
    ["title-provider.html", '<html><title><script src="./vendor/leaflet.js"></script></title><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script></html>'],
    ["xmp-provider.html", '<html><xmp><script src="./vendor/leaflet.js"></script></xmp><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script></html>'],
    ["svg-inline.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><svg><script>const = ;</script></svg><script>const ready = true;</script></html>'],
    ["plaintext-provider.html", '<html><plaintext><script src="./vendor/leaflet.js"></script><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script></html>'],
    ["frameset-provider.html", '<html><frameset><script src="./vendor/leaflet.js"></script></frameset><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script></html>'],
    ["unclosed-leaflet.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script>const ready = true;</script><script src="./vendor/leaflet.js">'],
    ["unclosed-yandex.html", '<html><script>const ready = true;</script><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU">'],
    ["legacy-script-comment.html", '<!doctype html><html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script><!--<script></script><script src="./vendor/leaflet.js"></script><script>const ready=true;</script></head></html>'],
    ["nbsp-script-type.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script type="\u00a0text/javascript\u00a0" src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["nbsp-css-rel.html", '<html><link rel="stylesheet\u00a0" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["nbsp-css-type.html", '<html><link rel="stylesheet" type="\u00a0text/css\u00a0" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["nbsp-script-separator.html", '<html><link rel="stylesheet" href="./vendor/leaflet.css"><script type="text/javascript"\u00a0src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["nbsp-link-separator.html", '<html><link rel="stylesheet"\u00a0href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["remote-stylesheet.html", '<html><link rel="stylesheet" href="https://evil.example/payload.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["unicode-tag-name.html", '<html><linK rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script><script>const ready = true;</script></html>'],
    ["select-provider.html", '<html><head><script src="./vendor/leaflet.js"></script></head><body><select><link rel="stylesheet" href="./vendor/leaflet.css"></select><script>const ready = true;</script></body></html>'],
    ["late-head-provider.html", '<html><body><select><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head></select><script>const ready = true;</script></body></html>'],
    ["nbsp-script-end.html", '<html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script\u00a0></body></html>'],
    ["spaced-script-end.html", '<html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</ script></body></html>'],
    ["ambiguous-yandex-entity.html", '<html><head><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amplang=ru_RU"></script></head><body><script>const ready = true;</script></body></html>'],
    ["ambiguous-comment-close.html", '<html><!--hidden-- ><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script></body></html>'],
  ]);
  for (const [name, html] of rejected) {
    const filename = await write(name, html);
    assert.throws(() => run(filename), (error) => error?.status !== 0, name);
  }
});

test("market-map publication requires the exact server validator policy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ticket-map-policy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "worktree");
  const wrapper = path.join(root, "trusted-wrapper");
  await fs.mkdir(worktree);
  const validator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deploy/validate-market-map-html.py");
  const digest = crypto.createHash("sha256").update(await fs.readFile(validator)).digest("hex");
  const pinWrapper = async () => {
    const metadata = await fs.lstat(wrapper);
    const canonicalWrapper = await fs.realpath(wrapper);
    return {
      deployScript: wrapper,
      requiredDeployScriptPath: canonicalWrapper,
      requiredDeployOwnerUid: metadata.uid,
      requiredDeployMode: 0o700,
      deployScriptPin: {
        realPath: canonicalWrapper,
        sha256: crypto.createHash("sha256").update(await fs.readFile(wrapper)).digest("hex"),
        uid: metadata.uid,
        dev: metadata.dev,
        ino: metadata.ino,
        mode: metadata.mode,
      },
      repoRoot: root,
      projectKey: "market-map",
      deployTimeoutMs: 5_000,
    };
  };
  const writeWrapper = async (reportedDigest, keyStatus = "present") => {
    await fs.writeFile(wrapper, `#!/bin/sh\n[ "$1" = "--policy-version" ] || exit 64\n[ "\${TICKET_RUNNER_PROJECT_KEY:-}" = "market-map" ] || exit 65\nprintf 'market-map-policy v1 %s yandex-key-${keyStatus}\\n' '${reportedDigest}'\n`, { mode: 0o700 });
    return pinWrapper();
  };
  let config = await writeWrapper(digest);
  const accepted = await queryRemoteMarketMapPolicy({
    config, worktreePath: worktree, signal: new AbortController().signal, logger: { info() {} },
  });
  assert.equal(accepted.validatorSha256, digest);
  assert.equal(accepted.yandexKeyPresent, true);
  config = await writeWrapper(digest, "unavailable");
  assert.equal((await queryRemoteMarketMapPolicy({
    config, worktreePath: worktree, signal: new AbortController().signal, logger: { info() {} },
  })).yandexKeyPresent, false);
  config = await writeWrapper("0".repeat(64));
  assert.equal((await queryRemoteMarketMapPolicy({
    config, worktreePath: worktree, signal: new AbortController().signal, logger: { info() {} },
  })).validatorSha256, "0".repeat(64));
  await assert.rejects(queryRemoteMarketMapPolicy({
    config: { ...config, projectKey: "residence" },
    worktreePath: worktree,
    signal: new AbortController().signal,
    logger: { info() {} },
  }), /exact market-map project identity/);
  await fs.writeFile(wrapper, "#!/bin/sh\nprintf 'market-map-policy v1 malformed yandex-key-present\\n'\n", { mode: 0o700 });
  config = await pinWrapper();
  await assert.rejects(queryRemoteMarketMapPolicy({
    config, worktreePath: worktree, signal: new AbortController().signal, logger: { info() {} },
  }), /response was malformed/);
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
    ["leadora_carto_map.html", '<!doctype html><html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script></body></html>\n'],
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
  const verifierConfig = {
    projectKey: "market-map",
    stateDir: path.join(root, "state"),
    commandTimeoutMs: 10_000,
    deployTimeoutMs: 10_000,
    verifyCommands: structuredClone(DEFAULT_MARKET_MAP_VERIFY_COMMANDS),
    verificationEnvironment: {},
    verificationRuntimePaths: ["/Applications/Xcode.app/Contents/Developer"],
    marketMapPythonBin: MARKET_MAP_PYTHON_BIN,
    sourceArtifactPaths: [...MARKET_MAP_ARTIFACT_PATHS],
    sourceArtifactRequiredPaths: ["server.py", "dshk_sync.py", "leadora_carto_map.html", "data.json"],
  };
  const validator = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../deploy/validate-market-map-html.py");
  const validatorDigest = crypto.createHash("sha256").update(await fs.readFile(validator)).digest("hex");
  let exportAttempted = false;
  await assert.rejects(runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace: { exportTreeArchive: async () => { exportAttempted = true; } },
    worktreePath: worktree,
    treeSha,
    ticketId: "TNC-MARKET-POLICY-MISMATCH",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({ protocol: "v1", validatorSha256: "0".repeat(64), yandexKeyPresent: true, durationMs: 1 }),
  }), /server policy differs/);
  assert.equal(exportAttempted, false);
  const result = await runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace,
    worktreePath: worktree,
    treeSha,
    ticketId: "TNC-MARKET-VERIFY",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({ protocol: "v1", validatorSha256: validatorDigest, yandexKeyPresent: true, durationMs: 1 }),
  });
  seal = result.artifactSeal;
  assert.equal(result.verification.length, DEFAULT_MARKET_MAP_VERIFY_COMMANDS.length + 2);
  await fs.access(path.join(seal.artifactPath, "data.json"));
  await assert.rejects(fs.access(path.join(seal.artifactPath, "test_dshk_sync.py")));
  assert.equal(await verifySealedArtifact(seal), true);

  await fs.writeFile(
    path.join(worktree, "leadora_carto_map.html"),
    '<html><head><script src="https://api-maps.yandex.ru/2.1/?apikey=__TENCORP_YANDEX_MAPS_API_KEY__&amp;lang=ru_RU"></script></head><body><script>const ready = true;</script></body></html>\n',
  );
  execFileSync("/usr/bin/git", ["add", "leadora_carto_map.html"], { cwd: worktree });
  execFileSync("/usr/bin/git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "yandex fixture"], { cwd: worktree });
  const yandexTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).trim();
  await assert.rejects(runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace,
    worktreePath: worktree,
    treeSha: yandexTree,
    ticketId: "TNC-MARKET-YANDEX-NO-KEY",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({
      protocol: "v1", validatorSha256: validatorDigest, yandexKeyPresent: false, durationMs: 1,
    }),
  }), /API key is not provisioned.*before commit/);

  await fs.writeFile(
    path.join(worktree, "leadora_carto_map.html"),
    '<html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ok = 1;</script><script>const = ;</script></body></html>\n',
  );
  execFileSync("/usr/bin/git", ["add", "leadora_carto_map.html"], { cwd: worktree });
  execFileSync("/usr/bin/git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "malformed inline script"], { cwd: worktree });
  const malformedTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).trim();
  await assert.rejects(runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace,
    worktreePath: worktree,
    treeSha: malformedTree,
    ticketId: "TNC-MARKET-MALFORMED-INLINE",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({ protocol: "v1", validatorSha256: validatorDigest, yandexKeyPresent: true, durationMs: 1 }),
  }), /inline JavaScript has invalid syntax/);

  await fs.writeFile(
    path.join(worktree, "leadora_carto_map.html"),
    '<html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>return;</script></body></html>\n',
  );
  execFileSync("/usr/bin/git", ["add", "leadora_carto_map.html"], { cwd: worktree });
  execFileSync("/usr/bin/git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "browser-invalid return"], { cwd: worktree });
  const browserInvalidTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).trim();
  await assert.rejects(runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace,
    worktreePath: worktree,
    treeSha: browserInvalidTree,
    ticketId: "TNC-MARKET-BROWSER-INVALID-INLINE",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({ protocol: "v1", validatorSha256: validatorDigest, yandexKeyPresent: true, durationMs: 1 }),
  }), /inline JavaScript has invalid syntax/);

  await fs.writeFile(
    path.join(worktree, "leadora_carto_map.html"),
    '<html><head><link rel="stylesheet" href="./vendor/leaflet.css"><script src="./vendor/leaflet.js"></script></head><body><script>const ready = true;</script></body></html>\n',
  );
  await fs.writeFile(path.join(worktree, "vendor/leaflet.js"), "return;\n");
  execFileSync("/usr/bin/git", ["add", "leadora_carto_map.html", "vendor/leaflet.js"], { cwd: worktree });
  execFileSync("/usr/bin/git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "browser-invalid vendor"], { cwd: worktree });
  const browserInvalidVendorTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: worktree, encoding: "utf8" }).trim();
  await assert.rejects(runMarketMapVerification({
    config: verifierConfig,
    gitWorkspace,
    worktreePath: worktree,
    treeSha: browserInvalidVendorTree,
    ticketId: "TNC-MARKET-BROWSER-INVALID-VENDOR",
    signal: new AbortController().signal,
    logger: { info() {}, warn() {}, error() {} },
    remotePolicyVerifier: async () => ({ protocol: "v1", validatorSha256: validatorDigest, yandexKeyPresent: true, durationMs: 1 }),
  }), (error) => /market-map-vendor-js-syntax/.test(error?.cause?.message || ""));
});
