import assert from 'node:assert/strict';
import { catalogGeneratedAt, getCatalogBundle, getCatalogBundleTimestamp } from '../../app/kayan/catalog-snapshot';
import { selectCatalogTimestamp } from '../../app/kayan/catalog-timestamp';

const EXPECTED_OFIYAT_TIMESTAMP = '2026-08-31T19:26:42.293Z';
const EXPECTED_MIRADOR_TIMESTAMP = '2026-08-29T08:46:56.739Z';

const ofiyat = getCatalogBundle('ofiyat');
const mirador = getCatalogBundle('mirador');

assert.equal(catalogGeneratedAt, EXPECTED_OFIYAT_TIMESTAMP, 'The aggregate snapshot timestamp must match the fresh Ofiyat capture');
assert.equal(ofiyat.project.updatedAt, EXPECTED_OFIYAT_TIMESTAMP, 'Ofiyat project.updatedAt changed unexpectedly');
assert.equal(mirador.project.updatedAt, EXPECTED_MIRADOR_TIMESTAMP, 'Mirador project.updatedAt changed unexpectedly');
assert.equal(getCatalogBundleTimestamp(ofiyat), EXPECTED_OFIYAT_TIMESTAMP, 'Ofiyat projection must use its own project timestamp');
assert.equal(getCatalogBundleTimestamp(mirador), EXPECTED_MIRADOR_TIMESTAMP, 'Mirador projection must use its own project timestamp');
assert.notEqual(getCatalogBundleTimestamp(mirador), catalogGeneratedAt, 'Aggregate generatedAt must not bleed into Mirador');

assert.equal(
  selectCatalogTimestamp('not-a-date', EXPECTED_MIRADOR_TIMESTAMP),
  EXPECTED_MIRADOR_TIMESTAMP,
  'An invalid project timestamp must use a valid aggregate fallback',
);
assert.equal(selectCatalogTimestamp('', 'also-invalid'), undefined, 'Invalid project and fallback timestamps must be rejected');
