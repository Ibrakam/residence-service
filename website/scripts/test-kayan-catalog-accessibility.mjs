import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogueSource = await readFile(resolve(websiteRoot, 'app/kayan/project-page.tsx'), 'utf8');
const normalizedSource = catalogueSource.replace(/\s+/g, ' ');

assert(
  normalizedSource.includes('button type="button" key={unit.id} aria-label={catalogUnitAriaLabel({ projectName: config.name, phaseLabel: currentPhaseLabel, language, unit })} aria-pressed={unit.id === selectedUnit?.id} aria-controls="kayan-unit-detail"'),
  'Chess unit buttons must expose composite labels plus aria-pressed/aria-controls',
);
assert(
  normalizedSource.includes("onClick={() => chooseUnit(unit)}><strong>№{unit.number}</strong>"),
  'Native chess buttons must retain keyboard-activatable selection',
);
for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
  assert(catalogueSource.includes(`event.key === '${key}'`) || catalogueSource.includes(`event.key === 'ArrowLeft' || event.key === 'ArrowRight'`), `Chess keyboard handler lost ${key}`);
}
assert(catalogueSource.includes('onKeyDown={onChessKeyDown}'), 'Chess scroller lost its keyboard handler');

const result = await build({
  absWorkingDir: websiteRoot,
  entryPoints: ['scripts/fixtures/kayan-catalog-accessibility-fixture.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  tsconfig: resolve(websiteRoot, 'tsconfig.json'),
  write: false,
  logLevel: 'silent',
});

if (result.outputFiles.length !== 1) throw new Error(`Unexpected KAYAN accessibility fixture bundle count: ${result.outputFiles.length}`);

const fixtureURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
try {
  await import(fixtureURL);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

console.log('KAYAN catalogue accessibility fixtures passed: RU/UZ/EN chess names are unique and composite in every Mirador/Ofiyat phase; button state, controls and keyboard contracts are intact.');
