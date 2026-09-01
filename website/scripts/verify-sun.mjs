import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fullBundle = process.argv.includes('--full-bundle');
const sourceRoot = resolve(websiteRoot, 'source/sun');
const publicRoot = resolve(websiteRoot, 'public');

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function walk(root, relative = '') {
  const entries = await readdir(resolve(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else files.push(child);
  }
  return files.sort();
}

const catalogPath = resolve(websiteRoot, 'data/sun-client.json');
const catalogBuffer = await readFile(catalogPath);
const catalogText = catalogBuffer.toString('utf8');
const catalog = JSON.parse(catalogText);
assert.equal(catalog.schemaVersion, 2, 'SUN client schema must be v2');
assert.equal(catalog.projectSlug, 'sun');
assert.equal(catalog.summary.available, 51);
assert.equal(catalog.summary.reserve, 41);
assert.equal(catalog.summary.sold, 214);
assert.equal(catalog.units.length, 51);
assert.equal(catalog.groups.length, 4);
assert.equal(catalog.matrixRows.length, 47);
assert.deepEqual(catalog.summary.availableByRooms, { 1: 18, 2: 31, 3: 2 });
assert.deepEqual(catalog.summary.areaRange, { min: 34.61, max: 83.9 });
assert.deepEqual(catalog.summary.priceRange, { min: 867730752, max: 1966290516 });

const unitKeys = new Set();
const planPaths = new Set();
for (const unit of catalog.units) {
  assert.match(unit.unitKey, /^sun-[a-z0-9-]+$/);
  assert.equal(unit.id, unit.unitKey);
  assert(!unitKeys.has(unit.unitKey), `Duplicate SUN public key ${unit.unitKey}`);
  unitKeys.add(unit.unitKey);
  assert.equal(unit.status, 'available');
  assert.equal(unit.price, unit.effectivePrice);
  assert.equal(unit.regularPrice, unit.effectivePrice);
  assert.equal(unit.snapshotCampaignPrice, null);
  assert.equal(unit.campaignActive, false);
  assert.equal(unit.campaignDeadline, null);
  assert(Number.isSafeInteger(unit.price) && unit.price > 0);
  assert(Number.isSafeInteger(unit.pricePerM2) && unit.pricePerM2 > 0);
  for (const path of [unit.primaryPlanPath, unit.secondPlanPath]) {
    assert.match(path, /^\/sun\/plans\/[a-f0-9]{16}-(?:primary|second)\.webp$/);
    assert(await exists(resolve(publicRoot, path.slice(1))), `Missing public SUN plan ${path}`);
    planPaths.add(path);
  }
}
assert.equal(planPaths.size, 32);

for (const row of catalog.matrixRows) {
  assert(Array.isArray(row.unitIds));
  assert(row.unitIds.every((key) => unitKeys.has(key)), `Matrix row ${row.id} contains a non-public or unknown unit key`);
  assert.deepEqual(Object.keys(row.statusCounts).sort(), ['available', 'reserve', 'sold']);
}

const forbiddenClientTokens = [
  'api.macroserver.uz', 'macroserver.uz/estate/files', 'auth_token', 'signed-catalog',
  'sourceUrl', 'captureUrl', 'localSourcePath', 'detailLocalPath', 'floorPlanSourceUrl',
  'crmId', 'internalId', 'houseId', 'planId', 'fileId', 'private-canonical',
];
for (const token of forbiddenClientTokens) assert(!catalogText.includes(token), `SUN client catalog leaked ${token}`);
assert(!/\b5092\d{3}\b/.test(catalogText), 'SUN client catalog leaked a raw CRM entity ID');
assert(!/\b380\d{4}\b/.test(catalogText), 'SUN client catalog leaked a raw CRM file ID');

const sourceFiles = [
  'app/sun/page.tsx', 'app/sun/sun-page.tsx', 'app/sun/sun.css', 'app/sun/sun-shared.css',
  'app/sun/sun-lead.ts', 'app/sun/sun-ui.ts', 'app/sun/apartments/page.tsx',
  'app/sun/apartments/sun-catalog.tsx', 'app/sun/apartments/sun-catalog.css',
  'app/api/sun-lead/route.ts', 'app/sitemap.ts', 'app/robots.ts',
];
const sourceText = (await Promise.all(sourceFiles.map((path) => readFile(resolve(websiteRoot, path), 'utf8')))).join('\n');
for (const language of ['ru', 'uz', 'en']) assert(sourceText.includes(language), `SUN source is missing ${language}`);
for (const mode of ['cards', 'chess']) assert(sourceText.includes(mode), `SUN source is missing ${mode}`);
assert(!sourceText.includes('Matrix+') && !sourceText.includes("'chess-plus':"), 'SUN must expose exactly one matrix mode');
assert(sourceText.includes("value === 'chess-plus'") && sourceText.includes("value === 'matrix-plus'") && sourceText.includes("url.searchParams.set('mode', 'chess')"), 'SUN must normalize legacy matrix mode URLs');
assert(sourceText.includes('project=sun&lang='), 'SUN privacy links must keep project and language context');
assert(sourceText.includes("projectSlug', 'sun'"), 'SUN lead context is missing projectSlug');
assert(sourceText.includes("['unitKey'"), 'SUN unit lead context is missing the public key');
assert(!sourceText.includes("from '@/source/sun"), 'SUN runtime must not import private source data');
assert(!sourceText.includes('mode=floor') && !sourceText.includes("'floor-plan'"), 'SUN must not expose a floor-plan catalogue mode');

const expectedPublic = [
  'sun/logo.svg', 'sun/h2h-logo.svg', 'sun/video/hero-desktop.mp4', 'sun/video/hero-mobile.mp4',
  'sun/sun-official-booklet.pdf', 'sun/images/overview.webp', 'sun/images/construction-a.webp',
  'sun/images/construction-v.webp', 'sun/images/construction-d.webp', 'sun/images/construction-g.webp',
];
for (const path of expectedPublic) assert(await exists(resolve(publicRoot, path)), `Missing SUN public asset ${path}`);

if (fullBundle) {
  assert(await exists(resolve(sourceRoot, 'capture-index.json')), 'SUN frozen capture is missing');
  assert(!(await exists(resolve(sourceRoot, 'private-canonical.json'))), 'SUN private canonical must not be a frontend runtime artefact');
  const capture = await json(resolve(sourceRoot, 'capture-index.json'));
  assert.equal(capture.operation, 'network');
  assert.equal(capture.assertions.objectCount, 306);
  assert.deepEqual(capture.assertions.rawStatusCounts, { available: 51, booked: 41, sold: 214 });
  assert.deepEqual(capture.assertions.normalizedStatusCounts, { available: 51, reserve: 41, sold: 214 });
  assert.equal(capture.assertions.availableDetailSuccess, 51);
  assert.equal(capture.assertions.planFileCount, 32);
  assert.equal(capture.assertions.floorPlanFileCount, 27);
  const records = new Map(capture.records.map((record) => [record.localPath, record]));
  assert.equal(records.size, capture.records.length);
  for (const [localPath, record] of records) {
    const buffer = await readFile(resolve(sourceRoot, localPath));
    assert.equal(buffer.byteLength, record.localByteSize, `${localPath}: byte count mismatch`);
    assert.equal(sha256(buffer), record.localSha256, `${localPath}: digest mismatch`);
  }
  const publicFiles = await walk(resolve(publicRoot, 'sun'));
  assert.equal(publicFiles.length, 75, 'SUN public bundle file count changed');
}

console.log(`SUN ${fullBundle ? 'full integrity' : 'runtime'} verification passed: 51 sanitized keys, 47 matrix rows, 32 lazy plan assets, 3 languages, 2 catalogue modes, no CRM IDs or signed URLs in client data.`);
