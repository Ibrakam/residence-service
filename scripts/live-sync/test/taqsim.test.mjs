import assert from 'node:assert/strict';
import test from 'node:test';
import { collectTaqsim, normalizePages, parsePage, planPath, planSource, PROJECT_UUID, HOUSE_UUID } from '../src/taqsim.mjs';

const project = { uuid: PROJECT_UUID, slug: 'pushkin-klubnyy-dom' };
const row = { uuid: '10a2c39b-b652-49ec-9d6b-3f2889d93257', projectUuid: PROJECT_UUID, houseUuid: HOUSE_UUID,
  number: '25', section: 'А', floor: 4, rooms: 4, areaTotal: 105.04, price: 2002196851.2,
  pricePerM2: 19061280, currency: 'UZS', status: 'available', photo: '/upload/unit-plans/57ad0f4d-e144-4a42-be72-9eab73bd90c6.png',
  monthlyFrom: 17035000, priceFrom: 2202416536, minPrepayFrom: 550604135 };
const page = (units, total = units.length) => ({ project, units, total });
const html = data => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: data } })}</script>`;

test('cash price is never replaced with the monthly payment or financing total', () => {
  const snapshot = normalizePages(page([row]), [page([row])], '2026-11-06T00:00:00Z');
  const unit = snapshot.units[0];
  assert.equal(unit.price, Math.round(row.price)); assert.equal(unit.monthlyFrom, row.monthlyFrom);
  assert.equal(unit.financingPriceFrom, row.priceFrom); assert.notEqual(unit.price, row.priceFrom);
  assert.equal(unit.sourceKey, `taqsim:pushkin:${row.uuid}`);
  assert.equal(snapshot.officialCount, 1); assert.equal(snapshot.complete, true);
});
test('partial and overlapping partitions cannot become a complete snapshot', () => {
  assert.throws(() => normalizePages(page([row], 131), [page([row], 100)]), /totals|Incomplete/);
  assert.throws(() => normalizePages(page([row], 2), [page([row]), page([row])]), /Incomplete/);
  assert.throws(() => normalizePages(page([row]), [page([row], 2)]), /totals|Incomplete/);
});
test('cross-project, reserved, missing-plan and inconsistent-price rows are rejected', () => {
  for (const change of [{ projectUuid: 'wrong' }, { houseUuid: 'wrong' }, { status: 'reserved' }, { photo: '/private/token.png' }, { price: 17035000 }]) {
    const bad = { ...row, ...change }; assert.throws(() => normalizePages(page([bad]), [page([bad])]));
  }
  assert.throws(() => parsePage(html({ ...page([row]), project: { ...project, uuid: 'wrong' } })), /Unexpected/);
});
test('plan sources are fixed-origin PNGs and plan identities are deterministic', () => {
  assert.equal(planSource(row.photo), `https://estate.taqsim.uz${row.photo}`);
  assert.equal(planPath(row.photo), planPath(row.photo));
  assert.match(planPath(row.photo), /^\/pushkin\/plans\/[a-f0-9]{20}\.png$/);
  for (const bad of ['https://evil.invalid/a.png', '//evil.invalid/a.png', '/upload/unit-plans/../auth.png', row.photo + '?token=x']) assert.throws(() => planPath(bad));
});
test('in-work apartments reconcile with source totals but never remain available', () => {
  const working = { ...row, uuid: '20a2c39b-b652-49ec-9d6b-3f2889d93257', status: 'in_work' };
  const snapshot = normalizePages(page([row, working]), [page([row, working])]);
  assert.equal(snapshot.sourceTotal, 2);
  assert.equal(snapshot.officialTotalAtCapture, 1);
  assert.equal(snapshot.availableTotal, 1);
  assert.equal(snapshot.units[0].id, row.uuid);
  assert.deepEqual(snapshot.sourceUnavailable, [{ id: working.uuid, rawStatus: 'in_work' }]);
  assert.equal(snapshot.complete, true);
});
test('collection partitions the public 100-row cap and tolerates a sold-out room category', async t => {
  const original = globalThis.fetch; const urls = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => {
    urls.push(url); const room = new URL(url).searchParams.get('rooms');
    return new Response(html(room ? page(room === '4' ? [row] : []) : page([row])), { status: 200 });
  };
  const result = await collectTaqsim(); assert.equal(result.snapshot.units.length, 1);
  assert.equal(urls.length, 4); assert.ok(urls.every(url => url.startsWith('https://estate.taqsim.uz/complex/pushkin-klubnyy-dom?')));
});
