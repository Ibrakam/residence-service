import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const dataRoot = resolve(websiteRoot, 'data');
const catalogPath = resolve(dataRoot, 'bayterak-catalog.json');
const rawPlacementPath = resolve(dataRoot, 'bayterak-placement-raw.json');
const rawFilterPath = resolve(dataRoot, 'bayterak-filter-raw.json');
const rawEstatePath = resolve(dataRoot, 'bayterak-real-estate-raw.json');
const layoutManifestPath = resolve(dataRoot, 'bayterak-layout-sources.json');
const sourceManifestPath = resolve(dataRoot, 'bayterak-sources.json');

const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateUUID = '56d93ca4-d70e-407c-ba5b-21c631a538c2';
const propertyTypeUUID = '5990a172-812a-4fee-b4f5-c860cca824d7';
const placementListUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placementList';
const filterUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/filter';
const realEstateListUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/realEstateList';
const landingRu = 'https://nrg-bi.uz/uz-ru/landing/bayterak';
const officialCatalog = `https://nrg-bi.uz/uz-ru/filter/placements?companyIds=[%22${companyId}%22]&realEstateUUIDs=[%22${realEstateUUID}%22]&propertyTypes=[%22${propertyTypeUUID}%22]&filterTags={}`;

// HTTP response dates and request timing are frozen provenance from the checked-in capture.
// The offline rebuild never replaces them with the current time.
const frozenCapture = {
  requestStartedAtUzt: '2026-08-30T14:18:11+05:00',
  requestCompletedAtUzt: '2026-08-30T14:18:28+05:00',
  httpStatus: 200,
  serverDates: {
    placementList: 'Sun, 30 Aug 2026 09:18:22 GMT',
    filter: 'Sun, 30 Aug 2026 09:25:21 GMT',
    realEstateList: 'Sun, 30 Aug 2026 09:24:58 GMT',
  },
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function unique(values) {
  return [...new Set(values)];
}

function numericCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([value, count]) => ({ value, count }));
}

function stringCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([value, count]) => ({ value, count }));
}

function toUzt(isoUtc) {
  const date = new Date(isoUtc);
  if (Number.isNaN(date.valueOf())) fail(`Invalid frozen capture timestamp: ${isoUtc}`);
  return new Date(date.valueOf() + 5 * 60 * 60 * 1000)
    .toISOString()
    .replace('.000Z', '+05:00');
}

function classDisplay(value) {
  if (value === 'Бизнес') return 'Business';
  if (value === 'Комфорт+') return 'Comfort+';
  fail(`Unexpected property class in frozen placementList: ${value}`);
}

function blockDisplay(value) {
  if (/businees/i.test(value)) return 'Bayterak Business — 1';
  if (/comfort/i.test(value)) return 'Bayterak Comfort+ — 1';
  const phase = value.match(/bayterak\s*-?\s*(\d+)/i)?.[1];
  if (phase) return `Bayterak — ${phase}`;
  fail(`Unexpected Bayterak block name: ${value}`);
}

function parseJson(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function buildBayterakCatalog() {
  const [rawPlacement, rawFilter, rawEstate, layoutBuffer, sourceBuffer] = await Promise.all([
    readFile(rawPlacementPath),
    readFile(rawFilterPath),
    readFile(rawEstatePath),
    readFile(layoutManifestPath),
    readFile(sourceManifestPath),
  ]);
  const placementResponse = parseJson(rawPlacement, 'bayterak-placement-raw.json');
  const filterResponse = parseJson(rawFilter, 'bayterak-filter-raw.json');
  const estateResponse = parseJson(rawEstate, 'bayterak-real-estate-raw.json');
  const layouts = parseJson(layoutBuffer, 'bayterak-layout-sources.json');
  const sources = parseJson(sourceBuffer, 'bayterak-sources.json');
  const expectedCount = sources.catalog?.officialTotalAtCapture;
  const expectedHashes = {
    placementList: sources.catalog?.placementListSha256,
    filter: sources.catalog?.filterSha256,
    realEstateList: sources.catalog?.realEstateListSha256,
  };

  if (!Number.isInteger(expectedCount) || expectedCount <= 0) fail('Source manifest has no frozen apartment count');
  for (const [name, expected] of Object.entries(expectedHashes)) {
    if (!/^[a-f0-9]{64}$/.test(expected ?? '')) fail(`Source manifest has no frozen ${name} SHA-256`);
  }
  if (sha256(rawPlacement) !== expectedHashes.placementList) fail('Frozen placementList SHA-256 mismatch');
  if (sha256(rawFilter) !== expectedHashes.filter) fail('Frozen filter SHA-256 mismatch');
  if (sha256(rawEstate) !== expectedHashes.realEstateList) fail('Frozen realEstateList SHA-256 mismatch');

  const placements = placementResponse.placements;
  if (!Array.isArray(placements) || placements.length !== expectedCount) {
    fail(`Expected ${expectedCount} frozen placement rows, found ${placements?.length ?? 0}`);
  }
  if (placements.some((unit) => unit.propertyType?.uuid !== propertyTypeUUID)) fail('Non-apartment property type in frozen placementList');
  if (placements.some((unit) => unit.realEstateUUID !== realEstateUUID)) fail('Unexpected real-estate UUID in frozen placementList');
  if (new Set(placements.map((unit) => unit.uuid)).size !== expectedCount) fail('Frozen placement UUIDs are not unique');
  if (new Set(placements.map((unit) => unit.photoURL1600)).size !== expectedCount) fail('Frozen primary plan URLs are not unique');
  if (placements.some((unit) => !unit.isSale)) fail('Frozen placementList unexpectedly contains isSale=false');

  if (layouts.count !== expectedCount || layouts.items?.length !== expectedCount) fail('Layout manifest count does not match frozen placement count');
  const layoutById = new Map(layouts.items.map((item) => [item.unitId, item]));
  if (layoutById.size !== expectedCount) fail('Layout manifest unit IDs are not unique');

  const filterEstate = filterResponse.realEstates?.find((item) => item.uuid === realEstateUUID);
  const estate = estateResponse.realEstates?.find((item) => item.uuid === realEstateUUID);
  if (!filterEstate || !estate) fail('Bayterak is missing from frozen filter/realEstateList');
  const filterBlocks = new Map(filterEstate.blocks.map((block) => [block.id, block]));
  const estateBlocks = new Map(estate.blocks.map((block) => [block.id, block]));
  for (const blockId of unique(placements.map((unit) => unit.blockId))) {
    const filterBlock = filterBlocks.get(blockId);
    const estateBlock = estateBlocks.get(blockId);
    if (!filterBlock?.deadline || !estateBlock?.deadline) fail(`Normalized deadline missing for block ${blockId}`);
    if (filterBlock.deadline !== estateBlock.deadline) fail(`filter/realEstateList deadline mismatch for block ${blockId}`);
  }

  const capturedAt = sources.capturedAt;
  if (typeof capturedAt !== 'string') fail('Source manifest has no frozen capture timestamp');
  const units = placements.map((source) => {
    const campaign = source.discount?.stock?.data?.[0];
    const layout = layoutById.get(source.uuid);
    const normalizedBlock = filterBlocks.get(source.blockId);
    if (!campaign || typeof campaign.priceWithDiscount !== 'number') fail(`Campaign price missing for ${source.uuid}`);
    if (!layout) fail(`Local layout manifest row missing for ${source.uuid}`);
    if (layout.sourceUrl !== source.photoURL1600) fail(`Layout source URL mismatch for ${source.uuid}`);
    if (String(layout.unitNumber) !== String(source.name)) fail(`Layout unit number mismatch for ${source.uuid}`);
    if (!layout.local?.startsWith('/bayterak/plans/')) fail(`Invalid local layout path for ${source.uuid}`);
    return {
      id: source.uuid,
      number: String(source.name),
      rooms: source.roomCount,
      area: source.square,
      price: campaign.priceWithDiscount,
      oldPrice: source.totalPrice,
      totalPriceWithDiscountRaw: source.totalPriceWithDiscount,
      currentPricePerM2: Math.round(campaign.priceWithDiscount / source.square),
      sourcePricePerM2: source.priceBySquare,
      currency: 'UZS',
      promotion: {
        percent: campaign.percent,
        name: campaign.name,
        deadlineUtc: source.stock?.stockDeadline ?? null,
        discountSum: campaign.discountSum,
        priceWithDiscount: campaign.priceWithDiscount,
      },
      floor: source.floor,
      totalFloors: source.maxFloor,
      entrance: source.entrance,
      buildingId: source.blockId,
      building: source.blockName,
      buildingDisplay: blockDisplay(source.blockName),
      propertyClass: classDisplay(source.propertyClassName?.[0]),
      completionDate: normalizedBlock.deadline,
      sourcePlacementCompletionDate: source.deadLine,
      plan: layout.local,
      statusOriginal: source.placementStatusName,
      statusId: source.placementStatusId,
      isSale: source.isSale,
      repairIncluded: source.isRepaired,
      repairPrice: source.repairPrice,
      repairSum: source.repairSum,
      studio: source.isStudio,
      balconyArea: source.balconySquare,
      ceilingHeight: source.heightOfWall,
      planSourceUrls: {
        photoURL1600: source.photoURL1600,
        photoURL400: source.photoURL400,
        photoURL200: source.photoURL200,
        primary1600: source.photoURL1600,
        preview400: source.photoURL400,
        preview200: source.photoURL200,
      },
      provenance: {
        endpoint: placementListUrl,
        capturedAt,
        sourceUuid: source.uuid,
        sourceBlockId: source.blockId,
        sourceBlockName: source.blockName,
        sourcePropertyTypeId: source.propertyType.uuid,
        sourcePropertyTypeName: source.propertyType.name,
        sourceRealEstateUuid: source.realEstateUUID,
        sourceRealEstateName: source.realEstateName,
      },
    };
  });

  const blockIds = unique(placements.map((unit) => unit.blockId));
  const blocks = blockIds.map((blockId) => {
    const blockUnits = units.filter((unit) => unit.buildingId === blockId);
    const sourceBlock = filterBlocks.get(blockId);
    return {
      id: blockId,
      sourceName: sourceBlock.name,
      displayName: blockDisplay(sourceBlock.name),
      count: blockUnits.length,
      sourcePlacementDeadline: unique(blockUnits.map((unit) => unit.sourcePlacementCompletionDate)).sort(),
      normalizedDeadline: sourceBlock.deadline,
      classes: unique(blockUnits.map((unit) => unit.propertyClass)).sort((left, right) => left.localeCompare(right, 'en')),
      totalFloors: unique(blockUnits.map((unit) => unit.totalFloors)).sort((left, right) => left - right),
      entrances: unique(blockUnits.map((unit) => unit.entrance)).sort((left, right) => left - right),
    };
  });

  const statuses = new Map();
  for (const unit of units) {
    const existing = statuses.get(unit.statusOriginal);
    if (existing && existing.id !== unit.statusId) fail(`Conflicting workflow status IDs for ${unit.statusOriginal}`);
    const status = existing ?? { id: unit.statusId, status: unit.statusOriginal, sourceName: unit.statusOriginal, count: 0, isSaleCount: 0 };
    status.count += 1;
    if (unit.isSale) status.isSaleCount += 1;
    statuses.set(unit.statusOriginal, status);
  }
  const statusSummary = [...statuses.values()].sort((left, right) => right.count - left.count || left.status.localeCompare(right.status, 'ru'));
  const min = (field) => Math.min(...units.map((unit) => unit[field]));
  const max = (field) => Math.max(...units.map((unit) => unit[field]));

  return {
    project: 'Bayterak',
    companyId,
    realEstateUUID,
    propertyTypeUUID,
    propertyType: 'Квартира',
    source: officialCatalog,
    sourceLanding: landingRu,
    capturedAt,
    capturedAtUzt: toUzt(capturedAt),
    officialTotalAtCapture: expectedCount,
    currency: 'UZS',
    selectionMethod: 'All apartment rows returned by one internally consistent official placementList capture; office property type excluded by request UUID.',
    sourceApis: {
      placementList: { method: 'POST', url: placementListUrl, serverDateUtc: frozenCapture.serverDates.placementList, sha256: expectedHashes.placementList },
      filter: { method: 'POST', url: filterUrl, serverDateUtc: frozenCapture.serverDates.filter, sha256: expectedHashes.filter },
      realEstateList: { method: 'POST', url: realEstateListUrl, serverDateUtc: frozenCapture.serverDates.realEstateList, sha256: expectedHashes.realEstateList },
    },
    integrity: {
      rawPlacementListBytes: rawPlacement.byteLength,
      rawPlacementListSha256: expectedHashes.placementList,
      requestStartedAtUzt: frozenCapture.requestStartedAtUzt,
      requestCompletedAtUzt: frozenCapture.requestCompletedAtUzt,
      httpStatus: frozenCapture.httpStatus,
      uniqueUnitIds: new Set(units.map((unit) => unit.id)).size,
      uniquePrimaryPlanUrls: new Set(units.map((unit) => unit.planSourceUrls.primary1600)).size,
      allApartmentPropertyType: placements.every((unit) => unit.propertyType.uuid === propertyTypeUUID),
      allIsSale: units.every((unit) => unit.isSale),
      allRawTotalPriceWithDiscountEqualsTotalPrice: placements.every((unit) => unit.totalPriceWithDiscount === unit.totalPrice),
    },
    filterSummary: {
      blocks,
      rooms: unique(units.map((unit) => unit.rooms)).sort((left, right) => left - right),
      roomCounts: numericCounts(units.map((unit) => unit.rooms)),
      ranges: {
        area: { min: min('area'), max: max('area') },
        currentCampaignPrice: { min: min('price'), max: max('price') },
        sourceTotalPrice: { min: min('oldPrice'), max: max('oldPrice') },
        sourcePricePerM2: { min: min('sourcePricePerM2'), max: max('sourcePricePerM2') },
        floor: { min: min('floor'), max: max('floor') },
      },
      entrances: unique(units.map((unit) => unit.entrance)).sort((left, right) => left - right),
      entranceCounts: numericCounts(units.map((unit) => unit.entrance)),
      totalFloors: numericCounts(units.map((unit) => unit.totalFloors)),
      classes: stringCounts(units.map((unit) => unit.propertyClass)),
      repairIncluded: {
        true: units.filter((unit) => unit.repairIncluded).length,
        false: units.filter((unit) => !unit.repairIncluded).length,
      },
      studio: {
        true: units.filter((unit) => unit.studio).length,
        false: units.filter((unit) => !unit.studio).length,
      },
      promotion: {
        percents: unique(units.map((unit) => unit.promotion.percent)),
        stockNames: unique(units.map((unit) => unit.promotion.name)),
        deadlinesUtc: unique(units.map((unit) => unit.promotion.deadlineUtc)),
      },
    },
    statusSummary,
    units,
  };
}

function parseArguments(args) {
  let check = false;
  let output = catalogPath;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--check') {
      check = true;
    } else if (argument === '--output') {
      const value = args[index + 1];
      if (!value) fail('--output requires a path');
      output = resolve(process.cwd(), value);
      index += 1;
    } else if (argument.startsWith('--output=')) {
      output = resolve(process.cwd(), argument.slice('--output='.length));
    } else {
      fail(`Unknown argument: ${argument}`);
    }
  }
  if (check && output !== catalogPath) fail('--check and --output cannot be combined');
  return { check, output };
}

async function main() {
  const { check, output } = parseArguments(process.argv.slice(2));
  const catalog = await buildBayterakCatalog();
  const serialized = `${JSON.stringify(catalog, null, 2)}\n`;
  if (check) {
    const checkedIn = parseJson(await readFile(catalogPath), 'bayterak-catalog.json');
    if (!isDeepStrictEqual(catalog, checkedIn)) fail('Checked-in Bayterak catalog differs from deterministic offline rebuild');
    console.log(`Bayterak offline rebuild matches the checked-in ${catalog.officialTotalAtCapture}-unit snapshot (${catalog.capturedAt}).`);
    return;
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized);
  console.log(`Rebuilt ${catalog.officialTotalAtCapture} Bayterak apartments offline from frozen raw files (${catalog.capturedAt}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
