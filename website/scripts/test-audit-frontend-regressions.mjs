import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catalogFreshness } from '../app/live-catalog.ts';
import { avalonFloorSlots, verifiedAvalonPlan } from '../app/avalon-catalog.ts';

const now = Date.parse('2026-10-22T12:00:00Z');
const capture = '2026-10-22T11:50:00Z';
const healthy = { projectSlug: 'mirador', status: 'succeeded', freshness: 'fresh', lastCapturedAt: capture, freshUntil: '2026-10-22T12:20:00Z' };
assert.equal(catalogFreshness(capture, healthy, now), 'live');
assert.equal(catalogFreshness('2026-09-19T06:54:00Z', healthy, now), 'stale', 'HTTP success must not turn a month-old capture into live data');
assert.equal(catalogFreshness(capture, { ...healthy, status: 'failed', freshness: 'stale' }, now), 'stale');
assert.equal(catalogFreshness(capture, { ...healthy, freshUntil: '2026-10-22T11:59:59Z' }, now), 'stale', 'provider freshness deadline is authoritative');
assert.equal(catalogFreshness('2026-10-22T11:40:00Z', healthy, now), 'stale', 'a loaded older generation must not borrow the freshness of a newer import');
assert.equal(catalogFreshness(capture, undefined, now), 'unverified', 'health endpoint failure must not claim fresh data');
assert.equal(catalogFreshness(undefined, healthy, now), 'unverified');
assert.equal(catalogFreshness('not a date', healthy, now), 'unverified');
assert.equal(catalogFreshness('2026-10-22T13:00:00Z', healthy, now), 'unverified');
assert.equal(catalogFreshness(capture, { ...healthy, status: 'running' }, now), 'live', 'a running next capture does not invalidate the still-fresh confirmed generation');
assert.equal(catalogFreshness(capture, { ...healthy, status: 'running', lastCapturedAt: undefined }, now), 'unverified');

const known = [
  { building: 'A', floor: 9, number: 101, area: 55.3, rooms: 2, status: 'sold' },
  { building: 'A', floor: 9, number: 102, area: 50.4, rooms: 2, status: 'free' },
  { building: 'A', floor: 9, number: 103, area: 77.7, rooms: 3, status: 'reserved' },
];
const available = [{ ...known[1], id: 'live-102' }];
assert.deepEqual(avalonFloorSlots(known, available, 'A', 9, [0, 1, 2]), [undefined, available[0], undefined], 'removing occupied apartments must never shift available apartment geometry');
assert.deepEqual(avalonFloorSlots(known, available, 'A', 9, [2, 1, 0]), [undefined, available[0], undefined]);
assert.deepEqual(avalonFloorSlots(known, [{ ...available[0], area: 55.3 }], 'A', 9, [0, 1, 2]), [undefined, undefined, undefined], 'changed geometry is not verified');
assert.deepEqual(avalonFloorSlots(known, [...available, ...available], 'A', 9, [0, 1, 2]), [undefined, undefined, undefined], 'ambiguous identities must not receive a polygon');
assert.deepEqual(avalonFloorSlots(known, [{ ...available[0], floor: 10 }], 'A', 9, [1]), [undefined]);
assert.equal(verifiedAvalonPlan('/avalon-apartment-plan.png'), null, 'generic 55.3m² plan is never an exact unit plan');
assert.equal(verifiedAvalonPlan('/avalon/plans/unit-102.png'), '/avalon/plans/unit-102.png');
for (const path of ['https://unverified.invalid/plan.png', '//unverified.invalid/plan.png', '/avalon/plans/../generic.png', '/avalon/plans/unit.png?url=other', '', undefined]) assert.equal(verifiedAvalonPlan(path), null);

const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(page, /avalon-apartment-plan\.png/, 'the fabricated exact plan must not remain in cards, modals or print');
assert.match(page, /floorSlots\[zoneIndex\]/);
assert.match(page, /\/avalon-assets/);
assert.match(await readFile(new URL('../app/avalon/page.tsx', import.meta.url), 'utf8'), /from '\.\.\/page'/);
const status = await readFile(new URL('../app/catalog-source-status.tsx', import.meta.url), 'utf8');
assert.match(status, /timeZone: 'Asia\/Tashkent'/);
assert.match(status, /!hasData && isLoading/);
assert.match(status, /!hasData && loadError/);
assert.match(status, /onClick=\{onRetry\}/);
const client = await readFile(new URL('../app/live-catalog.ts', import.meta.url), 'utf8');
assert.match(client, /\/v1\/sync\/catalog-status/);
assert.match(client, /syncHealthRequest/);
assert.doesNotMatch(client, /setDataSource\('live'\)/, 'all primary hooks must validate source freshness before showing live');
assert.match(client, /setLoadError\(true\)/);
const engine = await readFile(new URL('../app/catalog/apartment-catalog.tsx', import.meta.url), 'utf8');
assert.match(engine, /<CatalogSourceStatus/);
assert.match(engine, /dataSource === 'embedded' && \(isLoading \|\| loadError\)/, 'loading failure is not an empty-stock result');
const css = await readFile(new URL('../app/responsive-typography.css', import.meta.url), 'utf8');
for (const selector of ['.flagman-catalog-callout', '.botanika-location', '.maftun-hero', '.meros-contact', '.sa-copy', '.apartment-catalog-hero']) assert.ok(css.includes(selector));
assert.match(css, /overflow-wrap: anywhere/);
assert.match(css, /min-inline-size: 0/);
assert.match(css, /grid-template-columns:minmax\(0,1fr\)/);
console.log('Frontend audit regressions passed: CRM freshness, load errors, stable Avalon identity, exact-plan safety, mobile typography.');
