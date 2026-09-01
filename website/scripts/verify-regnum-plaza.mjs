import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(websiteRoot, '..');
const sourceRoot = resolve(websiteRoot, 'source/regnum-plaza');
const publicRoot = resolve(websiteRoot, 'public');
const fullBundle = process.argv.includes('--full-bundle');
const sortNames = ['source', 'priceAsc', 'priceDesc', 'areaAsc', 'areaDesc', 'floorAsc', 'floorDesc', 'roomsAsc', 'roomsDesc', 'ppmAsc', 'ppmDesc'];
const expectedSortOrders = {
  source: '12,235,250,736,880,1273,1441,1635,2032,2234,2285,2713',
  priceAsc: '1635,2032,12,1273,2285,880,235,736,2234,250,2713,1441',
  priceDesc: '1441,2713,250,2234,736,235,880,2285,1273,12,2032,1635',
  areaAsc: '12,235,880,2285,1635,2032,1273,736,2234,250,2713,1441',
  areaDesc: '1441,2713,250,2234,736,1273,1635,2032,12,235,880,2285',
  floorAsc: '1273,1635,2032,12,2285,880,235,250,736,1441,2234,2713',
  floorDesc: '250,736,1441,2234,2713,235,880,2285,12,2032,1635,1273',
  roomsAsc: '12,235,880,1273,1635,2032,2285,736,2713,1441,250,2234',
  roomsDesc: '250,2234,1441,736,2713,12,235,880,1273,1635,2032,2285',
  ppmAsc: '736,1273,1635,2032,12,2285,880,235,2234,250,2713,1441',
  ppmDesc: '1441,2713,250,2234,235,880,2285,12,2032,1635,1273,736',
};
const expectedPairOrders = {
  source: '250,1441', priceAsc: '250,1441', priceDesc: '1441,250', areaAsc: '250,1441', areaDesc: '1441,250',
  floorAsc: '250,1441', floorDesc: '250,1441', roomsAsc: '1441,250', roomsDesc: '250,1441', ppmAsc: '250,1441', ppmDesc: '1441,250',
};
const expectedBundleContract = Object.freeze({
  manifestBytes: 18604,
  manifestSha256: 'e6523f10e81e5663901f1312f4dd4dc76f27d3a414c4940b41f0440e7a221339',
  rawByteTotal: 18746463,
});

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function exists(path) { try { await readFile(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function directoryExists(path) { try { await readdir(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }

async function walk(root, prefix = '') {
  const entries = await readdir(resolve(root, prefix), { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await walk(root, path));
    else paths.push(path);
  }
  return paths.sort();
}

async function assertFile(path, bytes, hash, label) {
  const buffer = await readFile(path);
  assert(buffer.byteLength === bytes, `${label}: expected ${bytes} bytes, found ${buffer.byteLength}`);
  assert(sha256(buffer) === hash, `${label}: SHA-256 mismatch`);
}

function assertIncludes(source, snippets, label) {
  for (const snippet of snippets) assert(source.includes(snippet), `${label}: missing contract token ${JSON.stringify(snippet)}`);
}

function webpDimensions(buffer) {
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') {
    const marker = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (marker >= 0) return { width: buffer.readUInt16LE(marker + 3) & 0x3fff, height: buffer.readUInt16LE(marker + 5) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function sourceImageDimensions(buffer, path) {
  if (path.endsWith('.png')) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1]; const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      offset += 2 + length;
    }
  }
  return null;
}

function assertPinnedBundleDigest(buffer) {
  assert(buffer.byteLength === expectedBundleContract.manifestBytes, `Bundle manifest byte length changed: ${buffer.byteLength}`);
  assert(sha256(buffer) === expectedBundleContract.manifestSha256, 'Bundle manifest SHA-256 does not match the independently pinned contract');
}

function assertPinnedBundleRawTotal(bundle) {
  const rawByteTotal = bundle.files.reduce((sum, item) => sum + item.bytes, 0);
  assert(rawByteTotal === expectedBundleContract.rawByteTotal, `Bundle raw byte total changed: ${rawByteTotal}`);
}

function verifyBundleContractTamperDetection(bundleBuffer, bundle) {
  let digestRejected = false;
  try { assertPinnedBundleDigest(Buffer.concat([bundleBuffer, Buffer.from(' ')])); } catch { digestRejected = true; }
  assert(digestRejected, 'Bundle manifest digest tamper negative control was not rejected');

  const totalTamper = structuredClone(bundle);
  totalTamper.files[0].bytes += 1;
  let totalRejected = false;
  try { assertPinnedBundleRawTotal(totalTamper); } catch { totalRejected = true; }
  assert(totalRejected, 'Bundle raw-total tamper negative control was not rejected');
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  if (Array.isArray(value)) { for (const item of value) collectKeys(item, keys); return keys; }
  for (const [key, child] of Object.entries(value)) { keys.add(key); collectKeys(child, keys); }
  return keys;
}

function sortedUnits(units, sort) {
  return [...units].sort((left, right) => {
    const comparators = {
      source: left.sourceOrder - right.sourceOrder, priceAsc: left.priceRank - right.priceRank, priceDesc: right.priceRank - left.priceRank,
      areaAsc: left.area - right.area, areaDesc: right.area - left.area, floorAsc: left.floor - right.floor, floorDesc: right.floor - left.floor,
      roomsAsc: left.rooms - right.rooms, roomsDesc: right.rooms - left.rooms, ppmAsc: left.ppmRank - right.ppmRank, ppmDesc: right.ppmRank - left.ppmRank,
    };
    return comparators[sort] || left.sourceOrder - right.sourceOrder;
  });
}

async function verifyOfflineRebuild() {
  const result = spawnSync(process.execPath, ['scripts/build-regnum-plaza-catalog.mjs', '--check'], {
    cwd: websiteRoot, encoding: 'utf8', env: { ...process.env, NO_PROXY: '*', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '' },
  });
  assert(result.status === 0, `Offline rebuild failed:\n${result.stderr || result.stdout}`);
  assert(result.stdout.includes('12 units') && result.stdout.includes('6 plan sources') && result.stdout.includes('11 matrix rows') && result.stdout.includes('0 Offers'), 'Offline rebuild summary is incomplete');
}

async function verifySourceBundle() {
  const bundleBuffer = await readFile(resolve(sourceRoot, 'bundle-manifest.json'));
  const bundle = JSON.parse(bundleBuffer.toString('utf8'));
  assertPinnedBundleDigest(bundleBuffer);
  assertPinnedBundleRawTotal(bundle);
  verifyBundleContractTamperDetection(bundleBuffer, bundle);
  const [source, api, media, plans] = await Promise.all([
    json(resolve(sourceRoot, 'source-manifest.json')), json(resolve(sourceRoot, 'api-manifest.json')),
    json(resolve(sourceRoot, 'media-manifest.json')), json(resolve(sourceRoot, 'plan-manifest.json')),
  ]);
  assert(bundle.root === 'source/regnum-plaza' && bundle.total === 105 && bundle.files.some((item) => item.localPath === 'private-canonical.json'), 'Unexpected frozen/private source-bundle topology');
  assert(bundle.excludes.length === 2 && bundle.excludes.includes('bundle-manifest.json') && bundle.excludes.includes('integrity-report.json'), 'Bundle self-exclusion policy mismatch');
  assert(source.pages.length === 7 && source.api.length === 2, 'Expected seven page captures and two API captures');
  assert(source.booklet.foundInFrozenCaptureScope === false && source.booklet.publicDownload === null && /frozen/iu.test(source.booklet.note), 'Booklet observation must remain bounded to frozen captures');
  assert(api.total === 12 && api.publicPrice === false && api.sourceIsPrice === 0, 'Frozen API pricing/count contract mismatch');
  assert(media.count === 32, 'Expected 32 official media sources');
  const mediaTypes = {};
  for (const item of media.items) mediaTypes[item.materialType] = (mediaTypes[item.materialType] ?? 0) + 1;
  assert(JSON.stringify(mediaTypes) === JSON.stringify({ 'brand-asset': 1, 'real-first-phase': 21, 'cgi-full-project': 2, 'archival-cgi-concept': 4, 'documentary-opening': 4 }), 'Official media classification mismatch');
  assert(plans.count === 6 && plans.missingUnitPlanCount === 2 && plans.floorPlanSample.url.endsWith('/67d3f89ddbff2.png'), 'Official plan-source contract mismatch');

  for (const entry of [...source.pages, ...source.api, ...media.items, ...plans.items, plans.floorPlanSample]) {
    await assertFile(resolve(sourceRoot, entry.localPath), entry.bytes, entry.sha256, entry.localPath);
    assert(entry.url?.startsWith('https://'), `${entry.localPath}: missing original HTTPS URL`);
    assert(Number.isInteger(entry.httpStatus), `${entry.localPath}: missing HTTP status`);
    assert(entry.contentType && entry.serverDateUtc, `${entry.localPath}: incomplete response metadata`);
    assert(entry.requestedAtUtc === null && entry.completedAtUtc === null, `${entry.localPath}: unmeasured client timestamps must remain null`);
    assert(entry.timestampBasis?.serverDateUtc === 'HTTP response Date header' && /not recorded/u.test(entry.timestampBasis?.requestedAtUtc) && /not recorded/u.test(entry.timestampBasis?.completedAtUtc), `${entry.localPath}: timestamp provenance is ambiguous`);
  }
  for (const path of await walk(resolve(sourceRoot, 'capture/headers'))) {
    const text = await readFile(resolve(sourceRoot, 'capture/headers', path), 'utf8');
    assert(!/^set-cookie:/imu.test(text), `${path}: response cookie leaked into frozen capture`);
  }
  for (const path of ['sources/pages/project.html', 'sources/pages/genplan.html', 'sources/pages/opening.html', 'sources/pages/launch.html']) {
    const text = await readFile(resolve(sourceRoot, path), 'utf8');
    assert(!/<meta[^>]+name=["']csrf-token["'][^>]+content=(?!["']\[REDACTED\]["'])/iu.test(text), `${path}: CSRF value was not redacted`);
  }
  for (const entry of bundle.files) await assertFile(resolve(sourceRoot, entry.localPath), entry.bytes, entry.sha256, entry.localPath);
  if (fullBundle) {
    const actual = (await walk(sourceRoot)).filter((path) => !bundle.excludes.includes(path));
    const declared = bundle.files.map((entry) => entry.localPath).sort();
    assert(JSON.stringify(actual) === JSON.stringify(declared), 'Full source bundle has missing or undeclared files');
  }
  return bundle.total;
}

async function verifyDerivatives() {
  const [assets, plans, planSources] = await Promise.all([
    json(resolve(sourceRoot, 'asset-derivatives-manifest.json')),
    json(resolve(sourceRoot, 'plan-derivatives-manifest.json')),
    json(resolve(sourceRoot, 'plan-manifest.json')),
  ]);
  assert(assets.count === 33 && plans.count === 6, 'Expected 33 media derivatives and 6 plan derivatives');
  const items = [...assets.items, ...plans.items];
  assert(items.length === 39 && new Set(items.map((item) => item.publicPath)).size === 39, 'Public derivative paths must be 39 unique local files');
  for (const item of items) {
    assert(item.publicPath.startsWith('/regnum-plaza/') && !/^https?:/u.test(item.publicPath), `Unsafe or live public path: ${item.publicPath}`);
    await assertFile(resolve(publicRoot, item.publicPath.slice(1)), item.bytes, item.sha256, item.publicPath);
  }
  const logoSource = (await json(resolve(sourceRoot, 'media-manifest.json'))).items.find((item) => item.id === 'official-logo');
  const logoDerivative = assets.items.find((item) => item.sourceId === 'official-logo');
  assert(logoSource && logoDerivative && logoSource.sha256 === logoDerivative.sha256, 'Official SVG logo must remain byte-identical');
  const planSourceById = new Map(planSources.items.map((item) => [item.id, item]));
  for (const derivative of plans.items) {
    const source = planSourceById.get(derivative.sourceId);
    assert(source, `${derivative.sourceId}: missing official plan source`);
    const sourceBuffer = await readFile(resolve(sourceRoot, source.localPath));
    const outputBuffer = await readFile(resolve(publicRoot, derivative.publicPath.slice(1)));
    const actualSource = sourceImageDimensions(sourceBuffer, source.localPath);
    const actualOutput = webpDimensions(outputBuffer);
    assert(actualSource && actualOutput, `${derivative.sourceId}: unreadable plan dimensions`);
    assert(source.width === actualSource.width && source.height === actualSource.height, `${derivative.sourceId}: source dimension manifest mismatch`);
    assert(derivative.sourceWidth === actualSource.width && derivative.sourceHeight === actualSource.height, `${derivative.sourceId}: derivative source-dimension provenance mismatch`);
    assert(derivative.width === actualOutput.width && derivative.height === actualOutput.height, `${derivative.sourceId}: derivative dimension manifest mismatch`);
    assert(actualOutput.width === Math.min(actualSource.width, 1000), `${derivative.sourceId}: output width is not min(source width, 1000px)`);
    assert(Math.abs(actualOutput.height - (actualSource.height * actualOutput.width / actualSource.width)) <= 1, `${derivative.sourceId}: derivative aspect ratio changed`);
    assert(derivative.transformation === 'WebP q92; width=min(source width, 1000px); no upscaling', `${derivative.sourceId}: transformation provenance mismatch`);
  }
  return items.length;
}

async function verifyCatalogs() {
  const [catalog, privateCatalog, summary, facts] = await Promise.all([
    json(resolve(websiteRoot, 'data/regnum-plaza-client.json')), json(resolve(sourceRoot, 'private-canonical.json')),
    json(resolve(sourceRoot, 'derived-summary.json')), json(resolve(sourceRoot, 'fact-provenance.json')),
  ]);
  assert(!await exists(resolve(websiteRoot, 'data/regnum-plaza-catalog.json')), 'Legacy full client catalog must not exist');
  assert(catalog.projectSlug === 'regnum-plaza' && catalog.projectId === 1 && catalog.units.length === 12 && catalog.capturedAt === '2026-08-30T20:46:15Z', 'Client catalog project/count/capture mismatch');
  assert(privateCatalog.units.length === 12 && new Set(privateCatalog.units.map((unit) => unit.internalId)).size === 12 && new Set(privateCatalog.units.map((unit) => unit.crmId)).size === 12, 'Private canonical IDs mismatch');
  assert(new Set(privateCatalog.units.filter((unit) => unit.planSourceUrl).map((unit) => unit.planSourceUrl)).size === 6, 'Official plan source count mismatch');
  assert(privateCatalog.units.filter((unit) => unit.planSourceUrl === null && unit.planPublicPath === null).length === 2, 'Missing-plan count mismatch');
  assert(catalog.matrix.groups.length === 4 && catalog.matrix.rows.length === 11 && catalog.matrix.rows.reduce((sum, row) => sum + row.unitIds.length, 0) === 12, 'Matrix 4/11/12 topology mismatch');
  assert(new Set(catalog.matrix.groups.map((group) => `q${group.queue}-s${group.section}`)).size === 4, 'Matrix groups are not unique');
  const distribution = Object.fromEntries([1, 2, 3, 4].map((rooms) => [rooms, catalog.units.filter((unit) => unit.rooms === rooms).length]));
  assert(JSON.stringify(distribution) === JSON.stringify({ 1: 7, 2: 2, 3: 1, 4: 2 }), 'Room distribution mismatch');
  assert(catalog.filterSummary.ranges.area.min === 38.48 && catalog.filterSummary.ranges.area.max === 249.27, 'Area range mismatch');
  assert(catalog.publicPrice === false && catalog.offerCount === 0 && catalog.units.every((unit) => unit.publicPrice === false && unit.status === 'available'), 'Public-price/status/Offer policy mismatch');
  assert(privateCatalog.publicPrice === false && privateCatalog.sourceIsPrice === 0 && privateCatalog.units.every((unit) => unit.sourceIsPrice === 0 && unit.maxFloor === 15 && unit.entrance === unit.section && unit.block === `Q${unit.queue}/S${unit.section}` && unit.blockName === unit.block && unit.blockId === `q${unit.queue}-s${unit.section}` && unit.studio === false), 'Private canonical unit contract mismatch');
  assert(summary.units === 12 && summary.uniqueInternalIds === 12 && summary.uniqueCrmIds === 12 && summary.uniquePlanSources === 6 && summary.missingPlans === 2 && summary.groups === 4 && summary.matrixRows === 11 && summary.offerCount === 0, 'Derived integrity summary mismatch');

  const allowedUnitKeys = ['area', 'completion', 'displayPriceKey', 'floor', 'id', 'number', 'planHeight', 'planPublicPath', 'planWidth', 'ppmRank', 'priceRank', 'publicPrice', 'queue', 'rooms', 'section', 'sourceOrder', 'status'];
  assert(catalog.units.every((unit) => JSON.stringify(Object.keys(unit).sort()) === JSON.stringify(allowedUnitKeys)), 'Sanitized client unit contains undeclared fields');
  const forbiddenKeys = ['effectivePrice', 'regularPrice', 'pricePerM2', 'internalSnapshotPrice', 'crmId', 'planSourceUrl', 'sourceIsPrice'];
  const clientKeys = collectKeys(catalog);
  for (const key of forbiddenKeys) assert(!clientKeys.has(key), `Sanitized client catalog leaks ${key}`);
  for (const rankKey of ['priceRank', 'ppmRank']) {
    const ranks = catalog.units.map((unit) => unit[rankKey]).sort((left, right) => left - right);
    assert(JSON.stringify(ranks) === JSON.stringify([...Array(12).keys()]), `${rankKey} must be an opaque 0..11 permutation`);
  }
  const privateById = new Map(privateCatalog.units.map((unit) => [unit.id, unit]));
  const priceAsc = [...privateCatalog.units].sort((left, right) => left.effectivePrice - right.effectivePrice || left.sourceOrder - right.sourceOrder).map((unit) => unit.id).join(',');
  const ppmAsc = [...privateCatalog.units].sort((left, right) => left.pricePerM2 - right.pricePerM2 || left.sourceOrder - right.sourceOrder).map((unit) => unit.id).join(',');
  assert(priceAsc === expectedSortOrders.priceAsc && ppmAsc === expectedSortOrders.ppmAsc, 'Frozen private price order changed');
  assert([...catalog.units].sort((left, right) => left.priceRank - right.priceRank).map((unit) => unit.id).join(',') === priceAsc, 'Client price ranks do not match the private canonical order');
  assert([...catalog.units].sort((left, right) => left.ppmRank - right.ppmRank).map((unit) => unit.id).join(',') === ppmAsc, 'Client price/m² ranks do not match the private canonical order');
  assert(catalog.units.every((unit) => privateById.has(unit.id)), 'Client unit identity is not canonical');

  const pairRow = catalog.matrix.rows.find((row) => row.id === 'q1-s2-f14');
  assert(pairRow && pairRow.unitIds.length === 2, 'Control matrix row q1-s2-f14 is missing');
  for (const sort of sortNames) {
    const ordered = sortedUnits(catalog.units, sort);
    assert(ordered.map((unit) => unit.id).join(',') === expectedSortOrders[sort], `${sort}: deterministic card order mismatch`);
    const ranks = new Map(ordered.map((unit, index) => [unit.id, index]));
    const pair = [...pairRow.unitIds].sort((left, right) => ranks.get(left) - ranks.get(right)).join(',');
    assert(pair === expectedPairOrders[sort], `${sort}: deterministic Matrix/Matrix+ row order mismatch`);
  }

  for (const id of ['no-construction-gallery', 'no-booklet', 'no-active-campaign']) {
    const fact = facts.facts.find((item) => item.id === id);
    assert(fact && Array.isArray(fact.sources) && fact.sources.length > 0 && typeof fact.scope === 'string', `${id}: negative observation lacks bounded frozen evidence`);
  }
  assert(!JSON.stringify(facts).includes('404'), 'Unfrozen terrace 404 claim leaked into provenance');
  assert(facts.facts.some((fact) => fact.id === 'completion-en-correction' && fact.value.sourceEn === '5th Quarter 2026' && fact.value.publishedEn === 'Q4 2026'), 'Official EN Q5 inconsistency is not documented/corrected');
  assert(facts.facts.some((fact) => fact.id === 'section11-floor14-inconsistency'), 'Section 11/floor 14 inconsistency is undocumented');
  return { catalog, privateCatalog };
}

async function verifyClientLeakBoundary(privateCatalog) {
  const numericLiterals = [...new Set(privateCatalog.units.flatMap((unit) => [unit.effectivePrice, unit.regularPrice, unit.pricePerM2]).map(String))];
  const clientPaths = ['data/regnum-plaza-client.json', 'app/regnum-plaza/regnum-page.tsx', 'app/regnum-plaza/regnum-lead.ts', 'app/regnum-plaza/apartments/regnum-catalog.tsx', 'app/regnum-plaza/page.tsx', 'app/regnum-plaza/apartments/page.tsx', 'app/api/regnum-plaza-lead/route.ts'];
  const clientText = (await Promise.all(clientPaths.map((path) => readFile(resolve(websiteRoot, path), 'utf8')))).join('\n');
  for (const literal of numericLiterals) assert(!clientText.includes(literal), `Private numeric literal ${literal} leaked into a client/build input`);
  for (const key of ['effectivePrice', 'regularPrice', 'pricePerM2', 'internalSnapshotPrice', 'crmId']) assert(!clientText.includes(key), `Private field ${key} leaked into a Regnum client/build input`);
  assert(!clientText.includes('regnum-plaza-catalog.json') && !clientText.includes('private-canonical.json'), 'Regnum client graph imports a private/legacy catalog');

  const runtimePaths = (await walk(resolve(websiteRoot, 'app'))).filter((path) => /\.(?:ts|tsx|js|jsx)$/u.test(path));
  const runtimeText = (await Promise.all(runtimePaths.map((path) => readFile(resolve(websiteRoot, 'app', path), 'utf8')))).join('\n');
  assert(!runtimeText.includes('@/source/regnum-plaza'), 'Regnum private source must not be imported by application runtime code');

  const distRoot = resolve(websiteRoot, 'dist/client');
  if (await directoryExists(distRoot)) {
    const textFiles = (await walk(distRoot)).filter((path) => ['.js', '.json', '.html', '.css', '.map'].includes(extname(path)));
    const regnumFiles = textFiles.filter((path) => /(?:^|[/_-])regnum(?:[/_.-]|$)/iu.test(path));
    const allDistText = (await Promise.all(textFiles.map((path) => readFile(resolve(distRoot, path), 'utf8')))).join('\n');
    for (const literal of numericLiterals) assert(!allDistText.includes(literal), `Private numeric literal ${literal} leaked into dist/client`);
    const regnumText = (await Promise.all(regnumFiles.map((path) => readFile(resolve(distRoot, path), 'utf8')))).join('\n');
    for (const key of ['effectivePrice', 'regularPrice', 'pricePerM2', 'internalSnapshotPrice', 'crmId']) assert(!regnumText.includes(key), `Private field ${key} leaked into Regnum client chunks`);
  }
  return numericLiterals.length;
}

async function verifyApplicationContract(catalog) {
  const paths = {
    landingPage: 'app/regnum-plaza/page.tsx', landingUi: 'app/regnum-plaza/regnum-page.tsx', landingCss: 'app/regnum-plaza/regnum.css', sharedCss: 'app/regnum-plaza/regnum-shared.css',
    catalogPage: 'app/regnum-plaza/apartments/page.tsx', catalogUi: 'app/regnum-plaza/apartments/regnum-catalog.tsx', catalogCss: 'app/regnum-plaza/apartments/regnum-catalog.css',
    lead: 'app/regnum-plaza/regnum-lead.ts', api: 'app/api/regnum-plaza-lead/route.ts', leadSecurity: 'app/api/lead-route-security.ts', leadProxy: 'app/v1/leads/route.ts', leadModal: 'app/lead-modal.tsx', vite: 'vite.config.ts',
    jomiyApi: 'app/api/jomiy-lead/route.ts', sunApi: 'app/api/sun-lead/route.ts', yangibaxtApi: 'app/api/yangibaxt-lead/route.ts', zamonApi: 'app/api/zamon-lead/route.ts',
    privacy: 'app/privacy/page.tsx', sitemap: 'app/sitemap.ts', proxy: 'proxy.ts', layout: 'app/layout.tsx', legacyRoot: 'app/page.tsx',
    builder: 'scripts/build-regnum-plaza-catalog.mjs', guardSmoke: 'scripts/smoke-regnum-plaza-http-guard.mjs', leadSmoke: 'scripts/smoke-regnum-plaza-production-lead.mjs', package: 'package.json',
  };
  const source = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(resolve(websiteRoot, path), 'utf8')])));
  assertIncludes(source.landingPage, ['alternates', 'languages', 'openGraph', 'twitter', 'ApartmentComplex', 'Q4 2026', "['Класс', 'Бизнес']", "['Sinf', 'Biznes']", "['Class', 'Business']", 'current.properties.map'], 'landing metadata/JSON-LD');
  assertIncludes(source.catalogPage, ['alternates', 'languages', 'openGraph', 'twitter', 'ItemList', 'Apartment', 'dateModified: catalog.capturedAt', 'current.queueName', 'current.statusName', 'current.available'], 'catalog metadata/JSON-LD');
  assert(!source.catalogPage.includes('statusOriginal') && !source.landingPage.includes("'@type': 'Offer'") && !source.catalogPage.includes("'@type': 'Offer'"), 'JSON-LD must contain zero raw AVAILABLE values and zero Offers');
  assert(!source.landingPage.includes('5th Quarter') && !source.catalogPage.includes('5th Quarter') && !source.landingUi.includes('5th Quarter') && !source.catalogUi.includes('5th Quarter'), 'Impossible fifth quarter leaked into public UI');
  assertIncludes(source.landingUi, ["const languages: Language[] = ['ru', 'uz', 'en']", 'real-first-phase', 'documentary-opening', 'cgi-full-project', 'archival-cgi-concept', 'const latest = useRef({ state, onChange })', 'returnFocusTo={lead.opener}', '!menuRef.current.contains(document.activeElement)', 'role="dialog"', 'aria-modal={menuOpen && !lead ? true : undefined}', 'inert={!menuOpen || Boolean(lead)', 'inert={menuOpen ? true : undefined}', 'width={unit.planWidth!}', 'height={unit.planHeight!}'], 'landing UI/layers');
  assert(source.landingCss.includes('prefers-reduced-motion') && source.catalogCss.includes('prefers-reduced-motion'), 'Reduced-motion policy is missing');
  assert(source.sharedCss.includes(':is(.rp-site,.rpc-site)'), 'Shared Regnum lead styling is not scoped to both routes');
  assertIncludes(source.catalogUi, ["type Mode = 'cards' | 'chess' | 'chess-plus'", "const modes: Mode[] = ['cards', 'chess', 'chess-plus']", "type Sort = 'source' | 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc' | 'roomsAsc' | 'roomsDesc' | 'ppmAsc' | 'ppmDesc'", 'priceRank', 'ppmRank', 'rankById', 'data-row-id', 'data-unit-id', 'covered={Boolean(plan || lead)}', 'aria-hidden={covered || undefined}', 'inert={covered ? true : undefined}', 'returnFocusTo={lead.opener}', '!panel.contains(document.activeElement)', "const mobileDetailOpen = mode === 'chess-plus'", 'inert={mobileDetailOpen ? true : undefined}', 'width={unit.planWidth!}', 'height={unit.planHeight!}', 'setVisible(12)', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'], 'catalog sorting/layer UI');
  assert(!/const modes[^\n]+floor/iu.test(source.catalogUi), 'Forbidden floor-plan mode was added');
  assert(source.catalogUi.includes('priceOnRequest(language)') && source.catalogUi.includes('publicPrice=false'), 'Price-on-request disclosure is missing');
  assertIncludes(source.lead, ["@/data/regnum-plaza-client.json", "process.env.NODE_ENV === 'production'", '/v1/leads', '/api/regnum-plaza-lead', "['unitId', unit.id]", 'rememberLastViewedApartment({ uuid: unit.id }'], 'sanitized lead client');
  assertIncludes(source.api, ["@/data/regnum-plaza-client.json", 'publicUnitContext', 'publicPrice: false', "displayPrice: 'price-on-request'", 'forwardLeadJson(destination, forwardPayload)', 'readLeadJson<Payload>', "process.env.NODE_ENV !== 'production'", "lead_delivery_unconfigured", "qa-test-local-only"], 'public-catalog lead API');
  assertIncludes(source.leadSecurity, ['MAX_REQUEST_BYTES = 64 * 1024', 'MAX_RESPONSE_BYTES = 64 * 1024', 'UPSTREAM_TIMEOUT_MS = 8_000', "content-type", 'request.body.getReader()', 'reader.cancel()', "credentials: 'omit'", "redirect: 'error'", "referrerPolicy: 'no-referrer'"], 'shared project lead route safety');
  for (const routeSource of [source.jomiyApi, source.api, source.sunApi, source.yangibaxtApi, source.zamonApi]) {
    assertIncludes(routeSource, ['readLeadJson<', 'leadJson as json'], 'project lead bounded JSON intake');
  }
  for (const routeSource of [source.api, source.sunApi]) assertIncludes(routeSource, ['forwardLeadJson('], 'project lead bounded forwarding');
  assert(!source.api.includes('@/source/') && !source.api.includes('internalId') && !source.api.includes('crmId') && !source.api.includes('effectivePrice') && !source.api.includes('regularPrice') && !source.api.includes('pricePerM2'), 'Regnum API must not import or forward private identities/prices');
  assert(!source.api.includes('JSON.stringify(payload)'), 'Lead API must never forward the untrusted raw payload');
  assert(source.api.indexOf("if (testMarker)") < source.api.indexOf('const destination = forwardUrl()'), 'QA/test bypass must happen before forwarding');
  assertIncludes(source.api, ["const testMarker = process.env.NODE_ENV !== 'production'", "request.headers.get('x-regnum-qa') === '1'", "/(^|\\s)(qa|test|тест)(\\s|$)/iu.test(name)"], 'production-gated QA marker');
  assertIncludes(source.leadModal, ["projectSlug === 'regnum-plaza'", 'deliveryError', 'returnFocusTo', 'privacyUrl?', 'privacyUrl ? <> <a href={privacyUrl}'], 'shared lead migration/error/focus/privacy');
  assert(!/privacyUrl\s*=/.test(source.leadModal), 'LeadModal privacy URL must remain opt-in');
  assertIncludes(source.legacyRoot, ['submitUrl={`${appBasePath}/v1/leads`}', 'projectSlug="avalon-residence"', 'privacyUrl={`${appBasePath}/privacy?project=avalon-residence&lang=${language}`}', 'requireConsent'], 'Legacy Avalon lead delivery/consent/privacy');
  assertIncludes(source.leadProxy, ['MAX_REQUEST_BYTES', 'MAX_RESPONSE_BYTES', 'UPSTREAM_TIMEOUT_MS', 'LEAD_BACKEND_URL', 'CATALOG_API_URL', "process.env.NODE_ENV !== 'production'", 'http://127.0.0.1:8080/v1/leads', "lead_delivery_unconfigured", "cache: 'no-store'", "(responseBody as JsonObject).success !== true"], 'same-origin lead proxy safety');
  assertIncludes(source.landingUi, ['privacy?project=regnum-plaza&lang=${language}&from=landing'], 'Regnum landing privacy URL');
  assertIncludes(source.catalogUi, ['privacy?project=regnum-plaza&lang=${language}&from=catalog'], 'Regnum catalog privacy URL');
  assertIncludes(source.vite, ['regnum-private-source-guard', 'canonicalRequestPath', 'decodePathLayers', ".normalize('NFKC')", ".replaceAll('\\\\', '/')", ".toLowerCase()", 'isRegnumPrivatePath', "pathname?.startsWith('/@fs/')", 'pathname === null', 'statusCode = 404'], 'canonical private dev-source guard');
  assertIncludes(source.guardSmoke, ['node:http', 'directRequest', "'/SOURCE/regnum-plaza/private-canonical.json'", "'//SCRIPTS/build-regnum-plaza-catalog.mjs'", "'/%C5%BFource/regnum-plaza/private-canonical.json'", "'/data/regnum-plaza-client.json'", "'/api/regnum-plaza-lead'", "response.body, 'Not found'"], 'direct HTTP guard smoke');
  assertIncludes(source.leadSmoke, ["'Test User'", "'X-Regnum-QA': '1'", 'REGNUM_LEAD_FORWARD_URL', "'lead_delivery_unconfigured'", 'received.length, 2', "node_modules/vinext/dist/cli.js"], 'production lead delivery smoke');
  assertIncludes(source.package, ['smoke:regnum-plaza-guard', 'smoke:regnum-plaza-lead-production'], 'Regnum smoke commands');
  assertIncludes(source.builder, ['requestedAtUtc: null', 'completedAtUtc: null', 'timestampBasis', 'width=min(source width, 1000px); no upscaling', 'derivative.width === Math.min(source.width, 1000)'], 'offline provenance builder');
  assertIncludes(source.privacy, ["project === 'regnum-plaza'", "params?.from === 'catalog'", '/regnum-plaza/apartments?lang='], 'privacy routing');
  assertIncludes(source.privacy, ["'avalon-residence': { name: 'AVALON RESIDENCE', path: '/avalon', image: '/avalon/avalon-city.webp'", "phoneHref: 'tel:+998781137712'"], 'Legacy Avalon privacy routing');
  assertIncludes(source.sitemap, ["'regnum-plaza'", 'projectRoutes', '`/${project}`', '`/${project}/apartments`'], 'sitemap');
  assertIncludes(source.proxy, ['/regnum-plaza/:path*', 'x-document-language'], 'language proxy');
  assert(source.layout.includes("requestHeaders.get('x-document-language')"), 'Generic document-language header is not consumed');
  assert((JSON.stringify(catalog).match(/"@type":"Offer"/gu)?.length ?? 0) === 0, 'Client catalog data contains a JSON-LD Offer');
}

async function verifyGuards() {
  const bayterak = [
    ['data/bayterak-filter-raw.json', 1876, '56c2a733fe041c5cd827925ec0a57c68e4df5b3628e9ea2f854046122056e72e'],
    ['data/bayterak-placement-raw.json', 300190, 'e0b22d4b900327499480d2c6766548c32435c6046bc7def5ae2de228651d1ca8'],
    ['data/bayterak-real-estate-raw.json', 2566, 'ab3422a2bb9df2ee41d4487777327c915f6229e044ff96910d474aa5f15a0e02'],
  ];
  for (const [path, bytes, hash] of bayterak) await assertFile(resolve(websiteRoot, path), bytes, hash, path);
  assert(!await exists(resolve(websiteRoot, '.openai/hosting.json')) && !await exists(resolve(workspaceRoot, '.openai/hosting.json')), '.openai/hosting.json must remain absent');
}

async function main() {
  await verifyOfflineRebuild();
  const [{ catalog, privateCatalog }, sourceFiles, derivatives] = await Promise.all([verifyCatalogs(), verifySourceBundle(), verifyDerivatives(), verifyGuards()]);
  const privateLiterals = await verifyClientLeakBoundary(privateCatalog);
  await verifyApplicationContract(catalog);
  console.log(`Regnum Plaza integrity verified: 12 units, 12 internal IDs, 12 CRM IDs, 6 official plan sources, 2 missing plans, 4 groups, 11 matrix rows, 32 media sources, ${derivatives} public derivatives, ${sourceFiles}/${sourceFiles} frozen bundle files, pinned manifest ${expectedBundleContract.manifestSha256}, ${expectedBundleContract.rawByteTotal} raw bytes, 2/2 bundle tamper controls rejected, 3 languages, 3 modes, 11 deterministic sorts, ${privateLiterals} private numeric literals excluded from client inputs/bundle, 0 Offers${fullBundle ? ', full bundle topology checked' : ''}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
