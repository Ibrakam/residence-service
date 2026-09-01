import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = await build({
  absWorkingDir: websiteRoot,
  entryPoints: ['scripts/fixtures/ofiyat-catalog-state-fixture.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  tsconfig: resolve(websiteRoot, 'tsconfig.json'),
  write: false,
  logLevel: 'silent',
});

if (result.outputFiles.length !== 1) {
  throw new Error(`Unexpected Ofiyat catalogue state fixture bundle count: ${result.outputFiles.length}`);
}

const fixtureURL = `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`;
try {
  await import(fixtureURL);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
  process.exit();
}

console.log('Ofiyat catalogue state fixtures passed: composite phase/entrance/floor/unit identity, ambiguity rejection, parking levels, available-only and context serialization.');
