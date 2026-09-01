import floorSchemeArtifact from '@/data/mirador-floor-schemes.json';
import kayanCatalogArtifact from '@/data/kayan-catalog.json';
import type { MiradorBlockNumber } from './mirador-block-data';

const FLOOR_SCHEME_IMAGE_PREFIX = '/kayan/mirador/floor-schemes/';
const MAX_FLOOR_SCHEME_IMAGE_DIMENSION = 8192;
const MAX_FLOOR_SCHEME_IMAGE_PIXELS = 40_000_000;
const MAX_FLOOR_SCHEME_IMAGE_BYTES = 12 << 20;

type MiradorFloorSchemeCaptureStatus =
  | 'blocked-by-authentication'
  | 'captured-complete'
  | 'captured-partial';

type MiradorFloorSchemeCaptureMode = 'blocked' | 'complete' | 'partial';

type MiradorFloorSchemeScopeFloor = {
  entrance: string;
  floor: number;
};

type MiradorFloorSchemeScopeUnit = MiradorFloorSchemeScopeFloor & {
  unitNumber: string;
};

type MiradorFloorSchemeExpectedAssignment = MiradorFloorSchemeScopeUnit & {
  unitKey: string | null;
  evidence: 'locked-snapshot' | 'official-public-companion';
};

type MiradorFloorSchemeExpectedUniverse = {
  sourceObservedAt: string;
  expectedManifestByteSha256: string;
  schemeCount: number;
  unitCount: number;
  assignments: readonly MiradorFloorSchemeExpectedAssignment[];
};

type MiradorFloorSchemeAuditedExclusion = {
  kind: string;
  reason: string;
  evidence: string;
};

type MiradorFloorSchemeCaptureScope = {
  mode: MiradorFloorSchemeCaptureMode;
  declaredBlocks: readonly MiradorBlockNumber[];
  declaredEntrances: readonly string[];
  declaredFloors: readonly MiradorFloorSchemeScopeFloor[];
  declaredUnitHotspots: readonly MiradorFloorSchemeScopeUnit[];
  schemeCount: number;
  hotspotCount: number;
  auditedExclusions: readonly MiradorFloorSchemeAuditedExclusion[];
};

export type MiradorFloorSchemeZone = {
  /** Stable source key when the unit exists in the locked snapshot; null for the 10 public-companion records. */
  unitKey: string | null;
  unitNumber: string;
  points: string;
  label: { x: number; y: number };
};

export type MiradorFloorScheme = {
  /** Official Profitbase entrance identifier used by the catalogue filters. */
  entrance: string;
  floor: number;
  /** Local public asset path. Remote runtime URLs are not accepted. */
  imageUrl: string;
  imageSha256: string;
  imageBytes: number;
  width: number;
  height: number;
  sourceScreenshotSha256: string;
  sourceCrop: { x: number; y: number; width: number; height: number };
  zones: readonly MiradorFloorSchemeZone[];
};

type MiradorFloorSchemeCompanionEvidence = {
  source: 'mirador-plans-public-dom-v1';
  sourceObservedAt: string;
  recordCount: 10;
  unitNumbers: readonly string[];
  recordsSha256: string;
};

type MiradorFloorSchemeArtifact = {
  schemaVersion: number;
  projectSlug: string;
  capturedAt: string | null;
  captureStatus: MiradorFloorSchemeCaptureStatus;
  captureScope: unknown;
  sourceStatus: string;
  sourceObservedAt: string;
  floorSchemeCount: number;
  hotspotCount: number;
  blockEntranceMapping: unknown;
  companionEvidence: unknown;
  expectedUniverse: unknown;
  schemes: unknown;
};

export type MiradorCatalogUnit = {
  id: number;
  sourceKey: string;
  projectSlug: string;
  phaseSlug: string;
  propertyType: string;
  isActive: boolean;
  number: string;
  entrance?: string;
  floor: number;
};

type KayanCatalogArtifact = {
  projects: Array<{
    project: { slug: string; phases: Array<{ slug: string; updatedAt: string }> };
    units: MiradorCatalogUnit[];
  }>;
};

export type ValidatedMiradorFloorSchemeArtifact = {
  capturedAt: string | null;
  captureStatus: MiradorFloorSchemeCaptureStatus;
  captureScope: MiradorFloorSchemeCaptureScope;
  sourceStatus: string;
  sourceObservedAt: string;
  blockEntranceMapping: null;
  companionEvidence: MiradorFloorSchemeCompanionEvidence | null;
  expectedUniverse: MiradorFloorSchemeExpectedUniverse | null;
  schemes: readonly MiradorFloorScheme[];
  hotspotCount: number;
};

const miradorCatalog = (kayanCatalogArtifact as unknown as KayanCatalogArtifact).projects
  .find((bundle) => bundle.project.slug === 'mirador');
if (!miradorCatalog) throw new Error('Mirador is missing from the sanitized KAYAN catalogue');
const miradorMainPhase = miradorCatalog.project.phases.find((phase) => phase.slug === 'main');
if (!miradorMainPhase) throw new Error('Mirador main phase is missing from the sanitized KAYAN catalogue');

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanonicalString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isEligibleMiradorFloorSchemeUnit(unit: MiradorCatalogUnit) {
  return unit.projectSlug === 'mirador'
    && unit.phaseSlug === 'main'
    && unit.propertyType === 'apartment'
    && unit.isActive === true;
}

const MIRADOR_ENTRANCES = ['1', '2', '3'] as const;
const MIRADOR_COMPANION_UNIT_NUMBERS = new Set(['44', '45', '47', '48', '49', '114', '115', '116', '118', '119']);

function expectedFloorSchemeKeys() {
  const keys: string[] = [];
  for (let floor = 2; floor <= 8; floor += 1) keys.push(`1\u001f${floor}`);
  for (let floor = 2; floor <= 13; floor += 1) keys.push(`2\u001f${floor}`);
  for (let floor = 2; floor <= 16; floor += 1) keys.push(`3\u001f${floor}`);
  return keys.sort();
}

const MIRADOR_EXPECTED_SCHEME_KEYS = expectedFloorSchemeKeys();

function officialUnitTuple(unitNumber: string) {
  const number = Number(unitNumber);
  if (!Number.isSafeInteger(number) || number < 1 || number > 209) return null;
  if (number <= 49) return { entrance: '1', floor: 2 + Math.floor((number - 1) / 7) };
  if (number <= 53) return { entrance: '2', floor: 2 };
  if (number <= 119) return { entrance: '2', floor: 3 + Math.floor((number - 54) / 6) };
  return { entrance: '3', floor: 2 + Math.floor((number - 120) / 6) };
}

function isOfficialCompanionTuple(entrance: string, floor: number, unitNumber: string) {
  const tuple = officialUnitTuple(unitNumber);
  return MIRADOR_COMPANION_UNIT_NUMBERS.has(unitNumber)
    && tuple?.entrance === entrance
    && tuple.floor === floor;
}

function validateCompanionEvidence(input: unknown, required: boolean): MiradorFloorSchemeCompanionEvidence | null {
  if (!required) {
    if (input !== null) throw new Error('A blocked or partial Mirador capture cannot publish companion evidence');
    return null;
  }
  const expectedUnitNumbers = [...MIRADOR_COMPANION_UNIT_NUMBERS];
  if (
    !isRecord(input)
    || input.source !== 'mirador-plans-public-dom-v1'
    || !isCanonicalString(input.sourceObservedAt)
    || !Number.isFinite(Date.parse(input.sourceObservedAt))
    || input.recordCount !== expectedUnitNumbers.length
    || !Array.isArray(input.unitNumbers)
    || !exactJSON(input.unitNumbers, expectedUnitNumbers)
    || typeof input.recordsSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.recordsSha256)
  ) {
    throw new Error('Mirador companion evidence is missing or malformed');
  }
  return input as unknown as MiradorFloorSchemeCompanionEvidence;
}

function validateLocalFloorSchemeImage(imageUrl: unknown): imageUrl is string {
  if (typeof imageUrl !== 'string') return false;
  const relativePath = imageUrl.slice(FLOOR_SCHEME_IMAGE_PREFIX.length);
  return imageUrl.startsWith(FLOOR_SCHEME_IMAGE_PREFIX)
    && imageUrl.endsWith('.webp')
    && !imageUrl.includes('://')
    && !/[?#\\%]/.test(imageUrl)
    && /^[A-Za-z0-9][A-Za-z0-9/_-]*\.webp$/.test(relativePath)
    && !relativePath.split('/').some((segment) => !segment || segment === '.' || segment === '..');
}

function validatePolygon(points: unknown, width: number, height: number) {
  if (typeof points !== 'string' || !points || points !== points.trim()) return false;
  const pairs = points.split(' ');
  if (pairs.length < 3 || pairs.some((pair) => !pair)) return false;
  const parsed = pairs.map((pair) => {
    const coordinates = pair.split(',');
    if (coordinates.length !== 2 || coordinates.some((coordinate) => !coordinate)) return null;
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    return Number.isFinite(x) && x >= 0 && x <= width && Number.isFinite(y) && y >= 0 && y <= height
      ? { x, y }
      : null;
  });
  if (parsed.some((point) => point === null)) return false;
  const pointsInBounds = parsed as Array<{ x: number; y: number }>;
  if (new Set(pointsInBounds.map(({ x, y }) => `${x}\u001f${y}`)).size < 3) return false;
  const doubledArea = pointsInBounds.reduce((sum, point, index) => {
    const next = pointsInBounds[(index + 1) % pointsInBounds.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  return Math.abs(doubledArea) >= 0.000001;
}

function validateOfficialHotspotSquare(
  points: string,
  label: { x: number; y: number },
) {
  const parsed = points.split(' ').map((pair) => pair.split(',').map(Number));
  if (parsed.length !== 4 || parsed.some((pair) => pair.length !== 2 || pair.some((value) => !Number.isFinite(value)))) {
    return false;
  }
  const xs = [...new Set(parsed.map(([x]) => x))].sort((left, right) => left - right);
  const ys = [...new Set(parsed.map(([, y]) => y))].sort((left, right) => left - right);
  if (xs.length !== 2 || ys.length !== 2 || xs[1] - xs[0] !== 44 || ys[1] - ys[0] !== 44) return false;
  const corners = new Set(parsed.map(([x, y]) => `${x}\u001f${y}`));
  return corners.size === 4
    && xs.every((x) => ys.every((y) => corners.has(`${x}\u001f${y}`)))
    && label.x === xs[0] + 22
    && label.y === ys[0] + 22;
}

function validateAuditedExclusion(input: unknown): input is MiradorFloorSchemeAuditedExclusion {
  if (!isRecord(input)) return false;
  const { kind, reason, evidence } = input;
  return isCanonicalString(kind)
    && kind.length <= 80
    && isCanonicalString(reason)
    && reason.length <= 160
    && isCanonicalString(evidence)
    && evidence.length <= 1000
    && !/[\u0000\r\n]/.test(`${kind}${reason}${evidence}`);
}

function compareFloorScope(left: MiradorFloorSchemeScopeFloor, right: MiradorFloorSchemeScopeFloor) {
  return left.entrance.localeCompare(right.entrance, undefined, { numeric: true }) || left.floor - right.floor;
}

function compareUnitScope(left: MiradorFloorSchemeScopeUnit, right: MiradorFloorSchemeScopeUnit) {
  return compareFloorScope(left, right)
    || left.unitNumber.localeCompare(right.unitNumber, undefined, { numeric: true });
}

function compareExpectedAssignment(
  left: MiradorFloorSchemeExpectedAssignment,
  right: MiradorFloorSchemeExpectedAssignment,
) {
  return compareUnitScope(left, right)
    || (left.unitKey ?? '').localeCompare(right.unitKey ?? '')
    || left.evidence.localeCompare(right.evidence);
}

function exactJSON(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateMiradorFloorSchemes(
  input: unknown,
  catalogUnits: readonly MiradorCatalogUnit[],
): readonly MiradorFloorScheme[] {
  if (!Array.isArray(input)) throw new Error('Mirador floor scheme artifact must contain a schemes array');

  const catalogUnitsBySourceKey = new Map<string, MiradorCatalogUnit[]>();
  for (const unit of catalogUnits) {
    if (!isCanonicalString(unit.sourceKey)) continue;
    const matches = catalogUnitsBySourceKey.get(unit.sourceKey) ?? [];
    matches.push(unit);
    catalogUnitsBySourceKey.set(unit.sourceKey, matches);
  }

  const floorKeys = new Set<string>();
  const canonicalUnitKeys = new Set<string>();
  const globalUnitNumbers = new Set<string>();
  const validatedSchemes: MiradorFloorScheme[] = [];

  for (const rawScheme of input) {
    if (!isRecord(rawScheme)) throw new Error('Mirador floor scheme must be an object');
    if (Object.hasOwn(rawScheme, 'block')) {
      throw new Error('Mirador floor schemes cannot infer a visual block association');
    }
    const key = `${String(rawScheme.entrance)}:${String(rawScheme.floor)}`;
    if (floorKeys.has(key)) {
      throw new Error(`Duplicate Mirador floor scheme for entrance ${String(rawScheme.entrance)}, floor ${String(rawScheme.floor)}`);
    }
    floorKeys.add(key);

    if (!isCanonicalString(rawScheme.entrance)) {
      throw new Error(`Mirador floor scheme ${key} has no official entrance association`);
    }
    if (!isPositiveInteger(rawScheme.floor)) {
      throw new Error(`Mirador floor scheme ${key} has an invalid floor`);
    }
    if (!validateLocalFloorSchemeImage(rawScheme.imageUrl)) {
      throw new Error(`Mirador floor scheme ${key} must use a strict local WebP path`);
    }
    if (
      !isPositiveInteger(rawScheme.width)
      || !isPositiveInteger(rawScheme.height)
      || rawScheme.width > MAX_FLOOR_SCHEME_IMAGE_DIMENSION
      || rawScheme.height > MAX_FLOOR_SCHEME_IMAGE_DIMENSION
      || rawScheme.width * rawScheme.height > MAX_FLOOR_SCHEME_IMAGE_PIXELS
    ) {
      throw new Error(`Mirador floor scheme ${key} has invalid image dimensions`);
    }
    if (
      !isPositiveInteger(rawScheme.imageBytes)
      || rawScheme.imageBytes < 1024
      || rawScheme.imageBytes > MAX_FLOOR_SCHEME_IMAGE_BYTES
      || typeof rawScheme.imageSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(rawScheme.imageSha256)
    ) {
      throw new Error(`Mirador floor scheme ${key} has an invalid local asset manifest`);
    }
    if (
      typeof rawScheme.sourceScreenshotSha256 !== 'string'
      || !/^[a-f0-9]{64}$/.test(rawScheme.sourceScreenshotSha256)
      || !isRecord(rawScheme.sourceCrop)
      || typeof rawScheme.sourceCrop.x !== 'number'
      || !Number.isSafeInteger(rawScheme.sourceCrop.x)
      || rawScheme.sourceCrop.x < 0
      || typeof rawScheme.sourceCrop.y !== 'number'
      || !Number.isSafeInteger(rawScheme.sourceCrop.y)
      || rawScheme.sourceCrop.y < 0
      || rawScheme.sourceCrop.width !== rawScheme.width
      || rawScheme.sourceCrop.height !== rawScheme.height
      || rawScheme.sourceCrop.x + rawScheme.sourceCrop.width > 1661
      || rawScheme.sourceCrop.y + rawScheme.sourceCrop.height > 811
    ) {
      throw new Error(`Mirador floor scheme ${key} has invalid source screenshot provenance`);
    }
    if (!Array.isArray(rawScheme.zones) || !rawScheme.zones.length) {
      throw new Error(`Mirador floor scheme ${key} has no apartment hotspot geometry`);
    }

    const unitNumbers = new Set<string>();
    const validatedZones: MiradorFloorSchemeZone[] = [];
    for (const rawZone of rawScheme.zones) {
      if (!isRecord(rawZone) || Object.hasOwn(rawZone, 'unitId')) {
        throw new Error(`Mirador floor scheme ${key} contains an invalid apartment hotspot identity`);
      }
      const label = rawZone.label;
      if (
        (rawZone.unitKey !== null && !isCanonicalString(rawZone.unitKey))
        || !isCanonicalString(rawZone.unitNumber)
        || typeof rawZone.points !== 'string'
        || !isRecord(label)
        || typeof label.x !== 'number'
        || !Number.isFinite(label.x)
        || typeof label.y !== 'number'
        || !Number.isFinite(label.y)
      ) {
        throw new Error(`Mirador floor scheme ${key} contains an incomplete apartment hotspot`);
      }
      if (!validatePolygon(rawZone.points, rawScheme.width, rawScheme.height)) {
        throw new Error(`Mirador floor scheme ${key}, apartment ${rawZone.unitNumber} has invalid polygon points`);
      }
      if (!validateOfficialHotspotSquare(rawZone.points, { x: label.x, y: label.y })) {
        throw new Error(`Mirador floor scheme ${key}, apartment ${rawZone.unitNumber} must preserve its official 44px marker geometry`);
      }
      if (label.x < 0 || label.x > rawScheme.width || label.y < 0 || label.y > rawScheme.height) {
        throw new Error(`Mirador floor scheme ${key}, apartment ${rawZone.unitNumber} has an out-of-bounds label`);
      }
      if (unitNumbers.has(rawZone.unitNumber)) {
        throw new Error(`Mirador floor scheme ${key} contains duplicate apartment ${rawZone.unitNumber}`);
      }
      if (globalUnitNumbers.has(rawZone.unitNumber)) {
        throw new Error(`Mirador floor scheme artifact contains duplicate apartment ${rawZone.unitNumber}`);
      }
      if (rawZone.unitKey === null) {
        if (!isOfficialCompanionTuple(rawScheme.entrance, rawScheme.floor, rawZone.unitNumber)) {
          throw new Error(`Mirador floor scheme ${key}, apartment ${rawZone.unitNumber} has no verified companion evidence`);
        }
      } else {
        if (canonicalUnitKeys.has(rawZone.unitKey)) {
          throw new Error(`Mirador floor scheme artifact contains duplicate canonical unit key ${rawZone.unitKey}`);
        }
        const catalogMatches = (catalogUnitsBySourceKey.get(rawZone.unitKey) ?? []).filter((unit) => (
          isEligibleMiradorFloorSchemeUnit(unit)
          && unit.number === rawZone.unitNumber
          && unit.entrance === rawScheme.entrance
          && unit.floor === rawScheme.floor
        ));
        if (catalogMatches.length !== 1) {
          throw new Error(`Mirador floor scheme ${key}, apartment ${rawZone.unitNumber} has no unique exact catalogue association`);
        }
        canonicalUnitKeys.add(rawZone.unitKey);
      }
      unitNumbers.add(rawZone.unitNumber);
      globalUnitNumbers.add(rawZone.unitNumber);
      validatedZones.push({
        unitKey: rawZone.unitKey,
        unitNumber: rawZone.unitNumber,
        points: rawZone.points,
        label: { x: label.x, y: label.y },
      });
    }

    validatedSchemes.push({
      entrance: rawScheme.entrance,
      floor: rawScheme.floor,
      imageUrl: rawScheme.imageUrl,
      imageSha256: rawScheme.imageSha256,
      imageBytes: rawScheme.imageBytes,
      width: rawScheme.width,
      height: rawScheme.height,
      sourceScreenshotSha256: rawScheme.sourceScreenshotSha256,
      sourceCrop: {
        x: rawScheme.sourceCrop.x,
        y: rawScheme.sourceCrop.y,
        width: rawScheme.sourceCrop.width,
        height: rawScheme.sourceCrop.height,
      },
      zones: validatedZones,
    });
  }

  return validatedSchemes;
}

function validateCaptureScope(
  input: unknown,
  captureStatus: MiradorFloorSchemeCaptureStatus,
  schemes: readonly MiradorFloorScheme[],
  hotspotCount: number,
): MiradorFloorSchemeCaptureScope {
  if (!isRecord(input)) throw new Error('Mirador floor-scheme captureScope is missing');
  const {
    mode,
    declaredBlocks,
    declaredEntrances,
    declaredFloors,
    declaredUnitHotspots,
    schemeCount,
    auditedExclusions,
  } = input;
  if (
    (mode !== 'blocked' && mode !== 'complete' && mode !== 'partial')
    || !Array.isArray(declaredBlocks)
    || !Array.isArray(declaredEntrances)
    || !Array.isArray(declaredFloors)
    || !Array.isArray(declaredUnitHotspots)
    || !Number.isSafeInteger(schemeCount)
    || !Number.isSafeInteger(input.hotspotCount)
    || !Array.isArray(auditedExclusions)
    || auditedExclusions.some((exclusion) => !validateAuditedExclusion(exclusion))
  ) {
    throw new Error('Mirador floor-scheme captureScope is malformed');
  }
  if (schemeCount !== schemes.length || input.hotspotCount !== hotspotCount) {
    throw new Error('Mirador floor-scheme captureScope counts do not match the payload');
  }

  if (!schemes.length) {
    if (
      captureStatus !== 'blocked-by-authentication'
      || mode !== 'blocked'
      || auditedExclusions.length === 0
      || declaredBlocks.length !== 0
      || declaredEntrances.length !== 0
      || declaredFloors.length !== 0
      || declaredUnitHotspots.length !== 0
    ) {
      throw new Error('Empty Mirador floor schemes require a fully audited blocked capture scope');
    }
  } else if (captureStatus === 'captured-complete') {
    if (mode !== 'complete' || auditedExclusions.length !== 0) {
      throw new Error('Complete Mirador floor-scheme capture cannot contain exclusions');
    }
  } else if (captureStatus === 'captured-partial') {
    if (mode !== 'partial' || auditedExclusions.length === 0) {
      throw new Error('Partial Mirador floor-scheme capture requires audited exclusions');
    }
  } else {
    throw new Error('Non-empty Mirador floor schemes require a captured status');
  }

  const actualEntrances = [...new Set(schemes.map((scheme) => scheme.entrance))].sort((left, right) => left.localeCompare(right));
  const actualFloors = schemes
    .map(({ entrance, floor }) => ({ entrance, floor }))
    .sort(compareFloorScope);
  const actualUnits = schemes
    .flatMap((scheme) => scheme.zones.map(({ unitNumber }) => ({
      entrance: scheme.entrance,
      floor: scheme.floor,
      unitNumber,
    })))
    .sort(compareUnitScope);
  if (
    !exactJSON(declaredBlocks, [])
    || !exactJSON(declaredEntrances, actualEntrances)
    || !exactJSON(declaredFloors, actualFloors)
    || !exactJSON(declaredUnitHotspots, actualUnits)
  ) {
    throw new Error('Mirador floor-scheme declared capture sets do not exactly cover the payload');
  }

  if (captureStatus === 'captured-complete') {
    const actualSchemeKeys = schemes.map((scheme) => `${scheme.entrance}\u001f${scheme.floor}`).sort();
    if (
      !exactJSON(actualEntrances, MIRADOR_ENTRANCES)
      || !exactJSON(actualSchemeKeys, MIRADOR_EXPECTED_SCHEME_KEYS)
      || hotspotCount !== 209
    ) {
      throw new Error('Complete Mirador capture must contain the exact 34 entrance/floor schemes and 209 apartments');
    }
  }

  return input as unknown as MiradorFloorSchemeCaptureScope;
}

function validateExpectedUniverse(
  input: unknown,
  captureStatus: MiradorFloorSchemeCaptureStatus,
  sourceObservedAt: string,
  schemes: readonly MiradorFloorScheme[],
  catalogUnits: readonly MiradorCatalogUnit[],
): MiradorFloorSchemeExpectedUniverse | null {
  if (captureStatus !== 'captured-complete') {
    if (input !== null) throw new Error('Only a complete Mirador floor-scheme capture may claim an expected universe');
    return null;
  }
  if (input === null) {
    throw new Error('Complete Mirador floor schemes require an independent expected-universe manifest');
  }
  if (!isRecord(input)) {
    throw new Error('Mirador expected universe must be a sanitized manifest or null');
  }
  if (
    input.sourceObservedAt !== sourceObservedAt
    || !isCanonicalString(input.sourceObservedAt)
    || !Number.isFinite(Date.parse(input.sourceObservedAt))
    || typeof input.expectedManifestByteSha256 !== 'string'
    || !/^[a-f0-9]{64}$/.test(input.expectedManifestByteSha256)
    || !isPositiveInteger(input.schemeCount)
    || !isPositiveInteger(input.unitCount)
    || !Array.isArray(input.assignments)
    || input.assignments.length !== input.unitCount
  ) {
    throw new Error('Mirador expected-universe manifest has invalid provenance, checksum, or counts');
  }

  const eligibleUnits = catalogUnits.filter(isEligibleMiradorFloorSchemeUnit);
  const eligibleBySourceKey = new Map<string, MiradorCatalogUnit[]>();
  for (const unit of eligibleUnits) {
    if (!isCanonicalString(unit.sourceKey)) {
      throw new Error('Mirador expected universe references an eligible catalogue unit without a canonical source key');
    }
    const matches = eligibleBySourceKey.get(unit.sourceKey) ?? [];
    matches.push(unit);
    eligibleBySourceKey.set(unit.sourceKey, matches);
  }
  if (!eligibleUnits.length || eligibleUnits.length + MIRADOR_COMPANION_UNIT_NUMBERS.size !== input.unitCount) {
    throw new Error('Mirador expected universe must distinguish the locked snapshot from the official public companion');
  }

  const seenUnitKeys = new Set<string>();
  const seenUnitNumbers = new Set<string>();
  const assignments: MiradorFloorSchemeExpectedAssignment[] = [];
  for (const rawAssignment of input.assignments) {
    if (
      !isRecord(rawAssignment)
      || Object.hasOwn(rawAssignment, 'block')
      || !isCanonicalString(rawAssignment.entrance)
      || !isPositiveInteger(rawAssignment.floor)
      || !isCanonicalString(rawAssignment.unitNumber)
      || seenUnitNumbers.has(rawAssignment.unitNumber)
      || (rawAssignment.evidence !== 'locked-snapshot' && rawAssignment.evidence !== 'official-public-companion')
    ) {
      throw new Error('Mirador expected-universe manifest contains an invalid or duplicate unit assignment');
    }
    const officialTuple = officialUnitTuple(rawAssignment.unitNumber);
    if (officialTuple?.entrance !== rawAssignment.entrance || officialTuple.floor !== rawAssignment.floor) {
      throw new Error(`Mirador expected apartment ${rawAssignment.unitNumber} has an invalid official entrance/floor tuple`);
    }

    if (rawAssignment.evidence === 'official-public-companion') {
      if (rawAssignment.unitKey !== null || !isOfficialCompanionTuple(rawAssignment.entrance, rawAssignment.floor, rawAssignment.unitNumber)) {
        throw new Error(`Mirador companion apartment ${rawAssignment.unitNumber} has invalid evidence or identity`);
      }
    } else {
      if (!isCanonicalString(rawAssignment.unitKey) || seenUnitKeys.has(rawAssignment.unitKey)) {
        throw new Error(`Mirador locked-snapshot apartment ${rawAssignment.unitNumber} has an invalid source key`);
      }
      const catalogMatches = (eligibleBySourceKey.get(rawAssignment.unitKey) ?? []).filter((unit) => (
        unit.entrance === rawAssignment.entrance
        && unit.floor === rawAssignment.floor
        && unit.number === rawAssignment.unitNumber
      ));
      if (catalogMatches.length !== 1) {
        throw new Error(`Mirador expected assignment ${rawAssignment.unitKey} has no unique exact catalogue association`);
      }
      seenUnitKeys.add(rawAssignment.unitKey);
    }
    seenUnitNumbers.add(rawAssignment.unitNumber);
    assignments.push({
      entrance: rawAssignment.entrance,
      floor: rawAssignment.floor,
      unitNumber: rawAssignment.unitNumber,
      unitKey: rawAssignment.unitKey,
      evidence: rawAssignment.evidence,
    });
  }
  if (
    seenUnitKeys.size !== eligibleBySourceKey.size
    || [...eligibleBySourceKey.keys()].some((key) => !seenUnitKeys.has(key))
    || seenUnitNumbers.size !== 209
    || Array.from({ length: 209 }, (_, index) => String(index + 1)).some((number) => !seenUnitNumbers.has(number))
  ) {
    throw new Error('Mirador expected universe does not partition every eligible catalogue unit exactly once');
  }

  const sortedAssignments = assignments.sort(compareExpectedAssignment);
  const payloadAssignments = schemes.flatMap((scheme) => scheme.zones.map((zone) => ({
    entrance: scheme.entrance,
    floor: scheme.floor,
    unitNumber: zone.unitNumber,
    unitKey: zone.unitKey,
    evidence: zone.unitKey === null ? 'official-public-companion' as const : 'locked-snapshot' as const,
  }))).sort(compareExpectedAssignment);

  const expectedSchemeKeys = [...new Set(sortedAssignments.map((assignment) => (
    `${assignment.entrance}\u001f${assignment.floor}`
  )))].sort();
  const payloadSchemeKeys = schemes.map((scheme) => (
    `${scheme.entrance}\u001f${scheme.floor}`
  )).sort();
  if (
    input.schemeCount !== expectedSchemeKeys.length
    || input.schemeCount !== 34
    || input.unitCount !== 209
    || !exactJSON(expectedSchemeKeys, MIRADOR_EXPECTED_SCHEME_KEYS)
  ) {
    throw new Error('Mirador expected universe has invalid entrance/floor coverage');
  }
  if (
    captureStatus === 'captured-complete'
    && (
      !exactJSON(sortedAssignments, payloadAssignments)
      || input.schemeCount !== schemes.length
      || !exactJSON(expectedSchemeKeys, payloadSchemeKeys)
    )
  ) {
    throw new Error('Complete Mirador floor schemes differ from the independent expected scheme and unit universe');
  }

  return {
    sourceObservedAt: input.sourceObservedAt,
    expectedManifestByteSha256: input.expectedManifestByteSha256,
    schemeCount: input.schemeCount,
    unitCount: input.unitCount,
    assignments: sortedAssignments,
  };
}

/** Pure runtime validator for generated client artifacts and non-empty contract fixtures. */
export function validateMiradorFloorSchemeArtifact(
  input: unknown,
  catalogUnits: readonly MiradorCatalogUnit[],
  lockedSnapshotCapturedAt: string,
): ValidatedMiradorFloorSchemeArtifact {
  if (!isRecord(input) || input.schemaVersion !== 2 || input.projectSlug !== 'mirador') {
    throw new Error('Unsupported Mirador floor scheme artifact');
  }
  const artifact = input as unknown as MiradorFloorSchemeArtifact;
  if (!Array.isArray(artifact.schemes)) {
    throw new Error('Mirador floor scheme artifact must contain a schemes array');
  }
  if (
    !isCanonicalString(artifact.sourceObservedAt)
    || !Number.isFinite(Date.parse(artifact.sourceObservedAt))
  ) {
    throw new Error('Mirador floor scheme artifact has an invalid sanitized observation timestamp');
  }
  if (artifact.blockEntranceMapping !== null) {
    throw new Error('Mirador visual blocks have no proven association with CRM entrances');
  }
  if (artifact.schemes.length === 0) {
    if (
      artifact.capturedAt !== null
      || artifact.captureStatus !== 'blocked-by-authentication'
      || artifact.sourceStatus !== 'blocked-by-authentication'
      || artifact.floorSchemeCount !== 0
      || artifact.hotspotCount !== 0
    ) {
      throw new Error('Empty Mirador floor scheme artifact must remain an honest authentication blocker');
    }
  } else if (
    typeof artifact.capturedAt !== 'string'
    || !Number.isFinite(Date.parse(artifact.capturedAt))
    || !Number.isFinite(Date.parse(lockedSnapshotCapturedAt))
    || Date.parse(artifact.capturedAt) < Date.parse(lockedSnapshotCapturedAt)
    || (artifact.captureStatus !== 'captured-complete' && artifact.captureStatus !== 'captured-partial')
    || artifact.sourceStatus !== 'captured-read-only'
  ) {
    throw new Error('Captured Mirador floor schemes have invalid provenance');
  }

  const companionEvidence = validateCompanionEvidence(
    artifact.companionEvidence,
    artifact.captureStatus === 'captured-complete',
  );
  const schemes = validateMiradorFloorSchemes(artifact.schemes, catalogUnits);
  const hotspotCount = schemes.reduce((total, scheme) => total + scheme.zones.length, 0);
  if (artifact.floorSchemeCount !== schemes.length || artifact.hotspotCount !== hotspotCount) {
    throw new Error('Mirador floor scheme artifact counts do not match its payload');
  }
  const captureScope = validateCaptureScope(
    artifact.captureScope,
    artifact.captureStatus,
    schemes,
    hotspotCount,
  );
  const expectedUniverse = validateExpectedUniverse(
    artifact.expectedUniverse,
    artifact.captureStatus,
    artifact.sourceObservedAt,
    schemes,
    catalogUnits,
  );

  return {
    capturedAt: artifact.capturedAt,
    captureStatus: artifact.captureStatus,
    captureScope,
    sourceStatus: artifact.sourceStatus,
    sourceObservedAt: artifact.sourceObservedAt,
    blockEntranceMapping: null,
    companionEvidence,
    expectedUniverse,
    schemes,
    hotspotCount,
  };
}

const validatedArtifact = validateMiradorFloorSchemeArtifact(
  floorSchemeArtifact,
  miradorCatalog.units,
  miradorMainPhase.updatedAt,
);

/** Generated only from an authenticated, read-only official Profitbase capture. */
export const MIRADOR_FLOOR_SCHEMES = validatedArtifact.schemes;

export const MIRADOR_FLOOR_SCHEME_STATUS = {
  capturedAt: validatedArtifact.capturedAt,
  captureStatus: validatedArtifact.captureStatus,
  captureScope: validatedArtifact.captureScope,
  floorSchemeCount: validatedArtifact.schemes.length,
  hotspotCount: validatedArtifact.hotspotCount,
  blockEntranceMapping: validatedArtifact.blockEntranceMapping,
  companionEvidence: validatedArtifact.companionEvidence,
  expectedUniverse: validatedArtifact.expectedUniverse,
  sourceStatus: validatedArtifact.sourceStatus,
  sourceObservedAt: validatedArtifact.sourceObservedAt,
} as const;
