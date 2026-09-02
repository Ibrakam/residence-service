import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupSealedArtifact, verifySealedArtifact } from "../src/artifact-seal.mjs";
import { runCommand } from "../src/command.mjs";
import { DEFAULT_DOCKER_HOST_PIN, DEFAULT_DOCKER_IMAGE } from "../src/config.mjs";
import { runDockerVerification } from "../src/docker-verification.mjs";

const enabled = process.env.RUN_DOCKER_INTEGRATION === "1";

test("pinned Linux verifier streams source through a named volume and exports a uid-1000 build", {
  skip: enabled ? false : "set RUN_DOCKER_INTEGRATION=1 to exercise the pinned Docker image",
  timeout: 10 * 60_000,
}, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runner-docker-integration-"));
  const source = path.join(root, "source");
  const website = path.join(source, "website");
  const stateDir = path.join(root, "state");
  const dockerBin = "/usr/local/bin/docker";
  const ticketId = `DOCKER-INT-${process.pid}`;
  let artifactSeal = null;
  t.after(async () => {
    await cleanupSealedArtifact(artifactSeal).catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  });

  await fs.mkdir(website, { recursive: true });
  await fs.writeFile(path.join(website, "package.json"), `${JSON.stringify({
    name: "runner-docker-fixture",
    version: "1.0.0",
    private: true,
    scripts: {
      lint: "node lint.mjs",
      build: "node build.mjs",
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(website, "package-lock.json"), `${JSON.stringify({
    name: "runner-docker-fixture",
    version: "1.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": { name: "runner-docker-fixture", version: "1.0.0" },
    },
  }, null, 2)}\n`);
  await fs.writeFile(path.join(website, "lint.mjs"), `
import fs from "node:fs";
const stat = fs.statSync(".");
if (stat.uid !== 1000) throw new Error(` + "`unexpected source uid ${stat.uid}`" + `);
if (process.getuid() !== 1000) throw new Error("verifier is not uid 1000");
`);
  await fs.writeFile(path.join(website, "build.mjs"), `
import fs from "node:fs";
import path from "node:path";
const root = "dist/standalone";
fs.mkdirSync(path.join(root, "dist/client/residence-assets/_next/static/chunks"), { recursive: true });
fs.writeFileSync(path.join(root, "server.js"), "process.exit(0);\\n");
fs.writeFileSync(path.join(root, "package.json"), "{}\\n");
fs.writeFileSync(path.join(root, "STANDALONE_RUNTIME.json"), '{"schemaVersion":2,"packages":[]}\\n');
fs.writeFileSync(path.join(root, "dist/client/residence-assets/_next/static/chunks/app.js"), "fixture\\n");
`);

  const config = {
    stateDir,
    dockerBin,
    dockerImage: DEFAULT_DOCKER_IMAGE,
    dockerPlatform: DEFAULT_DOCKER_HOST_PIN.platform,
    dockerArchitecture: DEFAULT_DOCKER_HOST_PIN.architecture,
    dockerChildImage: DEFAULT_DOCKER_HOST_PIN.childImage,
    dockerExpectedImageId: DEFAULT_DOCKER_HOST_PIN.imageId,
    dockerPidsLimit: 128,
    dockerMemory: "1g",
    dockerCpus: "1",
    commandTimeoutMs: 5 * 60_000,
  };
  const dockerLinkStat = await fs.lstat(dockerBin);
  const dockerRealPath = await fs.realpath(dockerBin);
  const dockerStat = await fs.stat(dockerRealPath);
  config.dockerBinPin = {
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
  };
  const gitWorkspace = {
    async exportTreeArchive({ destination, signal }) {
      await runCommand({
        argv: ["/usr/bin/tar", "--no-mac-metadata", "--no-xattrs", "-cf", destination, "-C", source, "website"],
        cwd: root,
        env: { ...process.env, COPYFILE_DISABLE: "1" },
        signal,
        timeoutMs: 30_000,
        label: "test.export_source",
      });
    },
  };
  const result = await runDockerVerification({
    config,
    gitWorkspace,
    worktreePath: source,
    treeSha: "a".repeat(40),
    ticketId,
    signal: AbortSignal.timeout(8 * 60_000),
  });
  artifactSeal = result.artifactSeal;

  assert.equal(result.platform, DEFAULT_DOCKER_HOST_PIN.platform);
  assert.equal(result.imageId, DEFAULT_DOCKER_HOST_PIN.imageId);
  assert.equal(result.imageChild, DEFAULT_DOCKER_HOST_PIN.childImage);
  assert.deepEqual(result.verification.map(({ name }) => name), [
    "website-install",
    "website-lint",
    "website-build",
  ]);
  await verifySealedArtifact(artifactSeal);
  const artifactStat = await fs.stat(artifactSeal.artifactPath);
  const serverStat = await fs.stat(path.join(artifactSeal.artifactPath, "server.js"));
  assert.equal(artifactStat.mode & 0o777, 0o555);
  assert.equal(serverStat.mode & 0o777, 0o444);
  assert.equal(await fs.readFile(path.join(artifactSeal.artifactPath, "server.js"), "utf8"), "process.exit(0);\n");

  const leakedVolumes = (await runCommand({
    argv: [dockerBin, "volume", "ls", "--quiet", "--filter", `label=com.tencorp.ticket=${ticketId.toLowerCase()}`],
    cwd: root,
    timeoutMs: 30_000,
    label: "test.list_leaked_volumes",
  })).stdout.trim();
  assert.equal(leakedVolumes, "");
});
