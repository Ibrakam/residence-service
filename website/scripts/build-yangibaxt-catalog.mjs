import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const websiteRoot = resolve(dirname(scriptPath), '..');
const dataRoot = resolve(websiteRoot, 'data');
const outputPath = resolve(dataRoot, 'yangibaxt-catalog.json');
const placementPath = resolve(dataRoot, 'yangibaxt-placement-raw.json');
const filterPath = resolve(dataRoot, 'yangibaxt-filter-raw.json');
const estatePath = resolve(dataRoot, 'yangibaxt-real-estate-raw.json');
const sourcesPath = resolve(dataRoot, 'yangibaxt-sources.json');
const planManifestPath = resolve(dataRoot, 'yangibaxt-plan-sources.json');

const expectedGroupOrder = [
  'NRG Yangi Baxt - 1',
  'NRG Yangi Baxt - 2',
  'NRG Yangi Baxt - 3 - 1',
  'NRG Yangi Baxt - 3 -2',
  'Yangi Baxt Munavvar 1',
];
const groupLabels = {
  'NRG Yangi Baxt - 1': '1',
  'NRG Yangi Baxt - 2': '2',
  'NRG Yangi Baxt - 3 - 1': '3-1',
  'NRG Yangi Baxt - 3 -2': '3-2',
  'Yangi Baxt Munavvar 1': 'Munavvar 1',
};

function fail(message) { throw new Error(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function parse(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}
function unique(values) { return [...new Set(values)]; }
function counts(values, sorter = (left, right) => String(left).localeCompare(String(right), 'ru')) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map].sort(([left], [right]) => sorter(left, right)).map(([value, count]) => ({ value, count }));
}
function range(values) { return { min: Math.min(...values), max: Math.max(...values) }; }
function assertRaw(name, buffer, source) {
  if (buffer.byteLength !== source.bytes) fail(`${name} raw byte length mismatch`);
  if (sha256(buffer) !== source.sha256) fail(`${name} raw SHA-256 mismatch`);
  if (buffer.at(-1) !== 0x7d) fail(`${name} raw file must end at the final JSON brace without LF`);
}

export async function buildYangiBaxtCatalog() {
  const [placementBuffer, filterBuffer, estateBuffer, sourceBuffer, planBuffer] = await Promise.all([
    readFile(placementPath), readFile(filterPath), readFile(estatePath), readFile(sourcesPath), readFile(planManifestPath),
  ]);
  const sources = parse(sourceBuffer, 'yangibaxt-sources.json');
  const placementResponse = parse(placementBuffer, 'yangibaxt-placement-raw.json');
  const filterResponse = parse(filterBuffer, 'yangibaxt-filter-raw.json');
  const estateResponse = parse(estateBuffer, 'yangibaxt-real-estate-raw.json');
  const planManifest = parse(planBuffer, 'yangibaxt-plan-sources.json');
  const frozen = sources.catalog;
  assertRaw('placementList', placementBuffer, frozen.placementList);
  assertRaw('filter', filterBuffer, frozen.filter);
  assertRaw('realEstateList', estateBuffer, frozen.realEstateList);

  const placements = placementResponse.placements;
  if (!Array.isArray(placements) || placements.length !== frozen.officialApartmentCount) fail(`Expected ${frozen.officialApartmentCount} apartment rows`);
  if (new Set(placements.map((unit) => unit.uuid)).size !== frozen.officialApartmentCount) fail('Apartment UUIDs are not unique');
  if (placements.some((unit) => unit.realEstateUUID !== frozen.realEstateUUID)) fail('Unexpected real-estate UUID in placementList');
  if (placements.some((unit) => unit.propertyType?.uuid !== frozen.propertyTypeUUID || unit.propertyType?.name !== 'Квартира')) fail('Non-apartment property type in placementList');
  if (new Set(placements.map((unit) => `${unit.blockId}|${unit.entrance}|${unit.floor}|${unit.name}`)).size !== placements.length) fail('Duplicate block + entrance + floor + apartment number combination');

  const filterEstate = filterResponse.realEstates?.find((item) => item.uuid === frozen.realEstateUUID);
  const estate = estateResponse.realEstates?.find((item) => item.uuid === frozen.realEstateUUID);
  if (!filterEstate || !estate) fail('Yangi Baxt missing from filter or realEstateList');
  if (estate.placementCount !== 320) fail(`Expected mixed-property realEstateList placementCount 320, found ${estate.placementCount}`);
  const filterBlocks = new Map(filterEstate.blocks.map((block) => [block.id, block]));
  const estateBlocks = new Map(estate.blocks.map((block) => [block.id, block]));
  for (const unit of placements) {
    const filtered = filterBlocks.get(unit.blockId);
    const listed = estateBlocks.get(unit.blockId);
    if (!filtered || !listed || filtered.deadline !== listed.deadline) fail(`Missing or inconsistent normalized deadline for ${unit.blockId}`);
  }

  if (planManifest.count !== placements.length || planManifest.items?.length !== placements.length) fail('Plan detail manifest count mismatch');
  if (planManifest.apartmentSheetExistCount !== placements.length || planManifest.page1Http200Count !== placements.length || planManifest.page2Http200Count !== placements.length) fail('Plan manifest does not confirm both official sheets for every apartment');
  const plansById = new Map(planManifest.items.map((item) => [item.unitId, item]));
  if (plansById.size !== placements.length) fail('Plan manifest unit IDs are not unique');

  const units = placements.map((source, sourceOrder) => {
    const planSource = plansById.get(source.uuid);
    if (!planSource) fail(`Plan manifest entry missing for ${source.uuid}`);
    if (planSource.unitNumber !== String(source.name)) fail(`Plan manifest number mismatch for ${source.uuid}`);
    if (!planSource.page1?.web?.publicPath?.startsWith('/yangibaxt/floor-positions/') || !planSource.page2?.web?.publicPath?.startsWith('/yangibaxt/plans/')) fail(`Invalid local plan paths for ${source.uuid}`);
    const normalizedDeadline = filterBlocks.get(source.blockId).deadline;
    const campaign = source.discount?.stock?.data?.[0] ?? null;
    const campaignPrice = campaign?.priceWithDiscount;
    const hasCampaignPrice = typeof campaignPrice === 'number' && Number.isFinite(campaignPrice) && campaignPrice > 0;
    const price = hasCampaignPrice ? campaignPrice : source.totalPrice;
    const buildingDisplay = groupLabels[source.blockName];
    if (!buildingDisplay) fail(`Unexpected Yangi Baxt group: ${source.blockName}`);
    return {
      id: source.uuid,
      sourceOrder,
      number: String(source.name),
      rooms: source.roomCount,
      area: source.square,
      price,
      priceSource: hasCampaignPrice ? 'campaign-snapshot' : 'raw-total-price-fallback',
      oldPrice: source.totalPrice,
      totalPriceWithDiscountRaw: source.totalPriceWithDiscount,
      currentPricePerM2: Math.round(price / source.square),
      sourcePricePerM2: source.priceBySquare,
      currency: 'UZS',
      promotion: hasCampaignPrice ? {
        percent: campaign.percent,
        name: campaign.name,
        deadlineUtc: source.stock?.stockDeadline ?? null,
        discountSum: campaign.discountSum,
        priceWithDiscount: campaignPrice,
      } : null,
      floor: source.floor,
      totalFloors: source.maxFloor,
      entrance: source.entrance,
      buildingId: source.blockId,
      building: source.blockName,
      buildingDisplay,
      propertyClass: source.propertyClassName?.[0] ?? 'Комфорт',
      completionDate: normalizedDeadline,
      sourcePlacementCompletionDate: source.deadLine,
      plan: planSource.page2.web.publicPath,
      floorPositionPlan: planSource.page1.web.publicPath,
      planSourceUrls: {
        primaryLayout: source.photoURL1600,
        apartmentSheetURLPage1: planSource.page1SourceUrl,
        apartmentSheetURLPage2: planSource.page2SourceUrl,
      },
      statusOriginal: source.placementStatusName,
      statusId: source.placementStatusId,
      isSale: source.isSale,
      repairIncluded: source.isRepaired,
      repairPrice: source.repairPrice,
      repairSum: source.repairSum,
      studio: source.isStudio,
      balconyArea: source.balconySquare,
      ceilingHeight: source.heightOfWall,
      rawAddress: source.blockAddress,
      provenance: {
        placementEndpoint: frozen.placementList.url,
        detailEndpoint: planSource.endpoint,
        capturedAt: sources.capturedAt,
        sourceUuid: source.uuid,
        sourceBlockId: source.blockId,
        sourceBlockName: source.blockName,
        sourcePropertyTypeId: source.propertyType.uuid,
        sourcePropertyTypeName: source.propertyType.name,
        detailResponseBytes: planSource.response.bytes,
        detailResponseSha256: planSource.response.sha256,
      },
    };
  });

  const groups = expectedGroupOrder.map((rawName) => {
    const groupUnits = units.filter((unit) => unit.building === rawName);
    if (!groupUnits.length) fail(`Expected catalog group missing: ${rawName}`);
    const filterBlock = filterBlocks.get(groupUnits[0].buildingId);
    const entrances = unique(groupUnits.map((unit) => unit.entrance)).sort((left, right) => left - right).map((entrance) => {
      const entranceUnits = groupUnits.filter((unit) => unit.entrance === entrance);
      return {
        entrance,
        count: entranceUnits.length,
        floorsWithListings: unique(entranceUnits.map((unit) => unit.floor)).sort((left, right) => left - right),
        maxFloor: Math.max(...entranceUnits.map((unit) => unit.totalFloors)),
      };
    });
    return {
      id: groupUnits[0].buildingId,
      rawName,
      displayName: groupLabels[rawName],
      count: groupUnits.length,
      normalizedDeadline: filterBlock.deadline,
      sourcePlacementDeadlines: unique(groupUnits.map((unit) => unit.sourcePlacementCompletionDate)).sort(),
      entrances,
    };
  });

  const statusSummary = counts(units.map((unit) => unit.statusOriginal));
  const campaignUnits = units.filter((unit) => unit.promotion);
  const offerCount = units.filter((unit) => unit.statusOriginal === 'Свободно' && unit.isSale).length;
  return {
    project: 'Yangi Baxt',
    projectSlug: 'yangibaxt',
    companyId: frozen.companyId,
    realEstateUUID: frozen.realEstateUUID,
    propertyTypeUUID: frozen.propertyTypeUUID,
    propertyType: 'Квартира',
    source: sources.official.catalog,
    sourceLanding: sources.official.landingRu,
    capturedAt: sources.capturedAt,
    capturedAtUzt: sources.capturedAtUzt,
    captureCompletedAt: sources.captureCompletedAt,
    officialTotalAtCapture: units.length,
    mixedPropertyPlacementCount: estate.placementCount,
    currency: 'UZS',
    offerCount,
    selectionMethod: 'All apartment rows from one frozen placementList request scoped to the apartment property type; parking, office and basement property types are excluded.',
    sourceApis: {
      placementList: frozen.placementList,
      filter: frozen.filter,
      realEstateList: frozen.realEstateList,
      placementDetail: { method: 'POST', url: planManifest.endpoint, count: planManifest.count, capturedAt: planManifest.capturedAt, completedAt: planManifest.completedAt },
    },
    integrity: {
      uniqueUnitIds: new Set(units.map((unit) => unit.id)).size,
      uniqueMatrixKeys: new Set(units.map((unit) => `${unit.buildingId}|${unit.entrance}|${unit.floor}|${unit.number}`)).size,
      allApartmentPropertyType: placements.every((unit) => unit.propertyType.uuid === frozen.propertyTypeUUID),
      localApartmentPlanCount: planManifest.page2Http200Count,
      localFloorPositionCount: planManifest.page1Http200Count,
      apartmentSheetExistCount: planManifest.apartmentSheetExistCount,
    },
    filterSummary: {
      groups,
      rooms: counts(units.map((unit) => unit.rooms), (left, right) => left - right),
      statuses: statusSummary,
      classes: counts(units.map((unit) => unit.propertyClass)),
      deadlines: counts(units.map((unit) => unit.completionDate)),
      entrances: counts(units.map((unit) => unit.entrance), (left, right) => left - right),
      repairIncluded: { true: units.filter((unit) => unit.repairIncluded).length, false: units.filter((unit) => !unit.repairIncluded).length },
      studio: { true: units.filter((unit) => unit.studio).length, false: units.filter((unit) => !unit.studio).length },
      campaign: {
        withCampaignPrice: campaignUnits.length,
        rawFallback: units.length - campaignUnits.length,
        names: counts(campaignUnits.map((unit) => unit.promotion.name)),
        deadlinesUtc: counts(campaignUnits.map((unit) => unit.promotion.deadlineUtc)),
      },
      ranges: {
        area: range(units.map((unit) => unit.area)),
        snapshotPrice: range(units.map((unit) => unit.price)),
        snapshotPricePerM2: range(units.map((unit) => unit.currentPricePerM2)),
        rawTotalPrice: range(units.map((unit) => unit.oldPrice)),
        floor: range(units.map((unit) => unit.floor)),
      },
    },
    statusSummary,
    units,
  };
}

function argumentsOf(argv) {
  let check = false;
  let destination = outputPath;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') check = true;
    else if (argument === '--output') { destination = resolve(process.cwd(), argv[index + 1]); index += 1; }
    else if (argument.startsWith('--output=')) destination = resolve(process.cwd(), argument.slice(9));
    else fail(`Unknown argument: ${argument}`);
  }
  if (check && destination !== outputPath) fail('--check and --output cannot be combined');
  return { check, destination };
}

async function main() {
  const { check, destination } = argumentsOf(process.argv.slice(2));
  const catalog = await buildYangiBaxtCatalog();
  if (check) {
    const current = parse(await readFile(outputPath), 'yangibaxt-catalog.json');
    if (!isDeepStrictEqual(catalog, current)) fail('Checked-in Yangi Baxt catalog differs from deterministic offline rebuild');
    console.log(`Yangi Baxt offline rebuild matches the checked-in ${catalog.officialTotalAtCapture}-apartment snapshot (${catalog.capturedAt}).`);
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Rebuilt ${catalog.officialTotalAtCapture} Yangi Baxt apartments offline from frozen raw files and manifests.`);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) await main();
