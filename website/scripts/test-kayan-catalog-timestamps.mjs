import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [miradorPage, ofiyatPage, catalogUI, ofiyatExplorerRoute, catalogData] = await Promise.all([
  readFile(resolve(websiteRoot, 'app/mirador/apartments/page.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/ofiyat/apartments/page.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/kayan/project-page.tsx'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/api/kayan/ofiyat-explorer/route.ts'), 'utf8'),
  readFile(resolve(websiteRoot, 'data/kayan-catalog.json'), 'utf8').then(JSON.parse),
]);

for (const [slug, source] of [['mirador', miradorPage], ['ofiyat', ofiyatPage]]) {
  assert(source.includes('getCatalogBundleTimestamp(bundle)'), `${slug} apartments page must pass its project-scoped timestamp`);
  assert(!source.includes('snapshotGeneratedAt={catalogGeneratedAt}'), `${slug} apartments page leaks the aggregate timestamp`);
}
assert(catalogUI.includes('selectCatalogTimestamp(bundle.project.updatedAt, snapshotGeneratedAt)'), 'Catalogue UI must prefer project.updatedAt and keep only a validated fallback');
assert(
  ofiyatExplorerRoute.includes('selectCatalogTimestamp(ofiyat.project.updatedAt, catalogSnapshot.generatedAt)'),
  'Ofiyat explorer API must prefer Ofiyat project.updatedAt and use the aggregate timestamp only as a validated fallback',
);
assert(
  !ofiyatExplorerRoute.includes('{ generatedAt: catalogSnapshot.generatedAt'),
  'Ofiyat explorer API response must not expose the aggregate timestamp directly',
);

const projectTimestamp = (slug) => catalogData.projects.find((entry) => entry.project.slug === slug)?.project.updatedAt;
const timestamps = { mirador: projectTimestamp('mirador'), ofiyat: projectTimestamp('ofiyat') };
assert.deepEqual(timestamps, {
  mirador: '2026-08-29T08:46:56.739Z',
  ofiyat: '2026-08-31T19:26:42.293Z',
}, 'Checked-in project timestamps changed or a project lost its own capture time');

const result = await build({
  absWorkingDir: websiteRoot,
  entryPoints: ['scripts/fixtures/kayan-catalog-timestamp-fixture.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  tsconfig: resolve(websiteRoot, 'tsconfig.json'),
  write: false,
  logLevel: 'silent',
});

if (result.outputFiles.length !== 1) throw new Error(`Unexpected KAYAN timestamp fixture bundle count: ${result.outputFiles.length}`);

const fixtureURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
try {
  await import(fixtureURL);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

console.log('KAYAN catalogue timestamp fixtures passed: Ofiyat and Mirador project times are isolated; invalid project timestamps use only a valid aggregate fallback.');
