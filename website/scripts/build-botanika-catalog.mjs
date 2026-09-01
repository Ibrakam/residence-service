import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planRoot = resolve(websiteRoot, 'public/botanika-saroyi/plans');
const catalogPath = resolve(websiteRoot, 'data/botanika-saroyi-catalog.json');
const rawPath = resolve(websiteRoot, 'data/botanika-saroyi-placement-raw.json');
const manifestPath = resolve(websiteRoot, 'data/botanika-saroyi-sources.json');

const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateUUID = '3f8ec6af-9595-11ee-a82d-001dd8b72708';
const propertyTypeUUID = '5990a172-812a-4fee-b4f5-c860cca824d7';
const placementListUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placementList';
const realEstateListUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/realEstateList';
const placementDetailUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placement';
const landingRu = 'https://nrg-bi.uz/uz-ru/landing/botanika-saroyi';
const landingUz = 'https://nrg-bi.uz/uz/landing/botanika-saroyi';
const officialCatalog = `https://nrg-bi.uz/uz-ru/filter/placements?companyIds=[%22${companyId}%22]&realEstateUUIDs=[%22${realEstateUUID}%22]&propertyTypes=[%22${propertyTypeUUID}%22]&filterTags={}`;
const capturedAt = new Date().toISOString();

const placementRequest = {
  pageNo: 1,
  pageSize: 300,
  companyIds: [companyId],
  realEstateUUIDs: [realEstateUUID],
  propertyTypes: [propertyTypeUUID],
  filterTags: {},
};
const realEstateRequest = { pageNo: 1, pageSize: 300, companyIds: [companyId], realEstateUUIDs: [realEstateUUID] };

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function postJSON(url, body) {
  let failure;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      const text = await response.text();
      return { data: JSON.parse(text), text, serverDateUtc: response.headers.get('date') };
    } catch (error) {
      failure = error;
      if (attempt < 4) await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 350));
    }
  }
  throw failure;
}

async function getResponse(url) {
  let failure;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response;
    } catch (error) {
      failure = error;
      if (attempt < 4) await new Promise((resolveWait) => setTimeout(resolveWait, attempt * 350));
    }
  }
  throw failure;
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const results = new Array(items.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

const [placementResponse, realEstateResponse] = await Promise.all([
  postJSON(placementListUrl, placementRequest),
  postJSON(realEstateListUrl, realEstateRequest),
]);

const placements = placementResponse.data.placements;
if (!Array.isArray(placements) || placements.length !== 224) throw new Error(`Expected 224 apartments, received ${placements?.length}`);
if (new Set(placements.map((unit) => unit.uuid)).size !== 224) throw new Error('Unit UUIDs are not unique');
if (new Set(placements.map((unit) => unit.photoURL1600)).size !== 224) throw new Error('Floorplan URLs are not unique');

const estate = realEstateResponse.data.realEstates?.find((item) => item.uuid === realEstateUUID);
if (!estate) throw new Error('Botanika Saroyi missing from realEstateList');
const normalizedDeadlines = Object.fromEntries(estate.blocks.map((block) => [block.id, block.deadline]));

const details = await pool(placements, 6, async (unit) => {
  const response = await postJSON(placementDetailUrl, { placementUUID: unit.uuid });
  return {
    placementUUID: unit.uuid,
    apartmentSheetExist: response.data.apartmentSheetExist,
    apartmentSheetURLPage1: response.data.apartmentSheetURLPage1,
    apartmentSheetURLPage2: response.data.apartmentSheetURLPage2,
    photoURL1600: response.data.photoURL1600,
  };
});
const detailsById = Object.fromEntries(details.map((item) => [item.placementUUID, item]));
if (details.some((item) => !item.apartmentSheetExist || !item.apartmentSheetURLPage1 || !item.apartmentSheetURLPage2)) {
  throw new Error('One or more apartment sheet URLs are missing');
}

await mkdir(planRoot, { recursive: true });
const floorplanSources = await pool(placements, 6, async (unit) => {
  const response = await getResponse(unit.photoURL1600);
  const source = Buffer.from(await response.arrayBuffer());
  const local = `/botanika-saroyi/plans/${unit.uuid}.webp`;
  const outputPath = resolve(websiteRoot, `public${local}`);
  await sharp(source)
    .rotate()
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true, background: '#f7f2e8' })
    .flatten({ background: '#f7f2e8' })
    .webp({ quality: 84, effort: 5 })
    .toFile(outputPath);
  const localBuffer = await readFile(outputPath);
  const localStats = await stat(outputPath);
  return {
    unitId: unit.uuid,
    local,
    source: unit.photoURL1600,
    materialType: 'official-floorplan',
    caption: `Official apartment floorplan No. ${unit.name}`,
    receivedAt: capturedAt,
    sourceHttpStatus: response.status,
    sourceContentType: response.headers.get('content-type'),
    sourceSizeBytes: source.byteLength,
    sourceSha256: sha256(source),
    localSizeBytes: localStats.size,
    localSha256: sha256(localBuffer),
    sheetSourcePage1: detailsById[unit.uuid].apartmentSheetURLPage1,
    sheetSourcePage2: detailsById[unit.uuid].apartmentSheetURLPage2,
  };
});
const planById = Object.fromEntries(floorplanSources.map((item) => [item.unitId, item]));

const units = placements.map((source, index) => {
  const campaign = source.discount?.stock?.data?.[0] ?? null;
  const currentPrice = campaign?.priceWithDiscount ?? source.totalPrice;
  const normalizedCompletionDate = normalizedDeadlines[source.blockId];
  if (!normalizedCompletionDate) throw new Error(`No normalized deadline for ${source.blockId}`);
  return {
    id: source.uuid,
    number: String(source.name),
    rooms: source.roomCount,
    area: source.square,
    price: currentPrice,
    oldPrice: source.totalPrice,
    totalPriceWithDiscountRaw: source.totalPriceWithDiscount,
    currentPricePerM2: Math.round(currentPrice / source.square),
    sourcePricePerM2: source.priceBySquare,
    currency: 'UZS',
    promotion: campaign ? {
      percent: campaign.percent,
      name: campaign.name,
      deadlineUtc: source.stock?.stockDeadline ?? null,
      discountSum: campaign.discountSum,
      priceWithDiscount: campaign.priceWithDiscount,
    } : null,
    floor: source.floor,
    totalFloors: source.maxFloor,
    entrance: source.entrance,
    buildingId: source.blockId,
    building: source.blockName,
    propertyClass: source.propertyClassName?.[0] ?? 'Бизнес',
    completionDate: normalizedCompletionDate,
    sourcePlacementCompletionDate: source.deadLine,
    plan: planById[source.uuid].local,
    planSourceUrls: {
      photoURL1600: source.photoURL1600,
      photoURL400: source.photoURL400,
      photoURL200: source.photoURL200,
      apartmentSheetURLPage1: detailsById[source.uuid].apartmentSheetURLPage1,
      apartmentSheetURLPage2: detailsById[source.uuid].apartmentSheetURLPage2,
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
      catalogIndex: index + 1,
      api: placementListUrl,
      capturedAt,
      sourceSha256: planById[source.uuid].sourceSha256,
      localSha256: planById[source.uuid].localSha256,
    },
  };
});

const statusSummary = Object.entries(Object.groupBy(units, (unit) => unit.statusOriginal))
  .map(([status, items]) => ({ status, count: items.length }))
  .sort((a, b) => a.status.localeCompare(b.status, 'ru'));
const blocks = estate.blocks
  .filter((block) => units.some((unit) => unit.buildingId === block.id))
  .map((block) => ({
    id: block.id,
    name: block.name,
    count: units.filter((unit) => unit.buildingId === block.id).length,
    deadline: block.deadline,
    rawPlacementDeadline: units.find((unit) => unit.buildingId === block.id).sourcePlacementCompletionDate,
    dduDate: block.dduDate,
    docDate: block.docDate,
  }));

const catalog = {
  project: 'Botanika Saroyi',
  companyId,
  realEstateUUID,
  propertyTypeUUID,
  propertyType: 'Квартира',
  source: officialCatalog,
  sourceLanding: landingRu,
  capturedAt,
  officialTotalAtCapture: units.length,
  currency: 'UZS',
  selectionMethod: 'All 224 apartment rows returned by the official live placementList snapshot, including the single booking row shown in the official total.',
  sourceApis: {
    placementList: { method: 'POST', url: placementListUrl, request: placementRequest, serverDateUtc: placementResponse.serverDateUtc, sha256: sha256(placementResponse.text) },
    realEstateList: { method: 'POST', url: realEstateListUrl, request: realEstateRequest, serverDateUtc: realEstateResponse.serverDateUtc, sha256: sha256(realEstateResponse.text) },
    placementDetail: { method: 'POST', url: placementDetailUrl, requestShape: { placementUUID: '<unit UUID>' }, responseSubsetSha256: sha256(JSON.stringify(details)) },
  },
  integrity: {
    uniqueUnitIds: new Set(units.map((unit) => unit.id)).size,
    uniqueFloorplanUrls: new Set(units.map((unit) => unit.planSourceUrls.photoURL1600)).size,
    reachableFloorplans: floorplanSources.filter((item) => item.sourceHttpStatus === 200).length,
    apartmentSheetUrlsPreserved: details.length * 2,
    isSaleTrue: units.filter((unit) => unit.isSale).length,
    includedNonSaleBooking: units.filter((unit) => !unit.isSale && unit.statusOriginal === 'Бронирование').length,
  },
  filterSummary: {
    rooms: [...new Set(units.map((unit) => unit.rooms))].sort((a, b) => a - b),
    areaMin: Math.min(...units.map((unit) => unit.area)),
    areaMax: Math.max(...units.map((unit) => unit.area)),
    currentPriceMin: Math.min(...units.map((unit) => unit.price)),
    currentPriceMax: Math.max(...units.map((unit) => unit.price)),
    originalPriceMin: Math.min(...units.map((unit) => unit.oldPrice)),
    originalPriceMax: Math.max(...units.map((unit) => unit.oldPrice)),
    sourcePricePerM2Min: Math.min(...units.map((unit) => unit.sourcePricePerM2)),
    sourcePricePerM2Max: Math.max(...units.map((unit) => unit.sourcePricePerM2)),
    floorMin: Math.min(...units.map((unit) => unit.floor)),
    floorMax: Math.max(...units.map((unit) => unit.floor)),
    entrances: [...new Set(units.map((unit) => unit.entrance))].sort((a, b) => a - b),
    blocks,
  },
  statusSummary,
  otherPublishedPropertyTypes: {
    totalAcrossAllTypes: 268,
    apartmentCatalogIncludedHere: 224,
    excludedContextOnly: { parking: 27, storage: 10, townhouses: 6, office: 1 },
  },
  normalizationNotes: [
    'All 224 apartment rows are preserved because the official interface includes them in its total; 223 have isSale=true and one is a booking row with isSale=false.',
    'The internal workflow status is preserved verbatim per unit and translated only in the interface; no row is relabelled as available.',
    'Current campaign price comes from discount.stock.data[0].priceWithDiscount; totalPrice is retained as the original price and discountSum is retained exactly.',
    'placementList.totalPriceWithDiscount equals the undiscounted totalPrice for every row, so that raw field is preserved but never presented as the current campaign price.',
    'The public per-m² range is the source priceBySquare field; currentPricePerM2 is separately derived and not presented as an official source field.',
    'placementList.deadLine is one calendar day earlier than the corresponding realEstateList block.deadline. Public completionDate is normalized from realEstateList and the raw placement date remains sourcePlacementCompletionDate.',
    'The 448 apartment sheet URLs from the detail API are preserved as provenance only. Runtime uses the 224 optimized local primary floorplans.',
    'Parking, storage units, townhouses and the office are excluded from this apartment catalogue.',
  ],
  units,
};

if (catalog.integrity.isSaleTrue !== 223 || catalog.integrity.includedNonSaleBooking !== 1) throw new Error('Unexpected isSale distribution');
if (catalog.filterSummary.currentPriceMin !== 604303532 || catalog.filterSummary.currentPriceMax !== 1470399700) throw new Error('Unexpected campaign price range');

await mkdir(dirname(catalogPath), { recursive: true });
await writeFile(rawPath, `${placementResponse.text.trim()}\n`);
await writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);

const existingManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const manifest = {
  ...existingManifest,
  capturedAt,
  catalog: {
    landingRu,
    landingUz,
    officialCatalog,
    apartmentSnapshot: `${units.length}/${units.length}`,
    rawLocal: '/data/botanika-saroyi-placement-raw.json',
    normalizedLocal: '/data/botanika-saroyi-catalog.json',
    placementListSha256: catalog.sourceApis.placementList.sha256,
    realEstateListSha256: catalog.sourceApis.realEstateList.sha256,
    detailResponseSubsetSha256: catalog.sourceApis.placementDetail.responseSubsetSha256,
    normalizationNotes: catalog.normalizationNotes,
  },
  floorplans: floorplanSources,
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Saved ${units.length}/224 Botanika apartments, ${floorplanSources.length} local plans and ${details.length * 2} sheet provenance URLs.`);
