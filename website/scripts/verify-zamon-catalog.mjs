import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZamonCatalog } from './build-zamon-catalog.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const repoPath = (path) => resolve(websiteRoot, path);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

const [catalog, sources, plans, assets, built] = await Promise.all([
  readFile(repoPath('data/zamon-catalog.json'), 'utf8').then(JSON.parse),
  readFile(repoPath('data/zamon-sources.json'), 'utf8').then(JSON.parse),
  readFile(repoPath('data/zamon-plan-sources.json'), 'utf8').then(JSON.parse),
  readFile(repoPath('data/zamon-asset-sources.json'), 'utf8').then(JSON.parse),
  buildZamonCatalog(),
]);

if (!isDeepStrictEqual(catalog, built)) fail('Catalog differs from deterministic offline rebuild');
if (catalog.units.length !== 104 || catalog.officialTotalAtCapture !== 104) fail('Catalog count is not 104');
if (new Set(catalog.units.map((unit) => unit.id)).size !== 104) fail('Catalog UUIDs are not unique');
if (new Set(catalog.units.map((unit) => unit.plan)).size !== 104) fail('Catalog local plans are not unique');

for (const name of ['placementList', 'filter', 'realEstateList']) {
  const record = sources.catalog[name];
  const buffer = await readFile(repoPath(record.local));
  if (buffer.byteLength !== record.bytes || sha256(buffer) !== record.sha256) fail(`${name} raw integrity mismatch`);
  if (buffer.at(-1) !== 0x7d) fail(`${name} raw response no longer ends at the JSON closing brace`);
  if (record.method !== 'POST' || record.httpStatus !== 200 || !record.serverDate || !record.capturedAtUtc || !record.capturedAtUzt) fail(`${name} provenance is incomplete`);
}

if (plans.count !== 104 || plans.items?.length !== 104 || !plans.allHttp200 || !plans.sourceResponsesCapturedForHashing) fail('Plan manifest summary mismatch');
const planIds = new Set();
const planUrls = new Set();
const expectedPlanFiles = new Set();
for (const item of plans.items) {
  if (planIds.has(item.unitId) || planUrls.has(item.sourceUrl)) fail(`Duplicate plan identity: ${item.unitId}`);
  planIds.add(item.unitId);
  planUrls.add(item.sourceUrl);
  const unit = catalog.units.find((candidate) => candidate.id === item.unitId);
  if (!unit || unit.plan !== item.web.intendedPublicPath || unit.planSourceUrls.primary1600 !== item.sourceUrl) fail(`Catalog/plan mismatch: ${item.unitId}`);
  if (item.source.httpStatus !== 200 || item.source.bytes <= 0 || !validHash(item.source.sha256)) fail(`Plan source provenance is incomplete: ${item.unitId}`);
  if (!validHash(item.web.sha256) || item.web.repoPath !== `public${item.web.intendedPublicPath}`) fail(`Plan web provenance is invalid: ${item.unitId}`);
  const buffer = await readFile(repoPath(item.web.repoPath));
  const fileStat = await stat(repoPath(item.web.repoPath));
  if (buffer.byteLength !== item.web.bytes || fileStat.size !== item.web.bytes || sha256(buffer) !== item.web.sha256) fail(`Plan file integrity mismatch: ${item.unitId}`);
  expectedPlanFiles.add(item.web.repoPath.slice('public/zamon/plans/'.length));
}
const planFiles = (await readdir(repoPath('public/zamon/plans'))).filter((name) => name.endsWith('.webp'));
if (planFiles.length !== 104 || planFiles.some((name) => !expectedPlanFiles.has(name))) fail('Local plan file set differs from the manifest');

if (assets.project !== 'Zamon' || assets.visualAssets?.length !== 26) fail('Visual asset manifest summary mismatch');
const expectedVisualFiles = new Set();
for (const asset of assets.visualAssets) {
  if (!['actual-photo', 'official-cgi', 'construction-photo'].includes(asset.materialType)) fail(`Unexpected visual type: ${asset.id}`);
  if (!validHash(asset.source.sha256) || !validHash(asset.web.sha256) || asset.source.httpStatus !== 200) fail(`Visual provenance is incomplete: ${asset.id}`);
  if (asset.web.repoPath !== `public${asset.web.intendedPublicPath}`) fail(`Visual path mismatch: ${asset.id}`);
  const buffer = await readFile(repoPath(asset.web.repoPath));
  if (buffer.byteLength !== asset.web.bytes || sha256(buffer) !== asset.web.sha256) fail(`Visual integrity mismatch: ${asset.id}`);
  expectedVisualFiles.add(asset.web.repoPath.slice('public/zamon/images/'.length));
}
const visualFiles = (await readdir(repoPath('public/zamon/images'))).filter((name) => name.endsWith('.webp'));
if (visualFiles.length !== 26 || visualFiles.some((name) => !expectedVisualFiles.has(name))) fail('Local visual file set differs from the manifest');

const booklet = sources.officialSources.booklet;
if (!validHash(booklet.sha256) || booklet.bytes !== 11761189 || booklet.pages !== 36 || booklet.sha256 !== assets.booklet.sha256) fail('Booklet provenance mismatch');
const bookletBuffer = await readFile(repoPath(booklet.repoPath));
if (bookletBuffer.byteLength !== booklet.bytes || sha256(bookletBuffer) !== booklet.sha256) fail('Booklet file integrity mismatch');

const statusCounts = Object.fromEntries(catalog.statusSummary.map((status) => [status.status, status.count]));
if (!isDeepStrictEqual(statusCounts, { 'Бронирование': 1, 'Расторжение': 7, 'Свободно': 93, 'Снятие резерва': 3 })) fail('Catalog workflow summary mismatch');
if (catalog.units.filter((unit) => unit.isSale).length !== 103) fail('Catalog isSale summary mismatch');
if (catalog.units.some((unit) => unit.price !== unit.promotion.priceWithDiscount || unit.totalPriceWithDiscountRaw !== unit.oldPrice)) fail('Campaign price provenance mismatch');
if (catalog.units.some((unit) => unit.repairIncluded || unit.ceilingHeight !== 'Не менее 2,85 м')) fail('Unit specification mismatch');

console.log('Zamon integrity OK: 104 apartments, 104 official local plans, 26 official visuals, 3 byte-frozen API responses and the 36-page official booklet verified.');
