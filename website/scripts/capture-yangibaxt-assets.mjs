import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const placementPath = resolve(websiteRoot, 'data/yangibaxt-placement-raw.json');
const planManifestPath = resolve(websiteRoot, 'data/yangibaxt-plan-sources.json');
const mediaManifestPath = resolve(websiteRoot, 'data/yangibaxt-media-sources.json');
const imageRoot = resolve(websiteRoot, 'public/yangibaxt/images');
const planRoot = resolve(websiteRoot, 'public/yangibaxt/plans');
const floorRoot = resolve(websiteRoot, 'public/yangibaxt/floor-positions');
const documentRoot = resolve(websiteRoot, 'public/yangibaxt/documents');
const sourceBookletPath = resolve(websiteRoot, 'tmp/pdfs/yangibaxt-official.pdf');
const bookletOutputPath = resolve(documentRoot, 'yangibaxt-official.pdf');
const placementDetailUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placement';

const booklet = {
  sourceUrl: 'https://s3.bi.group/biclick/content-manager/Yangi_Baxt_6e54075b1b.pdf',
  sourceRepoPath: 'tmp/pdfs/yangibaxt-official.pdf',
  repoPath: 'public/yangibaxt/documents/yangibaxt-official.pdf',
  publicPath: '/yangibaxt/documents/yangibaxt-official.pdf',
  expectedBytes: 18_591_107,
  expectedSha256: '94998a9512584046f27a3e14a8a0f7ba802a6e99440a83a27299cdfc4fda33b7',
  expectedPages: 33,
};

const visualAssets = [
  ['hero-real', 'https://s3.bi.group/biclick/content-manager/668_A9947_2_9d6a00922c.jpg', 'real-photo', 'hero', 'Implemented landscaping'],
  ['phase-two-facade', 'https://s3.bi.group/biclick/content-manager/668_A8681_703edbe1b2.jpg', 'real-photo', 'completed-phase-two', 'Completed phase II facade'],
  ['realized-courtyard-01', 'https://s3.bi.group/biclick/content-manager/668_A6606_075761f04c.jpg', 'real-photo', 'completed-phase-two', 'Implemented courtyard'],
  ['realized-courtyard-02', 'https://s3.bi.group/biclick/content-manager/668_A6860_255fdc350b.jpg', 'real-photo', 'completed-phase-two', 'Implemented courtyard'],
  ['realized-landscape-01', 'https://s3.bi.group/biclick/content-manager/668_A7980_1_497805d7a0.jpg', 'real-photo', 'landscape', 'Implemented landscaping'],
  ['realized-landscape-02', 'https://s3.bi.group/biclick/content-manager/668_A7979_00f4acb3dd.jpg', 'real-photo', 'landscape', 'Implemented landscaping'],
  ['realized-landscape-03', 'https://s3.bi.group/biclick/content-manager/668_A7900_63ac088090.jpg', 'real-photo', 'landscape', 'Implemented landscaping'],
  ['gallery-courtyard-01', 'https://s3.bi.group/biclick/content-manager/668_A6636_79814c5adc.jpg', 'real-photo', 'courtyard', 'Implemented courtyard'],
  ['gallery-courtyard-02', 'https://s3.bi.group/biclick/content-manager/668_A6626_3d23da0ee1.jpg', 'real-photo', 'courtyard', 'Implemented courtyard'],
  ['gallery-courtyard-03', 'https://s3.bi.group/biclick/content-manager/668_A6857_cbccb50e8f.jpg', 'real-photo', 'courtyard', 'Implemented courtyard'],
  ['gallery-courtyard-04', 'https://s3.bi.group/biclick/content-manager/668_A9950_5785bac2e6.jpg', 'real-photo', 'courtyard', 'Implemented courtyard'],
  ['hall-01', 'https://s3.bi.group/biclick/content-manager/668_A6513_38fd8d4244.jpg', 'real-photo', 'lobby', 'Implemented lobby'],
  ['hall-02', 'https://s3.bi.group/biclick/content-manager/668_A6519_47446ce961.jpg', 'real-photo', 'lobby', 'Implemented lobby'],
  ['hall-03', 'https://s3.bi.group/biclick/content-manager/668_A6587_b8d19307c0.jpg', 'real-photo', 'lobby', 'Implemented lobby'],
  ['hall-04', 'https://s3.bi.group/biclick/content-manager/668_A6585_8cf352f4d5.jpg', 'real-photo', 'lobby', 'Implemented lobby'],
  ['district-concept', 'https://s3.bi.group/biclick/content-manager/C_08_652ef6945c.jpg', 'cgi-concept', 'district-concept', 'Official project concept'],
  ['park-concept', 'https://s3.bi.group/biclick/content-manager/Alleya_1_9e760a85de.jpg', 'cgi-concept', 'district-concept', 'Official park concept'],
  ['towers-concept-01', 'https://s3.bi.group/biclick/content-manager/cam_001_1_copy_3_22bf4c516f.jpg', 'cgi-concept', 'towers-three', 'Official Towers-3 concept'],
  ['towers-concept-02', 'https://s3.bi.group/biclick/content-manager/06_f770171b84.jpg', 'cgi-concept', 'towers-three', 'Official Towers-3 concept'],
  ['towers-concept-03', 'https://s3.bi.group/biclick/content-manager/07_8a2a1d6c76.jpg', 'cgi-concept', 'towers-three', 'Official Towers-3 concept'],
  ['architecture-concept', 'https://s3.bi.group/biclick/content-manager/1_2_6ca64a3984.jpg', 'cgi-concept', 'architecture', 'Official architecture concept'],
  ['construction-2026-07-01', 'https://s3.bi.group/biclick/content-manager/668_A5110_b3324aadb3.jpg', 'construction-photo', 'construction-2026-07', 'Yangi Baxt 3 construction progress'],
  ['construction-2026-07-02', 'https://s3.bi.group/biclick/content-manager/668_A5115_6a1173f9cb.jpg', 'construction-photo', 'construction-2026-07', 'Yangi Baxt 3 construction progress'],
  ['construction-2026-07-03', 'https://s3.bi.group/biclick/content-manager/668_A5112_cf001cc1c2.jpg', 'construction-photo', 'construction-2026-07', 'Yangi Baxt 3 construction progress'],
  ['construction-2026-07-04', 'https://s3.bi.group/biclick/content-manager/668_A5152_8ce6500210.jpg', 'construction-photo', 'construction-2026-07', 'Yangi Baxt 3 construction progress'],
].map(([id, sourceUrl, materialType, layer, usage]) => ({ id, sourceUrl, materialType, layer, usage }));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function detectImage(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { extension: '.jpg', format: 'JPEG', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: '.png', format: 'PNG', mime: 'image/png' };
  throw new Error('Unsupported image response');
}

async function dimensions(path) {
  const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { maxBuffer: 1024 * 1024 });
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not determine dimensions for ${path}`);
  return { width, height };
}

async function fetchWithRetry(url, init = {}) {
  let finalError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000), ...init });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
      return response;
    } catch (error) {
      finalError = error;
      if (attempt < 4) await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 400));
    }
  }
  throw finalError;
}

async function pool(items, limit, task, label) {
  const results = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index], index);
      completed += 1;
      process.stdout.write(`\r${label} ${completed}/${items.length}`);
    }
  }));
  process.stdout.write('\n');
  return results;
}

async function convertBuffer({ buffer, id, outputPath, publicPath, repoPath, maxWidth, quality, tempRoot }) {
  const detected = detectImage(buffer);
  const sourcePath = resolve(tempRoot, `${id}${detected.extension}`);
  await writeFile(sourcePath, buffer);
  const sourceDimensions = await dimensions(sourcePath);
  const targetWidth = Math.min(sourceDimensions.width, maxWidth);
  const webpArgs = ['-quiet', '-mt', '-q', String(quality), '-resize', String(targetWidth), '0'];
  try {
    await execFileAsync('/opt/homebrew/bin/cwebp', [...webpArgs, sourcePath, '-o', outputPath]);
  } catch (error) {
    if (detected.format !== 'JPEG') throw error;
    const rgbPath = resolve(tempRoot, `${id}-rgb.png`);
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', sourcePath, '--out', rgbPath], { maxBuffer: 1024 * 1024 });
    await execFileAsync('/opt/homebrew/bin/cwebp', [...webpArgs, rgbPath, '-o', outputPath]);
  }
  const web = await readFile(outputPath);
  return {
    detectedFormat: detected.format,
    detectedMime: detected.mime,
    sourceDimensions,
    local: {
      publicPath,
      repoPath,
      format: 'WEBP',
      mime: 'image/webp',
      dimensions: await dimensions(outputPath),
      bytes: web.byteLength,
      sha256: sha256(web),
      quality,
      maxWidth,
    },
  };
}

async function captureVisual(asset, tempRoot) {
  const response = await fetchWithRetry(asset.sourceUrl);
  const source = Buffer.from(await response.arrayBuffer());
  const publicPath = `/yangibaxt/images/${asset.id}.webp`;
  const repoPath = `public${publicPath}`;
  const converted = await convertBuffer({
    buffer: source,
    id: `media-${asset.id}`,
    outputPath: resolve(websiteRoot, repoPath),
    publicPath,
    repoPath,
    maxWidth: asset.id === 'hero-real' ? 2200 : 1900,
    quality: asset.materialType === 'construction-photo' ? 82 : 84,
    tempRoot,
  });
  return {
    ...asset,
    requiredVisibleDisclosure: asset.materialType === 'cgi-concept'
      ? 'Official CGI concept; final appearance may change.'
      : asset.materialType === 'construction-photo'
        ? 'Actual official construction photograph; July 2026.'
        : 'Actual official photograph.',
    source: {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      serverDateUtc: response.headers.get('date'),
      lastModified: response.headers.get('last-modified'),
      bytes: source.byteLength,
      sha256: sha256(source),
      detectedFormat: converted.detectedFormat,
      detectedMime: converted.detectedMime,
      dimensions: converted.sourceDimensions,
    },
    web: converted.local,
  };
}

async function captureDetail(unit) {
  const response = await fetchWithRetry(placementDetailUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ placementUUID: unit.uuid }),
  });
  const text = await response.text();
  const responseBytes = Buffer.from(text, 'utf8');
  const data = JSON.parse(text);
  if (!data.apartmentSheetExist || !data.apartmentSheetURLPage1 || !data.apartmentSheetURLPage2) {
    throw new Error(`Apartment sheets missing for ${unit.uuid}`);
  }
  return {
    unitId: unit.uuid,
    unitNumber: String(unit.name),
    endpoint: placementDetailUrl,
    requestBody: { placementUUID: unit.uuid },
    response: {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      serverDateUtc: response.headers.get('date'),
      bytes: responseBytes.byteLength,
      sha256: sha256(responseBytes),
    },
    apartmentSheetExist: data.apartmentSheetExist,
    page1SourceUrl: data.apartmentSheetURLPage1,
    page2SourceUrl: data.apartmentSheetURLPage2,
    primaryLayoutSourceUrl: unit.photoURL1600,
  };
}

async function capturePlan({ detail, page, tempRoot }) {
  const sourceUrl = page === 1 ? detail.page1SourceUrl : detail.page2SourceUrl;
  const response = await fetchWithRetry(sourceUrl);
  const source = Buffer.from(await response.arrayBuffer());
  const directory = page === 1 ? 'floor-positions' : 'plans';
  const publicPath = `/yangibaxt/${directory}/${detail.unitId}.webp`;
  const repoPath = `public${publicPath}`;
  const converted = await convertBuffer({
    buffer: source,
    id: `${detail.unitId}-page${page}`,
    outputPath: resolve(websiteRoot, repoPath),
    publicPath,
    repoPath,
    maxWidth: 1400,
    quality: 90,
    tempRoot,
  });
  return {
    materialType: page === 1 ? 'official-apartment-sheet-floor-position' : 'official-apartment-sheet-individual-plan',
    sourceUrl,
    source: {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      serverDateUtc: response.headers.get('date'),
      lastModified: response.headers.get('last-modified'),
      bytes: source.byteLength,
      sha256: sha256(source),
      detectedFormat: converted.detectedFormat,
      detectedMime: converted.detectedMime,
      dimensions: converted.sourceDimensions,
    },
    web: converted.local,
  };
}

async function capture() {
  const startedAt = new Date().toISOString();
  await Promise.all([
    mkdir(imageRoot, { recursive: true }),
    mkdir(planRoot, { recursive: true }),
    mkdir(floorRoot, { recursive: true }),
    mkdir(documentRoot, { recursive: true }),
  ]);
  const tempRoot = await mkdtemp(join(tmpdir(), 'yangibaxt-assets-'));
  try {
    const placementResponse = JSON.parse(await readFile(placementPath, 'utf8'));
    const placements = placementResponse.placements;
    if (!Array.isArray(placements) || placements.length !== 265) throw new Error(`Expected 265 frozen apartments, found ${placements?.length ?? 0}`);
    if (new Set(placements.map((unit) => unit.uuid)).size !== 265) throw new Error('Frozen apartment UUIDs are not unique');

    const [visuals, details] = await Promise.all([
      pool(visualAssets, 5, (asset) => captureVisual(asset, tempRoot), 'Media'),
      pool(placements, 8, captureDetail, 'Placement details'),
    ]);
    const planItems = await pool(details, 7, async (detail) => {
      const [page1, page2] = await Promise.all([
        capturePlan({ detail, page: 1, tempRoot }),
        capturePlan({ detail, page: 2, tempRoot }),
      ]);
      return { ...detail, page1, page2 };
    }, 'Apartment sheets');

    const bookletBuffer = await readFile(sourceBookletPath);
    if (bookletBuffer.byteLength !== booklet.expectedBytes || sha256(bookletBuffer) !== booklet.expectedSha256) {
      throw new Error('Local official booklet bytes or SHA-256 changed');
    }
    await copyFile(sourceBookletPath, bookletOutputPath);
    const { stdout: pdfInfo } = await execFileAsync('/opt/homebrew/bin/pdfinfo', [bookletOutputPath], { maxBuffer: 1024 * 1024 });
    const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (pages !== booklet.expectedPages) throw new Error(`Expected ${booklet.expectedPages} booklet pages, found ${pages}`);

    const completedAt = new Date().toISOString();
    await writeFile(planManifestPath, `${JSON.stringify({
      project: 'Yangi Baxt',
      capturedAt: startedAt,
      completedAt,
      endpoint: placementDetailUrl,
      count: planItems.length,
      page1Http200Count: planItems.filter((item) => item.page1.source.httpStatus === 200).length,
      page2Http200Count: planItems.filter((item) => item.page2.source.httpStatus === 200).length,
      apartmentSheetExistCount: planItems.filter((item) => item.apartmentSheetExist).length,
      items: planItems,
    }, null, 2)}\n`);
    await writeFile(mediaManifestPath, `${JSON.stringify({
      project: 'Yangi Baxt',
      capturedAt: startedAt,
      completedAt,
      visualAssets: visuals,
      booklet: {
        ...booklet,
        classification: 'official-booklet',
        pages,
        bytes: bookletBuffer.byteLength,
        sha256: sha256(bookletBuffer),
      },
    }, null, 2)}\n`);
    console.log(`Captured ${visuals.length} official media assets, two local sheets for each of ${planItems.length} apartments, and the ${pages}-page booklet.`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await capture();
