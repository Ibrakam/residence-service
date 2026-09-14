import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const outputRoot = path.join(root, 'public', 'soy-boyi', 'media');
const sourceManifestPath = path.join(root, 'source', 'soy-boyi', 'media-manifest.json');
const publicManifestPath = path.join(root, 'data', 'soy-boyi-media-manifest.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const assets = [
  ['hero', 'https://mbc.uz/storage/projects/cb06eeb8-1080-4438-8665-ecd2fab25e23.webp', 'cgi-render', 2200],
  ['hero-mobile', 'https://mbc.uz/storage/projects/20a7b320-b44b-4e2f-a0eb-db571bc4e055.webp', 'cgi-render', 1200],
  ['about', 'https://mbc.uz/storage/projects/6ce046a8-f8dd-44dc-98c8-fe96cbbb17e7.webp', 'cgi-render', 1800],
  ['architecture-river', 'https://mbc.uz/storage/archs/2f778f72-89a4-4982-a487-ddac9ab3fad6.webp', 'cgi-render', 1800],
  ['architecture-facade', 'https://mbc.uz/storage/archs/6ed24792-7a0d-458b-9ead-ae86a014fb5f.webp', 'cgi-render', 1800],
  ['architecture-materials', 'https://mbc.uz/storage/archs/2287b9a1-1ead-424f-931b-f87a49f1b313.webp', 'cgi-render', 1800],
  ['courtyard', 'https://mbc.uz/storage/inners/53ee7e47-9ee8-41fc-8ff7-2282ad9e1b43.webp', 'cgi-render', 1800],
  ['playground', 'https://mbc.uz/storage/inners/fe0df913-2f0c-4e07-a068-2f0841cd434b.webp', 'cgi-render', 1800],
  ['workout', 'https://mbc.uz/storage/inners/51406ebb-4cb8-4ad6-9f8a-75376b94cecf.webp', 'cgi-render', 1800],
  ['summer-cinema', 'https://mbc.uz/storage/inners/0fbaab80-e4cb-4c64-a45f-bb11f3555548.webp', 'cgi-render', 1800],
  ['teahouse', 'https://mbc.uz/storage/inners/f3afcef3-8cd5-4107-ae7b-355fe432ede5.webp', 'cgi-render', 1800],
  ['summer-pool', 'https://mbc.uz/storage/inners/2ac1f1a5-d747-4c28-9d8e-f82da44c3681.webp', 'cgi-render', 1800],
  ['bakery', 'https://mbc.uz/storage/inners/a47f0eb7-e172-4971-9404-207e2e370f19.webp', 'cgi-render', 1800],
  ['guest-room', 'https://mbc.uz/storage/inners/bc2bff92-2abc-4132-a9df-47a120ce12b2.webp', 'cgi-render', 1800],
  ['playroom', 'https://mbc.uz/storage/inners/55769685-de84-4892-8152-722b07b6112a.webp', 'cgi-render', 1800],
  ['lobby', 'https://mbc.uz/storage/lobbies/7f20569a-59d5-4723-96b8-d37f07beb631.webp', 'cgi-render', 1800],
  ['genplan', 'https://mbc.uz/storage/genplans/a40f6dbc-a3fe-4e5f-8c64-2bf5e39044d7.webp', 'official-partial-genplan', 2200],
  ['opening-01', 'https://mbc.uz/storage/articles/2a7d40de-5bfb-4c76-b719-769802f77f7c.webp', 'actual-photo', 1800],
  ['opening-02', 'https://mbc.uz/storage/articles/15b1aa25-d0c5-4c53-8ee2-e336e3c464e0.webp', 'actual-photo', 1800],
];
const binaryAssets = [
  ['logo', 'https://mbc.uz/storage/projects/ef98b35a-b6e0-4f46-9829-c26cfc906638.svg', 'official-logo', 'svg'],
  ['river-film', 'https://mbc.uz/storage/projects/044b355c-3c23-40e1-a513-a17eba3404ec.mp4', 'official-project-video', 'mp4'],
];

await mkdir(outputRoot, { recursive: true });
const sourceAssets = [];
const publicAssets = [];

for (const [name, sourceUrl, classification, width] of assets) {
  const response = await fetch(sourceUrl, { headers: { Accept: 'image/*' } });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const original = Buffer.from(await response.arrayBuffer());
  const output = await sharp(original).rotate().resize({ width, height: width, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 5 }).toBuffer();
  const outputHash = sha256(output);
  const fileName = `${name}-${outputHash.slice(0, 12)}.webp`;
  await writeFile(path.join(outputRoot, fileName), output);
  const metadata = await sharp(output).metadata();
  const publicRecord = { name, classification, localPath: `/soy-boyi/media/${fileName}`, sha256: outputHash, mime: 'image/webp', bytes: output.length, width: metadata.width, height: metadata.height };
  publicAssets.push(publicRecord);
  sourceAssets.push({ ...publicRecord, sourceId: sourceUrl.split('/').at(-1), sourceUrl, sourceSha256: sha256(original), sourceBytes: original.length, serverDate: response.headers.get('date'), classificationNote: classification === 'actual-photo' ? 'Photograph published in the official opening article for phase one.' : classification === 'official-partial-genplan' ? 'Official interactive genplan background; it does not cover every section present in the current apartment feed.' : 'Official project material conservatively classified as CGI/render.' });
}

for (const [name, sourceUrl, classification, extension] of binaryAssets) {
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const output = Buffer.from(await response.arrayBuffer());
  const outputHash = sha256(output);
  const fileName = `${name}-${outputHash.slice(0, 12)}.${extension}`;
  await writeFile(path.join(outputRoot, fileName), output);
  const mime = extension === 'svg' ? 'image/svg+xml' : 'video/mp4';
  const publicRecord = { name, classification, localPath: `/soy-boyi/media/${fileName}`, sha256: outputHash, mime, bytes: output.length };
  publicAssets.push(publicRecord);
  sourceAssets.push({ ...publicRecord, sourceId: sourceUrl.split('/').at(-1), sourceUrl, sourceSha256: outputHash, sourceBytes: output.length, serverDate: response.headers.get('date'), classificationNote: classification === 'official-logo' ? 'Official project logo.' : 'Official project film; treated as project material rather than documentary footage.' });
}

const publicManifest = { schemaVersion: 1, generatedAt: new Date().toISOString(), project: 'Soy Bo‘yi', assets: publicAssets };
const sourceManifest = {
  ...publicManifest,
  sourcePages: [
    'https://mbc.uz/ru/project/soy-boyi',
    'https://mbc.uz/uz/project/soy-boyi',
    'https://mbc.uz/en/project/soy-boyi',
    'https://mbc.uz/ru/genplan/soy-boyi',
    'https://mbc.uz/ru/news/murad-buildings-torzestvenno-otkryl-proekt-soy-boyi',
  ],
  assets: sourceAssets,
};
await writeFile(publicManifestPath, `${JSON.stringify(publicManifest, null, 2)}\n`);
await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
console.log(`Built ${publicAssets.length} versioned Soy Bo‘yi media assets.`);
