import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const auditCapture = process.argv.includes('--audit-capture');
const snapshot = JSON.parse(await readFile(path.join(root, 'data', 'c1-catalog.json'), 'utf8'));
const mediaManifest = JSON.parse(await readFile(path.join(root, 'data', 'c1-media-manifest.json'), 'utf8'));
const landing = await readFile(path.join(root, 'app', 'c1', 'c1-page.tsx'), 'utf8');
const landingPage = await readFile(path.join(root, 'app', 'c1', 'page.tsx'), 'utf8');
const landingCSS = await readFile(path.join(root, 'app', 'c1', 'c1.css'), 'utf8');
const catalogue = await readFile(path.join(root, 'app', 'c1', 'apartments', 'c1-catalog.tsx'), 'utf8');
const cataloguePage = await readFile(path.join(root, 'app', 'c1', 'apartments', 'page.tsx'), 'utf8');
const catalogueCSS = await readFile(path.join(root, 'app', 'c1', 'apartments', 'c1-catalog.css'), 'utf8');
const language = await readFile(path.join(root, 'app', 'c1', 'c1-language.ts'), 'utf8');
const assetBuilder = await readFile(path.join(root, 'scripts', 'build-c1-assets.mjs'), 'utf8');
const catalogueBuilder = await readFile(path.join(root, 'scripts', 'build-c1-catalog.mjs'), 'utf8');
const captureScript = await readFile(path.join(root, 'scripts', 'capture-c1.mjs'), 'utf8');
const proxy = await readFile(path.join(root, 'proxy.ts'), 'utf8');
const fail = (message) => { throw new Error(message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const sorted = (values) => [...values].sort();
const sameValues = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));

function detectedMime(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return 'application/octet-stream';
}

function mp4Dimensions(buffer) {
  const marker = buffer.indexOf(Buffer.from('tkhd'));
  if (marker < 4) return null;
  const start = marker - 4; const size = buffer.readUInt32BE(start); const end = start + size;
  if (size < 16 || end > buffer.length) return null;
  return { width: buffer.readUInt32BE(end - 8) / 65536, height: buffer.readUInt32BE(end - 4) / 65536 };
}

if (snapshot.availableTotal !== 42 || snapshot.units.length !== 42) fail('Expected 42 canonical AVAILABLE apartments.');
if (snapshot.interactiveBuildingTotal !== 39 || snapshot.missingOfficialFloorPolygons.length !== 3) fail('Expected the documented 42-vs-39 building reconciliation.');
if (snapshot.missingOfficialFloorPolygons.some((unit) => unit.floor !== 26) || snapshot.units.filter((unit) => !unit.hasOfficialFloorPolygon).length !== 3) fail('Exactly three floor-26 units must remain API-only without polygons.');
if (JSON.stringify(snapshot.counts.rooms) !== JSON.stringify({ 1: 19, 2: 6, 3: 7, 4: 5, 5: 5 })) fail('Room counts changed.');
if (snapshot.filters.area.min !== 30.41 || snapshot.filters.area.max !== 242.32) fail('Area range changed.');
if (Math.min(...snapshot.units.map((unit) => unit.floor)) !== 5 || Math.max(...snapshot.units.map((unit) => unit.floor)) !== 30) fail('Available floor range changed.');
if (snapshot.units.some((unit) => unit.status !== 'AVAILABLE' || unit.priceVisible)) fail('Unavailable or public-price unit entered the catalogue.');
if (snapshot.units.some((unit) => !/^\/c1\/plans\/[a-f0-9]{16}\.webp$/.test(unit.plan) || !/^[a-f0-9]{64}$/.test(unit.sourcePlanSha256) || !/^[a-f0-9]{64}$/.test(unit.localPlanSha256))) fail('A plan path or integrity digest is invalid.');

const planFiles = new Map();
for (const unit of snapshot.units) {
  const expected = planFiles.get(unit.plan);
  if (expected && expected !== unit.localPlanSha256) fail(`${unit.plan} has conflicting local digests.`);
  planFiles.set(unit.plan, unit.localPlanSha256);
}
for (const [file, expected] of planFiles) {
  const buffer = await readFile(path.join(root, 'public', file));
  if (sha256(buffer) !== expected) fail(`${file} no longer matches localPlanSha256.`);
  const metadata = await sharp(buffer).metadata();
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height) fail(`${file} is not a readable WebP plan.`);
}

if (mediaManifest.version !== 1 || mediaManifest.assets.length !== 19 || new Set(mediaManifest.assets.map((asset) => asset.outputFile)).size !== mediaManifest.assets.length) fail('Versioned C1 public-media manifest is incomplete.');
for (const asset of mediaManifest.assets) {
  const buffer = await readFile(path.join(root, 'public', asset.outputFile));
  if (buffer.length !== asset.outputBytes || sha256(buffer) !== asset.outputSha256 || detectedMime(buffer) !== asset.mime) fail(`${asset.outputFile} failed bytes/SHA/MIME verification.`);
  const dimensions = asset.mime === 'image/webp' ? await sharp(buffer).metadata() : mp4Dimensions(buffer);
  if (!dimensions || dimensions.width !== asset.width || dimensions.height !== asset.height) fail(`${asset.outputFile} dimensions changed.`);
}

if (/pb12218|profitbase\.ru|mbc\.uz\/storage/.test(`${landing}\n${catalogue}`)) fail('Runtime component contains a remote media hotlink.');
if (!/\(\['cards', 'chess'\] as Mode\[\]\)/.test(catalogue) || /chessPlus|floorPlan|Шахматка\+|План этажа/.test(catalogue)) fail('Catalogue modes violate the Cards + single Chessboard contract.');
if (!/projectSlug=c1/.test(`${landing}\n${catalogue}`) || !/unitId=\$\{/.test(`${landing}\n${catalogue}`) || !/project=c1&lang=\$\{language\}&from=/.test(`${landing}\n${catalogue}`)) fail('Lead or privacy context is incomplete.');
if (!/\+998 78 113 77 12/.test(`${landing}\n${catalogue}`)) fail('TENCORP phone is missing.');
if (!/useSearchParams/.test(landing) || !/useSearchParams/.test(catalogue) || !/useC1DocumentLanguage\(language\)/.test(landing) || !/useC1DocumentLanguage\(language\)/.test(catalogue)) fail('Live URL language handling is incomplete.');
if (!/root\.lang = language/.test(language) || !/root\.lang === language/.test(language) || !/'\/c1'/.test(proxy) || !/'\/c1\/apartments'/.test(proxy) || /'\/c1\/:path\*'/.test(proxy)) fail('Document language proxy must target only the two C1 document routes.');
if (!/@media\(max-width:850px\).*\.c1c-chess-layout\{display:flex;flex-direction:column\}.*\.c1c-detail\{position:static;width:100%;order:2\}/s.test(catalogueCSS)) fail('Tablet chessboard must stack above a full-width detail panel.');
if (!/hasOfficialFloorPolygon/.test(catalogue) || !/is-api-only/.test(catalogue)) fail('API-only units are not disclosed in the catalogue UI.');
if (!/setAttribute\('inert'/.test(landing) || !/removeAttribute\('inert'/.test(landing) || !/setMenuOpen\(false\); \};/.test(landing)) fail('The modal menu must isolate the background and close after language selection.');
if (!/isolateBackground\('\.c1c-page > header, \.c1c-page > main, \.c1c-page > footer'\)/.test(catalogue) || !/isolateBackground\('\.c1-site > header, \.c1-site > main'\)/.test(landing)) fail('Plan and gallery dialogs must isolate their complete page background.');
if (!/const externalSelection = selected; setSelected\(undefined\); setPlan\(externalSelection\)/.test(catalogue) || !/setPlan\(undefined\); openLead\('plan', opener, unit\)/.test(catalogue)) fail('Card detail, plan and lead dialogs must be mutually exclusive and retain the external opener.');
if (!/event\.stopImmediatePropagation\(\)/.test(catalogue) || !/event\.stopImmediatePropagation\(\)/.test(landing)) fail('Topmost C1 dialogs must own Escape.');
if (!/role="dialog" aria-modal="true"/.test(catalogue) || !/c1c-card-detail__panel/.test(catalogue) || !/selection\.opener/.test(catalogue)) fail('Catalogue dialogs must trap focus and return it to a stable opener.');
if (!/\.c1-life__rail\{touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch\}/.test(landingCSS) || !/\.c1c-chess\{touch-action:pan-x pan-y;-webkit-overflow-scrolling:touch\}/.test(catalogueCSS)) fail('Horizontal touch surfaces are missing explicit touch scrolling contracts.');
if (!/availabilityStatus: 'ДОСТУПНА'/.test(catalogue) || !/availabilityStatus: 'MAVJUD'/.test(catalogue) || !/serverDateLabel: 'Дата сервера'/.test(catalogue) || !/serverDateLabel: 'Server sanasi'/.test(catalogue)) fail('RU/UZ catalogue service labels are not fully localized.');
if (!/trackingKeys/.test(landing) || !/trackingKeys/.test(catalogue) || !/tcid/.test(landing) || !/fbclid/.test(catalogue)) fail('Marketing parameters are not preserved through C1 navigation.');
if (/publicClientPayload/.test(`${landingPage}\n${cataloguePage}`) || /sourcePlanSha256|localPlanSha256|sourceCreatedAt|sourceUpdatedAt/.test(`${landingPage}\n${cataloguePage}`)) fail('Server pages expose capture-only provenance through the client payload.');
if (!/width: 1920, height: 870/.test(landingPage)) fail('C1 Open Graph dimensions must match hero.webp.');
if (!/writeStablePublic/.test(assetBuilder) || !/writeStablePlan/.test(catalogueBuilder) || !/--accept-changes/.test(assetBuilder) || !/--accept-changes/.test(catalogueBuilder)) fail('C1 builders must reject changed bytes at stable public URLs unless explicitly approved.');
if (!/buildingPolygonIds/.test(captureScript) || !/<polygon\\b/.test(captureScript) || !/polygonIds/.test(captureScript)) fail('C1 capture must extract SVG polygon data-id evidence.');

if (auditCapture) {
  const capture = JSON.parse(await readFile(path.join(root, 'source', 'c1', 'capture-manifest.json'), 'utf8'));
  const building = JSON.parse(await readFile(path.join(root, 'source', 'c1', 'raw', 'building-26.json'), 'utf8'));
  const sourceMedia = JSON.parse(await readFile(path.join(root, 'source', 'c1', 'media-manifest.json'), 'utf8'));
  const planManifest = JSON.parse(await readFile(path.join(root, 'source', 'c1', 'plans-manifest.json'), 'utf8'));
  if (!capture.stable || capture.counts.resultBefore !== 42 || capture.counts.plans !== 42 || capture.counts.resultAfter !== 42) fail('The typed API capture is not stable at 42 units.');
  if (capture.polygonEvidence?.parser !== 'SVG polygon[data-id]' || capture.polygonEvidence.availableIds.length !== 39 || capture.polygonEvidence.listedAvailableWithoutPolygon.length !== 0) fail('Capture lacks verified SVG polygon evidence for 39 AVAILABLE IDs.');
  if (building.responses.some((response) => !Array.isArray(response.polygonIds) || response.polygonCount !== response.polygonIds.length)) fail('A building response lacks extracted polygon data-id evidence.');
  const apiIds = new Set(snapshot.units.map((unit) => unit.crmId));
  const rawPolygonIds = new Set(building.responses.flatMap((response) => response.polygonIds).filter((crmId) => apiIds.has(crmId)));
  if (rawPolygonIds.size !== 39 || !sameValues(rawPolygonIds, capture.polygonEvidence.availableIds)) fail('Raw SVG polygon IDs do not match the 39-ID capture manifest.');
  if (snapshot.units.some((unit) => unit.hasOfficialFloorPolygon !== rawPolygonIds.has(unit.crmId))) fail('Versioned unit polygon flags disagree with raw SVG evidence.');
  if (capture.missingFromBuilding.length !== 3 || !sameValues(capture.missingFromBuilding.map((unit) => unit.crmId), snapshot.missingOfficialFloorPolygons.map((unit) => unit.crmId))) fail('Capture reconciliation no longer matches the versioned snapshot.');
  const sourceMediaByFile = new Map(sourceMedia.assets.map((asset) => [asset.outputFile, asset]));
  if (mediaManifest.assets.some((asset) => sourceMediaByFile.get(asset.outputFile)?.outputSha256 !== asset.outputSha256)) fail('Versioned media digests disagree with the audited source manifest.');
  const plansByFile = new Map(planManifest.assets.map((asset) => [asset.file, asset]));
  if (snapshot.units.some((unit) => plansByFile.get(unit.plan)?.sourceSha256 !== unit.sourcePlanSha256 || plansByFile.get(unit.plan)?.outputSha256 !== unit.localPlanSha256)) fail('Plan source/local digests disagree with the audited capture manifest.');
}

console.log(`C1 contract passed${auditCapture ? ' with capture audit' : ''}: ${snapshot.units.length} AVAILABLE apartments, ${planFiles.size} hash-verified local plans, ${mediaManifest.assets.length} hash-verified public media assets, 42-vs-39 polygon reconciliation, hidden prices, mutually exclusive accessible dialogs.`);
