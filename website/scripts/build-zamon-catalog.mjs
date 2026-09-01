import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const dataRoot = resolve(websiteRoot, 'data');
const catalogPath = resolve(dataRoot, 'zamon-catalog.json');
const placementPath = resolve(dataRoot, 'zamon-placement-raw.json');
const filterPath = resolve(dataRoot, 'zamon-filter-raw.json');
const estatePath = resolve(dataRoot, 'zamon-real-estate-raw.json');
const planManifestPath = resolve(dataRoot, 'zamon-plan-sources.json');
const sourceManifestPath = resolve(dataRoot, 'zamon-sources.json');

const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateUUID = '58e48f7d-dd1c-11ed-a82c-001dd8b726aa';
const propertyTypeUUID = '5990a172-812a-4fee-b4f5-c860cca824d7';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message) {
  throw new Error(message);
}

function parse(buffer, label) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function unique(values) {
  return [...new Set(values)];
}

function counts(values, numeric = false) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return [...result.entries()]
    .sort(([left], [right]) => numeric ? Number(left) - Number(right) : String(left).localeCompare(String(right), 'ru'))
    .map(([value, count]) => ({ value, count }));
}

function countObject(values) {
  return Object.fromEntries(counts(values).map(({ value, count }) => [String(value), count]));
}

function assertObject(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) fail(`${label} mismatch: ${JSON.stringify(actual)}`);
}

function displayBlock(value) {
  if (value === 'NRG Zamon 2-2') return 'Zamon 2-2';
  if (value === 'NRG Zamon 3 - 1') return 'Zamon 3-1';
  fail(`Unexpected Zamon block: ${value}`);
}

function min(units, key) {
  return Math.min(...units.map((unit) => unit[key]));
}

function max(units, key) {
  return Math.max(...units.map((unit) => unit[key]));
}

export async function buildZamonCatalog() {
  const [placementBuffer, filterBuffer, estateBuffer, planBuffer, sourceBuffer] = await Promise.all([
    readFile(placementPath), readFile(filterPath), readFile(estatePath), readFile(planManifestPath), readFile(sourceManifestPath),
  ]);
  const placementResponse = parse(placementBuffer, 'zamon-placement-raw.json');
  const filterResponse = parse(filterBuffer, 'zamon-filter-raw.json');
  const estateResponse = parse(estateBuffer, 'zamon-real-estate-raw.json');
  const plans = parse(planBuffer, 'zamon-plan-sources.json');
  const sources = parse(sourceBuffer, 'zamon-sources.json');
  const expectedCount = sources.catalog?.officialTotalAtCapture;

  if (expectedCount !== 104) fail(`Expected source manifest count 104, found ${expectedCount}`);
  for (const [name, buffer] of [['placementList', placementBuffer], ['filter', filterBuffer], ['realEstateList', estateBuffer]]) {
    const record = sources.catalog?.[name];
    if (!record || record.bytes !== buffer.byteLength || record.sha256 !== sha256(buffer)) fail(`${name} frozen bytes or SHA-256 mismatch`);
  }

  const placements = placementResponse.placements;
  if (!Array.isArray(placements) || placements.length !== expectedCount) fail(`Expected ${expectedCount} placements, found ${placements?.length ?? 0}`);
  if (new Set(placements.map((unit) => unit.uuid)).size !== expectedCount) fail('Placement UUIDs are not unique');
  if (new Set(placements.map((unit) => unit.photoURL1600)).size !== expectedCount) fail('Primary plan URLs are not unique');
  if (placements.some((unit) => unit.realEstateUUID !== realEstateUUID)) fail('Unexpected real-estate UUID');
  if (placements.some((unit) => unit.propertyType?.uuid !== propertyTypeUUID)) fail('Non-apartment property type in placementList');

  assertObject(countObject(placements.map((unit) => unit.placementStatusName)), { 'Бронирование': 1, 'Расторжение': 7, 'Свободно': 93, 'Снятие резерва': 3 }, 'Workflow statuses');
  assertObject(countObject(placements.map((unit) => unit.isSale)), { false: 1, true: 103 }, 'isSale distribution');
  assertObject(countObject(placements.map((unit) => unit.roomCount)), { 1: 35, 2: 42, 3: 4, 4: 22, 5: 1 }, 'Room distribution');
  assertObject(countObject(placements.map((unit) => unit.blockName)), { 'NRG Zamon 2-2': 42, 'NRG Zamon 3 - 1': 62 }, 'Block distribution');
  assertObject(countObject(placements.map((unit) => unit.isStudio)), { false: 76, true: 28 }, 'Studio distribution');
  if (placements.some((unit) => unit.isRepaired !== false)) fail('Unexpected repaired apartment');
  if (placements.some((unit) => unit.heightOfWall !== 'Не менее 2,85 м')) fail('Unexpected placement ceiling value');
  if (placements.some((unit) => unit.discount?.stock?.data?.[0]?.percent !== 12)) fail('Unexpected campaign percent');
  if (placements.some((unit) => unit.discount?.stock?.data?.[0]?.name !== 'Станд. условия 2026. Кв. 100%/ Рассрочка')) fail('Unexpected campaign name');
  if (placements.some((unit) => unit.stock?.stockDeadline !== '2026-12-31T17:59:59.000+00:00')) fail('Unexpected campaign deadline');

  if (plans.count !== expectedCount || plans.items?.length !== expectedCount || !plans.allHttp200) fail('Plan manifest count or HTTP status mismatch');
  const planById = new Map(plans.items.map((item) => [item.unitId, item]));
  if (planById.size !== expectedCount) fail('Plan manifest unit IDs are not unique');

  const filterEstate = filterResponse.realEstates?.find((estate) => estate.uuid === realEstateUUID);
  const estate = estateResponse.realEstates?.find((item) => item.uuid === realEstateUUID);
  if (!filterEstate || !estate) fail('Zamon is missing from filter or realEstateList');
  if (filterResponse.placementCount !== expectedCount) fail('filter placementCount mismatch');
  const filterBlocks = new Map(filterEstate.blocks.map((block) => [block.id, block]));
  const estateBlocks = new Map(estate.blocks.map((block) => [block.id, block]));
  for (const blockId of unique(placements.map((unit) => unit.blockId))) {
    const filterBlock = filterBlocks.get(blockId);
    const estateBlock = estateBlocks.get(blockId);
    if (!filterBlock?.deadline || filterBlock.deadline !== estateBlock?.deadline) fail(`Normalized deadline mismatch for ${blockId}`);
  }

  const units = placements.map((source, sourceOrder) => {
    const campaign = source.discount?.stock?.data?.[0];
    const plan = planById.get(source.uuid);
    const block = filterBlocks.get(source.blockId);
    if (!campaign || typeof campaign.priceWithDiscount !== 'number') fail(`Campaign price missing for ${source.uuid}`);
    if (!plan || plan.sourceUrl !== source.photoURL1600 || plan.unitNumber !== String(source.name)) fail(`Plan manifest mismatch for ${source.uuid}`);
    if (plan.web?.intendedPublicPath !== `/zamon/plans/${source.uuid}.webp`) fail(`Invalid local plan path for ${source.uuid}`);
    return {
      id: source.uuid,
      sourceOrder,
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
        deadlineUtc: source.stock.stockDeadline,
        stockId: source.stock.stockId,
        stockName: source.stock.stockName,
        discountSum: campaign.discountSum,
        priceWithDiscount: campaign.priceWithDiscount,
      },
      floor: source.floor,
      totalFloors: source.maxFloor,
      entrance: source.entrance,
      buildingId: source.blockId,
      building: source.blockName,
      buildingDisplay: displayBlock(source.blockName),
      propertyClass: 'Comfort',
      completionDate: block.deadline,
      sourcePlacementCompletionDate: source.deadLine,
      plan: plan.web.intendedPublicPath,
      statusOriginal: source.placementStatusName,
      statusId: source.placementStatusId,
      isSale: source.isSale,
      repairIncluded: source.isRepaired,
      repairPrice: source.repairPrice,
      repairSum: source.repairSum,
      studio: source.isStudio,
      balconyArea: source.balconySquare,
      ceilingHeight: source.heightOfWall,
      addressRaw: source.blockAddress,
      planSourceUrls: {
        primary1600: source.photoURL1600,
        preview400: source.photoURL400,
        preview200: source.photoURL200,
      },
      provenance: {
        endpoint: sources.catalog.placementList.url,
        capturedAt: sources.capturedAt,
        sourceUuid: source.uuid,
        sourceBlockId: source.blockId,
        sourceBlockName: source.blockName,
        sourcePropertyTypeId: source.propertyType.uuid,
        sourceRealEstateUuid: source.realEstateUUID,
      },
    };
  });

  const blockIds = unique(units.map((unit) => unit.buildingId));
  const blocks = blockIds.map((id) => {
    const blockUnits = units.filter((unit) => unit.buildingId === id);
    const source = filterBlocks.get(id);
    return {
      id,
      sourceName: source.name,
      displayName: displayBlock(source.name),
      count: blockUnits.length,
      normalizedDeadline: source.deadline,
      sourcePlacementDeadline: unique(blockUnits.map((unit) => unit.sourcePlacementCompletionDate)).sort(),
      totalFloors: unique(blockUnits.map((unit) => unit.totalFloors)).sort((a, b) => a - b),
      entrances: unique(blockUnits.map((unit) => unit.entrance)).sort((a, b) => a - b),
    };
  });
  assertObject(Object.fromEntries(blocks.map((block) => [block.sourceName, block.normalizedDeadline])), {
    'NRG Zamon 2-2': '2026-11-14',
    'NRG Zamon 3 - 1': '2027-12-25',
  }, 'Normalized block deadlines');

  const statusSummary = counts(units.map((unit) => unit.statusOriginal)).map(({ value, count }) => ({
    id: units.find((unit) => unit.statusOriginal === value).statusId,
    status: value,
    count,
    isSaleCount: units.filter((unit) => unit.statusOriginal === value && unit.isSale).length,
  }));

  const catalog = {
    project: 'Zamon',
    companyId,
    realEstateUUID,
    propertyTypeUUID,
    propertyType: 'Квартира',
    source: sources.officialSources.catalog,
    sourceLanding: sources.officialSources.landingRu,
    capturedAt: sources.capturedAt,
    capturedAtUzt: sources.capturedAtUzt,
    officialTotalAtCapture: expectedCount,
    currency: 'UZS',
    selectionMethod: 'All apartment rows returned by the official placementList request at capture time.',
    legalStatusNote: 'Source workflow status and isSale are retained exactly; the snapshot is not a legal availability promise.',
    pricingMethod: 'price = discount.stock.data[0].priceWithDiscount; oldPrice = totalPrice; totalPriceWithDiscount is retained raw only.',
    promotionDisclosure: 'A dated 12% campaign snapshot through 2026-12-31T17:59:59Z; current terms require sales-team confirmation.',
    planManifest: 'data/zamon-plan-sources.json',
    blocks,
    statusSummary,
    filters: {
      roomCounts: counts(units.map((unit) => unit.rooms), true),
      floors: unique(units.map((unit) => unit.floor)).sort((a, b) => a - b),
      entrances: unique(units.map((unit) => unit.entrance)).sort((a, b) => a - b),
      blockIds,
      completionDates: unique(units.map((unit) => unit.completionDate)).sort(),
      statuses: statusSummary.map(({ status, count }) => ({ status, count })),
      studio: counts(units.map((unit) => unit.studio), true),
      area: { min: min(units, 'area'), max: max(units, 'area') },
      campaignPrice: { min: min(units, 'price'), max: max(units, 'price') },
    },
    metrics: {
      roomCounts: countObject(units.map((unit) => unit.rooms)),
      studioCounts: countObject(units.map((unit) => unit.studio)),
      isSaleCounts: countObject(units.map((unit) => unit.isSale)),
      areaMin: min(units, 'area'),
      areaMax: max(units, 'area'),
      originalPriceMin: min(units, 'oldPrice'),
      originalPriceMax: max(units, 'oldPrice'),
      campaignPriceMin: min(units, 'price'),
      campaignPriceMax: max(units, 'price'),
      balconyMin: min(units, 'balconyArea'),
      balconyMax: max(units, 'balconyArea'),
      publishedFloorMin: min(units, 'floor'),
      publishedFloorMax: max(units, 'floor'),
    },
    units,
  };

  assertObject([catalog.metrics.areaMin, catalog.metrics.areaMax], [31.14, 134.42], 'Area range');
  assertObject([catalog.metrics.originalPriceMin, catalog.metrics.originalPriceMax], [445769100, 1691996020], 'Original price range');
  assertObject([catalog.metrics.campaignPriceMin, catalog.metrics.campaignPriceMax], [392276808, 1488956497], 'Campaign price range');
  assertObject([catalog.metrics.balconyMin, catalog.metrics.balconyMax], [2.8, 3.75], 'Balcony range');
  return catalog;
}

async function main() {
  const built = await buildZamonCatalog();
  if (process.argv.includes('--check')) {
    const current = parse(await readFile(catalogPath), 'zamon-catalog.json');
    if (!isDeepStrictEqual(current, built)) fail('data/zamon-catalog.json differs from deterministic offline rebuild');
    console.log(`Zamon catalog rebuild is deterministic: ${built.units.length} apartments.`);
    return;
  }
  await writeFile(catalogPath, `${JSON.stringify(built, null, 2)}\n`);
  console.log(`Built data/zamon-catalog.json from frozen raw API responses: ${built.units.length} apartments.`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
