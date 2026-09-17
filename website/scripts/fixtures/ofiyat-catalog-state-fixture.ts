import assert from 'node:assert/strict';
import { catalogUnitQuery, resolveCompositeCatalogUnit, type CatalogUnitIdentity } from '../../app/kayan/catalog-url-state';
import {
  OFIYAT_APARTMENT_ENTRANCES,
  canonicalOfiyatEntrance,
  ofiyatPublicBundle,
  selectOfiyatPublicApartments,
} from '../../app/ofiyat/apartments/ofiyat-public-bundle';

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

const ofiyatBundle = ofiyatPublicBundle({
  project: {
    id: 1,
    developerSlug: 'kayan',
    slug: 'ofiyat',
    name: 'Ofiyat',
    totalUnits: 3,
    availableUnits: 2,
    phases: [
      { id: 1, sourceId: '153505', slug: 'phase-1', name: 'I', propertyType: 'apartment', sortOrder: 1, floorsTotal: 15, totalUnits: 2, availableUnits: 1 },
      { id: 2, sourceId: '154273', slug: 'parking', name: 'Parking', propertyType: 'parking', sortOrder: 2, floorsTotal: 2, totalUnits: 1, availableUnits: 1 },
    ],
  },
  units: [
    { id: 73, sourceKey: '153505:apartment:а:15:73', projectSlug: 'ofiyat', phaseSlug: 'phase-1', phaseName: 'I', propertyType: 'apartment', rawPropertyType: 'Квартира', status: 'reserved', rawStatus: 'BOOKED', number: '73', entrance: 'А', floor: 15, area: 62.29, rooms: 2, currency: 'UZS', isActive: true, sourceUpdatedAt: '', updatedAt: '' },
    { id: 76, sourceKey: '153505:apartment:а:15:76', projectSlug: 'ofiyat', phaseSlug: 'phase-1', phaseName: 'I', propertyType: 'apartment', rawPropertyType: 'Квартира', status: 'available', rawStatus: 'AVAILABLE', number: '76', entrance: 'A', floor: 15, area: 65.32, rooms: 3, price: 1_493_295_504, pricePerM2: 22_860_000, currency: 'UZS', isActive: true, sourceUpdatedAt: '', updatedAt: '' },
    { id: 301, sourceKey: '154273:parking:1:-1:1', projectSlug: 'ofiyat', phaseSlug: 'parking', phaseName: 'Parking', propertyType: 'parking', rawPropertyType: 'Машиноместо', status: 'available', rawStatus: 'AVAILABLE', number: '1', entrance: '1', floor: -1, area: 13, price: 1, pricePerM2: 1, currency: 'UZS', isActive: true, sourceUpdatedAt: '', updatedAt: '' },
  ],
  layouts: [
    { id: 1, sourceId: 'official-3-room', projectSlug: 'ofiyat', phaseSlug: 'phase-1', rooms: 3, availableCount: 1, title: '3 rooms', imageUrl: '/kayan/ofiyat/plans/representative/phase-1/3.webp' },
    { id: 2, sourceId: 'remote', projectSlug: 'ofiyat', phaseSlug: 'phase-1', rooms: 2, availableCount: 1, title: 'remote', imageUrl: 'https://example.invalid/plan.webp' },
    { id: 3, sourceId: 'parking-plan', projectSlug: 'ofiyat', phaseSlug: 'parking', rooms: 3, availableCount: 1, title: 'parking', imageUrl: '/kayan/ofiyat/plans/representative/parking/3.webp' },
  ],
});

assert.deepEqual(OFIYAT_APARTMENT_ENTRANCES, ['А', 'Б1', 'Б2', 'В1', 'В2', 'Г1', 'Г2']);
assert.equal(canonicalOfiyatEntrance('A'), 'А', 'The ASCII spelling of entrance А must resolve to the canonical CRM entrance');
assert.equal(canonicalOfiyatEntrance('1'), '', 'Numeric parking sections must not become apartment entrances');
assert.deepEqual(ofiyatBundle.project.phases.map((phase) => phase.slug), ['phase-1'], 'Parking must not become a public apartment phase');
assert.equal(ofiyatBundle.project.totalUnits, 2, 'Apartment totals must exclude parking inventory');
assert.equal(ofiyatBundle.project.availableUnits, 1, 'Apartment availability must exclude booked and parking inventory');
assert.deepEqual(ofiyatBundle.units.map((unit) => unit.sourceKey), ['153505:apartment:а:15:76'], 'Only the AVAILABLE apartment with its stable CRM identity may be public');
assert.equal(ofiyatBundle.units[0].entrance, 'А');
assert.deepEqual(ofiyatBundle.representativePlans, [{ phaseSlug: 'phase-1', rooms: 3, imageUrl: '/kayan/ofiyat/plans/representative/phase-1/3.webp' }], 'Only local official apartment representative plans may be published');
assert.deepEqual(selectOfiyatPublicApartments(ofiyatBundle.units).map((unit) => unit.number), ['76']);
