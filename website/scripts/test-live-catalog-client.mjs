import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { catalogLeadIdentity, mergeLiveCatalogUnits, parseCatalogDate } from '../app/live-catalog.ts';

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

const integrations = new Map([
  ['avalon-residence', ['app/page.tsx', "useLiveCatalogUnits('avalon-residence'"]],
  ['4u', ['app/4u/apartments/four-u-catalog.tsx', "useLiveCatalogSnapshot('4u'"]],
  ['bayterak', ['app/bayterak/apartments/bayterak-catalog.tsx', "useLiveCatalogSnapshot('bayterak'"]],
  ['botanika-saroyi', ['app/botanika-saroyi/apartments/botanika-catalog.tsx', "useLiveCatalogSnapshot('botanika-saroyi'"]],
  ['flagman', ['app/flagman/apartments/flagman-catalog-page.tsx', "useLiveCatalogSnapshot('flagman'"]],
  ['jomiy', ['app/jomiy/apartments/jomiy-catalog.tsx', 'useLiveCatalogSnapshot("jomiy"']],
  ['maftun-makon', ['app/maftun-makon/apartments/maftun-makon-catalog.tsx', "useLiveCatalogSnapshot('maftun-makon'"]],
  ['regnum-plaza', ['app/regnum-plaza/apartments/regnum-catalog.tsx', "useLiveCatalogSnapshot('regnum-plaza'"]],
  ['sado', ['app/sado/apartments/sado-catalog-page.tsx', "useLiveCatalogUnits('sado'"]],
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
  ['flagman', ['app/flagman/flagman-page.tsx', "useLiveCatalogProject('flagman'"]],
  ['jomiy', ['app/jomiy/jomiy-page.tsx', "useLiveCatalogProject('jomiy'"]],
  ['maftun-makon', ['app/maftun-makon/maftun-makon-page.tsx', "useLiveCatalogProject('maftun-makon'"]],
  ['meros', ['app/meros/meros-page.tsx', "useLiveCatalogProject('meros'"]],
  ['regnum-plaza', ['app/regnum-plaza/regnum-page.tsx', "useLiveCatalogUnits('regnum-plaza'"]],
  ['sado', ['app/sado/sado-page.tsx', "useLiveCatalogProject('sado'"]],
  ['sun', ['app/sun/sun-page.tsx', "useLiveCatalogSnapshot('sun'"]],
  ['voha', ['app/voha/voha-page.tsx', "useLiveCatalogProject('voha'"]],
  ['yangibaxt', ['app/yangibaxt/yangibaxt-page.tsx', "useLiveCatalogProject('yangibaxt'"]],
  ['zamon', ['app/zamon/zamon-page.tsx', "useLiveCatalogProject('zamon'"]],
]);

for (const [slug, [relativePath, marker]] of landingIntegrations) {
  const page = await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
  assert.ok(page.includes(marker), `${slug} landing availability must use live catalogue data`);
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
const soldSun = { ...live[0], projectSlug: 'sun', status: 'sold', price: undefined };
assert.equal(mergeLiveCatalogUnits('sun', embedded, [soldSun]).length, 0, 'SUN must not expose sold or reserved rows as available at zero price');
assert.equal(mergeLiveCatalogUnits('safe-project', embedded, live).length, 1, 'status-aware UI keeps non-available units');

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
