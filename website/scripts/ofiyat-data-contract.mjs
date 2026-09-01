import { createHash } from 'node:crypto';

export const OFIYAT_CAPTURE_RELATIVE_PATH = 'backend/data/raw/kayan/captures/ofiyat/2026-09-01/visible-inventory.json';
export const OFIYAT_SOURCE_RENDER_SHA256 = 'fb8a9e4ae0abd1b8ecd9ea8313c75fe874c7060bb2a0451d8df4b16f4f74424c';
export const OFIYAT_SOURCE_MASK_SHA256 = '1e84693660fbbccf32766c275dc92c392722334102b38dad92890dfc152afbc9';
export const OFIYAT_SOURCE_ANNOTATION_SHA256 = 'e4b9c891cb7c420127f49e28ada646992527dd22c65a11603ffd84de2dc308bb';
export const OFIYAT_VIEW_BOX = '0 0 4096 2359';

export const OFIYAT_BLOCK_PATH_MAP = Object.freeze({
  1: 1,
  2: 7,
  3: 2,
  4: 3,
  5: 4,
  6: 6,
  7: 5,
});

const SOURCE_PATH_TO_BLOCK = new Map(
  Object.entries(OFIYAT_BLOCK_PATH_MAP).map(([block, sourcePath]) => [sourcePath, Number(block)]),
);

const EXPECTED_COLUMNS = [
  'type',
  'crmStatus',
  'number',
  'priceOrStatus',
  'entrance',
  'floor',
  'houseName',
  'projectName',
  'areaM2',
  'rooms',
];

export const OFIYAT_STATUS_NORMALIZATION = Object.freeze({
  'Свободно': 'available',
  'Бронь': 'reserved',
  'Договор согласован': 'reserved',
  'Договор составлен': 'reserved',
  'Продано': 'sold',
  'Закрыто': 'unavailable',
  'Руководство': 'unavailable',
});

export const OFIYAT_PHASE_CONFIG = Object.freeze({
  'phase-1': Object.freeze({
    houseName: 'I очередь',
    propertyType: 'apartment',
    rawPropertyType: 'Квартира',
    total: 245,
    entrances: Object.freeze({ 'А': 78, 'Б1': 52, 'Б2': 65, 'Г1': 50 }),
    floors: Object.freeze(Array.from({ length: 13 }, (_, index) => String(index + 3))),
  }),
  'phase-2': Object.freeze({
    houseName: 'II очередь',
    propertyType: 'apartment',
    rawPropertyType: 'Квартира',
    total: 169,
    entrances: Object.freeze({ 'В1': 52, 'В2': 65, 'Г2': 52 }),
    floors: Object.freeze(Array.from({ length: 13 }, (_, index) => String(index + 3))),
  }),
  parking: Object.freeze({
    houseName: 'Паркинг',
    propertyType: 'parking',
    rawPropertyType: 'Машиноместо',
    total: 171,
    entrances: Object.freeze({ '1': 26, '2': 27, '3': 20, '4': 24, '5': 24, '6': 24, '7': 26 }),
    floors: Object.freeze(['-2', '-1']),
  }),
});

export function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value, context) {
  if (!isRecord(value)) throw new Error(`${context} must be an object`);
}

function assertExactKeys(value, expected, context) {
  assertRecord(value, context);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${context} has unexpected fields: ${actual.join(', ')}`);
  }
}

function exactJSON(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function countBy(records, field) {
  const result = {};
  for (const record of records) result[record[field]] = (result[record[field]] ?? 0) + 1;
  return result;
}

function sortedObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right, 'ru', { numeric: true })));
}

function parseCanonicalNumber(value, context) {
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error(`${context} is not a canonical integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${context} is outside the safe integer range`);
  return parsed;
}

function parseCanonicalArea(value, context) {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`${context} is not a canonical area`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${context} must be positive`);
  return parsed;
}

function parsePrice(value, context) {
  if (typeof value !== 'string' || !/^\d{1,3}(?: \d{3})* сум$/.test(value)) throw new Error(`${context} is not a canonical UZS price`);
  const parsed = Number(value.slice(0, -4).replaceAll(' ', ''));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${context} must be a positive safe integer`);
  return parsed;
}

export function ofiyatTupleKey(phaseSlug, entrance, floor, number) {
  return [phaseSlug, entrance, String(floor), number].join('\u001f');
}

export function validateOfiyatCapture(capture) {
  assertExactKeys(capture, ['schemaVersion', 'projectSlug', 'capturedAt', 'source', 'columns', 'statusNormalization', 'phases'], 'Ofiyat visible inventory capture');
  if (capture.schemaVersion !== 1 || capture.projectSlug !== 'ofiyat' || !Number.isFinite(Date.parse(capture.capturedAt))) {
    throw new Error('Ofiyat visible inventory capture identity or timestamp is invalid');
  }
  if (!exactJSON(capture.columns, EXPECTED_COLUMNS)) throw new Error('Ofiyat visible inventory columns changed');
  if (!exactJSON(capture.statusNormalization, OFIYAT_STATUS_NORMALIZATION)) throw new Error('Ofiyat status normalization changed');
  assertRecord(capture.source, 'Ofiyat capture source');
  if (capture.source.kind !== 'authenticated-visible-ui' || capture.source.access !== 'read-only' || typeof capture.source.privacy !== 'string' || !capture.source.privacy.includes('No cookies')) {
    throw new Error('Ofiyat capture is missing read-only privacy provenance');
  }
  if (!Array.isArray(capture.phases) || capture.phases.length !== 3) throw new Error('Ofiyat capture must contain exactly three phases');

  const phaseSlugs = capture.phases.map((phase) => phase?.phaseSlug);
  if (!exactJSON(phaseSlugs, ['phase-1', 'phase-2', 'parking'])) throw new Error('Ofiyat capture phase order or identity changed');

  const records = [];
  const seenTuples = new Set();
  for (const phase of capture.phases) {
    assertExactKeys(phase, ['phaseSlug', 'houseName', 'summary', 'rows'], `Ofiyat ${phase?.phaseSlug ?? 'unknown'} capture`);
    const config = OFIYAT_PHASE_CONFIG[phase.phaseSlug];
    if (!config || phase.houseName !== config.houseName || !Array.isArray(phase.rows) || phase.rows.length !== config.total) {
      throw new Error(`Ofiyat ${phase.phaseSlug} identity or record count is invalid`);
    }
    assertExactKeys(phase.summary, ['total', 'crmStatus', 'normalizedStatus', 'entrance', 'floors', 'priced'], `Ofiyat ${phase.phaseSlug} summary`);

    const phaseRecords = phase.rows.map((row, rowIndex) => {
      if (!Array.isArray(row) || row.length !== EXPECTED_COLUMNS.length || row.some((field) => typeof field !== 'string')) {
        throw new Error(`Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} is malformed`);
      }
      const [rawPropertyType, rawStatus, number, priceOrStatus, entrance, floorText, houseName, projectName, areaText, roomsText] = row;
      const status = OFIYAT_STATUS_NORMALIZATION[rawStatus];
      if (!status) throw new Error(`Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} has unknown status ${rawStatus}`);
      if (rawPropertyType !== config.rawPropertyType || houseName !== config.houseName || projectName !== 'Ofiyat' || !(entrance in config.entrances) || !config.floors.includes(floorText) || !/^\d+$/.test(number)) {
        throw new Error(`Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} has inconsistent project structure`);
      }
      const floor = parseCanonicalNumber(floorText, `Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} floor`);
      const area = parseCanonicalArea(areaText, `Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} area`);
      const rooms = roomsText === '-' ? undefined : parseCanonicalNumber(roomsText, `Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} rooms`);
      if ((config.propertyType === 'parking') !== (rooms === undefined)) throw new Error(`Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} room/property type mismatch`);
      const price = status === 'available'
        ? parsePrice(priceOrStatus, `Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} price`)
        : undefined;
      if (status !== 'available' && priceOrStatus !== rawStatus) throw new Error(`Ofiyat ${phase.phaseSlug} row ${rowIndex + 1} invents a price for a non-available unit`);
      const tuple = ofiyatTupleKey(phase.phaseSlug, entrance, floor, number);
      if (seenTuples.has(tuple)) throw new Error(`Ofiyat capture contains duplicate full tuple ${tuple}`);
      seenTuples.add(tuple);
      return {
        tuple,
        phaseSlug: phase.phaseSlug,
        phaseName: config.houseName,
        propertyType: config.propertyType,
        rawPropertyType,
        rawStatus,
        status,
        number,
        entrance,
        floor,
        area,
        rooms,
        price,
      };
    });

    const normalizedStatus = countBy(phaseRecords, 'status');
    const crmStatus = countBy(phaseRecords, 'rawStatus');
    const entrance = countBy(phaseRecords, 'entrance');
    if (
      phase.summary.total !== config.total
      || phase.summary.priced !== phaseRecords.filter((record) => record.price !== undefined).length
      || !exactJSON(sortedObject(phase.summary.crmStatus), sortedObject(crmStatus))
      || !exactJSON(sortedObject(phase.summary.normalizedStatus), sortedObject(normalizedStatus))
      || !exactJSON(sortedObject(phase.summary.entrance), sortedObject(entrance))
      || !exactJSON(phase.summary.floors, config.floors)
      || !exactJSON(sortedObject(entrance), sortedObject(config.entrances))
    ) {
      throw new Error(`Ofiyat ${phase.phaseSlug} summary does not equal its full rows`);
    }
    records.push(...phaseRecords);
  }
  if (records.length !== 585 || seenTuples.size !== 585) throw new Error('Ofiyat capture is not the exact 585-unit full tuple universe');
  return { capturedAt: capture.capturedAt, records, byTuple: new Map(records.map((record) => [record.tuple, record])) };
}

function roundMoneyPerArea(price, area) {
  return Math.round((price / area) * 100) / 100;
}

export function applyOfiyatCaptureToCatalog(catalog, capture, localAssets) {
  const verifiedCapture = validateOfiyatCapture(capture);
  const next = structuredClone(catalog);
  const bundle = next.projects?.find((item) => item?.project?.slug === 'ofiyat');
  if (!bundle || !Array.isArray(bundle.units) || !Array.isArray(bundle.layouts)) throw new Error('Ofiyat bundle is missing from the production catalogue');
  if (bundle.units.length !== 585) throw new Error(`Ofiyat production catalogue has ${bundle.units.length} units, expected 585`);
  const seenSourceKeys = new Set();
  const seenTuples = new Set();
  for (const unit of bundle.units) {
    const tuple = ofiyatTupleKey(unit.phaseSlug, unit.entrance, unit.floor, unit.number);
    const fresh = verifiedCapture.byTuple.get(tuple);
    if (!fresh) throw new Error(`Ofiyat production unit ${tuple} is absent from the fresh full capture`);
    if (seenTuples.has(tuple)) throw new Error(`Ofiyat production catalogue contains duplicate full tuple ${tuple}`);
    if (typeof unit.sourceKey !== 'string' || !unit.sourceKey || seenSourceKeys.has(unit.sourceKey)) throw new Error(`Ofiyat production unit ${tuple} has a duplicate or empty sourceKey`);
    seenTuples.add(tuple);
    seenSourceKeys.add(unit.sourceKey);
    if (
      unit.projectSlug !== 'ofiyat'
      || unit.phaseName !== fresh.phaseName
      || unit.propertyType !== fresh.propertyType
      || unit.rawPropertyType !== fresh.rawPropertyType
      || unit.area !== fresh.area
      || unit.rooms !== fresh.rooms
    ) {
      throw new Error(`Ofiyat production unit ${tuple} differs structurally from the fresh capture`);
    }
    unit.status = fresh.status;
    unit.rawStatus = fresh.rawStatus;
    unit.sourceUpdatedAt = verifiedCapture.capturedAt;
    unit.updatedAt = verifiedCapture.capturedAt;
    delete unit.planImageUrl;
    if (fresh.price === undefined) {
      delete unit.price;
      delete unit.pricePerM2;
    } else {
      unit.price = fresh.price;
      unit.pricePerM2 = roundMoneyPerArea(fresh.price, fresh.area);
    }
  }
  if (seenTuples.size !== verifiedCapture.records.length) throw new Error('Ofiyat production catalogue does not cover the fresh full capture exactly');

  if (!localAssets || !(localAssets.phaseImages instanceof Map) || !(localAssets.layouts instanceof Map)) {
    throw new Error('Ofiyat local asset maps are required');
  }
  const phaseCounts = new Map();
  for (const record of verifiedCapture.records) {
    const status = phaseCounts.get(record.phaseSlug) ?? { total: 0, available: 0 };
    status.total += 1;
    if (record.status === 'available') status.available += 1;
    phaseCounts.set(record.phaseSlug, status);
  }
  for (const phase of bundle.project.phases) {
    const counts = phaseCounts.get(phase.slug);
    const localImage = localAssets.phaseImages.get(phase.slug);
    if (!counts || !localImage) throw new Error(`Ofiyat phase ${phase.slug} has no fresh counts or local image`);
    phase.totalUnits = counts.total;
    phase.availableUnits = counts.available;
    phase.updatedAt = verifiedCapture.capturedAt;
    phase.imageUrl = localImage;
  }
  bundle.project.totalUnits = verifiedCapture.records.length;
  bundle.project.availableUnits = verifiedCapture.records.filter((record) => record.status === 'available').length;
  bundle.project.updatedAt = verifiedCapture.capturedAt;

  if (bundle.layouts.length !== 261) throw new Error(`Ofiyat catalogue has ${bundle.layouts.length} representative layouts, expected 261`);
  const seenLayoutKeys = new Set();
  for (const layout of bundle.layouts) {
    const key = `${layout.phaseSlug}\u001f${layout.sourceId}`;
    const localImage = localAssets.layouts.get(key);
    if (!localImage || seenLayoutKeys.has(key)) throw new Error(`Ofiyat layout ${key} has no unique local representative image`);
    seenLayoutKeys.add(key);
    layout.imageUrl = localImage;
    layout.thumbnailUrl = localImage;
  }
  if (seenLayoutKeys.size !== localAssets.layouts.size) throw new Error('Ofiyat local layout manifest differs from the 261 production layouts');
  next.generatedAt = verifiedCapture.capturedAt;
  return next;
}

export function validateFreshOfiyatCatalog(catalog, capture, manifest) {
  const verifiedCapture = validateOfiyatCapture(capture);
  const bundle = catalog.projects?.find((item) => item?.project?.slug === 'ofiyat');
  if (!bundle || bundle.units?.length !== 585 || bundle.layouts?.length !== 261) throw new Error('Fresh Ofiyat catalogue bundle is incomplete');
  if (!Number.isFinite(Date.parse(catalog.generatedAt)) || Date.parse(catalog.generatedAt) < Date.parse(verifiedCapture.capturedAt) || bundle.project.updatedAt !== verifiedCapture.capturedAt) throw new Error('Fresh Ofiyat catalogue timestamps do not identify the audited capture');
  const manifestPhasePaths = new Map(manifest.catalogAssets.assets.filter((asset) => asset.kind === 'phase').map((asset) => [asset.phaseSlug, asset.output.publicPath]));
  const manifestLayoutPaths = new Map(manifest.catalogAssets.assets.filter((asset) => asset.kind === 'representative-layout').map((asset) => [`${asset.phaseSlug}\u001f${asset.sourceId}`, asset.output.publicPath]));
  const seenSourceKeys = new Set();
  const seenTuples = new Set();
  for (const unit of bundle.units) {
    const tuple = ofiyatTupleKey(unit.phaseSlug, unit.entrance, unit.floor, unit.number);
    const fresh = verifiedCapture.byTuple.get(tuple);
    if (!fresh || seenTuples.has(tuple) || seenSourceKeys.has(unit.sourceKey)) throw new Error(`Fresh Ofiyat catalogue has missing or duplicate unit identity ${tuple}`);
    seenTuples.add(tuple);
    seenSourceKeys.add(unit.sourceKey);
    if (unit.status !== fresh.status || unit.rawStatus !== fresh.rawStatus || unit.sourceUpdatedAt !== verifiedCapture.capturedAt || unit.updatedAt !== verifiedCapture.capturedAt) throw new Error(`Fresh Ofiyat status/timestamp mismatch for ${tuple}`);
    if (Object.hasOwn(unit, 'planImageUrl')) throw new Error(`Ofiyat exact plan must remain absent without strict association: ${tuple}`);
    if (fresh.price === undefined) {
      if (Object.hasOwn(unit, 'price') || Object.hasOwn(unit, 'pricePerM2')) throw new Error(`Fresh Ofiyat non-available unit ${tuple} has an invented price`);
    } else if (unit.price !== fresh.price || unit.pricePerM2 !== roundMoneyPerArea(fresh.price, fresh.area)) {
      throw new Error(`Fresh Ofiyat price mismatch for ${tuple}`);
    }
  }
  if (seenTuples.size !== 585 || seenSourceKeys.size !== 585) throw new Error('Fresh Ofiyat catalogue unit identity universe is incomplete');

  const expectedAvailable = Object.fromEntries(capture.phases.map((phase) => [phase.phaseSlug, phase.summary.normalizedStatus.available]));
  if (bundle.project.availableUnits !== Object.values(expectedAvailable).reduce((sum, value) => sum + value, 0)) throw new Error('Fresh Ofiyat project available count is stale');
  for (const phase of bundle.project.phases) {
    if (phase.availableUnits !== expectedAvailable[phase.slug] || phase.imageUrl !== manifestPhasePaths.get(phase.slug) || /^https?:\/\//.test(phase.imageUrl)) throw new Error(`Fresh Ofiyat phase ${phase.slug} is stale or remote`);
  }
  for (const layout of bundle.layouts) {
    const key = `${layout.phaseSlug}\u001f${layout.sourceId}`;
    const expectedPath = manifestLayoutPaths.get(key);
    if (!expectedPath || layout.imageUrl !== expectedPath || layout.thumbnailUrl !== expectedPath || /^https?:\/\//.test(layout.imageUrl)) throw new Error(`Fresh Ofiyat layout ${key} is missing its local representative asset`);
  }
  if (manifestLayoutPaths.size !== 261 || manifestPhasePaths.size !== 3) throw new Error('Ofiyat local asset manifest has unexpected catalogue counts');
  return { bundle, verifiedCapture };
}

export function extractOfiyatSourcePaths(sourceSvg) {
  if (typeof sourceSvg !== 'string' || !sourceSvg.includes(`<svg width="4096" height="2359" viewBox="${OFIYAT_VIEW_BOX}"`)) throw new Error('Ofiyat source SVG dimensions/viewBox changed');
  const rects = [...sourceSvg.matchAll(/<rect\b[^>]*>/g)];
  const paths = [...sourceSvg.matchAll(/<path d="([^"]+)" fill="black" fill-opacity="0\.5"\/>/g)].map((match) => match[1]);
  if (rects.length !== 1 || !rects[0][0].includes('fill="white"') || paths.length !== 7) throw new Error('Ofiyat source SVG must contain one white rect and seven original paths');
  return paths;
}

export function buildOfiyatProductionMask(sourceSvg) {
  const paths = extractOfiyatSourcePaths(sourceSvg);
  const body = paths.map((d, index) => {
    const sourcePath = index + 1;
    const block = SOURCE_PATH_TO_BLOCK.get(sourcePath);
    if (!block) throw new Error(`Ofiyat source path ${sourcePath} has no evidence-backed visual block`);
    return `<path id="path-${sourcePath}" data-source-path="${sourcePath}" data-block="${block}" d="${d}" fill="currentColor"/>`;
  }).join('\n');
  return `<svg width="4096" height="2359" viewBox="${OFIYAT_VIEW_BOX}" fill="none" xmlns="http://www.w3.org/2000/svg">\n${body}\n</svg>\n`;
}

export function validateOfiyatProductionMask(mask, sourceSvg) {
  const expected = buildOfiyatProductionMask(sourceSvg);
  if (mask !== expected) throw new Error('Ofiyat production mask changed source geometry, mapping, or canonical bytes');
  if (/<rect\b/.test(mask) || (mask.match(/<path\b/g) ?? []).length !== 7) throw new Error('Ofiyat production mask must omit the white rect and retain exactly seven paths');
  return true;
}

export function createOfiyatUnavailableFloorSidecar(capturedAt) {
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('Ofiyat floor sidecar requires a valid read-only observation timestamp');
  return {
    schemaVersion: 3,
    projectSlug: 'ofiyat',
    capturedAt,
    captureStatus: 'not-published-by-source',
    captureScope: {
      mode: 'unavailable',
      declaredBlocks: [],
      declaredEntrances: [],
      declaredFloors: [],
      declaredUnitHotspots: [],
      schemeCount: 0,
      hotspotCount: 0,
      auditedExclusions: [{
        kind: 'all-floor-schemes',
        reason: 'not-published-by-source',
        evidence: 'Authenticated read-only inspection of both Ofiyat residential phases exposed chessboard, enhanced chessboard, premises and layouts, but no published floor-plan view, floor canvases or apartment hotspot geometry.',
      }],
    },
    sourceStatus: 'captured-read-only',
    sourceObservedAt: capturedAt,
    floorSchemeCount: 0,
    hotspotCount: 0,
    blockEntranceMapping: null,
    schemes: [],
    expectedUniverse: null,
    companionEvidence: null,
  };
}

export function validateOfiyatUnavailableFloorSidecar(sidecar, capturedAt) {
  const expected = createOfiyatUnavailableFloorSidecar(capturedAt);
  if (!exactJSON(sidecar, expected)) throw new Error('Ofiyat unavailable floor-scheme sidecar differs from the audited schemaVersion 3 zero contract');
  return true;
}
