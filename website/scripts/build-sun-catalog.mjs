import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(websiteRoot, 'source/sun');
const publicRoot = resolve(websiteRoot, 'public');
const dataPath = resolve(websiteRoot, 'data/sun-client.json');
const check = process.argv.includes('--check');

const corePins = Object.freeze({
  'assets/brand/logo-main.svg': { bytes: 4735, sha256: '77be959232a45d2548558574d6950aef9bd0201b34485ccc91ead7b7448e2a93' },
  'assets/brand/h2h-logo.svg': { bytes: 4593, sha256: '4a9e0861b40e4a943d82f29afd2e7b0bcb3dc3d73797d9f1ca4c2c130ddcd13e' },
  'assets/video/hero-desktop.mp4': { bytes: 7574719, sha256: 'f156a7d898f7f1f2e3103e2bdf5a543b7b85ba327608b0342f054e263986595c' },
  'assets/video/hero-mobile.mp4': { bytes: 5636192, sha256: '9bacac5012b879121d2bb8493576e1e4754e4d99bcec33c9b3d6d1bf171a85cb' },
  'assets/booklet/sun-official-booklet.pdf': { bytes: 22975386, sha256: '77c061c6e1ae42d495a2c8adb51a8e5972cc43bf491665fd02f1c9479dacc818' },
});
const houseContract = Object.freeze({
  5092560: { id: 'a', block: 'A', display: 'А', floors: 11, total: 70, available: 12, booked: 3, sold: 55, rooms: { 1: 0, 2: 10, 3: 2 }, area: [62.01, 83.90] },
  5092636: { id: 'g', block: 'G', display: 'Г', floors: 13, total: 72, available: 9, booked: 16, sold: 47, rooms: { 1: 4, 2: 5, 3: 0 }, area: [34.67, 62.01] },
  5092717: { id: 'd', block: 'D', display: 'Д', floors: 14, total: 104, available: 13, booked: 17, sold: 74, rooms: { 1: 13, 2: 0, 3: 0 }, area: [34.61, 37.20] },
  5092830: { id: 'v', block: 'V', display: 'В', floors: 13, total: 60, available: 17, booked: 5, sold: 38, rooms: { 1: 1, 2: 16, 3: 0 }, area: [40.39, 68.31] },
});
const planTopology = Object.freeze({
  5092560: [259704, 259705, 259706],
  5092636: [259710, 259713, 259714, 259715],
  5092717: [259716, 259717, 259722, 259723],
  5092830: [259724, 259725, 259726, 259727, 259728],
});
const mediaPublicNames = Object.freeze({
  34: 'overview', 51: 'exterior-01', 52: 'exterior-02', 53: 'exterior-03', 54: 'exterior-04', 55: 'exterior-05', 73: 'overview-dark',
  89: 'courtyard-01', 90: 'courtyard-02', 91: 'courtyard-03', 92: 'courtyard-04', 93: 'courtyard-05', 94: 'courtyard-06',
  98: 'lounge-01', 99: 'lounge-02', 100: 'lounge-03', 101: 'lounge-04', 102: 'lounge-05',
  103: 'roof-01', 104: 'roof-02', 105: 'roof-03', 106: 'roof-04', 107: 'roof-05', 108: 'roof-06', 109: 'roof-07', 110: 'roof-08', 111: 'roof-09', 112: 'roof-10',
  113: 'lobby-01', 114: 'lobby-02', 115: 'lobby-03', 116: 'lobby-04', 117: 'lobby-05', 118: 'lobby-06',
  526: 'construction-a', 527: 'construction-v', 528: 'construction-d', 529: 'construction-g',
});

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function jsonBuffer(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function parse(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
}
async function json(path) { return parse(await readFile(path), path); }
async function readSource(path) { return readFile(resolve(sourceRoot, path)); }
async function ensureWrite(path, buffer, label) {
  if (check) {
    let actual;
    try { actual = await readFile(path); }
    catch (error) { fail(`${label}: missing output (${error?.code ?? error})`); }
    assert(actual.equals(buffer), `${label}: offline rebuild differs from checked-in output`);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}
async function walk(root, relative = '') {
  const entries = await readdir(resolve(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await walk(root, child));
    else files.push(child);
  }
  return files.sort();
}
function range(values) { return { min: Math.min(...values), max: Math.max(...values) }; }
function countBy(values) {
  const output = {};
  for (const value of values) output[value] = (output[value] ?? 0) + 1;
  return output;
}
function displayPrice(price) {
  const grouped = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(price).replaceAll('\u00a0', ' ');
  return { ru: `${grouped} сум`, uz: `${grouped} so‘m`, en: `UZS ${grouped}` };
}
function publicMediaType(record) {
  if (record.classification.includes('construction-photo')) return 'official-construction-photo';
  if (record.classification.includes('cgi')) return 'official-cgi-concept';
  return record.classification;
}
function publicUnitKey(estate, house) {
  const number = String(estate.geo_flatnum)
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('а', 'a')
    .replaceAll('б', 'b')
    .replaceAll('в', 'v')
    .replaceAll('г', 'g')
    .replaceAll('д', 'd')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  assert(number, `Could not create a public unit key for ${estate.geo_flatnum}`);
  return `sun-${house.id}-${number}-f${Number(estate.estate_floor)}`;
}

async function main() {
  const captureBuffer = await readFile(resolve(sourceRoot, 'capture-index.json'));
  const capture = parse(captureBuffer, 'capture-index.json');
  assert(capture.operation === 'network' && typeof capture.capturedAt === 'string', 'SUN capture index does not describe a real network capture');
  assert(capture.assertions?.objectCount === 306 && capture.assertions?.statusCounts?.available === 51 && capture.assertions?.statusCounts?.booked === 41, 'SUN capture assertions changed');
  const recordByPath = new Map(capture.records.map((record) => [record.localPath, record]));
  const recordById = new Map(capture.records.map((record) => [record.id, record]));
  assert(recordByPath.size === capture.records.length && recordById.size === capture.records.length, 'SUN capture records must have unique IDs and paths');

  for (const record of capture.records) {
    const buffer = await readSource(record.localPath);
    assert(buffer.byteLength === record.localByteSize && sha256(buffer) === record.localSha256, `Frozen capture mismatch: ${record.localPath}`);
    assert(record.sourceByteSize === record.localByteSize && record.sourceSha256 === record.localSha256, `Capture source/local digest mismatch: ${record.localPath}`);
  }
  for (const [path, expected] of Object.entries(corePins)) {
    const buffer = await readSource(path);
    assert(buffer.byteLength === expected.bytes, `${path}: expected ${expected.bytes} bytes, found ${buffer.byteLength}`);
    assert(sha256(buffer) === expected.sha256, `${path}: core official SHA-256 changed`);
  }

  const pageRecords = capture.records
    .filter((record) => /^api\/objects\/page-\d+\.json$/.test(record.localPath))
    .sort((left, right) => left.localPath.localeCompare(right.localPath));
  assert(pageRecords.length === 11, `Expected 11 frozen object pages, found ${pageRecords.length}`);
  const pages = await Promise.all(pageRecords.map((record) => json(resolve(sourceRoot, record.localPath))));
  assert(pages[0].objects.length === 60 && pages.slice(1, 10).every((page) => page.objects.length === 30) && pages[10].objects.length === 6, 'Frozen objects_list pagination shape changed');
  const inventoryMap = new Map();
  for (const page of pages) for (const object of page.objects) if (!inventoryMap.has(object.id)) inventoryMap.set(object.id, object);
  const rawInventory = [...inventoryMap.values()];
  assert(rawInventory.length === 306, `Expected 306 deduplicated records, found ${rawInventory.length}`);
  const rawStatusCounts = countBy(rawInventory.map((object) => object.status));
  assert(rawStatusCounts.available === 51 && rawStatusCounts.booked === 41 && rawStatusCounts.sold === 214, `Unexpected raw status counts: ${JSON.stringify(rawStatusCounts)}`);

  const detailRecords = capture.records
    .filter((record) => /^api\/details\/\d+\.json$/.test(record.localPath))
    .sort((left, right) => Number(left.localPath.match(/(\d+)/)?.[1]) - Number(right.localPath.match(/(\d+)/)?.[1]));
  assert(detailRecords.length === 51, `Expected 51 detail responses, found ${detailRecords.length}`);
  const details = await Promise.all(detailRecords.map((record) => json(resolve(sourceRoot, record.localPath))));
  const detailById = new Map(details.map((response) => [response.estate.id, response]));
  assert(detailById.size === 51 && details.every((response) => response.success === true), 'Available detail responses are incomplete');

  const planDerivativeSpecs = [];
  for (const record of capture.records.filter((item) => item.classification.startsWith('official-current-unit-plan-')).sort((left, right) => left.localPath.localeCompare(right.localPath))) {
    const match = record.id.match(/^macro-plan-file-(\d+)-(primary|second)$/);
    assert(match, `Unexpected plan capture ID ${record.id}`);
    const fileId = Number(match[1]);
    const type = match[2];
    planDerivativeSpecs.push({ record, fileId, type, publicPath: `/sun/plans/${record.sourceSha256.slice(0, 16)}-${type}.webp` });
  }
  assert(planDerivativeSpecs.length === 32 && new Set(planDerivativeSpecs.map((item) => item.fileId)).size === 32, 'Expected 32 unique current plan sources');

  const planDerivatives = [];
  for (const spec of planDerivativeSpecs) {
    const sourceBuffer = await readSource(spec.record.localPath);
    const sourceMetadata = await sharp(sourceBuffer).metadata();
    const output = await sharp(sourceBuffer).rotate().resize({ width: 1100, height: 1100, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, effort: 4 }).toBuffer({ resolveWithObject: true });
    await ensureWrite(resolve(publicRoot, spec.publicPath.slice(1)), output.data, spec.publicPath);
    planDerivatives.push({
      sourceId: spec.record.id, fileId: spec.fileId, type: spec.type,
      sourceUrl: spec.record.url, captureUrl: spec.record.finalUrl,
      classification: spec.record.classification, sourceLocalPath: `source/sun/${spec.record.localPath}`,
      sourceByteSize: spec.record.sourceByteSize, sourceSha256: spec.record.sourceSha256,
      sourceWidth: sourceMetadata.width, sourceHeight: sourceMetadata.height,
      publicPath: spec.publicPath, derivativeFormat: 'webp', derivativeTransformation: 'auto-orient; fit inside 1100×1100; no upscaling; WebP quality 90 effort 4',
      derivativeByteSize: output.data.byteLength, derivativeSha256: sha256(output.data), width: output.info.width, height: output.info.height,
    });
  }
  const planDerivativeByFileId = new Map(planDerivatives.map((item) => [item.fileId, item]));

  const mediaDerivatives = [];
  for (const [idText, publicName] of Object.entries(mediaPublicNames)) {
    const id = Number(idText);
    const record = recordById.get(`wordpress-media-${id}`);
    assert(record, `Missing official WordPress media capture ${id}`);
    const sourceBuffer = await readSource(record.localPath);
    const sourceMetadata = await sharp(sourceBuffer).metadata();
    const width = id >= 526 ? 1000 : 1600;
    const output = await sharp(sourceBuffer).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: id >= 526 ? 84 : 85, effort: 4 }).toBuffer({ resolveWithObject: true });
    const publicPath = `/sun/images/${publicName}.webp`;
    await ensureWrite(resolve(publicRoot, publicPath.slice(1)), output.data, publicPath);
    mediaDerivatives.push({
      sourceId: record.id, wordpressMediaId: id, sourceUrl: record.url, captureUrl: record.finalUrl,
      classification: publicMediaType(record), disclosureRequired: true,
      sourceLocalPath: `source/sun/${record.localPath}`, sourceByteSize: record.sourceByteSize, sourceSha256: record.sourceSha256,
      sourceWidth: sourceMetadata.width, sourceHeight: sourceMetadata.height,
      publicPath, derivativeFormat: 'webp', derivativeTransformation: `auto-orient; width≤${width}; no upscaling; WebP quality ${id >= 526 ? 84 : 85} effort 4`,
      derivativeByteSize: output.data.byteLength, derivativeSha256: sha256(output.data), width: output.info.width, height: output.info.height,
    });
  }

  const byteCopies = [
    ['assets/brand/logo-main.svg', '/sun/logo.svg', 'official-brand-logo', { width: 380, height: 64 }],
    ['assets/brand/h2h-logo.svg', '/sun/h2h-logo.svg', 'official-developer-logo', { width: 217, height: 42 }],
    ['assets/video/hero-desktop.mp4', '/sun/video/hero-desktop.mp4', 'official-mixed-cgi-construction-video', { width: 1920, height: 1080, durationSeconds: 11.033, codec: 'H.264' }],
    ['assets/video/hero-mobile.mp4', '/sun/video/hero-mobile.mp4', 'official-mixed-cgi-construction-video', { width: 1080, height: 1920, durationSeconds: 11.033, codec: 'H.264' }],
    ['assets/booklet/sun-official-booklet.pdf', '/sun/sun-official-booklet.pdf', 'official-archival-marketing-booklet', { pageCount: 43 }],
  ];
  const copiedDerivatives = [];
  for (const [sourcePath, publicPath, classification, metadata] of byteCopies) {
    const buffer = await readSource(sourcePath);
    await ensureWrite(resolve(publicRoot, publicPath.slice(1)), buffer, publicPath);
    const record = recordByPath.get(sourcePath);
    assert(record, `Missing capture record for ${sourcePath}`);
    copiedDerivatives.push({
      sourceId: record.id, sourceUrl: record.url, captureUrl: record.finalUrl, classification,
      sourceLocalPath: `source/sun/${sourcePath}`, sourceByteSize: buffer.byteLength, sourceSha256: sha256(buffer),
      publicPath, derivativeFormat: sourcePath.split('.').at(-1), derivativeTransformation: 'byte-identical copy',
      derivativeByteSize: buffer.byteLength, derivativeSha256: sha256(buffer), ...metadata,
    });
  }

  const sourceOrderById = new Map(rawInventory.map((item, index) => [item.id, index]));
  const privateUnits = [];
  for (const [id, detail] of [...detailById].sort((left, right) => (sourceOrderById.get(left[0]) ?? 0) - (sourceOrderById.get(right[0]) ?? 0))) {
    const sourceObject = inventoryMap.get(id);
    assert(sourceObject?.status === 'available', `Detail ${id} has no available objects_list row`);
    const outer = detail.estate;
    const estate = outer.estate;
    const house = houseContract[estate.house];
    assert(house, `Unit ${id} belongs to unexpected house ${estate.house}`);
    assert(outer.status === 'available' && estate.estate_activity === 'sell' && estate.category === 'flat', `Unit ${id} changed status/category/activity`);
    const plans = Object.fromEntries((outer.plans ?? []).filter((plan) => ['primary', 'second'].includes(plan.type)).map((plan) => [plan.type, plan]));
    assert(plans.primary && plans.second, `Unit ${id} must have both official plan surfaces`);
    const primary = planDerivativeByFileId.get(plans.primary.file_id);
    const second = planDerivativeByFileId.get(plans.second.file_id);
    assert(primary && second, `Unit ${id} plan derivative mapping is incomplete`);
    const price = Number(estate.estate_price);
    const regularPrice = Number(estate.priceWithoutDiscount);
    const area = Number(estate.estate_area);
    const pricePerM2 = Number(estate.estate_price_m2);
    assert(Number.isSafeInteger(id) && Number.isSafeInteger(price) && Number.isSafeInteger(regularPrice) && price === regularPrice, `Unit ${id} price contract changed`);
    assert(!outer.promos?.length && !sourceObject.promos?.length, `Unit ${id} unexpectedly has a promotion`);
    const unit = {
      id, publicKey: publicUnitKey(estate, house), sourceOrder: sourceOrderById.get(id), number: String(estate.geo_flatnum), title: String(estate.title),
      houseId: estate.house, block: house.block, blockName: house.display, blockId: house.id,
      floor: Number(estate.estate_floor), maxFloor: house.floors, entrance: Number(estate.geo_house_entrance),
      rooms: Number(estate.estate_rooms), area, price, pricePerM2, status: 'available', sourceStatus: outer.status,
      planId: Number(estate.plans_id), primaryPlanFileId: plans.primary.file_id, secondPlanFileId: plans.second.file_id,
      primaryPlanPath: primary.publicPath, secondPlanPath: second.publicPath,
      primaryPlanWidth: primary.width, primaryPlanHeight: primary.height, secondPlanWidth: second.width, secondPlanHeight: second.height,
      planWidth: second.width, planHeight: second.height,
      effectivePrice: price, displayPrice: displayPrice(price), regularPrice,
      snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null,
      category: estate.category, activity: estate.estate_activity, windowView: estate.estate_windowView || null,
      studio: Boolean(estate.estate_studia), ceilingHeight: estate.estate_ceilingHeight || null,
      provenance: {
        objectsPage: pageRecords.find((_, index) => pages[index].objects.some((item) => item.id === id))?.localPath ?? null,
        detailPath: `api/details/${id}.json`, detailSha256: recordByPath.get(`api/details/${id}.json`)?.localSha256 ?? null,
        primarySourcePath: primary.sourceLocalPath, secondSourcePath: second.sourceLocalPath,
      },
    };
    assert(planTopology[unit.houseId].includes(unit.planId), `Unit ${id} uses unexpected plan ${unit.planId}`);
    privateUnits.push(unit);
  }
  assert(privateUnits.length === 51, `Expected 51 canonical available units, found ${privateUnits.length}`);
  assert(new Set(privateUnits.map((unit) => unit.publicKey)).size === privateUnits.length, 'SUN public unit keys must be unique');

  const areas = privateUnits.map((unit) => unit.area);
  const prices = privateUnits.map((unit) => unit.price);
  const roomCounts = countBy(privateUnits.map((unit) => unit.rooms));
  assert(roomCounts[1] === 18 && roomCounts[2] === 31 && roomCounts[3] === 2, `Unexpected available room counts: ${JSON.stringify(roomCounts)}`);
  assert(Math.min(...areas) === 34.61 && Math.max(...areas) === 83.9, 'Available area range changed');
  assert(Math.min(...prices) === 867730752 && Math.max(...prices) === 1966290516, 'Available price range changed');

  const inventory = rawInventory.map((raw, sourceOrder) => ({
    id: Number(raw.id), sourceOrder, number: String(raw.estate.geo_flatnum), houseId: Number(raw.estate.house),
    floor: Number(raw.estate.estate_floor), entrance: Number(raw.estate.geo_house_entrance), rooms: Number(raw.estate.estate_rooms),
    area: Number(raw.estate.estate_area), status: raw.status, planId: Number(raw.estate.plans_id),
  }));

  const topologyRecords = capture.records
    .filter((record) => /^api\/estates\/house-\d+\.json$/.test(record.localPath))
    .sort((left, right) => Number(left.localPath.match(/house-(\d+)/)?.[1]) - Number(right.localPath.match(/house-(\d+)/)?.[1]));
  assert(topologyRecords.length === 4, `Expected four get_estates topology responses, found ${topologyRecords.length}`);
  const topologyResponses = await Promise.all(topologyRecords.map((record) => json(resolve(sourceRoot, record.localPath))));
  const topologyExpected = new Map([
    [5092560, { min: 2, max: 11, rows: 10, total: 70, maxItems: 7 }],
    [5092636, { min: 2, max: 13, rows: 12, total: 72, maxItems: 6 }],
    [5092717, { min: 2, max: 14, rows: 13, total: 104, maxItems: 8 }],
    [5092830, { min: 2, max: 13, rows: 12, total: 60, maxItems: 5 }],
  ]);
  const privateTopologyRows = [];
  for (const response of topologyResponses) {
    assert(response.success === true && response.estates?.length === 1, 'get_estates response must contain exactly one estate');
    const estate = response.estates[0];
    const expected = topologyExpected.get(Number(estate.id));
    assert(expected, `Unexpected topology house ${estate.id}`);
    assert(estate.entrances?.length === 1 && Number(estate.entrances[0].number) === 1, `House ${estate.id} must have one real entrance`);
    const entrance = estate.entrances[0];
    const expectedFloors = Array.from({ length: expected.rows }, (_, index) => expected.min + index);
    const topFloors = [...estate.floors].map(Number).sort((left, right) => left - right);
    const entranceFloors = entrance.floors.map((floor) => Number(floor.number)).sort((left, right) => left - right);
    assert(JSON.stringify(topFloors) === JSON.stringify(expectedFloors) && JSON.stringify(entranceFloors) === JSON.stringify(expectedFloors), `House ${estate.id} floor topology changed`);
    assert(Number(entrance.maxItemsCount) === expected.maxItems, `House ${estate.id} maximum row density changed`);
    assert(entrance.floors.every((floor) => Number(floor.itemsCount) === floor.items.length), `House ${estate.id} itemsCount mismatch`);
    assert(entrance.floors.reduce((sum, floor) => sum + Number(floor.itemsCount), 0) === expected.total, `House ${estate.id} topology total changed`);
    for (const floor of entrance.floors) privateTopologyRows.push({
      id: `${houseContract[estate.id].id}-e1-f${floor.number}`, groupId: houseContract[estate.id].id,
      houseId: Number(estate.id), block: houseContract[estate.id].block, blockName: houseContract[estate.id].display,
      entrance: 1, floor: Number(floor.number), allUnitIds: floor.items.map((item) => Number(item.id)),
    });
  }
  assert(privateTopologyRows.length === 47 && new Set(privateTopologyRows.map((row) => `${row.houseId}:${row.entrance}:${row.floor}`)).size === 47, 'Expected 47 unique get_estates rows');
  const topologyUnitIds = privateTopologyRows.flatMap((row) => row.allUnitIds);
  assert(topologyUnitIds.length === 306 && new Set(topologyUnitIds).size === 306, 'get_estates topology must contain 306 unique unit IDs');
  assert([...new Set(topologyUnitIds)].every((id) => inventoryMap.has(id)), 'get_estates and objects_list unit sets differ');

  const groups = Object.entries(houseContract).map(([houseIdText, house]) => {
    const houseId = Number(houseIdText);
    const rows = inventory.filter((item) => item.houseId === houseId);
    const availableUnits = privateUnits.filter((unit) => unit.houseId === houseId);
    const counts = countBy(rows.map((item) => item.status));
    const rooms = countBy(availableUnits.map((unit) => unit.rooms));
    assert(rows.length === house.total && counts.available === house.available && counts.booked === house.booked && counts.sold === house.sold, `House ${house.display} raw status contract changed`);
    assert([1, 2, 3].every((room) => (rooms[room] ?? 0) === house.rooms[room]), `House ${house.display} room contract changed`);
    const houseAreas = range(availableUnits.map((unit) => unit.area));
    assert(houseAreas.min === house.area[0] && houseAreas.max === house.area[1], `House ${house.display} area range changed`);
    return {
      id: house.id, houseId, block: house.block, blockName: house.display, entrance: 1,
      floorStart: 2, floorEnd: house.floors, maxFloor: house.floors,
      total: rows.length, available: counts.available, booked: counts.booked, reserve: counts.booked, sold: counts.sold,
      availableByRooms: { 1: rooms[1] ?? 0, 2: rooms[2] ?? 0, 3: rooms[3] ?? 0 },
      areaRange: houseAreas, planIds: [...planTopology[houseId]], unitIds: availableUnits.map((unit) => unit.id),
    };
  });
  const publicKeyByInternalId = new Map(privateUnits.map((unit) => [unit.id, unit.publicKey]));
  const matrixRows = privateTopologyRows.map((row) => {
    const rowInventory = row.allUnitIds.map((id) => inventoryMap.get(id));
    const statuses = countBy(rowInventory.map((item) => item.status));
    return {
      id: row.id, groupId: row.groupId, block: row.block, blockName: row.blockName,
      entrance: row.entrance, floor: row.floor,
      unitIds: row.allUnitIds.flatMap((internalId) => {
        const publicKey = publicKeyByInternalId.get(internalId);
        return publicKey ? [publicKey] : [];
      }),
      rawStatusCounts: { available: statuses.available ?? 0, booked: statuses.booked ?? 0, sold: statuses.sold ?? 0 },
      statusCounts: { available: statuses.available ?? 0, reserve: statuses.booked ?? 0, sold: statuses.sold ?? 0 },
      totalUnits: row.allUnitIds.length,
    };
  });
  assert(matrixRows.length === 47, `Expected 47 stable group×entrance×floor rows, found ${matrixRows.length}`);

  const clientUnits = privateUnits.map((unit) => ({
    id: unit.publicKey, unitKey: unit.publicKey, recommendationRank: unit.sourceOrder, number: unit.number, title: unit.title,
    block: unit.block, blockName: unit.blockName,
    floor: unit.floor, maxFloor: unit.maxFloor, entrance: unit.entrance, rooms: unit.rooms, area: unit.area,
    price: unit.price, pricePerM2: unit.pricePerM2, status: unit.status,
    primaryPlanPath: unit.primaryPlanPath, secondPlanPath: unit.secondPlanPath,
    primaryPlanWidth: unit.primaryPlanWidth, primaryPlanHeight: unit.primaryPlanHeight,
    secondPlanWidth: unit.secondPlanWidth, secondPlanHeight: unit.secondPlanHeight,
    planWidth: unit.planWidth, planHeight: unit.planHeight,
    effectivePrice: unit.effectivePrice, displayPrice: unit.displayPrice, regularPrice: unit.regularPrice,
    snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null,
    windowView: unit.windowView,
  }));
  const summary = {
    publicCatalogRecords: inventory.length, available: privateUnits.length, reserve: rawStatusCounts.booked, sold: rawStatusCounts.sold,
    rawStatusCounts: { available: rawStatusCounts.available, booked: rawStatusCounts.booked, sold: rawStatusCounts.sold },
    normalizedStatusCounts: { available: rawStatusCounts.available, reserve: rawStatusCounts.booked, sold: rawStatusCounts.sold },
    availableByRooms: { 1: roomCounts[1], 2: roomCounts[2], 3: roomCounts[3] },
    areaRange: range(areas), priceRange: range(prices), privatePlanTypeCount: new Set(privateUnits.map((unit) => unit.planId)).size,
    planSourceCount: planDerivatives.length, floorPlanSourceCount: capture.assertions.floorPlanFileCount, matrixRowCount: matrixRows.length,
  };
  const projectFacts = {
    positioning: { ru: 'Первый клубный проект Human2Human — создан людьми для людей', uz: 'Human2Humanning odamlar tomonidan odamlar uchun yaratilgan ilk klub loyihasi', en: 'Human2Human’s first club-format project, created by people for people' },
    siteAreaHectares: 1, projectBlocks: 5, totalProjectApartments: 361, floorRange: { min: 11, max: 14 },
    address: { ru: 'Ташкент, Мирабадский район, ул. Сайхун 56/2', uz: 'Toshkent, Mirobod tumani, Sayxun ko‘chasi 56/2', en: '56/2 Saykhun Street, Mirabad District, Tashkent' },
    phone: '+998 78 113 77 12', email: 'info@h2h.uz', hours: { ru: 'Ежедневно 09:00–20:00', uz: 'Har kuni 09:00–20:00', en: 'Daily 09:00–20:00' },
    officialMapUrl: 'https://yandex.uz/maps/?ll=69.301919%2C41.282957&z=16',
    schedule: [
      { block: 'A', blockName: 'А', published: { ru: 'октябрь 2026', uz: '2026-yil oktabr', en: 'October 2026' } },
      { block: 'B', blockName: 'Б', published: { ru: 'октябрь 2027', uz: '2027-yil oktabr', en: 'October 2027' }, absentFromPublicCatalog: true },
      { block: 'V', blockName: 'В', published: { ru: 'февраль 2027', uz: '2027-yil fevral', en: 'February 2027' } },
      { block: 'G', blockName: 'Г', published: { ru: 'июнь 2026', uz: '2026-yil iyun', en: 'June 2026' }, scheduleConflict: true },
      { block: 'D', blockName: 'Д', published: { ru: 'июнь 2026', uz: '2026-yil iyun', en: 'June 2026' }, scheduleConflict: true },
    ],
    constructionUpdateDate: '2026-08-15', wordpressPageModifiedAt: '2026-08-26T13:42:01',
    currentPromotionsFoundAtCapture: 0,
  };
  const publicSummary = {
    publicCatalogRecords: summary.publicCatalogRecords,
    available: summary.available,
    reserve: summary.reserve,
    sold: summary.sold,
    normalizedStatusCounts: summary.normalizedStatusCounts,
    availableByRooms: summary.availableByRooms,
    areaRange: summary.areaRange,
    priceRange: summary.priceRange,
    planTypeCount: summary.privatePlanTypeCount,
    planSourceCount: summary.planSourceCount,
    matrixRowCount: summary.matrixRowCount,
  };
  const publicGroups = groups.map((group) => ({
    id: group.id,
    block: group.block,
    blockName: group.blockName,
    entrance: group.entrance,
    floorStart: group.floorStart,
    floorEnd: group.floorEnd,
    maxFloor: group.maxFloor,
    total: group.total,
    available: group.available,
    reserve: group.reserve,
    sold: group.sold,
    availableByRooms: group.availableByRooms,
    areaRange: group.areaRange,
    unitIds: group.unitIds.map((internalId) => publicKeyByInternalId.get(internalId)).filter(Boolean),
  }));
  const catalog = {
    schemaVersion: 2,
    project: 'SUN',
    projectSlug: 'sun',
    capturedAt: capture.capturedAt,
    sourceKeyContract: 'sun-{block}-{published-unit-number}-f{floor}',
    summary: publicSummary,
    projectFacts,
    campaign: { snapshotCampaignPrice: null, campaignActive: false, campaignDeadline: null },
    groups: publicGroups,
    matrixRows,
    units: clientUnits,
  };

  const publicDerivatives = [...copiedDerivatives, ...mediaDerivatives, ...planDerivatives].sort((left, right) => left.publicPath.localeCompare(right.publicPath));
  const sourceManifest = {
    schemaVersion: 1, project: 'SUN', projectSlug: 'sun', capturedAt: capture.capturedAt,
    captureOperation: 'network', runtimeNetworkDependency: false,
    coreOfficialPins: corePins,
    sourceRecordCount: capture.records.length,
    sourceByteTotal: capture.records.reduce((sum, record) => sum + record.localByteSize, 0),
    records: capture.records,
    references: {
      captureIndex: 'capture-index.json',
      publicDerivatives: 'public-derivatives-manifest.json', planDerivatives: 'plan-derivatives-manifest.json',
      catalogContract: 'catalog-contract.json', bundleManifest: 'bundle-manifest.json', clientCatalog: 'data/sun-client.json',
    },
  };
  const publicManifest = { schemaVersion: 1, project: 'SUN', capturedAt: capture.capturedAt, count: publicDerivatives.length, totalBytes: publicDerivatives.reduce((sum, item) => sum + item.derivativeByteSize, 0), items: publicDerivatives };
  const planManifest = { schemaVersion: 1, project: 'SUN', capturedAt: capture.capturedAt, count: planDerivatives.length, privatePlanTypeCount: summary.privatePlanTypeCount, items: planDerivatives };
  const catalogContract = {
    schemaVersion: 1, capturedAt: capture.capturedAt,
    exact: { complexId: 5092562, projectBlocks: 5, publicCatalogHouses: 4, publicRecords: 306, rawStatuses: { available: 51, booked: 41, sold: 214 }, normalizedStatuses: { available: 51, reserve: 41, sold: 214 }, availableByRooms: summary.availableByRooms, areaRange: summary.areaRange, priceRange: summary.priceRange, planIds: [...new Set(privateUnits.map((unit) => unit.planId))].sort((a, b) => a - b), planFiles: 32, floorPlanSources: 27, matrixRows: 47 },
    topology: groups.map((group) => ({ houseId: group.houseId, block: group.block, floors: [group.floorStart, group.floorEnd], entrance: group.entrance, total: group.total, available: group.available, rawBooked: group.booked, normalizedReserve: group.reserve, sold: group.sold, planIds: group.planIds })),
    pricePolicy: { numericPricesPublic: true, effectivePriceSource: 'live get_estate estate_price', regularPriceSource: 'live get_estate priceWithoutDiscount', campaignActive: false, campaignDeadline: null, crossedPrices: false, timers: false },
  };

  await ensureWrite(dataPath, jsonBuffer(catalog), 'data/sun-client.json');
  await ensureWrite(resolve(sourceRoot, 'source-manifest.json'), jsonBuffer(sourceManifest), 'source/sun/source-manifest.json');
  await ensureWrite(resolve(sourceRoot, 'public-derivatives-manifest.json'), jsonBuffer(publicManifest), 'source/sun/public-derivatives-manifest.json');
  await ensureWrite(resolve(sourceRoot, 'plan-derivatives-manifest.json'), jsonBuffer(planManifest), 'source/sun/plan-derivatives-manifest.json');
  await ensureWrite(resolve(sourceRoot, 'catalog-contract.json'), jsonBuffer(catalogContract), 'source/sun/catalog-contract.json');

  const bundleFiles = (await walk(sourceRoot)).filter((path) => !['bundle-manifest.json', 'integrity-report.json'].includes(path));
  const bundleEntries = await Promise.all(bundleFiles.map(async (localPath) => {
    const buffer = await readSource(localPath);
    return { localPath, bytes: buffer.byteLength, sha256: sha256(buffer) };
  }));
  const bundleManifest = {
    schemaVersion: 1, project: 'SUN', root: 'source/sun', capturedAt: capture.capturedAt,
    excludesSelf: true, total: bundleEntries.length, rawByteTotal: bundleEntries.reduce((sum, item) => sum + item.bytes, 0), files: bundleEntries,
  };
  await ensureWrite(resolve(sourceRoot, 'bundle-manifest.json'), jsonBuffer(bundleManifest), 'source/sun/bundle-manifest.json');

  console.log(`SUN offline ${check ? 'check' : 'build'} passed: 306 records (51 available / 41 reserve / 214 sold), 51 details, 32 plan files, 27 floor sources, 47 matrix rows, ${publicDerivatives.length} public assets, 0 campaigns.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
