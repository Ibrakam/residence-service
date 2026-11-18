// Public project imagery, locally optimised; never loads the developer's forms/scripts.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);
const source = 'https://millenniumhouse.uz';
const images = {
  hero: 'fasad-1-1-nxbqbs.webp',
  about: 'dormon/n08-xn6dc4.webp',
  panorama: 'aerial-view-4-2-va757j.webp',
  security: 'dormon/n14-kr9y8b.webp',
  aerial: 'dormon/n01-vb8ux0.webp',
  masterplan: 'dormon/master-xqseap.webp',
  parking: 'dormon/parking-h4qrdi.webp',
  entry: 'dormon/entry1-j8vl7j.webp',
  lounge: 'dormon/n05-evsnps.webp',
  pavilion: 'dormon/n12-x25dqf.webp',
  fountain: 'dormon/n09-xtha97.webp',
  architecture: 'dormon/n07-bq1yo7.webp',
  calm: 'dormon/calm-l3owey.webp',
  family: 'dormon/balcony-xm1u03.webp',
  playground: 'dormon/n11-ppdvdh.webp',
  workout: 'dormon/workout-ztwor4.webp',
  alleys: 'dormon/n10-lhsfdp.webp',
  gazebos: 'dormon/n13-std9nf.webp',
  'courtyard-plan': 'bezymiannyi-1-1-8oluak.webp',
  'lounge-outside': 'dormon/n06-5obe68.webp',
  kitchen: 'dormon/n03-seoq2d.webp',
  screen: 'dormon/n04-rylh7a.webp',
  lobby: '1-nrignk.webp',
  elevators: '2-1spe7i.webp',
  'parking-interior': '3-gihcho.webp',
  'facade-section': 'dormon/facade-section-plcvcl.webp',
  'facade-air': 'dormon/facade-air-b0xjjx.webp',
};
const out = new URL('../public/dormon-hills/editorial/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'dormon-editorial-'));
const manifest = [];
await mkdir(out, { recursive: true });
try {
  const entries = Object.entries(images);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < entries.length) {
      const [name, path] = entries[next++];
      const url = `${source}/media/project-pages/${path}`;
      const file = join(temp, `${name}.webp`);
      await run('/usr/bin/curl', ['--fail', '--silent', '--show-error', '--location', '--max-time', '45', '--retry', '2', url, '-o', file]);
      const buffer = await readFile(file);
      const metadata = await sharp(buffer).metadata();
      if (metadata.format !== 'webp' || !metadata.width || !metadata.height) throw new Error(`Invalid image ${name}`);
      const full = await sharp(buffer).rotate().resize({ width: name === 'hero' || name === 'panorama' ? 2200 : 1600, withoutEnlargement: true }).webp({ quality: 86 }).toBuffer();
      const small = await sharp(buffer).rotate().resize({ width: 640, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      await writeFile(new URL(`${name}.webp`, out), full);
      await writeFile(new URL(`${name}-640.webp`, out), small);
      const size = await sharp(full).metadata();
      manifest.push({ name, source: url, width: size.width, height: size.height, sourceSha256: createHash('sha256').update(buffer).digest('hex'), sha256: createHash('sha256').update(full).digest('hex'), bytes: full.length });
    }
  }));
  await writeFile(new URL('../data/dormon-editorial-sources.json', import.meta.url), JSON.stringify({ source: `${source}/dormon-hills`, capturedAt: new Date().toISOString(), images: manifest.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + '\n');
  console.log(`Prepared ${manifest.length} original project images with mobile variants (${manifest.reduce((n, image) => n + image.bytes, 0)} full-image bytes).`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
