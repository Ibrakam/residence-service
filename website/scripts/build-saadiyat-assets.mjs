import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceDir = path.join(root, 'source', 'saadiyat', 'media-originals');
const outputDir = path.join(root, 'public', 'saadiyat', 'images');
const assets = [
  ['590b83e1-db6f-4cba-b1ea-d4da18849133.webp', 'hero.webp', 'Project hero', 'cgi-render'],
  ['a0e3e3a8-8215-46d8-8d8c-0740739d2707.webp', 'hero-mobile.webp', 'Mobile project hero', 'cgi-render'],
  ['46358044-3822-4f79-ade3-377e44182a8c.webp', 'logo.webp', 'Saadiyat wordmark', 'official-logo'],
  ['7782a25b-15f8-4b01-88a5-702b9adf4cdc.webp', 'about.webp', 'Project setting', 'cgi-render'],
  ['e02995ee-9499-4efe-8637-3a4c18258078.webp', 'architecture-facade.webp', 'Facade', 'cgi-render'],
  ['36898a8e-71e6-401b-8b09-5c5e4d18ca63.webp', 'architecture-entrance.webp', 'Entrance group', 'cgi-render'],
  ['38e48963-f6d0-45a4-9869-715691a58a52.webp', 'architecture-materials.webp', 'Facade materials', 'cgi-render'],
  ['c2643cc8-89af-4581-bc6f-8da2731b18e6.webp', 'courtyard.webp', 'Car-free courtyard', 'cgi-render'],
  ['ce970f1a-5776-4c2f-bf39-31fa77ff1a82.webp', 'playground.webp', 'Children playgrounds', 'cgi-render'],
  ['f0c69773-9fd0-465f-8774-42d52d9dac2c.webp', 'workout.webp', 'Workout zone', 'cgi-render'],
  ['5e573157-92a0-44b0-a390-13003accbc32.webp', 'guest-room.webp', 'Guest room', 'cgi-render'],
  ['0343f89a-52d1-4505-8fe4-f6972cb8e9b6.webp', 'teahouse.webp', 'Teahouse', 'cgi-render'],
  ['b11ac908-f558-45e6-8961-3ecba8ae97da.webp', 'parking.webp', 'Parking', 'cgi-render'],
  ['9060367c-f3d9-4d9a-8bc8-44054c1a7ca3.webp', 'water.webp', 'Water surface', 'cgi-render'],
  ['fbf4adcb-5dd4-4b8f-8226-0d1059b0fdd4.webp', 'shadow-theatre.webp', 'Shadow theatre', 'cgi-render'],
  ['b7869b02-e28d-436a-9fa8-390506035cc3.webp', 'mist.webp', 'Adiabatic water mist', 'cgi-render'],
  ['7bc1314c-b36c-4930-b1f4-30a659d65fd1.webp', 'lobby.webp', 'Lobby', 'cgi-render'],
];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

await mkdir(outputDir, { recursive: true });
const manifest = [];
for (const [sourceFile, outputFile, officialLabel, classification] of assets) {
  const original = await readFile(path.join(sourceDir, sourceFile));
  const pipeline = sharp(original).rotate();
  const output = outputFile === 'logo.webp'
    ? await pipeline.webp({ quality: 92, effort: 5 }).toBuffer()
    : await pipeline.resize({ width: 1920, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 5 }).toBuffer();
  await writeFile(path.join(outputDir, outputFile), output);
  const metadata = await sharp(output).metadata();
  manifest.push({
    sourceUrl: `https://mbc.uz/${sourceFile.startsWith('e0') || sourceFile.startsWith('368') || sourceFile.startsWith('38e') ? 'storage/archs' : sourceFile === '7bc1314c-b36c-4930-b1f4-30a659d65fd1.webp' ? 'storage/lobbies' : ['c264', 'ce970', 'f0c6', '5e57', '0343', 'b11a', '9060', 'fbf4', 'b786'].some((prefix) => sourceFile.startsWith(prefix)) ? 'storage/inners' : 'storage/projects'}/${sourceFile}`,
    sourceFile, sourceSha256: sha256(original), sourceBytes: original.length,
    outputFile: `/saadiyat/images/${outputFile}`, outputBytes: output.length, width: metadata.width, height: metadata.height,
    officialLabel, classification,
    classificationNote: classification === 'official-logo' ? 'Official project wordmark from the project page.' : 'The official page presents this as project imagery; there is no explicit evidence it is a photograph, so it is conservatively labelled CGI/render.',
  });
}
await writeFile(path.join(root, 'source', 'saadiyat', 'media-manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), sourcePages: ['https://mbc.uz/ru/project/saadiyat', 'https://mbc.uz/uz/project/saadiyat', 'https://mbc.uz/en/project/saadiyat'], assets: manifest, unusedOriginalMedia: [{ sourceUrl: 'https://mbc.uz/storage/projects/bc8bfb0f-01fc-4c1e-ae50-55f0c854b545.mp4', classification: 'official-project-video', runtimeUse: false }] }, null, 2)}\n`);
console.log(`Built ${manifest.length} Saadiyat assets.`);
