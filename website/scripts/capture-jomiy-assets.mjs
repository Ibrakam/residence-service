import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = process.env.JOMIY_CAPTURE_ROOT;
if (!root) throw new Error('Set JOMIY_CAPTURE_ROOT to a completed API capture directory.');
const require = createRequire(join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const apiManifest = JSON.parse(await readFile(join(root, 'api-manifest.json'), 'utf8'));
const rawDetails = await Promise.all(apiManifest.details.map(async (item) => JSON.parse(await readFile(join(root, item.localPath), 'utf8'))));

async function request(url, accept = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8') {
  let latest;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const requestedAtUtc = new Date().toISOString();
    try {
      const response = await fetch(url, {
        headers: { accept, 'user-agent': 'Jomiy snapshot audit/1.0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(90000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      latest = { response, buffer, requestedAtUtc, completedAtUtc: new Date().toISOString() };
      if (response.status >= 200 && response.status < 300) return latest;
    } catch (error) {
      latest = { error };
    }
    await sleep(attempt * 500);
  }
  throw new Error(`GET failed ${url}: ${latest?.response?.status ?? latest?.error}`);
}

async function downloadImage({ id, materialType, sourceUrl, relativePath, note = null, unitId = null, unitNumber = null }) {
  const result = await request(sourceUrl);
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(join(root, relativePath), result.buffer);
  let dimensions = null;
  let detectedFormat = null;
  try {
    const metadata = await sharp(result.buffer).metadata();
    dimensions = metadata.width && metadata.height ? { width: metadata.width, height: metadata.height } : null;
    detectedFormat = metadata.format ?? null;
  } catch {}
  return {
    id,
    materialType,
    note,
    unitId,
    unitNumber,
    sourceUrl,
    requestedAtUtc: result.requestedAtUtc,
    completedAtUtc: result.completedAtUtc,
    httpStatus: result.response.status,
    finalUrl: result.response.url,
    contentType: result.response.headers.get('content-type'),
    serverDateUtc: result.response.headers.get('date'),
    lastModified: result.response.headers.get('last-modified'),
    etag: result.response.headers.get('etag'),
    localPath: relativePath,
    bytes: result.buffer.byteLength,
    sha256: sha256(result.buffer),
    detectedFormat,
    dimensions,
  };
}

async function runPool(tasks, worker, concurrency) {
  const results = new Array(tasks.length);
  let cursor = 0;
  async function loop() {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      results[index] = await worker(tasks[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => loop()));
  return results;
}

const marketing = [
  ['real-01', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A0052_1_def244d3c4.png', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-02', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A0076_resized_e7cac10098.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-03', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A0049_resized_86a3ace533.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-04', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/a1_f5ef032430.png', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-05', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A0083_resized_e41ed0f4b8.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-06', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A0025_resized_kopiya_ad556b45d3.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-07', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/3_8919552310.png', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-08', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/N018997_resized_1362b65d06.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-09', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A5132_resized_915572afb2.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-10', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/668_A5274_resized_3bc5f322ea.jpg', 'Actual Jomiy photography supplied by the official source list.'],
  ['real-11', 'actual-photo', 'https://s3.bi.group/biclick/content-manager/unnamed_60f145cfd6.webp', 'Actual Jomiy photography supplied by the official source list.'],
  ['cgi-01', 'official-cgi', 'https://s3.bi.group/biclick/content-manager/10004_kopiya_f563f2cb07.jpg', 'Official visualization; never label as a photograph.'],
  ['cgi-02', 'official-cgi', 'https://s3.bi.group/biclick/content-manager/10002_kopiya_a05698106d.jpg', 'Official visualization; never label as a photograph.'],
  ['cgi-03', 'official-cgi', 'https://s3.bi.group/biclick/content-manager/10000_kopiya_68c227d3af.jpg', 'Official visualization; never label as a photograph.'],
  ['cgi-04', 'official-cgi', 'https://s3.bi.group/biclick/content-manager/Jomiy_Cam_1_0e3b2f413a.png', 'Official visualization; never label as a photograph.'],
  ['cgi-05', 'official-cgi', 'https://s3.bi.group/biclick/content-manager/fvfyv_3c27f63be4.jpg', 'Official visualization; never label as a photograph.'],
  ['phase-scheme', 'conceptual-photomontage-phase-scheme', 'https://s3.bi.group/biclick/content-manager/ptichka_jomiy_rus_ae5887143b.jpg', 'Conceptual photomontage/phase scheme; not a photograph of a completed project.'],
  ['construction-2026-07-01', 'construction-photo-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5427_resized_f49c4c6169.jpg', 'Actual construction progress, July 2026.'],
  ['construction-2026-07-02', 'construction-photo-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5380_resized_9f3ef817cd.jpg', 'Actual construction progress, July 2026.'],
  ['construction-2026-07-03', 'construction-photo-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5388_resized_152a42589c.jpg', 'Actual construction progress, July 2026.'],
  ['construction-2026-07-04', 'construction-photo-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5381_resized_8494b52665.jpg', 'Actual construction progress, July 2026.'],
  ['construction-2026-07-05', 'construction-photo-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5433_resized_0e5aff5a13.jpg', 'Actual construction progress, July 2026.'],
  ['parking-illustrative', 'official-illustrative-photo-not-proven-jomiy', 'https://s3.bi.group/biclick/content-manager/Car_8_dece2c7bf0.jpg', 'Official illustrative parking photo; capture location is not proven to be Jomiy.'],
  ['storage-illustrative', 'official-illustrative-photo-not-proven-jomiy', 'https://s3.bi.group/biclick/content-manager/IMG_2503_469847f9cc.JPG', 'Official illustrative storage photo; capture location is not proven to be Jomiy.'],
].map(([id, materialType, sourceUrl, note]) => ({ id, materialType, sourceUrl, note }));

const pageSources = [
  ['landing-ru', 'https://nrg-bi.uz/uz-ru/landing/jomiy'],
  ['landing-uz', 'https://nrg-bi.uz/uz/landing/jomiy'],
  ['handover-news-2-1', 'https://nrg-bi.uz/uz-ru/news/jomiy-2.1-uspeshno-sdana!'],
  ['promotion-open-day', 'https://nrg-bi.uz/uz-ru/promotion/Jomiy-den-otkrutux'],
  ['ecosystem', 'https://nrg-bi.uz/uz-ru/special/ecosystem'],
  ['virtual-panorama', 'https://uzbekistan360.uz/ru/location/nrg-jomiy-vid-so-dvoraOWb'],
  ['official-apartment-catalog', 'https://nrg-bi.uz/uz-ru/filter/placements?companyIds=%5B%225cba02b4-8abd-11ee-ab79-001dd8b7289a%22%5D&realEstateUUIDs=%5B%2281153f29-f48b-11ed-a82e-001dd8b726aa%22%5D&propertyTypes=%5B%225990a172-812a-4fee-b4f5-c860cca824d7%22%5D&filterTags=%7B%7D'],
].map(([id, url]) => ({ id, url }));

await mkdir(join(root, 'assets', 'marketing'), { recursive: true });
const marketingResults = await runPool(marketing, async (asset) => {
  const extension = extname(new URL(asset.sourceUrl).pathname).toLowerCase() || '.bin';
  return downloadImage({ ...asset, relativePath: `assets/marketing/${asset.id}${extension}` });
}, 8);

await mkdir(join(root, 'sources', 'pages'), { recursive: true });
const pageResults = await runPool(pageSources, async (source) => {
  const result = await request(source.url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
  const relativePath = `sources/pages/${source.id}.html`;
  await writeFile(join(root, relativePath), result.buffer);
  return {
    id: source.id,
    method: 'GET',
    url: source.url,
    requestedAtUtc: result.requestedAtUtc,
    completedAtUtc: result.completedAtUtc,
    httpStatus: result.response.status,
    finalUrl: result.response.url,
    contentType: result.response.headers.get('content-type'),
    serverDateUtc: result.response.headers.get('date'),
    localPath: relativePath,
    bytes: result.buffer.byteLength,
    sha256: sha256(result.buffer),
  };
}, 4);

const planTasks = rawDetails.flatMap((detail) => [
  {
    id: `${detail.placementUUID}-page1`,
    materialType: 'official-apartment-sheet-floor-position',
    sourceUrl: detail.apartmentSheetURLPage1,
    relativePath: `assets/plans/page1/${detail.placementUUID}.jpg`,
    unitId: detail.placementUUID,
    unitNumber: String(detail.placementName),
  },
  {
    id: `${detail.placementUUID}-page2`,
    materialType: 'official-apartment-sheet-individual-plan',
    sourceUrl: detail.apartmentSheetURLPage2,
    relativePath: `assets/plans/page2/${detail.placementUUID}.jpg`,
    unitId: detail.placementUUID,
    unitNumber: String(detail.placementName),
  },
  {
    id: `${detail.placementUUID}-card`,
    materialType: 'official-compact-layout-photoURL1600',
    sourceUrl: detail.photoURL1600,
    relativePath: `assets/plans/card/${detail.placementUUID}${extname(new URL(detail.photoURL1600).pathname).toLowerCase() || '.bin'}`,
    unitId: detail.placementUUID,
    unitNumber: String(detail.placementName),
  },
]);
const planResults = await runPool(planTasks, (task) => downloadImage(task), 10);
const byKind = (kind) => planResults.filter((item) => item.materialType === kind);
const planManifest = {
  project: 'Jomiy',
  capturedAtUtc: new Date().toISOString(),
  detailCount: rawDetails.length,
  page1Count: byKind('official-apartment-sheet-floor-position').length,
  page2Count: byKind('official-apartment-sheet-individual-plan').length,
  cardCount: byKind('official-compact-layout-photoURL1600').length,
  page1Http200Count: byKind('official-apartment-sheet-floor-position').filter((item) => item.httpStatus === 200).length,
  page2Http200Count: byKind('official-apartment-sheet-individual-plan').filter((item) => item.httpStatus === 200).length,
  cardHttp200Count: byKind('official-compact-layout-photoURL1600').filter((item) => item.httpStatus === 200).length,
  uniquePage1Urls: new Set(byKind('official-apartment-sheet-floor-position').map((item) => item.sourceUrl)).size,
  uniquePage2Urls: new Set(byKind('official-apartment-sheet-individual-plan').map((item) => item.sourceUrl)).size,
  uniqueCardUrls: new Set(byKind('official-compact-layout-photoURL1600').map((item) => item.sourceUrl)).size,
  totalBytes: planResults.reduce((sum, item) => sum + item.bytes, 0),
  items: rawDetails.map((detail) => ({
    unitId: detail.placementUUID,
    unitNumber: String(detail.placementName),
    page1: planResults.find((item) => item.id === `${detail.placementUUID}-page1`),
    page2: planResults.find((item) => item.id === `${detail.placementUUID}-page2`),
    card: planResults.find((item) => item.id === `${detail.placementUUID}-card`),
  })),
};
const mediaManifest = {
  project: 'Jomiy',
  capturedAtUtc: new Date().toISOString(),
  count: marketingResults.length,
  totalBytes: marketingResults.reduce((sum, item) => sum + item.bytes, 0),
  assets: marketingResults,
};
const sourceManifest = {
  project: 'Jomiy',
  capturedAtUtc: apiManifest.capturedAtUtc,
  captureCompletedAtUtc: new Date().toISOString(),
  officialPages: pageResults,
  apiManifest: 'api-manifest.json',
  derivedSummary: 'derived-summary.json',
  planManifest: 'plan-manifest.json',
  mediaManifest: 'media-manifest.json',
  booklet: {
    filePresentation: null,
    bookletImage: null,
    bookletUrl: '',
    availability: 'No accessible confirmed official Jomiy booklet; no PDF was created or substituted.',
  },
};
await writeFile(join(root, 'plan-manifest.json'), `${JSON.stringify(planManifest, null, 2)}\n`);
await writeFile(join(root, 'media-manifest.json'), `${JSON.stringify(mediaManifest, null, 2)}\n`);
await writeFile(join(root, 'source-manifest.json'), `${JSON.stringify(sourceManifest, null, 2)}\n`);

async function optimize(source, relativePath, { maxWidth, quality }) {
  const input = await readFile(join(root, source.localPath));
  const output = await sharp(input)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true, fit: 'inside' })
    .webp({ quality, smartSubsample: true, effort: 5 })
    .toBuffer();
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(join(root, relativePath), output);
  const metadata = await sharp(output).metadata();
  return {
    publicPath: `/${relativePath.slice('optimized/'.length)}`,
    localPath: relativePath,
    format: metadata.format,
    contentType: 'image/webp',
    dimensions: { width: metadata.width, height: metadata.height },
    maxWidth,
    quality,
    bytes: output.byteLength,
    sha256: sha256(output),
  };
}

const planDerivativeTasks = planManifest.items.flatMap((item) => [
  { unitId: item.unitId, unitNumber: item.unitNumber, kind: 'page1', source: item.page1, relativePath: `optimized/jomiy/sheets/page-1/${item.unitId}.webp`, options: { maxWidth: 1400, quality: 88 } },
  { unitId: item.unitId, unitNumber: item.unitNumber, kind: 'page2', source: item.page2, relativePath: `optimized/jomiy/sheets/page-2/${item.unitId}.webp`, options: { maxWidth: 1400, quality: 88 } },
  { unitId: item.unitId, unitNumber: item.unitNumber, kind: 'layout', source: item.card, relativePath: `optimized/jomiy/layouts/${item.unitId}.webp`, options: { maxWidth: 900, quality: 84 } },
]);
const planDerived = await runPool(planDerivativeTasks, async (task) => ({
  ...task,
  derivative: await optimize(task.source, task.relativePath, task.options),
}), 4);
const planItems = planManifest.items.map((item) => ({
  unitId: item.unitId,
  unitNumber: item.unitNumber,
  page1: { source: item.page1, derivative: planDerived.find((result) => result.unitId === item.unitId && result.kind === 'page1').derivative },
  page2: { source: item.page2, derivative: planDerived.find((result) => result.unitId === item.unitId && result.kind === 'page2').derivative },
  layout: { source: item.card, derivative: planDerived.find((result) => result.unitId === item.unitId && result.kind === 'layout').derivative },
}));
const planDerivativeManifest = {
  project: 'Jomiy',
  createdAtUtc: new Date().toISOString(),
  count: planItems.length,
  page1Count: planItems.length,
  page2Count: planItems.length,
  layoutCount: planItems.length,
  sourceBytes: planItems.reduce((sum, item) => sum + item.page1.source.bytes + item.page2.source.bytes + item.layout.source.bytes, 0),
  derivativeBytes: planItems.reduce((sum, item) => sum + item.page1.derivative.bytes + item.page2.derivative.bytes + item.layout.derivative.bytes, 0),
  items: planItems,
};
await writeFile(join(root, 'plan-derivatives-manifest.json'), `${JSON.stringify(planDerivativeManifest, null, 2)}\n`);

const publicName = {
  'real-01': 'hero-real',
  'real-02': 'real-02',
  'real-03': 'real-03',
  'real-04': 'real-04',
  'real-05': 'real-05',
  'real-06': 'real-06',
  'real-07': 'real-07',
  'real-08': 'real-08',
  'real-09': 'real-09',
  'real-10': 'real-10',
  'real-11': 'real-11',
  'cgi-01': 'cgi-01',
  'cgi-02': 'cgi-02',
  'cgi-03': 'cgi-03',
  'cgi-04': 'cgi-04',
  'cgi-05': 'cgi-05',
  'phase-scheme': 'scheme-phases',
  'construction-2026-07-01': 'construction-01',
  'construction-2026-07-02': 'construction-02',
  'construction-2026-07-03': 'construction-03',
  'construction-2026-07-04': 'construction-04',
  'construction-2026-07-05': 'construction-05',
  'parking-illustrative': 'parking-illustrative',
  'storage-illustrative': 'storage-illustrative',
};
const mediaDerived = await runPool(mediaManifest.assets, async (source) => {
  const name = publicName[source.id];
  if (!name) throw new Error(`Missing public mapping for ${source.id}`);
  const maxWidth = source.id === 'real-01' ? 2200 : 1900;
  const relativePath = `optimized/jomiy/images/${name}.webp`;
  return {
    id: source.id,
    publicName: name,
    materialType: source.materialType,
    note: source.note,
    source,
    derivative: await optimize(source, relativePath, { maxWidth, quality: 86 }),
  };
}, 4);
const mediaDerivativeManifest = {
  project: 'Jomiy',
  createdAtUtc: new Date().toISOString(),
  count: mediaDerived.length,
  sourceBytes: mediaDerived.reduce((sum, item) => sum + item.source.bytes, 0),
  derivativeBytes: mediaDerived.reduce((sum, item) => sum + item.derivative.bytes, 0),
  items: mediaDerived,
};
await writeFile(join(root, 'media-derivatives-manifest.json'), `${JSON.stringify(mediaDerivativeManifest, null, 2)}\n`);

console.log(JSON.stringify({
  root,
  plans: {
    units: planItems.length,
    files: planItems.length * 3,
    sourceBytes: planDerivativeManifest.sourceBytes,
    derivativeBytes: planDerivativeManifest.derivativeBytes,
  },
  media: {
    files: mediaDerived.length,
    sourceBytes: mediaDerivativeManifest.sourceBytes,
    derivativeBytes: mediaDerivativeManifest.derivativeBytes,
  },
  mapping: Object.fromEntries(mediaDerived.map((item) => [item.id, item.derivative.publicPath])),
}, null, 2));
