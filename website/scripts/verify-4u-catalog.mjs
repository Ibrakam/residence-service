import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  expectedNrgOriginalUrl,
  expectedNrgPlanUrl,
  nrgPlanAssetGeometryValid,
  nrgPlanVariants,
  refreshNrgPlanAssets,
} from '../../scripts/live-sync/src/nrg-plan-assets.mjs';
import { containsObviousSecret } from '../../scripts/live-sync/src/redact.mjs';

const catalog = JSON.parse(await readFile(new URL('../data/4u-catalog.json', import.meta.url), 'utf8'));
const auditText = await readFile(new URL('../data/4u-plan-audit.json', import.meta.url), 'utf8');
const audit = JSON.parse(auditText);
const component = await readFile(new URL('../app/4u/apartments/four-u-catalog.tsx', import.meta.url), 'utf8');

assert.equal(audit.projectSlug, '4u');
assert.equal(audit.source?.endpoint, 'https://apigw.bi.group/sales-picker/microfe-v3/placementList');
assert.equal(audit.source?.activeRows, audit.activeUnitCount);
assert.equal(audit.source?.activeIdentityCount, audit.activeUnitCount);
assert.equal(audit.auditedUnitCount, audit.activeUnitCount);
assert.equal(catalog.officialTotalAtCapture, audit.activeUnitCount);
assert.equal(catalog.units.length, audit.activeUnitCount);
assert.ok(catalog.units.length >= 150, '4U snapshot unexpectedly regressed to the old 33-unit subset');
assert.equal(audit.verifiedOriginals, audit.activeUnitCount);
assert.equal(audit.missingOriginals, 0);
assert.equal(audit.publishablePlans, audit.activeUnitCount);
assert.equal(audit.duplicateGroups.length, 0, 'whole plan files must remain unique per official unit');
assert.equal(containsObviousSecret(audit), false, 'bootstrap cache must not contain credentials or personal data');
assert.ok(Buffer.byteLength(auditText) < 8 * 1024 * 1024, 'bootstrap cache exceeds the runtime cache size limit');
for (const variant of ['original', ...nrgPlanVariants.map(String)]) {
  assert.deepEqual(audit.variants[variant], { attempted: audit.activeUnitCount, valid: audit.activeUnitCount, invalid: 0 });
}

const auditById = new Map(audit.units.map((unit) => [unit.unitId, unit]));
const originalURLs = new Set();
const originalHashes = new Set();
const previewURLs = new Set();
for (const unit of catalog.units) {
  const identity = /^nrg-bi:4u:([0-9a-f-]+)$/i.exec(unit.sourceKey)?.[1];
  assert.equal(identity, unit.id, `4U ${unit.id} source identity mismatch`);
  const row = { uuid: unit.id, blockId: unit.blockId, name: unit.number };
  const originalURL = expectedNrgOriginalUrl(row);
  const previewURL = expectedNrgPlanUrl(row, 1600);
  assert.equal(unit.planImageUrl, originalURL, `4U ${unit.id} primary plan must be the detail original`);
  assert.equal(unit.planOriginalUrl, originalURL, `4U ${unit.id} lightbox plan mismatch`);
  assert.equal(unit.planPreviewUrl, previewURL, `4U ${unit.id} card preview mismatch`);
  assert.equal(unit.planThumbnailUrl, expectedNrgPlanUrl(row, 200), `4U ${unit.id} thumbnail mismatch`);
  assert.equal(unit.planMimeType, 'image/png');
  assert.ok(nrgPlanAssetGeometryValid('original', { width: unit.planWidth, height: unit.planHeight, bytes: unit.planBytes }), `4U ${unit.id} original geometry/size is invalid`);
  assert.match(unit.planSha256, /^[a-f0-9]{64}$/);
  assert.equal(unit.status, 'available');

  const asset = auditById.get(unit.id);
  assert.ok(asset, `4U ${unit.id} is missing from the plan audit`);
  assert.equal(asset.blockId, unit.blockId);
  assert.equal(String(asset.number), String(unit.number));
  assert.ok(Number.isFinite(Date.parse(asset.validatedAt)), `4U ${unit.id} validation timestamp is missing`);
  assert.equal(asset.selectedOriginalUrl, originalURL);
  assert.equal(asset.original.url, originalURL);
  assert.equal(asset.original.status, 200);
  assert.equal(asset.original.ok, true);
  assert.ok(['application/octet-stream', 'image/png'].includes(asset.original.declaredMimeType));
  assert.equal(asset.original.mimeType, 'image/png');
  assert.ok(nrgPlanAssetGeometryValid('original', asset.original));
  assert.equal(asset.original.sha256, unit.planSha256);
  for (const variant of nrgPlanVariants) {
    const item = asset.variants.find((candidate) => candidate.variant === variant);
    assert.ok(item, `4U ${unit.id}/${variant} audit is missing`);
    assert.equal(item.url, expectedNrgPlanUrl(row, variant));
    assert.equal(item.status, 200);
    assert.equal(item.ok, true);
    assert.equal(item.declaredMimeType, 'image/jpeg', `4U ${unit.id}/${variant} declared MIME changed`);
    assert.equal(item.mimeType, 'image/jpeg', `4U ${unit.id}/${variant} bytes are not JPEG`);
    assert.ok(nrgPlanAssetGeometryValid(variant, item), `4U ${unit.id}/${variant} geometry/size is invalid`);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
  }
  originalURLs.add(originalURL);
  originalHashes.add(unit.planSha256);
  previewURLs.add(previewURL);
}

assert.equal(auditById.size, catalog.units.length);
assert.equal(originalURLs.size, catalog.units.length);
assert.equal(originalHashes.size, catalog.units.length);
assert.equal(previewURLs.size, catalog.units.length);
assert.doesNotMatch(component, /\/4u\/plans\/\$\{unit\.id\}\.webp/, '4U must not derive a plan from a database/presentation id');
assert.doesNotMatch(component, /useState\((?:33|108|800|2500)\)/, '4U filter defaults must come from current units');
assert.doesNotMatch(component, /units\.length\}\s*\/\s*\{snapshotData\.officialTotalAtCapture/, '4U must not mix filtered/live apartment counts with the mixed source total');
assert.match(component, /original \? \[full, preview\].*:\s*\[preview\]/, '4U cards must use preview while the lightbox prefers original');
assert.match(component, /last-known-good|noPlan|temporarily unavailable/i);

const bootstrapRows = catalog.units.map((unit) => ({
  uuid: unit.id,
  blockId: unit.blockId,
  name: unit.number,
  isSale: true,
  photoURL1600: unit.planPreviewUrl,
  photoURL400: expectedNrgPlanUrl({ uuid: unit.id, blockId: unit.blockId, name: unit.number }, 400),
  photoURL200: unit.planThumbnailUrl,
}));
let unexpectedBootstrapFetches = 0;
const bootstrap = await refreshNrgPlanAssets(bootstrapRows, {
  capturedAt: catalog.capturedAt,
  previousAudit: audit,
  attempts: 1,
  fetchImpl: async () => { unexpectedBootstrapFetches += 1; throw new Error('bootstrap cache miss'); },
});
assert.equal(unexpectedBootstrapFetches, 0, 'committed audit must be directly compatible with the production cache path');
assert.deepEqual(bootstrap.audit.refresh, {
  cachePolicy: 'reuse a complete validated audit while its exact block/unit/number asset URLs are unchanged',
  reusedUnits: catalog.units.length,
  refreshedUnits: 0,
  detailRequests: 0,
  assetRequests: 0,
  downloadedAssetBytes: 0,
});

const widths = catalog.units.map((unit) => unit.planWidth);
const heights = catalog.units.map((unit) => unit.planHeight);
const bytes = catalog.units.map((unit) => unit.planBytes);
console.log(JSON.stringify({
  activeUnits: catalog.units.length,
  verifiedOriginals: audit.verifiedOriginals,
  verifiedCardPreviews: audit.variants['1600'].valid,
  dimensions: { minWidth: Math.min(...widths), maxWidth: Math.max(...widths), minHeight: Math.min(...heights), maxHeight: Math.max(...heights) },
  bytes: { min: Math.min(...bytes), max: Math.max(...bytes) },
  duplicates: audit.duplicateGroups.length,
  bootstrapCache: {
    sha256: createHash('sha256').update(auditText).digest('hex'),
    reusedUnits: bootstrap.audit.refresh.reusedUnits,
    detailRequests: bootstrap.audit.refresh.detailRequests,
    assetRequests: bootstrap.audit.refresh.assetRequests,
    downloadedAssetBytes: bootstrap.audit.refresh.downloadedAssetBytes,
  },
}, null, 2));

assert.ok(fileURLToPath(new URL('../', import.meta.url)).endsWith('/website/'));
