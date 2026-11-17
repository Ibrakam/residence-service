import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import bundled from '../data/dormon-hills-plans.json' with { type: 'json' };
import { dormonStoreDefault, generationPattern, planFilenamePattern, validCaptureDate, validateDormonSnapshot } from './dormon-plans-contract.mjs';

export type DormonPublishedPlan = {
  id: string;
  block: string;
  rooms: number;
  area: number;
  plan: string;
  floorPlan: string;
  floors?: string;
};
type Snapshot = { source: string; capturedAt: string; plans: DormonPublishedPlan[] };
export type DormonPlansState = Snapshot & {
  freshness: 'current' | 'stale' | 'bundled';
  lastAttemptAt: string | null;
  lastErrorAt: string | null;
};
type CaptureStatus = { lastAttemptAt?: string; lastErrorAt?: string; status?: string };

const bundledSnapshot = validateDormonSnapshot(bundled) as Snapshot;
const generations = new Map<string, Snapshot>();
let cache: { store: string; state: DormonPlansState; expires: number } | undefined;
let lastGood: { store: string; snapshot: Snapshot } | undefined;
let pending: { store: string; promise: Promise<DormonPlansState> } | undefined;

function storePath() { return path.resolve(process.env.DORMON_PLANS_DIR || dormonStoreDefault); }

async function boundedRead(filename: string, maximum: number) {
  const handle = await open(filename, 'r');
  try {
    const file = await handle.stat();
    if (!file.isFile() || file.size <= 0 || file.size > maximum) throw new Error('Invalid layout file size');
    const bytes = Buffer.alloc(file.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw new Error('Incomplete layout file');
      offset += result.bytesRead;
    }
    return bytes;
  } finally { await handle.close(); }
}

async function readGeneration(store: string, generation: string): Promise<Snapshot> {
  if (!generationPattern.test(generation)) throw new Error('Invalid layout generation');
  const key = `${store}:${generation}`;
  const existing = generations.get(key);
  if (existing) return existing;
  const directory = path.join(store, 'generations', generation);
  const snapshot = validateDormonSnapshot(JSON.parse((await boundedRead(path.join(directory, 'snapshot.json'), 128_000)).toString('utf8')), generation) as Snapshot;
  const files = new Set(snapshot.plans.flatMap(row => [row.plan, row.floorPlan]));
  await Promise.all([...files].map(async url => {
    const file = await stat(path.join(directory, path.posix.basename(url)));
    if (!file.isFile() || file.size <= 0 || file.size > 8_000_000) throw new Error('Incomplete layout generation');
  }));
  if (generations.size >= 8) generations.delete(generations.keys().next().value!);
  generations.set(key, snapshot);
  return snapshot;
}

async function loadState(store: string): Promise<DormonPlansState> {
  let status: CaptureStatus = {};
  try {
    const parsed = JSON.parse((await boundedRead(path.join(store, 'status.json'), 2_000)).toString('utf8'));
    if (parsed && typeof parsed === 'object') status = parsed;
  } catch { /* A first capture may not have status yet. */ }
  const lastAttemptAt = validCaptureDate(status.lastAttemptAt) ? status.lastAttemptAt! : null;
  const lastErrorAt = validCaptureDate(status.lastErrorAt) ? status.lastErrorAt! : null;
  let snapshot: Snapshot;
  let freshness: DormonPlansState['freshness'];
  try {
    const pointer = JSON.parse((await boundedRead(path.join(store, 'current.json'), 2_000)).toString('utf8'));
    if (!validCaptureDate(pointer.capturedAt)) throw new Error('Invalid capture date');
    const generation = await readGeneration(store, pointer.generation);
    snapshot = { ...generation, capturedAt: pointer.capturedAt };
    lastGood = { store, snapshot };
    freshness = Date.now() - Date.parse(snapshot.capturedAt) <= 8 * 60 * 60_000 &&
      !(lastErrorAt && Date.parse(lastErrorAt) > Date.parse(snapshot.capturedAt)) ? 'current' : 'stale';
  } catch {
    snapshot = lastGood?.store === store ? lastGood.snapshot : bundledSnapshot;
    freshness = lastGood?.store === store ? 'stale' : 'bundled';
  }
  return { ...snapshot, freshness, lastAttemptAt, lastErrorAt };
}

/** Reads published local data only. Upstream requests run in the scheduled capture. */
export async function dormonPlansState(): Promise<DormonPlansState> {
  const store = storePath();
  if (cache?.store === store && cache.expires > Date.now()) return cache.state;
  if (pending?.store === store) return pending.promise;
  const promise = loadState(store).then(state => {
    cache = { store, state, expires: Date.now() + 30_000 };
    return state;
  }).finally(() => { if (pending?.promise === promise) pending = undefined; });
  pending = { store, promise };
  return promise;
}

export async function dormonPlanAsset(generation: string, filename: string): Promise<Buffer | null> {
  if (!generationPattern.test(generation) || !planFilenamePattern.test(filename)) return null;
  const store = storePath();
  let snapshot: Snapshot;
  try { snapshot = await readGeneration(store, generation); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const url = `/dormon-hills/plans/live/${generation}/${filename}`;
  if (!snapshot.plans.some(row => row.plan === url || row.floorPlan === url)) return null;
  const bytes = await boundedRead(path.join(store, 'generations', generation, filename), 8_000_000);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  if (!filename.endsWith(`-${hash}.webp`)) throw new Error('Stored layout image integrity failure');
  return bytes;
}
