import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import prices from '../data/dormon-showroom-prices.json' with { type: 'json' };
import scenes from '../data/dormon-showroom-scenes.json' with { type: 'json' };
import showroom from '../data/dormon-showroom.json' with { type: 'json' };

const directory = new URL('../public/dormon-hills/showroom/', import.meta.url);
const images = new Set(Object.keys(showroom.files));
const referenced = new Set();
const pointInPercent = (point) => point?.length === 2 && point.every(value => Number.isFinite(value) && value > 0 && value < 100);
function contains(outline, [x, y]) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ix, iy] = outline[i];
    const [jx, jy] = outline[j];
    if ((iy > y) !== (jy > y) && x < (jx - ix) * (y - iy) / (jy - iy) + ix) inside = !inside;
  }
  return inside;
}

for (const [file, source] of Object.entries(showroom.files)) {
  const apartmentSource = /^https:\/\/src\.service\.app\.uysot\.uz\/files\/com-30\/image\/[a-z0-9-]+\.(?:jpg|png)$/;
  const sceneSource = /^https:\/\/src\.srv\.showroom\.app\.uysot\.uz\/v1\/public\/files\/image\/[a-z0-9-]+\.png$/;
  assert.ok(apartmentSource.test(source) || sceneSource.test(source), source);
  assert.equal(file, createHash('sha256').update(source).digest('hex').slice(0, 14) + '.webp');
}

for (const floors of Object.values(showroom.blocks)) {
  const seen = new Set();
  for (const { image, units } of Object.values(floors)) {
    assert.ok(units.length);
    if (image) referenced.add(image);
    for (const unit of units) {
      assert.ok(Number.isInteger(unit.number) && unit.number > 0);
      assert.ok(!seen.has(unit.number), `Apartment ${unit.number} appears on multiple floors`);
      seen.add(unit.number);
      assert.ok(unit.rooms === null || (Number.isInteger(unit.rooms) && unit.rooms > 0));
      assert.ok(unit.area === null || (Number.isFinite(unit.area) && unit.area > 0));
      assert.ok(unit.views.length === 0 || unit.views.length === 4);
      assert.equal(new Set(unit.views).size, unit.views.length);
      for (const file of unit.views) {
        assert.ok(images.has(file), file);
        referenced.add(file);
      }
      if (image) {
        assert.ok(pointInPercent(unit.marker));
        assert.ok(unit.outline.length >= 4 && unit.outline.every(pointInPercent));
      }
    }
  }
}

assert.equal(prices.source, 'https://app.uysot.uz/showroom/');
assert.ok(Number.isFinite(Date.parse(prices.capturedAt)));
const pricedUnits = new Set();
for (const { block, floor, number, price } of prices.units) {
  const key = `${block}:${floor}:${number}`;
  assert.ok(showroom.blocks[block]?.[floor]?.units.some(unit => unit.number === number), key);
  assert.ok(!pricedUnits.has(key), `Duplicate CRM price for ${key}`);
  assert.ok(Number.isSafeInteger(price) && price > 0, key);
  pricedUnits.add(key);
}

const sample = showroom.blocks['А']['9'].units.find(unit => unit.number === 54);
assert.equal(sample.area, 40.75);
assert.equal(sample.rooms, 1);
assert.ok(pointInPercent(sample.marker), 'The recorded showroom example must remain selectable on the floor plan.');
assert.deepEqual(showroom.blocks['Г']['8'].units.map(unit => unit.number), [247, 248, 249, 250, 251, 252]);
assert.ok(Object.values(showroom.blocks['Г']).every(floor => floor.units.every(unit => unit.views.length === 4)));
assert.equal(showroom.blocks['Д']['8'].units.find(unit => unit.number === 312).views.length, 4);
assert.deepEqual(showroom.blocks['Д']['9'].units.map(unit => unit.number), [318, 320, 321, 322, 323]);
assert.deepEqual(showroom.blocks['Д']['11'].units.map(unit => unit.number), [330, 332, 333, 334, 335]);
assert.deepEqual(new Set(await readdir(directory)), referenced);
for (const file of referenced) {
  const bytes = await readFile(new URL(file, directory));
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', file);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', file);
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, file);
}
const facadeFiles = new Set();
const levels = Array.from({ length: 12 }, (_, index) => String(index + 1));
assert.deepEqual(Object.keys(scenes.blocks).sort(), ['А', 'Б', 'В', 'Г', 'Д']);
for (const { file, width, height, source } of [scenes.overview, ...Object.values(scenes.blocks)]) {
  assert.match(source, /^https:\/\/src\.srv\.showroom\.app\.uysot\.uz\/v1\/public\/files\/image\/[a-z0-9-]+\.png$/);
  facadeFiles.add(file);
  const asset = await readFile(new URL(`../public/dormon-hills/facades/${file}`, import.meta.url));
  const attributes = await sharp(asset).metadata();
  assert.deepEqual([attributes.format, attributes.width, attributes.height], ['webp', width, height]);
}
for (const [name, { outline, position, floors }] of Object.entries(scenes.blocks)) {
  assert.ok(outline.length >= 4 && outline.every(pointInPercent));
  assert.ok(pointInPercent(position));
  assert.deepEqual(Object.keys(scenes.blocks).filter(other => contains(scenes.blocks[other].outline, position)), [name]);
  assert.deepEqual(Object.keys(floors), levels);
  assert.equal(new Set(Object.values(floors).map(({ position }) => position[0])).size, 1,
    `Floor numbers for block ${name} must share the same vertical line`);
  for (const [level, floor] of Object.entries(floors)) {
    assert.ok(floor.outline.length >= 4 && floor.outline.every(pointInPercent));
    assert.ok(pointInPercent(floor.position));
    assert.deepEqual(levels.filter(other => contains(floors[other].outline, floor.position)), [level]);
  }
}
assert.deepEqual(new Set(await readdir(new URL('../public/dormon-hills/facades/', import.meta.url))), facadeFiles);
console.log(`Do‘rmon showroom verified: five block contours, 60 facade zones and ${referenced.size + facadeFiles.size} local WebP files.`);
