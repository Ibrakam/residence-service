import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealExternalSourceArtifact } from "./artifact-seal.mjs";
import { runCommand } from "./command.mjs";
import { CommandError, PolicyError, RunnerError } from "./errors.mjs";
import { isPathInside, safeExcerpt, safeSlug } from "./sanitize.mjs";
import { baseTrustedEnv, runVerification, validateDeployScript } from "./verification.mjs";

async function makePrivateDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

const HTML_VALIDATOR = fileURLToPath(new URL("../deploy/validate-market-map-html.py", import.meta.url));
const MARKET_MAP_POLICY_PROTOCOL = "v1";
const INLINE_SCRIPT_SYNTAX_CHECK = String.raw`const fs=require("node:fs"),vm=require("node:vm");const filename=process.argv[1];new vm.Script(fs.readFileSync(filename,"utf8"),{filename});`;

async function readValidatorSnapshot() {
  let handle;
  try {
    handle = await fs.open(HTML_VALIDATOR, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new PolicyError("Market-map HTML validator must be a regular file");
    return await handle.readFile();
  } catch (cause) {
    if (cause instanceof PolicyError) throw cause;
    throw new PolicyError("Market-map HTML validator could not be snapshotted safely", { cause });
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function queryRemoteMarketMapPolicy({ config, worktreePath, signal, logger }) {
  if (config.projectKey !== "market-map") {
    throw new PolicyError("Market-map server policy query requires the exact market-map project identity");
  }
  const script = await validateDeployScript(config, worktreePath);
  let result;
  try {
    result = await runCommand({
      argv: [script, "--policy-version"],
      cwd: config.repoRoot,
      env: baseTrustedEnv({ TICKET_RUNNER_PROJECT_KEY: config.projectKey }),
      timeoutMs: Math.min(config.deployTimeoutMs, 60_000),
      signal,
      label: "market-map.verify_remote_policy",
      logger,
    });
  } catch (cause) {
    if (cause instanceof CommandError && !cause.timedOut && !signal?.aborted) {
      throw new PolicyError("Market-map server policy could not be verified before publication", { cause });
    }
    throw cause;
  }
  const match = /^market-map-policy v1 ([0-9a-f]{64}) yandex-key-(present|unavailable)\n$/.exec(result.stdout);
  if (match === null || result.stderr !== "") {
    throw new PolicyError("Market-map server policy response was malformed");
  }
  return {
    protocol: MARKET_MAP_POLICY_PROTOCOL,
    validatorSha256: match[1],
    yandexKeyPresent: match[2] === "present",
    durationMs: result.durationMs,
  };
}

export async function runMarketMapVerification({
  config,
  gitWorkspace,
  worktreePath,
  treeSha,
  ticketId,
  signal,
  logger,
  remotePolicyVerifier = queryRemoteMarketMapPolicy,
}) {
  if (!/^[a-f0-9]{40,64}$/.test(treeSha)) {
    throw new PolicyError("Market-map verification requires an exact staged tree id");
  }
  if (typeof config.marketMapPythonBin !== "string" || !path.isAbsolute(config.marketMapPythonBin)) {
    throw new PolicyError("Market-map HTML validator runtime is unavailable");
  }
  if (config.projectKey !== "market-map") {
    throw new PolicyError("Market-map verification requires the exact market-map project identity");
  }
  const artifactPaths = config.sourceArtifactPaths;
  const requiredPaths = config.sourceArtifactRequiredPaths;
  if (!Array.isArray(artifactPaths) || artifactPaths.length === 0
    || !Array.isArray(requiredPaths) || requiredPaths.length === 0) {
    throw new PolicyError("Market-map source artifact scope is unavailable");
  }

  const jobsRoot = path.join(path.resolve(config.stateDir), "source-artifact-jobs");
  await makePrivateDirectory(jobsRoot);
  const jobRoot = await fs.mkdtemp(path.join(jobsRoot, `${safeSlug(ticketId)}-`));
  await fs.chmod(jobRoot, 0o700);
  const archivePath = path.join(jobRoot, "source.tar");
  const exportRoot = path.join(jobRoot, "export");
  const inlineRoot = path.join(jobRoot, "inline-scripts");
  const validatorSnapshot = path.join(jobRoot, "validate-market-map-html.py");
  await makePrivateDirectory(exportRoot);
  await makePrivateDirectory(inlineRoot);
  if (!isPathInside(jobsRoot, archivePath) || !isPathInside(jobsRoot, exportRoot)
    || !isPathInside(jobsRoot, inlineRoot) || !isPathInside(jobsRoot, validatorSnapshot)) {
    throw new PolicyError("Market-map artifact job escaped its trusted root");
  }

  let artifactSeal = null;
  try {
    const validatorBytes = await readValidatorSnapshot();
    const validatorDigest = crypto.createHash("sha256").update(validatorBytes).digest("hex");
    await fs.writeFile(validatorSnapshot, validatorBytes, { flag: "wx", mode: 0o400 });
    await fs.chmod(validatorSnapshot, 0o400);
    const remotePolicy = await remotePolicyVerifier({ config, worktreePath, ticketId, signal, logger });
    if (!remotePolicy || remotePolicy.protocol !== MARKET_MAP_POLICY_PROTOCOL
      || !/^[0-9a-f]{64}$/.test(remotePolicy.validatorSha256 || "")
      || typeof remotePolicy.yandexKeyPresent !== "boolean"
      || !Number.isFinite(remotePolicy.durationMs) || remotePolicy.durationMs < 0) {
      throw new PolicyError("Market-map remote policy verifier returned an invalid result");
    }
    if (remotePolicy.validatorSha256 !== validatorDigest) {
      throw new PolicyError("Market-map server policy differs from the runner policy; synchronize operator deployment files before publication");
    }
    const verification = [{
      name: "market-map-server-policy",
      ok: true,
      durationMs: remotePolicy.durationMs,
      sandboxed: false,
      network: "fixed-forced-command-ssh",
    }, ...await runVerification({ config, worktreePath, ticketId, signal, logger })];
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
    try {
      const providerResult = await runCommand({
        argv: [
          config.marketMapPythonBin,
          validatorSnapshot,
          "--extract-inline",
          path.join(exportRoot, "leadora_carto_map.html"),
          inlineRoot,
        ],
        cwd: jobRoot,
        env: baseTrustedEnv({ PYTHONDONTWRITEBYTECODE: "1" }),
        timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
        signal,
        label: "market-map.validate_html_provider",
        logger,
      });
      if (providerResult.stderr !== ""
        || !["leaflet\n", "yandex-maps-js-2.1\n"].includes(providerResult.stdout)) {
        throw new PolicyError("Market-map HTML validator returned an invalid provider result");
      }
      if (providerResult.stdout === "yandex-maps-js-2.1\n" && !remotePolicy.yandexKeyPresent) {
        throw new PolicyError("Market-map Yandex Maps API key is not provisioned on the production server; publication was stopped before commit");
      }
    } catch (cause) {
      if (cause instanceof CommandError && !cause.timedOut && !signal?.aborted) {
        const detail = safeExcerpt(cause.stderr, 600) || "HTML provider contract was rejected";
        throw new PolicyError(`Market-map HTML provider validation failed: ${detail}`, { cause });
      }
      throw cause;
    }
    const inlineFiles = await fs.readdir(inlineRoot, { withFileTypes: true });
    if (inlineFiles.length === 0 || inlineFiles.some((entry) => !entry.isFile() || !/^inline-[0-9]{4}\.js$/.test(entry.name))) {
      throw new PolicyError("Market-map HTML validator returned an unsafe inline-script set");
    }
    for (const entry of inlineFiles.sort((left, right) => left.name.localeCompare(right.name))) {
      try {
        const result = await runCommand({
          argv: [process.execPath, "-e", INLINE_SCRIPT_SYNTAX_CHECK, path.join(inlineRoot, entry.name)],
          cwd: jobRoot,
          env: baseTrustedEnv(),
          timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
          signal,
          label: "market-map.validate_inline_javascript",
          logger,
        });
        verification.push({
          name: `market-map-inline-js-syntax-${entry.name}`,
          ok: true,
          durationMs: result.durationMs,
          sandboxed: false,
          network: "not-applicable-syntax-only",
        });
      } catch (cause) {
        if (cause instanceof CommandError && !cause.timedOut && !signal?.aborted) {
          throw new PolicyError(`Market-map inline JavaScript has invalid syntax: ${entry.name}`, { cause });
        }
        throw cause;
      }
    }
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
    if (cause instanceof PolicyError) throw cause;
    throw new RunnerError("Market-map production verification failed closed", {
      code: "MARKET_MAP_VERIFICATION_FAILED",
      cause,
      retryable: false,
    });
  } finally {
    await fs.rm(jobRoot, { recursive: true, force: true }).catch(() => {});
  }
}
