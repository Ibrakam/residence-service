import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const rawPath = path.join(root, 'source', 'saadiyat', 'raw', 'plans-all-pages.json');
const outDir = path.join(root, 'public', 'saadiyat', 'plans');
const dataPath = path.join(root, 'data', 'saadiyat-catalog.json');
const planManifestPath = path.join(root, 'source', 'saadiyat', 'plans-manifest.json');
const captureManifest = JSON.parse(await readFile(path.join(root, 'source', 'saadiyat', 'capture-manifest.json'), 'utf8'));
const raw = JSON.parse(await readFile(rawPath, 'utf8'));
const rows = raw.pages.flatMap((page) => page.payload.plans.data);
const units = rows.filter((unit) => unit.type === 'residential' && unit.status === 'AVAILABLE');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const shortHash = (value) => hash(value).slice(0, 16);

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
    const output = await sharp(original)
      .rotate()
      .resize({ width: 980, height: 980, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    await writeFile(path.join(outDir, file), output);
    const metadata = await sharp(output).metadata();
    media.set(url, { sourceUrl: url, sourceBytes: original.length, sourceSha256: hash(original), file: `/saadiyat/plans/${file}`, outputBytes: output.length, width: metadata.width, height: metadata.height });
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));

const normalizedUnits = units.map((unit, sourceOrder) => ({
  id: String(unit.id),
  crmId: String(unit.crm_id),
  sourceOrder,
  number: String(unit.number),
  rooms: Number(unit.rooms),
  area: Number(unit.square),
  floor: Number(unit.floor),
  section: String(unit.section),
  phase: String(unit.queue),
  completionYear: String(unit.end),
  status: unit.status,
  priceVisible: Boolean(unit.is_price),
  plan: media.get(unit.image).file,
  sourcePlanSha256: media.get(unit.image).sourceSha256,
  sourceCreatedAt: unit.created_at,
  sourceUpdatedAt: unit.updated_at,
}));

const summaryValues = (key) => [...new Set(normalizedUnits.map((unit) => unit[key]))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
const snapshot = {
  project: { id: 18, slug: 'saadiyat', name: 'SAADIYAT', class: 'business' },
  capturedAt: captureManifest.captureCompletedAt,
  serverDate: captureManifest.serverDates.finalResult,
  officialUntypedTotal: captureManifest.counts.plans.all,
  excludedCommercial: captureManifest.counts.plans.commercial,
  availableResidentialTotal: normalizedUnits.length,
  reconciliation: captureManifest.reconciliation,
  filters: {
    rooms: summaryValues('rooms'), sections: summaryValues('section'), phases: summaryValues('phase'), floors: summaryValues('floor'),
    area: { min: Math.min(...normalizedUnits.map((unit) => unit.area)), max: Math.max(...normalizedUnits.map((unit) => unit.area)) },
  },
  units: normalizedUnits,
};

await writeFile(dataPath, `${JSON.stringify(snapshot, null, 2)}\n`);
await writeFile(planManifestPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), source: rawPath, uniqueSourceImages: urls.length, outputDirectory: outDir, assets: [...media.values()] }, null, 2)}\n`);
console.log(`Built ${normalizedUnits.length} available residential units with ${urls.length} local optimized plans.`);
