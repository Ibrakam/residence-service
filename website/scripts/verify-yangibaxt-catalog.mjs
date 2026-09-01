import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildYangiBaxtCatalog } from './build-yangibaxt-catalog.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const projectPrefix = `${websiteRoot}${sep}`;

const expectedIds = {
  companyId: '5cba02b4-8abd-11ee-ab79-001dd8b7289a',
  realEstateUUID: '6481be1c-c9fe-11ed-a82c-001dd8b726aa',
  propertyTypeUUID: '5990a172-812a-4fee-b4f5-c860cca824d7',
};

const expectedRaw = {
  placementList: {
    repoPath: 'data/yangibaxt-placement-raw.json',
    url: 'https://apigw.bi.group/sales-picker/microfe-v3/placementList',
    bytes: 562462,
    sha256: 'd8288a4a14675a9a18a7d179407a3458054c9351fd5b3699667a4162e8b34aaa',
  },
  filter: {
    repoPath: 'data/yangibaxt-filter-raw.json',
    url: 'https://apigw.bi.group/sales-picker/microfe-v3/filter',
    bytes: 2306,
    sha256: 'a89dc0ce4205b7bf706bd644fd83a2aff623cd85919014f7d58f58b05401e279',
  },
  realEstateList: {
    repoPath: 'data/yangibaxt-real-estate-raw.json',
    url: 'https://apigw.bi.group/sales-picker/microfe-v3/realEstateList',
    bytes: 3701,
    sha256: '09a0954c49fa2596bb72edeb48da37cbc9d6ceb9fc029b12bb68114803b95ba5',
  },
};

const expectedGroups = [
  {
    id: '906c7f96-c9ff-11ed-a82c-001dd8b726aa',
    rawName: 'NRG Yangi Baxt - 1',
    displayName: '1',
    count: 1,
    normalizedDeadline: '2025-06-28',
    rawDeadline: '2025-06-27',
    entrances: [{ entrance: 1, count: 1, maxFloor: 12 }],
  },
  {
    id: '71e3d326-1966-11ee-a827-001dd8b72708',
    rawName: 'NRG Yangi Baxt - 2',
    displayName: '2',
    count: 1,
    normalizedDeadline: '2025-12-27',
    rawDeadline: '2025-12-26',
    entrances: [{ entrance: 4, count: 1, maxFloor: 9 }],
  },
  {
    id: 'fd543000-f586-44cb-8952-a256db2b5a2e',
    rawName: 'NRG Yangi Baxt - 3 - 1',
    displayName: '3-1',
    count: 14,
    normalizedDeadline: '2027-02-20',
    rawDeadline: '2027-02-19',
    entrances: [{ entrance: 1, count: 14, maxFloor: 16 }],
  },
  {
    id: 'd54a2404-ec84-4f46-8538-309199668606',
    rawName: 'NRG Yangi Baxt - 3 -2',
    displayName: '3-2',
    count: 141,
    normalizedDeadline: '2027-08-28',
    rawDeadline: '2027-08-27',
    entrances: [{ entrance: 2, count: 67, maxFloor: 16 }, { entrance: 3, count: 74, maxFloor: 16 }],
  },
  {
    id: 'f3eb11ee-a08b-4d22-ad92-eefd8a6bd36c',
    rawName: 'Yangi Baxt Munavvar 1',
    displayName: 'Munavvar 1',
    count: 108,
    normalizedDeadline: '2028-04-29',
    rawDeadline: '2028-04-28',
    entrances: [{ entrance: 1, count: 5, maxFloor: 9 }, { entrance: 2, count: 66, maxFloor: 12 }, { entrance: 3, count: 19, maxFloor: 9 }, { entrance: 4, count: 18, maxFloor: 9 }],
  },
];

const expectedStatuses = {
  'Бронирование': { count: 1, isSale: 0 },
  'Расторжение': { count: 12, isSale: 12 },
  'Свободно': { count: 63, isSale: 63 },
  'Снятие брони': { count: 3, isSale: 3 },
  'Снятие резерва': { count: 186, isSale: 186 },
};

const expectedMediaTypes = {
  'hero-real': 'real-photo',
  'phase-two-facade': 'real-photo',
  'realized-courtyard-01': 'real-photo',
  'realized-courtyard-02': 'real-photo',
  'realized-landscape-01': 'real-photo',
  'realized-landscape-02': 'real-photo',
  'realized-landscape-03': 'real-photo',
  'gallery-courtyard-01': 'real-photo',
  'gallery-courtyard-02': 'real-photo',
  'gallery-courtyard-03': 'real-photo',
  'gallery-courtyard-04': 'real-photo',
  'hall-01': 'real-photo',
  'hall-02': 'real-photo',
  'hall-03': 'real-photo',
  'hall-04': 'real-photo',
  'district-concept': 'cgi-concept',
  'park-concept': 'cgi-concept',
  'towers-concept-01': 'cgi-concept',
  'towers-concept-02': 'cgi-concept',
  'towers-concept-03': 'cgi-concept',
  'architecture-concept': 'cgi-concept',
  'construction-2026-07-01': 'construction-photo',
  'construction-2026-07-02': 'construction-photo',
  'construction-2026-07-03': 'construction-photo',
  'construction-2026-07-04': 'construction-photo',
};

const expectedOccupiedFloorRows = 76;
const expectedOccupiedFloorProjectionSha256 = 'bae721703305884508829d4869164710a74cfb0118b2c303a770aaf4b8411ccb';
const expectedStableEntranceCount = 9;
const expectedStableFloorRows = 108;
const expectedStableUnitCells = 265;
const expectedBooklet = {
  sourceUrl: 'https://s3.bi.group/biclick/content-manager/Yangi_Baxt_6e54075b1b.pdf',
  sourceRepoPath: 'tmp/pdfs/yangibaxt-official.pdf',
  repoPath: 'public/yangibaxt/documents/yangibaxt-official.pdf',
  publicPath: '/yangibaxt/documents/yangibaxt-official.pdf',
  bytes: 18591107,
  sha256: '94998a9512584046f27a3e14a8a0f7ba802a6e99440a83a27299cdfc4fda33b7',
  pages: 33,
};

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertDeep(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) fail(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function repoPath(relativePath) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, 'Empty repository path in manifest');
  const absolutePath = resolve(websiteRoot, relativePath);
  assert(absolutePath.startsWith(projectPrefix), `Manifest path escapes website root: ${relativePath}`);
  return absolutePath;
}

async function readJson(relativePath) {
  const value = await readFile(repoPath(relativePath), 'utf8');
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function countBy(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function statusCounts(units) {
  const result = {};
  for (const unit of units) {
    const current = result[unit.statusOriginal] ?? { count: 0, isSale: 0 };
    current.count += 1;
    if (unit.isSale) current.isSale += 1;
    result[unit.statusOriginal] = current;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right, 'ru')));
}

function matrix(units) {
  const groupOrder = new Map(expectedGroups.map((group, index) => [group.displayName, index]));
  const cells = new Map();
  for (const unit of units) {
    const key = `${unit.buildingDisplay}|${unit.entrance}|${unit.floor}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  return [...cells]
    .sort(([left], [right]) => {
      const [leftGroup, leftEntrance, leftFloor] = left.split('|');
      const [rightGroup, rightEntrance, rightFloor] = right.split('|');
      return (groupOrder.get(leftGroup) ?? 99) - (groupOrder.get(rightGroup) ?? 99)
        || Number(leftEntrance) - Number(rightEntrance)
        || Number(leftFloor) - Number(rightFloor);
    })
    .map(([key, count]) => `${key}|${count}`)
    .join('\n');
}

function stableEntranceStructure(units, raw = false) {
  const groupOrder = new Map(expectedGroups.map((group, index) => [group.rawName, index]));
  const entries = new Map();
  for (const unit of units) {
    const rawName = raw ? unit.blockName : unit.building;
    const expectedGroup = expectedGroups.find((group) => group.rawName === rawName);
    assert(expectedGroup, `Unexpected group in stable matrix structure: ${String(rawName)}`);
    const groupId = raw ? unit.blockId : unit.buildingId;
    const entrance = unit.entrance;
    const maxFloor = raw ? unit.maxFloor : unit.totalFloors;
    const key = `${groupId}|${entrance}`;
    const entry = entries.get(key) ?? {
      groupId,
      rawName,
      displayName: expectedGroup.displayName,
      entrance,
      count: 0,
      maxFloors: new Set(),
    };
    entry.count += 1;
    entry.maxFloors.add(maxFloor);
    entries.set(key, entry);
  }
  return [...entries.values()]
    .sort((left, right) => (groupOrder.get(left.rawName) ?? 99) - (groupOrder.get(right.rawName) ?? 99) || left.entrance - right.entrance)
    .map((entry) => {
      assert(entry.maxFloors.size === 1, `Inconsistent maxFloor in ${entry.rawName}, entrance ${entry.entrance}`);
      return {
        groupId: entry.groupId,
        rawName: entry.rawName,
        displayName: entry.displayName,
        entrance: entry.entrance,
        maxFloor: [...entry.maxFloors][0],
        count: entry.count,
      };
    });
}

function publicToRepoPath(publicPath) {
  assert(/^\/yangibaxt\/(?:images|documents|plans|floor-positions)\/[A-Za-z0-9._+-]+$/.test(publicPath), `Invalid Yangi Baxt public asset path: ${publicPath}`);
  return `public${publicPath}`;
}

async function verifyLocalFile(relativePath, expectedBytes, expectedSha256, label) {
  const buffer = await readFile(repoPath(relativePath));
  assert(buffer.byteLength === expectedBytes, `${label} byte length mismatch`);
  assert(sha256(buffer) === expectedSha256, `${label} SHA-256 mismatch`);
}

async function listFiles(relativeDirectory, extension) {
  return (await readdir(repoPath(relativeDirectory)))
    .filter((name) => name.endsWith(extension))
    .sort();
}

async function collectSourceFiles(relativeDirectory) {
  const result = [];
  async function visit(current) {
    for (const entry of await readdir(repoPath(current), { withFileTypes: true })) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory()) await visit(child);
      else if (/\.(?:ts|tsx|css)$/.test(entry.name)) result.push(child);
    }
  }
  await visit(relativeDirectory);
  return result.sort();
}

function assertTokens(text, relativePath, tokens) {
  for (const token of tokens) {
    const found = token instanceof RegExp ? token.test(text) : text.includes(token);
    assert(found, `${relativePath} is missing required token ${String(token)}`);
  }
}

const [catalog, sources, plans, media, rebuilt, rawPlacement, rawFilter, rawEstate] = await Promise.all([
  readJson('data/yangibaxt-catalog.json'),
  readJson('data/yangibaxt-sources.json'),
  readJson('data/yangibaxt-plan-sources.json'),
  readJson('data/yangibaxt-media-sources.json'),
  buildYangiBaxtCatalog(),
  readFile(repoPath(expectedRaw.placementList.repoPath)),
  readFile(repoPath(expectedRaw.filter.repoPath)),
  readFile(repoPath(expectedRaw.realEstateList.repoPath)),
]);

assertDeep(catalog, rebuilt, 'Checked-in catalog differs from the deterministic offline rebuild');
assert(sources.project === 'Yangi Baxt', 'Source manifest project mismatch');
assert(sources.capturedAt === '2026-08-30T16:57:42Z', 'Unexpected snapshot timestamp');
assert(sources.capturedAtUzt === '2026-08-30T21:57:42+05:00', 'Unexpected UZT snapshot timestamp');
assert(typeof sources.captureCompletedAt === 'string' && typeof sources.captureCompletedAtUzt === 'string', 'Capture completion provenance is incomplete');
assertDeep(
  { companyId: sources.catalog.companyId, realEstateUUID: sources.catalog.realEstateUUID, propertyTypeUUID: sources.catalog.propertyTypeUUID },
  expectedIds,
  'Frozen catalog IDs mismatch',
);

const rawBuffers = { placementList: rawPlacement, filter: rawFilter, realEstateList: rawEstate };
for (const [name, expected] of Object.entries(expectedRaw)) {
  const record = sources.catalog[name];
  const buffer = rawBuffers[name];
  assert(record.repoPath === expected.repoPath, `${name} raw path mismatch`);
  assert(record.method === 'POST' && record.url === expected.url && record.httpStatus === 200, `${name} endpoint provenance mismatch`);
  assert(typeof record.serverDateUtc === 'string' && /GMT$/.test(record.serverDateUtc), `${name} server Date is missing`);
  assert(record.bytes === expected.bytes && record.sha256 === expected.sha256, `${name} frozen manifest checksum mismatch`);
  assert(buffer.byteLength === expected.bytes && sha256(buffer) === expected.sha256, `${name} raw file integrity mismatch`);
  assert(buffer.at(-1) === 0x7d && buffer.at(-1) !== 0x0a && buffer.at(-1) !== 0x0d, `${name} raw file must end at the final JSON brace without LF`);
  assert(catalog.sourceApis[name].bytes === expected.bytes && catalog.sourceApis[name].sha256 === expected.sha256, `${name} catalog provenance mismatch`);
}

const scopedRequest = {
  pageNo: 1,
  pageSize: 500,
  companyIds: [expectedIds.companyId],
  realEstateUUIDs: [expectedIds.realEstateUUID],
  propertyTypes: [expectedIds.propertyTypeUUID],
  filterTags: {},
};
assertDeep(sources.catalog.placementList.requestBody, scopedRequest, 'placementList request scope mismatch');
assertDeep(sources.catalog.filter.requestBody, scopedRequest, 'filter request scope mismatch');
assertDeep(sources.catalog.realEstateList.requestBody, {
  pageNo: 1,
  pageSize: 500,
  companyIds: [expectedIds.companyId],
  realEstateUUIDs: [expectedIds.realEstateUUID],
}, 'realEstateList request scope mismatch');

const placementResponse = JSON.parse(rawPlacement.toString('utf8'));
const filterResponse = JSON.parse(rawFilter.toString('utf8'));
const estateResponse = JSON.parse(rawEstate.toString('utf8'));
const rawUnits = placementResponse.placements;
assert(Array.isArray(rawUnits) && rawUnits.length === 265, 'placementList must contain exactly 265 apartment rows');
assert(catalog.officialTotalAtCapture === 265 && catalog.units?.length === 265, 'Catalog must contain exactly 265 apartments');
assert(catalog.mixedPropertyPlacementCount === 320, 'Mixed-property realEstateList count must remain 320');
assert(catalog.project === 'Yangi Baxt' && catalog.projectSlug === 'yangibaxt' && catalog.propertyType === 'Квартира', 'Catalog project identity mismatch');
assertDeep(
  { companyId: catalog.companyId, realEstateUUID: catalog.realEstateUUID, propertyTypeUUID: catalog.propertyTypeUUID },
  expectedIds,
  'Catalog IDs mismatch',
);
assert(catalog.capturedAt === sources.capturedAt && catalog.capturedAtUzt === sources.capturedAtUzt, 'Catalog capture timestamp mismatch');

const rawIds = rawUnits.map((unit) => unit.uuid);
const catalogIds = catalog.units.map((unit) => unit.id);
assert(new Set(rawIds).size === 265 && new Set(catalogIds).size === 265, 'Apartment UUIDs are not unique');
assertDeep(catalogIds, rawIds, 'Catalog UUID order differs from the frozen placementList');
assert(rawUnits.every((unit) => unit.realEstateUUID === expectedIds.realEstateUUID), 'placementList contains another real estate');
assert(rawUnits.every((unit) => unit.propertyType?.uuid === expectedIds.propertyTypeUUID && unit.propertyType?.name === 'Квартира'), 'placementList contains a non-apartment property type');
assert(new Set(rawUnits.map((unit) => `${unit.blockId}|${unit.entrance}|${unit.floor}|${unit.name}`)).size === 265, 'Duplicate group/entrance/floor/apartment-number key');
assert(catalog.integrity?.allApartmentPropertyType === true && catalog.integrity.uniqueUnitIds === 265 && catalog.integrity.uniqueMatrixKeys === 265, 'Catalog integrity summary mismatch');

const filterEstate = filterResponse.realEstates?.find((item) => item.uuid === expectedIds.realEstateUUID);
const listedEstate = estateResponse.realEstates?.find((item) => item.uuid === expectedIds.realEstateUUID);
assert(filterEstate && listedEstate, 'Yangi Baxt is absent from filter or realEstateList raw response');
assert(filterResponse.placementCount === 265, 'Apartment-scoped filter placementCount must be 265');
assert(listedEstate.placementCount === 320, 'realEstateList mixed-property placementCount must be 320');
assert(listedEstate.propertyTypes?.some((item) => item.uuid === expectedIds.propertyTypeUUID && item.name === 'Квартира'), 'realEstateList does not identify the apartment property type');
assert(listedEstate.propertyTypes?.length === 4, 'realEstateList must retain the four mixed property types');

const filterBlocks = new Map(filterEstate.blocks.map((block) => [block.id, block]));
const listedBlocks = new Map(listedEstate.blocks.map((block) => [block.id, block]));
const groupProjection = catalog.filterSummary.groups.map((group) => ({
  id: group.id,
  rawName: group.rawName,
  displayName: group.displayName,
  count: group.count,
  normalizedDeadline: group.normalizedDeadline,
  rawDeadline: group.sourcePlacementDeadlines?.[0],
  entrances: group.entrances.map(({ entrance, count, maxFloor }) => ({ entrance, count, maxFloor })),
}));
assertDeep(groupProjection, expectedGroups, 'Catalog group/deadline/entrance summary mismatch');
for (const expected of expectedGroups) {
  const rows = rawUnits.filter((unit) => unit.blockId === expected.id);
  assert(rows.length === expected.count && rows.every((unit) => unit.blockName === expected.rawName), `Raw group count/name mismatch: ${expected.rawName}`);
  assert(rows.every((unit) => unit.deadLine === expected.rawDeadline), `Raw placementList deadline mismatch: ${expected.rawName}`);
  const filtered = filterBlocks.get(expected.id);
  const listed = listedBlocks.get(expected.id);
  assert(filtered?.name === expected.rawName && filtered?.deadline === expected.normalizedDeadline && filtered?.count === expected.count, `filter group mismatch: ${expected.rawName}`);
  assert(listed?.name === expected.rawName && listed?.deadline === expected.normalizedDeadline, `realEstateList deadline mismatch: ${expected.rawName}`);
}
assertDeep(
  catalog.filterSummary.deadlines,
  expectedGroups.map((group) => ({ value: group.normalizedDeadline, count: group.count })),
  'Normalized deadline counts mismatch',
);

const expectedStableEntranceStructure = expectedGroups.flatMap((group) => group.entrances.map((entrance) => ({
  groupId: group.id,
  rawName: group.rawName,
  displayName: group.displayName,
  entrance: entrance.entrance,
  maxFloor: entrance.maxFloor,
  count: entrance.count,
})));
const catalogStableEntranceStructure = stableEntranceStructure(catalog.units);
const rawStableEntranceStructure = stableEntranceStructure(rawUnits, true);
assertDeep(catalogStableEntranceStructure, expectedStableEntranceStructure, 'Normalized stable matrix group/entrance/maxFloor/count structure mismatch');
assertDeep(rawStableEntranceStructure, expectedStableEntranceStructure, 'Raw stable matrix group/entrance/maxFloor/count structure mismatch');
assert(catalogStableEntranceStructure.length === expectedStableEntranceCount, 'Stable matrix must contain exactly 9 independent entrances');
assert(
  catalogStableEntranceStructure.reduce((total, entrance) => total + entrance.maxFloor, 0) === expectedStableFloorRows,
  'Stable matrix must render the full 1..maxFloor ranges totalling 108 floor rows',
);
assert(
  catalogStableEntranceStructure.reduce((total, entrance) => total + entrance.count, 0) === expectedStableUnitCells,
  'Stable matrix entrance structure must contain exactly 265 apartment cells',
);

const catalogMatrix = matrix(catalog.units);
const rawMatrix = matrix(rawUnits.map((unit) => ({
  buildingDisplay: expectedGroups.find((group) => group.rawName === unit.blockName)?.displayName,
  entrance: unit.entrance,
  floor: unit.floor,
})));
assert(catalogMatrix.split('\n').length === expectedOccupiedFloorRows, 'Catalog occupied-floor projection row count mismatch');
assert(sha256(catalogMatrix) === expectedOccupiedFloorProjectionSha256, 'Catalog occupied-floor projection mismatch');
assert(rawMatrix === catalogMatrix, 'Raw occupied-floor projection differs from normalized catalog projection');

const expectedStatusSummary = Object.fromEntries(Object.entries(expectedStatuses).sort(([left], [right]) => left.localeCompare(right, 'ru')));
assertDeep(statusCounts(catalog.units), expectedStatusSummary, 'Catalog workflow status/isSale matrix mismatch');
assertDeep(
  Object.fromEntries(catalog.statusSummary.map(({ value, count }) => [value, count]).sort(([left], [right]) => left.localeCompare(right, 'ru'))),
  Object.fromEntries(Object.entries(expectedStatuses).map(([status, value]) => [status, value.count]).sort(([left], [right]) => left.localeCompare(right, 'ru'))),
  'Catalog status summary mismatch',
);
assertDeep(
  statusCounts(rawUnits.map((unit) => ({ statusOriginal: unit.placementStatusName, isSale: unit.isSale }))),
  expectedStatusSummary,
  'Raw workflow status/isSale matrix mismatch',
);
assert(catalog.units.filter((unit) => unit.isSale).length === 264, 'isSale count must be 264');
const eligibleOffers = catalog.units.filter((unit) => unit.statusOriginal === 'Свободно' && unit.isSale);
assert(eligibleOffers.length === 63 && catalog.offerCount === 63, 'JSON-LD Offer eligibility count must be exactly 63');
assert(eligibleOffers.every((unit) => unit.promotion?.deadlineUtc), 'Every eligible JSON-LD Offer must have a campaign deadline');
assertDeep(
  countBy(eligibleOffers.map((unit) => unit.promotion.deadlineUtc)),
  { '2026-08-31T17:59:59.000+00:00': 63 },
  'Eligible JSON-LD Offer campaign deadline snapshot mismatch',
);
assert(catalog.units.filter((unit) => !unit.isSale).length === 1 && catalog.units.find((unit) => !unit.isSale)?.statusOriginal === 'Бронирование', 'The sole non-sale row must be the booking workflow row');

assertDeep(countBy(catalog.units.map((unit) => unit.rooms)), { 1: 69, 2: 90, 3: 105, 4: 1 }, 'Room counts mismatch');
assertDeep(catalog.filterSummary.repairIncluded, { true: 100, false: 165 }, 'Repair counts mismatch');
assertDeep(catalog.filterSummary.studio, { true: 167, false: 98 }, 'Studio counts mismatch');
assert(catalog.filterSummary.campaign.withCampaignPrice === 254 && catalog.filterSummary.campaign.rawFallback === 11, 'Campaign/fallback counts mismatch');
assertDeep(catalog.filterSummary.ranges.area, { min: 27.61, max: 116.27 }, 'Apartment area range mismatch');
assertDeep(catalog.filterSummary.ranges.floor, { min: 1, max: 16 }, 'Apartment floor range mismatch');

const capturedAtMs = Date.parse(catalog.capturedAt);
assert(Number.isFinite(capturedAtMs), 'Catalog capturedAt must be a valid timestamp');
let independentlyVerifiedCampaignPrices = 0;
let independentlyVerifiedRawFallbackPrices = 0;
for (let index = 0; index < catalog.units.length; index += 1) {
  const unit = catalog.units[index];
  const raw = rawUnits[index];
  assert(unit.id === raw.uuid && unit.sourceOrder === index, `Source ordering mismatch: ${unit.id}`);
  assert(unit.number === String(raw.name) && unit.rooms === raw.roomCount && unit.area === raw.square, `Core apartment fields mismatch: ${unit.id}`);
  assert(unit.floor === raw.floor && unit.totalFloors === raw.maxFloor && unit.entrance === raw.entrance, `Floor/entrance fields mismatch: ${unit.id}`);
  assert(unit.buildingId === raw.blockId && unit.building === raw.blockName && unit.sourcePlacementCompletionDate === raw.deadLine, `Raw group provenance mismatch: ${unit.id}`);
  assert(unit.statusOriginal === raw.placementStatusName && unit.statusId === raw.placementStatusId && unit.isSale === raw.isSale, `Status provenance mismatch: ${unit.id}`);
  assert(unit.oldPrice === raw.totalPrice && unit.currentPricePerM2 === Math.round(unit.price / unit.area), `Price provenance mismatch: ${unit.id}`);
  const rawCampaign = raw.discount?.stock?.data?.[0];
  const rawCampaignPrice = rawCampaign?.priceWithDiscount;
  const hasRawCampaignPrice = typeof rawCampaignPrice === 'number' && Number.isFinite(rawCampaignPrice) && rawCampaignPrice > 0;
  if (hasRawCampaignPrice) {
    independentlyVerifiedCampaignPrices += 1;
    assert(unit.priceSource === 'campaign-snapshot', `Campaign price source mismatch: ${unit.id}`);
    assert(unit.price === rawCampaignPrice, `Public campaign price differs from raw discount.stock.data[0].priceWithDiscount: ${unit.id}`);
    assert(unit.promotion?.priceWithDiscount === rawCampaignPrice, `Normalized campaign price provenance mismatch: ${unit.id}`);
    assert(unit.promotion?.deadlineUtc === raw.stock?.stockDeadline, `Campaign deadline differs from raw stock.stockDeadline: ${unit.id}`);
    const deadlineMs = Date.parse(unit.promotion.deadlineUtc);
    assert(Number.isFinite(deadlineMs), `Campaign deadline is not a valid timestamp: ${unit.id}`);
    assert(deadlineMs >= capturedAtMs, `Campaign deadline predates capturedAt: ${unit.id}`);
  } else {
    independentlyVerifiedRawFallbackPrices += 1;
    assert(unit.priceSource === 'raw-total-price-fallback', `Fallback price source mismatch: ${unit.id}`);
    assert(unit.promotion === null, `Fallback apartment unexpectedly exposes a normalized campaign: ${unit.id}`);
    assert(unit.price === raw.totalPrice, `Public fallback price differs from raw totalPrice: ${unit.id}`);
  }
}
assert(independentlyVerifiedCampaignPrices === 254, 'Independent campaign-priced apartment count must be 254');
assert(independentlyVerifiedRawFallbackPrices === 11, 'Independent raw-total-price fallback count must be 11');

assert(plans.project === 'Yangi Baxt' && plans.endpoint === 'https://apigw.bi.group/sales-picker/microfe-v3/placement', 'Plan manifest identity mismatch');
assert(plans.count === 265 && plans.items?.length === 265, 'Plan detail manifest must contain 265 records');
assert(plans.apartmentSheetExistCount === 265 && plans.page1Http200Count === 265 && plans.page2Http200Count === 265, 'Plan manifest summary must confirm 265 × 2 HTTP-200 sheets');
const catalogById = new Map(catalog.units.map((unit) => [unit.id, unit]));
const rawById = new Map(rawUnits.map((unit) => [unit.uuid, unit]));
const planIds = new Set();
const page1Urls = new Set();
const page2Urls = new Set();
const expectedPlanFiles = new Set();
const expectedFloorPositionFiles = new Set();
for (const item of plans.items) {
  assert(!planIds.has(item.unitId), `Duplicate plan manifest UUID: ${item.unitId}`);
  planIds.add(item.unitId);
  const unit = catalogById.get(item.unitId);
  const raw = rawById.get(item.unitId);
  assert(unit && raw, `Plan manifest references an unknown apartment: ${item.unitId}`);
  assert(item.unitNumber === String(raw.name), `Plan manifest apartment number mismatch: ${item.unitId}`);
  assert(item.endpoint === plans.endpoint && item.requestBody?.placementUUID === item.unitId, `Plan detail request provenance mismatch: ${item.unitId}`);
  assert(item.response?.httpStatus === 200 && item.response.contentType === 'application/json' && item.response.bytes > 0 && validHash(item.response.sha256), `Plan detail response provenance mismatch: ${item.unitId}`);
  assert(typeof item.response.serverDateUtc === 'string' && /GMT$/.test(item.response.serverDateUtc), `Plan detail server Date is missing: ${item.unitId}`);
  assert(item.apartmentSheetExist === true, `Official apartment sheet is not confirmed: ${item.unitId}`);
  assert(item.primaryLayoutSourceUrl === raw.photoURL1600, `Primary layout provenance mismatch: ${item.unitId}`);
  assert(!page1Urls.has(item.page1SourceUrl) && !page2Urls.has(item.page2SourceUrl), `Duplicate official apartment sheet URL: ${item.unitId}`);
  page1Urls.add(item.page1SourceUrl);
  page2Urls.add(item.page2SourceUrl);

  for (const [pageName, expectedType, directory, catalogField] of [
    ['page1', 'official-apartment-sheet-floor-position', 'floor-positions', 'floorPositionPlan'],
    ['page2', 'official-apartment-sheet-individual-plan', 'plans', 'plan'],
  ]) {
    const page = item[pageName];
    const sourceUrlField = `${pageName}SourceUrl`;
    const expectedPublicPath = `/yangibaxt/${directory}/${item.unitId}.webp`;
    const expectedRepoPath = `public${expectedPublicPath}`;
    assert(page?.materialType === expectedType && page.sourceUrl === item[sourceUrlField], `${pageName} classification/source mismatch: ${item.unitId}`);
    assert(page.source?.httpStatus === 200 && page.source.bytes > 0 && validHash(page.source.sha256), `${pageName} source hash/provenance mismatch: ${item.unitId}`);
    assert(page.source.contentType === 'image/jpeg' && page.source.detectedMime === 'image/jpeg', `${pageName} source format mismatch: ${item.unitId}`);
    assert(page.source.dimensions?.width > 0 && page.source.dimensions?.height > 0, `${pageName} source dimensions missing: ${item.unitId}`);
    assert(page.web?.publicPath === expectedPublicPath && page.web.repoPath === expectedRepoPath, `${pageName} local path mismatch: ${item.unitId}`);
    assert(page.web.format === 'WEBP' && page.web.mime === 'image/webp' && page.web.bytes > 0 && validHash(page.web.sha256), `${pageName} local hash/provenance mismatch: ${item.unitId}`);
    assert(page.web.dimensions?.width > 0 && page.web.dimensions?.height > 0, `${pageName} local dimensions missing: ${item.unitId}`);
    assert(unit[catalogField] === expectedPublicPath && unit.planSourceUrls[sourceUrlField === 'page1SourceUrl' ? 'apartmentSheetURLPage1' : 'apartmentSheetURLPage2'] === item[sourceUrlField], `Catalog/${pageName} mismatch: ${item.unitId}`);
    await verifyLocalFile(expectedRepoPath, page.web.bytes, page.web.sha256, `${pageName} ${item.unitId}`);
    (directory === 'plans' ? expectedPlanFiles : expectedFloorPositionFiles).add(`${item.unitId}.webp`);
  }
}
assert(planIds.size === 265 && page1Urls.size === 265 && page2Urls.size === 265, 'Plan UUID/source URL uniqueness mismatch');
assert(planIds.size === catalogById.size && [...catalogById.keys()].every((id) => planIds.has(id)), 'Plan manifest does not cover every catalog apartment');
assertDeep(await listFiles('public/yangibaxt/plans', '.webp'), [...expectedPlanFiles].sort(), 'Local individual-plan file set differs from the 265-row manifest');
assertDeep(await listFiles('public/yangibaxt/floor-positions', '.webp'), [...expectedFloorPositionFiles].sort(), 'Local floor-position file set differs from the 265-row manifest');

assert(media.project === 'Yangi Baxt' && media.visualAssets?.length === 25, 'Media manifest must contain exactly 25 Yangi Baxt visuals');
assertDeep(countBy(media.visualAssets.map((asset) => asset.materialType)), { 'real-photo': 15, 'cgi-concept': 6, 'construction-photo': 4 }, 'Media classification counts mismatch');
const mediaIds = new Set();
const sourceMediaUrls = new Set();
const expectedMediaFiles = new Set();
const publicAssetManifestPaths = new Set();
for (const asset of media.visualAssets) {
  assert(Object.hasOwn(expectedMediaTypes, asset.id), `Unexpected media asset ID: ${asset.id}`);
  assert(!mediaIds.has(asset.id) && !sourceMediaUrls.has(asset.sourceUrl), `Duplicate media identity/source: ${asset.id}`);
  mediaIds.add(asset.id);
  sourceMediaUrls.add(asset.sourceUrl);
  assert(asset.materialType === expectedMediaTypes[asset.id], `Media classification mismatch: ${asset.id}`);
  assert(asset.sourceUrl.startsWith('https://s3.bi.group/'), `Media source is not an official BI asset URL: ${asset.id}`);
  assert(typeof asset.requiredVisibleDisclosure === 'string' && asset.requiredVisibleDisclosure.length > 0, `Media disclosure is missing: ${asset.id}`);
  assert(asset.source?.httpStatus === 200 && asset.source.bytes > 0 && validHash(asset.source.sha256), `Media source provenance mismatch: ${asset.id}`);
  assert(asset.source.contentType?.startsWith('image/') && asset.source.dimensions?.width > 0 && asset.source.dimensions?.height > 0, `Media source format/dimensions mismatch: ${asset.id}`);
  const expectedPublicPath = `/yangibaxt/images/${asset.id}.webp`;
  const expectedRepoPath = `public${expectedPublicPath}`;
  assert(asset.web?.publicPath === expectedPublicPath && asset.web.repoPath === expectedRepoPath, `Media local path mismatch: ${asset.id}`);
  assert(asset.web.format === 'WEBP' && asset.web.mime === 'image/webp' && asset.web.bytes > 0 && validHash(asset.web.sha256), `Media local provenance mismatch: ${asset.id}`);
  await verifyLocalFile(expectedRepoPath, asset.web.bytes, asset.web.sha256, `media ${asset.id}`);
  expectedMediaFiles.add(`${asset.id}.webp`);
  publicAssetManifestPaths.add(expectedPublicPath);
}
assert(mediaIds.size === Object.keys(expectedMediaTypes).length && Object.keys(expectedMediaTypes).every((id) => mediaIds.has(id)), 'Media manifest ID set mismatch');
assertDeep(await listFiles('public/yangibaxt/images', '.webp'), [...expectedMediaFiles].sort(), 'Local Yangi Baxt image file set differs from the 25-item manifest');

const booklet = media.booklet;
assert(booklet.sourceUrl === expectedBooklet.sourceUrl && sources.official.booklet === expectedBooklet.sourceUrl, 'Booklet source URL mismatch');
assert(booklet.sourceRepoPath === expectedBooklet.sourceRepoPath && booklet.repoPath === expectedBooklet.repoPath && booklet.publicPath === expectedBooklet.publicPath, 'Booklet local path mismatch');
assert(booklet.classification === 'official-booklet' && booklet.pages === expectedBooklet.pages && booklet.expectedPages === expectedBooklet.pages, 'Booklet classification/page count mismatch');
assert(booklet.bytes === expectedBooklet.bytes && booklet.expectedBytes === expectedBooklet.bytes, 'Booklet byte provenance mismatch');
assert(booklet.sha256 === expectedBooklet.sha256 && booklet.expectedSha256 === expectedBooklet.sha256, 'Booklet SHA-256 provenance mismatch');
await verifyLocalFile(expectedBooklet.sourceRepoPath, expectedBooklet.bytes, expectedBooklet.sha256, 'source official booklet');
await verifyLocalFile(expectedBooklet.repoPath, expectedBooklet.bytes, expectedBooklet.sha256, 'public official booklet');
publicAssetManifestPaths.add(expectedBooklet.publicPath);
for (const item of plans.items) {
  publicAssetManifestPaths.add(item.page1.web.publicPath);
  publicAssetManifestPaths.add(item.page2.web.publicPath);
}

const sourceFiles = await collectSourceFiles('app/yangibaxt');
sourceFiles.push('app/privacy/page.tsx');
const localAssetPattern = /\/yangibaxt\/(?:images|documents|plans|floor-positions)\/[A-Za-z0-9._+-]+/g;
const referencedAssets = new Set();
for (const sourceFile of sourceFiles) {
  const text = await readFile(repoPath(sourceFile), 'utf8');
  for (const match of text.matchAll(localAssetPattern)) referencedAssets.add(match[0]);
}
assert(referencedAssets.size > 0, 'No local Yangi Baxt assets are referenced by route source');
for (const publicPath of referencedAssets) {
  assert(publicAssetManifestPaths.has(publicPath), `Route references an asset absent from frozen manifests: ${publicPath}`);
  await readFile(repoPath(publicToRepoPath(publicPath)));
}
for (const unit of catalog.units) {
  assert(publicAssetManifestPaths.has(unit.plan) && publicAssetManifestPaths.has(unit.floorPositionPlan), `Catalog references an unmanifested unit asset: ${unit.id}`);
}

const landingRoutePath = 'app/yangibaxt/page.tsx';
const catalogRoutePath = 'app/yangibaxt/apartments/page.tsx';
const catalogUiPath = 'app/yangibaxt/apartments/yangibaxt-catalog.tsx';
const leadHelperPath = 'app/yangibaxt/yangibaxt-lead.ts';
const leadRoutePath = 'app/api/yangibaxt-lead/route.ts';
const privacyPath = 'app/privacy/page.tsx';
const sitemapPath = 'app/sitemap.ts';
const packagePath = 'package.json';
const [landingRoute, catalogRoute, catalogUi, leadHelper, leadRoute, privacyRoute, sitemap, packageJson] = await Promise.all([
  readFile(repoPath(landingRoutePath), 'utf8'),
  readFile(repoPath(catalogRoutePath), 'utf8'),
  readFile(repoPath(catalogUiPath), 'utf8'),
  readFile(repoPath(leadHelperPath), 'utf8'),
  readFile(repoPath(leadRoutePath), 'utf8'),
  readFile(repoPath(privacyPath), 'utf8'),
  readFile(repoPath(sitemapPath), 'utf8'),
  readJson(packagePath),
]);

for (const [text, relativePath, route] of [
  [landingRoute, landingRoutePath, '/yangibaxt'],
  [catalogRoute, catalogRoutePath, '/yangibaxt/apartments'],
]) {
  assertTokens(text, relativePath, [
    'generateMetadata', 'alternates', 'canonical', 'openGraph', 'twitter',
    "'ru-RU'", "'uz-UZ'", "'x-default'", 'inLanguage',
    'application/ld+json', 'BreadcrumbList', `${route}?lang=`,
    '/yangibaxt/images/hero-real.webp',
  ]);
}
assertTokens(landingRoute, landingRoutePath, ["'@type': 'ApartmentComplex'", "'@type': 'PostalAddress'"]);
assertTokens(catalogRoute, catalogRoutePath, [
  "'@type': 'ItemList'", "'@type': 'Apartment'", "'@type': 'Offer'", 'numberOfItems', 'dateModified', 'priceCurrency',
  'priceValidUntil: unit.promotion?.deadlineUtc',
]);
assert(
  /unit\.statusOriginal\s*===\s*['"]Свободно['"]\s*&&\s*unit\.isSale|unit\.isSale\s*&&\s*unit\.statusOriginal\s*===\s*['"]Свободно['"]/.test(catalogRoute),
  `${catalogRoutePath} does not restrict JSON-LD Offer to Свободно && isSale`,
);

assertTokens(catalogUi, catalogUiPath, [
  'type Mode = "cards" | "chess"', 'const modes: Mode[] = ["cards", "chess"]',
  'priceAsc', 'priceDesc', 'areaAsc', 'areaDesc', 'floorAsc', 'floorDesc', 'roomsAsc', 'roomsDesc', 'ppmAsc', 'ppmDesc',
  'rooms:', 'areaFrom:', 'areaTo:', 'priceFrom:', 'priceTo:', 'floor:', 'building:', 'entrance:', 'status:', 'completion:', 'repair:', 'studio:',
  'projectSlug=yangibaxt', 'unitUuid=', 'rememberLastViewedApartment', 'role="tablist"', 'aria-modal', 'event.key === "ArrowLeft"', 'event.key === "ArrowRight"', 'event.key === "Home"', 'event.key === "End"',
  "loading=\"lazy\"", 'Карточки', 'Шахматка', 'Kartalar', 'Shaxmatka', 'Cards', 'Matrix',
]);
assert(!catalogUi.includes('chess-plus') && !catalogUi.includes('Matrix+'), `${catalogUiPath} contains a duplicate matrix mode`);
assert(!/floor-plan|floorPlanMode|План этажа/.test(catalogUi), `${catalogUiPath} contains the forbidden floor-plan catalog mode`);

assertTokens(leadHelper, leadHelperPath, ['NEXT_PUBLIC_APP_BASE_PATH', "replace(/^\\/+|\\/+$/g, '')", '/v1/leads', "process.env.NODE_ENV !== 'production'", '/api/yangibaxt-lead']);
assert(!leadHelper.includes('NEXT_PUBLIC_CATALOG_API_URL'), `${leadHelperPath} must never send production browser leads directly to the backend`);
assertTokens(leadRoute, leadRoutePath, [
  "process.env.NODE_ENV === 'production'", 'local_receipt_disabled', '404', "payload.projectSlug !== 'yangibaxt'", 'projectSlug=yangibaxt', 'unitUuid=',
  'exactViewed', "receipt: 'development-only'", 'stored: false', 'forwarded: false', 'readLeadJson<Payload>', 'leadJson as json',
]);
assertTokens(privacyRoute, privacyPath, [
  'yangiBaxtCopy', "project === 'yangibaxt'", 'project=yangibaxt&lang=', '/yangibaxt/apartments?lang=', "params?.from === 'catalog'", 'generateMetadata', 'alternates', 'openGraph', 'twitter', 'tel:+998781137712',
]);
assertTokens(sitemap, sitemapPath, ["'yangibaxt'", 'projectRoutes', '`/${project}`', '`/${project}/apartments`', "['ru', 'uz', 'en']", "'ru-RU'", "'uz-UZ'", "'x-default'"]);
assert(packageJson.scripts?.['build:yangibaxt-catalog'] === 'node scripts/build-yangibaxt-catalog.mjs', 'package.json build:yangibaxt-catalog script mismatch');
assert(packageJson.scripts?.['verify:yangibaxt'] === 'node scripts/verify-yangibaxt-catalog.mjs', 'package.json verify:yangibaxt script mismatch');

console.log('Yangi Baxt integrity OK: deterministic 265-apartment snapshot, 63 eligible Offers, stable matrix structure with 9 entrances / 108 full floor rows / 265 apartment cells plus an exact 76-row occupied-floor projection, 265 × 2 official local sheets, 25 classified official visuals, 3 byte-frozen API responses, 33-page booklet, routes/SEO/privacy/sitemap verified.');
