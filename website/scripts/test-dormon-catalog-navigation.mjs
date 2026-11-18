import assert from 'node:assert/strict';
import snapshot from '../data/dormon-hills-plans.json' with { type: 'json' };
import { attributionQuery, catalogHref, catalogLanguage, catalogPath, initialPlanFilters, isLegacyPlanPreviewQuery } from '../app/dormon-hills/apartments/plan-catalog-data.ts';

// Old homepage previews should no longer leave users in a one-layout catalogue.
for (const plan of snapshot.plans) {
  const query = { block: plan.block, rooms: String(plan.rooms), minArea: String(plan.area), maxArea: String(plan.area), lang: 'uz', utm_source: 'preview' };
  assert.equal(isLegacyPlanPreviewQuery(query, snapshot.plans), true);
  assert.equal(catalogHref(catalogPath, catalogLanguage(query), attributionQuery(query)), '/dormon-hills/apartments?utm_source=preview&lang=uz');
}
assert.equal(isLegacyPlanPreviewQuery({}, snapshot.plans), false);
assert.equal(isLegacyPlanPreviewQuery({ block: 'А', rooms: '2', minArea: '60', maxArea: '70' }, snapshot.plans), false);
assert.equal(isLegacyPlanPreviewQuery({ block: 'А', rooms: '2', minArea: '999', maxArea: '999' }, snapshot.plans), false);
assert.deepEqual(initialPlanFilters({ block: 'А', rooms: '2', minArea: '60', maxArea: '70' }, snapshot.plans), { block: 'А', rooms: '2', minArea: '60', maxArea: '70' });
console.log('Do‘rmon navigation: old exact-layout links normalize to the full catalogue; language, attribution and ordinary range filters are preserved.');
