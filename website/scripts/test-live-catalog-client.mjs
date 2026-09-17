import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { catalogLeadIdentity, initialCatalogUnits, liveCatalogQueueOptions, mergeLiveCatalogUnits, parseCatalogDate } from '../app/live-catalog.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../app/live-catalog.ts', import.meta.url), 'utf8');

assert.match(source, /configuredAPI\s*\|\|\s*['"]\/residence-api\/catalog['"]/, 'the compiled browser fallback must match the deployed nginx catalogue prefix');
assert.doesNotMatch(source, /configuredAPI\s*\|\|[^\n]*\/residence-api[`'"]/, 'the browser must not fall back to the unserved /residence-api root');
assert.match(source, /credentials:\s*'include'/);
assert.match(source, /cache:\s*'no-store'/);
assert.match(source, /refreshIntervalMs\s*=\s*60_000/);
assert.match(source, /catalog response is partial/);
assert.match(source, /catalog response spans multiple import generations/);
assert.match(source, /localStorage/);
assert.match(source, /localStorage\.removeItem\(cacheKey\(projectSlug\)\)/, 'available-only catalogues must discard long-lived catalogue caches');
assert.match(source, /if \(!requiresCurrentAvailability\) saveCachedPayload/, 'available-only catalogues must not persist stale availability');
assert.doesNotMatch(source, /Math\.max\(Date\.now\(\)/, 'source freshness must not be replaced by browser fetch time');
assert.doesNotMatch(source, /phaseSlug\.match|phaseName\.match/, 'queue identity must not be parsed from phase labels');

const queueOptions = liveCatalogQueueOptions({ queues: [
  { queueKey: 'q3', queueLabel: 'II очередь', queueDisplayCode: 'II', queueOrder: 2, totalUnits: 6, availableUnits: 6 },
  { queueKey: 'q1', queueLabel: 'I очередь', queueDisplayCode: 'I', queueOrder: 1, totalUnits: 4, availableUnits: 4 },
] });
assert.deepEqual(queueOptions.map(({ queueKey, queueLabel }) => ({ queueKey, queueLabel })), [
  { queueKey: 'q1', queueLabel: 'I очередь' },
  { queueKey: 'q3', queueLabel: 'II очередь' },
], 'queue options use authoritative labels and explicit ordering, not raw q-number ordinals');
assert.deepEqual(liveCatalogQueueOptions({ queues: [queueOptions[0]] }), [], 'projects with only one CRM queue do not need a queue selector');
assert.deepEqual(liveCatalogQueueOptions({ queues: [queueOptions[0], { ...queueOptions[1], queueOrder: 1 }] }), [], 'invalid queue metadata fails closed');

const integrations = new Map([
  ['avalon-residence', 'app/page.tsx'],
  ['4u', 'app/4u/apartments/four-u-unified-catalog.tsx'],
  ['bayterak', 'app/bayterak/apartments/bayterak-unified-catalog.tsx'],
  ['botanika-saroyi', 'app/botanika-saroyi/apartments/botanika-unified-catalog.tsx'],
  ['c1', 'app/c1/apartments/c1-unified-catalog.tsx'],
  ['flagman', 'app/flagman/apartments/flagman-unified-catalog.tsx'],
  ['jomiy', 'app/jomiy/apartments/jomiy-unified-catalog.tsx'],
  ['maftun-makon', 'app/maftun-makon/apartments/maftun-makon-unified-catalog.tsx'],
  ['meros', 'app/meros/apartments/meros-unified-catalog.tsx'],
  ['mirador', 'app/mirador/apartments/mirador-unified-catalog.tsx'],
  ['ofiyat', 'app/ofiyat/apartments/ofiyat-unified-catalog.tsx'],
  ['regnum-plaza', 'app/regnum-plaza/apartments/regnum-unified-catalog.tsx'],
  ['saadiyat', 'app/saadiyat/apartments/saadiyat-unified-catalog.tsx'],
  ['sarbon', 'app/sarbon/apartments/sarbon-unified-catalog.tsx'],
  ['sado', 'app/sado/apartments/sado-unified-catalog.tsx'],
  ['soy-boyi', 'app/soy-boyi/apartments/soy-boyi-unified-catalog.tsx'],
  ['sun', 'app/sun/apartments/sun-unified-catalog.tsx'],
  ['voha', 'app/voha/apartments/voha-unified-catalog.tsx'],
  ['yangibaxt', 'app/yangibaxt/apartments/yangibaxt-unified-catalog.tsx'],
  ['zamon', 'app/zamon/apartments/zamon-unified-catalog.tsx'],
]);

const unifiedEngine = await readFile(new URL('../app/catalog/apartment-catalog.tsx', import.meta.url), 'utf8');
assert.match(unifiedEngine, /rememberLiveCatalogUnit\(\{ sourceKey: activeLeadUnit\.unitKey \}/, 'unified leads must remember only canonical source keys');
assert.match(unifiedEngine, /unitKey=\{activeLeadUnit\?\.unitKey\}/, 'unified leads must submit only canonical source keys');
assert.doesNotMatch(unifiedEngine, /unitId=\{/, 'unified leads must not submit stale embedded ids');

for (const [slug, relativePath] of integrations) {
  const page = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  if (slug === 'avalon-residence') {
    assert.ok(page.includes("useLiveCatalogUnits('avalon-residence'"), `${slug} must use the live catalogue as its primary client source`);
    assert.match(page, /const availableUnits = useMemo\(\(\) => units\.filter\(\(unit\) => unit\.status === 'free'\)/, `${slug} must establish a single available-only source for every selector surface`);
    assert.match(page, /const floors = useMemo\(\(\) => floorList\(availableUnits, selectedBuilding\)/, `${slug} must expose only floors that contain available units`);
    assert.match(page, /const selectedUnit = selectedUnitId \? availableUnits\.find/, `${slug} must drop a selected unit as soon as it is no longer available`);
    assert.match(page, /if \(!unit \|\| unit\.status !== 'free'\) return null/, `${slug} must preserve floor-plan indexing while hiding non-available polygons`);
    assert.match(page, /availableFloorUnits\.map\(\(unit\) => <button/, `${slug} mobile floor picker must list only available units`);
    assert.match(page, /availableBuildingUnits\.filter\(\(unit\) => unit\.floor === floor\)[\s\S]*?\.map\(\(unit\) => <button/, `${slug} chess view must list only available units`);
    assert.match(page, /const chooseUnit = \(unit: Apartment\) => \{\s*if \(unit\.status !== 'free'\) return;/, `${slug} deep unit selection must fail closed for non-available inventory`);
    assert.doesNotMatch(page, /\bonlyFree\b|\bsetOnlyFree\b/, `${slug} must not expose an optional availability toggle`);
    assert.doesNotMatch(page, /status-legend|table-status/, `${slug} must not expose sold, reserved, or status-filter UI`);
    continue;
  }
  assert.match(page, new RegExp(`useLiveCatalog(?:Snapshot|Units)(?:<[^>]+>)?\\(['\"]${slug}['\"]`), `${slug} must use the live catalogue as its primary client source`);
  assert.match(page, /unitKey:/, `${slug} must map canonical source keys into the shared lead engine`);
  assert.doesNotMatch(page, /unitId=\{/, `${slug} must not submit a stale embedded unit id`);
}

const landingIntegrations = new Map([
  ['4u', ['app/4u/four-u-page.tsx', "useLiveCatalogProject('4u'"]],
  ['bayterak', ['app/bayterak/bayterak-page.tsx', "useLiveCatalogProject('bayterak'"]],
  ['botanika-saroyi', ['app/botanika-saroyi/botanika-saroyi-page.tsx', "useLiveCatalogProject('botanika-saroyi'"]],
  ['c1', ['app/c1/c1-page.tsx', "useLiveCatalogUnits('c1'"]],
  ['flagman', ['app/flagman/flagman-page.tsx', "useLiveCatalogProject('flagman'"]],
  ['jomiy', ['app/jomiy/jomiy-page.tsx', "useLiveCatalogProject('jomiy'"]],
  ['maftun-makon', ['app/maftun-makon/maftun-makon-page.tsx', "useLiveCatalogProject('maftun-makon'"]],
  ['meros', ['app/meros/meros-page.tsx', "useLiveCatalogProject('meros'"]],
  ['regnum-plaza', ['app/regnum-plaza/regnum-page.tsx', "useLiveCatalogUnits('regnum-plaza'"]],
  ['sarbon', ['app/sarbon/sarbon-page.tsx', 'useLiveCatalogSnapshot("sarbon"']],
  ['sado', ['app/sado/sado-page.tsx', "useLiveCatalogProject('sado'"]],
  ['soy-boyi', ['app/soy-boyi/soy-boyi-page.tsx', 'useLiveCatalogUnits("soy-boyi"']],
  ['sun', ['app/sun/sun-page.tsx', "useLiveCatalogSnapshot('sun'"]],
  ['voha', ['app/voha/voha-page.tsx', "useLiveCatalogProject('voha'"]],
  ['yangibaxt', ['app/yangibaxt/yangibaxt-page.tsx', "useLiveCatalogProject('yangibaxt'"]],
  ['zamon', ['app/zamon/zamon-page.tsx', "useLiveCatalogProject('zamon'"]],
]);

for (const [slug, [relativePath, marker]] of landingIntegrations) {
  const page = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  assert.ok(page.includes(marker), `${slug} landing availability must use live catalogue data`);
}

const newLiveSites = new Map([
  ['c1', {
    catalogue: 'app/c1/apartments/c1-unified-catalog.tsx',
    landing: 'app/c1/c1-page.tsx',
    dynamicCount: /project\?\.availableUnits\s*\?\?\s*initialAvailableCount/,
  }],
  ['soy-boyi', {
    catalogue: 'app/soy-boyi/apartments/soy-boyi-unified-catalog.tsx',
    landing: 'app/soy-boyi/soy-boyi-page.tsx',
    dynamicCount: /liveCatalog\.project\?\.availableUnits\s*\?\?\s*availableCount/,
  }],
]);

for (const [slug, paths] of newLiveSites) {
  const [catalogue, landing] = await Promise.all([
    readFile(new URL(`../${paths.catalogue}`, import.meta.url), 'utf8'),
    readFile(new URL(`../${paths.landing}`, import.meta.url), 'utf8'),
  ]);
  assert.match(catalogue, /unitKey:/, `${slug} catalogue must map only a canonical live source key`);
  assert.doesNotMatch(catalogue, /unitId=\{/, `${slug} catalogue must not submit a stale embedded unit id`);
  assert.ok(landing.includes('catalogLeadIdentity'), `${slug} landing must submit only a canonical live source key`);
  assert.ok(landing.includes('rememberLiveCatalogUnit'), `${slug} landing must remember only live catalogue identities`);
  assert.doesNotMatch(landing, /unitId=\{/, `${slug} landing must not submit a stale embedded unit id`);
  for (const [surface, page] of [['catalogue', catalogue], ['landing', landing]]) {
    assert.doesNotMatch(page, /свежем официальном (?:snapshot|снимке)|Снимок получен|Yangi rasmiy snapshotda|Snapshot olingan vaqt|fresh official snapshot|Latest official availability snapshot|Snapshot captured/iu, `${slug} ${surface} must not show snapshot terminology to users`);
  }
  assert.match(landing, paths.dynamicCount, `${slug} landing count must follow the live project payload with an embedded fallback`);
}

const kayan = await readFile(new URL('../app/kayan/project-page.tsx', import.meta.url), 'utf8');
for (const slug of ['meros', 'mirador', 'ofiyat']) {
  const adapter = await readFile(new URL(`../app/${slug}/apartments/${slug}-unified-catalog.tsx`, import.meta.url), 'utf8');
  assert.match(adapter, new RegExp(`useLiveCatalog(?:Snapshot|Units)(?:<[^>]+>)?\\(['\"]${slug}['\"]`), `${slug} must route through the live Kayan catalogue`);
}
assert.match(kayan, /liveCatalogAPIBase\(\)/);
assert.match(kayan, /credentials:\s*'include'/);
assert.match(kayan, /cache:\s*'no-store'/);
assert.match(kayan, /setInterval\(refresh,\s*60_000\)/);

const embedded = [{
  id: 'embedded-other-unit',
  sourceKey: 'embedded-source-key',
  number: '101',
  rooms: 2,
  floor: 1,
  area: 45,
  entrance: 9,
  building: 'Wrong building',
  buildingId: 'wrong-building',
  status: 'available',
  price: 1,
  oldPrice: 2,
  regularPrice: 2,
  completionDate: '2028-06-30',
  sourcePlacementCompletionDate: '2028-06-30',
  plan: '/foreign-plan.webp',
  sourcePlan: 'https://example.invalid/private-plan',
  thumbnail: '/foreign-thumb.webp',
  sheetPage1: '/foreign-sheet.webp',
  coordinates: { x: 73, y: 41 },
  provenance: { api: 'private-source', sourceSha256: 'secret-ish-source-id' },
}];
const live = [{
  id: 42,
  sourceKey: 'live-unit-42',
  projectSlug: 'safe-project',
  phaseSlug: 'phase-2',
  phaseName: 'Phase 2',
  propertyType: 'apartment',
  rawPropertyType: 'Apartment',
  status: 'reserved',
  rawStatus: 'Reserved',
  number: '909',
  entrance: '3',
  floor: 9,
  area: 79.5,
  rooms: 3,
  price: 990_000_000,
  pricePerM2: 12_452_830,
  repairIncluded: true,
  currency: 'UZS',
  isActive: true,
  sourceUpdatedAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
}];
const [unmatched] = mergeLiveCatalogUnits('safe-project', embedded, live);
assert.equal(unmatched.id, 42);
assert.equal(unmatched.sourceKey, 'live-unit-42');
assert.equal(unmatched.number, '909');
assert.equal(unmatched.entrance, 3);
assert.equal(unmatched.building, 'Phase 2');
assert.equal(unmatched.buildingId, 'phase-2');
assert.equal(unmatched.status, 'reserved');
assert.equal(unmatched.price, 990_000_000);
assert.equal(unmatched.oldPrice, 0, 'a second price must not be invented from the single normalized price');
assert.equal(unmatched.regularPrice, 0, 'a regular price must remain absent until the API models it');
assert.equal(unmatched.repairIncluded, true, 'the authoritative CRM repair flag must reach a newly discovered unit');
assert.equal(unmatched.completionDate, '', 'an unmatched live unit must not inherit another unit completion date');
assert.equal(unmatched.plan, '');
assert.equal(unmatched.sourcePlan, '');
assert.equal(unmatched.thumbnail, '');
assert.equal(unmatched.sheetPage1, '');
assert.deepEqual(unmatched.coordinates, { x: 0, y: 0 });
assert.deepEqual(unmatched.provenance, { api: '', sourceSha256: '' });

const [unknownRepair] = mergeLiveCatalogUnits('safe-project', [{
  ...embedded[0],
  sourceKey: live[0].sourceKey,
  repairIncluded: true,
}], [{ ...live[0], repairIncluded: undefined }]);
assert.equal(unknownRepair.repairIncluded, undefined, 'a provider that omits repair data must not inherit a stale embedded true/false value');

const merosBlockId = '08bccd05-81ee-4934-8652-5d40474e07be';
const merosUnitId = 'e209805e-662d-4d34-9b01-27b309e9a609';
const officialNrgPlan = `https://s3.bi.group/crm-clients-e1csales/layouts/${merosBlockId}/${merosUnitId}/224(13)_1600.png`;
const merosTemplate = [{
  ...embedded[0],
  number: '224(13)',
  floor: 3,
  area: 71.23,
  rooms: 3,
  entrance: 4,
  plan: '/meros/plans/0237.webp',
}];
const merosLive = {
  ...live[0],
  sourceKey: `nrg-bi:meros:${merosUnitId}`,
  projectSlug: 'meros',
  phaseSlug: `block-${merosBlockId}`,
  status: 'available',
  number: '224(13)',
  floor: 3,
  area: 71.23,
  rooms: 3,
  entrance: '4',
  planImageUrl: officialNrgPlan,
};
const highResolutionMerosUnits = mergeLiveCatalogUnits('meros', merosTemplate, [
  merosLive,
  { ...merosLive, sourceKey: 'nrg-bi:meros:ffffffff-ffff-4fff-8fff-ffffffffffff', status: 'sold', number: '271(59)', floor: 10, area: 35.58, rooms: 1, planImageUrl: undefined },
]);
assert.deepEqual(highResolutionMerosUnits.map((unit) => unit.floor), [3], 'Meros must omit the sold floor-10 lifecycle row');
assert.equal(highResolutionMerosUnits[0]?.plan, officialNrgPlan, 'the exact official NRG 1600px plan must replace the embedded 400px preview');

for (const rejectedPlan of [
  '/\\attacker.example/pixel.png',
  officialNrgPlan.replace('https://', 'http://'),
  officialNrgPlan.replace('s3.bi.group', 's3.bi.group.evil.test'),
  officialNrgPlan.replace('_1600.png', '_400.png'),
  `${officialNrgPlan}?token=secret`,
]) {
  const [unsafeMeros] = mergeLiveCatalogUnits('meros', merosTemplate, [{ ...merosLive, planImageUrl: rejectedPlan }]);
  assert.equal(unsafeMeros.plan, '/meros/plans/0237.webp', `untrusted plan URL must not replace the embedded asset: ${rejectedPlan}`);
}

const stableGroupId = 'd7207ffd-9265-11ed-a82b-001dd8b726aa';
const [matchedJomiy] = mergeLiveCatalogUnits('jomiy', [{
  id: 'embedded-jomiy-unit',
  sourceKey: 'embedded-jomiy-source-key',
  number: '58(57)',
  rooms: 2,
  floor: 11,
  area: 61.84,
  entrance: 1,
  buildingId: stableGroupId,
  building: 'NRG Jomiy - 2 . 1',
  phaseSlug: 'embedded-phase',
}], [{
  ...live[0],
  id: 58,
  sourceKey: 'jomiy:unit:58',
  projectSlug: 'jomiy',
  phaseSlug: 'nrg-jomiy-2-1',
  phaseName: 'NRG Jomiy - 2 . 1',
  status: 'available',
  rawStatus: 'Available',
  number: '58(57)',
  entrance: '1',
  floor: 11,
  area: 61.84,
  rooms: 2,
}]);
assert.equal(matchedJomiy.buildingId, stableGroupId, 'a matched unit must retain the bespoke matrix group join key');
assert.equal([matchedJomiy].filter((unit) => unit.buildingId === stableGroupId).length, 1, 'matrix group filtering must keep matched live rows');

const reserved4U = { ...live[0], projectSlug: '4u', status: 'reserved' };
assert.equal(mergeLiveCatalogUnits('4u', embedded, [reserved4U]).length, 0, 'available-only UI must not label a reserved unit as available');
assert.deepEqual(initialCatalogUnits('4u', embedded), [], 'available-only UI must fail closed before a current API generation is loaded');
assert.deepEqual(initialCatalogUnits('maftun-makon', embedded), [], 'an embedded NRG snapshot must never be used as current availability');
assert.deepEqual(initialCatalogUnits('mirador', embedded), [], 'Kayan catalogues must not expose stale embedded availability');
assert.deepEqual(initialCatalogUnits('ofiyat', embedded), [], 'Kayan catalogues must not expose stale embedded availability');
assert.deepEqual(initialCatalogUnits('avalon-residence', embedded), [], 'Avalon must fail closed until current Uysot availability is loaded');
assert.deepEqual(initialCatalogUnits('safe-project', embedded), embedded, 'status-aware catalogues may keep their embedded presentation fallback');
for (const projectSlug of ['4u', 'bayterak', 'botanika-saroyi', 'flagman', 'jomiy', 'maftun-makon', 'meros', 'mirador', 'ofiyat', 'sado', 'voha', 'yangibaxt', 'zamon']) {
  const sold = { ...live[0], projectSlug, status: 'sold', price: undefined };
  assert.equal(mergeLiveCatalogUnits(projectSlug, embedded, [sold]).length, 0, `${projectSlug} must not expose a matrix SOLD row in the available-unit catalogue`);
}
const fourUnitId = '546458ee-a312-4073-be02-cecfde18623b';
const fourBlockId = 'f61f45d8-6138-4161-abee-aed9e4d11a4e';
const fourOriginal = `https://s3.bi.group/crm-clients-e1csales/layouts/${fourBlockId}/${fourUnitId}/10.png`;
const fourTemplate = [{
  ...embedded[0], id: 'legacy-4u-id', sourceKey: 'legacy-4u-key', number: '10', rooms: 1, floor: 3, area: 39.85, entrance: '1',
  phase: '4U Tashkent 1 - 2', blockId: fourBlockId, planImageUrl: '', planOriginalUrl: '', planPreviewUrl: '', planThumbnailUrl: '', planSource: '',
}];
const fourLive = {
  ...live[0], id: 3323, sourceKey: `nrg-bi:4u:${fourUnitId}`, projectSlug: '4u', phaseSlug: `block-${fourBlockId}`,
  phaseName: '4U Tashkent 1 - 2', number: '10', rooms: 1, floor: 3, area: 39.85, entrance: '1', status: 'available', planImageUrl: fourOriginal,
};
const [adapted4U] = mergeLiveCatalogUnits('4u', fourTemplate, [fourLive]);
assert.equal(adapted4U.planImageUrl, fourOriginal, '4U keeps the validated suffixless detail original');
assert.equal(adapted4U.planOriginalUrl, fourOriginal, '4U lightbox receives the detail original');
assert.equal(adapted4U.planPreviewUrl, fourOriginal.replace(/\.png$/, '_1600.png'), '4U cards receive the 1600px source variant');
assert.equal(adapted4U.planThumbnailUrl, fourOriginal.replace(/\.png$/, '_200.png'));
assert.equal(adapted4U.blockId, fourBlockId);

const newFourUnitId = '746458ee-a312-4073-be02-cecfde18623b';
const newFourOriginal = `https://s3.bi.group/crm-clients-e1csales/layouts/${fourBlockId}/${newFourUnitId}/999.png`;
const [unmatched4U] = mergeLiveCatalogUnits('4u', fourTemplate, [{
  ...fourLive,
  id: 3325,
  sourceKey: `nrg-bi:4u:${newFourUnitId}`,
  number: '999',
  rooms: 4,
  floor: 14,
  area: 123.45,
  entrance: '9',
  planImageUrl: newFourOriginal,
}]);
assert.equal(unmatched4U.phase, '4U Tashkent 1 - 2', 'a new 4U unit exposes the block name instead of its source UUID');
assert.equal(unmatched4U.buildingId, `block-${fourBlockId}`);
assert.equal(unmatched4U.blockId, fourBlockId);
assert.equal(unmatched4U.planOriginalUrl, newFourOriginal);
assert.equal(unmatched4U.planPreviewUrl, newFourOriginal.replace(/\.png$/, '_1600.png'));

const [unmatchedBad4U] = mergeLiveCatalogUnits('4u', fourTemplate, [{
  ...fourLive, id: 3324, sourceKey: 'nrg-bi:4u:646458ee-a312-4073-be02-cecfde18623b', number: '11', planImageUrl: `${fourOriginal}?token=forbidden`,
}]);
assert.equal(unmatchedBad4U.planImageUrl, '', 'an unbound 4U remote URL must not reach a newly discovered unit');
assert.equal(unmatchedBad4U.planOriginalUrl, '');
assert.equal(unmatchedBad4U.planPreviewUrl, '');
const soldSun = { ...live[0], projectSlug: 'sun', status: 'sold', price: undefined };
assert.equal(mergeLiveCatalogUnits('sun', embedded, [soldSun]).length, 0, 'SUN must not expose sold or reserved rows as available at zero price');
assert.equal(mergeLiveCatalogUnits('safe-project', embedded, live).length, 1, 'status-aware UI keeps non-available units');

const mbcTemplate = [{ ...embedded[0], phase: '2', section: 'A5', entrance: undefined, completionYear: '2027' }];
const mbcSaadiyat = {
  ...live[0],
  projectSlug: 'saadiyat',
  phaseSlug: 'q2-sa5',
  phaseName: 'A5',
  entrance: 'A5',
  status: 'available',
  completion: '2029',
  queueKey: 'q2',
  queueLabel: 'II очередь',
  queueDisplayCode: 'II',
  queueOrder: 2,
};
const [adaptedMbc] = mergeLiveCatalogUnits('saadiyat', mbcTemplate, [mbcSaadiyat]);
assert.equal(adaptedMbc.phase, '', 'an unmatched MBC unit never exposes a raw qN phase as queue presentation');
assert.equal(adaptedMbc.section, 'A5');
assert.equal(adaptedMbc.queueKey, 'q2');
assert.equal(adaptedMbc.queueLabel, 'II очередь');
assert.equal(adaptedMbc.queueDisplayCode, 'II');
assert.equal(adaptedMbc.queueOrder, 2);
assert.equal(adaptedMbc.completionYear, '2029', 'Saadiyat must display the live MBC completion instead of its embedded year');

const [adaptedC1] = mergeLiveCatalogUnits('c1', mbcTemplate, [{ ...mbcSaadiyat, projectSlug: 'c1' }]);
assert.equal(adaptedC1.completionYear, '2029', 'C1 must display the live MBC completion');

const soyTemplate = [{ ...embedded[0], completion: '2026' }];
const [adaptedSoy] = mergeLiveCatalogUnits('soy-boyi', soyTemplate, [{
  ...live[0],
  projectSlug: 'soy-boyi',
  status: 'available',
  completion: '2028',
}]);
assert.equal(adaptedSoy.completion, '2028', 'Soy Bo\u2018yi must display the live MBC completion');
const [unmatchedSoyWithoutCompletion] = mergeLiveCatalogUnits('soy-boyi', soyTemplate, [{
  ...live[0],
  projectSlug: 'soy-boyi',
  status: 'available',
}]);
assert.equal(unmatchedSoyWithoutCompletion.completion, null, 'an unmatched Soy Bo\u2018yi unit must not inherit a stale embedded completion');

assert.deepEqual(catalogLeadIdentity({ id: 'embedded-id', sourceKey: 'nrg:unit:42' }), { unitKey: 'nrg:unit:42' });
assert.deepEqual(catalogLeadIdentity({ id: 'embedded-id' }), {}, 'embedded presentation IDs must never be submitted as CRM identities');
assert.equal(parseCatalogDate(''), null, 'missing completion dates from unmatched live units must not reach Intl.DateTimeFormat');
assert.equal(parseCatalogDate('not-a-date'), null, 'malformed catalogue dates must not reach Intl.DateTimeFormat');
assert.equal(parseCatalogDate('2028-06-30', true)?.toISOString(), '2028-06-30T12:00:00.000Z');

const leadModal = await readFile(new URL('../app/lead-modal.tsx', import.meta.url), 'utf8');
assert.match(leadModal, /if \(projectSlug\)[\s\S]*typeof value\.unitKey !== 'string'/, 'project-scoped history must require a canonical unit key');
assert.match(leadModal, /localStorage\.removeItem\(key\)/, 'legacy project-scoped unit ids must be discarded');

assert.ok(root.endsWith('/website/'));
console.log(`Live catalogue client contract OK: ${integrations.size + 3} project catalogues and ${landingIntegrations.size} live landings`);
