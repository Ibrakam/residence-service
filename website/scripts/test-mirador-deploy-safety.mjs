import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = resolve(websiteRoot, 'scripts/build-mirador-plans.mjs');
const missingPlanMapping = resolve(websiteRoot, '.deploy-safe-fixture/mirador-plans-is-physically-absent.json');
const missingFloorMapping = resolve(websiteRoot, '.deploy-safe-fixture/mirador-floor-is-physically-absent.json');
for (const path of [missingPlanMapping, missingFloorMapping]) await assert.rejects(readFile(path), (error) => error?.code === 'ENOENT');

const environment = {
  ...process.env,
  MIRADOR_PLAN_MAPPING_PATH: missingPlanMapping,
  MIRADOR_FLOOR_MAPPING_PATH: missingFloorMapping,
};
const checked = await execFileAsync(process.execPath, [scriptPath, '--check'], {
  cwd: websiteRoot,
  env: environment,
  timeout: 30_000,
  maxBuffer: 2 << 20,
});
assert.ok(checked.stdout.includes('"rawCaptureRead": false'), 'Mirador production check must pass without raw mappings');

await assert.rejects(
  execFileAsync(process.execPath, [scriptPath, '--audit-capture'], {
    cwd: websiteRoot,
    env: environment,
    timeout: 30_000,
    maxBuffer: 2 << 20,
  }),
  (error) => error?.code !== 0 && /ENOENT|no such file/i.test(`${error.stderr ?? ''}${error.message ?? ''}`),
  'Explicit Mirador capture audit must fail closed when raw mappings are absent',
);

console.log('Mirador deploy-safety fixture passed: production check ignores absent raw mappings; explicit capture audit requires them.');
