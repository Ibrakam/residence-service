import assert from 'node:assert/strict';
import { catalogUnitQuery, resolveCompositeCatalogUnit, type CatalogUnitIdentity } from '../../app/kayan/catalog-url-state';

type FixtureUnit = Omit<CatalogUnitIdentity, 'entrance'> & { entrance: string; id: number };

const units: FixtureUnit[] = [
  { id: 1, phaseSlug: 'phase-1', entrance: 'A', floor: 3, number: '1', status: 'available' },
  { id: 2, phaseSlug: 'phase-2', entrance: 'V1', floor: 3, number: '1', status: 'reserved' },
  { id: 3, phaseSlug: 'parking', entrance: '1', floor: -1, number: '1', status: 'available' },
  { id: 4, phaseSlug: 'parking', entrance: '1', floor: -2, number: '1', status: 'sold' },
];

assert.equal(resolveCompositeCatalogUnit(units, {
  phase: 'phase-2', entrance: 'V1', floor: '3', unit: '1',
})?.id, 2, 'The exact phase-2 apartment identity must win over duplicate display numbers');

assert.equal(resolveCompositeCatalogUnit(units, {
  phase: 'parking', entrance: '1', floor: '-2', unit: '1',
})?.id, 4, 'Negative parking levels must participate in identity');

assert.equal(resolveCompositeCatalogUnit(units, {
  phase: 'phase-2', floor: '3', unit: '1',
}), undefined, 'A deep-link without entrance must not fall back to a global unit number');

assert.equal(resolveCompositeCatalogUnit(units, {
  phase: 'phase-2', entrance: 'V1', floor: '', unit: '1',
}), undefined, 'A blank floor must not be interpreted as floor 0');

assert.equal(resolveCompositeCatalogUnit(units, {
  phase: 'phase-2', entrance: 'V1', floor: '3', unit: '1', availableOnly: true,
}), undefined, 'Available-only links must not select a reserved unit');

assert.equal(resolveCompositeCatalogUnit([...units, { ...units[1], id: 5 }], {
  phase: 'phase-2', entrance: 'V1', floor: 3, unit: '1',
}), undefined, 'Duplicate composite identities must be rejected');

assert.deepEqual(catalogUnitQuery(units[1], 'uz', '7'), {
  lang: 'uz', phase: 'phase-2', entrance: 'V1', floor: '3', unit: '1', block: '7',
}, 'Serialized selection must preserve language, complete unit identity and visual block context');
