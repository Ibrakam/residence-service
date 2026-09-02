import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { cleanupSealedArtifact, verifySealedArtifact } from "../src/artifact-seal.mjs";
import { runCommand } from "../src/command.mjs";
import { DEFAULT_DOCKER_HOST_PIN, DEFAULT_DOCKER_IMAGE } from "../src/config.mjs";
import { runDockerVerification } from "../src/docker-verification.mjs";

const enabled = process.env.RUN_DOCKER_WEBSITE_INTEGRATION === "1";
const automationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(automationRoot, "..");

test("the complete Residence website builds in the pinned native Linux verifier", {
  skip: enabled ? false : "set RUN_DOCKER_WEBSITE_INTEGRATION=1 for the full production build",
  timeout: 45 * 60_000,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runner-docker-website-"));
  const dockerBin = "/usr/local/bin/docker";
  let artifactSeal = null;
  t.after(async () => {
    await cleanupSealedArtifact(artifactSeal).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  const dockerLinkStat = await fs.lstat(dockerBin);
  const dockerRealPath = await fs.realpath(dockerBin);
  const dockerStat = await fs.stat(dockerRealPath);
  const config = {
    stateDir: path.join(root, "state"),
    dockerBin,
    dockerImage: DEFAULT_DOCKER_IMAGE,
    dockerPlatform: DEFAULT_DOCKER_HOST_PIN.platform,
    dockerArchitecture: DEFAULT_DOCKER_HOST_PIN.architecture,
    dockerChildImage: DEFAULT_DOCKER_HOST_PIN.childImage,
    dockerExpectedImageId: DEFAULT_DOCKER_HOST_PIN.imageId,
    dockerPidsLimit: 1_024,
    dockerMemory: "4g",
    dockerCpus: "3",
    commandTimeoutMs: 30 * 60_000,
    dockerBinPin: {
      configuredPath: dockerBin,
      linkDev: dockerLinkStat.dev,
      linkIno: dockerLinkStat.ino,
      linkMode: dockerLinkStat.mode,
      realPath: dockerRealPath,
      uid: dockerStat.uid,
      dev: dockerStat.dev,
      ino: dockerStat.ino,
      mode: dockerStat.mode,
      sha256: crypto.createHash("sha256").update(await fs.readFile(dockerRealPath)).digest("hex"),
    },
  };
  const treeSha = (await runCommand({
    argv: ["/usr/bin/git", "rev-parse", "HEAD^{tree}"],
    cwd: repoRoot,
    timeoutMs: 30_000,
    label: "test.resolve_website_tree",
  })).stdout.trim();
  const gitWorkspace = {
    async exportTreeArchive({ treeSha: requestedTree, destination, signal }) {
      assert.equal(requestedTree, treeSha);
      await runCommand({
        argv: ["/usr/bin/git", "archive", "--format=tar", `--output=${destination}`, treeSha],
        cwd: repoRoot,
        signal,
        timeoutMs: 2 * 60_000,
        label: "test.export_website_tree",
      });
    },
  };
  const result = await runDockerVerification({
    config,
    gitWorkspace,
    worktreePath: repoRoot,
    treeSha,
    ticketId: `WEBSITE-INT-${process.pid}`,
    signal: AbortSignal.timeout(40 * 60_000),
  });
  artifactSeal = result.artifactSeal;
  assert.equal(result.platform, DEFAULT_DOCKER_HOST_PIN.platform);
  assert.equal(result.imageId, DEFAULT_DOCKER_HOST_PIN.imageId);
  assert.deepEqual(result.verification.map(({ name }) => name), ["website-install", "website-lint", "website-build"]);
  assert.equal(await verifySealedArtifact(artifactSeal), true);
  await fs.access(path.join(artifactSeal.artifactPath, "server.js"));
  await fs.access(path.join(artifactSeal.artifactPath, "dist/client/residence-assets/_next/static"));
});
