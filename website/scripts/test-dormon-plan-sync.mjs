import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureDormonPlans, parsePublishedPlans } from './capture-dormon-plans.mjs';

const website = fileURLToPath(new URL('../', import.meta.url));
const bundled = JSON.parse(await readFile(path.join(website, 'data/dormon-hills-plans.json'), 'utf8'));
const toSource = url => `/media/project-pages/dormon/${path.basename(url).replace(/-[a-f0-9]{12}\.webp$/, '.webp')}`;
const plans = bundled.plans.map(row => ({ ...row, floors: row.floors ?? '', plan: toSource(row.plan), floorPlan: toSource(row.floorPlan) }));
const floorPlans = Object.fromEntries(plans.map(row => [row.floors ? `${row.block}|${row.floors}` : row.block, row.floorPlan]));
const page = rows => `<script id="mh-page" type="application/json">${JSON.stringify({ projectId: 1, plans: rows, floorPlans })}</script>`;
const imageMap = new Map();
for (const row of bundled.plans) for (const url of [row.plan, row.floorPlan]) imageMap.set(toSource(url), url);
const captureAsset = async url => ({ name: path.basename(imageMap.get(url)), bytes: await readFile(path.join(website, 'public', imageMap.get(url))) });
const store = await mkdtemp(path.join(os.tmpdir(), 'dormon-sync-'));
const originalStore = process.env.DORMON_PLANS_DIR;
const realNow = Date.now;
let clockOffset = 0;
const refresh = () => { clockOffset += 31_000; Date.now = () => realNow() + clockOffset; };

try {
  const first = await captureDormonPlans({ store, capturePage: async () => page(plans), captureAsset });
  assert.equal(first.snapshot.plans.length, 32);
  const firstPointer = await readFile(path.join(store, 'current.json'), 'utf8');
  const repeat = await captureDormonPlans({ store, capturePage: async () => page(plans), captureAsset });
  assert.equal(repeat.generation, first.generation, 'Unchanged source reuses generation');
  assert.equal((await readdir(path.join(store, 'generations'))).length, 1);
  process.env.DORMON_PLANS_DIR = store;
  const { dormonPlansState, dormonPlanAsset } = await import('../lib/dormon-plans-state.ts');
  const state = await dormonPlansState();
  assert.equal(state.freshness, 'current');
  assert.equal(state.plans.length, 32);
  const filename = path.basename(state.plans[0].plan);
  assert.ok((await dormonPlanAsset(first.generation, filename)).length > 0);
  assert.equal(await dormonPlanAsset('../escape', filename), null);
  assert.equal(await dormonPlanAsset(first.generation, '../snapshot.json'), null);
  const storedImage = path.join(store, 'generations', first.generation, filename);
  const originalImage = await readFile(storedImage);
  await writeFile(storedImage, 'corrupted image');
  await assert.rejects(dormonPlanAsset(first.generation, filename), /integrity failure/);
  await writeFile(storedImage, originalImage);

  const current = await readFile(path.join(store, 'current.json'), 'utf8');
  await assert.rejects(captureDormonPlans({ store, capturePage: async () => 'invalid html', captureAsset }));
  assert.equal(await readFile(path.join(store, 'current.json'), 'utf8'), current, 'Parse failure preserves current');
  await assert.rejects(captureDormonPlans({ store, capturePage: async () => page(plans), captureAsset: async () => { throw new Error('upstream unavailable'); } }));
  assert.equal(await readFile(path.join(store, 'current.json'), 'utf8'), current, 'Image failure preserves current');
  refresh();
  assert.equal((await dormonPlansState()).freshness, 'stale');
  await writeFile(path.join(store, 'current.json'), '{invalid');
  refresh();
  assert.deepEqual((await dormonPlansState()).plans, state.plans, 'Invalid pointer retains last-good in process');
  await writeFile(path.join(store, 'current.json'), current);

  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let entered;
  const enteredSource = new Promise(resolve => { entered = resolve; });
  const running = captureDormonPlans({ store, capturePage: async () => { entered(); await waiting; return page(plans); }, captureAsset });
  await enteredSource;
  await assert.rejects(captureDormonPlans({ store, capturePage: async () => page(plans), captureAsset }), /already running/);
  release();
  await running;
  assert.ok(firstPointer);
  assert.throws(() => parsePublishedPlans(page([...plans, plans[0]])), /Duplicate/);
  assert.throws(() => parsePublishedPlans(page(plans.map((row, i) => i === 0 ? { ...row, plan: 'https://other.example/image.webp' } : row))), /Bad layout asset/);

  // Removal in a fully present source must reconcile into the next generation.
  const smaller = await captureDormonPlans({ store, capturePage: async () => page(plans.slice(1)), captureAsset });
  assert.equal(smaller.snapshot.plans.length, 31);
  assert.notEqual(smaller.generation, first.generation);
  assert.ok((await dormonPlanAsset(first.generation, filename)).length, 'Previous page asset URLs survive publication');
  process.env.DORMON_PLANS_DIR = path.join(store, 'missing');
  assert.equal((await dormonPlansState()).freshness, 'bundled');
  console.log('Do‘rmon sync verified: validation, complete publication, deduplication, removals, concurrent capture, last-good fallback and immutable asset serving.');
} finally {
  Date.now = realNow;
  if (originalStore === undefined) delete process.env.DORMON_PLANS_DIR;
  else process.env.DORMON_PLANS_DIR = originalStore;
  await rm(store, { recursive: true, force: true });
}
