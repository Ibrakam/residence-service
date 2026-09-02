import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sealExternalBuildArtifact } from "./artifact-seal.mjs";
import { runCommand } from "./command.mjs";
import { PolicyError, RunnerError } from "./errors.mjs";
import { safeError } from "./logger.mjs";
import { isPathInside, safeSlug } from "./sanitize.mjs";

const FIXED_BUILD_ENV = {
  CI: "1",
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://form.tencorp.uz",
  NEXT_PUBLIC_APP_BASE_PATH: "",
  NEXT_PUBLIC_ASSET_PREFIX: "/residence-assets",
  NEXT_PUBLIC_CATALOG_API_URL: "/residence-api/catalog",
};

function dockerEnv(homePath) {
  return {
    HOME: homePath,
    PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    DOCKER_CONFIG: path.join(homePath, ".docker"),
  };
}

export function buildDockerCreateArgs(config, containerName) {
  return [
    "create",
    "--name", containerName,
    "--platform", "linux/amd64",
    "--network", "bridge",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(config.dockerPidsLimit || 1_024),
    "--memory", config.dockerMemory || "4g",
    "--cpus", config.dockerCpus || "3",
    "--read-only",
    "--user", "1000:1000",
    "--workdir", "/workspace/source/website",
    "--tmpfs", "/workspace:rw,exec,nosuid,nodev,size=6442450944,mode=1777",
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=1073741824,mode=1777",
    "--tmpfs", "/home/node/.npm:rw,nosuid,nodev,size=1073741824,mode=0700,uid=1000,gid=1000",
    "--stop-timeout", "5",
    "--entrypoint", "/usr/bin/sleep",
    config.dockerImage,
    "infinity",
  ];
}

async function makePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

function parseInspect(stdout, label) {
  let parsed;
  try {
    [parsed] = JSON.parse(stdout);
  } catch (cause) {
    throw new RunnerError(`${label} returned invalid JSON`, { code: "DOCKER_INVALID_RESPONSE", cause });
  }
  if (!parsed || typeof parsed !== "object") throw new RunnerError(`${label} returned no object`, { code: "DOCKER_INVALID_RESPONSE" });
  return parsed;
}

export function assertHardenedContainerInspect(inspect, config) {
  const host = inspect.HostConfig || {};
  if (Array.isArray(host.Binds) && host.Binds.length > 0) throw new PolicyError("Verifier container unexpectedly has a host bind mount");
  if (Array.isArray(inspect.Mounts) && inspect.Mounts.some((mount) => mount.Type === "bind")) {
    throw new PolicyError("Verifier container unexpectedly exposes a host filesystem mount");
  }
  if (host.ReadonlyRootfs !== true) throw new PolicyError("Verifier container root filesystem is not read-only");
  if (!Array.isArray(host.CapDrop) || !host.CapDrop.includes("ALL")) throw new PolicyError("Verifier container did not drop all Linux capabilities");
  if (!Array.isArray(host.SecurityOpt) || !host.SecurityOpt.some((entry) => entry === "no-new-privileges:true")) {
    throw new PolicyError("Verifier container is missing no-new-privileges");
  }
  if (host.NetworkMode !== "default" && host.NetworkMode !== "bridge") throw new PolicyError("Verifier container has an unexpected network mode");
  if (inspect.Config?.User !== "1000:1000") throw new PolicyError("Verifier container is not running as the unprivileged node uid");
  if (inspect.Platform && inspect.Platform !== "linux") throw new PolicyError("Verifier container is not Linux");
  const image = String(inspect.Image || "");
  if (!image.startsWith("sha256:")) throw new PolicyError("Verifier container image did not resolve to an immutable image id");
  if (config.dockerPlatform !== "linux/amd64") throw new PolicyError("Production verifier platform must remain linux/amd64");
}

async function dockerCommand({ config, args, cwd, homePath, signal, timeoutMs, label, logger, captureLimit }) {
  return runCommand({
    argv: [config.dockerBin, ...args],
    cwd,
    env: dockerEnv(homePath),
    signal,
    timeoutMs: timeoutMs || config.commandTimeoutMs,
    label,
    logger,
    captureLimit,
  });
}

async function stopContainer({ config, containerName, jobRoot, homePath, logger }) {
  try {
    await dockerCommand({
      config,
      args: ["stop", "--time", "5", containerName],
      cwd: jobRoot,
      homePath,
      signal: AbortSignal.timeout(20_000),
      timeoutMs: 20_000,
      label: "docker.stop_verifier",
      logger,
    });
  } catch (error) {
    logger?.warn("docker.stop_failed", { error: safeError(error) });
    await dockerCommand({
      config,
      args: ["kill", containerName],
      cwd: jobRoot,
      homePath,
      signal: AbortSignal.timeout(20_000),
      timeoutMs: 20_000,
      label: "docker.kill_verifier",
      logger,
    }).catch(() => {});
  }
}

async function removeContainer({ config, containerName, jobRoot, homePath, logger }) {
  await dockerCommand({
    config,
    args: ["rm", "--force", "--volumes", containerName],
    cwd: jobRoot,
    homePath,
    signal: AbortSignal.timeout(30_000),
    timeoutMs: 30_000,
    label: "docker.remove_verifier",
    logger,
  }).catch((error) => logger?.warn("docker.cleanup_failed", { error: safeError(error) }));
}

export async function runDockerVerification({
  config,
  gitWorkspace,
  worktreePath,
  treeSha,
  ticketId,
  signal,
  logger,
}) {
  if (!/^[a-f0-9]{40,64}$/.test(treeSha)) throw new PolicyError("Docker verification requires an exact staged tree id");
  const jobsRoot = path.join(path.resolve(config.stateDir), "docker-jobs");
  await makePrivateDirectory(jobsRoot);
  const jobRoot = await fs.mkdtemp(path.join(jobsRoot, `${safeSlug(ticketId)}-`));
  await fs.chmod(jobRoot, 0o700);
  const homePath = path.join(jobRoot, "home");
  const exportRoot = path.join(jobRoot, "export");
  await makePrivateDirectory(homePath);
  await makePrivateDirectory(path.join(homePath, ".docker"));
  await makePrivateDirectory(exportRoot);
  const archivePath = path.join(jobRoot, "source.tar");
  if (!isPathInside(jobsRoot, archivePath)) throw new PolicyError("Docker verifier archive escaped its trusted job root");
  const containerName = `avalon-ticket-${safeSlug(ticketId)}-${process.pid}-${Date.now()}`.toLowerCase().slice(0, 120);
  let containerCreated = false;
  let containerStopped = false;
  let artifactSeal = null;
  const results = [];
  try {
    await gitWorkspace.exportTreeArchive({ worktreePath, treeSha, destination: archivePath, signal });
    await fs.chmod(archivePath, 0o600);

    const imageInspection = parseInspect((await dockerCommand({
      config,
      args: ["image", "inspect", config.dockerImage],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.inspect_pinned_image",
      logger,
    })).stdout, "docker image inspect");
    if (imageInspection.Architecture !== "amd64" || imageInspection.Os !== "linux") {
      throw new PolicyError("Pinned verifier image must be linux/amd64");
    }
    if (!Array.isArray(imageInspection.RepoDigests) || !imageInspection.RepoDigests.includes(config.dockerImage.replace(/^docker\.io\/library\//, ""))) {
      throw new PolicyError("Local verifier image does not match the configured immutable digest");
    }

    await dockerCommand({
      config,
      args: buildDockerCreateArgs(config, containerName),
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 60_000,
      label: "docker.create_verifier",
      logger,
    });
    containerCreated = true;
    const containerInspection = parseInspect((await dockerCommand({
      config,
      args: ["inspect", containerName],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.inspect_verifier",
      logger,
    })).stdout, "docker inspect");
    assertHardenedContainerInspect(containerInspection, config);

    await dockerCommand({ config, args: ["start", containerName], cwd: jobRoot, homePath, signal, timeoutMs: 30_000, label: "docker.start_verifier", logger });
    await dockerCommand({ config, args: ["cp", archivePath, `${containerName}:/workspace/source.tar`], cwd: jobRoot, homePath, signal, timeoutMs: 60_000, label: "docker.copy_source", logger });
    await dockerCommand({
      config,
      args: ["exec", containerName, "/bin/sh", "-eu", "-c", "mkdir -p /workspace/source && tar -xf /workspace/source.tar -C /workspace/source && rm /workspace/source.tar"],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 60_000,
      label: "docker.extract_source",
      logger,
    });

    const installStartedAt = Date.now();
    await dockerCommand({
      config,
      args: [
        "exec", "--workdir", "/workspace/source/website",
        "--env", "HOME=/tmp/home", "--env", "CI=1", "--env", "NPM_CONFIG_CACHE=/tmp/npm-cache",
        "--env", "NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc", "--env", "NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc",
        containerName, "npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund",
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 15 * 60_000,
      label: "docker.website_install",
      logger,
    });
    results.push({ name: "website-install", ok: true, durationMs: Date.now() - installStartedAt, isolated: "docker", network: "install-only", platform: "linux/amd64" });

    await dockerCommand({ config, args: ["network", "disconnect", "bridge", containerName], cwd: jobRoot, homePath, signal, timeoutMs: 30_000, label: "docker.disconnect_network", logger });
    const disconnected = parseInspect((await dockerCommand({
      config,
      args: ["inspect", containerName],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.verify_network_disconnected",
      logger,
    })).stdout, "docker inspect after network disconnect");
    if (Object.keys(disconnected.NetworkSettings?.Networks || {}).length !== 0) {
      throw new PolicyError("Verifier container still has a network after dependency installation");
    }

    for (const [name, script, timeoutMs] of [
      ["website-lint", "lint", 10 * 60_000],
      ["website-build", "build", 20 * 60_000],
    ]) {
      const startedAt = Date.now();
      const envArgs = Object.entries(FIXED_BUILD_ENV).flatMap(([key, value]) => ["--env", `${key}=${value}`]);
      await dockerCommand({
        config,
        args: ["exec", "--workdir", "/workspace/source/website", ...envArgs, containerName, "npm", "run", script],
        cwd: jobRoot,
        homePath,
        signal,
        timeoutMs,
        label: `docker.${name}`,
        logger,
      });
      results.push({ name, ok: true, durationMs: Date.now() - startedAt, isolated: "docker", network: "denied", platform: "linux/amd64" });
    }

    // Stop the complete PID namespace before reading build output. This kills
    // background/double-fork mutators that escaped an individual npm process.
    await stopContainer({ config, containerName, jobRoot, homePath, logger });
    containerStopped = true;
    await dockerCommand({
      config,
      args: ["cp", `${containerName}:/workspace/source/website/dist/standalone`, exportRoot],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 5 * 60_000,
      label: "docker.export_artifact",
      logger,
    });
    const sourcePath = path.join(exportRoot, "standalone");
    artifactSeal = await sealExternalBuildArtifact({ config, sourcePath, trustedSourceRoot: exportRoot, ticketId, treeSha });
    return { verification: results, artifactSeal, imageId: imageInspection.Id, platform: "linux/amd64" };
  } catch (cause) {
    throw new RunnerError("Production Docker verification failed closed", {
      code: "DOCKER_VERIFICATION_FAILED",
      cause,
      retryable: false,
    });
  } finally {
    if (containerCreated && !containerStopped) await stopContainer({ config, containerName, jobRoot, homePath, logger });
    if (containerCreated) await removeContainer({ config, containerName, jobRoot, homePath, logger });
    await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export { FIXED_BUILD_ENV };
