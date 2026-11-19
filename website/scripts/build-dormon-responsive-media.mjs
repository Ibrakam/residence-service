// Derivatives only: original project media and plan drawings stay unchanged.
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';

const publicRoot = new URL('../public/', import.meta.url);
const output = new URL('../public/dormon-hills/media/', import.meta.url);
const manifestFile = new URL('../data/dormon-responsive-media.json', import.meta.url);
const config = { widths: [640, 960, 1440, 1920], webp: { quality: 78, effort: 5 }, avif: { quality: 53, effort: 4, chromaSubsampling: '4:4:4' } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [];
sharp.concurrency(2);
await mkdir(output, { recursive: true });
for (const group of ['editorial', 'facades']) {
  const names = (await readdir(new URL(`dormon-hills/${group}/`, publicRoot))).sort();
  for (const file of names.filter(name => name.endsWith('.webp') && !name.endsWith('-640.webp'))) {
    sources.push({ group, file, path: `/dormon-hills/${group}/${file}` });
  }
}

const images = {};
let cursor = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (cursor < sources.length) {
    const source = sources[cursor++];
    const original = await readFile(new URL(source.path.slice(1), publicRoot));
    const metadata = await sharp(original).metadata();
    if (!metadata.width || !metadata.height || metadata.format !== 'webp') throw new Error(`Invalid original ${source.path}`);
    const widths = [...new Set([...config.widths.filter(width => width < metadata.width), metadata.width])];
    const variants = [];
    for (const width of widths) {
      const resized = sharp(original).resize({ width, withoutEnlargement: true });
      const variant = { width, height: Math.round(metadata.height * width / metadata.width) };
      for (const format of ['webp', 'avif']) {
        const bytes = await resized.clone()[format](config[format]).toBuffer();
        const generated = await sharp(bytes).metadata();
        if (generated.width !== variant.width || generated.height !== variant.height || generated.format !== (format === 'avif' ? 'heif' : format)) throw new Error(`Unexpected derivative geometry ${source.path}`);
        const file = `${source.group}-${source.file.slice(0, -5)}-${width}-${hash(bytes).slice(0, 12)}.${format}`;
        await writeFile(new URL(file, output), bytes);
        variant[format] = { src: `/dormon-hills/media/${file}`, bytes: bytes.length };
      }
      variants.push(variant);
    }
    images[source.path] = { width: metadata.width, height: metadata.height, originalBytes: original.length, sourceSha256: hash(original), variants };
  }
}));
const sorted = Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b)));
const manifest = { schemaVersion: 1, config, images: sorted };
const managed = new Set(Object.values(images).flatMap(image => image.variants.flatMap(variant => ['webp', 'avif'].map(format => variant[format].src.split('/').at(-1)))));
for (const file of await readdir(output)) {
  if (!managed.has(file) && /^(?:editorial|facades)-[a-z0-9-]+-\d+-[a-f0-9]{12}\.(?:webp|avif)$/.test(file)) await rm(new URL(file, output));
}
await writeFile(new URL(manifestFile.href + '.tmp'), JSON.stringify(manifest, null, 2) + '\n');
await rename(new URL(manifestFile.href + '.tmp'), manifestFile);
const first = images['/dormon-hills/facades/overview.webp'];
console.log(JSON.stringify({ images: sources.length, derivatives: managed.size, originalBytes: Object.values(images).reduce((sum, image) => sum + image.originalBytes, 0), overview: { originalBytes: first.originalBytes, variants: first.variants.map(({ width, webp, avif }) => ({ width, webpBytes: webp.bytes, avifBytes: avif.bytes })) } }));
