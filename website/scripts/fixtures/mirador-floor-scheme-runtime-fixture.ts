import { validateMiradorFloorSchemeArtifact, type MiradorCatalogUnit } from '../../app/kayan/mirador-floor-scheme-data';

const observedAt = '2026-08-31T17:49:54.000Z';
const lockedAt = '2026-08-29T08:46:56.739Z';
const companionNumbers = new Set(['44', '45', '47', '48', '49', '114', '115', '116', '118', '119']);

function officialTuple(unitNumber: number) {
  if (unitNumber <= 49) return { entrance: '1', floor: 2 + Math.floor((unitNumber - 1) / 7) };
  if (unitNumber <= 53) return { entrance: '2', floor: 2 };
  if (unitNumber <= 119) return { entrance: '2', floor: 3 + Math.floor((unitNumber - 54) / 6) };
  return { entrance: '3', floor: 2 + Math.floor((unitNumber - 120) / 6) };
}

const allAssignments = Array.from({ length: 209 }, (_, index) => {
  const unitNumber = String(index + 1);
  const tuple = officialTuple(index + 1);
  const companion = companionNumbers.has(unitNumber);
  return {
    ...tuple,
    unitNumber,
    unitKey: companion ? null : `fixture-unit-${unitNumber}`,
    evidence: companion ? 'official-public-companion' as const : 'locked-snapshot' as const,
  };
});

const catalogUnits: MiradorCatalogUnit[] = allAssignments
  .filter((assignment) => assignment.unitKey !== null)
  .map((assignment, index) => ({
    id: index + 1,
    sourceKey: assignment.unitKey as string,
    projectSlug: 'mirador',
    phaseSlug: 'main',
    propertyType: 'apartment',
    isActive: true,
    number: assignment.unitNumber,
    entrance: assignment.entrance,
    floor: assignment.floor,
  }));

const groupedAssignments = new Map<string, typeof allAssignments>();
for (const assignment of allAssignments) {
  const key = `${assignment.entrance}:${assignment.floor}`;
  const existing = groupedAssignments.get(key) ?? [];
  existing.push(assignment);
  groupedAssignments.set(key, existing);
}

const schemes = [...groupedAssignments.entries()].map(([key, assignments], index) => {
  const { entrance, floor } = assignments[0];
  return {
    entrance,
    floor,
    imageUrl: `/kayan/mirador/floor-schemes/runtime-${key.replace(':', '-')}.webp`,
    imageSha256: ((index % 15) + 1).toString(16).repeat(64),
    imageBytes: 2048,
    width: 300,
    height: 300,
    sourceScreenshotSha256: (((index + 1) % 15) + 1).toString(16).repeat(64),
    sourceCrop: { x: 10, y: 10, width: 300, height: 300 },
    zones: assignments.map((assignment, zoneIndex) => {
      const x = 20 + zoneIndex * 38;
      const y = 100;
      return {
        unitKey: assignment.unitKey,
        unitNumber: assignment.unitNumber,
        points: `${x},${y} ${x + 44},${y} ${x + 44},${y + 44} ${x},${y + 44}`,
        label: { x: x + 22, y: y + 22 },
      };
    }),
  };
});

const completeArtifact = {
  schemaVersion: 2,
  projectSlug: 'mirador',
  capturedAt: observedAt,
  captureStatus: 'captured-complete',
  captureScope: {
    mode: 'complete',
    declaredBlocks: [],
    declaredEntrances: ['1', '2', '3'],
    declaredFloors: schemes.map(({ entrance, floor }) => ({ entrance, floor })),
    declaredUnitHotspots: allAssignments.map(({ entrance, floor, unitNumber }) => ({ entrance, floor, unitNumber })),
    schemeCount: schemes.length,
    hotspotCount: allAssignments.length,
    auditedExclusions: [] as Array<{ kind: string; reason: string; evidence: string }>,
  },
  sourceStatus: 'captured-read-only',
  sourceObservedAt: observedAt,
  floorSchemeCount: schemes.length,
  hotspotCount: allAssignments.length,
  blockEntranceMapping: null,
  companionEvidence: {
    source: 'mirador-plans-public-dom-v1',
    sourceObservedAt: '2026-08-31T12:43:28.000Z',
    recordCount: 10,
    unitNumbers: [...companionNumbers],
    recordsSha256: 'e'.repeat(64),
  },
  expectedUniverse: {
    sourceObservedAt: observedAt,
    expectedManifestByteSha256: 'a'.repeat(64),
    schemeCount: schemes.length,
    unitCount: allAssignments.length,
    assignments: allAssignments,
  },
  schemes,
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function expectRejected(candidate: unknown, label: string) {
  try {
    validateMiradorFloorSchemeArtifact(candidate, catalogUnits, lockedAt);
  } catch {
    return;
  }
  throw new Error(`Mirador runtime validator accepted ${label}`);
}

const validated = validateMiradorFloorSchemeArtifact(completeArtifact, catalogUnits, lockedAt);
if (
  validated.schemes.length !== 34
  || validated.hotspotCount !== 209
  || validated.expectedUniverse?.assignments.length !== 209
  || validated.expectedUniverse.assignments.filter((assignment) => assignment.unitKey === null).length !== 10
) {
  throw new Error('Mirador runtime validator rejected the exact 34-scheme / 209-apartment contract');
}

const missingUnit = clone(completeArtifact);
missingUnit.expectedUniverse.assignments.pop();
missingUnit.expectedUniverse.unitCount -= 1;
expectRejected(missingUnit, 'an expected universe missing one official apartment');

const duplicateUnit = clone(completeArtifact);
duplicateUnit.expectedUniverse.assignments[208] = clone(duplicateUnit.expectedUniverse.assignments[0]);
expectRejected(duplicateUnit, 'an expected universe containing a duplicate apartment');

const inventedCompanionKey = clone(completeArtifact);
const companion = inventedCompanionKey.expectedUniverse.assignments.find((assignment) => assignment.unitNumber === '44');
if (!companion) throw new Error('Companion fixture apartment 44 is missing');
companion.unitKey = 'invented-unit-key';
expectRejected(inventedCompanionKey, 'an invented source key for a public-companion apartment');

const inferredBlock = clone(completeArtifact);
Object.assign(inferredBlock.schemes[0], { block: 1 });
expectRejected(inferredBlock, 'an inferred visual-block-to-entrance association');

const malformedMarker = clone(completeArtifact);
malformedMarker.schemes[0].zones[0].points = '20,100 65,100 65,144 20,144';
expectRejected(malformedMarker, 'a hotspot that changes the official 44px marker geometry');

const badScreenshotProvenance = clone(completeArtifact);
badScreenshotProvenance.schemes[0].sourceCrop.width += 1;
expectRejected(badScreenshotProvenance, 'a derived image whose crop provenance does not match its dimensions');

const badCompanionEvidence = clone(completeArtifact);
badCompanionEvidence.companionEvidence.unitNumbers.pop();
expectRejected(badCompanionEvidence, 'an incomplete public companion evidence set');

const partialWithUniverse = clone(completeArtifact);
partialWithUniverse.captureStatus = 'captured-partial';
partialWithUniverse.captureScope.mode = 'partial';
partialWithUniverse.captureScope.auditedExclusions = [{
  kind: 'fixture',
  reason: 'partial-capture',
  evidence: 'Runtime contract negative fixture.',
}];
expectRejected(partialWithUniverse, 'a partial capture claiming a complete universe');
