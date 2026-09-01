import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.env.JOMIY_CAPTURE_ROOT;
if (!root) throw new Error('Set JOMIY_CAPTURE_ROOT to an empty output directory.');
const apiRoot = join(root, 'api');
const detailRoot = join(apiRoot, 'details');
await mkdir(detailRoot, { recursive: true });

const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateUUID = '81153f29-f48b-11ed-a82e-001dd8b726aa';
const propertyTypeUUID = '5990a172-812a-4fee-b4f5-c860cca824d7';
const baseBody = {
  pageNo: 1,
  pageSize: 500,
  companyIds: [companyId],
  realEstateUUIDs: [realEstateUUID],
  propertyTypes: [propertyTypeUUID],
  filterTags: {},
};
const apiBase = 'https://apigw.bi.group/sales-picker/microfe-v3';
const capturedAt = new Date().toISOString();
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(url, { method = 'GET', body } = {}) {
  let latest;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const startedAtUtc = new Date().toISOString();
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json, text/plain, */*',
          ...(body ? { 'content-type': 'application/json' } : {}),
          'user-agent': 'Jomiy snapshot audit/1.0',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60000),
      });
      const buffer = Buffer.from(await response.arrayBuffer());
      latest = {
        response,
        buffer,
        startedAtUtc,
        completedAtUtc: new Date().toISOString(),
      };
      if (response.status >= 200 && response.status < 300) return latest;
    } catch (error) {
      latest = { error };
    }
    await sleep(400 * attempt);
  }
  throw new Error(`Request failed ${url}: ${latest?.response?.status ?? latest?.error}`);
}

async function captureJson({ id, endpoint, body, localPath }) {
  const url = `${apiBase}/${endpoint}`;
  const result = await request(url, { method: 'POST', body });
  if (result.response.status !== 200) throw new Error(`${id} HTTP ${result.response.status}`);
  JSON.parse(result.buffer.toString('utf8'));
  await writeFile(join(root, localPath), result.buffer);
  return {
    id,
    method: 'POST',
    url,
    requestBody: body,
    requestedAtUtc: result.startedAtUtc,
    completedAtUtc: result.completedAtUtc,
    serverDateUtc: result.response.headers.get('date'),
    httpStatus: result.response.status,
    contentType: result.response.headers.get('content-type'),
    localPath,
    bytes: result.buffer.byteLength,
    sha256: sha256(result.buffer),
  };
}

const records = {};
records.placementListPage1 = await captureJson({
  id: 'placementListPage1',
  endpoint: 'placementList',
  body: baseBody,
  localPath: 'api/placement-list-page-1.json',
});
records.placementListPage2 = await captureJson({
  id: 'placementListPage2',
  endpoint: 'placementList',
  body: { ...baseBody, pageNo: 2 },
  localPath: 'api/placement-list-page-2.json',
});
records.filter = await captureJson({
  id: 'filter',
  endpoint: 'filter',
  body: baseBody,
  localPath: 'api/filter.json',
});
records.realEstateList = await captureJson({
  id: 'realEstateList',
  endpoint: 'realEstateList',
  body: { pageNo: 1, pageSize: 500, companyIds: [companyId], realEstateUUIDs: [realEstateUUID] },
  localPath: 'api/real-estate-list.json',
});

const placementJson = JSON.parse(await readFile(join(apiRoot, 'placement-list-page-1.json'), 'utf8'));
const placements = placementJson.placements;
if (!Array.isArray(placements) || placements.length !== 121) throw new Error('Expected 121 placements');
if (new Set(placements.map((item) => item.uuid)).size !== 121) throw new Error('Expected 121 unique UUIDs');

const details = new Array(placements.length);
let cursor = 0;
async function detailWorker() {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= placements.length) return;
    const placement = placements[index];
    const body = { placementUUID: placement.uuid };
    const localPath = `api/details/${placement.uuid}.json`;
    const record = await captureJson({ id: placement.uuid, endpoint: 'placement', body, localPath });
    const raw = JSON.parse(await readFile(join(root, localPath), 'utf8'));
    details[index] = {
      unitId: placement.uuid,
      unitNumber: String(placement.name),
      ...record,
      canBuy: raw.canBuy,
      apartmentSheetExist: raw.apartmentSheetExist,
      apartmentSheetURLPage1: raw.apartmentSheetURLPage1,
      apartmentSheetURLPage2: raw.apartmentSheetURLPage2,
      photoURL1600: raw.photoURL1600,
      placementStatusName: raw.placementStatusName,
      isSale: raw.isSale,
    };
  }
}
await Promise.all(Array.from({ length: 8 }, () => detailWorker()));

records.placementListConfirmation = await captureJson({
  id: 'placementListConfirmation',
  endpoint: 'placementList',
  body: baseBody,
  localPath: 'api/placement-list-confirmation.json',
});

const page2 = JSON.parse(await readFile(join(apiRoot, 'placement-list-page-2.json'), 'utf8'));
const filter = JSON.parse(await readFile(join(apiRoot, 'filter.json'), 'utf8'));
const realEstate = JSON.parse(await readFile(join(apiRoot, 'real-estate-list.json'), 'utf8'));
const confirmation = JSON.parse(await readFile(join(apiRoot, 'placement-list-confirmation.json'), 'utf8'));
const detailRaw = await Promise.all(details.map((record) => readFile(join(root, record.localPath), 'utf8').then(JSON.parse)));

const countBy = (values) => Object.fromEntries(
  [...values.reduce((map, value) => map.set(String(value), (map.get(String(value)) ?? 0) + 1), new Map())]
    .sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true })),
);
const unique = (values) => [...new Set(values)];
const filterEstate = filter.realEstates?.find((item) => item.uuid === realEstateUUID);
const listedEstate = realEstate.realEstates?.find((item) => item.uuid === realEstateUUID);
const filterBlocks = Object.fromEntries((filterEstate?.blocks ?? []).map((block) => [block.id, block]));
const estateBlocks = Object.fromEntries((listedEstate?.blocks ?? []).map((block) => [block.id, block]));
const grouped = unique(placements.map((item) => item.blockId)).map((blockId) => {
  const units = placements.filter((item) => item.blockId === blockId);
  const entrances = unique(units.map((item) => item.entrance)).sort((left, right) => left - right);
  return {
    blockId,
    blockName: units[0].blockName,
    count: units.length,
    entrances: entrances.map((entrance) => ({
      entrance,
      count: units.filter((item) => item.entrance === entrance).length,
      floorsWithListings: unique(units.filter((item) => item.entrance === entrance).map((item) => item.floor)).sort((left, right) => left - right),
      stableRows: 12,
    })),
    normalizedDeadlineFromFilter: filterBlocks[blockId]?.deadline ?? null,
    normalizedDeadlineFromRealEstateList: estateBlocks[blockId]?.deadline ?? null,
    sourcePlacementDeadlines: unique(units.map((item) => item.deadLine)).sort(),
  };
});
const campaigns = unique(placements.map((item) => `${item.blockId}|${item.discount?.stock?.data?.[0]?.percent}|${item.stock?.stockDeadline}`)).map((key) => {
  const sample = placements.find((item) => `${item.blockId}|${item.discount?.stock?.data?.[0]?.percent}|${item.stock?.stockDeadline}` === key);
  const units = placements.filter((item) => `${item.blockId}|${item.discount?.stock?.data?.[0]?.percent}|${item.stock?.stockDeadline}` === key);
  return {
    blockId: sample.blockId,
    blockName: sample.blockName,
    percent: sample.discount?.stock?.data?.[0]?.percent ?? null,
    deadlineUtc: sample.stock?.stockDeadline ?? null,
    count: units.length,
    priceWithDiscountPresent: units.filter((item) => Number.isFinite(item.discount?.stock?.data?.[0]?.priceWithDiscount)).length,
  };
});
const summary = {
  project: 'Jomiy',
  capturedAtUtc: capturedAt,
  captureCompletedAtUtc: new Date().toISOString(),
  companyId,
  realEstateUUID,
  propertyTypeUUID,
  officialApartmentCatalogRows: placements.length,
  uniquePlacementUUIDs: new Set(placements.map((item) => item.uuid)).size,
  page2Rows: page2.placements?.length ?? null,
  exactPage1Confirmation: records.placementListPage1.sha256 === records.placementListConfirmation.sha256,
  confirmationRows: confirmation.placements?.length ?? null,
  statuses: countBy(placements.map((item) => item.placementStatusName)),
  rooms: countBy(placements.map((item) => item.roomCount)),
  isSale: countBy(placements.map((item) => item.isSale)),
  detailCanBuy: countBy(detailRaw.map((item) => item.canBuy)),
  simultaneousIsSaleAndCanBuy: detailRaw.filter((item) => item.isSale && item.canBuy).length,
  strictEligibleOfferCount: placements.filter((item) => item.placementStatusName === 'Свободно').length,
  propertyClasses: countBy(placements.flatMap((item) => item.propertyClassName ?? [])),
  ceilingHeights: countBy(placements.map((item) => item.heightOfWall)),
  isRepaired: countBy(placements.map((item) => item.isRepaired)),
  isStudio: countBy(placements.map((item) => item.isStudio)),
  ranges: {
    area: { min: Math.min(...placements.map((item) => item.square)), max: Math.max(...placements.map((item) => item.square)) },
    rawTotalPrice: { min: Math.min(...placements.map((item) => item.totalPrice)), max: Math.max(...placements.map((item) => item.totalPrice)) },
    floor: { min: Math.min(...placements.map((item) => item.floor)), max: Math.max(...placements.map((item) => item.floor)) },
    maxFloor: unique(placements.map((item) => item.maxFloor)).sort((left, right) => left - right),
  },
  groups: grouped,
  stableMatrix: {
    groupEntranceCombinations: grouped.reduce((sum, group) => sum + group.entrances.length, 0),
    rowsPerCombination: 12,
    totalStableRows: grouped.reduce((sum, group) => sum + group.entrances.length, 0) * 12,
  },
  campaigns,
  allDetailHttp200: details.every((item) => item.httpStatus === 200),
  detailCount: details.length,
  apartmentSheetExistCount: detailRaw.filter((item) => item.apartmentSheetExist).length,
  uniqueApartmentSheetURLPage1: new Set(detailRaw.map((item) => item.apartmentSheetURLPage1)).size,
  uniqueApartmentSheetURLPage2: new Set(detailRaw.map((item) => item.apartmentSheetURLPage2)).size,
  uniquePhotoURL1600: new Set(detailRaw.map((item) => item.photoURL1600)).size,
  placement3dTourPresentCount: detailRaw.filter((item) => item.placement3dTour).length,
  mixedPropertyRealEstatePlacementCount: listedEstate?.placementCount ?? null,
  normalizedDeadlines: grouped.map((group) => ({
    blockId: group.blockId,
    blockName: group.blockName,
    filter: group.normalizedDeadlineFromFilter,
    realEstateList: group.normalizedDeadlineFromRealEstateList,
    placement: group.sourcePlacementDeadlines,
  })),
};
const apiManifest = {
  project: 'Jomiy',
  capturedAtUtc: capturedAt,
  captureCompletedAtUtc: summary.captureCompletedAtUtc,
  identifiers: { companyId, realEstateUUID, propertyTypeUUID },
  rawResponses: records,
  detailEndpoint: `${apiBase}/placement`,
  detailCount: details.length,
  details,
};
await writeFile(join(root, 'api-manifest.json'), `${JSON.stringify(apiManifest, null, 2)}\n`);
await writeFile(join(root, 'derived-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ root, summary, aggregateRecords: records }, null, 2));
