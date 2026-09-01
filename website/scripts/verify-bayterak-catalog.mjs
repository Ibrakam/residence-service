import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBayterakCatalog } from './build-bayterak-catalog.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const resolveRepoPath = (path) => resolve(websiteRoot, path);
const readJson = async (path) => JSON.parse(await readFile(resolveRepoPath(path), 'utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const [catalog, sources, layouts, rawPlacement, rawFilter, rawEstate] = await Promise.all([
  readJson('data/bayterak-catalog.json'),
  readJson('data/bayterak-sources.json'),
  readJson('data/bayterak-layout-sources.json'),
  readFile(resolveRepoPath('data/bayterak-placement-raw.json')),
  readFile(resolveRepoPath('data/bayterak-filter-raw.json')),
  readFile(resolveRepoPath('data/bayterak-real-estate-raw.json')),
]);
const rawRows = JSON.parse(rawPlacement).placements;
const frozen = sources.catalog;
const expectedCount = frozen?.officialTotalAtCapture;
const expectedHashes = {
  placementList: frozen?.placementListSha256,
  filter: frozen?.filterSha256,
  realEstateList: frozen?.realEstateListSha256,
};

if (!Number.isInteger(expectedCount) || expectedCount <= 0) fail('Frozen source manifest has no apartment count');
for (const [name, expected] of Object.entries(expectedHashes)) {
  if (!validHash(expected)) fail(`Frozen source manifest has no valid ${name} SHA-256`);
}
if (sha256(rawPlacement) !== expectedHashes.placementList) fail('placementList raw hash mismatch');
if (sha256(rawFilter) !== expectedHashes.filter) fail('filter raw hash mismatch');
if (sha256(rawEstate) !== expectedHashes.realEstateList) fail('realEstateList raw hash mismatch');
if (rawRows.length !== expectedCount || catalog.officialTotalAtCapture !== expectedCount || catalog.units.length !== expectedCount) {
  fail(`Frozen apartment count mismatch (expected ${expectedCount})`);
}
if (catalog.capturedAt !== sources.capturedAt) fail('Catalog timestamp differs from frozen source manifest');
if ('rawPlacementListPath' in catalog.integrity) fail('Catalog integrity still contains the obsolete raw/placementList.json path');
if (catalog.integrity.rawPlacementListBytes !== rawPlacement.byteLength) fail('Catalog raw placement byte count mismatch');
if (catalog.integrity.rawPlacementListSha256 !== expectedHashes.placementList) fail('Catalog raw placement hash mismatch');
if (catalog.sourceApis.placementList.sha256 !== expectedHashes.placementList) fail('Catalog placementList provenance hash mismatch');
if (catalog.sourceApis.filter.sha256 !== expectedHashes.filter) fail('Catalog filter provenance hash mismatch');
if (catalog.sourceApis.realEstateList.sha256 !== expectedHashes.realEstateList) fail('Catalog realEstateList provenance hash mismatch');

const rebuilt = await buildBayterakCatalog();
if (!isDeepStrictEqual(catalog, rebuilt)) fail('Catalog differs from deterministic offline rebuild');

if (new Set(catalog.units.map((unit) => unit.id)).size !== expectedCount) fail('Catalog unit UUIDs are not unique');
if (new Set(catalog.units.map((unit) => unit.planSourceUrls.primary1600)).size !== expectedCount) fail('Catalog primary plan URLs are not unique');
const rawById = new Map(rawRows.map((row) => [row.uuid, row]));
for (const unit of catalog.units) {
  const source = rawById.get(unit.id);
  const campaign = source?.discount?.stock?.data?.[0];
  if (!source || !campaign) fail(`Missing raw/campaign row for ${unit.id}`);
  if (unit.price !== campaign.priceWithDiscount) fail(`Campaign price mismatch for ${unit.id}`);
  if (unit.oldPrice !== source.totalPrice) fail(`Original price mismatch for ${unit.id}`);
  if (unit.totalPriceWithDiscountRaw !== source.totalPriceWithDiscount) fail(`Raw totalPriceWithDiscount mismatch for ${unit.id}`);
  if (unit.currentPricePerM2 !== Math.round(unit.price / unit.area)) fail(`Derived currentPricePerM2 mismatch for ${unit.id}`);
  if (unit.sourcePricePerM2 !== source.priceBySquare) fail(`sourcePricePerM2 mismatch for ${unit.id}`);
  if (unit.statusOriginal !== source.placementStatusName || unit.statusId !== source.placementStatusId) fail(`Workflow status mismatch for ${unit.id}`);
}

const expectedPlanCount = sources.floorplans?.count;
if (expectedPlanCount !== expectedCount || layouts.count !== expectedPlanCount || layouts.items?.length !== expectedPlanCount) {
  fail('Layout manifest count differs from frozen provenance');
}
if (!layouts.allHttp200 || !layouts.allLocalPlansPresent || !layouts.sourceResponsesCapturedForHashing) fail('Layout manifest integrity flags are incomplete');
const planIds = new Set();
const expectedPlanFiles = new Set();
let preparedPlanBytes = 0;
let sourcePlanBytes = 0;
for (const item of layouts.items) {
  if (planIds.has(item.unitId)) fail(`Duplicate layout manifest unit: ${item.unitId}`);
  planIds.add(item.unitId);
  const source = rawById.get(item.unitId);
  if (!source || item.sourceUrl !== source.photoURL1600) fail(`Layout source mismatch: ${item.unitId}`);
  if (item.preparedRepoPath !== `public${item.local}`) fail(`Layout manifest path mismatch: ${item.unitId}`);
  if (!validHash(item.sourceSha256) || !validHash(item.localSha256)) fail(`Layout manifest hash is invalid: ${item.unitId}`);
  const localPath = resolveRepoPath(item.preparedRepoPath);
  const buffer = await readFile(localPath);
  const fileStats = await stat(localPath);
  if (fileStats.size !== item.localSizeBytes || buffer.byteLength !== item.localSizeBytes) fail(`Local plan size mismatch: ${item.unitId}`);
  if (sha256(buffer) !== item.localSha256) fail(`Local plan hash mismatch: ${item.unitId}`);
  if (item.sourceHttpStatus !== 200 || item.sourceSizeBytes <= 0) fail(`Source plan provenance is incomplete: ${item.unitId}`);
  expectedPlanFiles.add(item.preparedRepoPath.slice('public/bayterak/plans/'.length));
  preparedPlanBytes += item.localSizeBytes;
  sourcePlanBytes += item.sourceSizeBytes;
}
const planFiles = (await readdir(resolveRepoPath('public/bayterak/plans'))).filter((name) => name.endsWith('.webp'));
if (planFiles.length !== expectedPlanCount || planFiles.some((name) => !expectedPlanFiles.has(name))) {
  fail(`Local plan file set differs from the ${expectedPlanCount}-row manifest`);
}
if (preparedPlanBytes !== layouts.preparedTotalBytes || preparedPlanBytes !== sources.floorplans.preparedTotalBytes) fail('Prepared plan byte total mismatch');
if (sourcePlanBytes !== layouts.sourceTotalBytes || sourcePlanBytes !== sources.floorplans.sourceTotalBytes) fail('Source plan byte total mismatch');

const visualAssets = sources.visualAssets;
if (!Array.isArray(visualAssets) || visualAssets.length === 0) fail('Visual source manifest is empty');
const visualIds = new Set();
const expectedVisualFiles = new Set();
for (const asset of visualAssets) {
  if (visualIds.has(asset.id)) fail(`Duplicate visual asset ID: ${asset.id}`);
  visualIds.add(asset.id);
  if (asset.web.repoPath !== `public${asset.web.intendedPublicPath}`) fail(`Visual manifest path mismatch: ${asset.id}`);
  if (!validHash(asset.source.sha256) || !validHash(asset.web.sha256)) fail(`Visual manifest hash is invalid: ${asset.id}`);
  if (asset.source.httpStatus !== 200 || asset.source.bytes <= 0) fail(`Visual source provenance is incomplete: ${asset.id}`);
  const localPath = resolveRepoPath(asset.web.repoPath);
  const buffer = await readFile(localPath);
  const fileStats = await stat(localPath);
  if (fileStats.size !== asset.web.bytes || buffer.byteLength !== asset.web.bytes) fail(`Visual asset size mismatch: ${asset.id}`);
  if (sha256(buffer) !== asset.web.sha256) fail(`Visual asset hash mismatch: ${asset.id}`);
  expectedVisualFiles.add(asset.web.repoPath.slice('public/bayterak/images/'.length));
}
const visualFiles = (await readdir(resolveRepoPath('public/bayterak/images'))).filter((name) => name.endsWith('.webp'));
if (visualFiles.length !== visualAssets.length || visualFiles.some((name) => !expectedVisualFiles.has(name))) fail('Local visual file set differs from source manifest');

const bookletSource = sources.officialSources?.booklet;
if (!bookletSource || !validHash(bookletSource.sha256) || bookletSource.bytes <= 0 || bookletSource.pages <= 0) fail('Booklet provenance is incomplete');
if (bookletSource.repoPath !== `public${bookletSource.local}`) fail('Booklet manifest path mismatch');
const bookletPath = resolveRepoPath(bookletSource.repoPath);
const booklet = await readFile(bookletPath);
const bookletStats = await stat(bookletPath);
if (bookletStats.size !== bookletSource.bytes || sha256(booklet) !== bookletSource.sha256) fail('Booklet integrity mismatch');

console.log(`Bayterak integrity OK: ${expectedCount} apartments, ${expectedPlanCount} local plans, ${visualAssets.length} official visuals, raw API hashes and ${bookletSource.pages}-page booklet verified.`);
