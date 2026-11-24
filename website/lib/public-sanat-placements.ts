const upstream = 'https://apigw.bi.group/sales-picker/microfe-v3/placementList';
const companyId = '5cba02b4-8abd-11ee-ab79-001dd8b7289a';
const realEstateId = 'f318fc96-8c05-40df-a695-6de9b9a695c0';
const propertyType = '5990a172-812a-4fee-b4f5-c860cca824d7';
const requestLimit = 4096;
const responseLimit = 4 * 1024 * 1024;

export class PlacementInputError extends Error {
  status: number;
  constructor(status: number) { super('invalid_catalog_request'); this.status = status; }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const scalarFields = ['uuid', 'realEstateUUID', 'roomCount', 'name', 'square', 'floor', 'entrance',
  'priceBySquare', 'maxFloor', 'deadLine', 'blockName', 'blockId', 'totalPrice', 'totalPriceWithDiscount',
  'placementStatusName', 'placementStatusId', 'realEstateName'];
const imageFields = ['photoURL200', 'photoURL400', 'photoURL1600', 'floorPlanURL200', 'floorPlanURL400', 'floorPlanURL1600'];

export function publicSanatPlacements(value: unknown) {
  if (!record(value) || !Array.isArray(value.placements) || value.placements.length > 200) throw Error('Invalid catalog source');
  const placements = value.placements.map(source => {
    if (!record(source) || typeof source.realEstateUUID !== 'string' || source.realEstateUUID.toLowerCase() !== realEstateId) throw Error('Unexpected catalog project');
    const item: Record<string, unknown> = {};
    for (const key of scalarFields) {
      const field = source[key];
      if (field === null) item[key] = null;
      else if (typeof field === 'string' && field.length <= 180) item[key] = field;
      else if (typeof field === 'number' && Number.isFinite(field)) item[key] = field;
    }
    // The public catalogue filters on this exact availability boolean.
    // Do not coerce malformed values or expose any other boolean metadata.
    if (typeof source.isSale === 'boolean') item.isSale = source.isSale;
    for (const key of imageFields) {
      const field = source[key];
      if (field === null) { item[key] = null; continue; }
      if (typeof field !== 'string' || field.length > 4096) continue;
      try {
        const image = new URL(field);
        if (image.protocol === 'https:' && !image.username && !image.password) item[key] = image.href;
      } catch { /* An invalid source image is omitted rather than turned into a link. */ }
    }
    for (const key of ['propertyType', 'layoutType']) {
      if (!record(source[key])) continue;
      const field: Record<string, string> = {};
      for (const name of ['uuid', 'name']) if (typeof source[key][name] === 'string' && source[key][name].length <= 180) field[name] = source[key][name];
      item[key] = field;
    }
    return item;
  });
  // Booking/customer objects, favourites, commercial scoring and raw discount
  // metadata are intentionally absent from the anonymous catalog contract.
  return { placements, parkingSchemes: null };
}

export function sanatPlacementInput(value: unknown) {
  if (!record(value) || Object.keys(value).some(key => !['companyIds', 'realEstateUUIDs', 'propertyTypes', 'pageNo', 'pageSize'].includes(key))) throw new PlacementInputError(400);
  for (const [key, expected] of [['companyIds', companyId], ['realEstateUUIDs', realEstateId], ['propertyTypes', propertyType]]) {
    const actual = value[key];
    if (!Array.isArray(actual) || actual.length !== 1 || actual[0] !== expected) throw new PlacementInputError(400);
  }
  if (!Number.isInteger(value.pageNo) || Number(value.pageNo) < 1 || Number(value.pageNo) > 100
      || !Number.isInteger(value.pageSize) || Number(value.pageSize) < 1 || Number(value.pageSize) > 200) throw new PlacementInputError(400);
  // Construct the upstream body independently; never forward arbitrary filters.
  return { companyIds: [companyId], realEstateUUIDs: [realEstateId], propertyTypes: [propertyType],
    pageNo: Number(value.pageNo), pageSize: Number(value.pageSize) };
}

async function boundedBytes(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) throw new PlacementInputError(400);
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > limit) { await reader.cancel(); throw new PlacementInputError(413); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return bytes;
}

export async function requestSanatPlacements(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new PlacementInputError(415);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > requestLimit)) throw new PlacementInputError(413);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new PlacementInputError(403);
  const origin = request.headers.get('origin');
  const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL || 'https://form.tencorp.uz').replace(/\/+$/, '');
  if (origin && origin !== siteOrigin) throw new PlacementInputError(403);
  let data: unknown;
  try { data = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, requestLimit))); }
  catch (error) { if (error instanceof PlacementInputError) throw error; throw new PlacementInputError(400); }
  const input = sanatPlacementInput(data);
  const response = await fetch(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw Error('Catalog source unavailable');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > responseLimit)) throw Error('Catalog source unavailable');
  let bytes: Uint8Array;
  try { bytes = await boundedBytes(response.body, responseLimit); }
  catch { throw Error('Catalog source unavailable'); }
  return publicSanatPlacements(JSON.parse(new TextDecoder().decode(bytes)));
}
