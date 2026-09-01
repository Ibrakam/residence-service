import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJomiyCatalog } from './build-jomiy-catalog.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(websiteRoot, 'source/jomiy');
const publicRoot = resolve(websiteRoot, 'public');
const fullBundle = process.argv.includes('--full-bundle');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function asMap(items) { return Object.fromEntries(items.map(({ value, count }) => [String(value), count])); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }

async function assertFile(path, expectedBytes, expectedHash, label) {
  const buffer = await readFile(path);
  assert(buffer.byteLength === expectedBytes, `${label}: expected ${expectedBytes} bytes, found ${buffer.byteLength}`);
  assert(sha256(buffer) === expectedHash, `${label}: SHA-256 mismatch`);
}

async function verifyBundleManifest() {
  const manifest = await json(resolve(sourceRoot, 'bundle-manifest.json'));
  assert(manifest.manifestSelfExcluded === true && manifest.fileCount === 926, 'Unexpected source bundle manifest topology');
  assert(manifest.totalBytes === 657158807, 'Unexpected source bundle byte count');
  if (!fullBundle) {
    const critical = new Set([
      'api-manifest.json', 'api/placement-list-page-1.json', 'api/placement-list-page-2.json', 'api/filter.json', 'api/real-estate-list.json', 'api/placement-list-confirmation.json',
      'source-manifest.json', 'fact-provenance.json', 'jomiy-catalog-draft.json', 'plan-derivatives-manifest.json', 'media-derivatives-manifest.json', 'cms-source-manifest.json', 'integrity-report.json', 'import-map.json',
    ]);
    const entries = manifest.files.filter((entry) => critical.has(entry.localPath) || entry.localPath.startsWith('api/details/'));
    assert(entries.length === 135, `Expected 135 critical source files, found ${entries.length}`);
    await Promise.all(entries.map((entry) => assertFile(resolve(sourceRoot, entry.localPath), entry.bytes, entry.sha256, entry.localPath)));
    return { checked: entries.length, total: manifest.fileCount };
  }
  for (const entry of manifest.files) await assertFile(resolve(sourceRoot, entry.localPath), entry.bytes, entry.sha256, entry.localPath);
  return { checked: manifest.fileCount, total: manifest.fileCount };
}

async function verifyPublicDerivatives() {
  const [plans, media] = await Promise.all([
    json(resolve(sourceRoot, 'plan-derivatives-manifest.json')),
    json(resolve(sourceRoot, 'media-derivatives-manifest.json')),
  ]);
  const derivatives = [];
  for (const item of plans.items) derivatives.push(item.layout.derivative, item.page1.derivative, item.page2.derivative);
  for (const item of media.items) derivatives.push(item.derivative);
  assert(derivatives.length === 387, `Expected 387 public derivatives, found ${derivatives.length}`);
  assert(new Set(derivatives.map((item) => item.publicPath)).size === 387, 'Public derivative paths are not unique');
  await Promise.all(derivatives.map((item) => {
    assert(item.publicPath.startsWith('/jomiy/'), `Unsafe public derivative path: ${item.publicPath}`);
    return assertFile(resolve(publicRoot, item.publicPath.slice(1)), item.bytes, item.sha256, item.publicPath);
  }));
  return derivatives.length;
}

function activeAt(deadlineUtc, epochMs) { return Boolean(deadlineUtc) && epochMs < Date.parse(deadlineUtc); }

async function main() {
  const catalog = await buildJomiyCatalog();
  const [catalogUiSource, catalogPageSource, landingUiSource, leadApiSource] = await Promise.all([
    readFile(resolve(websiteRoot, 'app/jomiy/apartments/jomiy-catalog.tsx'), 'utf8'),
    readFile(resolve(websiteRoot, 'app/jomiy/apartments/page.tsx'), 'utf8'),
    readFile(resolve(websiteRoot, 'app/jomiy/jomiy-page.tsx'), 'utf8'),
    readFile(resolve(websiteRoot, 'app/api/jomiy-lead/route.ts'), 'utf8'),
  ]);
  const rooms = asMap(catalog.filterSummary.rooms);
  const statuses = asMap(catalog.filterSummary.statuses);
  const isSale = asMap(catalog.filterSummary.isSale);
  const canBuy = asMap(catalog.filterSummary.canBuy);
  assert(catalog.capturedAt === '2026-08-30T18:47:55.530Z' && catalog.capturedAtUzt === '2026-08-30T23:47:55.530+05:00', 'Capture timestamp mismatch');
  assert(catalog.units.length === 121 && catalog.integrity.uniqueUnitIds === 121, 'Catalog row/UUID count mismatch');
  assert(JSON.stringify(rooms) === JSON.stringify({ 1: 2, 2: 76, 3: 37, 4: 6 }), 'Room distribution mismatch');
  assert(statuses['Снятие резерва'] === 107 && statuses['Расторжение'] === 7 && statuses['Снятие брони'] === 5 && statuses['Бронирование'] === 2 && statuses['Свободно'] === undefined, 'Status distribution mismatch');
  assert(isSale.true === 119 && isSale.false === 2, 'isSale distribution mismatch');
  assert(canBuy.true === 116 && canBuy.false === 5, 'canBuy distribution mismatch');
  assert(catalog.units.filter((unit) => unit.isSale && unit.canBuy).length === 114, 'Combined isSale/canBuy count mismatch');
  assert(catalog.offerCount === 0 && catalog.units.every((unit) => !unit.strictOfferEligible), 'Strict Offer policy mismatch');
  assert(catalog.filterSummary.ranges.area.min === 40.86 && catalog.filterSummary.ranges.area.max === 124.5, 'Area range mismatch');
  assert(catalog.filterSummary.ranges.rawTotalPrice.min === 760059580 && catalog.filterSummary.ranges.rawTotalPrice.max === 2144637000, 'Raw price range mismatch');
  assert(catalog.filterSummary.ranges.floor.min === 1 && catalog.filterSummary.ranges.floor.max === 12 && catalog.units.every((unit) => unit.totalFloors === 12), 'Floor range mismatch');
  assert(catalog.units.every((unit) => unit.propertyClass === 'Бизнес' && unit.ceilingHeight === 'Не менее 3,0 м' && !unit.repairIncluded), 'Class, ceiling or finishing mismatch');
  assert(catalog.units.every((unit) => unit.placement3dTour === null), 'Unexpected 3D tour');
  assert(catalog.integrity.uniqueSheetPage1Urls === 121 && catalog.integrity.uniqueSheetPage2Urls === 121, 'Official sheets are not unique');
  assert(catalog.units.every((unit) => unit.thumbnail === `/jomiy/layouts/${unit.id}.webp` && unit.sheetPage1 === `/jomiy/sheets/page-1/${unit.id}.webp` && unit.sheetPage2 === `/jomiy/sheets/page-2/${unit.id}.webp`), 'Local derivative path mapping mismatch');
  assert(catalog.stableMatrix.groupEntranceCombinations === 7 && catalog.stableMatrix.rowsPerEntrance === 12 && catalog.stableMatrix.totalRows === 84, 'Stable matrix topology mismatch');
  assert(catalog.filterSummary.groups[0].id === 'd7207ffd-9265-11ed-a82b-001dd8b726aa' && catalog.filterSummary.groups[0].count === 5 && catalog.filterSummary.groups[0].normalizedDeadline === '2025-12-28', 'Phase 2.1 mismatch');
  assert(catalog.filterSummary.groups[1].id === '31c49bc8-9266-11ed-a82b-001dd8b726aa' && catalog.filterSummary.groups[1].count === 116 && catalog.filterSummary.groups[1].normalizedDeadline === '2027-09-18', 'Phase 2.2 mismatch');
  assert(catalog.units.filter((unit) => unit.promotion?.percent === 20 && unit.promotion.deadlineUtc === '2026-08-31T17:59:59.000Z').length === 5, 'Phase 2.1 campaign mismatch');
  assert(catalog.units.filter((unit) => unit.promotion?.percent === 12 && unit.promotion.deadlineUtc === '2026-12-31T17:59:59.000Z').length === 116, 'Phase 2.2 campaign mismatch');
  for (const deadline of ['2026-08-31T17:59:59.000Z', '2026-12-31T17:59:59.000Z']) {
    const moment = Date.parse(deadline);
    assert(activeAt(deadline, moment - 1) && !activeAt(deadline, moment) && !activeAt(deadline, moment + 1), `Promotion expiry policy failed for ${deadline}`);
    const unit = catalog.units.find((entry) => entry.promotion?.deadlineUtc === deadline);
    assert(unit && unit.price < unit.oldPrice, `Missing campaign price sample for ${deadline}`);
    assert((activeAt(deadline, moment - 1) ? unit.price : unit.oldPrice) === unit.price, `Campaign price should be effective before ${deadline}`);
    assert((activeAt(deadline, moment) ? unit.price : unit.oldPrice) === unit.oldPrice, `Regular price should be effective at ${deadline}`);
  }
  assert(catalogPageSource.includes("headers()).get('x-jomiy-evaluation-time')") && catalogPageSource.includes('Number.MAX_SAFE_INTEGER') && catalogUiSource.includes('useState(initialEvaluationTime)'), 'SSR promotion evaluation must start from request time with a conservative fallback');
  assert(catalogUiSource.includes('evaluationTime < deadlineTime') && catalogUiSource.includes('nearest - now + 1'), 'Client promotion policy must expire strictly and refresh at the exact boundary');
  assert(catalogUiSource.includes('function leadPriceSnapshotAt') && catalogUiSource.includes('remember(unit, evaluationTime)') && catalogUiSource.includes('snapshotCampaignPrice') && catalogUiSource.includes('campaignActive='), 'Lead payload must use the shared promotion clock and explicit price fields');
  assert(leadApiSource.includes('priceSnapshotAt(unit, Date.now())') && leadApiSource.includes("context.get('effectivePrice')") && leadApiSource.includes('viewed.snapshotCampaignPrice === pricing.snapshotCampaignPrice'), 'Local lead handler must validate request-time effective and snapshot prices');
  assert(landingUiSource.includes('leadOpenRef.current || event.defaultPrevented') && landingUiSource.includes('selectMenuLanguage'), 'Landing nested-layer Escape and menu language focus policy is missing');
  assert(catalogUiSource.includes('Две группы образуют семь реальных комбинаций') && catalogUiSource.includes('Ikki guruh “guruh × kirish”ning yettita haqiqiy kombinatsiyasini') && catalogUiSource.includes('Two groups form seven real “group × entrance” combinations'), 'Matrix topology hint must describe seven group/entrance combinations and 84 rows');
  const [bundle, publicCount] = await Promise.all([verifyBundleManifest(), verifyPublicDerivatives()]);
  const output = await json(resolve(websiteRoot, 'data/jomiy-catalog.json'));
  assert(JSON.stringify(output) === JSON.stringify(catalog), 'Generated catalog differs from deterministic offline rebuild');
  const bundleHash = sha256(await readFile(resolve(sourceRoot, 'bundle-manifest.json')));
  assert(bundleHash === '7dbf9a3d08d53ea4706a7aeee6e65cefcf94955a30103003a40c73fe7940951e', 'Bundle manifest SHA-256 mismatch');
  assert((await stat(resolve(publicRoot, 'jomiy'))).isDirectory(), 'public/jomiy is missing');
  console.log(`Jomiy integrity verified: 121 entries, 121 details, 242 sheets, 121 compact layouts, ${publicCount} public derivatives, ${bundle.checked}/${bundle.total} source bundle files, 84 matrix rows, 0 Offers.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
