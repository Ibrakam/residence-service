import crypto from "node:crypto";
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

const FIXED_NPM_CI_ARGS = ["npm", "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"];

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

export function buildDockerCreateArgs(config, containerName, volumeName) {
  return [
    "create",
    "--name", containerName,
    "--platform", config.dockerPlatform,
    "--network", "bridge",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges:true",
    "--pids-limit", String(config.dockerPidsLimit || 1_024),
    "--memory", config.dockerMemory || "4g",
    "--cpus", config.dockerCpus || "3",
    "--read-only",
    "--user", "1000:1000",
    // Keep the configured workdir at the already-owned volume root. Docker
    // otherwise pre-creates /workspace/source/website as root before uid 1000
    // can stream the source archive into the volume.
    "--workdir", "/workspace",
    "--mount", `type=volume,source=${volumeName},target=/workspace,volume-nocopy`,
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=1073741824,mode=1777",
    "--tmpfs", "/home/node/.npm:rw,nosuid,nodev,size=1073741824,mode=0700,uid=1000,gid=1000",
    "--stop-timeout", "5",
    "--entrypoint", "/usr/bin/sleep",
    config.dockerChildImage,
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

export function assertHardenedContainerInspect(inspect, config, {
  volumeName,
  expectedNetworkMode = "bridge",
  workspaceReadOnly = false,
} = {}) {
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
  if (host.NetworkMode !== expectedNetworkMode && !(expectedNetworkMode === "bridge" && host.NetworkMode === "default")) {
    throw new PolicyError("Verifier container has an unexpected network mode");
  }
  if (inspect.Config?.User !== "1000:1000") throw new PolicyError("Verifier container is not running as the unprivileged node uid");
  if (inspect.Platform && inspect.Platform !== "linux") throw new PolicyError("Verifier container is not Linux");
  const image = String(inspect.Image || "");
  if (!image.startsWith("sha256:")) throw new PolicyError("Verifier container image did not resolve to an immutable image id");
  if (!/^linux\/(?:arm64|amd64)$/.test(config.dockerPlatform)
    || config.dockerArchitecture !== config.dockerPlatform.slice("linux/".length)) {
    throw new PolicyError("Production verifier platform is not the reviewed native Linux host mapping");
  }
  if (image !== config.dockerExpectedImageId) {
    throw new PolicyError("Verifier container did not resolve to the reviewed child image id");
  }
  const workspaceMount = Array.isArray(inspect.Mounts)
    ? inspect.Mounts.find((mount) => mount.Destination === "/workspace")
    : null;
  if (!workspaceMount || workspaceMount.Type !== "volume" || workspaceMount.Name !== volumeName
    || workspaceMount.RW !== !workspaceReadOnly) {
    throw new PolicyError("Verifier workspace is not the expected runner-owned Docker volume");
  }
}

export function assertRunnerVolumeInspect(inspect, volumeName, ticketLabel) {
  if (!inspect || inspect.Name !== volumeName || inspect.Scope !== "local"
    || inspect.Labels?.["com.tencorp.ticket-runner"] !== "true"
    || inspect.Labels?.["com.tencorp.ticket"] !== ticketLabel) {
    throw new PolicyError("Docker workspace volume identity or labels are invalid");
  }
}

export function assertContainerStoppedInspect(inspect) {
  if (!inspect || inspect.State?.Running !== false) {
    throw new PolicyError("Verifier container shutdown could not be confirmed before artifact export");
  }
}

export async function assertPinnedDockerCli(config) {
  const pin = config.dockerBinPin;
  if (!pin) throw new PolicyError("Pinned Docker CLI identity is unavailable");
  const linkStat = await fs.lstat(pin.configuredPath);
  const realPath = await fs.realpath(pin.configuredPath);
  const stat = await fs.stat(realPath);
  if (linkStat.dev !== pin.linkDev || linkStat.ino !== pin.linkIno || linkStat.mode !== pin.linkMode
    || realPath !== pin.realPath || !stat.isFile() || (stat.mode & 0o111) === 0
    || stat.uid !== pin.uid || stat.dev !== pin.dev || stat.ino !== pin.ino || stat.mode !== pin.mode
    || (stat.mode & 0o022) !== 0) {
    throw new PolicyError("Docker CLI identity or permissions changed after runner startup");
  }
  const digest = crypto.createHash("sha256").update(await fs.readFile(realPath)).digest("hex");
  if (digest !== pin.sha256) throw new PolicyError("Docker CLI content changed after runner startup");
  return realPath;
}

async function dockerCommand({ config, args, cwd, homePath, signal, timeoutMs, label, logger, captureLimit, inputFile }) {
  return runCommand({
    argv: [config.dockerBin, ...args],
    cwd,
    env: dockerEnv(homePath),
    signal,
    timeoutMs: timeoutMs || config.commandTimeoutMs,
    label,
    logger,
    captureLimit,
    inputFile,
  });
}

async function removeVolume({ config, volumeName, jobRoot, homePath, logger }) {
  await dockerCommand({
    config,
    args: ["volume", "rm", volumeName],
    cwd: jobRoot,
    homePath,
    signal: AbortSignal.timeout(30_000),
    timeoutMs: 30_000,
    label: "docker.remove_verifier_volume",
    logger,
  }).catch((error) => logger?.warn("docker.volume_cleanup_failed", { error: safeError(error) }));
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
  const inspection = parseInspect((await dockerCommand({
    config,
    args: ["inspect", containerName],
    cwd: jobRoot,
    homePath,
    signal: AbortSignal.timeout(20_000),
    timeoutMs: 20_000,
    label: "docker.confirm_verifier_stopped",
    logger,
  })).stdout, "docker inspect after stop");
  assertContainerStoppedInspect(inspection);
}

async function removeContainer({ config, containerName, jobRoot, homePath, logger, suppressMissing = false }) {
  await dockerCommand({
    config,
    args: ["rm", "--force", "--volumes", containerName],
    cwd: jobRoot,
    homePath,
    signal: AbortSignal.timeout(30_000),
    timeoutMs: 30_000,
    label: "docker.remove_verifier",
    logger,
  }).catch((error) => {
    if (suppressMissing && /no such container/i.test(`${error?.stderr || ""} ${error?.message || ""}`)) return;
    logger?.warn("docker.cleanup_failed", { error: safeError(error) });
  });
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
  await assertPinnedDockerCli(config);
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
  const uniqueName = `${safeSlug(ticketId)}-${process.pid}-${Date.now()}`.toLowerCase().slice(0, 80);
  const ticketLabel = safeSlug(ticketId).toLowerCase();
  const containerName = `avalon-ticket-${uniqueName}`;
  const initContainerName = `avalon-ticket-init-${uniqueName}`;
  const exporterName = `avalon-ticket-export-${uniqueName}`;
  const volumeName = `avalon-ticket-workspace-${uniqueName}`;
  let volumeCreated = false;
  let containerCreated = false;
  let containerStopped = false;
  let exporterCreated = false;
  let artifactSeal = null;
  const results = [];
  try {
    await gitWorkspace.exportTreeArchive({ worktreePath, treeSha, destination: archivePath, signal });
    await fs.chmod(archivePath, 0o600);

    let indexManifest;
    try {
      indexManifest = JSON.parse((await dockerCommand({
        config,
        args: ["manifest", "inspect", config.dockerImage],
        cwd: jobRoot,
        homePath,
        signal,
        timeoutMs: 60_000,
        label: "docker.inspect_pinned_index_manifest",
        logger,
      })).stdout);
    } catch (cause) {
      throw new RunnerError("Could not read the reviewed OCI index manifest", {
        code: "DOCKER_INVALID_RESPONSE",
        cause,
      });
    }
    const expectedChildDigest = config.dockerChildImage.split("@").at(-1);
    const matchingDescriptors = Array.isArray(indexManifest?.manifests)
      ? indexManifest.manifests.filter((descriptor) => descriptor?.platform?.os === "linux"
        && descriptor?.platform?.architecture === config.dockerArchitecture)
      : [];
    if (matchingDescriptors.length !== 1 || matchingDescriptors[0].digest !== expectedChildDigest) {
      throw new PolicyError("Reviewed OCI index does not map the native platform to the pinned child manifest");
    }

    const childInspection = parseInspect((await dockerCommand({
      config,
      args: ["image", "inspect", "--platform", config.dockerPlatform, config.dockerChildImage],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.inspect_pinned_child_image",
      logger,
    })).stdout, "docker child image inspect");
    if (childInspection.Architecture !== config.dockerArchitecture || childInspection.Os !== "linux"
      || childInspection.Id !== config.dockerExpectedImageId) {
      throw new PolicyError("Pinned verifier child manifest does not match the reviewed architecture and image id");
    }
    if (!Array.isArray(childInspection.RepoDigests)
      || !childInspection.RepoDigests.includes(config.dockerChildImage.replace(/^docker\.io\/library\//, ""))) {
      throw new PolicyError("Local verifier child image does not match the reviewed child manifest digest");
    }

    const createdVolume = (await dockerCommand({
      config,
      args: [
        "volume", "create",
        "--label", "com.tencorp.ticket-runner=true",
        "--label", `com.tencorp.ticket=${ticketLabel}`,
        volumeName,
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.create_verifier_volume",
      logger,
    })).stdout.trim();
    if (createdVolume !== volumeName) throw new PolicyError("Docker created an unexpected workspace volume");
    volumeCreated = true;
    const volumeInspection = parseInspect((await dockerCommand({
      config,
      args: ["volume", "inspect", volumeName],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.inspect_verifier_volume",
      logger,
    })).stdout, "docker volume inspect");
    assertRunnerVolumeInspect(volumeInspection, volumeName, ticketLabel);

    await dockerCommand({
      config,
      args: [
        "run", "--rm", "--name", initContainerName,
        "--platform", config.dockerPlatform,
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--cap-add", "CHOWN",
        "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64",
        "--memory", "128m",
        "--cpus", "1",
        "--user", "0:0",
        "--mount", `type=volume,source=${volumeName},target=/workspace,volume-nocopy`,
        "--entrypoint", "/bin/sh",
        config.dockerChildImage,
        "-eu", "-c", "chmod 0700 /workspace && chown 1000:1000 /workspace",
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 60_000,
      label: "docker.initialize_verifier_volume",
      logger,
    });

    await dockerCommand({
      config,
      args: buildDockerCreateArgs(config, containerName, volumeName),
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
    assertHardenedContainerInspect(containerInspection, config, { volumeName });

    await dockerCommand({ config, args: ["start", containerName], cwd: jobRoot, homePath, signal, timeoutMs: 30_000, label: "docker.start_verifier", logger });
    await dockerCommand({
      config,
      args: [
        "exec", "--interactive", containerName,
        "/bin/sh", "-eu", "-c",
        "mkdir -p /workspace/source && tar --extract --file=- --directory=/workspace/source --no-same-owner --no-same-permissions --delay-directory-restore",
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 60_000,
      label: "docker.stream_source",
      logger,
      inputFile: archivePath,
    });

    const installStartedAt = Date.now();
    await dockerCommand({
      config,
      args: [
        "exec", "--workdir", "/workspace/source/website",
        "--env", "HOME=/tmp/home", "--env", "CI=1", "--env", "NPM_CONFIG_CACHE=/tmp/npm-cache",
        "--env", "NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc", "--env", "NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc",
        containerName, ...FIXED_NPM_CI_ARGS,
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 15 * 60_000,
      label: "docker.website_install",
      logger,
    });
    results.push({ name: "website-install", ok: true, durationMs: Date.now() - installStartedAt, isolated: "docker", network: "install-only", platform: config.dockerPlatform });

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
      results.push({ name, ok: true, durationMs: Date.now() - startedAt, isolated: "docker", network: "denied", platform: config.dockerPlatform });
    }

    // Stop the complete PID namespace before reading build output. This kills
    // background/double-fork mutators that escaped an individual npm process.
    await stopContainer({ config, containerName, jobRoot, homePath, logger });
    containerStopped = true;
    await dockerCommand({
      config,
      args: [
        "create", "--name", exporterName,
        "--platform", config.dockerPlatform,
        "--network", "none",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges:true",
        "--pids-limit", "64",
        "--memory", "256m",
        "--cpus", "1",
        "--user", "1000:1000",
        "--mount", `type=volume,source=${volumeName},target=/workspace,readonly,volume-nocopy`,
        "--tmpfs", "/tmp:rw,nosuid,nodev,size=67108864,mode=1777",
        "--entrypoint", "/usr/bin/sleep",
        config.dockerChildImage,
        "infinity",
      ],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 60_000,
      label: "docker.create_exporter",
      logger,
    });
    exporterCreated = true;
    const exporterInspection = parseInspect((await dockerCommand({
      config,
      args: ["inspect", exporterName],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 30_000,
      label: "docker.inspect_exporter",
      logger,
    })).stdout, "docker exporter inspect");
    assertHardenedContainerInspect(exporterInspection, config, {
      volumeName,
      expectedNetworkMode: "none",
      workspaceReadOnly: true,
    });
    await dockerCommand({ config, args: ["start", exporterName], cwd: jobRoot, homePath, signal, timeoutMs: 30_000, label: "docker.start_exporter", logger });
    await dockerCommand({
      config,
      args: ["cp", `${exporterName}:/workspace/source/website/dist/standalone`, exportRoot],
      cwd: jobRoot,
      homePath,
      signal,
      timeoutMs: 5 * 60_000,
      label: "docker.export_artifact",
      logger,
    });
    const sourcePath = path.join(exportRoot, "standalone");
    artifactSeal = await sealExternalBuildArtifact({ config, sourcePath, trustedSourceRoot: exportRoot, ticketId, treeSha });
    return {
      verification: results,
      artifactSeal,
      imageId: childInspection.Id,
      imageIndex: config.dockerImage,
      imageChild: config.dockerChildImage,
      platform: config.dockerPlatform,
    };
  } catch (cause) {
    throw new RunnerError("Production Docker verification failed closed", {
      code: "DOCKER_VERIFICATION_FAILED",
      cause,
      retryable: false,
    });
  } finally {
    if (containerCreated && !containerStopped) await stopContainer({ config, containerName, jobRoot, homePath, logger });
    if (exporterCreated) await removeContainer({ config, containerName: exporterName, jobRoot, homePath, logger });
    if (containerCreated) await removeContainer({ config, containerName, jobRoot, homePath, logger });
    await removeContainer({ config, containerName: initContainerName, jobRoot, homePath, logger, suppressMissing: true });
    if (volumeCreated) await removeVolume({ config, volumeName, jobRoot, homePath, logger });
    await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export { FIXED_BUILD_ENV, FIXED_NPM_CI_ARGS };
