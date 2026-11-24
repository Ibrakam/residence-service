import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMbcProjects } from '../src/normalize.mjs';
import { mbcProjects } from '../src/providers.mjs';
import { opaqueMbcSourceKey } from '../src/mbc-identity.mjs';

const project = mbcProjects.find(({ slug }) => slug === 'regnum-plaza');
const capturedAt = '2026-11-24T09:00:00.000Z';
const row = (overrides = {}) => ({
  id: 1001, crm_id: 14653735, number: '12', square: 50, rooms: 2, floor: 2,
  project_slug: project.slug, project_id: project.id, type: 'residential',
  status: 'AVAILABLE', queue: '1', section: '2', is_price: 0,
  // The public API returns an internal amount even when is_price is zero.
  price: 10730652451, end: '2027', ...overrides,
});
const page = (data, extra = {}) => ({ plans: { total: data.length, current_page: 1, last_page: 1, data, ...extra } });
const normalize = (rows, { pages = [page(rows)], templates = {}, websiteOverlay = true } = {}) => normalizeMbcProjects(
  [{ project, residentialPages: pages, commercialPages: [page([])] }],
  capturedAt, templates, [project], { websiteOverlay },
);

test('MBC website artifacts prove a complete published listing without claiming complete inventory', () => {
  const website = normalize([row()]).artifacts[0].artifact;
  assert.equal(website.catalogScope, 'published-offers');
  assert.equal(website.officialCount, 1);
  assert.equal(website.sourceCount, 1);
  assert.equal(website.complete, false);
  assert.equal(website.completeness.complete, true, 'all declared website rows were captured');
  assert.equal(website.completeness.inventoryComplete, false);
  assert.match(website.completeness.missingUnitPolicy, /absent.*not a sale or deletion/);
  assert.equal(website.units[0].status, 'available');
  const legacy = normalize([row()], { websiteOverlay: false }).artifacts[0].artifact;
  assert.equal(legacy.catalogScope, undefined);
  assert.equal(legacy.officialCount, undefined);
  assert.equal(legacy.completeness.complete, true);
  assert.throws(() => normalize([row({ is_price: 1 })], { websiteOverlay: false }), /public-price policy changed/);
});

test('MBC website pricing ignores hidden amounts and stale template prices', () => {
  const templates = { [project.slug]: { units: [{
    id: 'old-public-id', sourceId: '14653735', sourceKey: 'regnum-plaza:retained',
    number: '12', rooms: 2, area: 50, floor: 2, queue: 1, section: 2,
    price: 999999, pricePerM2: 19999, currency: 'USD', publicPrice: true,
    completion: 'stale', planImageUrl: '/regnum-plaza/plans/existing.webp',
  }] } };
  const artifact = normalize([row()], { templates }).artifacts[0].artifact;
  const unit = artifact.units[0];
  assert.equal(unit.id, '14653735');
  assert.equal(unit.sourceId, '14653735');
  assert.equal(unit.publicId, '1001');
  assert.equal(unit.sourceKey, 'regnum-plaza:retained');
  assert.equal(unit.phaseSlug, 'q1-s2');
  assert.equal(unit.queueKey, 'q1');
  assert.equal(unit.planImageUrl, '/regnum-plaza/plans/existing.webp');
  assert.equal(unit.completion, '2027');
  assert.equal(unit.publicPrice, false);
  assert.equal(unit.price, undefined);
  assert.equal(unit.pricePerM2, undefined);
  assert.equal(unit.currency, undefined);
  assert.equal(artifact.publicPrice, false);
});

test('MBC website imports only explicit visible finite positive prices in the source currency', () => {
  for (const [sourcePrice, currencyInput, expectedCurrency] of [
    [1350000000, {}, 'UZS'],
    ['1350000000.50', { currency: 'USD' }, 'USD'],
    [600000, { currency: { ccy: 'EUR' } }, 'EUR'],
  ]) {
    const artifact = normalize([row({ is_price: 1, price: sourcePrice, ...currencyInput })]).artifacts[0].artifact;
    const unit = artifact.units[0];
    assert.equal(unit.price, Number(sourcePrice));
    assert.equal(unit.currency, expectedCurrency);
    assert.equal(unit.pricePerM2, undefined, 'a per-m² amount must not be invented');
    assert.equal(unit.publicPrice, true);
    assert.equal(unit.priceVisibility, 'public');
    assert.equal(unit.displayPriceKey, undefined);
    assert.equal(artifact.publicPrice, true);
  }
  for (const price of [null, undefined, '', ' ', 0, -1, Infinity, NaN, 'not a price', true]) {
    const unit = normalize([row({ is_price: 1, price })]).artifacts[0].artifact.units[0];
    assert.equal(unit.price, undefined, `invalid amount ${String(price)} cannot overwrite the database`);
    assert.equal(unit.currency, undefined);
    assert.equal(unit.publicPrice, false);
  }
  assert.equal(normalize([row({ is_price: 1, currency: { name: 'unknown' } })]).artifacts[0].artifact.units[0].price, undefined);
  assert.throws(() => normalize([row({ is_price: 'unexpected' })]), /is_price is invalid/);
});

test('MBC website accepts an explicit zero-offer listing while preserving queue metadata', () => {
  const artifact = normalize([]).artifacts[0].artifact;
  assert.equal(artifact.catalogScope, 'published-offers');
  assert.equal(artifact.officialCount, 0);
  assert.equal(artifact.complete, false);
  assert.deepEqual(artifact.units, []);
  assert.ok(artifact.queues.length > 0);
  assert.equal(artifact.completeness.complete, true);
  assert.throws(() => normalize([], { websiteOverlay: false }), /total is invalid/);
});

test('MBC website never treats truncated or changed pagination as an empty or complete listing', () => {
  assert.throws(() => normalize([], { pages: [] }), /capture has no pages/);
  assert.throws(() => normalize([], { pages: [page([],{ total: 1 })] }), /captured 0 of 1 rows/);
  assert.throws(() => normalize([row()], { pages: [page([row()], { total: 2, last_page: 2 })] }), /captured 1 of 2 pages/);
  assert.throws(() => normalize([row()], { pages: [page([row()], { total: 2, last_page: 2 }), page([], { current_page: 2, last_page: 2, total: 1 })] }), /total changed/);
  assert.throws(() => normalize([row()], { pages: [page([row()], { total: 2, last_page: 2 }), page([row()], { current_page: 2, last_page: 2, total: 2 })] }), /duplicate id/);
  for (const total of [null, undefined, '', ' ', false]) assert.throws(() => normalize([], { pages: [page([], { total })] }), /total is invalid/, 'only an explicitly declared zero is an empty listing');
});

test('MBC website rejects missing or coerced dimensions while allowing explicitly reported zero floor and rooms', () => {
  for (const field of ['floor', 'rooms', 'square']) {
    for (const value of [null, undefined, '', ' ', false, true]) {
      assert.throws(() => normalize([row({ [field]: value })]), /website dimensions are invalid/);
    }
  }
  const unit = normalize([row({ floor: 0, rooms: '0', square: '50.00' })]).artifacts[0].artifact.units[0];
  assert.equal(unit.floor, 0);
  assert.equal(unit.rooms, 0);
  assert.equal(unit.area, 50);
  assert.throws(() => normalize([row({ crm_id: true })]), /no stable CRM identity/);
});

test('MBC website keeps opaque stable new-unit identities and fails closed on ambiguous provenance', () => {
  const unit = normalize([row()], { templates: { [project.slug]: { units: [] } } }).artifacts[0].artifact.units[0];
  assert.equal(unit.sourceKey, opaqueMbcSourceKey(project.slug, '14653735'));
  assert.throws(() => normalize([row({ crm_id: undefined })]), /no stable CRM identity/);
  assert.throws(() => normalize([row({ project_slug: 'another-project' })]), /unexpected project/);
  assert.throws(() => normalize([row({ project_id: project.id + 1 })]), /unexpected project id/);
  assert.throws(() => normalize([row({ queue: 'unknown' })]), /unknown CRM queue/);
  assert.throws(() => normalize([row({ status: 'SOLD' })]), /is not available/);
});

test('MBC website restores missing physical metadata only from one exact coherent retained CRM identity', () => {
  const retained = {
    sourceId: '14653735', sourceKey: 'regnum-plaza:reviewed', number: '12',
    rooms: 2, floor: 2, area: 50, queueKey: 'q1', section: '2',
  };
  const templates = { [project.slug]: { units: [retained] } };
  const artifact = normalize([row({ queue: null })], { templates }).artifacts[0].artifact;
  assert.equal(artifact.units[0].phaseSlug, 'q1-s2');
  assert.equal(artifact.units[0].sourceKey, retained.sourceKey);
  assert.equal(artifact.completeness.retainedPhaseBindings, 1);
  assert.throws(() => normalize([row({ queue: null })]), /no unique retained CRM identity/);
  assert.throws(() => normalize([row({ queue: null })], { templates: { [project.slug]: { units: [retained, retained] } } }), /no unique retained CRM identity/);
  for (const mismatched of [{ area: 51 }, { number: '13' }, { rooms: 3 }, { floor: 3 }, { section: '3' }]) {
    assert.throws(() => normalize([row({ queue: null })], { templates: { [project.slug]: { units: [{ ...retained, ...mismatched }] } } }), /conflicting dimensions|conflicts with the website/);
  }
});

test('MBC website rejects complete rows that conflict with the retained CRM identity before plan enrichment', () => {
  const retained = {
    sourceId: '14653735', sourceKey: 'regnum-plaza:reviewed', number: '12',
    rooms: 2, floor: 2, area: 50, queue: '1', section: '2',
    planImageUrl: '/regnum-plaza/plans/reviewed.webp',
  };
  const templates = { [project.slug]: { units: [retained] } };
  for (const changed of [{ number: '13' }, { rooms: 3 }, { floor: 3 }, { square: 51 }, { queue: '3' }, { section: '3' }]) {
    assert.throws(() => normalize([row(changed)], { templates }), /conflicting dimensions|conflicts with the website/);
  }
  assert.throws(() => normalize([row()], { templates: { [project.slug]: { units: [retained, retained] } } }), /no unique retained CRM identity/);
  assert.equal(normalize([row()], { templates }).artifacts[0].artifact.units[0].planImageUrl, retained.planImageUrl);
});

test('Saadiyat missing website queue uses the exact reviewed production unit binding', () => {
  const binding = {
    sourceId: '18198166', sourceKey: 'mbc:saadiyat:919f80d22bbf7d1c117becd3',
    number: '1', rooms: 3, area: 84.47, floor: 1, queue: '2', section: 'A6',
    phaseSlug: 'q2-sa6', provenance: 'production DB exact CRM identity verified 2026-11-24',
  };
  const saadiyat = mbcProjects.find(({ slug }) => slug === 'saadiyat');
  const publicRow = row({
    id: 5001, crm_id: 18198166, project_id: saadiyat.id, project_slug: saadiyat.slug,
    number: '1', rooms: 3, square: 84.47, floor: 1, queue: null, section: 'A6',
  });
  const run = (bindings, templateUnits = []) => normalizeMbcProjects(
    [{ project: saadiyat, residentialPages: [page([publicRow])] }], capturedAt,
    { saadiyat: { units: templateUnits } }, [{ ...saadiyat, reviewedWebsiteBindings: bindings }],
    { websiteOverlay: true },
  ).artifacts[0].artifact;
  const artifact = run([binding]);
  assert.equal(artifact.officialCount, 1);
  assert.equal(artifact.completeness.retainedPhaseBindings, 1);
  assert.equal(artifact.units[0].sourceId, binding.sourceId);
  assert.equal(artifact.units[0].sourceKey, binding.sourceKey);
  assert.equal(artifact.units[0].phaseSlug, binding.phaseSlug);
  assert.equal(artifact.units[0].phaseName, 'A6');
  assert.equal(artifact.units[0].queueKey, 'q2');
  assert.throws(() => run([{ ...binding, sourceId: 'another-unit' }]), /no unique retained CRM identity/);
  assert.throws(() => run([binding, binding]), /no unique retained CRM identity/);
  assert.throws(() => run([{ ...binding, area: 85 }]), /conflicting dimensions/);
  assert.throws(() => run([{ ...binding, section: 'A7' }]), /conflicts with the website/);
  assert.throws(() => run([{ ...binding, phaseSlug: 'q1-sa6' }]), /reviewed physical phase conflicts/);
  const stale = run([binding], [{ ...binding, number: 'stale', floor: 99, sourceKey: 'stale-template-key', planImageUrl: '/saadiyat/plans/stale.webp' }]);
  assert.equal(stale.units[0].sourceKey, binding.sourceKey, 'the reviewed current DB identity replaces stale template metadata');
  assert.equal(stale.units[0].number, '1');
  assert.equal(stale.units[0].floor, 1);
  assert.equal(stale.units[0].planImageUrl, undefined, 'a stale template plan is not carried onto the corrected physical unit');
  assert.equal(stale.completeness.reviewedIdentityBindings, 1);
  const refreshedTemplate = run([binding], [{ ...binding, planImageUrl: '/saadiyat/plans/reviewed.webp' }]);
  assert.equal(refreshedTemplate.units[0].planImageUrl, undefined, 'reviewed identity bindings do not implicitly approve template plans');
  const completeRow = { ...publicRow, queue: '2' };
  const complete = normalizeMbcProjects([{ project: saadiyat, residentialPages: [page([completeRow])] }], capturedAt,
    { saadiyat: { units: [{ ...binding, number: 'stale', floor: 99, planImageUrl: '/saadiyat/plans/stale.webp' }] } },
    [{ ...saadiyat, reviewedWebsiteBindings: [binding] }], { websiteOverlay: true }).artifacts[0].artifact;
  assert.equal(complete.units[0].sourceKey, binding.sourceKey);
  assert.equal(complete.units[0].planImageUrl, undefined);
  assert.equal(complete.completeness.retainedPhaseBindings, 0);
});
