#!/usr/bin/env node

// TENCORP_CLUSTER_ENTRYPOINT_V1
// Keep the public standalone entrypoint stable so an older release can still
// be selected during rollback. New artifacts retain Vinext's generated server
// as worker-server.js and use this small cluster supervisor as server.js.
import cluster from 'node:cluster';

const defaultWorkers = 1;
const maximumWorkers = 4;
const shutdownTimeoutMs = 15_000;
const restartWindowMs = 30_000;
const maximumRapidRestarts = 5;
const initialRestartDelayMs = 250;
const maximumRestartDelayMs = 4_000;

function configuredWorkers() {
  const raw = process.env.WEB_CONCURRENCY?.trim();
  if (!raw) return defaultWorkers;
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximumWorkers || String(value) !== raw) {
    throw new Error(`WEB_CONCURRENCY must be an integer between 1 and ${maximumWorkers}`);
  }
  return value;
}

if (cluster.isPrimary) {
  const workerCount = configuredWorkers();
  if (workerCount === 1) {
    await import('./worker-server.js');
  } else {
    let shuttingDown = false;
    let restartTimes = [];
    const restartTimers = new Set();

    const shutdown = (reason, exitCode = 0) => {
      if (shuttingDown) return;
      shuttingDown = true;
      for (const timer of restartTimers) clearTimeout(timer);
      restartTimers.clear();
      const forcedExit = setTimeout(() => {
        console.error('[frontend-cluster] graceful shutdown timed out');
        process.exit(1);
      }, shutdownTimeoutMs);
      forcedExit.unref();
      cluster.disconnect(() => {
        clearTimeout(forcedExit);
        process.exit(exitCode);
      });
      // KillMode=mixed sends the initial signal only to this primary process.
      // cluster.disconnect() then stops accepting work and lets workers drain.
      console.log(`[frontend-cluster] ${reason}; draining ${workerCount} worker(s)`);
    };

    cluster.schedulingPolicy = cluster.SCHED_RR;
    for (let index = 0; index < workerCount; index += 1) cluster.fork();

    cluster.on('exit', (worker, code, signal) => {
      if (shuttingDown) return;
      const now = Date.now();
      restartTimes = restartTimes.filter((startedAt) => now - startedAt < restartWindowMs);
      restartTimes.push(now);
      if (restartTimes.length > maximumRapidRestarts) {
        console.error(`[frontend-cluster] worker crash loop detected (${restartTimes.length} exits in ${restartWindowMs}ms)`);
        shutdown('worker restart threshold exceeded', 1);
        return;
      }
      const delay = Math.min(
        maximumRestartDelayMs,
        initialRestartDelayMs * (2 ** (restartTimes.length - 1)),
      );
      console.error(`[frontend-cluster] worker ${worker.process.pid ?? 'unknown'} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'}); replacing it in ${delay}ms`);
      const timer = setTimeout(() => {
        restartTimers.delete(timer);
        if (!shuttingDown) cluster.fork();
      }, delay);
      restartTimers.add(timer);
    });

    process.on('SIGTERM', () => shutdown('received SIGTERM'));
    process.on('SIGINT', () => shutdown('received SIGINT'));
  }
} else {
  import('./worker-server.js').catch((error) => {
    console.error('[frontend-cluster] worker failed to start');
    console.error(error);
    process.exit(1);
  });
}
