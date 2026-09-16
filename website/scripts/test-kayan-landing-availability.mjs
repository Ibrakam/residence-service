import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [
  projectPage,
  miradorPage,
  miradorExplorer,
  ofiyatExplorer,
  ofiyatExplorerRoute,
  catalog,
  floorSchemes,
] = await Promise.all([
  readFile(resolve(websiteRoot, 'app/kayan/project-page.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/mirador/page.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/kayan/mirador-block-explorer.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/kayan/ofiyat-block-explorer.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/api/kayan/ofiyat-explorer/route.ts'), 'utf8'),
  readFile(resolve(websiteRoot, 'data/kayan-catalog.json'), 'utf8').then(JSON.parse),
  readFile(resolve(websiteRoot, 'data/mirador-floor-schemes.json'), 'utf8').then(JSON.parse),
]);

const normalizedProjectPage = projectPage.replace(/\s+/g, ' ');
const normalizedMiradorPage = miradorPage.replace(/\s+/g, ' ');
const normalizedMiradorExplorer = miradorExplorer.replace(/\s+/g, ' ');
const normalizedOfiyatExplorer = ofiyatExplorer.replace(/\s+/g, ' ');
const normalizedOfiyatRoute = ofiyatExplorerRoute.replace(/\s+/g, ' ');

assert(
  normalizedOfiyatRoute.includes("unit.status === 'available' && (unit.phaseSlug === 'phase-1' || unit.phaseSlug === 'phase-2')"),
  'Ofiyat explorer API must expose only available residential units',
);
assert(
  normalizedOfiyatExplorer.includes("unit.status === 'available' && residentialPhases.includes(unit.phaseSlug as typeof residentialPhases[number])"),
  'Ofiyat explorer must defensively reject non-available units even if an upstream response regresses',
);
assert(!ofiyatExplorer.includes('statusRank'), 'Ofiyat explorer must not retain non-available status ordering');

assert(
  normalizedMiradorPage.includes("unit.status === 'available' && unit.sourceKey.trim() ? [unit.sourceKey.trim()] : []"),
  'Mirador landing must seed its floor explorer with verified available source keys',
);
assert(
  normalizedProjectPage.includes("async function fetchLiveAvailableUnitKeys(slug: KayanProjectSlug, signal: AbortSignal)"),
  'Mirador landing must refresh available identities from the live catalogue',
);
assert(
  normalizedProjectPage.includes("if (units.length !== expectedTotal || units.length !== project.totalUnits) throw new Error('catalog response is partial')"),
  'Mirador availability refresh must fail closed on a partial catalogue response',
);
assert(
  normalizedProjectPage.includes('availableUnitKeys={miradorAvailableUnitKeys}'),
  'Mirador landing must pass refreshed available identities into its visual explorer',
);
assert(
  normalizedMiradorExplorer.includes('zone.unitKey !== null && availableUnitKeySet.has(zone.unitKey)'),
  'Mirador floor hotspots must be intersected with verified available identities',
);

const ofiyat = catalog.projects.find((bundle) => bundle.project.slug === 'ofiyat');
const mirador = catalog.projects.find((bundle) => bundle.project.slug === 'mirador');
assert(ofiyat && mirador, 'KAYAN project bundles are missing');

const ofiyatResidentialAvailable = ofiyat.units.filter((unit) => (
  unit.status === 'available' && (unit.phaseSlug === 'phase-1' || unit.phaseSlug === 'phase-2')
));
const ofiyatResidentialSummary = ofiyat.project.phases
  .filter((phase) => phase.slug === 'phase-1' || phase.slug === 'phase-2')
  .reduce((total, phase) => total + phase.availableUnits, 0);
assert.equal(ofiyatResidentialAvailable.length, ofiyatResidentialSummary, 'Ofiyat available explorer count drifted from residential phase summaries');
assert(ofiyat.units.some((unit) => unit.status !== 'available'), 'Ofiyat fixture no longer exercises the availability boundary');

const miradorAvailableKeys = new Set(mirador.units
  .filter((unit) => unit.status === 'available')
  .map((unit) => unit.sourceKey));
const filteredHotspots = floorSchemes.schemes.flatMap((scheme) => (
  scheme.zones.filter((zone) => zone.unitKey !== null && miradorAvailableKeys.has(zone.unitKey))
));
assert.equal(filteredHotspots.length, mirador.project.availableUnits, 'Every available Mirador unit must map to exactly one verified floor hotspot');
assert(filteredHotspots.every((zone) => miradorAvailableKeys.has(zone.unitKey)), 'Mirador filtered hotspots leaked a non-available unit');
assert(floorSchemes.hotspotCount > filteredHotspots.length, 'Mirador fixture no longer exercises sold/reserved hotspot removal');

console.log(JSON.stringify({
  ofiyat: { availableExplorerUnits: ofiyatResidentialAvailable.length },
  mirador: { availableExplorerHotspots: filteredHotspots.length, removedHotspots: floorSchemes.hotspotCount - filteredHotspots.length },
}, null, 2));
