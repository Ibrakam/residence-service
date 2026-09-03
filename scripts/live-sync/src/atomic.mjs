import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

const runDirectoryPattern = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const defaultRetention = Object.freeze({
  successfulRuns: 12,
  failedRuns: 3,
  maximumAgeMs: 24 * 60 * 60 * 1000,
  maximumBytes: 256 * 1024 * 1024,
  raceGraceMs: 15 * 60 * 1000,
});

function childPath(root, relative) {
  if (!relative || relative.startsWith('/') || relative.includes('..')) throw new Error(`Unsafe relative output path ${JSON.stringify(relative)}`);
  const path = resolve(root, relative);
  if (!path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`Output escaped staging root: ${relative}`);
  return path;
}

async function syncFile(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

function environmentInteger(name, fallback, minimum = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}`);
  return value;
}

export function retentionFromEnvironment() {
  return {
    successfulRuns: environmentInteger('LIVE_SYNC_RETENTION_SUCCESSFUL_RUNS', defaultRetention.successfulRuns, 1),
    failedRuns: environmentInteger('LIVE_SYNC_RETENTION_FAILED_RUNS', defaultRetention.failedRuns, 0),
    maximumAgeMs: environmentInteger('LIVE_SYNC_RETENTION_MAX_AGE_HOURS', 24, 1) * 60 * 60 * 1000,
    maximumBytes: environmentInteger('LIVE_SYNC_RETENTION_MAX_BYTES', defaultRetention.maximumBytes, 1),
    raceGraceMs: environmentInteger('LIVE_SYNC_RETENTION_RACE_GRACE_SECONDS', 15 * 60, 0) * 1000,
  };
}

async function directoryBytes(path) {
  let bytes = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) bytes += await directoryBytes(child);
    else if (entry.isFile()) bytes += (await stat(child)).size;
  }
  return bytes;
}

async function currentRun(providerRoot, providerId) {
  const pointerPath = resolve(providerRoot, 'current.json');
  let pointer;
  try { pointer = JSON.parse(await readFile(pointerPath, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`${providerId}: current run pointer is unreadable; refusing retention cleanup`);
  }
  if (pointer?.provider !== providerId || !runDirectoryPattern.test(pointer?.runId ?? '') || resolve(pointer.path ?? '') !== resolve(providerRoot, pointer.runId)) {
    throw new Error(`${providerId}: current run pointer is invalid; refusing retention cleanup`);
  }
  return pointer.runId;
}

/**
 * Remove only completed, explicitly-shaped run directories below one validated
 * provider root. The current pointer and all `.staging-*` directories are
 * never candidates. A short grace window also protects concurrent publishers.
 */
export async function pruneRunDirectories(providerRoot, providerId, options = retentionFromEnvironment()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) throw new Error(`Invalid provider ID ${JSON.stringify(providerId)}`);
  const root = resolve(providerRoot);
  const current = await currentRun(root, providerId);
  if (!current) return { deletedRuns: 0, keptRuns: 0, retainedBytes: 0 };
  const now = Date.now();
  const candidates = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !runDirectoryPattern.test(entry.name)) continue;
    const path = resolve(root, entry.name);
    const metadata = await lstat(path);
    candidates.push({
      runId: entry.name,
      path,
      modifiedAt: metadata.mtimeMs,
      bytes: await directoryBytes(path),
      successful: await exists(resolve(path, 'success.json')),
    });
  }
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt || right.runId.localeCompare(left.runId));

  const kept = new Set();
  let retainedBytes = 0;
  let successfulRuns = 0;
  let failedRuns = 0;
  const keep = (run) => {
    if (kept.has(run.runId)) return;
    kept.add(run.runId);
    retainedBytes += run.bytes;
    if (run.successful) successfulRuns += 1;
    else failedRuns += 1;
  };

  const currentEntry = candidates.find((run) => run.runId === current);
  if (!currentEntry) throw new Error(`${providerId}: current run directory is missing; refusing retention cleanup`);
  keep(currentEntry);
  // A concurrently published run can exist briefly before its current pointer
  // is installed. Protect every very recent completed directory from that race.
  for (const run of candidates) if (now - run.modifiedAt <= options.raceGraceMs) keep(run);

  for (const run of candidates) {
    if (kept.has(run.runId)) continue;
    if (now - run.modifiedAt > options.maximumAgeMs) continue;
    const withinCount = run.successful ? successfulRuns < options.successfulRuns : failedRuns < options.failedRuns;
    const withinBytes = retainedBytes + run.bytes <= options.maximumBytes;
    if (withinCount && withinBytes) keep(run);
  }

  let deletedRuns = 0;
  for (const run of candidates) {
    if (kept.has(run.runId)) continue;
    // `run.path` was formed from a validated direct child name. No glob,
    // symlink, environment expansion, or caller-provided recursive target is
    // involved in this deletion.
    await rm(run.path, { recursive: true, force: true });
    deletedRuns += 1;
  }
  return { deletedRuns, keptRuns: kept.size, retainedBytes };
}

export async function atomicWriteFile(path, body, mode = 0o600) {
  const destination = resolve(path);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = resolve(parent, `.${destination.split(sep).at(-1)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { flag: 'wx', mode });
    await syncFile(temporary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function atomicRunDirectory(outputRoot, providerId, files, retention = retentionFromEnvironment()) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(providerId)) throw new Error(`Invalid provider ID ${JSON.stringify(providerId)}`);
  const root = resolve(outputRoot);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const providerRoot = resolve(root, providerId);
  await mkdir(providerRoot, { recursive: true, mode: 0o700 });
  const staging = resolve(providerRoot, `.staging-${runId}`);
  const destination = resolve(providerRoot, runId);
  if (await exists(destination)) throw new Error(`Run directory already exists: ${destination}`);
  await mkdir(staging, { recursive: false, mode: 0o700 });
  try {
    for (const [relative, body] of files) {
      const path = childPath(staging, relative);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, body, { flag: 'wx', mode: 0o600 });
      await syncFile(path);
    }
    await rename(staging, destination);
    await atomicWriteFile(resolve(providerRoot, 'current.json'), `${JSON.stringify({ provider: providerId, runId, path: destination }, null, 2)}\n`);
    await pruneRunDirectories(providerRoot, providerId, retention);
    return destination;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export function jsonBody(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
