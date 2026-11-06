import { collectTaqsim, fetchPlan, planPath } from '../../scripts/live-sync/src/taqsim.mjs';

type State = Awaited<ReturnType<typeof collectTaqsim>>;
let current: State | undefined;
let expires = 0;
let pending: Promise<State> | undefined;
let retryAfter = 0;
const plans = new Map<string, Uint8Array>();

export async function pushkinState(): Promise<State> {
  if (current && Date.now() < expires) return current;
  if (pending) return pending;
  if (Date.now() < retryAfter) throw new Error('Source temporarily unavailable');
  pending = collectTaqsim().then((result) => {
    current = result; expires = Date.now() + 180_000; return result;
  }).catch((error: unknown) => { retryAfter = Date.now() + 30_000; throw error; }).finally(() => { pending = undefined; });
  return pending;
}

export async function pushkinPlan(filename: string) {
  if (!/^[a-f0-9]{20}\.png$/.test(filename)) return null;
  const cached = plans.get(filename); if (cached) return cached;
  const { pages } = await pushkinState();
  const row = pages.flatMap(page => page.units).find(unit => planPath(unit.photo) === `/pushkin/plans/${filename}`);
  if (!row) return null;
  const bytes = await fetchPlan(row.photo);
  // Bounded memory cache; static plans in public/ already cover the initial generation.
  if ([...plans.values()].reduce((n, b) => n + b.byteLength, 0) + bytes.byteLength > 16 * 1024 * 1024) plans.clear();
  plans.set(filename, bytes); return bytes;
}
