import fs from "node:fs/promises";
import path from "node:path";
import { sealExternalSourceArtifact } from "./artifact-seal.mjs";
import { runCommand } from "./command.mjs";
import { PolicyError, RunnerError } from "./errors.mjs";
import { isPathInside, safeSlug } from "./sanitize.mjs";
import { baseTrustedEnv, runVerification } from "./verification.mjs";

async function makePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

export async function runMarketMapVerification({
  config,
  gitWorkspace,
  worktreePath,
  treeSha,
  ticketId,
  signal,
  logger,
}) {
  if (!/^[a-f0-9]{40,64}$/.test(treeSha)) {
    throw new PolicyError("Market-map verification requires an exact staged tree id");
  }
  const artifactPaths = config.sourceArtifactPaths;
  const requiredPaths = config.sourceArtifactRequiredPaths;
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0
    || !Array.isArray(requiredPaths) || requiredPaths.length === 0) {
    throw new PolicyError("Market-map source artifact scope is unavailable");
  }

  const verification = await runVerification({ config, worktreePath, ticketId, signal, logger });
  const jobsRoot = path.join(path.resolve(config.stateDir), "source-artifact-jobs");
  await makePrivateDirectory(jobsRoot);
  const jobRoot = await fs.mkdtemp(path.join(jobsRoot, `${safeSlug(ticketId)}-`));
  await fs.chmod(jobRoot, 0o700);
  const archivePath = path.join(jobRoot, "source.tar");
  const exportRoot = path.join(jobRoot, "export");
  await makePrivateDirectory(exportRoot);
  if (!isPathInside(jobsRoot, archivePath) || !isPathInside(jobsRoot, exportRoot)) {
    throw new PolicyError("Market-map artifact job escaped its trusted root");
  }

  let artifactSeal = null;
  try {
    await gitWorkspace.exportTreeArchive({
      worktreePath,
      treeSha,
      destination: archivePath,
      paths: artifactPaths,
      signal,
    });
    await fs.chmod(archivePath, 0o600);
    await runCommand({
      argv: ["/usr/bin/tar", "-xf", archivePath, "-C", exportRoot],
      cwd: jobRoot,
      env: baseTrustedEnv(),
      timeoutMs: Math.min(config.commandTimeoutMs, 2 * 60_000),
      signal,
      label: "market-map.extract_verified_source",
      logger,
    });
    artifactSeal = await sealExternalSourceArtifact({
      config,
      sourcePath: exportRoot,
      trustedSourceRoot: jobRoot,
      ticketId,
      treeSha,
      allowedPaths: artifactPaths,
      requiredPaths,
    });
    return { verification, artifactSeal, platform: "platform-neutral-source" };
  } catch (cause) {
    throw new RunnerError("Market-map production verification failed closed", {
      code: "MARKET_MAP_VERIFICATION_FAILED",
      cause,
      retryable: false,
    });
  } finally {
    await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
  }
}
