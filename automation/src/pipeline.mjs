import { cleanupAttachmentDirectory, downloadAttachments } from "./attachments.mjs";
import { cleanupSealedArtifact, sealBuildArtifact } from "./artifact-seal.mjs";
import { runCodex } from "./codex-runner.mjs";
import { LeaseLostError, RunnerError } from "./errors.mjs";
import { safeError } from "./logger.mjs";
import { safeExcerpt } from "./sanitize.mjs";
import { runDeployment, runSmokeChecks, runVerification } from "./verification.mjs";

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
}) {
  return {
    ticketId: ticket.id,
    attempt: ticket.attempt,
    phase,
    worktreePath: worktreePath || "",
    baseSha: baseSha || "",
    threadId: threadId || "",
    commitSha: commitSha || "",
    pushed,
    deployed,
    pushRolledBack,
    rollbackError,
    summary: summary ? safeExcerpt(summary, 4_000) : "",
  };
}

export async function processLease({ lease, config, client, stateStore, gitWorkspace, logger, shutdownSignal }) {
  const { ticket, leaseToken } = lease;
  const keeper = new LeaseKeeper({ client, ticketId: ticket.id, leaseToken, config, logger, parentSignal: shutdownSignal });
  let previousState = await stateStore.readTicket(ticket.id, ticket.attempt);
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

  keeper.start();
  logger.info("ticket.started", { ticketId: ticket.id, attempt: ticket.attempt, attachmentCount: ticket.attachments.length });

  try {
    keeper.setPhase("preparing_worktree");
    await bestEffortProgress(client, lease, "taken", { attempt: ticket.attempt }, logger);
    const prepared = await gitWorkspace.prepareWorktree(ticket, previousState, keeper.signal);
    worktreePath = prepared.worktreePath;
    baseSha = prepared.baseSha;
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({ ticket, phase: "worktree_ready", worktreePath, baseSha, threadId }));

    keeper.setPhase("downloading_attachments");
    await cleanupAttachmentDirectory(worktreePath);
    const downloaded = await downloadAttachments({ ticket, leaseToken, worktreePath, config, client, signal: keeper.signal, logger });
    attachmentsPrepared = true;

    keeper.setPhase("codex_running");
    await bestEffortProgress(client, lease, "in_progress", { stage: "diagnose_and_fix" }, logger);
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({ ticket, phase: "codex_running", worktreePath, baseSha, threadId }));
    const codex = await runCodex({
      config,
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
    const preflight = await gitWorkspace.preflight({ worktreePath, baseSha, signal: keeper.signal });
    await gitWorkspace.cleanIgnoredArtifacts(worktreePath, keeper.signal);

    keeper.setPhase("verifying");
    await bestEffortProgress(client, lease, "verifying", { stage: "sandboxed_checks" }, logger);
    const verification = await runVerification({ config, worktreePath, ticketId: ticket.id, signal: keeper.signal, logger });

    keeper.setPhase("committing");
    const committed = await gitWorkspace.inspectAndCommit({
      ticket,
      worktreePath,
      baseSha,
      expectedTreeSha: preflight.treeSha,
      signal: keeper.signal,
    });
    commitSha = committed.commitSha;
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
      ticket,
      phase: config.dryRun ? "dry_run_committed" : "committed",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: codexSummary,
    }));

    let deployment = { pushed: false, deployed: false, dryRun: config.dryRun };
    let smoke = [];
    if (!config.dryRun) {
      keeper.setPhase("sealing_artifact");
      artifactSeal = await sealBuildArtifact({ config, worktreePath, ticketId: ticket.id, commitSha });

      keeper.setPhase("pushing");
      await bestEffortProgress(client, lease, "publishing", { stage: "push" }, logger);
      await gitWorkspace.safePush({ worktreePath, baseSha, commitSha, signal: keeper.signal });
      pushed = true;
      deployment.pushed = true;

      keeper.setPhase("deploying");
      deploymentStarted = true;
      const deploymentResult = await runDeployment({
        config,
        worktreePath,
        ticketId: ticket.id,
        commitSha,
        artifactSeal,
        signal: keeper.signal,
        logger,
      });
      deployment = { ...deployment, deployed: true, deployDurationMs: deploymentResult.durationMs };
      deployed = true;

      keeper.setPhase("production_smoke");
      smoke = await runSmokeChecks({ config, ticketId: ticket.id, signal: keeper.signal, logger });
    }

    const result = {
      outcome: config.dryRun ? "dry_run" : "published",
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
      phase: config.dryRun ? "dry_run_complete" : "complete",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: result.summary,
      pushed,
      deployed,
    }));
    await client.complete(ticket.id, leaseToken, result);
    completed = true;
    logger.info("ticket.completed", { ticketId: ticket.id, outcome: result.outcome, commitSha, changedFileCount: committed.changedPaths.length });
    if (!config.keepSuccessfulWorktrees) await gitWorkspace.removeWorktree(worktreePath);
    await cleanupSealedArtifact(artifactSeal).catch((cleanupError) => {
      logger.warn("artifact.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
    });
    return result;
  } catch (caught) {
    const error = keeper.signal.aborted && keeper.signal.reason instanceof Error ? keeper.signal.reason : caught;
    if (pushed && !deployed && deploymentStarted) {
      try {
        const rollbackSignal = AbortSignal.timeout(config.commandTimeoutMs);
        await gitWorkspace.rollbackPush({ worktreePath, baseSha, commitSha, signal: rollbackSignal });
        pushRolledBack = true;
        logger.warn("push.rolled_back", { ticketId: ticket.id, commitSha, baseSha });
      } catch (rollbackCaught) {
        rollbackError = safeError(rollbackCaught);
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
      error: safeError(error),
      threadId,
      baseSha,
      commitSha,
      pushed,
      deployed,
      pushRolledBack,
      rollbackError,
    };
    await stateStore.writeTicket(ticket.id, ticket.attempt, phaseState({
      ticket,
      phase: "failed",
      worktreePath,
      baseSha,
      threadId,
      commitSha,
      summary: report.error.message,
      pushed,
      deployed,
      pushRolledBack,
      rollbackError,
    })).catch(() => {});
    if (!(error instanceof LeaseLostError) && !shutdownSignal?.aborted) {
      await client.fail(ticket.id, leaseToken, report).catch((reportError) => {
        logger.error("ticket.failure_report_failed", { ticketId: ticket.id, error: safeError(reportError) });
      });
    }
    logger.error("ticket.failed", { ticketId: ticket.id, error: safeError(error), worktreeRetained: Boolean(worktreePath && config.keepFailedWorktrees) });
    if (worktreePath && !config.keepFailedWorktrees) {
      await gitWorkspace.removeWorktree(worktreePath).catch((cleanupError) => {
        logger.warn("worktree.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
      });
    }
    await cleanupSealedArtifact(artifactSeal).catch((cleanupError) => {
      logger.warn("artifact.cleanup_failed", { ticketId: ticket.id, error: safeError(cleanupError) });
    });
    return report;
  } finally {
    keeper.stop();
    if (!completed && keeper.signal.aborted && !shutdownSignal?.aborted) {
      logger.warn("ticket.lease_aborted", { ticketId: ticket.id });
    }
  }
}

export async function runWorker({ config, client, stateStore, gitWorkspace, logger, shutdownSignal }) {
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
    await processLease({ lease, config, client, stateStore, gitWorkspace, logger, shutdownSignal });
  }
}
