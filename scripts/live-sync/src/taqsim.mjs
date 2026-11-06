import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const TAQSIM_URL = 'https://estate.taqsim.uz/complex/pushkin-klubnyy-dom';
export const PROJECT_UUID = 'b006e0ad-87f5-4a32-aabb-36a216731ca7';
export const HOUSE_UUID = '5df4b679-6d40-428a-86eb-0dcb8970d23e';
const origin = 'https://estate.taqsim.uz';

export function parsePage(html) {
  const match = html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Taqsim did not return its public catalogue data');
  const data = JSON.parse(match[1])?.props?.pageProps;
  if (data?.project?.uuid !== PROJECT_UUID || data.project.slug !== 'pushkin-klubnyy-dom') throw new Error('Unexpected Taqsim project');
  if (!Number.isSafeInteger(data.total) || data.total < 1 || data.total > 4096 || !Array.isArray(data.units)) throw new Error('Invalid Taqsim catalogue count');
  return data;
}

export function planSource(path) {
  if (typeof path !== 'string' || !/^\/upload\/unit-plans\/[a-f0-9-]+\.png$/.test(path)) throw new Error('Unreviewed Taqsim plan source');
  return origin + path;
}

export function planPath(source) {
  return `/pushkin/plans/${createHash('sha256').update(planSource(source)).digest('hex').slice(0, 20)}.png`;
}

export function normalizePages(base, pages, capturedAt = new Date().toISOString()) {
  const seen = new Map();
  if (pages.reduce((n, page) => n + page.total, 0) !== base.total) throw new Error('Taqsim partition totals disagree');
  for (const page of pages) {
    if (page.project.uuid !== PROJECT_UUID || page.units.length !== page.total) throw new Error('Incomplete Taqsim partition');
    for (const row of page.units) {
      if (row.projectUuid !== PROJECT_UUID || row.houseUuid !== HOUSE_UUID || !['available', 'in_work'].includes(row.status)) throw new Error('Unexpected Taqsim unit identity or status');
      if (!/^[a-f0-9-]{36}$/.test(row.uuid) || !row.number || ![2, 3, 4].includes(row.rooms)
          || !Number.isInteger(row.floor) || row.floor < 1 || row.floor > 16
          || !Number.isFinite(row.areaTotal) || row.areaTotal <= 0
          || !Number.isFinite(row.price) || row.price <= 0 || row.currency !== 'UZS'
          || Math.abs(row.price - row.areaTotal * row.pricePerM2) > 2) throw new Error('Invalid Taqsim unit values');
      const unit = {
        id: row.uuid, sourceKey: `taqsim:pushkin:${row.uuid}`, number: String(row.number),
        rooms: row.rooms, area: row.areaTotal, floor: row.floor, maxFloor: 16,
        building: row.section || '', entrance: row.section || '', phase: '2027',
        propertyType: 'apartment', status: row.status, rawStatus: row.status,
        price: Math.round(row.price), pricePerM2: row.pricePerM2, currency: 'UZS',
        plan: planPath(row.photo), planImageUrl: planPath(row.photo),
        monthlyFrom: row.monthlyFrom ?? null, financingPriceFrom: row.priceFrom ?? null,
        minPrepayFrom: row.minPrepayFrom ?? null,
      };
      if (seen.has(unit.id) && JSON.stringify(seen.get(unit.id)) !== JSON.stringify(unit)) throw new Error('Taqsim changed during capture');
      seen.set(unit.id, unit);
    }
  }
  if (seen.size !== base.total) throw new Error(`Incomplete Taqsim capture: ${seen.size}/${base.total}`);
  // Taqsim's public total also includes apartments marked in_work. Reconcile
  // the complete source universe first, then publish only available offers.
  const units = [...seen.values()].filter(unit => unit.status === 'available').sort((a, b) => a.floor - b.floor || a.building.localeCompare(b.building) || a.number.localeCompare(b.number, 'ru', { numeric: true }));
  return {
    schemaVersion: 1, projectSlug: 'pushkin', capturedAt, source: TAQSIM_URL,
    sourceProjectUuid: PROJECT_UUID, complete: true, sourceTotal: base.total,
    sourceUnavailable: [...seen.values()].filter(unit => unit.status !== 'available').map(({ id, rawStatus }) => ({ id, rawStatus })),
    officialCount: units.length, officialTotalAtCapture: units.length, availableTotal: units.length,
    project: { slug: 'pushkin', name: 'Pushkin', developerSlug: 'tower-up', developerName: 'Tower Up',
      address: 'Ташкент, Мирзо-Улугбекский район, ул. Олмачи, 21',
      latitude: 41.3213055556, longitude: 69.3153611111, housingClass: 'Business', completion: 'Q4 2027' },
    units,
  };
}

async function getBytes(url, maximum = 3 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(25000), redirect: 'error', headers: { Accept: '*/*' } });
  if (!response.ok) throw new Error(`Taqsim returned HTTP ${response.status}`);
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > maximum) throw new Error('Taqsim response exceeds its reviewed size limit');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}

export async function collectTaqsim() {
  const base = parsePage((await getBytes(`${TAQSIM_URL}?size=100`)).toString('utf8'));
  const pages = [];
  for (const rooms of [2, 3, 4]) {
    const page = parsePageAllowEmpty((await getBytes(`${TAQSIM_URL}?size=100&rooms=${rooms}`)).toString('utf8'));
    if (page.units.some(row => row.rooms !== rooms)) throw new Error('Taqsim ignored a partition filter');
    if (page.units.length === page.total) { pages.push(page); continue; }
    // The public site caps one response at 100 rows. Never accept that cap as
    // a complete project: partition by room count and, when needed, by floor.
    for (let floor = 1; floor <= 16; floor += 1) {
      const part = parsePageAllowEmpty((await getBytes(`${TAQSIM_URL}?size=100&rooms=${rooms}&floorMin=${floor}&floorMax=${floor}`)).toString('utf8'));
      if (part.units.some(row => row.rooms !== rooms || row.floor !== floor)) throw new Error('Taqsim ignored a floor partition');
      pages.push(part);
    }
  }
  const snapshot = normalizePages(base, pages);
  return { snapshot, pages };
}

function parsePageAllowEmpty(html) {
  // Empty floor partitions are valid; the full project must still be nonempty.
  const match = html.match(/<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const data = match ? JSON.parse(match[1])?.props?.pageProps : null;
  if (data?.project?.uuid !== PROJECT_UUID || !Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.units)) throw new Error('Invalid Taqsim floor partition');
  return data;
}

export async function fetchPlan(sourcePath) {
  const b = await getBytes(planSource(sourcePath), 8 * 1024 * 1024);
  if (!b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || b.length < 100) throw new Error('Invalid Taqsim plan image');
  return b;
}

async function atomic(path, content) {
  const tmp = `${path}.${process.pid}.tmp`; await writeFile(tmp, content); await rename(tmp, path);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--output' || args[2] !== '--public') throw new Error('Usage: taqsim.mjs --output DIR --public DIR');
  const output = resolve(args[1]); const publicDir = resolve(args[3]);
  if (output === '/' || publicDir === '/') throw new Error('Unsafe capture directory');
  const { snapshot, pages } = await collectTaqsim();
  await mkdir(output, { recursive: true }); await mkdir(join(publicDir, 'pushkin/plans'), { recursive: true });
  const rows = [...new Map(pages.flatMap(p => p.units).map(row => [row.photo, row])).values()];
  for (let index = 0; index < rows.length; index += 4) {
    await Promise.all(rows.slice(index, index + 4).map(async row => {
      const path = join(publicDir, planPath(row.photo));
      try { const b = await readFile(path); if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return; } catch {}
      const b = await getBytes(planSource(row.photo), 8 * 1024 * 1024);
      if (!b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || b.length < 100) throw new Error('Invalid Taqsim plan image');
      await atomic(path, b);
    }));
  }
  // Publish only after the complete, validated generation and every plan exist.
  await atomic(join(output, 'pushkin-catalog.json'), JSON.stringify(snapshot, null, 2) + '\n');
  console.log(JSON.stringify({ provider: 'taqsim', projects: 1, records: snapshot.units.length, capturedAt: snapshot.capturedAt, plans: rows.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
