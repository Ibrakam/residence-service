import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { dormonSource as source, sourceAssetPattern, validateDormonSnapshot } from '../lib/dormon-plans-contract.mjs';

const website = fileURLToPath(new URL('../', import.meta.url));
const expectedBlocks = new Map([['А', 'a'], ['Б', 'b'], ['В', 'v'], ['Г', 'g'], ['Д', 'd']]);

export async function download(url, mime, maxBytes) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.toLowerCase().startsWith(mime)) {
    throw new Error(`Unexpected response for ${url}: HTTP ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes: ${url}`);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
}

export async function atomicWrite(filename, content) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o644 });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function parsePublishedPlans(html) {
  const embedded = html.match(/<script\b[^>]*\bid=["']mh-page["'][^>]*>([\s\S]*?)<\/script>/);
  if (!embedded) throw new Error('Millennium House page no longer exposes layout data');
  const page = JSON.parse(embedded[1]);
  if (page.projectId !== 1 || !Array.isArray(page.plans) || page.plans.length < 1 || page.plans.length > 128) {
    throw new Error('Unexpected project or incomplete layout data');
  }
  const ids = new Set();
  const planAssets = new Set();
  const plans = page.plans.map(({ block, floors, rooms, area, plan, floorPlan }) => {
    if (!expectedBlocks.has(block) || ![1, 2, 3].includes(rooms) || !Number.isFinite(area) || area <= 0 || area > 500) {
      throw new Error('Bad layout block, room count or area');
    }
    if (!['', '2–7', '8–12'].includes(floors) || Boolean(floors) !== (block === 'Д')) {
      throw new Error(`Unverified floor group for block ${block}`);
    }
    const group = floors ? `${block}|${floors}` : block;
    if (typeof plan !== 'string' || !sourceAssetPattern.test(plan) || !plan.includes('/u-') ||
        typeof floorPlan !== 'string' || !sourceAssetPattern.test(floorPlan) || !floorPlan.includes('/floor-') ||
        page.floorPlans?.[group] !== floorPlan) throw new Error(`Bad layout asset for group ${group}`);
    const id = `layout-${expectedBlocks.get(block)}${floors ? `-${floors.replace('–', '-')}` : ''}-${rooms}-${Math.round(area * 100)}`;
    if (ids.has(id) || planAssets.has(plan)) throw new Error(`Duplicate layout: ${id}`);
    ids.add(id);
    planAssets.add(plan);
    return { id, block, rooms, area, ...(floors && { floors }), plan, floorPlan };
  });
  if (new Set(plans.map(row => row.block)).size !== 5 || Object.keys(page.floorPlans ?? {}).length !== 6 ||
      new Set(plans.map(row => row.floorPlan)).size !== 6) throw new Error('Missing verified blocks or floor plans');
  return plans;
}

async function captureAsset(asset) {
  const original = await download(new URL(asset, source), 'image/webp', 8_000_000);
  const image = sharp(original, { limitInputPixels: 24_000_000 });
  const metadata = await image.metadata();
  if (metadata.format !== 'webp' || metadata.width < 200 || metadata.height < 200) throw new Error(`Invalid layout image: ${asset}`);
  const optimized = await image.resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 92, effort: 5 }).toBuffer();
  const bytes = optimized.length < original.length ? optimized : original;
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  return { name: `${path.posix.basename(asset, '.webp')}-${hash}.webp`, bytes };
}

export async function captureDormonPlans({ store, captureAsset: captureImage = captureAsset, capturePage = () => download(source, 'text/html', 1_000_000) } = {}) {
  const startedAt = new Date().toISOString();
  let staging;
  let lock;
  if (store) {
    store = path.resolve(store);
    await mkdir(store, { recursive: true, mode: 0o755 });
    // The service also uses flock. This lock protects direct CLI invocations.
    lock = await open(path.join(store, '.capture.lock'), 'wx', 0o644).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
      const existing = await stat(path.join(store, '.capture.lock'));
      if (Date.now() - existing.mtimeMs < 20 * 60_000) throw new Error('A Do‘rmon capture is already running');
      await rm(path.join(store, '.capture.lock'));
      return open(path.join(store, '.capture.lock'), 'wx', 0o644);
    });
  }
  try {
    const plans = parsePublishedPlans((await capturePage()).toString('utf8'));
    const urls = [...new Set(plans.flatMap(row => [row.plan, row.floorPlan]))];
    const assets = new Map();
    let totalBytes = 0;
    for (let index = 0; index < urls.length; index += 4) {
      await Promise.all(urls.slice(index, index + 4).map(async url => {
        const asset = await captureImage(url);
        totalBytes += asset.bytes.length;
        if (totalBytes > 64_000_000) throw new Error('Layout generation exceeds 64 MB');
        assets.set(url, asset);
      }));
    }
    const capturedAt = new Date().toISOString();
    const normalized = plans.map(row => ({ ...row, plan: assets.get(row.plan).name, floorPlan: assets.get(row.floorPlan).name }));
    const generation = createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24);
    const prefix = store ? `/dormon-hills/plans/live/${generation}` : '/dormon-hills/plans';
    const snapshot = validateDormonSnapshot({ source, capturedAt, plans: normalized.map(row => ({ ...row, plan: `${prefix}/${row.plan}`, floorPlan: `${prefix}/${row.floorPlan}` })) }, store ? generation : undefined);
    if (store) {
      const generations = path.join(store, 'generations');
      await mkdir(generations, { recursive: true, mode: 0o755 });
      staging = path.join(generations, `.pending-${randomUUID()}`);
      await mkdir(staging, { mode: 0o755 });
      for (const { name, bytes } of assets.values()) await writeFile(path.join(staging, name), bytes, { mode: 0o644 });
      await writeFile(path.join(staging, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o644 });
      const destination = path.join(generations, generation);
      try { await rename(staging, destination); } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
        // Reuse immutable content only after checking every image byte.
        const previous = validateDormonSnapshot(JSON.parse(await readFile(path.join(destination, 'snapshot.json'), 'utf8')), generation);
        if (JSON.stringify(previous.plans) !== JSON.stringify(snapshot.plans)) throw new Error('Generation content mismatch');
        for (const { name, bytes } of assets.values()) {
          if (!(await readFile(path.join(destination, name))).equals(bytes)) throw new Error('Stored layout image mismatch');
        }
      }
      await atomicWrite(path.join(store, 'current.json'), JSON.stringify({ generation, capturedAt }));
      await atomicWrite(path.join(store, 'status.json'), JSON.stringify({ lastAttemptAt: startedAt, lastSuccessAt: capturedAt, status: 'ok' }));
    } else {
      const destination = path.join(website, 'public/dormon-hills/plans');
      await mkdir(destination, { recursive: true });
      for (const { name, bytes } of assets.values()) await atomicWrite(path.join(destination, name), bytes);
      await atomicWrite(path.join(website, 'data/dormon-hills-plans.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
    }
    return { snapshot, generation };
  } catch (error) {
    if (store) await atomicWrite(path.join(store, 'status.json'), JSON.stringify({ lastAttemptAt: startedAt, lastErrorAt: new Date().toISOString(), status: 'failed' })).catch(() => {});
    throw error;
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (lock) {
      await lock.close();
      await rm(path.join(store, '.capture.lock'), { force: true });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--store' || !path.isAbsolute(args[1]))) {
    throw new Error('Usage: node capture-dormon-plans.mjs [--store /absolute/persistent/directory]');
  }
  const { snapshot } = await captureDormonPlans({ store: args[1] ?? process.env.DORMON_PLANS_DIR });
  console.log(`Captured ${snapshot.plans.length} typical layouts from ${source}.`);
}
