import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { runCommand } from "./command.mjs";
import { verifySealedArtifact } from "./artifact-seal.mjs";
import { CommandError, PolicyError, PublishingUncertainError } from "./errors.mjs";
import { isPathInside } from "./sanitize.mjs";
import {
  buildVerificationProfile,
  createSandboxContext,
  sandboxArgv,
  verificationRuntimePaths,
} from "./seatbelt.mjs";

function baseTrustedEnv(additional = {}) {
  return {
    HOME: process.env.HOME || os.homedir(),
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin",
    LANG: process.env.LANG || "C.UTF-8",
    LC_ALL: process.env.LC_ALL || "C.UTF-8",
    TERM: "dumb",
    NO_COLOR: "1",
    CI: "1",
    ...additional,
  };
}

export async function runVerification({ config, worktreePath, ticketId, signal, logger }) {
  const results = [];
  const resolvedWorktree = await fs.realpath(worktreePath);
  for (const command of config.verifyCommands) {
    const cwd = path.resolve(resolvedWorktree, command.cwd);
    if (cwd !== resolvedWorktree && !isPathInside(resolvedWorktree, cwd)) {
      throw new PolicyError(`Verification cwd escaped worktree: ${command.name}`);
    }
    const executableName = path.basename(command.argv[0]);
    const isNpmInstall = executableName === "npm" && command.argv[1] === "ci";
    if (isNpmInstall) {
      for (const required of ["--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"]) {
        if (!command.argv.includes(required)) throw new PolicyError(`npm ci verification must include ${required}`);
      }
    }
    const sandbox = await createSandboxContext({
      stateDir: config.stateDir,
      prefix: `verify-${ticketId}-${command.name}`,
      profile: ({ tempPath }) => buildVerificationProfile({
        worktreePath: resolvedWorktree,
        tempPath,
        runtimePaths: [
          ...verificationRuntimePaths(process.env),
          ...(Array.isArray(config.verificationRuntimePaths) ? config.verificationRuntimePaths : []),
        ],
        // Dependency download is the sole network exception. Lint/build and
        // every other fixed verification command have no network capability.
        allowNetwork: isNpmInstall,
      }),
    });
    try {
      const env = baseTrustedEnv({
        ...config.verificationEnvironment,
        HOME: sandbox.homePath,
        TMPDIR: sandbox.tempPath,
        NPM_CONFIG_CACHE: path.join(sandbox.tempPath, "npm-cache"),
        NPM_CONFIG_USERCONFIG: path.join(sandbox.tempPath, "empty-user-npmrc"),
        NPM_CONFIG_GLOBALCONFIG: path.join(sandbox.tempPath, "empty-global-npmrc"),
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
        NPM_CONFIG_PRODUCTION: "false",
        NPM_CONFIG_UPDATE_NOTIFIER: "false",
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONPYCACHEPREFIX: path.join(sandbox.tempPath, "python-pycache"),
      });
      if (isNpmInstall) delete env.NODE_ENV;
      const result = await runCommand({
        argv: sandboxArgv(sandbox.profilePath, command.argv),
        cwd,
        env,
        timeoutMs: command.timeoutMs,
        signal,
        label: `verify.${command.name}`,
        logger,
      });
      results.push({ name: command.name, ok: true, durationMs: result.durationMs, sandboxed: true, network: isNpmInstall ? "install-only" : "denied" });
      logger.info("verification.passed", { ticketId, name: command.name, durationMs: result.durationMs, sandboxed: true, networkAllowed: isNpmInstall });
    } finally {
      await sandbox.cleanup();
    }
  }
  return results;
}

export async function validateDeployScript(config, worktreePath) {
  if (!config.deployScript) throw new PolicyError("No trusted deployment script is configured");
  if (!path.isAbsolute(config.deployScript)) throw new PolicyError("Deployment script path must be absolute");
  const lstat = await fs.lstat(config.deployScript);
  if (!lstat.isFile() || lstat.isSymbolicLink()) throw new PolicyError("Deployment script must be a regular non-symlink file");
  if ((lstat.mode & 0o111) === 0) throw new PolicyError("Deployment script is not executable");
  if ((lstat.mode & 0o022) !== 0) throw new PolicyError("Deployment script must not be group/world writable");
  const requiredOwnerUid = Number.isSafeInteger(config.requiredDeployOwnerUid) ? config.requiredDeployOwnerUid : lstat.uid;
  if (lstat.uid !== requiredOwnerUid) throw new PolicyError(`Deployment script must be owned by uid ${requiredOwnerUid}`);
  const requiredMode = Number.isSafeInteger(config.requiredDeployMode) ? config.requiredDeployMode : (lstat.mode & 0o777);
  if ((lstat.mode & 0o777) !== requiredMode) throw new PolicyError(`Deployment script must have mode ${requiredMode.toString(8)}`);
  const real = await fs.realpath(config.deployScript);
  if (config.requiredDeployScriptPath && real !== path.resolve(config.requiredDeployScriptPath)) {
    throw new PolicyError("Deployment script is not the fixed trusted wrapper");
  }
  if (real === path.resolve(worktreePath) || isPathInside(worktreePath, real)) {
    throw new PolicyError("Deployment script must be outside the agent worktree");
  }
  const pin = config.deployScriptPin;
  if (!pin || pin.realPath !== real || pin.uid !== lstat.uid || pin.dev !== lstat.dev || pin.ino !== lstat.ino || pin.mode !== lstat.mode) {
    throw new PolicyError("Deployment script identity changed after runner startup");
  }
  const digest = crypto.createHash("sha256").update(await fs.readFile(real)).digest("hex");
  if (digest !== pin.sha256) throw new PolicyError("Deployment script content changed after runner startup");
  return real;
}

export function deploymentFailureIsUncertain(cause, { signalAborted = false } = {}) {
  if (!(cause instanceof CommandError)) return false;
  const definiteNotDeployed = cause.exitCode === 3
    && /(?:^|\n)DEPLOYMENT_NOT_DEPLOYED(?:\n|$)/.test(`${cause.stdout}\n${cause.stderr}`);
  return signalAborted || !definiteNotDeployed;
}

export async function runDeploymentPreflight({
  config, worktreePath, ticketId, commitSha, artifactSeal, signal, logger,
}) {
  if (!config.prePushDeploymentValidation) return { ok: true, skipped: true, durationMs: 0 };
  if (!/^[a-f0-9]{40}$/.test(commitSha)) {
    throw new PolicyError("Deployment preflight requires a full commit SHA");
  }
  const script = await validateDeployScript(config, worktreePath);
  if (!artifactSeal) throw new PolicyError("A sealed build artifact is required for deployment preflight");
  await verifySealedArtifact(artifactSeal);
  const result = await runCommand({
    argv: [script, "--preflight", worktreePath, commitSha],
    cwd: config.repoRoot,
    env: baseTrustedEnv({
      ...config.deployEnvironment,
      TICKET_RUNNER_TICKET_ID: ticketId,
      TICKET_RUNNER_ARTIFACT_DIR: artifactSeal.artifactPath,
      TICKET_RUNNER_ARTIFACT_MANIFEST: artifactSeal.manifestPath,
      TICKET_RUNNER_ARTIFACT_SHA256: artifactSeal.manifestSha256,
      TICKET_RUNNER_PROJECT_KEY: config.projectKey || "residence",
    }),
    timeoutMs: config.deployTimeoutMs,
    signal,
    label: "deploy.prepush_server_validation",
    logger,
  });
  if (result.stdout !== "preflight-ok\n") {
    throw new PolicyError("Deployment preflight wrapper returned an invalid success response");
  }
  return { ok: true, skipped: false, durationMs: result.durationMs };
}

export async function runDeployment({ config, worktreePath, ticketId, commitSha, artifactSeal, signal, logger }) {
  const script = await validateDeployScript(config, worktreePath);
  if (!artifactSeal) throw new PolicyError("A sealed build artifact is required for deployment");
  await verifySealedArtifact(artifactSeal);
  let result;
  try {
    result = await runCommand({
      argv: [script, ...config.deployArgs],
      cwd: config.repoRoot,
      env: baseTrustedEnv({
        ...config.deployEnvironment,
        TICKET_RUNNER_COMMIT_SHA: commitSha,
        TICKET_RUNNER_TICKET_ID: ticketId,
        TICKET_RUNNER_WORKTREE: worktreePath,
        TICKET_RUNNER_ARTIFACT_DIR: artifactSeal.artifactPath,
        TICKET_RUNNER_ARTIFACT_MANIFEST: artifactSeal.manifestPath,
        TICKET_RUNNER_ARTIFACT_SHA256: artifactSeal.manifestSha256,
        TICKET_RUNNER_PROJECT_KEY: config.projectKey || "residence",
      }),
      timeoutMs: config.deployTimeoutMs,
      signal,
      label: "deploy.trusted_script",
      logger,
    });
  } catch (cause) {
    if (deploymentFailureIsUncertain(cause, { signalAborted: Boolean(signal?.aborted) })) {
      throw new PublishingUncertainError("Deployment transport ended before production state could be confirmed", { cause });
    }
    throw cause;
  }
  return { ok: true, durationMs: result.durationMs };
}

export async function queryDeploymentStatus({ config, worktreePath, commitSha, signal, logger }) {
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new PolicyError("Deployment status requires a full commit SHA");
  const script = await validateDeployScript(config, worktreePath);
  try {
    const result = await runCommand({
      argv: [script, "--status", commitSha],
      cwd: config.repoRoot,
      env: baseTrustedEnv({ TICKET_RUNNER_PROJECT_KEY: config.projectKey || "residence" }),
      timeoutMs: Math.min(config.deployTimeoutMs, 60_000),
      signal,
      label: "deploy.query_status",
      logger,
    });
    if (result.stdout.trim() !== "deployed") {
      throw new PublishingUncertainError("Deployment status wrapper returned an invalid success response");
    }
    return "deployed";
  } catch (cause) {
    if (cause instanceof CommandError && cause.exitCode === 3 && cause.stdout.trim() === "not-deployed") {
      return "not-deployed";
    }
    if (cause instanceof PublishingUncertainError) throw cause;
    throw new PublishingUncertainError("Production commit marker could not be queried authoritatively", { cause });
  }
}

export async function runSmokeChecks({ config, ticketId, signal, logger }) {
  const checks = [];
  const configuredChecks = Array.isArray(config.smokeChecks)
    ? config.smokeChecks
    : (config.smokeUrls || []).map((url) => ({ url, expectedStatuses: null }));
  for (const configured of configuredChecks) {
    const url = configured instanceof URL ? configured : configured.url;
    if (!(url instanceof URL)) throw new PolicyError("Production smoke check has no trusted URL");
    const expectedStatuses = Array.isArray(configured.expectedStatuses) ? configured.expectedStatuses : null;
    if (expectedStatuses && (expectedStatuses.length === 0
      || expectedStatuses.some((status) => !Number.isSafeInteger(status) || status < 100 || status > 599))) {
      throw new PolicyError("Production smoke check has invalid expected statuses");
    }
    const startedAt = Date.now();
    const timeout = AbortSignal.timeout(config.smokeTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: { Accept: "text/html,application/json;q=0.9,*/*;q=0.1", "User-Agent": "avalon-ticket-runner-smoke/0.1" },
        redirect: "manual",
        signal: combined,
      });
    } catch (cause) {
      throw new PolicyError(`Production smoke request failed for ${url.hostname}`, { cause });
    }
    if (response.body) await response.body.cancel();
    const durationMs = Date.now() - startedAt;
    const statusAccepted = expectedStatuses
      ? expectedStatuses.includes(response.status)
      : response.status >= 200 && response.status < 400;
    if (!statusAccepted) {
      throw new PolicyError(`Production smoke returned HTTP ${response.status} for ${url.hostname}`);
    }
    const check = { host: url.hostname, path: url.pathname, status: response.status, durationMs };
    checks.push(check);
    logger.info("smoke.passed", { ticketId, ...check });
  }
  return checks;
}

export { baseTrustedEnv };
