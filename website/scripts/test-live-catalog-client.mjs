import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { catalogLeadIdentity, liveCatalogQueueOptions, mergeLiveCatalogUnits, parseCatalogDate } from '../app/live-catalog.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await readFile(new URL('../app/live-catalog.ts', import.meta.url), 'utf8');

assert.match(source, /\/residence-api/);
assert.match(source, /credentials:\s*'include'/);
assert.match(source, /cache:\s*'no-store'/);
assert.match(source, /refreshIntervalMs\s*=\s*60_000/);
assert.match(source, /catalog response is partial/);
assert.match(source, /catalog response spans multiple import generations/);
assert.match(source, /localStorage/);
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
  ['avalon-residence', ['app/page.tsx', "useLiveCatalogUnits('avalon-residence'"]],
  ['4u', ['app/4u/apartments/four-u-catalog.tsx', "useLiveCatalogSnapshot('4u'"]],
  ['bayterak', ['app/bayterak/apartments/bayterak-catalog.tsx', "useLiveCatalogSnapshot('bayterak'"]],
  ['botanika-saroyi', ['app/botanika-saroyi/apartments/botanika-catalog.tsx', "useLiveCatalogSnapshot('botanika-saroyi'"]],
  ['c1', ['app/c1/apartments/c1-catalog.tsx', "useLiveCatalogSnapshot('c1'"]],
  ['flagman', ['app/flagman/apartments/flagman-catalog-page.tsx', "useLiveCatalogSnapshot('flagman'"]],
  ['jomiy', ['app/jomiy/apartments/jomiy-catalog.tsx', 'useLiveCatalogSnapshot("jomiy"']],
  ['maftun-makon', ['app/maftun-makon/apartments/maftun-makon-catalog.tsx', "useLiveCatalogSnapshot('maftun-makon'"]],
  ['regnum-plaza', ['app/regnum-plaza/apartments/regnum-catalog.tsx', "useLiveCatalogSnapshot('regnum-plaza'"]],
  ['sado', ['app/sado/apartments/sado-catalog-page.tsx', "useLiveCatalogUnits('sado'"]],
  ['soy-boyi', ['app/soy-boyi/apartments/soy-boyi-catalog.tsx', 'useLiveCatalogSnapshot("soy-boyi"']],
  ['sun', ['app/sun/apartments/sun-catalog.tsx', "useLiveCatalogSnapshot('sun'"]],
  ['voha', ['app/voha/apartments/voha-catalog.tsx', "useLiveCatalogSnapshot('voha'"]],
  ['yangibaxt', ['app/yangibaxt/apartments/yangibaxt-catalog.tsx', 'useLiveCatalogSnapshot("yangibaxt"']],
  ['zamon', ['app/zamon/apartments/zamon-catalog.tsx', "useLiveCatalogSnapshot('zamon'"]],
]);

for (const [slug, [relativePath, marker]] of integrations) {
  const page = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  assert.ok(page.includes(marker), `${slug} must use the live catalogue as its primary client source`);
  if (slug !== 'sun') {
    assert.ok(page.includes('catalogLeadIdentity'), `${slug} unit leads must resolve through the canonical source key`);
    assert.doesNotMatch(page, /unitId=\{/, `${slug} must not submit a stale embedded unit id`);
  }
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
    catalogue: 'app/c1/apartments/c1-catalog.tsx',
    landing: 'app/c1/c1-page.tsx',
    dynamicCount: /project\?\.availableUnits\s*\?\?\s*initialAvailableCount/,
  }],
  ['soy-boyi', {
    catalogue: 'app/soy-boyi/apartments/soy-boyi-catalog.tsx',
    landing: 'app/soy-boyi/soy-boyi-page.tsx',
    dynamicCount: /liveCatalog\.project\?\.availableUnits\s*\?\?\s*availableCount/,
  }],
]);

for (const [slug, paths] of newLiveSites) {
  const [catalogue, landing] = await Promise.all([
    readFile(new URL(`../${paths.catalogue}`, import.meta.url), 'utf8'),
    readFile(new URL(`../${paths.landing}`, import.meta.url), 'utf8'),
  ]);
  for (const [surface, page] of [['catalogue', catalogue], ['landing', landing]]) {
    assert.ok(page.includes('catalogLeadIdentity'), `${slug} ${surface} must submit only a canonical live source key`);
    assert.ok(page.includes('rememberLiveCatalogUnit'), `${slug} ${surface} must remember only live catalogue identities`);
    assert.doesNotMatch(page, /unitId=\{/, `${slug} ${surface} must not submit a stale embedded unit id`);
    assert.doesNotMatch(page, /свежем официальном (?:snapshot|снимке)|Снимок получен|Yangi rasmiy snapshotda|Snapshot olingan vaqt|fresh official snapshot|Latest official availability snapshot|Snapshot captured/iu, `${slug} ${surface} must not show snapshot terminology to users`);
  }
  assert.match(landing, paths.dynamicCount, `${slug} landing count must follow the live project payload with an embedded fallback`);
}

const kayan = await readFile(new URL('../app/kayan/project-page.tsx', import.meta.url), 'utf8');
for (const slug of ['meros', 'mirador', 'ofiyat']) {
  const route = await readFile(new URL(`../app/${slug}/apartments/page.tsx`, import.meta.url), 'utf8');
  assert.ok(route.includes(`slug="${slug}"`), `${slug} must route through the live Kayan catalogue`);
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
assert.equal(unmatched.completionDate, '', 'an unmatched live unit must not inherit another unit completion date');
assert.equal(unmatched.plan, '');
assert.equal(unmatched.sourcePlan, '');
assert.equal(unmatched.thumbnail, '');
assert.equal(unmatched.sheetPage1, '');
assert.deepEqual(unmatched.coordinates, { x: 0, y: 0 });
assert.deepEqual(unmatched.provenance, { api: '', sourceSha256: '' });

const reserved4U = { ...live[0], projectSlug: '4u', status: 'reserved' };
assert.equal(mergeLiveCatalogUnits('4u', embedded, [reserved4U]).length, 0, 'available-only UI must not label a reserved unit as available');
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
