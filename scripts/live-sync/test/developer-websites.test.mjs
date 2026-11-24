import test from 'node:test';
import assert from 'node:assert/strict';
import { kayanWebsiteInput, normalizeKayanWebsite, normalizeAvalonWebsite, captureKayanWebsite } from '../src/developer-websites.mjs';

const at = '2026-11-24T09:00:00Z';
const unit = { id: 17217979, number: '1', rooms_amount: 4, floor: 2, area: { area_total: 92.5 },
  projectId: 56301, projectName: 'Mirador', houseName: 'Mirador I', sectionName: '1', propertyType: 'property', typePurpose: 'residential' };
const capture = () => ({ records: ['mirador', 'ofiyat'].flatMap(slug => ['residential', 'parking', 'commerce', 'office'].map(type => ({
  method: 'DERIVED', url: { origin: 'https://kayan.uz', path: '/api/filter' },
  scope: { endpoint: 'websitePlans', projectSlug: slug, projectId: slug === 'mirador' ? 56301 : 56018, propertyType: type, page: 1 },
  value: { rows: slug === 'mirador' && type === 'residential' ? [{ ...unit }] : [], terminal: true },
}))) });
const template = { projects: ['mirador', 'ofiyat'].map(slug => ({ project: { slug, phases: [{ slug: 'main', sourceId: '154813' }] },
  units: slug === 'mirador' ? [{ sourceKey: '154813:apartment:1:2:1', area: 92.5, floor: 2, price: 123, currency: 'USD', planImageUrl: '/kayan/mirador/plans/local.webp' }] : [] })) };

test('KAYAN public subset uses stable CRM + physical keys and never copies cached prices', () => {
  const result = normalizeKayanWebsite(kayanWebsiteInput(capture()), at, template);
  const project = result.artifact.projects[0]; const row = project.units[0];
  assert.equal(result.artifact.catalogScope, 'published-offers'); assert.equal(project.sourceCount, 1);
  assert.equal(project.complete, false); assert.equal(project.completeness.inventoryComplete, false);
  assert.equal(row.sourceId, '17217979'); assert.equal(row.sourceKey, '154813:apartment:1:2:1');
  assert.equal(row.price, null); assert.equal(row.pricePerM2, null); assert.equal(row.currency, undefined);
  assert.equal(row.planImageUrl, '/kayan/mirador/plans/local.webp');
  assert.equal(result.artifact.projects[1].sourceCount, 0);
});
test('KAYAN rejects truncation, cross-project rows, duplicate pages and changed physical dimensions', () => {
  const incomplete = capture(); incomplete.records[0].value.terminal = false;
  assert.throws(() => kayanWebsiteInput(incomplete), /incomplete/);
  const cross = capture(); cross.records[0].value.rows[0].projectId = 56018;
  assert.throws(() => kayanWebsiteInput(cross), /another project/);
  const duplicate = capture(); duplicate.records.push(duplicate.records[0]);
  assert.throws(() => kayanWebsiteInput(duplicate), /contiguous|incomplete/);
  for (const value of [null, '', false, [], {}, undefined]) {
    const missingFloor = capture(); missingFloor.records[0].value.rows[0].floor = value;
    assert.throws(() => normalizeKayanWebsite(kayanWebsiteInput(missingFloor), at, template), /floor is missing/);
  }
  const moved = capture(); moved.records[0].value.rows[0].area = { area_total: 100 };
  assert.throws(() => normalizeKayanWebsite(kayanWebsiteInput(moved), at, template), /contradicts/);
});
test('Avalon marketing website cannot replace unit inventory or make stale prices fresh', () => {
  const evidence = { records: [{ method: 'DERIVED', url: { origin: 'https://avalonresidence.uz', path: '/' },
    scope: { endpoint: 'marketingProject' }, value: { projectSlug: 'avalon-residence', marketingTotal: 268, unitListingAvailable: false } }] };
  const result = normalizeAvalonWebsite(evidence, at);
  assert.deepEqual(result.artifact.units, []); assert.equal(result.artifact.sourceCount, 0);
  assert.equal(result.artifact.catalogScope, 'published-offers'); assert.equal(result.audit.sourceCoverage, 'marketing-only');
  evidence.records[0].value.unitListingAvailable = true;
  assert.throws(() => normalizeAvalonWebsite(evidence, at), /invalid/);
});
test('KAYAN collection keeps anonymous tokens and cookies out of captured evidence', async () => {
  const original = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    if (url.includes('/ru/project/')) {
      const mirador = url.endsWith('mirador');
      return new Response(`<body data-project="${mirador ? 'Mirador' : 'Ofiyat'}"><meta name="csrf-token" content="ephemeral-only"><div class="filter-select-projects"><select><option value="${mirador ? 56301 : 56018}"></option></select>`, { headers: { 'set-cookie': 'anonymous-session=in-memory-only; Path=/; HttpOnly' } });
    }
    assert.equal(url, 'https://kayan.uz/api/filter'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers['x-csrf-token'], 'ephemeral-only');
    return Response.json({ data: { success: true, plans: { data: [] } } });
  };
  try {
    const records = []; await captureKayanWebsite(records);
    assert.equal(records.length, 8); assert.equal(calls.filter(([url]) => url.endsWith('/api/filter')).length, 16);
    assert.doesNotMatch(JSON.stringify(records), /ephemeral-only|in-memory-only|anonymous-session|csrf-token/);
    assert.equal(kayanWebsiteInput({ records }).length, 2);
  } finally { globalThis.fetch = original; }
});
