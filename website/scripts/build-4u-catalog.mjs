import { createHash } from 'node:crypto';
import { writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditNrgPlanAssets,
  expectedNrgOriginalUrl,
  expectedNrgPlanUrl,
  fetchNrgPlanDetails,
} from '../../scripts/live-sync/src/nrg-plan-assets.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = resolve(websiteRoot, 'data/4u-catalog.json');
const auditPath = resolve(websiteRoot, 'data/4u-plan-audit.json');
const placementListUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placementList';
const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateUUID = 'c8945ad5-c737-42a6-a5c6-aa00375d3717';
const propertyTypeUUID = '5990a172-812a-4fee-b4f5-c860cca824d7';
const requestBody = Object.freeze({
  pageNo: 1,
  pageSize: 300,
  companyIds: [companyId],
  realEstateUUIDs: [realEstateUUID],
  propertyTypes: [propertyTypeUUID],
  filterTags: {},
});
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function postPlacementList() {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(placementListUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Residence 4U catalogue builder/1.0' },
        body: JSON.stringify(requestBody),
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        if (retryableStatuses.has(response.status) && attempt < 4) continue;
        throw new Error(`placementList returned HTTP ${response.status}`);
      }
      const text = await response.text();
      const value = JSON.parse(text);
      return {
        value,
        response: {
          status: response.status,
          mimeType: String(response.headers.get('content-type') ?? '').split(';', 1)[0].toLowerCase(),
          serverDate: response.headers.get('date'),
          bytes: Buffer.byteLength(text),
          sha256: sha256(text),
        },
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function quarter(dateValue) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateValue ?? ''));
  assert(match, `Invalid 4U completion date ${JSON.stringify(dateValue)}`);
  return `${Math.ceil(Number(match[2]) / 3)} кв. ${match[1]}`;
}

function positive(value, label) {
  const number = Number(value);
  assert(Number.isFinite(number) && number > 0, `${label} is invalid`);
  return number;
}

function currentPrice(row) {
  const campaign = row?.discount?.stock?.data?.find((item) => Number(item?.priceWithDiscount) > 0);
  return positive(campaign?.priceWithDiscount ?? row.totalPriceWithDiscount ?? row.totalPrice, `4U ${row.uuid} price`);
}

function normalizeUnit(row, asset, capturedAt) {
  const list1600 = asset.variants.find((item) => item.variant === 1600);
  assert(asset.original?.ok && asset.selectedOriginalUrl === expectedNrgOriginalUrl(row), `4U ${row.uuid} has no verified detail original`);
  assert(list1600?.ok && list1600.url === expectedNrgPlanUrl(row, 1600), `4U ${row.uuid} has no verified 1600px preview`);
  const price = currentPrice(row);
  return {
    id: row.uuid,
    sourceKey: `nrg-bi:4u:${row.uuid}`,
    number: String(row.name),
    rooms: positive(row.roomCount, `4U ${row.uuid} roomCount`),
    area: positive(row.square, `4U ${row.uuid} square`),
    price,
    oldPrice: positive(row.totalPrice, `4U ${row.uuid} totalPrice`),
    phase: String(row.blockName),
    blockId: String(row.blockId),
    floor: positive(row.floor, `4U ${row.uuid} floor`),
    maxFloor: positive(row.maxFloor, `4U ${row.uuid} maxFloor`),
    entrance: String(row.entrance ?? ''),
    completion: quarter(row.deadLine),
    planImageUrl: asset.selectedOriginalUrl,
    planOriginalUrl: asset.selectedOriginalUrl,
    planPreviewUrl: list1600.url,
    planThumbnailUrl: expectedNrgPlanUrl(row, 200),
    planMimeType: asset.original.mimeType,
    planWidth: asset.original.width,
    planHeight: asset.original.height,
    planBytes: asset.original.bytes,
    planSha256: asset.original.sha256,
    status: 'available',
    sourceUpdatedAt: capturedAt,
  };
}

async function atomicWrite(path, body) {
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, body, { mode: 0o644 });
  await rename(temporary, path);
}

export async function build4uCatalog() {
  const source = await postPlacementList();
  assert(source.response.status === 200 && source.response.mimeType === 'application/json', '4U placementList response contract changed');
  const rows = source.value?.placements;
  assert(Array.isArray(rows) && rows.length > 0 && rows.length <= requestBody.pageSize, '4U placementList has an invalid row count');
  assert(new Set(rows.map((row) => row?.uuid)).size === rows.length, '4U placement UUIDs are not unique');
  assert(rows.every((row) => row?.realEstateUUID === realEstateUUID && row?.propertyType?.uuid === propertyTypeUUID), '4U placementList contains a foreign project or property type');
  const activeRows = rows.filter((row) => row?.isSale === true);
  assert(activeRows.length > 0, '4U placementList has no active apartments');
  const capturedAt = source.response.serverDate && Number.isFinite(Date.parse(source.response.serverDate))
    ? new Date(source.response.serverDate).toISOString()
    : new Date().toISOString();
  const originalSources = await fetchNrgPlanDetails(rows);
  const { audit: planAudit } = await auditNrgPlanAssets(rows, { capturedAt, originalSources });
  assert(planAudit.auditedUnitCount === activeRows.length && planAudit.verifiedOriginals === activeRows.length && planAudit.missingOriginals === 0, '4U detail-original coverage is incomplete; last-known-good catalogue was not changed');
  assert(planAudit.variants['1600'].valid === activeRows.length, '4U card-preview coverage is incomplete; last-known-good catalogue was not changed');
  const auditById = new Map(planAudit.units.map((item) => [item.unitId, item]));
  const units = activeRows.map((row) => normalizeUnit(row, auditById.get(row.uuid), capturedAt));
  const catalog = {
    capturedAt,
    officialTotalAtCapture: activeRows.length,
    selectionMethod: 'All active apartments from the official NRG/BI placementList (isSale === true).',
    source: placementListUrl,
    planAssetPolicy: 'Cards use the validated 1600px list image; the lightbox uses the validated suffixless detail original.',
    units,
  };
  const audit = {
    ...planAudit,
    source: {
      endpoint: placementListUrl,
      method: 'POST',
      request: requestBody,
      response: source.response,
      sourceRows: rows.length,
      activeRows: activeRows.length,
      activeIdentityCount: new Set(activeRows.map((row) => row.uuid)).size,
    },
  };
  // Both outputs are materialized only after full source and asset validation.
  // The runtime live-sync uses the same validator and preserves its database
  // URL on any later failure, so this checked-in snapshot is the offline LKG.
  await atomicWrite(auditPath, json(audit));
  await atomicWrite(catalogPath, json(catalog));
  return { catalog, audit };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await build4uCatalog();
  process.stdout.write(`4U catalogue rebuilt: ${result.catalog.units.length} active units, ${result.audit.verifiedOriginals} detail originals, ${result.audit.variants['1600'].valid} card previews.\n`);
}
