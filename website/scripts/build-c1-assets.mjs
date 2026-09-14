import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const sourceDir = path.join(root, 'source', 'c1', 'media-originals');
const imageDir = path.join(root, 'public', 'c1', 'images');
const videoDir = path.join(root, 'public', 'c1', 'video');
const deployManifestPath = path.join(root, 'data', 'c1-media-manifest.json');
const acceptChanges = process.argv.includes('--accept-changes');
const assets = [
  ['https://mbc.uz/storage/projects/8231e92e-d351-4e00-9baf-6da03d3eefe9.webp', 'hero.webp', 'Desktop project hero', 'cgi-render'],
  ['https://mbc.uz/storage/projects/9ed2da9d-c74e-44eb-9673-175a69707ce3.webp', 'hero-mobile.webp', 'Mobile project hero', 'cgi-render'],
  ['https://mbc.uz/storage/projects/d7794dec-d4a2-4d2f-bb5e-bf15c8d9cf82.webp', 'logo.webp', 'C1 wordmark', 'official-logo'],
  ['https://mbc.uz/storage/projects/e9b5f72a-e215-4856-9afc-a751f1d1ef45.webp', 'aerial.webp', 'Project aerial', 'cgi-render'],
  ['https://mbc.uz/storage/archs/57e245d5-0883-4af2-9b50-ead7ddb72586.webp', 'architecture-01.webp', 'Architecture view 1', 'cgi-render'],
  ['https://mbc.uz/storage/archs/32173b12-108a-4730-9e1f-5c53387a664b.webp', 'architecture-02.webp', 'Architecture view 2', 'cgi-render'],
  ['https://mbc.uz/storage/archs/111d2543-525a-44c0-bff1-ce173d35a926.webp', 'architecture-03.webp', 'Architecture view 3', 'cgi-render'],
  ['https://mbc.uz/storage/lobbies/2ea5397c-a76b-413e-a7a9-76130e2c8d83.webp', 'lobby.webp', 'Lobby', 'cgi-render'],
  ['https://mbc.uz/storage/inners/edfe225d-c86e-46d7-9406-ed009101744a.webp', 'pool.webp', 'Open-air pool', 'cgi-render'],
  ['https://mbc.uz/storage/inners/3136dfd9-f8e5-40c6-9924-1aca99e64004.webp', 'guest-room.webp', 'Guest room', 'cgi-render'],
  ['https://mbc.uz/storage/inners/427cd6e9-6654-40ac-a15b-f316c0ada4a7.webp', 'kids.webp', 'Children playroom', 'cgi-render'],
  ['https://mbc.uz/storage/inners/cac301a3-6ebb-4807-98f7-a217c3a7ea9b.webp', 'fitness.webp', 'Shared fitness room', 'cgi-render'],
  ['https://mbc.uz/storage/inners/1b6c4710-8b29-4b3f-9a3c-a8dd1e6b7c7f.webp', 'women-fitness.webp', 'Women-only fitness room', 'cgi-render'],
  ['https://mbc.uz/storage/inners/e58a46f3-5cac-431e-9e0e-e26e366f04d4.webp', 'stroller.webp', 'Stroller room', 'cgi-render'],
  ['https://mbc.uz/storage/inners/e77de904-8d34-4467-9754-417a478c6c0c.webp', 'massage.webp', 'Massage room', 'cgi-render'],
  ['https://mbc.uz/storage/inners/e34a070e-975e-4450-b39a-154910e3cb31.webp', 'dry-clean.webp', 'Dry cleaning service', 'cgi-render'],
  ['https://mbc.uz/storage/inners/d9db3399-3bbd-44bf-8e30-a1c965e38b35.webp', 'security.webp', 'Security systems', 'illustrative-photo'],
  ['https://mbc.uz/storage/inners/81192d19-1458-4dea-a2a8-755f21e0b2ac.webp', 'parking.webp', 'Parking', 'cgi-render'],
];
const video = ['https://mbc.uz/storage/projects/e2ef918b-c893-47a5-9cb9-0997acf84341.mp4', 'c1-film.mp4', 'Official C1 CGI film', 'cgi-video'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function writeStablePublic(file, buffer) {
  try {
    const existing = await readFile(file);
    if (!existing.equals(buffer) && !acceptChanges) throw new Error(`${path.relative(root, file)} changed bytes at a stable public URL. Inspect the source and rerun with --accept-changes to approve the replacement.`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await writeFile(file, buffer);
}

await Promise.all([mkdir(sourceDir, { recursive: true }), mkdir(imageDir, { recursive: true }), mkdir(videoDir, { recursive: true })]);
const manifest = [];
for (const [sourceUrl, outputFile, officialLabel, classification] of assets) {
  const response = await fetch(sourceUrl, { headers: { Accept: 'image/*' } });
  if (!response.ok) throw new Error(`${sourceUrl} returned HTTP ${response.status}`);
  const original = Buffer.from(await response.arrayBuffer());
  const sourceFile = sourceUrl.split('/').at(-1);
  await writeFile(path.join(sourceDir, sourceFile), original);
  const pipeline = sharp(original).rotate();
  const output = outputFile === 'logo.webp'
    ? await pipeline.resize({ width: 640, height: 320, fit: 'inside', withoutEnlargement: true }).webp({ quality: 92, effort: 5 }).toBuffer()
    : await pipeline.resize({ width: 1920, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 86, effort: 5 }).toBuffer();
  await writeStablePublic(path.join(imageDir, outputFile), output);
  const metadata = await sharp(output).metadata();
  manifest.push({ sourceUrl, sourceFile, sourceBytes: original.length, sourceSha256: sha256(original), outputFile: `/c1/images/${outputFile}`, outputBytes: output.length, outputSha256: sha256(output), mime: 'image/webp', width: metadata.width, height: metadata.height, officialLabel, classification, classificationNote: classification === 'official-logo' ? 'Official project wordmark.' : classification === 'illustrative-photo' ? 'Illustrative official-page photograph showing security technology; it is not evidence of C1 construction progress.' : 'Official project imagery conservatively classified as CGI/render; it is not a photograph of completed construction.' });
}

const [videoUrl, videoFile, videoLabel, videoClassification] = video;
const videoResponse = await fetch(videoUrl, { headers: { Accept: 'video/mp4' } });
if (!videoResponse.ok) throw new Error(`${videoUrl} returned HTTP ${videoResponse.status}`);
const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
await writeStablePublic(path.join(videoDir, videoFile), videoBuffer);
manifest.push({ sourceUrl: videoUrl, sourceBytes: videoBuffer.length, sourceSha256: sha256(videoBuffer), outputFile: `/c1/video/${videoFile}`, outputBytes: videoBuffer.length, outputSha256: sha256(videoBuffer), mime: 'video/mp4', width: 1492, height: 900, officialLabel: videoLabel, classification: videoClassification, classificationNote: 'Official project CGI film, served locally at runtime.' });

await writeFile(path.join(root, 'source', 'c1', 'media-manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), sourcePages: ['ru', 'uz', 'en'], assets: manifest, constructionEvidence: 'No verified construction photographs or confirmed PDF brochure were found in the supplied official sources.' }, null, 2)}\n`);
await writeFile(deployManifestPath, `${JSON.stringify({ version: 1, assets: manifest.map(({ outputFile, outputBytes, outputSha256, mime, width, height, officialLabel, classification }) => ({ outputFile, outputBytes, outputSha256, mime, width, height, officialLabel, classification })) }, null, 2)}\n`);
console.log(`Built ${assets.length} C1 images and one local CGI video.`);
