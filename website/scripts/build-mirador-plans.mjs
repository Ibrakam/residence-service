import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');
const mappingPath = resolve(repositoryRoot, process.env.MIRADOR_PLAN_MAPPING_PATH ?? 'backend/data/raw/kayan/mappings/mirador-plans.json');
const floorSchemeMappingPath = resolve(repositoryRoot, process.env.MIRADOR_FLOOR_MAPPING_PATH ?? 'backend/data/raw/kayan/mappings/mirador-floor-schemes.json');
const catalogPath = resolve(websiteRoot, 'data/kayan-catalog.json');
const floorSchemeClientPath = resolve(websiteRoot, 'data/mirador-floor-schemes.json');
const publicRoot = resolve(websiteRoot, 'public');
const checkOnly = process.argv.includes('--check');
const prepareFloorSchemes = process.argv.includes('--prepare-floor-schemes');
const auditCaptureOnly = process.argv.includes('--audit-capture');
if ([checkOnly, prepareFloorSchemes, auditCaptureOnly].filter(Boolean).length > 1) throw new Error('--check, --prepare-floor-schemes and --audit-capture are mutually exclusive');
if (process.argv.some((argument) => argument.startsWith('--') && !['--check', '--prepare-floor-schemes', '--audit-capture'].includes(argument))) throw new Error(`Unknown argument: ${process.argv.find((argument) => argument.startsWith('--') && !['--check', '--prepare-floor-schemes', '--audit-capture'].includes(argument))}`);

const expectedPublishedMirador = Object.freeze({
  projectUpdatedAt: '2026-08-29T08:46:56.739Z',
  bundleSha256: 'd30ca24b6bae2338e47a6cd604a60059f20a9a627c95aa7891ca0e28c083777f',
  planAssetSetSha256: 'bca7559e16f8e7fb9a252d2e87cfbee631a1d574076260cdcc73dd01c3328b31',
  floorSidecarSha256: '79965c4d64c03946eede1502a3f907021ae479c1e650c0c81336db40fece54eb',
  floorCapturedAt: '2026-08-31T17:49:54Z',
});

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function canonicalJSON(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function assertPublishedFileHash(relativePath, expectedHash) {
  const body = await readFile(resolve(publicRoot, relativePath));
  if (sha256(body) !== expectedHash) throw new Error(`Published Mirador asset hash mismatch: ${relativePath}`);
}

async function runMiradorDeployCheck() {
  const [catalogBody, sidecarBody] = await Promise.all([readFile(catalogPath), readFile(floorSchemeClientPath)]);
  const catalog = JSON.parse(catalogBody.toString('utf8'));
  const sidecar = JSON.parse(sidecarBody.toString('utf8'));
  const publishedBundle = catalog.projects?.find((item) => item?.project?.slug === 'mirador');
  if (!publishedBundle || publishedBundle.units?.length !== 199 || publishedBundle.layouts?.length !== 44 || publishedBundle.project?.updatedAt !== expectedPublishedMirador.projectUpdatedAt) throw new Error('Published Mirador catalog identity/count/timestamp is invalid');
  if (sha256(canonicalJSON(publishedBundle)) !== expectedPublishedMirador.bundleSha256) throw new Error('Published Mirador bundle SHA-256 differs from the audited production bundle');
  const exactUnits = publishedBundle.units.filter((unit) => typeof unit.planImageUrl === 'string' && unit.planImageUrl.startsWith('/kayan/mirador/plans/exact/'));
  if (exactUnits.length !== 51 || publishedBundle.layouts.some((layout) => !layout.imageUrl?.startsWith('/kayan/mirador/plans/representative/') || layout.thumbnailUrl !== layout.imageUrl) || /https?:\/\/(?:[^" ]*profitbase|pb21432)/i.test(JSON.stringify(publishedBundle))) throw new Error('Published Mirador exact/representative locality contract is invalid');

  if (!sidecarBody.equals(canonicalJSON(sidecar)) || sha256(sidecarBody) !== expectedPublishedMirador.floorSidecarSha256) throw new Error('Published Mirador floor sidecar canonical SHA-256 mismatch');
  if (sidecar.schemaVersion !== 2 || sidecar.projectSlug !== 'mirador' || sidecar.capturedAt !== expectedPublishedMirador.floorCapturedAt || sidecar.floorSchemeCount !== 34 || sidecar.hotspotCount !== 209 || sidecar.blockEntranceMapping !== null || sidecar.schemes?.length !== 34) throw new Error('Published Mirador floor sidecar identity/counts are invalid');
  const hotspotCount = sidecar.schemes.reduce((sum, scheme) => sum + (Array.isArray(scheme.zones) ? scheme.zones.length : 0), 0);
  if (hotspotCount !== 209) throw new Error('Published Mirador floor sidecar hotspot universe is incomplete');
  for (const scheme of sidecar.schemes) {
    const path = typeof scheme.imageUrl === 'string' && scheme.imageUrl.startsWith('/kayan/mirador/floor-schemes/') ? resolve(publicRoot, scheme.imageUrl.slice(1)) : '';
    if (!path) throw new Error('Published Mirador floor scheme has an unsafe path');
    const body = await readFile(path);
    const metadata = await sharp(body).metadata();
    if (body.length !== scheme.imageBytes || sha256(body) !== scheme.imageSha256 || metadata.format !== 'webp' || metadata.width !== scheme.width || metadata.height !== scheme.height) throw new Error(`Published Mirador floor-scheme asset mismatch: ${scheme.imageUrl}`);
  }

  const planPaths = [];
  for (const [kind, directory] of [['exact', resolve(publicRoot, 'kayan/mirador/plans/exact')], ['representative', resolve(publicRoot, 'kayan/mirador/plans/representative')]]) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.webp')).sort();
    const expectedCount = kind === 'exact' ? 31 : 44;
    if (names.length !== expectedCount) throw new Error(`Published Mirador ${kind} asset count is ${names.length}, expected ${expectedCount}`);
    for (const name of names) planPaths.push(`/kayan/mirador/plans/${kind}/${name}`);
  }
  planPaths.sort();
  const records = [];
  for (const path of planPaths) {
    const body = await readFile(resolve(publicRoot, path.slice(1)));
    const metadata = await sharp(body).metadata();
    if (body.length < 1024 || metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.width > 1600 || metadata.height > 1600) throw new Error(`Published Mirador plan asset metadata is invalid: ${path}`);
    records.push([path, body.length, sha256(body), metadata.format, metadata.width, metadata.height].join('\u001f'));
  }
  if (sha256(Buffer.from(`${records.join('\n')}\n`)) !== expectedPublishedMirador.planAssetSetSha256) throw new Error('Published Mirador plan asset-set SHA-256 mismatch');

  await Promise.all([
    assertPublishedFileHash('kayan/mirador/hero.webp', '580c5d2e2890ebeb98b53572b0ecc433b6bdc110ba0de7704ebe8ca836df6826'),
    assertPublishedFileHash('kayan/mirador/block-selector.webp', '3894df5acc109d32860b0640523b9d34026a1c6d25e2118affed158ef91b3489'),
    assertPublishedFileHash('kayan/mirador/hero-mobile.webp', 'bab527a11fbc149b5cf6865e50e75768d6da3350788dffae2ddba86fd508ac67'),
    assertPublishedFileHash('kayan/mirador/block-selector-mask.svg', '3459a54eef4915bd4ff2af49b2f9eb391c93579dff41bb6c73e6aeb6f8a06f8b'),
    assertPublishedFileHash('kayan/mirador/source/frame-3-original.svg', 'b040437e4206bbaee63ee838f4425df235a7ac2c660e5797c324e93e7d4b51b7'),
    assertPublishedFileHash('kayan/mirador/source/block-annotation.jpg', '5dd2e426e2add0b441a3511629387454138f87ad3fc79a28b1460f6d9c26d691'),
  ]);
  console.log(JSON.stringify({
    mode: 'check', snapshotUnits: 199, exactUnitPlans: 51, representativeUnitFallbacks: 148,
    exactAssets: 31, representativeAssets: 44, floorSchemes: 34, floorSchemeHotspots: 209,
    floorSchemeAssetsVerified: 34, optimizedAssetsVerified: 75, rawCaptureRead: false,
  }, null, 2));
}

if (checkOnly) {
  await runMiradorDeployCheck();
  process.exit(0);
}

const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
const floorSchemeMapping = JSON.parse(await readFile(floorSchemeMappingPath, 'utf8'));
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const bundle = catalog.projects.find((item) => item.project.slug === 'mirador');

if (!bundle) throw new Error('Mirador bundle is missing from website/data/kayan-catalog.json');
if (bundle.units.length !== 199) throw new Error(`Expected the locked 199-unit snapshot, received ${bundle.units.length}`);
if (mapping.validation.captureCount !== 61 || mapping.associations.length !== 61) throw new Error('Mirador DOM capture must contain 61 associations');
if (mapping.validation.strictMatchCount !== 51 || mapping.validation.unmatchedCount !== 10) throw new Error('Expected 51 strict matches and 10 retained unmatched observations');
if (mapping.validation.uniqueCapturedImages !== 31) throw new Error('Expected 31 unique images in the complete public listing capture');
if (mapping.validation.floorSchemeCount !== 0) throw new Error('The public unit-plan capture contains no floor schemes');
if (mapping.validation.blockEntranceMapping !== null) throw new Error('Visual block to entrance mapping must remain unassigned');

const floorSchemeImagePrefix = '/kayan/mirador/floor-schemes/';
const floorSchemeRawScreenshotPrefix = 'backend/data/raw/kayan/mappings/floor-schemes/mirador/2026-08-31/';
const expectedFloorSchemeCount = 34;
const expectedFloorSchemeHotspotCount = 209;
const expectedCompanionNumbers = ['44', '45', '47', '48', '49', '114', '115', '116', '118', '119'];
const maxFloorSchemeImageDimension = 8192;
const maxFloorSchemeImagePixels = 40_000_000;
const maxFloorSchemeImageBytes = 12 << 20;

function isValidTimestamp(value) {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function assertFloorSchemeSource(rawMapping) {
  const source = rawMapping.source;
  if (!source || !isValidTimestamp(source.observedAt) || typeof source.method !== 'string' || !source.method.trim() || typeof source.note !== 'string' || !source.note.trim()) {
    throw new Error('Mirador floor-scheme source observation, method and note are required');
  }
  if (source.tenantOrigin !== 'https://pb21432.profitbase.ru' || source.houseId !== 154813 || source.accountId !== 21432) {
    throw new Error('Mirador floor-scheme source identity is not the verified KAYAN tenant/house');
  }
  const expectedRoutes = {
    catalog: '/eco/catalog/house/154813/smallGrid?accountId=21432&context=agencyOffice',
    floor: '/api/v4/json/floor?houseId=154813',
    board: '/board?houseId=154813',
    facade: '/facade?houseId=154813',
  };
  if (JSON.stringify(source.routes) !== JSON.stringify(expectedRoutes)) {
    throw new Error('Mirador floor-scheme source routes differ from the verified official routes');
  }
}

function expectedFloorSchemeCombos() {
  return [
    ...Array.from({ length: 7 }, (_, index) => ({ entrance: '1', floor: index + 2 })),
    ...Array.from({ length: 12 }, (_, index) => ({ entrance: '2', floor: index + 2 })),
    ...Array.from({ length: 15 }, (_, index) => ({ entrance: '3', floor: index + 2 })),
  ];
}

function floorSchemeDestination(imageUrl) {
  const relativePath = typeof imageUrl === 'string' ? imageUrl.slice(floorSchemeImagePrefix.length) : '';
  if (
    typeof imageUrl !== 'string'
    || !imageUrl.startsWith(floorSchemeImagePrefix)
    || !imageUrl.endsWith('.webp')
    || imageUrl.includes('://')
    || /[?#\\%]/.test(imageUrl)
    || !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.webp$/.test(relativePath)
    || relativePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe local Mirador floor-scheme path: ${String(imageUrl)}`);
  }
  const base = resolve(publicRoot, floorSchemeImagePrefix.slice(1));
  const destination = resolve(publicRoot, imageUrl.slice(1));
  if (!destination.startsWith(`${base}${sep}`)) throw new Error(`Floor-scheme path escapes its public directory: ${imageUrl}`);
  return destination;
}

function finiteInBounds(value, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}

function validatePolygonPoints(points, width, height) {
  if (typeof points !== 'string' || points.length === 0 || points.trim() !== points) {
    throw new Error('Floor-scheme polygon points are empty or not canonical');
  }
  const pairs = points.split(' ');
  if (pairs.length < 3 || pairs.some((pair) => pair.length === 0)) {
    throw new Error('Floor-scheme polygon needs at least three canonical x,y pairs');
  }
  const parsed = pairs.map((pair) => {
    const coordinates = pair.split(',');
    if (coordinates.length !== 2 || coordinates.some((coordinate) => coordinate.length === 0)) {
      throw new Error(`Malformed floor-scheme polygon pair: ${pair}`);
    }
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    if (!finiteInBounds(x, width) || !finiteInBounds(y, height)) {
      throw new Error(`Out-of-bounds or non-numeric floor-scheme polygon pair: ${pair}`);
    }
    return { x, y };
  });
  if (new Set(parsed.map(({ x, y }) => `${x}\u001f${y}`)).size < 3) {
    throw new Error('Floor-scheme polygon needs at least three distinct points');
  }
  const doubledArea = parsed.reduce((sum, point, index) => {
    const next = parsed[(index + 1) % parsed.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (Math.abs(doubledArea) < 0.000001) throw new Error('Floor-scheme polygon has zero area');
}

function floorSchemeUnitKey(entrance, floor, unitNumber) {
  return `${entrance}\u001f${floor}\u001f${unitNumber}`;
}

function sortedUnique(values, compare) {
  return [...new Set(values)].sort(compare);
}

function assertExactObjectKeys(value, expected, context) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${context} has unexpected fields`);
}

async function loadFloorSchemeCompanionEvidence(rawMapping) {
  const ref = rawMapping.validation.companionEvidence;
  assertExactObjectKeys(ref, ['path', 'byteSha256'], 'Mirador companion-evidence reference');
  if (typeof ref.path !== 'string' || !/^expected\/[A-Za-z0-9][A-Za-z0-9/_-]*\.tsv$/.test(ref.path) || ref.path.split('/').some((part) => part === '.' || part === '..') || typeof ref.byteSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.byteSha256)) {
    throw new Error('Mirador companion-evidence path/checksum is unsafe');
  }
  const mappingDirectory = dirname(floorSchemeMappingPath);
  const expectedDirectory = resolve(mappingDirectory, 'expected');
  const evidencePath = resolve(mappingDirectory, ref.path);
  if (!evidencePath.startsWith(`${expectedDirectory}${sep}`)) throw new Error('Mirador companion-evidence path escapes its directory');
  const body = await readFile(evidencePath);
  if (body.length === 0 || body.length > (1 << 20) || createHash('sha256').update(body).digest('hex') !== ref.byteSha256) {
    throw new Error('Mirador companion-evidence byte checksum/size is invalid');
  }
  const text = body.toString('utf8');
  if (!text.endsWith('\n') || text.includes('\r')) throw new Error('Mirador companion evidence must use canonical LF-terminated TSV');
  const records = text.slice(0, -1).split('\n').map((line, index) => {
    const fields = line.split('\t');
    if (fields.length !== 5) throw new Error(`Mirador companion evidence row ${index + 1} is malformed`);
    const [unitNumber, entrance, floorText, areaText, roomsText] = fields;
    const floor = Number(floorText);
    const area = Number(areaText);
    const rooms = Number(roomsText);
    if (!/^\d+$/.test(unitNumber) || !/^[123]$/.test(entrance) || !/^\d+$/.test(floorText) || !/^\d+(?:\.\d+)?$/.test(areaText) || !/^\d+$/.test(roomsText) || !Number.isInteger(floor) || !Number.isFinite(area) || !Number.isInteger(rooms)) {
      throw new Error(`Mirador companion evidence row ${index + 1} contains invalid typed fields`);
    }
    return { unitNumber, entrance, floor, area, rooms, areaText };
  });
  if (records.length !== 10 || JSON.stringify(records.map((record) => record.unitNumber)) !== JSON.stringify(expectedCompanionNumbers)) {
    throw new Error('Mirador companion evidence does not contain the exact 10-unit official supplement');
  }
  const unmatched = mapping.associations.filter((association) => association.expectedSnapshotMatch === false).sort((left, right) => Number(left.number) - Number(right.number));
  if (unmatched.length !== records.length) throw new Error('Mirador companion evidence count differs from retained unmatched public DOM observations');
  for (const [index, record] of records.entries()) {
    const association = unmatched[index];
    if (association.number !== record.unitNumber || association.entrance !== record.entrance || association.floor !== record.floor || association.area !== record.area || association.rooms !== record.rooms) {
      throw new Error(`Mirador companion evidence row ${index + 1} differs from its strict public DOM association`);
    }
  }
  return {
    source: 'mirador-plans-public-dom-v1',
    sourceObservedAt: mapping.capturedAt,
    recordCount: records.length,
    unitNumbers: records.map((record) => record.unitNumber),
    recordsSha256: ref.byteSha256,
    records,
  };
}

async function loadExpectedFloorSchemeUniverse(rawMapping, catalogBundle, companionEvidence) {
  const ref = rawMapping.validation.expectedUniverseManifest;
  if (ref === null || ref === undefined) return null;
  if (rawMapping.captureStatus !== 'captured-complete') throw new Error('Only a complete Mirador capture may reference an expected-universe manifest');
  assertExactObjectKeys(ref, ['path', 'byteSha256'], 'Mirador expected-universe reference');
  if (typeof ref.path !== 'string' || !/^expected\/[A-Za-z0-9][A-Za-z0-9/_-]*\.json$/.test(ref.path) || ref.path.split('/').some((part) => part === '.' || part === '..') || typeof ref.byteSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.byteSha256)) {
    throw new Error('Mirador expected-universe reference path/checksum is unsafe');
  }
  const mappingDirectory = dirname(floorSchemeMappingPath);
  const expectedDirectory = resolve(mappingDirectory, 'expected');
  const manifestPath = resolve(mappingDirectory, ref.path);
  if (!manifestPath.startsWith(`${expectedDirectory}${sep}`)) throw new Error('Mirador expected-universe path escapes its companion directory');
  const body = await readFile(manifestPath);
  if (body.length === 0 || body.length > (4 << 20)) throw new Error('Mirador expected-universe manifest has an invalid size');
  const checksum = createHash('sha256').update(body).digest('hex');
  if (checksum !== ref.byteSha256) throw new Error('Mirador expected-universe manifest byte checksum mismatch');
  const manifest = JSON.parse(body.toString('utf8'));
  assertExactObjectKeys(manifest, ['schemaVersion', 'projectSlug', 'sourceObservedAt', 'schemeCount', 'unitCount', 'lockedSnapshotUnitCount', 'companionUnitCount', 'assignments'], 'Mirador expected-universe manifest');
  if (manifest.schemaVersion !== 2 || manifest.projectSlug !== 'mirador' || manifest.sourceObservedAt !== rawMapping.source.observedAt || !Array.isArray(manifest.assignments) || manifest.unitCount !== manifest.assignments.length || manifest.schemeCount !== expectedFloorSchemeCount || manifest.unitCount !== expectedFloorSchemeHotspotCount || manifest.lockedSnapshotUnitCount !== catalogBundle.units.length || manifest.companionUnitCount !== companionEvidence.recordCount) {
    throw new Error('Mirador expected-universe manifest identity/counts are invalid');
  }
  const eligibleUnits = catalogBundle.units.filter((unit) => unit.phaseSlug === 'main' && unit.propertyType === 'apartment' && unit.isActive !== false);
  const unitsByLocation = new Map();
  for (const unit of eligibleUnits) {
    const key = floorSchemeUnitKey(unit.entrance, unit.floor, unit.number);
    unitsByLocation.set(key, [...(unitsByLocation.get(key) ?? []), unit]);
  }
  const seenUnitKeys = new Set();
  const schemeKeys = new Set();
  const assignments = manifest.assignments.map((assignment, index) => {
    assertExactObjectKeys(assignment, ['entrance', 'floor', 'unitNumber', 'unitKey', 'evidence'], `Mirador expected-universe assignment ${index + 1}`);
    if (typeof assignment.entrance !== 'string' || !assignment.entrance || assignment.entrance.trim() !== assignment.entrance || !Number.isInteger(assignment.floor) || assignment.floor <= 0 || typeof assignment.unitNumber !== 'string' || !assignment.unitNumber || assignment.unitNumber.trim() !== assignment.unitNumber || !['locked-snapshot', 'official-public-companion'].includes(assignment.evidence)) {
      throw new Error(`Mirador expected-universe assignment ${index + 1} is malformed`);
    }
    const matches = unitsByLocation.get(floorSchemeUnitKey(assignment.entrance, assignment.floor, assignment.unitNumber)) ?? [];
    let unitKey = null;
    if (assignment.evidence === 'locked-snapshot') {
      if (matches.length !== 1 || typeof matches[0].sourceKey !== 'string' || !matches[0].sourceKey || assignment.unitKey !== matches[0].sourceKey) {
        throw new Error(`Mirador expected-universe assignment ${index + 1} is not an exact locked-snapshot tuple`);
      }
      unitKey = matches[0].sourceKey;
    } else {
      const companion = companionEvidence.records.find((record) => record.unitNumber === assignment.unitNumber);
      if (matches.length !== 0 || assignment.unitKey !== null || !companion || companion.entrance !== assignment.entrance || companion.floor !== assignment.floor) {
        throw new Error(`Mirador expected-universe assignment ${index + 1} is not an exact official companion tuple`);
      }
    }
    if (unitKey !== null && seenUnitKeys.has(unitKey)) throw new Error(`Mirador expected-universe assignment ${index + 1} duplicates canonical unitKey ${unitKey}`);
    if (unitKey !== null) seenUnitKeys.add(unitKey);
    schemeKeys.add(`${assignment.entrance}\u001f${assignment.floor}`);
    return { ...assignment };
  });
  if (manifest.schemeCount !== schemeKeys.size || manifest.schemeCount <= 0) throw new Error('Mirador expected-universe schemeCount is inconsistent');
  if (rawMapping.captureStatus === 'captured-complete') {
    const companionNumbers = new Set(assignments.filter((assignment) => assignment.evidence === 'official-public-companion').map((assignment) => assignment.unitNumber));
    const allNumbers = assignments.map((assignment) => Number(assignment.unitNumber)).sort((left, right) => left - right);
    if (seenUnitKeys.size !== eligibleUnits.length || eligibleUnits.some((unit) => !seenUnitKeys.has(unit.sourceKey)) || companionNumbers.size !== 10 || expectedCompanionNumbers.some((number) => !companionNumbers.has(number)) || allNumbers.some((number, index) => number !== index + 1)) {
      throw new Error('Complete Mirador expected universe does not cover every eligible locked-snapshot apartment exactly once');
    }
  }
  return {
    sourceObservedAt: manifest.sourceObservedAt,
    expectedManifestByteSha256: checksum,
    schemeCount: manifest.schemeCount,
    unitCount: manifest.unitCount,
    lockedSnapshotUnitCount: manifest.lockedSnapshotUnitCount,
    companionUnitCount: manifest.companionUnitCount,
    assignments,
  };
}

function validateExpectedUniverseAgainstPayload(rawMapping, catalogBundle, expectedUniverse, schemes) {
  if (rawMapping.captureStatus === 'captured-complete' && !expectedUniverse) {
    throw new Error('Complete Mirador floor-scheme capture requires an independently checksummed expected universe');
  }
  if (!expectedUniverse) return;
  if (rawMapping.captureStatus !== 'captured-complete') throw new Error('Only a complete Mirador capture may emit an expected universe');
  if (expectedUniverse.sourceObservedAt !== rawMapping.source.observedAt) throw new Error('Mirador expected-universe provenance is inconsistent');
  const expectedAssignments = new Set(expectedUniverse.assignments.map((item) => `${item.entrance}\u001f${item.floor}\u001f${item.unitNumber}\u001f${String(item.unitKey)}\u001f${item.evidence}`));
  const expectedEvidenceByTuple = new Map(expectedUniverse.assignments.map((item) => [`${item.entrance}\u001f${item.floor}\u001f${item.unitNumber}`, item.evidence]));
  const actualAssignments = new Set(schemes.flatMap((scheme) => scheme.zones.map((zone) => `${scheme.entrance}\u001f${scheme.floor}\u001f${zone.unitNumber}\u001f${String(zone.unitKey)}\u001f${expectedEvidenceByTuple.get(`${scheme.entrance}\u001f${scheme.floor}\u001f${zone.unitNumber}`)}`)));
  const expectedSchemes = new Set(expectedUniverse.assignments.map((item) => `${item.entrance}\u001f${item.floor}`));
  const actualSchemes = new Set(schemes.map((scheme) => `${scheme.entrance}\u001f${scheme.floor}`));
  if (expectedUniverse.unitCount !== expectedAssignments.size || expectedUniverse.schemeCount !== expectedSchemes.size || expectedAssignments.size !== actualAssignments.size || expectedSchemes.size !== actualSchemes.size || [...expectedAssignments].some((key) => !actualAssignments.has(key)) || [...expectedSchemes].some((key) => !actualSchemes.has(key))) {
    throw new Error('Mirador floor-scheme payload does not exactly equal the independent expected universe');
  }
  if (rawMapping.captureStatus === 'captured-complete') {
    const eligible = catalogBundle.units.filter((unit) => unit.phaseSlug === 'main' && unit.propertyType === 'apartment' && unit.isActive !== false);
    const expectedKeys = new Set(expectedUniverse.assignments.map((item) => item.unitKey));
    expectedKeys.delete(null);
    if (expectedKeys.size !== eligible.length || eligible.some((unit) => !expectedKeys.has(unit.sourceKey))) {
      throw new Error('Complete Mirador expected universe does not cover every eligible apartment');
    }
  }
}

function validateFloorSchemeCaptureScope(rawMapping, schemes, hotspotCount) {
  const scope = rawMapping.captureScope;
  if (!scope || typeof scope !== 'object' || scope.schemeCount !== schemes.length || scope.schemeCount !== rawMapping.validation.schemeCount || scope.hotspotCount !== hotspotCount || scope.hotspotCount !== rawMapping.validation.hotspotCount) {
    throw new Error('Mirador floor-scheme captureScope counts are inconsistent');
  }
  if (!Array.isArray(scope.auditedExclusions) || scope.auditedExclusions.some((item) => (
    !item || typeof item !== 'object'
    || typeof item.kind !== 'string' || item.kind.trim() !== item.kind || !item.kind || item.kind.length > 80
    || typeof item.reason !== 'string' || item.reason.trim() !== item.reason || !item.reason || item.reason.length > 160
    || typeof item.evidence !== 'string' || item.evidence.trim() !== item.evidence || !item.evidence || item.evidence.length > 1000
    || /[\u0000\r\n]/.test(`${item.kind}${item.reason}${item.evidence}`)
  ))) {
    throw new Error('Mirador floor-scheme audited exclusions are invalid');
  }
  for (const field of ['declaredBlocks', 'declaredEntrances', 'declaredFloors', 'declaredUnitHotspots']) {
    if (!Array.isArray(scope[field])) throw new Error(`Mirador floor-scheme captureScope.${field} must be an array`);
  }
  if (schemes.length === 0) {
    if (
      rawMapping.captureStatus !== 'blocked-by-authentication'
      || scope.mode !== 'blocked'
      || scope.auditedExclusions.length === 0
      || scope.declaredBlocks.length !== 0
      || scope.declaredEntrances.length !== 0
      || scope.declaredFloors.length !== 0
      || scope.declaredUnitHotspots.length !== 0
    ) throw new Error('Empty Mirador floor-scheme artifact must declare a fully audited blocked scope');
    return;
  }
  if (rawMapping.captureStatus === 'captured-complete') {
    if (scope.mode !== 'complete' || scope.auditedExclusions.length !== 0) throw new Error('Complete Mirador floor-scheme capture cannot contain exclusions');
  } else if (rawMapping.captureStatus === 'captured-partial') {
    if (scope.mode !== 'partial' || scope.auditedExclusions.length === 0) throw new Error('Partial Mirador floor-scheme capture requires audited exclusions');
  } else {
    throw new Error(`Unsupported Mirador floor-scheme capture status: ${String(rawMapping.captureStatus)}`);
  }
  const entrances = sortedUnique(schemes.map((scheme) => scheme.entrance), (left, right) => left.localeCompare(right));
  const floors = schemes.map((scheme) => ({ entrance: scheme.entrance, floor: scheme.floor }))
    .sort((left, right) => left.entrance.localeCompare(right.entrance) || left.floor - right.floor);
  const unitHotspots = schemes.flatMap((scheme) => scheme.zones.map((zone) => ({
    entrance: scheme.entrance, floor: scheme.floor, unitNumber: zone.unitNumber,
  }))).sort((left, right) => left.entrance.localeCompare(right.entrance) || left.floor - right.floor || Number(left.unitNumber) - Number(right.unitNumber));
  if (rawMapping.captureStatus === 'captured-complete') {
    if (scope.declaredBlocks.length !== 0 || rawMapping.validation.blockEntranceMapping !== null) {
      throw new Error('Mirador floor schemes must not claim an unproven visual-block to entrance mapping');
    }
    const expectedFloors = expectedFloorSchemeCombos();
    if (schemes.length !== expectedFloorSchemeCount || hotspotCount !== expectedFloorSchemeHotspotCount || JSON.stringify(floors) !== JSON.stringify(expectedFloors)) {
      throw new Error('Complete Mirador floor-scheme capture must contain the exact official 34 entrance/floor combinations and 209 hotspots');
    }
  }
  if (
    scope.declaredBlocks.length !== 0
    || JSON.stringify(scope.declaredEntrances) !== JSON.stringify(entrances)
    || JSON.stringify(scope.declaredFloors) !== JSON.stringify(floors)
    || JSON.stringify(scope.declaredUnitHotspots) !== JSON.stringify(unitHotspots)
  ) throw new Error('Mirador floor-scheme declared capture sets do not exactly cover the emitted payload');
}

function validateRawSourceScreenshot(source, schemeIndex) {
  assertExactObjectKeys(source, ['path', 'sha256', 'bytes', 'mediaType', 'width', 'height', 'canvas', 'tightCrop'], `Floor scheme ${schemeIndex + 1} source screenshot`);
  if (typeof source.path !== 'string' || !source.path.startsWith(floorSchemeRawScreenshotPrefix) || !source.path.endsWith('.png') || source.path.includes('..') || source.mediaType !== 'image/jpeg' || source.width !== 1661 || source.height !== 811 || !Number.isInteger(source.bytes) || source.bytes < 1024 || typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error(`Floor scheme ${schemeIndex + 1} has an invalid raw source screenshot manifest`);
  }
  assertExactObjectKeys(source.canvas, ['x', 'y', 'width', 'height'], `Floor scheme ${schemeIndex + 1} source canvas`);
  if (JSON.stringify(source.canvas) !== JSON.stringify({ x: 160, y: 257, width: 1501, height: 439 })) throw new Error(`Floor scheme ${schemeIndex + 1} changed the audited official canvas ROI`);
  assertExactObjectKeys(source.tightCrop, ['x', 'y', 'width', 'height', 'padding', 'detector', 'foregroundThreshold', 'componentPixelCount', 'componentBounds', 'detectionHeight'], `Floor scheme ${schemeIndex + 1} tight crop`);
  assertExactObjectKeys(source.tightCrop.componentBounds, ['x', 'y', 'width', 'height'], `Floor scheme ${schemeIndex + 1} component bounds`);
  const crop = source.tightCrop;
  if (![439, 488].includes(crop.detectionHeight) || crop.padding !== 24 || crop.detector !== 'largest-8-connected-nonwhite-component-v1' || crop.foregroundThreshold !== 8 || !Number.isInteger(crop.componentPixelCount) || crop.componentPixelCount < 15_000 || !Number.isInteger(crop.x) || !Number.isInteger(crop.y) || !Number.isInteger(crop.width) || !Number.isInteger(crop.height) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > source.canvas.width || crop.y + crop.height > crop.detectionHeight || source.canvas.y + crop.y + crop.height > source.height) {
    throw new Error(`Floor scheme ${schemeIndex + 1} has invalid deterministic tight-crop metadata`);
  }
}

function validateFloorSchemes(rawMapping, catalogBundle, expectedUniverse = null) {
  if (rawMapping.schemaVersion !== 2 || rawMapping.projectSlug !== 'mirador') throw new Error('Unsupported Mirador floor-scheme artifact identity');
  assertFloorSchemeSource(rawMapping);
  const validation = rawMapping.validation;
  const schemes = rawMapping.schemes;
  const phase = catalogBundle.project.phases.find((item) => item.slug === 'main');
  if (!validation || !Array.isArray(schemes) || !phase) throw new Error('Mirador floor-scheme artifact or main phase is incomplete');
  if (validation.lockedSnapshotCapturedAt !== phase.updatedAt || validation.lockedSnapshotRecordCount !== catalogBundle.units.length || validation.officialUniverseRecordCount !== expectedFloorSchemeHotspotCount) {
    throw new Error('Mirador floor-scheme artifact does not identify the locked 199 + official companion 10 universe');
  }
  if (validation.schemeCount !== schemes.length || validation.sourceScreenshotCount !== schemes.length || validation.coordinateSystem !== 'image-pixels' || validation.imagePathPrefix !== floorSchemeImagePrefix || validation.blockEntranceMapping !== null) {
    throw new Error('Mirador floor-scheme counts, coordinates, source count or unproven block mapping are invalid');
  }
  if (!isValidTimestamp(rawMapping.capturedAt) || Date.parse(rawMapping.capturedAt) < Date.parse(validation.lockedSnapshotCapturedAt) || rawMapping.source.status !== 'captured-read-only') {
    throw new Error('Mirador official floor-scheme capture has invalid read-only capture provenance');
  }

  const unitsByLocation = new Map();
  const canonicalCatalogUnitKeys = new Set();
  for (const unit of catalogBundle.units) {
    if (unit.phaseSlug !== 'main') continue;
    if (typeof unit.sourceKey !== 'string' || !unit.sourceKey || unit.sourceKey.trim() !== unit.sourceKey || canonicalCatalogUnitKeys.has(unit.sourceKey)) {
      throw new Error(`Mirador locked snapshot has an invalid or duplicate canonical unit key: ${String(unit.sourceKey)}`);
    }
    canonicalCatalogUnitKeys.add(unit.sourceKey);
    const key = floorSchemeUnitKey(unit.entrance, unit.floor, unit.number);
    unitsByLocation.set(key, [...(unitsByLocation.get(key) ?? []), unit]);
  }
  const expectedByLocation = new Map((expectedUniverse?.assignments ?? []).map((assignment) => [floorSchemeUnitKey(assignment.entrance, assignment.floor, assignment.unitNumber), assignment]));
  const seenSchemes = new Set();
  const seenCanonicalUnitKeys = new Set();
  const seenUnitNumbers = new Set();
  const verifiedSchemes = [];
  let hotspotCount = 0;
  for (const [schemeIndex, scheme] of schemes.entries()) {
    if (Object.hasOwn(scheme, 'block')) throw new Error(`Floor scheme ${schemeIndex + 1} must not claim a visual block`);
    if (typeof scheme.entrance !== 'string' || !/^[123]$/.test(scheme.entrance)) throw new Error(`Floor scheme ${schemeIndex + 1} has invalid entrance`);
    if (!Number.isInteger(scheme.floor) || scheme.floor <= 0) throw new Error(`Floor scheme ${schemeIndex + 1} has invalid floor`);
    if (!Number.isInteger(scheme.width) || !Number.isInteger(scheme.height) || scheme.width <= 0 || scheme.height <= 0 || scheme.width > maxFloorSchemeImageDimension || scheme.height > maxFloorSchemeImageDimension || scheme.width * scheme.height > maxFloorSchemeImagePixels) throw new Error(`Floor scheme ${schemeIndex + 1} has invalid dimensions`);
    const pendingManifest = prepareFloorSchemes && scheme.imageBytes === 0 && scheme.imageSha256 === '';
    if (!pendingManifest && (!Number.isInteger(scheme.imageBytes) || scheme.imageBytes < 1024 || scheme.imageBytes > maxFloorSchemeImageBytes || typeof scheme.imageSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(scheme.imageSha256))) throw new Error(`Floor scheme ${schemeIndex + 1} has an invalid local asset manifest`);
    floorSchemeDestination(scheme.imageUrl);
    validateRawSourceScreenshot(scheme.sourceScreenshot, schemeIndex);
    if (scheme.width !== scheme.sourceScreenshot.tightCrop.width || scheme.height !== scheme.sourceScreenshot.tightCrop.height) throw new Error(`Floor scheme ${schemeIndex + 1} dimensions differ from its audited source crop`);
    const schemeKey = `${scheme.entrance}\u001f${scheme.floor}`;
    if (seenSchemes.has(schemeKey)) throw new Error(`Floor scheme ${schemeIndex + 1} duplicates entrance/floor ${scheme.entrance}/${scheme.floor}`);
    seenSchemes.add(schemeKey);
    if (!Array.isArray(scheme.zones) || scheme.zones.length === 0) throw new Error(`Floor scheme ${schemeIndex + 1} has no apartment hotspots`);
    const seenUnits = new Set();
    const verifiedZones = [];
    for (const [zoneIndex, zone] of scheme.zones.entries()) {
      assertExactObjectKeys(zone, ['unitKey', 'unitNumber', 'points', 'label'], `Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1}`);
      if (typeof zone.unitNumber !== 'string' || !/^\d+$/.test(zone.unitNumber) || seenUnits.has(zone.unitNumber) || seenUnitNumbers.has(zone.unitNumber)) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has an invalid or duplicate unitNumber`);
      seenUnits.add(zone.unitNumber);
      seenUnitNumbers.add(zone.unitNumber);
      validatePolygonPoints(zone.points, scheme.width, scheme.height);
      if (!zone.label || !finiteInBounds(zone.label.x, scheme.width) || !finiteInBounds(zone.label.y, scheme.height)) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has an invalid label`);
      const tuple = floorSchemeUnitKey(scheme.entrance, scheme.floor, zone.unitNumber);
      const matches = unitsByLocation.get(tuple) ?? [];
      const expected = expectedByLocation.get(tuple);
      if (expectedUniverse && !expected) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} is outside the official expected universe`);
      const expectedUnitKey = expected?.unitKey ?? (matches.length === 1 ? matches[0].sourceKey : null);
      if (zone.unitKey !== expectedUnitKey) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has an unverified unitKey`);
      if (expected?.evidence === 'locked-snapshot' || (!expected && expectedUnitKey !== null)) {
        if (matches.length !== 1 || matches[0].sourceKey !== expectedUnitKey) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has ${matches.length} strict locked-snapshot matches`);
      } else if (expected?.evidence === 'official-public-companion') {
        if (matches.length !== 0 || zone.unitKey !== null) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} companion identity is not isolated from the locked snapshot`);
      } else if (matches.length !== 1) {
        throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has ${matches.length} strict matches`);
      }
      if (zone.unitKey !== null) {
        if (typeof zone.unitKey !== 'string' || !zone.unitKey || seenCanonicalUnitKeys.has(zone.unitKey)) throw new Error(`Floor scheme ${schemeIndex + 1} zone ${zoneIndex + 1} has an invalid or duplicate canonical unitKey`);
        seenCanonicalUnitKeys.add(zone.unitKey);
      }
      verifiedZones.push({ unitKey: zone.unitKey, unitNumber: zone.unitNumber, points: zone.points, label: { x: zone.label.x, y: zone.label.y } });
      hotspotCount += 1;
    }
    verifiedSchemes.push({
      entrance: scheme.entrance,
      floor: scheme.floor,
      imageUrl: scheme.imageUrl,
      imageSha256: scheme.imageSha256,
      imageBytes: scheme.imageBytes,
      width: scheme.width,
      height: scheme.height,
      sourceScreenshot: scheme.sourceScreenshot,
      zones: verifiedZones,
    });
  }
  if (hotspotCount !== validation.hotspotCount) throw new Error(`Mirador floor schemes contain ${hotspotCount} hotspots, declared ${validation.hotspotCount}`);
  if (rawMapping.captureStatus === 'captured-complete') {
    const exactNumbers = [...seenUnitNumbers].map(Number).sort((left, right) => left - right);
    if (schemes.length !== expectedFloorSchemeCount || hotspotCount !== expectedFloorSchemeHotspotCount || exactNumbers.some((number, index) => number !== index + 1)) throw new Error('Complete Mirador floor capture is not the exact 34-scheme / apartment 1..209 universe');
  }
  validateFloorSchemeCaptureScope(rawMapping, verifiedSchemes, hotspotCount);
  validateExpectedUniverseAgainstPayload(rawMapping, catalogBundle, expectedUniverse, verifiedSchemes);
  return { schemes: verifiedSchemes, hotspotCount };
}

function runFloorSchemeValidatorSelfTest() {
  const lockedAt = '2026-08-29T08:46:56.739Z';
  const capturedAt = '2026-08-31T17:49:54Z';
  const unitKey = '154813:apartment:1:2:1';
  const fixtureBundle = { project: { phases: [{ slug: 'main', updatedAt: lockedAt }] }, units: [{ phaseSlug: 'main', sourceKey: unitKey, entrance: '1', floor: 2, number: '1' }] };
  const fixture = {
    schemaVersion: 2,
    projectSlug: 'mirador',
    capturedAt,
    captureStatus: 'captured-partial',
    captureScope: { mode: 'partial', declaredBlocks: [], declaredEntrances: ['1'], declaredFloors: [{ entrance: '1', floor: 2 }], declaredUnitHotspots: [{ entrance: '1', floor: 2, unitNumber: '1' }], schemeCount: 1, hotspotCount: 1, auditedExclusions: [{ kind: 'remaining-schemes', reason: 'fixture', evidence: 'In-memory validator fixture.' }] },
    source: { observedAt: capturedAt, status: 'captured-read-only', tenantOrigin: 'https://pb21432.profitbase.ru', houseId: 154813, accountId: 21432, routes: { catalog: '/eco/catalog/house/154813/smallGrid?accountId=21432&context=agencyOffice', floor: '/api/v4/json/floor?houseId=154813', board: '/board?houseId=154813', facade: '/facade?houseId=154813' }, method: 'In-memory validator fixture', note: 'Exercises the non-empty v2 contract.' },
    validation: { lockedSnapshotCapturedAt: lockedAt, lockedSnapshotRecordCount: 1, officialUniverseRecordCount: 209, schemeCount: 1, hotspotCount: 1, sourceScreenshotCount: 1, coordinateSystem: 'image-pixels', imagePathPrefix: floorSchemeImagePrefix, blockEntranceMapping: null },
    schemes: [{ entrance: '1', floor: 2, imageUrl: '/kayan/mirador/floor-schemes/validator-fixture.webp', imageSha256: 'a'.repeat(64), imageBytes: 1024, width: 100, height: 100, sourceScreenshot: { path: `${floorSchemeRawScreenshotPrefix}fixture.png`, sha256: 'b'.repeat(64), bytes: 1024, mediaType: 'image/jpeg', width: 1661, height: 811, canvas: { x: 160, y: 257, width: 1501, height: 439 }, tightCrop: { x: 600, y: 60, width: 100, height: 100, padding: 24, detector: 'largest-8-connected-nonwhite-component-v1', foregroundThreshold: 8, componentPixelCount: 15_001, componentBounds: { x: 624, y: 84, width: 52, height: 52 }, detectionHeight: 439 } }, zones: [{ unitKey, unitNumber: '1', points: '20,20 64,20 64,64 20,64', label: { x: 42, y: 42 } }] }],
  };
  validateFloorSchemes(fixture, fixtureBundle);
  const expectRejected = (mutate, expected) => {
    const candidate = JSON.parse(JSON.stringify(fixture));
    mutate(candidate);
    try { validateFloorSchemes(candidate, fixtureBundle); } catch (error) { if (String(error).includes(expected)) return; throw error; }
    throw new Error(`Floor-scheme validator self-test accepted ${expected}`);
  };
  expectRejected((candidate) => { candidate.schemes[0].zones[0].unitKey = 'attacker'; }, 'unverified unitKey');
  expectRejected((candidate) => { candidate.schemes[0].zones[0].unitNumber = '999'; candidate.schemes[0].zones[0].unitKey = null; candidate.captureScope.declaredUnitHotspots[0].unitNumber = '999'; }, '0 strict matches');
  expectRejected((candidate) => { candidate.schemes[0].block = 1; }, 'must not claim a visual block');
}

runFloorSchemeValidatorSelfTest();
const verifiedCompanionEvidence = await loadFloorSchemeCompanionEvidence(floorSchemeMapping);
const verifiedExpectedUniverse = await loadExpectedFloorSchemeUniverse(floorSchemeMapping, bundle, verifiedCompanionEvidence);
const verifiedFloorSchemes = validateFloorSchemes(floorSchemeMapping, bundle, verifiedExpectedUniverse);
function floorSchemeForClient(scheme) {
  return {
    entrance: scheme.entrance,
    floor: scheme.floor,
    imageUrl: scheme.imageUrl,
    imageSha256: scheme.imageSha256,
    imageBytes: scheme.imageBytes,
    width: scheme.width,
    height: scheme.height,
    sourceScreenshotSha256: scheme.sourceScreenshot.sha256,
    sourceCrop: {
      x: scheme.sourceScreenshot.canvas.x + scheme.sourceScreenshot.tightCrop.x,
      y: scheme.sourceScreenshot.canvas.y + scheme.sourceScreenshot.tightCrop.y,
      width: scheme.sourceScreenshot.tightCrop.width,
      height: scheme.sourceScreenshot.tightCrop.height,
    },
    zones: scheme.zones.map((zone) => ({
      unitKey: zone.unitKey,
      unitNumber: zone.unitNumber,
      points: zone.points,
      label: { x: zone.label.x, y: zone.label.y },
    })),
  };
}
const floorSchemeClient = {
  schemaVersion: floorSchemeMapping.schemaVersion,
  projectSlug: floorSchemeMapping.projectSlug,
  capturedAt: floorSchemeMapping.capturedAt,
  captureStatus: floorSchemeMapping.captureStatus,
  captureScope: floorSchemeMapping.captureScope,
  sourceStatus: floorSchemeMapping.source.status,
  sourceObservedAt: floorSchemeMapping.source.observedAt,
  floorSchemeCount: verifiedFloorSchemes.schemes.length,
  hotspotCount: verifiedFloorSchemes.hotspotCount,
  blockEntranceMapping: floorSchemeMapping.validation.blockEntranceMapping,
  companionEvidence: {
    source: verifiedCompanionEvidence.source,
    sourceObservedAt: verifiedCompanionEvidence.sourceObservedAt,
    recordCount: verifiedCompanionEvidence.recordCount,
    unitNumbers: verifiedCompanionEvidence.unitNumbers,
    recordsSha256: verifiedCompanionEvidence.recordsSha256,
  },
  schemes: verifiedFloorSchemes.schemes.map(floorSchemeForClient),
  expectedUniverse: verifiedExpectedUniverse,
};
const floorSchemeClientJSON = JSON.stringify(floorSchemeClient);
if (/profitbase\.ru|tenantOrigin|houseId|accountId|"routes"|sourceImageUrl|"sourceScreenshot"\s*:/i.test(floorSchemeClientJSON)) {
  throw new Error('Sanitized Mirador floor-scheme client artifact contains private source metadata');
}

function numericEqual(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.000001;
}

function matchingUnits(association) {
  return bundle.units.filter((unit) => (
    unit.number === association.number
    && unit.entrance === association.entrance
    && unit.floor === association.floor
    && numericEqual(unit.area, association.area)
    && unit.rooms === association.rooms
    && unit.phaseName.toLowerCase() === association.projectName.toLowerCase()
  ));
}

const exactAssociations = [];
const rejectedAssociations = [];
for (const association of mapping.associations) {
  const matches = matchingUnits(association);
  if (association.expectedSnapshotMatch) {
    if (matches.length !== 1) throw new Error(`Strict tuple for apartment ${association.number} matched ${matches.length} snapshot units`);
    exactAssociations.push({ association, unit: matches[0] });
  } else {
    if (matches.length !== 0) throw new Error(`Rejected tuple for apartment ${association.number} unexpectedly matches the locked snapshot`);
    rejectedAssociations.push(association);
  }
}

if (exactAssociations.length !== 51 || rejectedAssociations.length !== 10) throw new Error('Strict tuple verification count changed');

const representativeBySourceID = new Map(mapping.representativeLayouts.map((layout) => [layout.sourceId, layout]));
if (representativeBySourceID.size !== 44 || bundle.layouts.length !== 44) throw new Error('Expected 44 official representative layouts');
for (const layout of bundle.layouts) {
  if (!representativeBySourceID.has(layout.sourceId)) throw new Error(`Representative layout ${layout.sourceId} is absent from the source mapping`);
}

const assetMap = new Map();
for (const association of mapping.associations) {
  assetMap.set(association.localImageUrl, association.sourceImageUrl);
}
for (const layout of mapping.representativeLayouts) {
  assetMap.set(layout.localImageUrl, layout.sourceImageUrl);
}

const exactAssetCount = new Set(mapping.associations.map((item) => item.localImageUrl)).size;
const representativeAssetCount = new Set(mapping.representativeLayouts.map((item) => item.localImageUrl)).size;
if (exactAssetCount !== 31 || representativeAssetCount !== 44) throw new Error('Unexpected Mirador asset manifest counts');

function destinationFor(localImageUrl) {
  if (!localImageUrl.startsWith('/kayan/mirador/plans/') || !localImageUrl.endsWith('.webp')) {
    throw new Error(`Unsafe local plan path: ${localImageUrl}`);
  }
  return resolve(publicRoot, localImageUrl.slice(1));
}

async function verifyAsset(localImageUrl) {
  const destination = destinationFor(localImageUrl);
  const info = await stat(destination);
  if (!info.isFile() || info.size < 1024) throw new Error(`Invalid local plan asset: ${destination}`);
  const metadata = await sharp(destination).metadata();
  if (metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.width > 1600 || metadata.height > 1600) {
    throw new Error(`Unexpected optimized image metadata for ${destination}`);
  }
}

async function inspectFloorSchemeAsset(destination, scheme, enforceManifest) {
  const info = await stat(destination);
  if (!info.isFile() || info.size < 1024 || info.size > maxFloorSchemeImageBytes) throw new Error(`Invalid local floor-scheme asset size: ${destination}`);
  const body = await readFile(destination);
  const checksum = createHash('sha256').update(body).digest('hex');
  if (enforceManifest && (info.size !== scheme.imageBytes || checksum !== scheme.imageSha256)) {
    throw new Error(`Floor-scheme asset manifest mismatch for ${destination}`);
  }
  const metadata = await sharp(destination).metadata();
  if (
    metadata.format !== 'webp'
    || metadata.width !== scheme.width
    || metadata.height !== scheme.height
    || metadata.width > maxFloorSchemeImageDimension
    || metadata.height > maxFloorSchemeImageDimension
    || metadata.width * metadata.height > maxFloorSchemeImagePixels
  ) {
    throw new Error(`Floor-scheme asset ${destination} is ${metadata.format ?? 'unknown'} ${metadata.width ?? 0}x${metadata.height ?? 0}, expected WebP ${scheme.width}x${scheme.height}`);
  }
  return { imageSha256: checksum, imageBytes: info.size, width: metadata.width, height: metadata.height };
}

async function verifyFloorSchemeAsset(scheme) {
  return inspectFloorSchemeAsset(floorSchemeDestination(scheme.imageUrl), scheme, true);
}

async function verifyFloorSchemeSourceScreenshot(scheme) {
  const destination = resolve(repositoryRoot, scheme.sourceScreenshot.path);
  const allowedRoot = resolve(repositoryRoot, floorSchemeRawScreenshotPrefix);
  if (!destination.startsWith(`${allowedRoot}${sep}`)) throw new Error(`Floor-scheme raw screenshot escapes its audited directory: ${scheme.sourceScreenshot.path}`);
  const body = await readFile(destination);
  const info = await stat(destination);
  if (!info.isFile() || info.size !== scheme.sourceScreenshot.bytes || createHash('sha256').update(body).digest('hex') !== scheme.sourceScreenshot.sha256) {
    throw new Error(`Floor-scheme raw screenshot byte manifest mismatch: ${scheme.sourceScreenshot.path}`);
  }
  if (body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) throw new Error(`Floor-scheme raw screenshot does not preserve the supplied JPEG bytes: ${scheme.sourceScreenshot.path}`);
  const metadata = await sharp(body).metadata();
  if (metadata.format !== 'jpeg' || metadata.width !== scheme.sourceScreenshot.width || metadata.height !== scheme.sourceScreenshot.height) throw new Error(`Floor-scheme raw screenshot dimensions/media mismatch: ${scheme.sourceScreenshot.path}`);
}

async function optimizeFloorSchemeAssetAtPath(destination, scheme) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try {
    await sharp(destination, { limitInputPixels: maxFloorSchemeImagePixels })
      .webp({ lossless: true, effort: 6 })
      .toFile(temporary);
    const manifest = await inspectFloorSchemeAsset(temporary, scheme, false);
    await rename(temporary, destination);
    return manifest;
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function stageOptimizedFloorSchemeAsset(scheme, token) {
  const destination = floorSchemeDestination(scheme.imageUrl);
  const temporary = `${destination}.prepare-${token}`;
  await unlink(temporary).catch(() => {});
  try {
    await sharp(destination, { limitInputPixels: maxFloorSchemeImagePixels })
      .webp({ lossless: true, effort: 6 })
      .toFile(temporary);
    const manifest = await inspectFloorSchemeAsset(temporary, scheme, false);
    return { target: destination, temporary, manifest };
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function stageJSONFile(target, serialized, token) {
  const temporary = `${target}.prepare-${token}`;
  await unlink(temporary).catch(() => {});
  await writeFile(temporary, serialized);
  const staged = await readFile(temporary, 'utf8');
  JSON.parse(staged);
  if (staged !== serialized) throw new Error(`Staged JSON changed while writing ${target}`);
  return { target, temporary };
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function commitStagedFiles(entries, { failAfterCommits = 0 } = {}) {
  if (new Set(entries.map((entry) => entry.target)).size !== entries.length) {
    throw new Error('Staged transaction contains duplicate destinations');
  }
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const states = entries.map((entry) => ({ ...entry, backup: `${entry.target}.backup-${token}`, backedUp: false, committed: false }));
  let committed = 0;
  try {
    for (const state of states) {
      if (!await pathExists(state.temporary)) throw new Error(`Staged file disappeared before commit: ${state.temporary}`);
      if (await pathExists(state.target)) {
        await rename(state.target, state.backup);
        state.backedUp = true;
      }
      await rename(state.temporary, state.target);
      state.committed = true;
      committed += 1;
      if (failAfterCommits > 0 && committed === failAfterCommits) {
        throw new Error(`Injected staged commit failure after ${committed} files`);
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const state of [...states].reverse()) {
      try {
        if (state.committed) await unlink(state.target).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
        if (state.backedUp) await rename(state.backup, state.target);
        await unlink(state.temporary).catch((unlinkError) => {
          if (unlinkError?.code !== 'ENOENT') throw unlinkError;
        });
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${String(error)}; rollback failures: ${rollbackErrors.join('; ')}`);
    }
    throw error;
  }
  for (const state of states) {
    if (state.backedUp) await unlink(state.backup).catch(() => {});
  }
}

async function runStagedCommitRollbackSelfTest() {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'mirador-floor-transaction-'));
  try {
    const targets = ['mapping.json', 'client.json', 'scheme.webp'].map((name) => resolve(temporaryDirectory, name));
    for (const [index, target] of targets.entries()) await writeFile(target, `old-${index}`);
    const stage = async () => {
      const entries = [];
      for (const [index, target] of targets.entries()) {
        const temporary = `${target}.stage`;
        await writeFile(temporary, `new-${index}`);
        entries.push({ target, temporary });
      }
      return entries;
    };
    try {
      await commitStagedFiles(await stage(), { failAfterCommits: 2 });
      throw new Error('Staged transaction self-test did not inject a middle failure');
    } catch (error) {
      if (!String(error).includes('Injected staged commit failure')) throw error;
    }
    for (const [index, target] of targets.entries()) {
      if (await readFile(target, 'utf8') !== `old-${index}`) throw new Error('Staged transaction failed to restore an original after a middle failure');
      if (await pathExists(`${target}.stage`)) throw new Error('Staged transaction left a temporary file after rollback');
    }
    await commitStagedFiles(await stage());
    for (const [index, target] of targets.entries()) {
      if (await readFile(target, 'utf8') !== `new-${index}`) throw new Error('Staged transaction did not commit every file');
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runFloorSchemeAssetLifecycleSelfTest() {
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'mirador-floor-scheme-'));
  const destination = resolve(temporaryDirectory, 'fixture.webp');
  const width = 512;
  const height = 384;
  const pixels = Buffer.alloc(width * height * 4);
  let state = 0x6d2b79f5;
  for (let index = 0; index < pixels.length; index += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    pixels[index] = state & 255;
    pixels[index + 1] = (state >>> 8) & 255;
    pixels[index + 2] = (state >>> 16) & 255;
    pixels[index + 3] = 255;
  }
  const fixture = { width, height, imageBytes: 0, imageSha256: '' };
  try {
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(destination);
    const manifest = await optimizeFloorSchemeAssetAtPath(destination, fixture);
    Object.assign(fixture, manifest);
    await inspectFloorSchemeAsset(destination, fixture, true);
    const rejected = { ...fixture, imageSha256: '0'.repeat(64) };
    try {
      await inspectFloorSchemeAsset(destination, rejected, true);
    } catch (error) {
      if (String(error).includes('manifest mismatch')) return;
      throw error;
    }
    throw new Error('Floor-scheme asset lifecycle self-test accepted a mismatched SHA-256');
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function buildAsset([localImageUrl, sourceImageUrl]) {
  const destination = destinationFor(localImageUrl);
  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(sourceImageUrl, { headers: { accept: 'image/png,image/*;q=0.8' } });
  if (!response.ok) throw new Error(`${sourceImageUrl}: HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) throw new Error(`${sourceImageUrl}: expected image, received ${contentType || 'unknown content type'}`);
  const input = Buffer.from(await response.arrayBuffer());
  const temporary = `${destination}.tmp-${process.pid}`;
  await sharp(input, { limitInputPixels: 100_000_000 })
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .webp({ lossless: true, effort: 6 })
    .toFile(temporary);
  await rename(temporary, destination);
  await verifyAsset(localImageUrl);
}

const assets = [...assetMap.entries()];
if (auditCaptureOnly || prepareFloorSchemes) {
  for (const [localImageUrl] of assets) await verifyAsset(localImageUrl);
} else {
  let nextIndex = 0;
  const workers = Array.from({ length: 4 }, async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex++;
      await buildAsset(assets[index]);
    }
  });
  await Promise.all(workers);
}
await runFloorSchemeAssetLifecycleSelfTest();
await runStagedCommitRollbackSelfTest();
const prepareToken = `${process.pid}-${Date.now()}`;
const stagedFiles = [];
try {
  for (const [index, scheme] of verifiedFloorSchemes.schemes.entries()) {
    await verifyFloorSchemeSourceScreenshot(scheme);
    if (prepareFloorSchemes) {
      const staged = await stageOptimizedFloorSchemeAsset(scheme, `${prepareToken}-${index}`);
      stagedFiles.push(staged);
      Object.assign(scheme, staged.manifest);
      Object.assign(floorSchemeMapping.schemes[index], staged.manifest);
      Object.assign(floorSchemeClient.schemes[index], staged.manifest);
      await inspectFloorSchemeAsset(staged.temporary, scheme, true);
    } else {
      await verifyFloorSchemeAsset(scheme);
    }
  }

  for (const unit of bundle.units) delete unit.planImageUrl;
  for (const { association, unit } of exactAssociations) unit.planImageUrl = association.localImageUrl;
  for (const layout of bundle.layouts) {
    const source = representativeBySourceID.get(layout.sourceId);
    layout.imageUrl = source.localImageUrl;
    layout.thumbnailUrl = source.localImageUrl;
  }
  for (const phase of bundle.project.phases) {
    if (phase.slug === 'main') phase.imageUrl = mapping.projectImage.localImageUrl;
  }

  const exactUnits = bundle.units.filter((unit) => unit.planImageUrl);
  if (exactUnits.length !== 51) throw new Error(`Expected 51 exact unit plans, received ${exactUnits.length}`);
  const remoteImageURLs = JSON.stringify(bundle).match(/https?:\/\/[^\" ]*(?:profitbase|pb21432)[^\" ]*/gi) ?? [];
  if (remoteImageURLs.length) throw new Error(`Mirador bundle still contains ${remoteImageURLs.length} Profitbase runtime image URLs`);

  if (prepareFloorSchemes) {
    const revalidated = validateFloorSchemes(floorSchemeMapping, bundle, verifiedExpectedUniverse);
    if (JSON.stringify(revalidated.schemes.map(floorSchemeForClient)) !== JSON.stringify(floorSchemeClient.schemes) || revalidated.hotspotCount !== floorSchemeClient.hotspotCount) {
      throw new Error('Prepared raw and sanitized Mirador floor-scheme artifacts diverge');
    }
  }
  const serializedCatalog = `${JSON.stringify(catalog, null, 2)}\n`;
  const serializedFloorSchemeMapping = `${JSON.stringify(floorSchemeMapping, null, 2)}\n`;
  const serializedFloorSchemeClient = `${JSON.stringify(floorSchemeClient, null, 2)}\n`;
  const finalClientJSON = JSON.stringify(JSON.parse(serializedFloorSchemeClient));
  if (/profitbase\.ru|tenantOrigin|houseId|accountId|\"routes\"|sourceImageUrl/i.test(finalClientJSON)) {
    throw new Error('Prepared sanitized Mirador floor-scheme client artifact contains private source metadata');
  }

  if (auditCaptureOnly) {
    const [currentFloorSchemeClient, currentCatalog] = await Promise.all([
      readFile(floorSchemeClientPath, 'utf8'),
      readFile(catalogPath, 'utf8'),
    ]);
    if (currentFloorSchemeClient !== serializedFloorSchemeClient) {
      throw new Error('website/data/mirador-floor-schemes.json is stale; run npm run build:mirador-plans after updating the official source artifact');
    }
    if (currentCatalog !== serializedCatalog) throw new Error('website/data/kayan-catalog.json Mirador bundle is stale relative to the audited capture');
  } else {
    if (prepareFloorSchemes) {
      stagedFiles.push(await stageJSONFile(floorSchemeMappingPath, serializedFloorSchemeMapping, `${prepareToken}-mapping`));
    }
    stagedFiles.push(await stageJSONFile(floorSchemeClientPath, serializedFloorSchemeClient, `${prepareToken}-client`));
    stagedFiles.push(await stageJSONFile(catalogPath, serializedCatalog, `${prepareToken}-catalog`));
    await commitStagedFiles(stagedFiles);
    if (prepareFloorSchemes) {
      for (const scheme of verifiedFloorSchemes.schemes) await verifyFloorSchemeAsset(scheme);
    }
  }

  console.log(JSON.stringify({
    mode: auditCaptureOnly ? 'audit-capture' : prepareFloorSchemes ? 'prepare-floor-schemes' : 'build',
    snapshotUnits: bundle.units.length,
    capturedAssociations: mapping.associations.length,
    exactUnitPlans: exactUnits.length,
    representativeUnitFallbacks: bundle.units.length - exactUnits.length,
    rejectedAssociations: rejectedAssociations.length,
    exactAssets: exactAssetCount,
    representativeAssets: representativeAssetCount,
    floorSchemes: verifiedFloorSchemes.schemes.length,
    floorSchemeHotspots: verifiedFloorSchemes.hotspotCount,
    floorSchemeAssetsVerified: verifiedFloorSchemes.schemes.length,
    optimizedAssetsVerified: assets.length,
  }, null, 2));
} catch (error) {
  for (const entry of stagedFiles) await unlink(entry.temporary).catch(() => {});
  throw error;
}
