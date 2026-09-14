import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceRoot = path.join(root, 'source', 'c1');
const rawPath = path.join(sourceRoot, 'raw', 'plans-all-pages.json');
const outDir = path.join(root, 'public', 'c1', 'plans');
const dataPath = path.join(root, 'data', 'c1-catalog.json');
const manifestPath = path.join(sourceRoot, 'plans-manifest.json');
const acceptChanges = process.argv.includes('--accept-changes');
const capture = JSON.parse(await readFile(path.join(sourceRoot, 'capture-manifest.json'), 'utf8'));
const raw = JSON.parse(await readFile(rawPath, 'utf8'));
const rows = raw.pages.flatMap((page) => page.payload.plans.data);
const units = rows.filter((unit) => unit.type === 'residential' && unit.status === 'AVAILABLE');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const shortHash = (value) => hash(value).slice(0, 16);

async function writeStablePlan(file, buffer) {
  try {
    const existing = await readFile(file);
    if (!existing.equals(buffer) && !acceptChanges) throw new Error(`${path.relative(root, file)} changed bytes at a stable public URL. Inspect the source and rerun with --accept-changes to approve the replacement.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(file, buffer);
}

await mkdir(outDir, { recursive: true });
const urls = [...new Set(units.map((unit) => unit.image))];
const media = new Map();
let cursor = 0;
async function worker() {
  while (cursor < urls.length) {
    const index = cursor;
    cursor += 1;
    const url = urls[index];
    const response = await fetch(url, { headers: { Accept: 'image/*' } });
    if (!response.ok) throw new Error(`Plan ${index + 1}/${urls.length} returned HTTP ${response.status}`);
    const original = Buffer.from(await response.arrayBuffer());
    const file = `${shortHash(url)}.webp`;
    const output = await sharp(original).rotate().trim({ background: '#ffffff' }).resize({ width: 980, height: 980, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, effort: 5 }).toBuffer();
    await writeStablePlan(path.join(outDir, file), output);
    const metadata = await sharp(output).metadata();
    media.set(url, { sourceUrl: url, sourceBytes: original.length, sourceSha256: hash(original), file: `/c1/plans/${file}`, outputBytes: output.length, outputSha256: hash(output), mime: 'image/webp', width: metadata.width, height: metadata.height });
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));

const missingIds = new Set(capture.missingFromBuilding.map((unit) => unit.crmId));
const normalizedUnits = units.map((unit, sourceOrder) => ({
  id: String(unit.id), crmId: String(unit.crm_id), sourceOrder, number: String(unit.number), rooms: Number(unit.rooms), area: Number(unit.square), floor: Number(unit.floor), section: String(unit.section), phase: String(unit.queue), completionYear: String(unit.end), status: unit.status, priceVisible: Boolean(unit.is_price), plan: media.get(unit.image).file, sourcePlanSha256: media.get(unit.image).sourceSha256, localPlanSha256: media.get(unit.image).outputSha256, sourceCreatedAt: unit.created_at, sourceUpdatedAt: unit.updated_at, hasOfficialFloorPolygon: !missingIds.has(String(unit.crm_id)),
}));
const values = (key) => [...new Set(normalizedUnits.map((unit) => unit[key]))].sort((a, b) => Number(a) - Number(b));
const countBy = (key) => Object.fromEntries(values(key).map((value) => [String(value), normalizedUnits.filter((unit) => unit[key] === value).length]));
const snapshot = {
  project: { id: 2, slug: 'c1', name: 'C1', class: 'premium', blockCount: 1, apartmentCount: 252, phaseCount: 1, siteAreaM2: 4300, buildingFloors: 30, completion: 'Q1 2028' },
  capturedAt: capture.captureCompletedAt, serverDate: capture.serverDates.finalResult, availableTotal: normalizedUnits.length, interactiveBuildingTotal: capture.counts.buildingAvailableUnique, missingOfficialFloorPolygons: capture.missingFromBuilding, reconciliation: capture.reconciliation,
  counts: { rooms: countBy('rooms') },
  filters: { rooms: values('rooms'), sections: values('section'), phases: values('phase'), floors: values('floor'), area: { min: Math.min(...normalizedUnits.map((unit) => unit.area)), max: Math.max(...normalizedUnits.map((unit) => unit.area)) } },
  units: normalizedUnits,
};
if (normalizedUnits.some((unit) => unit.priceVisible)) throw new Error('Official is_price changed; numeric prices must not be published.');
await writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(manifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: rawPath, uniqueSourceImages: urls.length, outputDirectory: outDir, assets: [...media.values()] }, null, 2)}\n`);
console.log(`Built ${normalizedUnits.length} C1 AVAILABLE units with ${urls.length} local optimized plans.`);
