import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import sharp from 'sharp';
import manifest from '../data/dormon-responsive-media.json' with { type: 'json' };

const root = new URL('../public/', import.meta.url);
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const files = new Set();
let originalBytes = 0;
let fullAvifBytes = 0;
assert.equal(manifest.schemaVersion, 1);
assert.equal(Object.keys(manifest.images).length, 30);
for (const [path, image] of Object.entries(manifest.images)) {
  assert.match(path, /^\/dormon-hills\/(?:editorial|facades)\/[a-z0-9-]+\.webp$/);
  const original = await readFile(new URL(path.slice(1), root));
  assert.equal(hash(original), image.sourceSha256, `${path}: regenerate variants after changing an original`);
  originalBytes += original.length;
  assert.ok(image.variants.length > 1);
  assert.equal(image.variants.at(-1).width, image.width, `${path}: retain full-resolution option`);
  let previous = 0;
  for (const variant of image.variants) {
    assert.ok(variant.width > previous && variant.width <= image.width);
    previous = variant.width;
    assert.ok(Math.abs(variant.height - image.height * variant.width / image.width) <= 1, 'Hotspot coordinates require the original aspect ratio');
    for (const format of ['webp', 'avif']) {
      const entry = variant[format];
      assert.match(entry.src, /^\/dormon-hills\/media\/[a-z0-9-]+-[a-f0-9]{12}\.(?:webp|avif)$/);
      assert.ok(!files.has(entry.src));
      files.add(entry.src);
      const bytes = await readFile(new URL(entry.src.slice(1), root));
      assert.equal(bytes.length, entry.bytes);
      assert.ok(entry.src.endsWith(`-${hash(bytes).slice(0, 12)}.${format}`), 'A changed file must have a changed cache key');
      const info = await sharp(bytes).metadata();
      assert.equal(info.format, format === 'avif' ? 'heif' : format);
      assert.equal(info.width, variant.width);
      assert.equal(info.height, variant.height);
      if (format === 'avif' && variant.width === image.width) fullAvifBytes += bytes.length;
    }
  }
}
const managed = new Set((await readdir(new URL('dormon-hills/media/', root))).map(file => '/dormon-hills/media/' + file));
assert.deepEqual(managed, files, 'Every generated file must be referenced, with no stale variants');
assert.ok(fullAvifBytes < originalBytes * .7, 'Full-size photos must save at least 30% of bytes');
const overview = manifest.images['/dormon-hills/facades/overview.webp'];
assert.ok(overview.variants.find(image => image.width === 960).avif.bytes < overview.originalBytes * .5, 'The mobile overview must be substantially lighter');
console.log(JSON.stringify({ verified: true, images: Object.keys(manifest.images).length, derivatives: files.size, originalBytes, fullAvifBytes }));
