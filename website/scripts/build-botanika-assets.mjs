import { createHash } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imageRoot = resolve(websiteRoot, 'public/botanika-saroyi/images');
const manifestPath = resolve(websiteRoot, 'data/botanika-saroyi-sources.json');
const capturedAt = '2026-08-30T00:00:00+05:00';

const assets = [
  ['hero', 'https://s3.bi.group/biclick/content-manager/668_A9742_06af428a78.jpg', 'actual-photo', 'Completed façade and landscaping'],
  ['facade-02', 'https://s3.bi.group/biclick/content-manager/668_A9616_resized_34b5d08bd6.jpg', 'actual-photo', 'Completed façade detail'],
  ['facade-03', 'https://s3.bi.group/biclick/content-manager/668_A9725_resized_3c09479c00.jpg', 'actual-photo', 'Completed architecture and courtyard'],
  ['facade-04', 'https://s3.bi.group/biclick/content-manager/668_A9825_11efbe1101.jpg', 'actual-photo', 'Completed residential building'],
  ['courtyard-01', 'https://s3.bi.group/biclick/content-manager/668_A9719_640412a286.jpg', 'actual-photo', 'Existing landscaped courtyard'],
  ['courtyard-02', 'https://s3.bi.group/biclick/content-manager/668_A9656_471884cab4.jpg', 'actual-photo', 'Existing play and rest area'],
  ['courtyard-03', 'https://s3.bi.group/biclick/content-manager/668_A9663_6aee7bea68.jpg', 'actual-photo', 'Existing car-free courtyard'],
  ['courtyard-04', 'https://s3.bi.group/biclick/content-manager/668_A9735_a4556dfd0e.jpg', 'actual-photo', 'Existing quiet courtyard zone'],
  ['greenery-01', 'https://s3.bi.group/biclick/content-manager/668_A3658_7d52a9c04a.jpg', 'actual-photo', 'Project landscaping'],
  ['greenery-02', 'https://s3.bi.group/biclick/content-manager/668_A9771_2d3dda55cd.jpg', 'actual-photo', 'Trees and shrubs on the grounds'],
  ['greenery-03', 'https://s3.bi.group/biclick/content-manager/668_A9734_618e8f68c5.jpg', 'actual-photo', 'Established planting beside the building'],
  ['greenery-04', 'https://s3.bi.group/biclick/content-manager/668_A9803_7cd095f39c.jpg', 'actual-photo', 'Landscaped pedestrian route'],
  ['greenery-05', 'https://s3.bi.group/biclick/content-manager/668_A9688_2b8311e27b.jpg', 'actual-photo', 'Green courtyard detail'],
  ['hall-01', 'https://s3.bi.group/biclick/content-manager/668_A9862_kopiya_2407ab9b02.jpg', 'actual-photo', 'Existing lobby with planting'],
  ['hall-02', 'https://s3.bi.group/biclick/content-manager/668_A9924_72a1fa3ae9.jpg', 'actual-photo', 'Existing lobby waiting area'],
  ['hall-03', 'https://s3.bi.group/biclick/content-manager/668_A9880_29ecfeb85b.jpg', 'actual-photo', 'Existing lobby interior'],
  ['hall-04', 'https://s3.bi.group/biclick/content-manager/668_A9861_2713d8467f.jpg', 'actual-photo', 'Existing barrier-free entrance lobby'],
  ['hall-05', 'https://s3.bi.group/biclick/content-manager/668_A9902_0f8da07db3.jpg', 'actual-photo', 'Existing lobby material detail'],
  ['parking', 'https://s3.bi.group/biclick/content-manager/668_A9578_8e38b50b26.jpg', 'actual-photo', 'Project parking'],
  ['architecture-concept', 'https://s3.bi.group/biclick/content-manager/BS_1_7512b5af47.jpg', 'official-render', 'Official architectural render'],
  ['townhouse-concept', 'https://s3.bi.group/biclick/content-manager/BI_TASHKENT_BOTANIKA_SAROY_SAM_3_2_8943cf29b0.jpg', 'official-render', 'Official townhouse concept'],
  ['courtyard-scheme', 'https://s3.bi.group/biclick/content-manager/jujuuuuu_2_0fd63d238b.jpg', 'official-schematic-render', 'Official schematic/render material; not photography'],
  ['aerial-composite', 'https://s3.bi.group/biclick/content-manager/DJI_0397_obrezka_1_21160d4c40.jpg', 'official-composite', 'Official aerial composite; not current photography'],
  ['construction-2026-07', 'https://s3.bi.group/biclick/content-manager/668_A5479_ce2043a8de.jpg', 'construction-archive-2026-07', 'Official construction report, July 2026'],
  ['construction-2025-12', 'https://s3.bi.group/biclick/content-manager/DJI_20251214172425_0085_D_kopiya_ce28e9b4cc.jpg', 'construction-archive-2025-12', 'Official construction report, December 2025'],
  ['construction-2024-06', 'https://s3.bi.group/biclick/content-manager/DSCF_7348_1_7bd0c93ef3.jpg', 'construction-archive-2024-06', 'Official construction report, June 2024'],
];

async function fetchBuffer(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

await mkdir(imageRoot, { recursive: true });
const manifestAssets = new Array(assets.length);

await pool(assets, 4, async ([name, source, materialType, caption], index) => {
  const input = await fetchBuffer(source);
  const metadata = await sharp(input).metadata();
  const localPath = `/botanika-saroyi/images/${name}.webp`;
  const outputPath = resolve(websiteRoot, `public${localPath}`);
  const fit = name === 'hero' ? { width: 2400, height: 1680, fit: 'cover' } : { width: 2000, height: 1600, fit: 'inside' };
  await sharp(input)
    .rotate()
    .resize({ ...fit, withoutEnlargement: true })
    .webp({ quality: name === 'hero' ? 86 : 82, effort: 5 })
    .toFile(outputPath);
  const output = await import('node:fs/promises').then((fs) => fs.readFile(outputPath));
  const outputStats = await stat(outputPath);
  manifestAssets[index] = {
    name,
    local: localPath,
    source,
    materialType,
    caption,
    receivedAt: capturedAt,
    sourceMime: metadata.format ? `image/${metadata.format}` : null,
    sourceWidth: metadata.width ?? null,
    sourceHeight: metadata.height ?? null,
    sourceSizeBytes: input.byteLength,
    sourceSha256: createHash('sha256').update(input).digest('hex'),
    localSizeBytes: outputStats.size,
    localSha256: createHash('sha256').update(output).digest('hex'),
  };
});

const manifest = {
  project: 'Botanika Saroyi',
  capturedAt,
  sources: {
    landingRu: 'https://nrg-bi.uz/uz-ru/landing/botanika-saroyi',
    landingUz: 'https://nrg-bi.uz/uz/landing/botanika-saroyi',
    panorama: 'https://uzbekistan360.uz/ru/location/botanikaKxa',
  },
  mediaClassification: {
    actualPhoto: 'Photograph published in the project page gallery of completed/existing project spaces.',
    officialRender: 'Official CGI/concept material; always labelled as such in the interface.',
    constructionArchive: 'Dated official construction-report photograph; never mixed into the current gallery.',
  },
  assets: manifestAssets,
};

await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Saved ${manifestAssets.length} Botanika editorial assets and provenance manifest.`);
