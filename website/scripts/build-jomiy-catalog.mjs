import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(websiteRoot, 'source/jomiy');
const outputPath = resolve(websiteRoot, 'data/jomiy-catalog.json');

const expected = {
  companyId: '5cba02b4-8abd-11ee-ab79-001dd8b7289a',
  realEstateUUID: '81153f29-f48b-11ed-a82e-001dd8b726aa',
  propertyTypeUUID: '5990a172-812a-4fee-b4f5-c860cca824d7',
  page1Sha256: '60a920e364a2725db96c15b10afac0759b60137c4357e6d48b20facc87fa31fe',
  page2Sha256: '03d8d148725f59062ecb6c300b11d9caa95c85c06a2b93ac27d6f4de4c5e4ee7',
  filterSha256: 'a9d8f12568422fe8e4e910a4220ab75cf7d3136c884e9d635a256e42ce521fb5',
  estateSha256: 'b65535e2a91533f93223338834201820528cf0049e3a048db5320b38b0d17b6e',
};
const expectedPlacementBody = {
  pageNo: 1,
  pageSize: 500,
  companyIds: [expected.companyId],
  realEstateUUIDs: [expected.realEstateUUID],
  propertyTypes: [expected.propertyTypeUUID],
  filterTags: {},
};

function fail(message) { throw new Error(message); }
function parse(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
}
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function assert(condition, message) { if (!condition) fail(message); }
function unique(values) { return [...new Set(values)]; }
function range(values) { return { min: Math.min(...values), max: Math.max(...values) }; }
function counts(values, compare = (left, right) => String(left).localeCompare(String(right), 'ru')) {
  const map = new Map();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map].sort(([left], [right]) => compare(left, right)).map(([value, count]) => ({ value, count }));
}

async function readJson(relativePath) {
  const buffer = await readFile(resolve(sourceRoot, relativePath));
  return { buffer, value: parse(buffer, relativePath) };
}

function assertRaw(name, raw, manifestEntry, expectedHash) {
  assert(raw.buffer.byteLength === manifestEntry.bytes, `${name}: raw byte length changed`);
  assert(sha256(raw.buffer) === manifestEntry.sha256, `${name}: raw SHA-256 does not match api-manifest`);
  assert(manifestEntry.sha256 === expectedHash, `${name}: not the approved 30 Aug 2026 capture`);
}

export async function buildJomiyCatalog() {
  const [draftFile, apiFile, planFile, sourceFile, page1, page2, filter, estate, confirmation] = await Promise.all([
    readJson('jomiy-catalog-draft.json'),
    readJson('api-manifest.json'),
    readJson('plan-derivatives-manifest.json'),
    readJson('source-manifest.json'),
    readJson('api/placement-list-page-1.json'),
    readJson('api/placement-list-page-2.json'),
    readJson('api/filter.json'),
    readJson('api/real-estate-list.json'),
    readJson('api/placement-list-confirmation.json'),
  ]);
  const draft = draftFile.value;
  const api = apiFile.value;
  const planManifest = planFile.value;
  const sourceManifest = sourceFile.value;
  const raw = api.rawResponses;

  assertRaw('placementList page 1', page1, raw.placementListPage1, expected.page1Sha256);
  assertRaw('placementList page 2', page2, raw.placementListPage2, expected.page2Sha256);
  assertRaw('filter', filter, raw.filter, expected.filterSha256);
  assertRaw('realEstateList', estate, raw.realEstateList, expected.estateSha256);
  assertRaw('placementList confirmation', confirmation, raw.placementListConfirmation, expected.page1Sha256);
  assert(page1.buffer.equals(confirmation.buffer), 'Repeated page 1 is not byte-identical');
  assert(raw.placementListPage1.method === 'POST' && raw.placementListPage1.url.endsWith('/placementList'), 'Unexpected placementList request metadata');
  assert(isDeepStrictEqual(raw.placementListPage1.requestBody, expectedPlacementBody), 'Unexpected placementList page 1 request body');
  assert(isDeepStrictEqual(raw.placementListPage2.requestBody, { ...expectedPlacementBody, pageNo: 2 }), 'Unexpected placementList page 2 request body');
  assert(isDeepStrictEqual(raw.placementListConfirmation.requestBody, expectedPlacementBody), 'Unexpected confirmation request body');

  const placements = page1.value.placements;
  assert(Array.isArray(placements) && placements.length === 121, 'Expected exactly 121 placement rows');
  assert(Array.isArray(page2.value.placements) && page2.value.placements.length === 0, 'Expected page 2 to be empty');
  assert(new Set(placements.map((unit) => unit.uuid)).size === 121, 'Placement UUIDs are not unique');
  assert(placements.every((unit) => unit.realEstateUUID === expected.realEstateUUID), 'Unexpected real-estate UUID');
  assert(placements.every((unit) => unit.propertyType?.uuid === expected.propertyTypeUUID && unit.propertyType?.name === 'Квартира'), 'Non-apartment row in capture');
  assert(Array.isArray(draft.units) && draft.units.length === 121, 'Derived draft must contain exactly 121 rows');
  assert(new Set(draft.units.map((unit) => unit.id)).size === 121, 'Derived draft UUIDs are not unique');

  const filterEstate = filter.value.realEstates?.find((item) => item.uuid === expected.realEstateUUID);
  const listedEstate = estate.value.realEstates?.find((item) => item.uuid === expected.realEstateUUID);
  assert(filterEstate && listedEstate, 'Jomiy is missing from filter or realEstateList');
  assert(filter.value.placementCount === 121, 'Filtered apartment count must be 121');
  assert(listedEstate.placementCount === 251, 'Mixed realEstateList placementCount must be 251');
  assert(planManifest.count === 121 && planManifest.page1Count === 121 && planManifest.page2Count === 121 && planManifest.layoutCount === 121, 'Plan derivative manifest must cover all 121 entries');
  assert(api.detailCount === 121 && api.details.length === 121, 'API manifest must contain all 121 detail responses');
  assert(sourceManifest.booklet?.filePresentation === null && sourceManifest.booklet?.bookletImage === null && sourceManifest.booklet?.bookletUrl === '', 'The source manifest must explicitly record no confirmed booklet');

  for (const block of filterEstate.blocks) {
    const listedBlock = listedEstate.blocks.find((item) => item.id === block.id);
    assert(listedBlock && listedBlock.deadline === block.deadline, `filter/realEstateList deadline mismatch for ${block.id}`);
  }
  assert(filterEstate.blocks.find((block) => block.id === 'd7207ffd-9265-11ed-a82b-001dd8b726aa')?.deadline === '2025-12-28', 'Unexpected normalised deadline for phase 2.1');
  assert(filterEstate.blocks.find((block) => block.id === '31c49bc8-9266-11ed-a82b-001dd8b726aa')?.deadline === '2027-09-18', 'Unexpected normalised deadline for phase 2.2');

  const detailPayloads = await Promise.all(api.details.map(async (entry) => {
    assert(entry.method === 'POST' && entry.url.endsWith('/placement'), `Unexpected detail request metadata for ${entry.unitId}`);
    assert(isDeepStrictEqual(entry.requestBody, { placementUUID: entry.unitId }), `Unexpected detail request body for ${entry.unitId}`);
    const buffer = await readFile(resolve(sourceRoot, entry.localPath));
    assert(buffer.byteLength === entry.bytes, `Detail byte length changed for ${entry.unitId}`);
    assert(sha256(buffer) === entry.sha256, `Detail SHA-256 changed for ${entry.unitId}`);
    const value = parse(buffer, entry.localPath);
    assert(value.placementUUID === entry.unitId, `Detail placement UUID mismatch for ${entry.unitId}`);
    assert(value.realEstateUUID === expected.realEstateUUID, `Detail real-estate UUID mismatch for ${entry.unitId}`);
    assert(value.propertyTypeId === expected.propertyTypeUUID && value.propertyType?.name === 'Квартира', `Non-apartment detail for ${entry.unitId}`);
    assert(value.canBuy === entry.canBuy && value.isSale === entry.isSale && value.placementStatusName === entry.placementStatusName, `Detail manifest facts mismatch for ${entry.unitId}`);
    assert(value.apartmentSheetExist === true && value.apartmentSheetURLPage1 && value.apartmentSheetURLPage2, `Missing official sheet in detail ${entry.unitId}`);
    return [entry.unitId, value];
  }));

  const rawById = new Map(placements.map((unit) => [unit.uuid, unit]));
  const placementOrderById = new Map(placements.map((unit, index) => [unit.uuid, index]));
  const apiDetailById = new Map(api.details.map((item) => [item.unitId, item]));
  const rawDetailById = new Map(detailPayloads);
  const planById = new Map(planManifest.items.map((item) => [item.unitId, item]));
  assert(rawById.size === 121 && apiDetailById.size === 121 && rawDetailById.size === 121 && planById.size === 121, 'Source identifiers are not one-to-one');

  const normalizedDeadlines = new Map(filterEstate.blocks.map((block) => [block.id, block.deadline]));
  const units = draft.units.map((unit) => {
    const source = rawById.get(unit.id);
    const detail = apiDetailById.get(unit.id);
    const detailRaw = rawDetailById.get(unit.id);
    const plans = planById.get(unit.id);
    assert(source && detail && detailRaw && plans, `Missing source material for ${unit.id}`);
    assert(unit.sourceOrder === placementOrderById.get(unit.id), `Source order mismatch for ${unit.id}`);
    assert(unit.number === String(source.name), `Unit number mismatch for ${unit.id}`);
    assert(unit.number === String(detailRaw.placementName) && unit.rooms === source.roomCount && unit.rooms === detailRaw.roomCount, `Core unit identity mismatch for ${unit.id}`);
    assert(unit.area === source.square && unit.area === detailRaw.square && unit.floor === source.floor && unit.floor === detailRaw.floor, `Area/floor mismatch for ${unit.id}`);
    assert(unit.totalFloors === source.maxFloor && unit.totalFloors === detailRaw.maxFloor && unit.entrance === source.entrance && unit.entrance === detailRaw.entrance, `Floor/entrance mismatch for ${unit.id}`);
    assert(unit.buildingId === source.blockId && unit.buildingId === detailRaw.blockId && unit.building === source.blockName && unit.building === detailRaw.block, `Group mismatch for ${unit.id}`);
    assert(unit.statusOriginal === source.placementStatusName && unit.statusOriginal === detailRaw.placementStatusName && unit.isSale === source.isSale && unit.isSale === detailRaw.isSale, `Status/sale mismatch for ${unit.id}`);
    assert(unit.statusId === source.placementStatusId && unit.statusId === detailRaw.placementStatusUUID, `Status UUID mismatch for ${unit.id}`);
    assert(unit.canBuy === detail.canBuy && unit.canBuy === detailRaw.canBuy, `canBuy mismatch for ${unit.id}`);
    assert(unit.repairIncluded === source.isRepaired && unit.repairIncluded === detailRaw.isRepaired, `Finishing mismatch for ${unit.id}`);
    assert(unit.studio === source.isStudio && unit.studio === detailRaw.isStudio, `Studio mismatch for ${unit.id}`);
    assert(unit.propertyClass === source.propertyClassName?.[0] && unit.propertyClass === detailRaw.propertyClassName, `Property class mismatch for ${unit.id}`);
    assert(unit.ceilingHeight === source.heightOfWall && unit.ceilingHeight === detailRaw.ceilingHeight, `Ceiling height mismatch for ${unit.id}`);
    assert(unit.sourcePlacementCompletionDate === source.deadLine && unit.sourcePlacementCompletionDate === detailRaw.deadLine, `Raw placement deadline mismatch for ${unit.id}`);
    assert(unit.totalPriceWithDiscountRaw === source.totalPriceWithDiscount && unit.totalPriceWithDiscountRaw === detailRaw.totalPriceWithDiscount, `Top-level discounted price capture mismatch for ${unit.id}`);
    assert(unit.balconyArea === source.balconySquare && unit.balconyArea === detailRaw.balconySquare, `Balcony area mismatch for ${unit.id}`);
    assert(unit.rawAddress === source.blockAddress && unit.rawAddress === detailRaw.blockAddress, `Raw address mismatch for ${unit.id}`);
    assert(unit.placement3dTour === source.placement3dTour && unit.placement3dTour === detailRaw.placement3dTour, `3D-tour mismatch for ${unit.id}`);
    assert(plans.page1.source.materialType === 'official-apartment-sheet-floor-position' && plans.page2.source.materialType === 'official-apartment-sheet-individual-plan' && plans.layout.source.materialType === 'official-compact-layout-photoURL1600', `Plan semantic mismatch for ${unit.id}`);
    assert(unit.sheetPage1 === plans.page1.derivative.publicPath && unit.sheetPage2 === plans.page2.derivative.publicPath && unit.layout === plans.layout.derivative.publicPath, `Local plan path mismatch for ${unit.id}`);
    assert(unit.sourceUrls.apartmentSheetURLPage1 === plans.page1.source.sourceUrl && unit.sourceUrls.apartmentSheetURLPage1 === detailRaw.apartmentSheetURLPage1, `Official sheet page 1 URL mismatch for ${unit.id}`);
    assert(unit.sourceUrls.apartmentSheetURLPage2 === plans.page2.source.sourceUrl && unit.sourceUrls.apartmentSheetURLPage2 === detailRaw.apartmentSheetURLPage2, `Official sheet page 2 URL mismatch for ${unit.id}`);
    assert(unit.sourceUrls.photoURL1600 === plans.layout.source.sourceUrl && unit.sourceUrls.photoURL1600 === detailRaw.photoURL1600, `Official compact layout URL mismatch for ${unit.id}`);
    assert(unit.completionDate === normalizedDeadlines.get(unit.buildingId), `Normalised deadline mismatch for ${unit.id}`);
    const campaign = source.discount?.stock?.data?.[0] ?? null;
    const campaignPrice = campaign?.priceWithDiscount;
    const hasCampaign = Number.isFinite(campaignPrice) && campaignPrice > 0;
    const price = hasCampaign ? campaignPrice : source.totalPrice;
    assert(price === unit.campaignPriceSnapshot, `Campaign price path mismatch for ${unit.id}`);
    if (hasCampaign) {
      assert(unit.promotion && unit.promotion.priceWithDiscount === campaignPrice && unit.promotion.percent === campaign.percent && unit.promotion.discountSum === campaign.discountSum && unit.promotion.name === campaign.name, `Campaign fields mismatch for ${unit.id}`);
      assert(source.stock?.stockDeadline && new Date(unit.promotion.deadlineUtc).toISOString() === new Date(source.stock.stockDeadline).toISOString(), `Campaign deadline mismatch for ${unit.id}`);
      assert(detailRaw.discount?.stock?.data?.[0]?.priceWithDiscount === campaignPrice, `Detail campaign price mismatch for ${unit.id}`);
    }
    assert(unit.originalPrice === source.totalPrice && unit.originalPrice === detailRaw.totalPrice, `Regular price mismatch for ${unit.id}`);
    const strictOfferEligible = source.placementStatusName === 'Свободно' && source.isSale === true && detailRaw.canBuy === true;
    assert(unit.strictOfferEligible === strictOfferEligible, `Strict Offer eligibility mismatch for ${unit.id}`);
    return {
      id: unit.id,
      sourceOrder: unit.sourceOrder,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      price,
      priceSource: hasCampaign ? 'campaign-snapshot' : 'raw-total-price-fallback',
      oldPrice: unit.originalPrice,
      totalPriceWithDiscountRaw: unit.totalPriceWithDiscountRaw,
      currentPricePerM2: Math.round(price / unit.area),
      sourcePricePerM2: source.priceBySquare,
      currency: unit.currency,
      promotion: unit.promotion ? { ...unit.promotion, deadlineUtc: new Date(unit.promotion.deadlineUtc).toISOString() } : null,
      floor: unit.floor,
      totalFloors: unit.totalFloors,
      entrance: unit.entrance,
      buildingId: unit.buildingId,
      building: unit.building,
      buildingDisplay: unit.buildingDisplay,
      propertyClass: unit.propertyClass,
      completionDate: unit.completionDate,
      sourcePlacementCompletionDate: source.deadLine,
      thumbnail: unit.layout,
      sheetPage1: unit.sheetPage1,
      sheetPage2: unit.sheetPage2,
      planSourceUrls: {
        primaryLayout: unit.sourceUrls.photoURL1600,
        apartmentSheetURLPage1: unit.sourceUrls.apartmentSheetURLPage1,
        apartmentSheetURLPage2: unit.sourceUrls.apartmentSheetURLPage2,
      },
      statusOriginal: unit.statusOriginal,
      statusId: source.placementStatusId,
      isSale: unit.isSale,
      canBuy: unit.canBuy,
      strictOfferEligible,
      repairIncluded: unit.repairIncluded,
      repairPrice: source.repairPrice,
      repairSum: source.repairSum,
      studio: unit.studio,
      balconyArea: source.balconySquare,
      ceilingHeight: unit.ceilingHeight,
      rawAddress: source.blockAddress,
      placement3dTour: source.placement3dTour,
      provenance: {
        capturedAt: draft.capturedAtUtc,
        detailResponseBytes: detail.bytes,
        detailResponseSha256: detail.sha256,
      },
    };
  });

  const groups = draft.blocks.map((block) => {
    const groupUnits = units.filter((unit) => unit.buildingId === block.id);
    const entrances = unique(groupUnits.map((unit) => unit.entrance)).sort((left, right) => left - right);
    const sourcePlacementDeadlines = unique(groupUnits.map((unit) => unit.sourcePlacementCompletionDate)).sort();
    return {
      id: block.id,
      rawName: block.sourceName,
      displayName: block.displayName,
      count: block.count,
      normalizedDeadline: block.normalizedDeadline,
      sourcePlacementDeadlines,
      entrances: entrances.map((entrance) => {
        const entranceUnits = groupUnits.filter((unit) => unit.entrance === entrance);
        return {
          entrance,
          count: entranceUnits.length,
          floorsWithListings: unique(entranceUnits.map((unit) => unit.floor)).sort((left, right) => left - right),
          maxFloor: 12,
        };
      }),
    };
  });

  const expectedEntrances = new Map([
    ['d7207ffd-9265-11ed-a82b-001dd8b726aa', [1, 2, 5]],
    ['31c49bc8-9266-11ed-a82b-001dd8b726aa', [1, 2, 3, 4]],
  ]);
  for (const group of groups) {
    assert(isDeepStrictEqual(group.entrances.map((item) => item.entrance), expectedEntrances.get(group.id)), `Unexpected entrance combinations for ${group.id}`);
  }
  const stableMatrix = {
    groupEntranceCombinations: groups.reduce((sum, group) => sum + group.entrances.length, 0),
    rowsPerEntrance: Math.max(...units.map((unit) => unit.totalFloors)),
    totalRows: groups.reduce((sum, group) => sum + group.entrances.length, 0) * Math.max(...units.map((unit) => unit.totalFloors)),
  };

  const campaignUnits = units.filter((unit) => unit.promotion);
  const result = {
    project: 'Jomiy',
    projectSlug: 'jomiy',
    companyId: expected.companyId,
    realEstateUUID: expected.realEstateUUID,
    propertyTypeUUID: expected.propertyTypeUUID,
    propertyType: 'Квартира',
    source: sourceManifest.officialPages.find((page) => page.id === 'official-apartment-catalog')?.url,
    sourceLanding: sourceManifest.officialPages.find((page) => page.id === 'landing-ru')?.url,
    capturedAt: draft.capturedAtUtc,
    capturedAtUzt: draft.capturedAtUzt,
    captureCompletedAt: draft.captureCompletedAtUtc,
    officialTotalAtCapture: units.length,
    mixedPropertyPlacementCount: listedEstate.placementCount,
    currency: 'UZS',
    offerEligibilityPolicy: draft.offerEligibilityPolicy,
    offerCount: units.filter((unit) => unit.strictOfferEligible).length,
    stableMatrix,
    sourceApis: draft.sourceApis,
    integrity: {
      uniqueUnitIds: new Set(units.map((unit) => unit.id)).size,
      uniqueSheetPage1Urls: new Set(units.map((unit) => unit.planSourceUrls.apartmentSheetURLPage1)).size,
      uniqueSheetPage2Urls: new Set(units.map((unit) => unit.planSourceUrls.apartmentSheetURLPage2)).size,
      detailCount: api.detailCount,
      localLayoutCount: planManifest.layoutCount,
      localSheetPage1Count: planManifest.page1Count,
      localSheetPage2Count: planManifest.page2Count,
      noTours: units.filter((unit) => unit.placement3dTour).length === 0,
    },
    filterSummary: {
      groups,
      rooms: counts(units.map((unit) => unit.rooms), (left, right) => left - right),
      statuses: counts(units.map((unit) => unit.statusOriginal)),
      classes: counts(units.map((unit) => unit.propertyClass)),
      deadlines: counts(units.map((unit) => unit.completionDate)),
      entrances: counts(units.map((unit) => unit.entrance), (left, right) => left - right),
      isSale: counts(units.map((unit) => unit.isSale), (left, right) => Number(left) - Number(right)),
      canBuy: counts(units.map((unit) => unit.canBuy), (left, right) => Number(left) - Number(right)),
      repairIncluded: { true: units.filter((unit) => unit.repairIncluded).length, false: units.filter((unit) => !unit.repairIncluded).length },
      studio: { true: units.filter((unit) => unit.studio).length, false: units.filter((unit) => !unit.studio).length },
      campaign: {
        withCampaignPrice: campaignUnits.length,
        rawFallback: units.length - campaignUnits.length,
        percentages: counts(campaignUnits.map((unit) => unit.promotion.percent), (left, right) => left - right),
        deadlinesUtc: counts(campaignUnits.map((unit) => unit.promotion.deadlineUtc)),
      },
      ranges: {
        area: range(units.map((unit) => unit.area)),
        snapshotPrice: range(units.map((unit) => unit.price)),
        rawTotalPrice: range(units.map((unit) => unit.oldPrice)),
        snapshotPricePerM2: range(units.map((unit) => unit.currentPricePerM2)),
        floor: range(units.map((unit) => unit.floor)),
      },
    },
    units,
  };

  assert(result.offerCount === 0, 'Strict JSON-LD Offer policy must produce zero Offers');
  assert(groups.length === 2 && groups.reduce((sum, group) => sum + group.entrances.length, 0) === 7, 'Expected two groups and seven real entrances');
  assert(stableMatrix.totalRows === 84, 'Stable matrix must contain 84 rows');
  return result;
}

function parseArguments(argv) {
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
  const { check, destination } = parseArguments(process.argv.slice(2));
  const catalog = await buildJomiyCatalog();
  if (check) {
    const current = parse(await readFile(outputPath), 'data/jomiy-catalog.json');
    assert(isDeepStrictEqual(current, catalog), 'data/jomiy-catalog.json is stale; run npm run build:jomiy-catalog');
    console.log(`Jomiy offline rebuild verified: ${catalog.units.length} entries, ${catalog.offerCount} Offers, ${catalog.stableMatrix.totalRows} matrix rows.`);
    return;
  }
  await writeFile(destination, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${destination}: ${catalog.units.length} Jomiy entries.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
