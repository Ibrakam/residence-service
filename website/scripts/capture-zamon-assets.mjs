import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const placementPath = resolve(websiteRoot, 'data/zamon-placement-raw.json');
const plansManifestPath = resolve(websiteRoot, 'data/zamon-plan-sources.json');
const assetManifestPath = resolve(websiteRoot, 'data/zamon-asset-sources.json');
const publicRoot = resolve(websiteRoot, 'public/zamon');
const imageRoot = resolve(publicRoot, 'images');
const planRoot = resolve(publicRoot, 'plans');
const documentRoot = resolve(publicRoot, 'documents');

const booklet = {
  url: 'https://s3.bi.group/biclick/content-manager/Buklet_Zamon_6092f7162f.pdf',
  local: '/zamon/documents/zamon-booklet-2026-03.pdf',
  repoPath: 'public/zamon/documents/zamon-booklet-2026-03.pdf',
  expectedBytes: 11_761_189,
  expectedSha256: '76691ad22a633921ebc308b5be680737584c2a6ecf672a98c63d0ba29481a009',
  expectedPages: 36,
  pdfCreationDate: '2026-03-20T15:58:37+05:00',
};

const visualAssets = [
  ['hero-phase-one', 'https://s3.bi.group/biclick/content-manager/668_A9252_65df7e5bbf.jpg', 'actual-photo', 'realized', 'Hero and completed phase I'],
  ['realized-02', 'https://s3.bi.group/biclick/content-manager/668_A9140_be8f0cb33f.jpg', 'actual-photo', 'realized', 'Completed phase I facade'],
  ['realized-03', 'https://s3.bi.group/biclick/content-manager/668_A9054_7211604c04.jpg', 'actual-photo', 'realized', 'Completed phase I exterior'],
  ['realized-04', 'https://s3.bi.group/biclick/content-manager/668_A9227_487859d8d3.jpg', 'actual-photo', 'realized', 'Completed phase I courtyard'],
  ['realized-05', 'https://s3.bi.group/biclick/content-manager/668_A9247_1_5064257d1a.jpg', 'actual-photo', 'realized', 'Completed phase I facade detail'],
  ['realized-06', 'https://s3.bi.group/biclick/content-manager/668_A9254_d0688fa168.jpg', 'actual-photo', 'realized', 'Completed phase I exterior detail'],
  ['architecture-01', 'https://s3.bi.group/biclick/content-manager/668_A9188_a667dd3337.jpg', 'actual-photo', 'architecture', 'Completed phase I architecture'],
  ['architecture-02', 'https://s3.bi.group/biclick/content-manager/668_A9091_8cf37f74f5.jpg', 'actual-photo', 'architecture', 'Completed phase I material detail'],
  ['architecture-03', 'https://s3.bi.group/biclick/content-manager/668_A9030_e0ba5f9bc3.jpg', 'actual-photo', 'architecture', 'Completed phase I architectural rhythm'],
  ['architecture-04', 'https://s3.bi.group/biclick/content-manager/668_A9048_da1feaee90.jpg', 'actual-photo', 'architecture', 'Completed phase I facade detail'],
  ['concept-01', 'https://s3.bi.group/biclick/content-manager/image_5_9edcc690d6.png', 'official-cgi', 'concept', 'Future courtyard concept'],
  ['concept-02', 'https://s3.bi.group/biclick/content-manager/image_8_04347ffba6.png', 'official-cgi', 'concept', 'Future courtyard concept'],
  ['concept-03', 'https://s3.bi.group/biclick/content-manager/image_6_4295490efb.png', 'official-cgi', 'concept', 'Future courtyard concept'],
  ['concept-04', 'https://s3.bi.group/biclick/content-manager/image_4_5dcff64da9.png', 'official-cgi', 'concept', 'Future courtyard concept'],
  ['concept-05', 'https://s3.bi.group/biclick/content-manager/image_7_6b52913d2d.png', 'official-cgi', 'concept', 'Future courtyard concept'],
  ['lobby-01', 'https://s3.bi.group/biclick/content-manager/1_29_ea7f13514d.jpg', 'actual-photo', 'interior', 'Completed phase I common area'],
  ['lobby-02', 'https://s3.bi.group/biclick/content-manager/668_A9163_02ca0b85f6.jpg', 'actual-photo', 'interior', 'Completed phase I lobby'],
  ['lobby-03', 'https://s3.bi.group/biclick/content-manager/668_A9160_6860bbacb2.jpg', 'actual-photo', 'interior', 'Completed phase I lobby detail'],
  ['lobby-04', 'https://s3.bi.group/biclick/content-manager/668_A9170_35bd922af9.jpg', 'actual-photo', 'interior', 'Completed phase I common area detail'],
  ['landscape-01', 'https://s3.bi.group/biclick/content-manager/668_A9223_bf626dcfae.jpg', 'actual-photo', 'landscape', 'Completed phase I landscaping'],
  ['landscape-02', 'https://s3.bi.group/biclick/content-manager/668_A9033_0e0236f711.jpg', 'actual-photo', 'landscape', 'Completed phase I landscaping detail'],
  ['construction-2026-07-01', 'https://s3.bi.group/biclick/content-manager/668_A5108_8608da0ac7.jpg', 'construction-photo', 'construction-2026-07', 'Official construction archive, July 2026'],
  ['construction-2026-07-02', 'https://s3.bi.group/biclick/content-manager/668_A5109_edc9160c86.jpg', 'construction-photo', 'construction-2026-07', 'Official construction archive, July 2026'],
  ['construction-2026-07-03', 'https://s3.bi.group/biclick/content-manager/668_A5080_4750f514cc.jpg', 'construction-photo', 'construction-2026-07', 'Official construction archive, July 2026'],
  ['construction-2026-07-04', 'https://s3.bi.group/biclick/content-manager/668_A5078_a4fee886e5.jpg', 'construction-photo', 'construction-2026-07', 'Official construction archive, July 2026'],
  ['construction-2026-07-05', 'https://s3.bi.group/biclick/content-manager/668_A5097_f9a171d43e.jpg', 'construction-photo', 'construction-2026-07', 'Official construction archive, July 2026'],
].map(([id, sourceUrl, type, layer, usage]) => ({ id, sourceUrl, type, layer, usage }));

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function detectedFormat(buffer) {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return { format: 'JPEG', mime: 'image/jpeg', extension: '.jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { format: 'PNG', mime: 'image/png', extension: '.png' };
  throw new Error('Unsupported image response');
}

async function dimensions(path) {
  const { stdout } = await execFileAsync('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], { maxBuffer: 1024 * 1024 });
  const width = Number(stdout.match(/pixelWidth:\s*(\d+)/)?.[1]);
  const height = Number(stdout.match(/pixelHeight:\s*(\d+)/)?.[1]);
  if (!width || !height) throw new Error(`Could not read dimensions for ${path}`);
  return { width, height };
}

async function fetchBinary(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { response, buffer };
}

async function prepareWebp({ id, sourceUrl, outputPath, publicPath, repoPath, quality, maxWidth, tempRoot, materialType, extra = {} }) {
  const { response, buffer } = await fetchBinary(sourceUrl);
  const detected = detectedFormat(buffer);
  const sourcePath = resolve(tempRoot, `${id}${detected.extension}`);
  await writeFile(sourcePath, buffer);
  const sourceDimensions = await dimensions(sourcePath);
  const width = Math.min(sourceDimensions.width, maxWidth);
  await execFileAsync('/opt/homebrew/bin/cwebp', ['-quiet', '-mt', '-q', String(quality), '-resize', String(width), '0', sourcePath, '-o', outputPath]);
  const localBuffer = await readFile(outputPath);
  const localDimensions = await dimensions(outputPath);
  return {
    id,
    materialType,
    sourceUrl,
    ...extra,
    source: {
      httpStatus: response.status,
      contentType: response.headers.get('content-type'),
      serverDate: response.headers.get('date'),
      lastModified: response.headers.get('last-modified'),
      detectedFormat: detected.format,
      detectedMime: detected.mime,
      dimensions: sourceDimensions,
      bytes: buffer.byteLength,
      sha256: sha256(buffer),
    },
    web: {
      repoPath,
      intendedPublicPath: publicPath,
      format: 'WEBP',
      mime: 'image/webp',
      dimensions: localDimensions,
      bytes: localBuffer.byteLength,
      sha256: sha256(localBuffer),
      quality,
      maxWidth,
    },
  };
}

async function pool(items, limit, task) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await task(items[index], index);
      process.stdout.write(`\rPrepared ${index + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  process.stdout.write('\n');
  return output;
}

async function capture() {
  await Promise.all([mkdir(imageRoot, { recursive: true }), mkdir(planRoot, { recursive: true }), mkdir(documentRoot, { recursive: true })]);
  const tempRoot = await mkdtemp(join(tmpdir(), 'zamon-assets-'));
  try {
    const placementResponse = JSON.parse(await readFile(placementPath, 'utf8'));
    const placements = placementResponse.placements;
    if (!Array.isArray(placements) || placements.length !== 104) throw new Error('Expected 104 frozen Zamon placements');

    const visuals = await pool(visualAssets, 4, async (asset) => prepareWebp({
      id: asset.id,
      sourceUrl: asset.sourceUrl,
      outputPath: resolve(imageRoot, `${asset.id}.webp`),
      publicPath: `/zamon/images/${asset.id}.webp`,
      repoPath: `public/zamon/images/${asset.id}.webp`,
      quality: asset.id === 'hero-phase-one' ? 84 : 82,
      maxWidth: asset.id === 'hero-phase-one' ? 2200 : 2000,
      tempRoot,
      materialType: asset.type,
      extra: {
        layer: asset.layer,
        usage: asset.usage,
        requiredVisibleDisclosure: asset.type === 'official-cgi'
          ? 'Official visualization/concept; final appearance may change.'
          : asset.type === 'construction-photo'
            ? 'Official construction archive; July 2026.'
            : 'Actual official photograph.',
      },
    }));

    const plans = await pool(placements, 6, async (unit) => prepareWebp({
      id: unit.uuid,
      sourceUrl: unit.photoURL1600,
      outputPath: resolve(planRoot, `${unit.uuid}.webp`),
      publicPath: `/zamon/plans/${unit.uuid}.webp`,
      repoPath: `public/zamon/plans/${unit.uuid}.webp`,
      quality: 90,
      maxWidth: 1200,
      tempRoot,
      materialType: 'official-primary-floorplan',
      extra: { unitId: unit.uuid, unitNumber: String(unit.name) },
    }));

    const { response: bookletResponse, buffer: bookletBuffer } = await fetchBinary(booklet.url);
    if (bookletBuffer.byteLength !== booklet.expectedBytes || sha256(bookletBuffer) !== booklet.expectedSha256) throw new Error('Official booklet bytes or SHA-256 changed');
    const bookletOutput = resolve(websiteRoot, booklet.repoPath);
    await writeFile(bookletOutput, bookletBuffer);
    const { stdout: pdfInfo } = await execFileAsync('/opt/homebrew/bin/pdfinfo', [bookletOutput], { maxBuffer: 1024 * 1024 });
    const pages = Number(pdfInfo.match(/^Pages:\s+(\d+)/m)?.[1]);
    if (pages !== booklet.expectedPages) throw new Error(`Expected ${booklet.expectedPages} booklet pages, found ${pages}`);

    const sourcePlanBytes = plans.reduce((sum, item) => sum + item.source.bytes, 0);
    const localPlanBytes = plans.reduce((sum, item) => sum + item.web.bytes, 0);
    await writeFile(plansManifestPath, `${JSON.stringify({
      materialType: 'official-primary-floorplan',
      count: plans.length,
      allHttp200: plans.every((item) => item.source.httpStatus === 200),
      allLocalPlansPresent: true,
      sourceResponsesCapturedForHashing: true,
      sourceTotalBytes: sourcePlanBytes,
      preparedTotalBytes: localPlanBytes,
      items: plans,
    }, null, 2)}\n`);

    await writeFile(assetManifestPath, `${JSON.stringify({
      project: 'Zamon',
      capturedAt: '2026-08-30T15:15:31Z',
      visualAssets: visuals,
      booklet: {
        url: booklet.url,
        local: booklet.local,
        repoPath: booklet.repoPath,
        bytes: bookletBuffer.byteLength,
        sha256: sha256(bookletBuffer),
        pages,
        pdfCreationDate: booklet.pdfCreationDate,
        httpStatus: bookletResponse.status,
        contentType: bookletResponse.headers.get('content-type'),
        serverDate: bookletResponse.headers.get('date'),
        lastModified: bookletResponse.headers.get('last-modified'),
        classification: 'official-booklet',
      },
    }, null, 2)}\n`);
    console.log(`Captured ${visuals.length} visuals, ${plans.length} plans and the ${pages}-page official booklet.`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

await capture();
