import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasMiradorCatalogIntent, MIRADOR_VISUAL_FLOW_MEDIA } from '../app/kayan/mirador-flow-policy.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routes = [
  '4u', 'bayterak', 'botanika-saroyi', 'c1', 'flagman', 'jomiy',
  'maftun-makon', 'meros', 'mirador', 'ofiyat', 'regnum-plaza',
  'saadiyat', 'sado', 'sarbon', 'soy-boyi', 'sun', 'voha',
  'yangibaxt', 'zamon',
];
const [catalogue, styles, mirador, miradorExplorer] = await Promise.all([
  readFile(resolve(root, 'app/catalog/apartment-catalog.tsx'), 'utf8'),
  readFile(resolve(root, 'app/catalog/apartment-catalog.css'), 'utf8'),
  readFile(resolve(root, 'app/mirador/apartments/mirador-unified-catalog.tsx'), 'utf8'),
  readFile(resolve(root, 'app/kayan/mirador-block-explorer.tsx'), 'utf8'),
]);

assert.equal(MIRADOR_VISUAL_FLOW_MEDIA, '(min-width: 768px) and (min-height: 600px)');
assert.equal(hasMiradorCatalogIntent('?lang=ru'), false);
for (const key of ['mode', 'queue', 'building', 'phase', 'entrance', 'floor', 'rooms', 'areaFrom', 'areaTo', 'sort', 'unitKey', 'unit']) {
  assert.equal(hasMiradorCatalogIntent(`?lang=ru&${key}=1`), true, `${key} must bypass visual flow`);
}
assert.equal(hasMiradorCatalogIntent('?lang=ru&status=sold'), false, 'legacy status must not suppress the available-only visual flow');

assert.match(styles, /@media \(max-width:767px\)[\s\S]*?\.apartment-catalog__visual \{ display:none!important; \}/);
assert.match(styles, /\.apartment-catalog-layout__detail \{ order:2; \}/);
assert.match(catalogue, /type CatalogMode = 'cards' \| 'chess';/);
assert.doesNotMatch(catalogue, /Шахматка\+|Chess\+/);
assert.match(catalogue, /visualFlowAvailable = false/);
assert.match(catalogue, /capabilities\.visualFlow && visualFlowAvailable/);
assert.match(catalogue, /\.filter\(\(unit\) => unit\.status === 'available'\)/);
assert.doesNotMatch(catalogue, /setStatus|statusOptions|setFilter\('status'/);
assert.doesNotMatch(catalogue, />\{t\.allStatuses\}</);
assert.match(catalogue, /url\.searchParams\.delete\('status'\)/);
assert.match(catalogue, /const activeLightbox = lightbox[\s\S]*?units\.find\(\(candidate\) => candidate\.id === lightbox\.unit\.id\)/);
assert.match(catalogue, /const activeLeadUnit = leadUnit === null[\s\S]*?units\.find\(\(unit\) => unit\.id === leadUnit\.id\)/);
assert.match(catalogue, /const availability = String\(project\.availableCount\)/);
assert.match(catalogue, /const \[selectedId, setSelectedId\] = useState<string>\(\)/);
assert.match(catalogue, /matchMedia\('\(max-width: 1100px\)'\)/);
assert.match(catalogue, /className="apartment-catalog-card__select"[\s\S]*?chooseUnit\(unit, true\)/);
assert.match(catalogue, /capabilities\.pricesVisible[\s\S]*?price: undefined, regularPrice: undefined, pricePerM2: undefined/);
assert.match(catalogue, /params\.get\('queue'\)/);
assert.match(catalogue, /params\.get\('unitKey'\)/);
assert.match(catalogue, /unit\.unitKey === stableKey \|\| unit\.id === stableKey/);
assert.match(catalogue, /unitKey: unit\.unitKey \?\? unit\.id/);
assert.match(catalogue, /selectedCta: 'Уточнить условия по этой квартире'/);
assert.match(styles, /\.apartment-catalog \.apartment-catalog__primary[\s\S]*?color:white/);
assert.match(styles, /\.apartment-catalog-detail \{[\s\S]*?border:2px solid/);
assert.match(catalogue, /unit\.queueKey === queue/);
assert.match(catalogue, /disabled=\{item\.availableCount === 0\}/);
assert.match(catalogue, /activeLeadUnit\?\.queueKey/);
assert.match(catalogue, /aria-controls=\{detailId\}/);
assert.match(catalogue, /apartment-catalog__sr-only/);
assert.match(catalogue, /event\.key === 'ArrowLeft'/);
assert.match(catalogue, /event\.key === 'ArrowRight'/);
assert.match(catalogue, /event\.key === 'Home'/);
assert.match(catalogue, /event\.key === 'End'/);
assert.match(mirador, /void import\('@\/app\/kayan\/mirador-block-explorer'\)/);
assert.doesNotMatch(mirador, /import \{ MiradorBlockExplorer/);
assert.match(mirador, /unit\.status === 'available' && unit\.unitKey/);
assert.match(mirador, /availableUnitKeys=\{availableUnitKeys\}/);
assert.match(mirador, /visualFlowAvailable=\{visualAvailable && availableUnitKeys\.length > 0\}/);
assert.match(miradorExplorer, /availableUnitKeys\?: readonly string\[\]/);
assert.match(miradorExplorer, /zone\.unitKey !== null && availableUnitKeySet\.has\(zone\.unitKey\)/);
assert.match(miradorExplorer, /return zones\.length \? \[\{ \.\.\.scheme, zones \}\] : \[\]/);

for (const route of routes) {
  const directory = resolve(root, 'app', route, 'apartments');
  const files = await readdir(directory);
  const adapters = files.filter((file) => file.endsWith('-unified-catalog.tsx'));
  assert.equal(adapters.length, 1, `${route} must have exactly one active unified catalogue adapter`);
  const [page, adapter] = await Promise.all([
    readFile(resolve(directory, 'page.tsx'), 'utf8'),
    readFile(resolve(directory, adapters[0]), 'utf8'),
  ]);
  assert.match(page, /UnifiedCatalog/, `${route} page must render its unified adapter`);
  assert.match(page, new RegExp(adapters[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.tsx$/, '')), `${route} page must import its unified adapter`);
  assert.match(adapter, /from ['"]@\/app\/catalog\/apartment-catalog['"]/, `${route} must use the shared engine`);
  assert.match(adapter, /<ApartmentCatalog\b/, `${route} must render the shared engine`);
  assert.doesNotMatch(adapter, /Шахматка\+|Chess\+|Shaxmatka\+/, `${route} must not reintroduce a duplicate chess mode`);
  if (route !== 'mirador') {
    assert.doesNotMatch(adapter, /visualFlow:\s*true/, `${route} must not claim an unverified rich visual flow`);
    assert.doesNotMatch(adapter, /visualFlowAvailable=/, `${route} must not mount a desktop flow`);
  }
}

for (const route of ['c1', 'saadiyat']) {
  const directory = resolve(root, 'app', route, 'apartments');
  const files = await readdir(directory);
  const adapter = files.find((file) => file.endsWith('-unified-catalog.tsx'));
  const activeSource = `${await readFile(resolve(directory, 'page.tsx'), 'utf8')}\n${await readFile(resolve(directory, adapter), 'utf8')}`;
  assert.doesNotMatch(activeSource, /crmId|sourceCreatedAt|sourceUpdatedAt|sourcePlanSha256|localPlanSha256/, `${route} active catalogue must not serialize private provenance`);
}

for (const route of ['saadiyat', 'sarbon', 'soy-boyi']) {
  const directory = resolve(root, 'app', route, 'apartments');
  const files = await readdir(directory);
  const adapter = files.find((file) => file.endsWith('-unified-catalog.tsx'));
  const source = await readFile(resolve(directory, adapter), 'utf8');
  assert.match(source, /useLiveCatalogSnapshot\(/, `${route} must retain its live CRM integration`);
}

for (const route of routes) {
  const directory = resolve(root, 'app', route, 'apartments');
  const files = await readdir(directory);
  const adapter = files.find((file) => file.endsWith('-unified-catalog.tsx'));
  const activeSource = `${await readFile(resolve(directory, 'page.tsx'), 'utf8')}\n${await readFile(resolve(directory, adapter), 'utf8')}`;
  assert.doesNotMatch(activeSource, /свежем официальном (?:snapshot|снимке)|Снимок получен|Yangi rasmiy snapshotda|Snapshot olingan vaqt|fresh official snapshot|Latest official availability snapshot|Snapshot captured/iu, `${route} must not expose snapshot terminology`);
}

console.log(`Unified apartment catalogue contract passed for ${routes.length} routes: cards + one chess view, keyboard/touch navigation, mobile detail below content, and no rich visual-flow download on phones.`);
