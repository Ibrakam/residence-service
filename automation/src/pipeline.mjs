import { cleanupAttachmentDirectory, downloadAttachments } from "./attachments.mjs";
import { cleanupSealedArtifact } from "./artifact-seal.mjs";
import { runCodex } from "./codex-runner.mjs";
import { runDockerVerification } from "./docker-verification.mjs";
import { LeaseLostError, PublishingUncertainError, RunnerError } from "./errors.mjs";
import { safeError } from "./logger.mjs";
import { DEFAULT_PROJECT_KEY, normalizeProjectKey } from "./project-profiles.mjs";
import { safeExcerpt } from "./sanitize.mjs";
import {
  queryDeploymentStatus,
  runDeployment,
  runDeploymentPreflight,
  runSmokeChecks,
  runVerification,
} from "./verification.mjs";

const UNRESOLVED_PUBLICATION_PHASES = new Set([
  "committing",
  "committed",
  "pushing",
  "pushed",
  "deploying",
  "deployed",
  "production_smoke",
  "reporting_completion",
  "publish_reconciliation_required",
]);

class LeaseKeeper {
  constructor({ client, ticketId, leaseToken, config, logger, parentSignal }) {
    this.client = client;
    this.ticketId = ticketId;
    this.leaseToken = leaseToken;
    this.config = config;
    this.logger = logger;
    this.parentSignal = parentSignal;
    this.controller = new AbortController();
    this.phase = "leased";
    this.failures = 0;
    this.timer = null;
    this.inFlight = false;
  }

  get signal() {
    return this.parentSignal ? AbortSignal.any([this.parentSignal, this.controller.signal]) : this.controller.signal;
  }

  setPhase(phase) {
    this.phase = phase;
  }

  start() {
    this.timer = setInterval(() => void this.beat(), this.config.heartbeatIntervalMs);
    this.timer.unref();
  }

  async beat() {
    if (this.inFlight || this.signal.aborted) return;
    this.inFlight = true;
    try {
      await this.client.heartbeat(this.ticketId, this.leaseToken, this.phase, this.signal);
      this.failures = 0;
      this.logger.debug("lease.heartbeat", { ticketId: this.ticketId, phase: this.phase });
    } catch (error) {
      this.failures += 1;
      this.logger.warn("lease.heartbeat_failed", { ticketId: this.ticketId, phase: this.phase, failures: this.failures, error: safeError(error) });
      if (error instanceof LeaseLostError || this.failures >= this.config.maxHeartbeatFailures) {
        this.controller.abort(error instanceof LeaseLostError ? error : new LeaseLostError("Lease heartbeat failed repeatedly", { cause: error }));
      }
    } finally {
      this.inFlight = false;
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

async function bestEffortProgress(client, lease, phase, details, logger) {
  try {
    await client.progress(lease.ticket.id, lease.leaseToken, phase, details);
  } catch (error) {
    logger.warn("ticket.progress_failed", { ticketId: lease.ticket.id, phase, error: safeError(error) });
  }
}

function phaseState({
  ticket,
  phase,
  worktreePath,
  baseSha,
  threadId,
  commitSha,
  summary,
  pushed = false,
  deployed = false,
  pushRolledBack = false,
  rollbackError = null,
  artifactSeal = null,
  changedPaths = [],
  diffStat = "",
  verification = [],
  smoke = [],
  reconciliation = null,
}) {
  return {
    ticketId: ticket.id,
    attempt: ticket.attempt,
    projectKey: ticket.projectKey || DEFAULT_PROJECT_KEY,
    phase,
    worktreePath: worktreePath || "",
    baseSha: baseSha || "",
    threadId: threadId || "",
    commitSha: commitSha || "",
    pushed,
    deployed,
    pushRolledBack,
    rollbackError,
    artifactSeal,
    changedPaths,
    diffStat,
    verification,
    smoke,
    reconciliation,
    summary: summary ? safeExcerpt(summary, 4_000) : "",
  };
}

export async function assertNoUnresolvedPublications({
  config,
  stateStore,
  gitWorkspace,
  projectRegistry,
  logger,
  signal,
  deploymentStatusReader = queryDeploymentStatus,
}) {
  if (config.dryRun) return;
  const states = await stateStore.listTicketStates();
  const pending = states.filter((state) => UNRESOLVED_PUBLICATION_PHASES.has(state.phase));
  if (pending.length === 0) return;
  const observations = [];
  for (const state of pending) {
    let originMain = "unknown";
    let production = "unknown";
    let stateProjectKey = DEFAULT_PROJECT_KEY;
    let runtimeConfig = config;
    let runtimeWorkspace = gitWorkspace;
    try {
      stateProjectKey = normalizeProjectKey(state.projectKey);
      if (projectRegistry) {
        const runtime = projectRegistry.resolve(stateProjectKey);
        runtimeConfig = runtime.config;
        runtimeWorkspace = runtime.gitWorkspace;
      } else if (stateProjectKey !== DEFAULT_PROJECT_KEY) {
        throw new RunnerError(`Unresolved publication targets unavailable project profile: ${stateProjectKey}`, {
          code: "UNKNOWN_PROJECT_PROFILE",
        });
      }
    } catch (error) {
      observations.push({
        ticketId: state.ticketId,
        attempt: state.attempt,
        projectKey: stateProjectKey,
        phase: state.phase,
        originMain,
        production,
        profileError: safeError(error),
      });
      continue;
    }
    try {
      originMain = await runtimeWorkspace.resolveOriginMain(signal);
    } catch (error) {
      logger.warn("reconciliation.origin_unavailable", { ticketId: state.ticketId, error: safeError(error) });
    }
    if (/^[a-f0-9]{40}$/.test(state.commitSha || "") && state.worktreePath) {
      try {
        production = await deploymentStatusReader({
          config: runtimeConfig,
          worktreePath: state.worktreePath,
          commitSha: state.commitSha,
          signal,
          logger,
        });
      } catch (error) {
        logger.warn("reconciliation.production_unavailable", { ticketId: state.ticketId, error: safeError(error) });
      }
    }
    observations.push({ ticketId: state.ticketId, attempt: state.attempt, projectKey: stateProjectKey, phase: state.phase, originMain, production });
  }
  throw new PublishingUncertainError(`Unresolved publication checkpoint blocks new leases: ${JSON.stringify(observations)}`);
}

export async function processLease({
  lease,
  config,
  client,
  stateStore,
  gitWorkspace,
  projectRegistry,
  logger,
  shutdownSignal,
  productionVerifier = runDockerVerification,
}) {
  const { ticket: leasedTicket, leaseToken } = lease;
  let ticket = leasedTicket;
  const keeper = new LeaseKeeper({ client, ticketId: ticket.id, leaseToken, config, logger, parentSignal: shutdownSignal });
  let runtimeConfig = config;
  let runtimeWorkspace = gitWorkspace;
  let selectedProductionVerifier = productionVerifier;
  let previousState = null;
  let worktreePath = previousState?.worktreePath || "";
  let baseSha = previousState?.baseSha || "";
  let threadId = previousState?.threadId || "";
  let commitSha = "";
  let codexSummary = "";
  let attachmentsPrepared = false;
  let completed = false;
  let pushed = false;
  let deployed = false;
  let deploymentStarted = false;
  let pushRolledBack = false;
  let rollbackError = null;
  let artifactSeal = null;
  let changedPaths = [];
  let diffStat = "";
  let verification = [];
  let smoke = [];

  keeper.start();

  try {
    const projectKey = normalizeProjectKey(ticket.projectKey);
    if (projectRegistry) {
      const runtime = projectRegistry.resolve(projectKey);
      runtimeConfig = runtime.config;
      runtimeWorkspace = runtime.gitWorkspace;
      selectedProductionVerifier = runtime.productionVerifier;
      ticket = { ...ticket, projectKey: runtime.projectKey };
    } else {
      if (projectKey !== DEFAULT_PROJECT_KEY) {
        throw new RunnerError(`Ticket targets unavailable project profile: ${projectKey}`, {
          code: "UNKNOWN_PROJECT_PROFILE",
        });
      }
      ticket = { ...ticket, projectKey };
    }
    if (!runtimeWorkspace) throw new RunnerError("Ticket project workspace is unavailable", { code: "PROJECT_RUNTIME_UNAVAILABLE" });
    previousState = await stateStore.readTicket(ticket.id, ticket.attempt);
    worktreePath = previousState?.worktreePath || "";
    baseSha = previousState?.baseSha || "";
    threadId = previousState?.threadId || "";
    if (previousState) {
      const recordedProjectKey = normalizeProjectKey(previousState.projectKey);
      if (recordedProjectKey !== ticket.projectKey) {
        throw new RunnerError("Ticket project does not match its durable recovery checkpoint", {
          code: "PROJECT_CHECKPOINT_MISMATCH",
        });
      }
    }
    logger.info("ticket.started", {
      ticketId: ticket.id,
      attempt: ticket.attempt,
      projectKey: ticket.projectKey,
      attachmentCount: ticket.attachments.length,
    });
    keeper.setPhase("preparing_worktree");
    await bestEffortProgress(client, lease, "taken", { attempt: ticket.attempt }, logger);
    const prepared = await runtimeWorkspace.prepareWorktree(ticket, previousState, keeper.signal);
    worktreePath = prepared.worktreePath;
    baseSha = prepared.baseSha;
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({ ticket, phase: "worktree_ready", worktreePath, baseSha, threadId }));

    keeper.setPhase("downloading_attachments");
    await cleanupAttachmentDirectory(worktreePath);
    const downloaded = await downloadAttachments({ ticket, leaseToken, worktreePath, config: runtimeConfig, client, signal: keeper.signal, logger });
    attachmentsPrepared = true;

    keeper.setPhase("codex_running");
    await bestEffortProgress(client, lease, "in_progress", { stage: "diagnose_and_fix" }, logger);
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({ ticket, phase: "codex_running", worktreePath, baseSha, threadId }));
    const codex = await runCodex({
      config: runtimeConfig,
      ticket,
      worktreePath,
      attachments: downloaded.attachments,
      threadId,
      signal: keeper.signal,
      logger,
      onThreadId: async (newThreadId) => {
        threadId = newThreadId;
        await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({ ticket, phase: "codex_running", worktreePath, baseSha, threadId }));
      },
    });
    threadId = codex.threadId;
    codexSummary = codex.finalResponse;
    await cleanupAttachmentDirectory(worktreePath);
    attachmentsPrepared = false;

    keeper.setPhase("preflight");
    await bestEffortProgress(client, lease, "verifying", { stage: "security_preflight" }, logger);
    const preflight = await runtimeWorkspace.preflight({ worktreePath, baseSha, signal: keeper.signal });
    changedPaths = preflight.changedPaths;
    diffStat = preflight.diffStat;
    await runtimeWorkspace.cleanIgnoredArtifacts(worktreePath, keeper.signal);

    keeper.setPhase("verifying");
    if (runtimeConfig.dryRun) {
      await bestEffortProgress(client, lease, "verifying", { stage: "sandboxed_checks" }, logger);
      verification = await runVerification({ config: runtimeConfig, worktreePath, ticketId: ticket.id, signal: keeper.signal, logger });
    } else {
      await bestEffortProgress(client, lease, "verifying", {
        stage: runtimeConfig.productionVerificationStage || "production_linux_build",
      }, logger);
      const verified = await selectedProductionVerifier({
        config: runtimeConfig,
        gitWorkspace: runtimeWorkspace,
        worktreePath,
        treeSha: preflight.treeSha,
        ticketId: ticket.id,
        signal: keeper.signal,
        logger,
      });
      if (!verified?.artifactSeal || !Array.isArray(verified.verification)) {
        throw new RunnerError("Production verifier returned no sealed build artifact", {
          code: "INVALID_PRODUCTION_VERIFICATION",
          retryable: false,
        });
      }
      artifactSeal = verified.artifactSeal;
      verification = verified.verification;
    }

    keeper.setPhase("committing");
    if (!runtimeConfig.dryRun) {
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket,
        phase: "committing",
        worktreePath,
        baseSha,
        threadId,
        summary: codexSummary,
        artifactSeal,
        changedPaths: preflight.changedPaths,
        diffStat: preflight.diffStat,
        verification,
      }));
    }
    const committed = await runtimeWorkspace.inspectAndCommit({
      ticket,
      worktreePath,
      baseSha,
      expectedTreeSha: preflight.treeSha,
      signal: keeper.signal,
    });
    commitSha = committed.commitSha;
    changedPaths = committed.changedPaths;
    diffStat = committed.diffStat;
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
      ticket,
      phase: runtimeConfig.dryRun ? "dry_run_committed" : "committed",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: codexSummary,
      artifactSeal,
      changedPaths: committed.changedPaths,
      diffStat: committed.diffStat,
      verification,
    }));

    let deployment = { pushed: false, deployed: false, dryRun: runtimeConfig.dryRun };
    if (!runtimeConfig.dryRun) {
      if (runtimeConfig.prePushDeploymentValidation) {
        await bestEffortProgress(client, lease, "verifying", { stage: "production_server_preflight" }, logger);
        const deploymentPreflight = await runDeploymentPreflight({
          config: runtimeConfig,
          worktreePath,
          ticketId: ticket.id,
          commitSha,
          artifactSeal,
          signal: keeper.signal,
          logger,
        });
        verification.push({
          name: "production-server-preflight",
          ok: true,
          durationMs: deploymentPreflight.durationMs,
          sandboxed: false,
          network: "fixed-forced-command-ssh",
        });
      }
      keeper.setPhase("pushing");
      await bestEffortProgress(client, lease, "publishing", { stage: "push" }, logger);
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket, phase: "pushing", worktreePath, baseSha, threadId, commitSha,
        summary: codexSummary, artifactSeal, changedPaths: committed.changedPaths,
        diffStat: committed.diffStat, verification,
      }));
      await runtimeWorkspace.safePush({ worktreePath, baseSha, commitSha, signal: keeper.signal });
      pushed = true;
      deployment.pushed = true;
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket, phase: "pushed", worktreePath, baseSha, threadId, commitSha,
        summary: codexSummary, pushed, artifactSeal, changedPaths: committed.changedPaths,
        diffStat: committed.diffStat, verification,
      }));

      keeper.setPhase("deploying");
      deploymentStarted = true;
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket, phase: "deploying", worktreePath, baseSha, threadId, commitSha,
        summary: codexSummary, pushed, artifactSeal, changedPaths: committed.changedPaths,
        diffStat: committed.diffStat, verification,
      }));
      const deploymentResult = await runDeployment({
        config: runtimeConfig,
        worktreePath,
        ticketId: ticket.id,
        commitSha,
        artifactSeal,
        signal: keeper.signal,
        logger,
      });
      deployment = { ...deployment, deployed: true, deployDurationMs: deploymentResult.durationMs };
      deployed = true;
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket, phase: "deployed", worktreePath, baseSha, threadId, commitSha,
        summary: codexSummary, pushed, deployed, artifactSeal,
        changedPaths: committed.changedPaths, diffStat: committed.diffStat, verification,
      }));

      keeper.setPhase("production_smoke");
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket, phase: "production_smoke", worktreePath, baseSha, threadId, commitSha,
        summary: codexSummary, pushed, deployed, artifactSeal,
        changedPaths: committed.changedPaths, diffStat: committed.diffStat, verification,
      }));
      smoke = await runSmokeChecks({ config: runtimeConfig, ticketId: ticket.id, signal: keeper.signal, logger });
    }

    const result = {
      outcome: runtimeConfig.dryRun ? "dry_run" : "published",
      projectKey: ticket.projectKey,
      productionUrl: runtimeConfig.productionPublicUrl?.toString() || "",
      summary: safeExcerpt(codexSummary || committed.diffStat || "Ticket fix completed", 4_000),
      threadId,
      baseSha,
      commitSha,
      changedPaths: committed.changedPaths,
      diffStat: committed.diffStat,
      verification,
      deployment,
      smoke,
    };
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
      ticket,
      phase: runtimeConfig.dryRun ? "reporting_dry_run" : "reporting_completion",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: result.summary,
      pushed,
      deployed,
      artifactSeal,
      changedPaths: committed.changedPaths,
      diffStat: committed.diffStat,
      verification,
      smoke,
    }));
    try {
      await client.complete(ticket.id, leaseToken, result);
    } catch (cause) {
      if (!runtimeConfig.dryRun && deployed) {
        throw new PublishingUncertainError("Production was deployed but ticket completion acknowledgement is unknown", { cause });
      }
      throw cause;
    }
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
      ticket,
      phase: runtimeConfig.dryRun ? "dry_run_complete" : "complete",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: result.summary,
      pushed,
      deployed,
      changedPaths: committed.changedPaths,
      diffStat: committed.diffStat,
      verification,
      smoke,
    }));
    completed = true;
    logger.info("ticket.completed", { ticketId: ticket.id, projectKey: ticket.projectKey, outcome: result.outcome, commitSha, changedFileCount: committed.changedPaths.length });
    // Publication and acknowledgement are already durably complete. Cleanup is
    // intentionally best-effort: a transient filesystem/Git failure must never
    // rewrite an accepted production ticket back to `failed` or report failure
    // to the control plane after it has received `complete`.
    if (!runtimeConfig.keepSuccessfulWorktrees) {
      await runtimeWorkspace.removeWorktree(worktreePath).catch((cleanupError) => {
        logger.warn("worktree.cleanup_failed_after_complete", { ticketId: ticket.id, error: safeError(cleanupError) });
      });
    }
    await cleanupSealedArtifact(artifactSeal).catch((cleanupError) => {
      logger.warn("artifact.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
    });
    return result;
  } catch (caught) {
    const error = caught instanceof PublishingUncertainError
      ? caught
      : keeper.signal.aborted && keeper.signal.reason instanceof Error
        ? keeper.signal.reason
        : caught;
    let reconciliationRequired = error instanceof PublishingUncertainError || (deployed && !completed);
    // Once source main moved, every definite pre-deploy or not-deployed
    // failure must restore it. This also covers a durable-checkpoint failure
    // immediately after safePush, before deploymentStarted becomes true.
    if (pushed && !deployed && !reconciliationRequired) {
      try {
        const rollbackSignal = AbortSignal.timeout(runtimeConfig.commandTimeoutMs);
        await runtimeWorkspace.rollbackPush({ worktreePath, baseSha, commitSha, signal: rollbackSignal });
        pushRolledBack = true;
        logger.warn("push.rolled_back", { ticketId: ticket.id, commitSha, baseSha });
      } catch (rollbackCaught) {
        rollbackError = safeError(rollbackCaught);
        reconciliationRequired = true;
        logger.error("push.rollback_failed", { ticketId: ticket.id, commitSha, baseSha, error: rollbackError });
      }
    }
    if (attachmentsPrepared && worktreePath) {
      await cleanupAttachmentDirectory(worktreePath).catch((cleanupError) => {
        logger.warn("attachment.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
      });
    }
    const report = {
      outcome: "failed",
      projectKey: ticket.projectKey || DEFAULT_PROJECT_KEY,
      error: safeError(error),
      threadId,
      baseSha,
      commitSha,
      pushed,
      deployed,
      pushRolledBack,
      rollbackError,
      changedPaths,
      diffStat,
      verification,
    };
    try {
      await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
        ticket,
        phase: reconciliationRequired ? "publish_reconciliation_required" : "failed",
        worktreePath,
        baseSha,
        threadId,
        commitSha,
        summary: report.error.message,
        pushed,
        deployed,
        pushRolledBack,
        rollbackError,
        artifactSeal,
        changedPaths,
        diffStat,
        verification,
        reconciliation: reconciliationRequired ? { required: true, reason: report.error.code || "unknown" } : null,
      }));
    } catch (checkpointCaught) {
      reconciliationRequired = true;
      report.checkpointError = safeError(checkpointCaught);
      logger.error("ticket.terminal_checkpoint_failed", { ticketId: ticket.id, error: report.checkpointError });
    }
    if (!reconciliationRequired && !(error instanceof LeaseLostError) && !shutdownSignal?.aborted) {
      await client.fail(ticket.id, leaseToken, report).catch((reportError) => {
        logger.error("ticket.failure_report_failed", { ticketId: ticket.id, error: safeError(reportError) });
      });
    }
    if (reconciliationRequired) {
      await bestEffortProgress(client, lease, "publishing", { stage: "operator_reconciliation_required" }, logger);
    }
    logger.error("ticket.failed", { ticketId: ticket.id, projectKey: ticket.projectKey || "unknown", error: safeError(error), reconciliationRequired, worktreeRetained: Boolean(worktreePath && runtimeConfig.keepFailedWorktrees) });
    if (worktreePath && !runtimeConfig.keepFailedWorktrees && !reconciliationRequired) {
      await runtimeWorkspace.removeWorktree(worktreePath).catch((cleanupError) => {
        logger.warn("worktree.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
      });
    }
    if (!reconciliationRequired) {
      await cleanupSealedArtifact(artifactSeal).catch((cleanupError) => {
        logger.warn("artifact.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
      });
    }
    return { ...report, haltWorker: reconciliationRequired };
  } finally {
    keeper.stop();
    if (!completed && keeper.signal.aborted && !shutdownSignal?.aborted) {
      logger.warn("ticket.lease_aborted", { ticketId: ticket.id });
    }
  }
}

export async function runWorker({ config, client, stateStore, gitWorkspace, projectRegistry, logger, shutdownSignal }) {
  await assertNoUnresolvedPublications({ config, stateStore, gitWorkspace, projectRegistry, logger, signal: shutdownSignal });
  let consecutiveLeaseFailures = 0;
  while (!shutdownSignal.aborted) {
    let lease;
    try {
      lease = await client.lease(shutdownSignal);
      consecutiveLeaseFailures = 0;
    } catch (error) {
      consecutiveLeaseFailures += 1;
      logger.error("lease.request_failed", { failures: consecutiveLeaseFailures, error: safeError(error) });
      if (config.once) throw error;
      const delay = Math.min(60_000, config.pollIntervalMs * (2 ** Math.min(consecutiveLeaseFailures, 5)));
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (!lease) {
      if (config.once) return;
      await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
      continue;
    }
    const result = await processLease({ lease, config, client, stateStore, gitWorkspace, projectRegistry, logger, shutdownSignal });
    if (result?.haltWorker) {
      throw new PublishingUncertainError("Runner stopped before leasing another ticket because publication reconciliation is required");
    }
  }
}
