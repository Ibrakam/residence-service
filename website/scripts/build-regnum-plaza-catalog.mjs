import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(websiteRoot, 'source/regnum-plaza');
const publicRoot = resolve(websiteRoot, 'public');
const clientCatalogPath = resolve(websiteRoot, 'data/regnum-plaza-client.json');
const privateCatalogPath = resolve(sourceRoot, 'private-canonical.json');
const checkOnly = process.argv.includes('--check');

const capturedAtUtc = '2026-08-30T20:46:15Z';
const capturedAtUzt = '2026-08-31T01:46:15.000+05:00';
const timestampBasis = {
  serverDateUtc: 'HTTP response Date header',
  requestedAtUtc: 'not recorded by the capture client',
  completedAtUtc: 'not recorded by the capture client',
};
const expectedApi = {
  page1: { bytes: 72116, sha256: '53fdd70a2468a1f3c01e85a5b351c9673bf840c024721e7afe009c4b5d9c1f10' },
  page2: { bytes: 36441, sha256: '5e973ce0bc3e4ad91858fbb914ac22a2dccbc0e18dfe9dca12dc348f8a197754' },
};

const pageDefinitions = [
  ['landing', 'https://mbc.uz/project/regnum-plaza', 'sources/pages/project.html', 'capture/headers/project.html.headers', 200, '4f8a1f4c681a6552d30dd92f2a51c7ad86bae30ca01220cc1f0418fc415b4a82'],
  ['interactive-genplan', 'https://mbc.uz/genplan/regnum-plaza', 'sources/pages/genplan.html', 'capture/headers/genplan.html.headers', 200, '8495ba5cf0d28a663f49b7d39e204ba9f4ccb11a79ac30e2e0f3c9865f94b495'],
  ['opening-article', 'https://mbc.uz/news/murad-buildings-provel-torzestvennoe-otkrytie-pervoi-oceredi-regnum-plaza', 'sources/pages/opening.html', 'capture/headers/opening.html.headers', 200, 'e5cf1c86e38b1ceab7dc60b6600c374df7cbc961cf6c7aef6eb5ff42513b11fb'],
  ['launch-article', 'https://mbc.uz/news/murad-buildings-zapustila-dolgozdannyi-prestiznyi-i-prevosxodiashhii-vse-ozidaniia-ziloi-kompleks-biznes-klassa-regnum-plaza', 'sources/pages/launch.html', 'capture/headers/launch.html.headers', 200, 'b192925078cbf24b8dcdef3443ffd36c28839a8e0fe14356faed48278b9327fb'],
  ['catalog-main-js', 'https://mbc.uz/assets/js/main.js?v=1787228921', 'sources/pages/main.js', 'capture/headers/main.js.headers', 200, null],
  ['building-section11-floor9', 'https://mbc.uz/building/3?floor=9', 'sources/pages/building-section11-floor9.html', 'capture/headers/building-section11-floor9.html.headers', 200, null],
  ['building-section11-floor14', 'https://mbc.uz/building/3?floor=14', 'sources/pages/building-section11-floor14.html', 'capture/headers/building-section11-floor14.html.headers', 500, null],
].map(([id, url, localPath, headerPath, statusCode, capturedResponseSha256]) => ({ id, url, localPath, headerPath, statusCode, capturedResponseSha256 }));

const mediaDefinitions = [
  ['official-logo', 'brand-asset', 'logo.svg', 'https://mbc.uz/storage/projects/383f526e-f34c-45ef-89dc-27aa98932128.svg'],
  ['hero-desktop', 'real-first-phase', 'hero.webp', 'https://mbc.uz/storage/projects/7ff11b80-bc11-4d66-a1ba-eb913874ec25.webp'],
  ['hero-mobile', 'real-first-phase', 'hero-mobile.webp', 'https://mbc.uz/storage/projects/9958db03-2d01-40ca-b49c-0e690c5787c1.webp'],
  ['first-phase-video', 'real-first-phase', 'video.mp4', 'https://mbc.uz/storage/projects/c0529c0c-3804-45f3-b9d5-ec6a4aa67e69.mp4'],
  ['full-project-cgi', 'cgi-full-project', 'full-project-cgi.webp', 'https://mbc.uz/storage/projects/0c55bd3d-dba8-42fe-911c-943a0ec2d2af.webp'],
  ['genplan-cgi', 'cgi-full-project', 'genplan-cgi.webp', 'https://mbc.uz/storage/genplans/03661f8c-1f36-4a21-b86b-dc9edf74c73d.webp'],
  ['architecture-copper', 'real-first-phase', 'architecture-copper.webp', 'https://mbc.uz/storage/archs/b3c4b057-ea5a-460e-805e-f1f3c04440df.webp'],
  ['architecture-geometry', 'real-first-phase', 'architecture-geometry.webp', 'https://mbc.uz/storage/archs/41db1697-8721-4648-9918-16395d12b79a.webp'],
  ['architecture-brick', 'real-first-phase', 'architecture-brick.webp', 'https://mbc.uz/storage/archs/8a748562-2eec-4d9c-b1d1-8d06da650d2f.webp'],
  ['amenity-lounge', 'real-first-phase', 'amenity-lounge.webp', 'https://mbc.uz/storage/inners/9e1948af-64d9-4c46-82f2-39b3fd6b9b2b.webp'],
  ['amenity-sport', 'real-first-phase', 'amenity-sport.webp', 'https://mbc.uz/storage/inners/5181973c-7f49-4a68-91d3-14ec797c9ecd.webp'],
  ['amenity-workout', 'real-first-phase', 'amenity-workout.webp', 'https://mbc.uz/storage/inners/09533ccc-aec0-48ab-994e-a7b81d9dfeb4.webp'],
  ['amenity-fitness-women', 'real-first-phase', 'amenity-fitness-women.webp', 'https://mbc.uz/storage/inners/48a200b8-a1d4-44c9-bceb-f0ab60aa0ac3.webp'],
  ['amenity-fitness-men', 'real-first-phase', 'amenity-fitness-men.webp', 'https://mbc.uz/storage/inners/19fbdd65-8a10-4294-ae5f-1ea1e336ff02.webp'],
  ['amenity-event', 'real-first-phase', 'amenity-event.webp', 'https://mbc.uz/storage/inners/bc3380a1-54ad-4765-8b31-ff2f045b23e2.webp'],
  ['amenity-library', 'real-first-phase', 'amenity-library.webp', 'https://mbc.uz/storage/inners/4f14d6c9-6b69-4740-b961-4e98f52646da.webp'],
  ['amenity-dry-cleaning', 'real-first-phase', 'amenity-dry-cleaning.webp', 'https://mbc.uz/storage/inners/3858ed24-8d7b-4214-80b8-869eae905bcf.webp'],
  ['amenity-children', 'real-first-phase', 'amenity-children.webp', 'https://mbc.uz/storage/inners/be9bdc11-23a5-426f-82d4-445583d723a3.webp'],
  ['amenity-music', 'real-first-phase', 'amenity-music.webp', 'https://mbc.uz/storage/inners/8052e842-f32c-403e-8ed5-7a6eda072d5a.webp'],
  ['amenity-game', 'real-first-phase', 'amenity-game.webp', 'https://mbc.uz/storage/inners/7ea90793-240a-4aba-b8f3-7f90e4a11709.webp'],
  ['amenity-parking', 'real-first-phase', 'amenity-parking.webp', 'https://mbc.uz/storage/inners/572e5e69-ea07-48b9-96db-c4fc9d9765db.webp'],
  ['amenity-carwash', 'real-first-phase', 'amenity-carwash.webp', 'https://mbc.uz/storage/inners/c946b892-2467-4d80-8d67-dc35014229c1.webp'],
  ['amenity-bakery', 'real-first-phase', 'amenity-bakery.webp', 'https://mbc.uz/storage/inners/c44c7bd1-c478-44c0-8f66-ae174f1c17bd.webp'],
  ['lobby', 'real-first-phase', 'lobby.webp', 'https://mbc.uz/storage/lobbies/0309cc65-7f1a-4a12-abb8-62539dec6635.webp'],
  ['archival-cover', 'archival-cgi-concept', 'archival-cover.webp', 'https://www.mbc.uz/storage/articles/b9067622-d1dc-4bb5-b3e9-e0a03c028de4.webp'],
  ['archival-12', 'archival-cgi-concept', 'archival-12.webp', 'https://mbc.uz/storage/media/12_1739384020.webp'],
  ['archival-13', 'archival-cgi-concept', 'archival-13.webp', 'https://mbc.uz/storage/media/13_1739384046.webp'],
  ['archival-14', 'archival-cgi-concept', 'archival-14.webp', 'https://mbc.uz/storage/media/14_1739384073.webp'],
  ['opening-cover', 'documentary-opening', 'opening-cover.webp', 'https://www.mbc.uz/storage/articles/e9499ca6-1fc0-4fd6-a281-6765102bf697.webp'],
  ['opening-1', 'documentary-opening', 'opening-1.png', 'https://www.mbc.uz/storage/media/Spot_1%20%282%29_1779367861.png'],
  ['opening-4', 'documentary-opening', 'opening-4.png', 'https://www.mbc.uz/storage/media/Spot_4_1779367941.png'],
  ['opening-6', 'documentary-opening', 'opening-6.png', 'https://www.mbc.uz/storage/media/Spot_6_1779367979.png'],
].map(([id, materialType, file, url]) => ({ id, materialType, file, url }));

const planDefinitions = [
  ['66bef7a7e4ce0', 'jpg'],
  ['67d3f75a8d93b', 'png'],
  ['67d3f7871a29b', 'png'],
  ['67d3f7ec7eb2c', 'png'],
  ['68a5ab5e26317', 'png'],
  ['69047d515d4b2', 'png'],
].map(([id, extension]) => ({
  id,
  sourceUrl: `https://pb12218.profitbase.ru/uploads/preset/12218/${id}.${extension}`,
  sourcePath: `assets/plans/plan-${id}.${extension}`,
  headerPath: `capture/headers/plan-${id}.${extension}.headers`,
  publicPath: `/regnum-plaza/plans/${id}.webp`,
}));

const disclosure = {
  'real-first-phase': { ru: 'Реальная первая очередь', uz: 'Haqiqiy birinchi bosqich', en: 'Actual first phase' },
  'documentary-opening': { ru: 'Документальная съёмка открытия', uz: 'Ochilishning hujjatli tasvirlari', en: 'Documentary opening photography' },
  'cgi-full-project': { ru: 'CGI полного проекта · итоговый вид может измениться', uz: 'Butun loyiha CGI tasviri · yakuniy ko‘rinish o‘zgarishi mumkin', en: 'Full-project CGI · final appearance may change' },
  'archival-cgi-concept': { ru: 'Архивный концепт · не текущая фотография', uz: 'Arxiv konsepti · joriy fotosurat emas', en: 'Archival concept · not a current photograph' },
  'brand-asset': { ru: 'Официальный логотип', uz: 'Rasmiy logotip', en: 'Official logo' },
};

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function parse(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
}
function jsonBuffer(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function counts(values, compare = (left, right) => Number(left) - Number(right)) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map].sort(([left], [right]) => compare(left, right)).map(([value, count]) => ({ value, count }));
}
function range(values) { return { min: Math.min(...values), max: Math.max(...values) }; }
function headerMetadata(text, fallbackStatus) {
  const statuses = [...text.matchAll(/^HTTP\/\S+\s+(\d+)/gmi)].map((match) => Number(match[1]));
  const contentTypes = [...text.matchAll(/^content-type:\s*(.+)$/gmi)].map((match) => match[1].trim());
  const dates = [...text.matchAll(/^date:\s*(.+)$/gmi)].map((match) => match[1].trim());
  const serverDateUtc = dates.at(-1) ?? null;
  return {
    httpStatus: statuses.at(-1) ?? fallbackStatus,
    contentType: contentTypes.at(-1) ?? null,
    serverDateUtc,
    requestedAtUtc: null,
    completedAtUtc: null,
    timestampBasis,
  };
}
async function capturedRecord({ id, url, method = 'GET', requestBody = null, localPath, headerPath = null, statusCode = 200, capturedResponseSha256 = null }) {
  const buffer = await readFile(resolve(sourceRoot, localPath));
  const header = headerPath ? headerMetadata(await readFile(resolve(sourceRoot, headerPath), 'utf8'), statusCode) : {
    httpStatus: statusCode, contentType: localPath.endsWith('.html') ? 'text/html; charset=UTF-8' : null, serverDateUtc: null, requestedAtUtc: null, completedAtUtc: null, timestampBasis,
  };
  return {
    id, method, url, requestBody, finalUrl: url, ...header, localPath,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    ...(capturedResponseSha256 ? {
      capturedResponseSha256,
      sanitization: 'Ephemeral CSRF token was replaced with [REDACTED] before storage; local bytes/hash describe the sanitized offline copy.',
    } : {}),
  };
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
function pngDimensions(buffer) { return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }; }
function jpegDimensions(buffer) {
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    offset += 2 + length;
  }
  return null;
}
function dimensions(buffer, path) {
  if (path.endsWith('.webp')) return webpDimensions(buffer);
  if (path.endsWith('.png')) return pngDimensions(buffer);
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return jpegDimensions(buffer);
  if (path.endsWith('.svg')) {
    const text = buffer.toString('utf8', 0, 300);
    const width = Number(text.match(/\bwidth="([\d.]+)"/)?.[1]);
    const height = Number(text.match(/\bheight="([\d.]+)"/)?.[1]);
    return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
  }
  return null;
}
function contentType(path) {
  const extension = extname(path).toLowerCase();
  return ({ '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4' })[extension] ?? 'application/octet-stream';
}

async function publicDerivative(sourceId, materialType, publicPath, transformation) {
  const buffer = await readFile(resolve(publicRoot, publicPath.slice(1)));
  const media = dimensions(buffer, publicPath);
  return {
    sourceId, materialType, ...(disclosure[materialType] ? { disclosure: disclosure[materialType] } : {}), transformation,
    publicPath, localPath: `public${publicPath}`, contentType: contentType(publicPath),
    bytes: buffer.byteLength, sha256: sha256(buffer),
    ...(media ? media : {}),
    ...(publicPath.endsWith('.mp4') ? { width: 1492, height: 900, durationSeconds: 24, codec: 'H.264', hasAudio: false } : {}),
  };
}

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

async function buildArtifacts() {
  const [page1Buffer, page2Buffer] = await Promise.all([
    readFile(resolve(sourceRoot, 'api/plans-1.json')),
    readFile(resolve(sourceRoot, 'api/plans-2.json')),
  ]);
  assert(page1Buffer.byteLength === expectedApi.page1.bytes && sha256(page1Buffer) === expectedApi.page1.sha256, 'plans-1.json is not the approved frozen capture');
  assert(page2Buffer.byteLength === expectedApi.page2.bytes && sha256(page2Buffer) === expectedApi.page2.sha256, 'plans-2.json is not the approved frozen capture');
  const page1 = parse(page1Buffer, 'api/plans-1.json');
  const page2 = parse(page2Buffer, 'api/plans-2.json');
  assert(page1.plans?.current_page === 1 && page2.plans?.current_page === 2 && page1.plans?.total === 12 && page2.plans?.total === 12, 'Unexpected API pagination contract');
  const rawUnits = [...page1.plans.data, ...page2.plans.data];
  assert(rawUnits.length === 12, 'Expected exactly 12 current apartment rows');
  assert(new Set(rawUnits.map((unit) => unit.id)).size === 12, 'Internal IDs are not unique');
  assert(new Set(rawUnits.map((unit) => unit.crm_id)).size === 12, 'CRM IDs are not unique');
  assert(rawUnits.every((unit) => unit.project_id === 1 && unit.project_slug === 'regnum-plaza' && unit.status === 'AVAILABLE' && unit.project_active === 1 && unit.is_price === 0), 'Raw project/status/public-price contract changed');

  const apiRecords = await Promise.all([
    capturedRecord({ id: 'plans-page-1', url: 'https://mbc.uz/api/plans', method: 'POST', requestBody: { project: 1, page: 1 }, localPath: 'api/plans-1.json', headerPath: 'capture/headers/plans-1.headers' }),
    capturedRecord({ id: 'plans-page-2', url: 'https://mbc.uz/api/plans', method: 'POST', requestBody: { project: 1, page: 2 }, localPath: 'api/plans-2.json', headerPath: 'capture/headers/plans-2.headers' }),
  ]);
  const pageRecords = await Promise.all(pageDefinitions.map((definition) => capturedRecord(definition)));
  const mediaRecords = await Promise.all(mediaDefinitions.map(async (definition) => ({
    ...(await capturedRecord({
      id: definition.id, url: definition.url, localPath: `assets/media/${definition.file}`,
      headerPath: `capture/headers/${definition.file}.headers`,
    })),
    materialType: definition.materialType,
    disclosure: disclosure[definition.materialType],
  })));
  const planRecords = await Promise.all(planDefinitions.map(async (definition) => {
    const sourceBuffer = await readFile(resolve(sourceRoot, definition.sourcePath));
    const sourceDimensions = dimensions(sourceBuffer, definition.sourcePath);
    assert(sourceDimensions, `${definition.sourcePath}: unsupported plan image dimensions`);
    return {
      ...(await capturedRecord({ id: definition.id, url: definition.sourceUrl, localPath: definition.sourcePath, headerPath: definition.headerPath })),
      materialType: 'official-unit-plan', ...sourceDimensions,
    };
  }));
  const floorPlanRecord = await capturedRecord({
    id: 'section11-floor9-layout', url: 'https://pb12218.profitbase.ru/uploads/layout/12218/67d3f89ddbff2.png',
    localPath: 'assets/plans/floor-section11-floor9.png', headerPath: 'capture/headers/floor-section11-floor9.png.headers',
  });

  const sourceManifest = {
    project: 'Regnum Plaza', projectSlug: 'regnum-plaza', capturedAtUtc, capturedAtUzt,
    capturePolicy: 'Official responses are frozen locally. Cookies are not stored; Set-Cookie headers were removed and page CSRF values were redacted.',
    pages: pageRecords, api: apiRecords,
    references: {
      mediaManifest: 'media-manifest.json', planManifest: 'plan-manifest.json', factProvenance: 'fact-provenance.json',
      assetDerivatives: 'asset-derivatives-manifest.json', planDerivatives: 'plan-derivatives-manifest.json', bundleManifest: 'bundle-manifest.json',
      privateCanonical: 'private-canonical.json',
    },
    booklet: { foundInFrozenCaptureScope: false, publicDownload: null, note: 'The frozen landing/current-API capture set contains no project-booklet link. Hidden generated per-unit sheets are outside the public-download contract and are not presented as a booklet.' },
  };
  const apiManifest = { projectId: 1, projectSlug: 'regnum-plaza', capturedAtUtc, endpoints: apiRecords, total: 12, publicPrice: false, sourceIsPrice: 0 };
  const mediaManifest = { project: 'Regnum Plaza', count: mediaRecords.length, classificationPolicy: disclosure, items: mediaRecords };
  const planManifest = { project: 'Regnum Plaza', count: 6, missingUnitPlanCount: 2, floorPlanSample: floorPlanRecord, items: planRecords };

  const mediaPublic = [
    ['official-logo', 'brand-asset', '/regnum-plaza/logo.svg', 'byte-identical official SVG'],
    ['hero-desktop', 'real-first-phase', '/regnum-plaza/images/hero.webp', 'byte-identical source WebP'],
    ['hero-mobile', 'real-first-phase', '/regnum-plaza/images/hero-mobile.webp', 'byte-identical source WebP'],
    ['first-phase-video', 'real-first-phase', '/regnum-plaza/video/first-phase.mp4', 'byte-identical source MP4'],
    ['first-phase-video', 'real-first-phase', '/regnum-plaza/images/video-poster.webp', 'frame at 00:08, 1500px WebP q88'],
    ...mediaDefinitions
      .filter((item) => !['official-logo', 'hero-desktop', 'hero-mobile', 'first-phase-video'].includes(item.id))
      .map((item) => [item.id, item.materialType, `/regnum-plaza/images/${item.file.replace(/\.png$/, '.webp')}`, item.file.startsWith('opening-') ? 'WebP q88' : 'WebP q86–87; maximum useful width preserved']),
  ];
  const assetDerivatives = await Promise.all(mediaPublic.map(([sourceId, materialType, publicPath, transformation]) => publicDerivative(sourceId, materialType, publicPath, transformation)));
  const planSourceById = new Map(planRecords.map((record) => [record.id, record]));
  const planDerivatives = await Promise.all(planDefinitions.map(async (definition) => {
    const source = planSourceById.get(definition.id);
    const derivative = await publicDerivative(definition.id, 'official-unit-plan', definition.publicPath, 'WebP q92; width=min(source width, 1000px); no upscaling');
    assert(source && derivative.width === Math.min(source.width, 1000), `${definition.id}: plan derivative width must be min(source width, 1000px)`);
    assert(Math.abs(derivative.height - (source.height * derivative.width / source.width)) <= 1, `${definition.id}: plan derivative aspect ratio changed`);
    return { ...derivative, sourceWidth: source.width, sourceHeight: source.height };
  }));
  const assetDerivativesManifest = { project: 'Regnum Plaza', count: assetDerivatives.length, items: assetDerivatives };
  const planDerivativesManifest = { project: 'Regnum Plaza', count: planDerivatives.length, items: planDerivatives };

  const planByUrl = new Map(planDefinitions.map((definition) => [definition.sourceUrl, definition]));
  const planDerivativeById = new Map(planDerivatives.map((derivative) => [derivative.sourceId, derivative]));
  const canonicalUnits = rawUnits.map((raw, sourceOrder) => {
    const plan = raw.image ? planByUrl.get(raw.image) : null;
    const planDerivative = plan ? planDerivativeById.get(plan.id) : null;
    assert(!raw.image || plan, `Unknown official plan URL for unit ${raw.id}`);
    return {
      id: String(raw.id), internalId: raw.id, crmId: raw.crm_id, sourceOrder, number: String(raw.number),
      rooms: raw.rooms, area: raw.square, floor: raw.floor, queue: Number(raw.queue), section: Number(raw.section), completion: String(raw.end),
      status: 'available', statusOriginal: raw.status, projectActive: raw.project_active === 1, sourceIsPrice: raw.is_price,
      publicPrice: false, effectivePrice: raw.price, regularPrice: raw.price, pricePerM2: Math.round(raw.price / raw.square), displayPriceKey: 'priceOnRequest',
      snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null,
      maxFloor: Number(raw.project?.floor), entrance: Number(raw.section), block: `Q${raw.queue}/S${raw.section}`, blockName: `Q${raw.queue}/S${raw.section}`, blockId: `q${raw.queue}-s${raw.section}`, studio: false,
      planSourceUrl: raw.image, planPublicPath: plan?.publicPath ?? null, planWidth: planDerivative?.width ?? null, planHeight: planDerivative?.height ?? null,
      provenance: { apiPage: sourceOrder < page1.plans.data.length ? 1 : 2, capturedAtUtc, rawSha256: sourceOrder < page1.plans.data.length ? expectedApi.page1.sha256 : expectedApi.page2.sha256 },
    };
  });
  assert(new Set(canonicalUnits.filter((unit) => unit.planSourceUrl).map((unit) => unit.planSourceUrl)).size === 6, 'Expected six unique official plan sources');
  assert(canonicalUnits.filter((unit) => !unit.planSourceUrl && !unit.planPublicPath).length === 2, 'Expected two units without an official plan');

  const rankBy = (selector) => new Map([...canonicalUnits]
    .sort((left, right) => selector(left) - selector(right) || left.sourceOrder - right.sourceOrder)
    .map((unit, rank) => [unit.id, rank]));
  const priceRanks = rankBy((unit) => unit.effectivePrice);
  const ppmRanks = rankBy((unit) => unit.pricePerM2);
  const units = canonicalUnits.map((unit) => ({
    id: unit.id, sourceOrder: unit.sourceOrder, number: unit.number, rooms: unit.rooms, area: unit.area, floor: unit.floor,
    queue: unit.queue, section: unit.section, completion: unit.completion, status: unit.status,
    publicPrice: false, displayPriceKey: unit.displayPriceKey, priceRank: priceRanks.get(unit.id), ppmRank: ppmRanks.get(unit.id),
    planPublicPath: unit.planPublicPath, planWidth: unit.planWidth, planHeight: unit.planHeight,
  }));

  const groups = [...new Map(units.map((unit) => [`${unit.queue}:${unit.section}`, { id: `q${unit.queue}-s${unit.section}`, queue: unit.queue, section: unit.section }])).values()]
    .sort((left, right) => left.queue - right.queue || left.section - right.section)
    .map((group) => ({ ...group, unitIds: units.filter((unit) => unit.queue === group.queue && unit.section === group.section).map((unit) => unit.id) }));
  const matrixRows = groups.flatMap((group) => [...new Set(units.filter((unit) => group.unitIds.includes(unit.id)).map((unit) => unit.floor))]
    .sort((left, right) => left - right)
    .map((floor) => ({ id: `${group.id}-f${floor}`, groupId: group.id, queue: group.queue, section: group.section, floor, unitIds: units.filter((unit) => group.unitIds.includes(unit.id) && unit.floor === floor).map((unit) => unit.id) })));
  assert(groups.length === 4 && matrixRows.length === 11, 'Regnum matrix must contain four real groups and eleven exact snapshot rows');

  const project = rawUnits[0].project;
  assert(project?.updated_at === '2026-08-12T12:56:39.000000Z', 'Project updated_at changed');
  const catalog = {
    project: 'REGNUM PLAZA', projectSlug: 'regnum-plaza', projectId: 1, capturedAt: capturedAtUtc, capturedAtUzt,
    dbUpdatedAt: '2026-08-12T12:56:39.000000Z', officialTotalAtCapture: 12, publicPrice: false, offerCount: 0,
    pricingPolicy: { display: 'price-on-request', clientSortKeys: ['priceRank', 'ppmRank'], numericPricesPublic: false, jsonLdOffers: false },
    campaign: { snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null },
    projectFacts: {
      class: { ru: 'Бизнес', uz: 'Biznes', en: 'Business' },
      status: { ru: 'Последние квартиры', uz: "Eng so'nggi kvartiralar", en: 'Last Remaining Apartments' },
      completion: { ru: 'IV квартал 2026', uz: 'IV kvartal 2026', en: 'Q4 2026' },
      blocks: 11, apartments: 776, phases: 3, siteAreaSquareMeters: 30000,
      address: { ru: 'Ташкент, Мирзо-Улугбекский район, ул. Сайрам', uz: "Toshkent shahri, Mirzo Ulug‘bek tumani, Sayram ko‘chasi", en: 'Sayram Street, Mirzo-Ulugbek District, Tashkent' },
      coordinates: { latitude: 41.331564, longitude: 69.324328 },
      salesOffice: { ru: 'Ташкент, Мирабадский район, ул. Ойбека, 38A', uz: "Toshkent, Mirobod tumani, Oybek ko‘chasi, 38A", en: '38A Oybek Street, Mirabad District, Tashkent', latitude: 41.291432, longitude: 69.280519 },
      phone: '+998 78 122 88 22', insuranceYears: 10,
    },
    source: 'https://mbc.uz/api/plans', sourceLanding: 'https://mbc.uz/project/regnum-plaza', sourceGenplan: 'https://mbc.uz/genplan/regnum-plaza', sourceTour: 'https://cloud.chaos.com/collaboration/n/VELR7kWdz9hqfoHWYRwfai/present?t=vrt',
    integrity: { uniqueInternalIds: 12, uniqueCrmIds: 12, uniqueOfficialPlanSources: 6, missingOfficialPlans: 2, realGroups: 4, exactMatrixRows: 11, publicDerivativeCount: assetDerivatives.length + planDerivatives.length },
    filterSummary: {
      rooms: counts(units.map((unit) => unit.rooms)), floors: counts(units.map((unit) => unit.floor)), queues: counts(units.map((unit) => unit.queue)), sections: counts(units.map((unit) => unit.section)), completions: counts(units.map((unit) => unit.completion), (left, right) => String(left).localeCompare(String(right))), statuses: counts(units.map((unit) => unit.status), (left, right) => String(left).localeCompare(String(right))),
      ranges: { area: range(units.map((unit) => unit.area)), floor: range(units.map((unit) => unit.floor)) },
    },
    matrix: { policy: 'Only exact current-listing rows are represented; no physical empty floors are invented.', groups, rows: matrixRows },
    units,
  };

  const privateCatalog = {
    project: 'REGNUM PLAZA', projectSlug: 'regnum-plaza', projectId: 1, capturedAt: capturedAtUtc, dbUpdatedAt: '2026-08-12T12:56:39.000000Z',
    publicPrice: false, sourceIsPrice: 0, campaign: { snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null }, units: canonicalUnits,
  };
  const derivedSummary = {
    project: 'Regnum Plaza', capturedAtUtc, units: units.length, uniqueInternalIds: new Set(canonicalUnits.map((unit) => unit.internalId)).size,
    uniqueCrmIds: new Set(canonicalUnits.map((unit) => unit.crmId)).size, uniquePlanSources: new Set(canonicalUnits.filter((unit) => unit.planSourceUrl).map((unit) => unit.planSourceUrl)).size,
    missingPlans: canonicalUnits.filter((unit) => !unit.planSourceUrl).length, groups: groups.length, matrixRows: matrixRows.length,
    roomDistribution: Object.fromEntries(catalog.filterSummary.rooms.map(({ value, count }) => [value, count])), publicPrice: false, offerCount: 0,
  };
  const factProvenance = {
    project: 'Regnum Plaza', rule: 'Use only scoped facts from the frozen official sources; do not turn historical CGI, missing material, or source defects into current promises.',
    facts: [
      { id: 'project-core', value: 'Business class; last remaining apartments; 11 blocks, 776 apartments, 3 phases, 30,000 m²; Sayram Street.', source: 'api/plans-1.json', jsonPointer: '/plans/data/0/project' },
      { id: 'completion-en-correction', value: { ru: 'IV квартал 2026', uz: 'IV kvartal 2026', sourceEn: '5th Quarter 2026', publishedEn: 'Q4 2026' }, note: 'The official EN object contains an impossible fifth quarter. RU/UZ agree on Q4; localized EN is corrected and the inconsistency is retained here.', source: 'api/plans-1.json', jsonPointer: '/plans/data/0/project/end' },
      { id: 'first-phase-opening', value: 'The first phase officially opened on 20 May; the source article does not visibly establish the year, so public copy omits it.', source: 'sources/pages/opening.html' },
      { id: 'media-classification', value: disclosure, source: 'media-manifest.json' },
      { id: 'no-construction-gallery', value: 'The frozen official landing, current API, opening-article and launch-article capture set contains no separately labelled construction-progress collection; the published gallery therefore does not classify any item as construction progress.', sources: ['sources/pages/project.html', 'api/plans-1.json', 'api/plans-2.json', 'sources/pages/opening.html', 'sources/pages/launch.html'], scope: 'Frozen captures listed in source-manifest.json only.' },
      { id: 'no-booklet', value: 'The frozen official landing and current-API capture set contains no public project-booklet link; generated per-unit sheets are not presented as a booklet.', sources: ['sources/pages/project.html', 'api/plans-1.json', 'api/plans-2.json'], scope: 'Frozen captures listed in source-manifest.json only.' },
      { id: 'no-active-campaign', value: { campaignActive: false, campaignDeadline: null, snapshotCampaignPrice: null }, note: 'All 12 frozen current rows have is_price=0 and the captured current API/landing objects contain no campaign, promotion or deadline field. The snapshot records no active campaign; it makes no claim about URLs outside this capture set.', sources: ['api/plans-1.json', 'api/plans-2.json', 'sources/pages/project.html'], jsonPointers: ['/plans/data/*/is_price', '/plans/data/*'], scope: 'Frozen current API pages and project landing captured at the declared timestamp only.' },
      { id: 'section11-floor14-inconsistency', value: 'Section 11 UI lists floors 3–12, while the API includes an available unit on floor 14 and the official building floor-14 route fails. The matrix therefore uses the 11 exact current-listing rows only.', sources: ['api/plans-1.json', 'sources/pages/building-section11-floor9.html', 'sources/pages/building-section11-floor14.html'] },
      { id: 'floor9-control', value: 'The official floor plan shows six cells, but only apartment no. 40 is AVAILABLE in the current 12-row snapshot; sold/unavailable cells are not added.', source: 'assets/plans/floor-section11-floor9.png' },
    ],
  };

  return { catalog, privateCatalog, sourceManifest, apiManifest, mediaManifest, planManifest, assetDerivativesManifest, planDerivativesManifest, derivedSummary, factProvenance };
}

async function compareOrWrite(path, value) {
  const expected = jsonBuffer(value);
  if (!checkOnly) { await writeFile(path, expected); return; }
  let actual;
  try { actual = await readFile(path); } catch { fail(`${path}: missing generated artifact`); }
  const parsedActual = parse(actual, path);
  assert(isDeepStrictEqual(parsedActual, value), `${path}: differs from deterministic offline rebuild`);
  assert(actual.equals(expected), `${path}: formatting differs from deterministic output`);
}

export async function buildRegnumPlazaCatalog() {
  const artifacts = await buildArtifacts();
  const outputs = [
    [clientCatalogPath, artifacts.catalog],
    [privateCatalogPath, artifacts.privateCatalog],
    [resolve(sourceRoot, 'source-manifest.json'), artifacts.sourceManifest],
    [resolve(sourceRoot, 'api-manifest.json'), artifacts.apiManifest],
    [resolve(sourceRoot, 'media-manifest.json'), artifacts.mediaManifest],
    [resolve(sourceRoot, 'plan-manifest.json'), artifacts.planManifest],
    [resolve(sourceRoot, 'asset-derivatives-manifest.json'), artifacts.assetDerivativesManifest],
    [resolve(sourceRoot, 'plan-derivatives-manifest.json'), artifacts.planDerivativesManifest],
    [resolve(sourceRoot, 'derived-summary.json'), artifacts.derivedSummary],
    [resolve(sourceRoot, 'fact-provenance.json'), artifacts.factProvenance],
  ];
  for (const [path, value] of outputs) await compareOrWrite(path, value);

  const files = (await walk(sourceRoot)).filter((path) => path !== 'bundle-manifest.json' && path !== 'integrity-report.json');
  const bundleEntries = await Promise.all(files.map(async (localPath) => {
    const buffer = await readFile(resolve(sourceRoot, localPath));
    return { localPath, bytes: buffer.byteLength, sha256: sha256(buffer) };
  }));
  const bundleManifest = { project: 'Regnum Plaza', root: 'source/regnum-plaza', excludes: ['bundle-manifest.json', 'integrity-report.json'], total: bundleEntries.length, files: bundleEntries };
  await compareOrWrite(resolve(sourceRoot, 'bundle-manifest.json'), bundleManifest);
  return { ...artifacts, bundleManifest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildRegnumPlazaCatalog()
    .then(({ catalog, bundleManifest }) => console.log(`${checkOnly ? 'Checked' : 'Built'} Regnum Plaza offline catalog: ${catalog.units.length} units, ${catalog.integrity.uniqueOfficialPlanSources} plan sources, ${catalog.matrix.rows.length} matrix rows, ${bundleManifest.total} frozen bundle files, 0 Offers.`))
    .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
