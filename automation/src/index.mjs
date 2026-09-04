#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { createLogger, safeError } from "./logger.mjs";
import { runWorker } from "./pipeline.mjs";
import { ProjectRuntimeRegistry } from "./project-profiles.mjs";
import { FileTicketClient, TicketServerClient } from "./server-client.mjs";
import { ProcessLock, StateStore } from "./state-store.mjs";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ runnerId: config.runnerId, level: config.logLevel });
  const shutdown = new AbortController();
  const stateStore = new StateStore(config.stateDir);
  const processLock = new ProcessLock(config.stateDir);

  const requestShutdown = (signal) => {
    if (!shutdown.signal.aborted) {
      logger.info("runner.shutdown_requested", { signal });
      shutdown.abort(new Error(`Runner received ${signal}`));
    }
  };
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  await stateStore.initialize();
  await processLock.acquire();
  try {
    const projectRegistry = new ProjectRuntimeRegistry(config, logger);
    await projectRegistry.initialize();
    if (config.configCheck) {
      logger.info("runner.config_ok", {
        projects: projectRegistry.list(),
        codexBin: config.codexBin,
        dryRun: config.dryRun,
        testMode: config.testMode,
        verifyCommandCount: config.verifyCommands.length,
      });
      return;
    }
    const client = config.testMode
      ? new FileTicketClient(config, stateStore, logger)
      : new TicketServerClient(config, logger);
    logger.info("runner.started", { dryRun: config.dryRun, testMode: config.testMode, once: config.once });
    await runWorker({ config, client, stateStore, projectRegistry, logger, shutdownSignal: shutdown.signal });
    logger.info("runner.stopped", {});
  } finally {
    await processLock.release();
  }
}

main().catch((error) => {
  const fallbackLogger = createLogger({ runnerId: "ticket-runner" });
  fallbackLogger.error("runner.fatal", { error: safeError(error) });
  process.exitCode = 1;
});
