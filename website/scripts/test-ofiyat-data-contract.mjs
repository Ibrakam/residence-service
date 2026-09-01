import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  assertPublicProvenancePrivacy,
  scanPublishedProvenancePrivacy,
  validatePublishedAssetBytes,
  validatePublishedOfiyatCatalog,
} from './build-ofiyat-assets.mjs';
import {
  OFIYAT_BLOCK_PATH_MAP,
  OFIYAT_SOURCE_ANNOTATION_SHA256,
  OFIYAT_SOURCE_MASK_SHA256,
  OFIYAT_SOURCE_RENDER_SHA256,
  buildOfiyatProductionMask,
  extractOfiyatSourcePaths,
  validateFreshOfiyatCatalog,
  validateOfiyatCapture,
  validateOfiyatProductionMask,
  validateOfiyatUnavailableFloorSidecar,
} from './ofiyat-data-contract.mjs';
import { preserveKayanLocalAssets } from './sync-kayan-catalog.mjs';

const execFileAsync = promisify(execFile);
const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');
const auditCaptureMode = process.argv.includes('--audit-capture');
if (process.argv.some((argument) => argument.startsWith('--') && argument !== '--audit-capture')) throw new Error(`Unknown argument: ${process.argv.find((argument) => argument.startsWith('--') && argument !== '--audit-capture')}`);

async function loadJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

const manifestPath = resolve(websiteRoot, 'public/kayan/ofiyat/source/asset-manifest.json');
const readmePath = resolve(websiteRoot, 'public/kayan/ofiyat/source/README.md');
const [fixture, catalog, manifest, sidecar, sourceMask, productionMask, blockDataSource, manifestBody, readmeBody] = await Promise.all([
  loadJSON(resolve(websiteRoot, 'scripts/fixtures/ofiyat-data-negative-fixtures.json')),
  loadJSON(resolve(websiteRoot, 'data/kayan-catalog.json')),
  loadJSON(manifestPath),
  loadJSON(resolve(websiteRoot, 'data/ofiyat-floor-schemes.json')),
  readFile(resolve(websiteRoot, 'public/kayan/ofiyat/source/frame-4-original.svg'), 'utf8'),
  readFile(resolve(websiteRoot, 'public/kayan/ofiyat/block-selector-mask.svg'), 'utf8'),
  readFile(resolve(websiteRoot, 'app/kayan/ofiyat-block-data.ts'), 'utf8'),
  readFile(manifestPath),
  readFile(readmePath),
]);
const capture = auditCaptureMode
  ? await loadJSON(resolve(repositoryRoot, 'backend/data/raw/kayan/captures/ofiyat/2026-09-01/visible-inventory.json'))
  : null;

assert.equal(fixture.schemaVersion, 2);
assert.equal(fixture.projectSlug, 'ofiyat');
assert.equal(new Set(fixture.cases.map((item) => item.id)).size, fixture.cases.length, 'negative fixture ids must be unique');

validatePublishedOfiyatCatalog(catalog, manifest);
validateOfiyatProductionMask(productionMask, sourceMask);
validateOfiyatUnavailableFloorSidecar(sidecar, manifest.capture.capturedAt);
assert.equal(productionMask, buildOfiyatProductionMask(sourceMask));
assertPublicProvenancePrivacy(manifestBody, 'Ofiyat asset-manifest.json');
assertPublicProvenancePrivacy(readmeBody, 'Ofiyat README.md');
const privacyFilesVerified = await scanPublishedProvenancePrivacy({ includeDist: true });

const sourcePaths = extractOfiyatSourcePaths(sourceMask);
const runtimePaths = [...blockDataSource.matchAll(/\{ id: 'path-(\d+)', sourceOrder: (\d+), d: '([^']+)' \}/g)];
assert.equal(runtimePaths.length, 7, 'runtime Ofiyat overlay must declare exactly seven source paths');
for (const match of runtimePaths) {
  const pathIndex = Number(match[1]);
  assert.equal(Number(match[2]), pathIndex, `runtime source order changed for path-${pathIndex}`);
  assert.equal(match[3], sourcePaths[pathIndex - 1], `runtime geometry changed for path-${pathIndex}`);
}
for (const [block, sourcePath] of Object.entries(OFIYAT_BLOCK_PATH_MAP)) {
  assert.ok(blockDataSource.includes(`  ${block}: 'path-${sourcePath}',`), `runtime block ${block} mapping changed`);
  assert.ok(blockDataSource.includes(`  ${block}: null,`), `runtime block ${block} invented an entrance mapping`);
}
for (const expected of [OFIYAT_SOURCE_RENDER_SHA256, OFIYAT_SOURCE_MASK_SHA256, OFIYAT_SOURCE_ANNOTATION_SHA256]) {
  assert.ok(blockDataSource.includes(expected), `runtime Ofiyat provenance omits ${expected}`);
}

const productionOfiyat = catalog.projects.find((item) => item.project.slug === 'ofiyat');
assert.ok(productionOfiyat);

function captureMutation(mutator) {
  assert.ok(capture, 'capture mutation is available only in explicit audit mode');
  const value = structuredClone(capture);
  mutator(value);
  return () => validateOfiyatCapture(value);
}

function catalogMutation(mutator) {
  const value = structuredClone(catalog);
  mutator(value.projects.find((item) => item.project.slug === 'ofiyat'), value);
  return () => validatePublishedOfiyatCatalog(value, manifest);
}

function manifestMutation(mutator) {
  const value = structuredClone(manifest);
  mutator(value);
  return () => validatePublishedOfiyatCatalog(catalog, value);
}

function sidecarMutation(mutator) {
  const value = structuredClone(sidecar);
  mutator(value);
  return () => validateOfiyatUnavailableFloorSidecar(value, manifest.capture.capturedAt);
}

function syncInput() {
  const previous = structuredClone(productionOfiyat);
  const incoming = structuredClone(productionOfiyat);
  for (const phase of incoming.project.phases) phase.imageUrl = 'https://pb21432.profitbase.ru/uploads/phase.png';
  for (const layout of incoming.layouts) {
    layout.imageUrl = 'https://pb21432.profitbase.ru/uploads/layout.png';
    layout.thumbnailUrl = layout.imageUrl;
  }
  for (const unit of incoming.units) unit.planImageUrl = 'https://pb21432.profitbase.ru/uploads/unit.png';
  return { previous, incoming };
}

const positiveSync = syncInput();
const preserved = preserveKayanLocalAssets({ slug: 'ofiyat', ...positiveSync.incoming, previous: positiveSync.previous });
assert.ok(preserved.project.phases.every((phase) => phase.imageUrl.startsWith('/kayan/ofiyat/phases/')));
assert.ok(preserved.layouts.every((layout) => layout.imageUrl.startsWith('/kayan/ofiyat/plans/representative/') && layout.thumbnailUrl === layout.imageUrl));
assert.ok(preserved.units.every((unit) => !Object.hasOwn(unit, 'planImageUrl')));

const representativeOutput = manifest.catalogAssets.assets.find((asset) => asset.kind === 'representative-layout').output;
const representativeBody = await readFile(resolve(websiteRoot, 'public', representativeOutput.publicPath.slice(1)));
validatePublishedAssetBytes(representativeOutput, representativeBody);

const actions = new Map([
  ['catalog-remote-representative-regression', catalogMutation((bundle) => {
    bundle.layouts[0].imageUrl = 'https://pb21432.profitbase.ru/uploads/layout.png';
    bundle.layouts[0].thumbnailUrl = bundle.layouts[0].imageUrl;
  })],
  ['catalog-invented-exact-plan', catalogMutation((bundle) => { bundle.units[0].planImageUrl = '/kayan/ofiyat/plans/exact/invented.webp'; })],
  ['catalog-status-mismatch', catalogMutation((bundle) => {
    const unit = bundle.units.find((item) => item.status === 'available');
    unit.status = 'sold';
    delete unit.price;
    delete unit.pricePerM2;
  })],
  ['catalog-remote-phase-regression', catalogMutation((bundle) => { bundle.project.phases[0].imageUrl = 'https://pb21432.profitbase.ru/uploads/phase.png'; })],
  ['catalog-ofiyat-project-timestamp', catalogMutation((bundle) => { bundle.project.updatedAt = '2026-08-01T00:00:00.000Z'; })],
  ['mask-white-rect-restored', () => validateOfiyatProductionMask(productionMask.replace('\n', '\n<rect width="4096" height="2359" fill="white"/>\n'), sourceMask)],
  ['mask-block-mapping-changed', () => validateOfiyatProductionMask(productionMask.replace('data-block="1"', 'data-block="2"'), sourceMask)],
  ['sidecar-wrong-capture-status', sidecarMutation((value) => { value.captureStatus = 'captured'; })],
  ['sidecar-nonzero-schemes', sidecarMutation((value) => { value.schemes.push({ phaseSlug: 'phase-1' }); })],
  ['sidecar-missing-audited-exclusion', sidecarMutation((value) => { value.captureScope.auditedExclusions = []; })],
  ['sync-exact-plan-tuple-drift', () => {
    const { previous, incoming } = syncInput();
    previous.units[0].planImageUrl = '/kayan/ofiyat/plans/exact/strict-association.webp';
    incoming.units[0].number = '999999';
    preserveKayanLocalAssets({ slug: 'ofiyat', ...incoming, previous });
  }],
  ['sync-duplicate-full-tuple', () => {
    const { previous, incoming } = syncInput();
    incoming.units[1].phaseSlug = incoming.units[0].phaseSlug;
    incoming.units[1].entrance = incoming.units[0].entrance;
    incoming.units[1].floor = incoming.units[0].floor;
    incoming.units[1].number = incoming.units[0].number;
    preserveKayanLocalAssets({ slug: 'ofiyat', ...incoming, previous });
  }],
  ['sync-incomplete-layout-universe', () => {
    const { previous, incoming } = syncInput();
    incoming.layouts.pop();
    preserveKayanLocalAssets({ slug: 'ofiyat', ...incoming, previous });
  }],
  ['privacy-macos-users-path', () => assertPublicProvenancePrivacy('user input: /Users/example/private.png', 'fixture')],
  ['privacy-linux-home-path', () => assertPublicProvenancePrivacy('user input: /home/example/private.png', 'fixture')],
  ['privacy-windows-drive-path', () => assertPublicProvenancePrivacy('user input: C:\\Users\\example\\private.png', 'fixture')],
  ['privacy-file-url', () => assertPublicProvenancePrivacy('user input: file:///private/tmp/private.png', 'fixture')],
  ['privacy-telegram-containers-path', () => assertPublicProvenancePrivacy('Library/Containers/ru.keepcoder.Telegram/Data/tmp/private.png', 'fixture')],
  ['deploy-missing-manifest', () => validatePublishedOfiyatCatalog(catalog, undefined)],
  ['deploy-tampered-manifest', manifestMutation((value) => { value.capture.label = 'tampered-capture'; })],
  ['deploy-missing-sidecar', () => validateOfiyatUnavailableFloorSidecar(undefined, manifest.capture.capturedAt)],
  ['deploy-missing-asset', () => validatePublishedAssetBytes(representativeOutput, null, 'fixture asset')],
  ['deploy-tampered-asset', () => validatePublishedAssetBytes(representativeOutput, Buffer.concat([representativeBody, Buffer.from([0])]), 'fixture asset')],
]);

if (auditCaptureMode) {
  validateOfiyatCapture(capture);
  validateFreshOfiyatCatalog(catalog, capture, manifest);
  actions.set('capture-duplicate-full-tuple', captureMutation((value) => { value.phases[0].rows[1] = structuredClone(value.phases[0].rows[0]); }));
  actions.set('capture-summary-status-mismatch', captureMutation((value) => { value.phases[0].summary.normalizedStatus.available += 1; }));
  actions.set('capture-invented-nonavailable-price', captureMutation((value) => {
    const row = value.phases[0].rows.find((item) => item[1] !== 'Свободно');
    row[3] = '1 000 000 сум';
  }));
}

const selectedCases = fixture.cases.filter((item) => item.scope !== 'capture-audit' || auditCaptureMode);
assert.deepEqual([...actions.keys()].sort(), selectedCases.map((item) => item.id).sort(), 'every selected negative fixture must have one executable mutation');
for (const testCase of selectedCases) {
  const action = actions.get(testCase.id);
  assert.throws(action, (error) => {
    assert.ok(error instanceof Error, `${testCase.id} must throw an Error`);
    assert.ok(error.message.includes(testCase.expectedError), `${testCase.id} threw unexpected error: ${error.message}`);
    return true;
  }, testCase.id);
}

if (!auditCaptureMode) {
  const missingRawPath = resolve(websiteRoot, '.deploy-safe-fixture/raw-capture-is-physically-absent.json');
  await assert.rejects(readFile(missingRawPath), (error) => error?.code === 'ENOENT');
  const checked = await execFileAsync(process.execPath, [resolve(websiteRoot, 'scripts/build-ofiyat-assets.mjs'), '--check'], {
    cwd: websiteRoot,
    env: { ...process.env, OFIYAT_RAW_CAPTURE_PATH: missingRawPath },
    timeout: 30_000,
    maxBuffer: 2 << 20,
  });
  assert.ok(checked.stdout.includes('"mode": "check"'), 'deploy verifier must pass with the configured raw capture physically absent');
}

console.log(JSON.stringify({
  projectSlug: 'ofiyat',
  mode: auditCaptureMode ? 'capture-audit' : 'deploy-safe',
  positiveContracts: 9,
  negativeFixtures: selectedCases.length,
  privacyFilesVerified,
  rawCaptureRead: auditCaptureMode,
  syncLocality: { phaseImages: 3, representativeLayouts: 261, exactPlans: 0 },
}, null, 2));
