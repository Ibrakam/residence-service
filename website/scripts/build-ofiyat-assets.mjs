import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  OFIYAT_BLOCK_PATH_MAP,
  OFIYAT_CAPTURE_RELATIVE_PATH,
  OFIYAT_SOURCE_ANNOTATION_SHA256,
  OFIYAT_SOURCE_MASK_SHA256,
  OFIYAT_SOURCE_RENDER_SHA256,
  applyOfiyatCaptureToCatalog,
  buildOfiyatProductionMask,
  createOfiyatUnavailableFloorSidecar,
  sha256,
  validateFreshOfiyatCatalog,
  validateOfiyatCapture,
  validateOfiyatProductionMask,
  validateOfiyatUnavailableFloorSidecar,
} from './ofiyat-data-contract.mjs';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');
const publicRoot = resolve(websiteRoot, 'public');
const publicOfiyatRoot = resolve(publicRoot, 'kayan/ofiyat');
const catalogPath = resolve(websiteRoot, 'data/kayan-catalog.json');
const floorSidecarPath = resolve(websiteRoot, 'data/ofiyat-floor-schemes.json');
const capturePath = resolve(repositoryRoot, process.env.OFIYAT_RAW_CAPTURE_PATH ?? OFIYAT_CAPTURE_RELATIVE_PATH);
const manifestPath = resolve(publicOfiyatRoot, 'source/asset-manifest.json');
const readmePath = resolve(publicOfiyatRoot, 'source/README.md');
const sourceRenderPath = '/Users/ibragimkadamzanov/Library/Containers/ru.keepcoder.Telegram/Data/tmp/Frame 4.webp';
const sourceMaskPath = '/Users/ibragimkadamzanov/Library/Containers/ru.keepcoder.Telegram/Data/tmp/Frame 4.svg';
const sourceAnnotationPath = '/Users/ibragimkadamzanov/Library/Containers/ru.keepcoder.Telegram/Data/tmp/Снимок экрана — 2026-08-31 в 13.28.45.png';
const sourceRenderLabel = 'user-supplied/Frame 4.webp';
const sourceMaskLabel = 'user-supplied/Frame 4.svg';
const sourceAnnotationLabel = 'user-supplied/ofiyat-block-annotation.png';
const checkOnly = process.argv.includes('--check');
const auditCaptureOnly = process.argv.includes('--audit-capture');
const expectedRemoteOrigin = 'https://pb21432.profitbase.ru';
const maxRemoteSourceBytes = 32 << 20;
const maxOutputBytes = 32 << 20;
const expectedCaptureProvenance = Object.freeze({
  label: 'authenticated-read-only/ofiyat-visible-inventory-2026-09-01',
  capturedAt: '2026-08-31T19:26:42.293Z',
  bytes: 145903,
  sha256: '80b95a1fda9c8178acc34d2ae2463936523a118b4a3451eb907d11e7793e8683',
  scope: 'full-visible-inventory-all-statuses',
  unitCount: 585,
  normalizedStatus: Object.freeze({ available: 132, reserved: 25, sold: 300, unavailable: 128 }),
});
const expectedOfiyatBundleSha256 = 'd8649553cba4dade86720257bab0f5d4a954fa543896d5c51c2ca3dc85f6d8ec';
const verifiedPublicPageAssets = Object.freeze([
  { publicPath: '/kayan/ofiyat/hero.webp', sourceURL: 'https://kayan.uz/storage/projects/b177c652-0eea-486e-a169-89425ad35e5f.webp', sha256: '95b3575a5f5d8b24be76cff83278bfab8c9fec528d8c3ee5799d7f00b6c0c746', bytes: 268172, format: 'webp', width: 2025, height: 726, classification: 'architectural render' },
  { publicPath: '/kayan/ofiyat/aerial.webp', sourceURL: 'https://kayan.uz/storage/projects/5d916dc6-26ae-4a66-b93f-e622e0e01144.webp', sha256: '40068e54cbe5cc9e9ea5b1f89b07dfdaa2180cf4fd2160f500b89ef79e4a0a89', bytes: 754446, format: 'webp', width: 3060, height: 1594, classification: 'architectural render' },
  { publicPath: '/kayan/ofiyat/courtyard.webp', sourceURL: 'https://kayan.uz/storage/abouts/f09faaaa-9905-4fd2-a61f-2c2afc8ee1e3.webp', sha256: '2cbcfb52bdcbc43a17a91474e9e88e28b9efb7fd0685f5e99d192173db3636e0', bytes: 225314, format: 'webp', width: 1131, height: 726, classification: 'architectural render' },
  { publicPath: '/kayan/ofiyat/lifestyle.webp', sourceURL: 'https://kayan.uz/storage/abouts/0633ef7c-0186-417c-a4a2-47b7a56a48fb.webp', sha256: '184f8099a7d2ddd307c310b6c340bde308588bb786c5e8329d03e5ad449db399', bytes: 237132, format: 'webp', width: 1598, height: 726, classification: 'architectural render' },
  { publicPath: '/kayan/ofiyat/playground.png', sourceURL: 'https://kayan.uz/storage/infras/c6895493-f5ba-4927-984a-91bf5bbfb7a6.png', sha256: 'b4fa10e30faeb70f77e39d5d018ee12080e0c610c373f5e04d9bc9ff79c60b61', bytes: 15235, format: 'png', width: 170, height: 170, classification: 'amenity icon/illustration' },
  { publicPath: '/kayan/ofiyat/white-box.png', sourceURL: 'https://kayan.uz/storage/infras/4f6858eb-6155-422e-9af9-c48b7cbcf40c.png', sha256: 'fdc5e9b081ead5ccb7a455fedff9118fb703e9569ddb99f5d49dbbd08bb8da02', bytes: 12692, format: 'png', width: 170, height: 170, classification: 'amenity icon/illustration' },
  { publicPath: '/kayan/ofiyat/parking.png', sourceURL: 'https://kayan.uz/storage/infras/3ee6394f-f266-4ff6-a898-aa1b5c6eacba.png', sha256: '27d7ceb76fad1d5fa41f81fca866f3d27f57721929644a32295b923534741d05', bytes: 15682, format: 'png', width: 170, height: 170, classification: 'amenity icon/illustration' },
]);
const legacyLocalAssets = Object.freeze([
  { publicPath: '/kayan/ofiyat/layouts.webp', sha256: 'ca9cdcf7a9464546e257f264aa4fd0e5d67803432d2ac79323cd658d44d228ff' },
  { publicPath: '/kayan/ofiyat/landscape.webp', sha256: 'b7eb50149a1592efd3ceed103e87fb76ed442e49fd87ba2fdcea265f9028ee6e' },
  { publicPath: '/kayan/ofiyat/architecture.webp', sha256: '95636aaa59d1d5371e32316e22bfdc9c5cb6cbe391fcde50a4c3d5810fae0834' },
  { publicPath: '/kayan/ofiyat/engineering.webp', sha256: 'bc2ffab21e936ade5eafdddc6def64113e737f62a5faf0e6fb885d33af218490' },
  { publicPath: '/kayan/ofiyat/location.webp', sha256: '06753dcae4ff662ac8fb1899769f2eb2a354bd67f8664bc97dfdc8fb004172e1' },
  { publicPath: '/kayan/ofiyat/white-box-interior.webp', sha256: '772ffb78ef15f41ed7614982dfd52be02a34d088dc1e1eb284c11feb664b98b7' },
]);

if (process.argv.some((argument) => argument.startsWith('--') && !['--check', '--audit-capture'].includes(argument))) {
  throw new Error(`Unknown argument: ${process.argv.find((argument) => argument.startsWith('--') && !['--check', '--audit-capture'].includes(argument))}`);
}
if (checkOnly && auditCaptureOnly) throw new Error('Choose either --check or --audit-capture');

function canonicalJSON(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

const forbiddenPublicProvenancePatterns = Object.freeze([
  { id: 'macos-users-path', pattern: /\/Users\//i },
  { id: 'linux-home-path', pattern: /\/home\//i },
  { id: 'windows-drive-path', pattern: /(?:^|[\s"'`(])(?:[a-z]:[\\/])/i },
  { id: 'file-url', pattern: /file:\/\//i },
  { id: 'telegram-containers-path', pattern: /(?:Library[\\/]+Containers[\\/]+|ru\.keepcoder\.Telegram|Telegram[\\/]+Data[\\/]+tmp)/i },
]);

export function assertPublicProvenancePrivacy(value, context = 'public provenance') {
  const textValue = Buffer.isBuffer(value)
    ? value.toString('utf8')
    : typeof value === 'string'
      ? value
      : JSON.stringify(value);
  if (typeof textValue !== 'string') throw new Error(`${context} cannot be serialized for privacy verification`);
  for (const forbidden of forbiddenPublicProvenancePatterns) {
    if (forbidden.pattern.test(textValue)) throw new Error(`${context} contains forbidden public provenance ${forbidden.id}`);
  }
  return true;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validatePublishedAssetBytes(output, body, context = 'published Ofiyat asset') {
  if (!isRecord(output) || !Buffer.isBuffer(body)) throw new Error(`${context} is missing`);
  if (body.length !== output.bytes || sha256(body) !== output.sha256) throw new Error(`${context} byte size/SHA-256 mismatch`);
  return true;
}

export function validatePublishedOfiyatCatalog(catalog, manifest) {
  if (!isRecord(catalog) || !isRecord(manifest)) throw new Error('Published Ofiyat catalog/manifest is missing');
  assertPublicProvenancePrivacy(manifest, 'Ofiyat asset-manifest.json');
  if (
    manifest.schemaVersion !== 1
    || manifest.projectSlug !== 'ofiyat'
    || JSON.stringify(manifest.capture) !== JSON.stringify(expectedCaptureProvenance)
    || Object.hasOwn(manifest.capture, 'path')
  ) throw new Error('Published Ofiyat manifest capture provenance is invalid');
  if (
    !isRecord(manifest.productionCatalog)
    || manifest.productionCatalog.projectSlug !== 'ofiyat'
    || manifest.productionCatalog.bundleSha256 !== expectedOfiyatBundleSha256
    || manifest.productionCatalog.unitCount !== 585
  ) throw new Error('Published Ofiyat production bundle provenance is invalid');

  const bundle = catalog.projects?.find((item) => item?.project?.slug === 'ofiyat');
  if (!bundle || bundle.units?.length !== 585 || bundle.layouts?.length !== 261 || bundle.project?.phases?.length !== 3) throw new Error('Published Ofiyat production bundle is incomplete');
  if (bundle.project.updatedAt !== expectedCaptureProvenance.capturedAt || bundle.project.totalUnits !== 585 || bundle.project.availableUnits !== 132) throw new Error('Published Ofiyat project timestamp/counts do not identify the audited capture');

  const manifestPhasePaths = new Map(manifest.catalogAssets?.assets?.filter((asset) => asset.kind === 'phase').map((asset) => [asset.phaseSlug, asset.output.publicPath]));
  const manifestLayoutPaths = new Map(manifest.catalogAssets?.assets?.filter((asset) => asset.kind === 'representative-layout').map((asset) => [`${asset.phaseSlug}\u001f${asset.sourceId}`, asset.output.publicPath]));
  if (manifestPhasePaths.size !== 3 || manifestLayoutPaths.size !== 261) throw new Error('Published Ofiyat manifest asset universe is incomplete');

  const phaseExpected = new Map([
    ['phase-1', { total: 245, available: 11 }],
    ['phase-2', { total: 169, available: 16 }],
    ['parking', { total: 171, available: 105 }],
  ]);
  for (const phase of bundle.project.phases) {
    const expected = phaseExpected.get(phase.slug);
    if (!expected || phase.totalUnits !== expected.total || phase.availableUnits !== expected.available || phase.updatedAt !== expectedCaptureProvenance.capturedAt || phase.imageUrl !== manifestPhasePaths.get(phase.slug) || /^https?:\/\//.test(phase.imageUrl)) {
      throw new Error(`Published Ofiyat phase ${phase.slug} is stale or remote`);
    }
  }

  const statuses = { available: 0, reserved: 0, sold: 0, unavailable: 0 };
  const tuples = new Set();
  const sourceKeys = new Set();
  for (const unit of bundle.units) {
    const tuple = [unit.phaseSlug, unit.entrance, String(unit.floor), unit.number].join('\u001f');
    if (!unit.sourceKey || sourceKeys.has(unit.sourceKey) || tuples.has(tuple)) throw new Error(`Published Ofiyat unit identity is missing or duplicated: ${tuple}`);
    sourceKeys.add(unit.sourceKey);
    tuples.add(tuple);
    if (!Object.hasOwn(statuses, unit.status)) throw new Error(`Published Ofiyat unit ${tuple} has an unknown status`);
    statuses[unit.status] += 1;
    if (Object.hasOwn(unit, 'planImageUrl')) throw new Error(`Ofiyat exact plan must remain absent without strict association: ${tuple}`);
    if (unit.sourceUpdatedAt !== expectedCaptureProvenance.capturedAt || unit.updatedAt !== expectedCaptureProvenance.capturedAt) throw new Error(`Published Ofiyat unit ${tuple} has a stale source timestamp`);
    if (unit.status === 'available') {
      if (!Number.isSafeInteger(unit.price) || unit.price <= 0 || !Number.isFinite(unit.pricePerM2) || unit.pricePerM2 <= 0) throw new Error(`Published Ofiyat available unit ${tuple} has no audited positive price`);
    } else if (Object.hasOwn(unit, 'price') || Object.hasOwn(unit, 'pricePerM2')) {
      throw new Error(`Published Ofiyat non-available unit ${tuple} has an invented price`);
    }
  }
  if (JSON.stringify(statuses) !== JSON.stringify(expectedCaptureProvenance.normalizedStatus)) throw new Error('Published Ofiyat normalized status counts differ from the audited capture');

  const layoutKeys = new Set();
  for (const layout of bundle.layouts) {
    const key = `${layout.phaseSlug}\u001f${layout.sourceId}`;
    const expectedPath = manifestLayoutPaths.get(key);
    if (!expectedPath || layoutKeys.has(key) || layout.imageUrl !== expectedPath || layout.thumbnailUrl !== expectedPath || /^https?:\/\//.test(layout.imageUrl)) throw new Error(`Published Ofiyat layout ${key} is missing its local representative asset`);
    layoutKeys.add(key);
  }
  if (sha256(canonicalJSON(bundle)) !== expectedOfiyatBundleSha256) throw new Error('Published Ofiyat bundle SHA-256 differs from the audited production bundle');
  return { bundle, statuses };
}

function publicDestination(publicPath) {
  if (
    typeof publicPath !== 'string'
    || !publicPath.startsWith('/kayan/ofiyat/')
    || publicPath.includes('://')
    || /[?#\\%]/.test(publicPath)
    || publicPath.split('/').some((segment) => segment === '.' || segment === '..')
  ) throw new Error(`Unsafe Ofiyat public path: ${String(publicPath)}`);
  const destination = resolve(publicRoot, publicPath.slice(1));
  if (!destination.startsWith(`${publicOfiyatRoot}${sep}`)) throw new Error(`Ofiyat path escapes its public root: ${publicPath}`);
  return destination;
}

function safeRemoteImageURL(value, context) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${context} has no retained official remote source URL`);
  }
  if (parsed.origin !== expectedRemoteOrigin || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/(?:uploads|document-management\/thumbnails)\//.test(parsed.pathname)) {
    throw new Error(`${context} source URL is outside the verified public Profitbase image origin`);
  }
  return parsed.href;
}

function findExistingSource(existingManifest, predicate) {
  const match = existingManifest?.catalogAssets?.assets?.find(predicate);
  return match?.source?.url;
}

function collectAssetSpecifications(catalog, existingManifest) {
  const bundle = catalog.projects?.find((item) => item?.project?.slug === 'ofiyat');
  if (!bundle || bundle.project?.phases?.length !== 3 || bundle.layouts?.length !== 261) throw new Error('Ofiyat catalogue is missing its three phases or 261 representative layouts');
  const specifications = [];
  const phaseImages = new Map();
  const layouts = new Map();
  for (const phase of bundle.project.phases) {
    if (!['phase-1', 'phase-2', 'parking'].includes(phase.slug)) throw new Error(`Unexpected Ofiyat phase ${phase.slug}`);
    const remote = /^https?:\/\//.test(phase.imageUrl ?? '')
      ? phase.imageUrl
      : findExistingSource(existingManifest, (asset) => asset.kind === 'phase' && asset.phaseSlug === phase.slug);
    const sourceURL = safeRemoteImageURL(remote, `Ofiyat phase ${phase.slug}`);
    const publicPath = `/kayan/ofiyat/phases/${phase.slug}.webp`;
    phaseImages.set(phase.slug, publicPath);
    specifications.push({ kind: 'phase', phaseSlug: phase.slug, sourceId: null, sourceURL, publicPath });
  }
  const seenLayoutKeys = new Set();
  for (const layout of bundle.layouts) {
    if (!['phase-1', 'phase-2', 'parking'].includes(layout.phaseSlug) || typeof layout.sourceId !== 'string' || !/^\d+$/.test(layout.sourceId)) throw new Error('Ofiyat representative layout identity is malformed');
    const key = `${layout.phaseSlug}\u001f${layout.sourceId}`;
    if (seenLayoutKeys.has(key)) throw new Error(`Duplicate Ofiyat representative layout ${key}`);
    seenLayoutKeys.add(key);
    const remote = /^https?:\/\//.test(layout.imageUrl ?? '')
      ? layout.imageUrl
      : findExistingSource(existingManifest, (asset) => asset.kind === 'representative-layout' && asset.phaseSlug === layout.phaseSlug && asset.sourceId === layout.sourceId);
    const sourceURL = safeRemoteImageURL(remote, `Ofiyat representative layout ${key}`);
    const publicPath = `/kayan/ofiyat/plans/representative/${layout.phaseSlug}/${layout.sourceId}.webp`;
    layouts.set(key, publicPath);
    specifications.push({ kind: 'representative-layout', phaseSlug: layout.phaseSlug, sourceId: layout.sourceId, sourceURL, publicPath });
  }
  if (seenLayoutKeys.size !== 261 || specifications.length !== 264) throw new Error('Ofiyat asset universe must contain 3 phase images and 261 representative layouts');
  return { specifications, localAssets: { phaseImages, layouts } };
}

async function imageMetadata(body, context) {
  const metadata = await sharp(body, { limitInputPixels: 100_000_000 }).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > 40_000_000 || !metadata.format) {
    throw new Error(`${context} has invalid image dimensions or format`);
  }
  return { format: metadata.format, width: metadata.width, height: metadata.height };
}

async function fetchImage(sourceURL, context) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(sourceURL, {
        headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maxRemoteSourceBytes) throw new Error(`declared source is ${declaredLength} bytes`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length < 1024 || body.length > maxRemoteSourceBytes) throw new Error(`received ${body.length} bytes`);
      const metadata = await imageMetadata(body, `${context} source`);
      return { body, metadata, contentType: response.headers.get('content-type') ?? `image/${metadata.format}` };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 250));
    }
  }
  throw new Error(`${context} download failed after three attempts: ${String(lastError)}`);
}

async function optimizeOfficialImage(body, context) {
  const output = await sharp(body, { limitInputPixels: 100_000_000 })
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  if (output.length < 1024 || output.length > maxOutputBytes) throw new Error(`${context} optimized output has invalid size ${output.length}`);
  const metadata = await imageMetadata(output, `${context} output`);
  if (metadata.format !== 'webp') throw new Error(`${context} did not produce WebP`);
  return { body: output, metadata };
}

function stagePath(stageRoot, absoluteTarget) {
  const relativePath = relative(repositoryRoot, absoluteTarget);
  if (!relativePath || relativePath.startsWith('..') || relativePath.includes(`${sep}..${sep}`)) throw new Error(`Cannot stage target outside repository: ${absoluteTarget}`);
  return resolve(stageRoot, relativePath);
}

async function stageBody(stageRoot, target, body, entries) {
  const staged = stagePath(stageRoot, target);
  await mkdir(dirname(staged), { recursive: true });
  await writeFile(staged, body);
  entries.push({ target, staged });
}

async function commitTransaction(entries) {
  const token = `${process.pid}-${Date.now()}`;
  const states = entries.map((entry) => ({ ...entry, backup: `${entry.target}.backup-${token}`, backedUp: false, committed: false }));
  try {
    for (const state of states) {
      await mkdir(dirname(state.target), { recursive: true });
      try {
        await rename(state.target, state.backup);
        state.backedUp = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(state.staged, state.target);
      state.committed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const state of [...states].reverse()) {
      try {
        if (state.committed) await unlink(state.target).catch((unlinkError) => { if (unlinkError?.code !== 'ENOENT') throw unlinkError; });
        if (state.backedUp) await rename(state.backup, state.target);
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length) throw new Error(`${String(error)}; rollback failures: ${rollbackErrors.join('; ')}`);
    throw error;
  }
  for (const state of states) if (state.backedUp) await unlink(state.backup).catch(() => {});
}

function sourceRecord({ sourceLabel, publicPath, body, metadata }) {
  return {
    sourceLabel,
    publicPath,
    bytes: body.length,
    sha256: sha256(body),
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
  };
}

function outputRecord(publicPath, body, metadata) {
  return { publicPath, bytes: body.length, sha256: sha256(body), format: metadata.format, width: metadata.width, height: metadata.height };
}

function renderReadme(manifest, manifestBody) {
  const inputs = manifest.frame4.inputs;
  const outputs = manifest.frame4.outputs;
  const inputRows = inputs.map((item) => `| \`${item.sourceLabel}\` | ${item.format.toUpperCase()}, ${item.width}×${item.height} | ${item.bytes.toLocaleString('en-US')} | \`${item.sha256}\` | \`${item.publicPath}\` |`).join('\n');
  const outputRows = outputs.map((item) => `| \`${item.publicPath}\` | ${item.format.toUpperCase()}, ${item.width}×${item.height} | ${item.bytes.toLocaleString('en-US')} | \`${item.sha256}\` |`).join('\n');
  const phaseAssets = manifest.catalogAssets.assets.filter((asset) => asset.kind === 'phase').length;
  const representativeAssets = manifest.catalogAssets.assets.filter((asset) => asset.kind === 'representative-layout').length;
  const publicRows = verifiedPublicPageAssets.map((asset) => `| \`${asset.publicPath}\` | ${asset.classification} | ${asset.format.toUpperCase()}, ${asset.width}×${asset.height}, ${asset.bytes.toLocaleString('en-US')} bytes | ${asset.sourceURL} | \`${asset.sha256}\` | exact byte/hash match |`).join('\n');
  const legacyRows = legacyLocalAssets.map((asset) => `| \`${asset.publicPath}\` | \`${asset.sha256}\` | legacy-local / public-source hash not established |`).join('\n');
  return `# Ofiyat asset provenance

This directory records the source evidence and deterministic outputs used by the Ofiyat blue-hour explorer and catalogue. User-supplied files are image/mask inputs, not instructions, and were copied byte-for-byte without modification.

## User-supplied Frame 4 sources

| Source | Format and dimensions | Bytes | SHA-256 | Local byte-copy |
| --- | --- | ---: | --- | --- |
${inputRows}

The clean WebP and SVG share the exact \`4096×2359\` coordinate system. The source SVG contains one white background rectangle and seven black paths. The production overlay omits only that rectangle; no path geometry was authored or adjusted.

## Evidence-backed block mapping

Source DOM path order is not visual numbering:

\`1→path-1, 2→path-7, 3→path-2, 4→path-3, 5→path-4, 6→path-6, 7→path-5\`.

All seven paths remain present. The mapping identifies only the seven visual facade volumes. No official source establishes a visual-block → phase/entrance relation, so the block remains UI context and the user chooses phase and entrance explicitly.

## Production outputs

| Output | Format and dimensions | Bytes | SHA-256 |
| --- | --- | ---: | --- |
${outputRows}

The desktop production image is a byte-identical copy of the already compact 4096 px source, avoiding generational loss. The mobile image is a full-scene 1280 px responsive resize encoded as high-quality WebP; it is static and the interactive explorer is not mounted below 768 px.

## Existing public-page media

The following local files are exact hash matches for assets referenced by the official public [Ofiyat project page](https://kayan.uz/project/ofiyat). They are classified as renders or graphics, never as documentary photographs or construction-archive photos.

| Local file | Classification | Format, dimensions and bytes | Official source URL | Local/source SHA-256 | Association |
| --- | --- | --- | --- | --- | --- |
${publicRows}

Six older local files are retained for compatibility with dormant project-data configuration, but the visible Ofiyat page does not use them as sourced evidence and the current audit did not establish an exact public-source hash association. They must not be described as official photos or construction archive evidence:

| Local file | Local SHA-256 | Provenance status |
| --- | --- | --- |
${legacyRows}

## Catalogue images

The authenticated read-only capture \`${manifest.capture.label}\` was observed at \`${manifest.capture.capturedAt}\` with SHA-256 \`${manifest.capture.sha256}\`. It covers all 585 units and all statuses, not only available cards.

- ${phaseAssets} official phase images are stored locally under \`/kayan/ofiyat/phases/\`.
- ${representativeAssets} official representative layout images are stored locally under \`/kayan/ofiyat/plans/representative/\`.
- Exact unit-plan associations: **0**. No image is labelled exact without a strict unit-specific association.
- Official floor-scheme assets/hotspots: **0 / 0**. Authenticated inspection exposed chessboard, enhanced chessboard, premises and layout views, but no published floor-plan canvas or hotspot geometry. The sanitized schemaVersion 3 sidecar records this as \`not-published-by-source\`; no plan is drawn or inferred.

The complete per-file source/output URL, dimensions, bytes and SHA-256 manifest is \`asset-manifest.json\` (manifest SHA-256 \`${sha256(manifestBody)}\`). It contains public image URLs only and no cookies, localStorage, tokens, iframe query strings or credentials.
`;
}

async function inspectFile(path, context) {
  const body = await readFile(path);
  const info = await stat(path);
  if (!info.isFile() || info.size !== body.length) throw new Error(`${context} is not a stable regular file`);
  return body;
}

const privacyTextExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.svg', '.txt', '.xml']);

function privacyExtension(path) {
  const match = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? '';
}

async function collectPrivacyFiles(rootPath, optional, ignoredDirectories = []) {
  if (ignoredDirectories.some((ignored) => rootPath === ignored || rootPath.startsWith(`${ignored}${sep}`))) return [];
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (optional && error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const child = resolve(rootPath, entry.name);
    if (entry.isDirectory()) files.push(...await collectPrivacyFiles(child, false, ignoredDirectories));
    else if (entry.isFile() && privacyTextExtensions.has(privacyExtension(child))) files.push(child);
  }
  return files;
}

export async function scanPublishedProvenancePrivacy({ includeDist = true } = {}) {
  const standaloneRuntimeDependencies = resolve(websiteRoot, 'dist/standalone/node_modules');
  const roots = [
    { path: resolve(publicRoot, 'kayan/ofiyat/source'), optional: false },
    { path: resolve(publicRoot, 'kayan/mirador/source'), optional: false },
    ...(includeDist ? [{ path: resolve(websiteRoot, 'dist'), optional: true, ignoredDirectories: [standaloneRuntimeDependencies] }] : []),
  ];
  let checkedFiles = 0;
  for (const rootEntry of roots) {
    for (const path of await collectPrivacyFiles(rootEntry.path, rootEntry.optional, rootEntry.ignoredDirectories)) {
      assertPublicProvenancePrivacy(await readFile(path), relative(websiteRoot, path));
      checkedFiles += 1;
    }
  }
  return checkedFiles;
}

async function inspectOriginalOrCopy(sourcePath, publicPath, context) {
  try {
    return await inspectFile(sourcePath, context);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return inspectFile(publicDestination(publicPath), `${context} local byte-copy`);
  }
}

async function verifyOutputFile(output, context) {
  const destination = publicDestination(output.publicPath);
  const body = await inspectFile(destination, context);
  validatePublishedAssetBytes(output, body, context);
  const metadata = await imageMetadata(body, context);
  if (metadata.format !== output.format || metadata.width !== output.width || metadata.height !== output.height) throw new Error(`${context} image metadata mismatch`);
}

async function loadExistingManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function verifyEverything({ catalog, manifest, sourceRender, sourceMask, sourceAnnotation, includeDist = true }) {
  if (manifest.schemaVersion !== 1 || manifest.projectSlug !== 'ofiyat' || manifest.catalogAssets.exactUnitPlanCount !== 0 || manifest.catalogAssets.phaseImageCount !== 3 || manifest.catalogAssets.representativeLayoutCount !== 261 || manifest.catalogAssets.assets.length !== 264) throw new Error('Ofiyat asset manifest identity/counts are invalid');
  if (JSON.stringify(manifest.publicPageAssets) !== JSON.stringify(verifiedPublicPageAssets)) throw new Error('Ofiyat official public-page provenance is incomplete or stale');
  validatePublishedOfiyatCatalog(catalog, manifest);
  const sourceInputs = new Map(manifest.frame4.inputs.map((input) => [input.publicPath, input]));
  const expectedSources = [
    ['/kayan/ofiyat/source/frame-4-original.webp', sourceRenderLabel, sourceRender, OFIYAT_SOURCE_RENDER_SHA256, { format: 'webp', width: 4096, height: 2359 }],
    ['/kayan/ofiyat/source/frame-4-original.svg', sourceMaskLabel, sourceMask, OFIYAT_SOURCE_MASK_SHA256, { format: 'svg', width: 4096, height: 2359 }],
    ['/kayan/ofiyat/source/block-annotation.png', sourceAnnotationLabel, sourceAnnotation, OFIYAT_SOURCE_ANNOTATION_SHA256, { format: 'png', width: 1862, height: 1126 }],
  ];
  for (const [publicPath, sourceLabel, sourceBody, expectedSHA, metadata] of expectedSources) {
    const input = sourceInputs.get(publicPath);
    if (!input || input.sourceLabel !== sourceLabel || Object.hasOwn(input, 'sourcePath') || input.sha256 !== expectedSHA || input.bytes !== sourceBody.length || input.format !== metadata.format || input.width !== metadata.width || input.height !== metadata.height) throw new Error(`Ofiyat Frame 4 manifest source ${publicPath} is invalid`);
    const localBody = await inspectFile(publicDestination(publicPath), `Ofiyat source copy ${publicPath}`);
    if (!localBody.equals(sourceBody)) throw new Error(`Ofiyat source copy ${publicPath} is not byte-identical`);
  }
  const maskBody = await readFile(publicDestination('/kayan/ofiyat/block-selector-mask.svg'), 'utf8');
  validateOfiyatProductionMask(maskBody, sourceMask.toString('utf8'));
  for (const output of manifest.frame4.outputs.filter((item) => item.format !== 'svg')) await verifyOutputFile(output, `Ofiyat Frame 4 output ${output.publicPath}`);
  const declaredMask = manifest.frame4.outputs.find((item) => item.publicPath === '/kayan/ofiyat/block-selector-mask.svg');
  if (!declaredMask || declaredMask.sha256 !== sha256(Buffer.from(maskBody)) || declaredMask.bytes !== Buffer.byteLength(maskBody) || declaredMask.format !== 'svg' || declaredMask.width !== 4096 || declaredMask.height !== 2359) throw new Error('Ofiyat production mask manifest is invalid');

  for (const asset of [...verifiedPublicPageAssets, ...legacyLocalAssets]) {
    const body = await inspectFile(publicDestination(asset.publicPath), `Ofiyat existing media ${asset.publicPath}`);
    if (sha256(body) !== asset.sha256) throw new Error(`Ofiyat existing media ${asset.publicPath} differs from its audited hash`);
    if ('format' in asset) {
      const metadata = await imageMetadata(body, `Ofiyat existing media ${asset.publicPath}`);
      if (body.length !== asset.bytes || metadata.format !== asset.format || metadata.width !== asset.width || metadata.height !== asset.height) throw new Error(`Ofiyat existing media ${asset.publicPath} differs from its audited dimensions/bytes`);
    }
  }

  const assetKeys = new Set();
  for (const asset of manifest.catalogAssets.assets) {
    const key = `${asset.kind}\u001f${asset.phaseSlug}\u001f${asset.sourceId ?? ''}`;
    if (assetKeys.has(key) || safeRemoteImageURL(asset.source.url, `Ofiyat manifest asset ${key}`) !== asset.source.url || !/^[a-f0-9]{64}$/.test(asset.source.sha256) || asset.source.bytes < 1024) throw new Error(`Ofiyat asset manifest contains invalid/duplicate provenance ${key}`);
    assetKeys.add(key);
    await verifyOutputFile(asset.output, `Ofiyat catalogue asset ${key}`);
  }
  const sidecar = JSON.parse(await readFile(floorSidecarPath, 'utf8'));
  validateOfiyatUnavailableFloorSidecar(sidecar, expectedCaptureProvenance.capturedAt);
  const manifestBody = canonicalJSON(manifest);
  const readme = await readFile(readmePath, 'utf8');
  assertPublicProvenancePrivacy(manifestBody, 'public/kayan/ofiyat/source/asset-manifest.json');
  assertPublicProvenancePrivacy(readme, 'public/kayan/ofiyat/source/README.md');
  if (readme !== renderReadme(manifest, manifestBody)) throw new Error('Ofiyat provenance README is stale');
  const privacyFilesVerified = await scanPublishedProvenancePrivacy({ includeDist });
  return {
    units: 585,
    available: catalog.projects.find((item) => item.project.slug === 'ofiyat').project.availableUnits,
    phaseImages: 3,
    representativeLayouts: 261,
    exactPlans: 0,
    floorSchemes: 0,
    floorHotspots: 0,
    privacyFilesVerified,
  };
}

async function build() {
  const [catalogBody, captureBody, sourceRender, sourceMask, sourceAnnotation, existingManifest] = await Promise.all([
    readFile(catalogPath),
    readFile(capturePath),
    inspectOriginalOrCopy(sourceRenderPath, '/kayan/ofiyat/source/frame-4-original.webp', 'Frame 4 WebP source'),
    inspectOriginalOrCopy(sourceMaskPath, '/kayan/ofiyat/source/frame-4-original.svg', 'Frame 4 SVG source'),
    inspectOriginalOrCopy(sourceAnnotationPath, '/kayan/ofiyat/source/block-annotation.png', 'Frame 4 annotation source'),
    loadExistingManifest(),
  ]);
  if (sha256(sourceRender) !== OFIYAT_SOURCE_RENDER_SHA256 || sha256(sourceMask) !== OFIYAT_SOURCE_MASK_SHA256 || sha256(sourceAnnotation) !== OFIYAT_SOURCE_ANNOTATION_SHA256) throw new Error('A Frame 4 original byte-copy hash changed');
  const catalog = JSON.parse(catalogBody.toString('utf8'));
  const capture = JSON.parse(captureBody.toString('utf8'));
  validateOfiyatCapture(capture);
  if (captureBody.length !== expectedCaptureProvenance.bytes || sha256(captureBody) !== expectedCaptureProvenance.sha256 || capture.capturedAt !== expectedCaptureProvenance.capturedAt) throw new Error('Ofiyat raw capture differs from its pinned local-audit provenance');
  const { specifications, localAssets } = collectAssetSpecifications(catalog, existingManifest);
  const stageRoot = await mkdtemp(resolve(tmpdir(), 'ofiyat-assets-stage-'));
  const entries = [];
  try {
    const renderMetadata = await imageMetadata(sourceRender, 'Frame 4 WebP source');
    const annotationMetadata = await imageMetadata(sourceAnnotation, 'Frame 4 annotation source');
    if (renderMetadata.format !== 'webp' || renderMetadata.width !== 4096 || renderMetadata.height !== 2359 || annotationMetadata.format !== 'png' || annotationMetadata.width !== 1862 || annotationMetadata.height !== 1126) throw new Error('Frame 4 raster source dimensions changed');
    const sourceSvg = sourceMask.toString('utf8');
    const productionMask = Buffer.from(buildOfiyatProductionMask(sourceSvg));
    validateOfiyatProductionMask(productionMask.toString('utf8'), sourceSvg);
    const mobile = await sharp(sourceRender, { limitInputPixels: 100_000_000 })
      .resize({ width: 1280, withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
      .webp({ quality: 92, effort: 6, smartSubsample: true })
      .toBuffer();
    const mobileMetadata = await imageMetadata(mobile, 'Frame 4 mobile derivative');
    if (mobileMetadata.format !== 'webp' || mobileMetadata.width !== 1280 || mobileMetadata.height !== 737) throw new Error('Frame 4 mobile derivative dimensions changed');

    const fixedBodies = [
      ['/kayan/ofiyat/source/frame-4-original.webp', sourceRender],
      ['/kayan/ofiyat/source/frame-4-original.svg', sourceMask],
      ['/kayan/ofiyat/source/block-annotation.png', sourceAnnotation],
      ['/kayan/ofiyat/frame-4-desktop.webp', sourceRender],
      ['/kayan/ofiyat/frame-4-mobile.webp', mobile],
      ['/kayan/ofiyat/block-selector-mask.svg', productionMask],
    ];
    for (const [publicPath, body] of fixedBodies) await stageBody(stageRoot, publicDestination(publicPath), body, entries);

    const catalogAssetRecords = new Array(specifications.length);
    let nextIndex = 0;
    const workers = Array.from({ length: 6 }, async () => {
      while (nextIndex < specifications.length) {
        const index = nextIndex++;
        const specification = specifications[index];
        const context = `Ofiyat ${specification.kind} ${specification.phaseSlug}/${specification.sourceId ?? 'phase'}`;
        const downloaded = await fetchImage(specification.sourceURL, context);
        const optimized = await optimizeOfficialImage(downloaded.body, context);
        await stageBody(stageRoot, publicDestination(specification.publicPath), optimized.body, entries);
        catalogAssetRecords[index] = {
          kind: specification.kind,
          phaseSlug: specification.phaseSlug,
          sourceId: specification.sourceId,
          source: {
            url: specification.sourceURL,
            contentType: downloaded.contentType,
            bytes: downloaded.body.length,
            sha256: sha256(downloaded.body),
            format: downloaded.metadata.format,
            width: downloaded.metadata.width,
            height: downloaded.metadata.height,
          },
          output: outputRecord(specification.publicPath, optimized.body, optimized.metadata),
        };
      }
    });
    await Promise.all(workers);

    const nextCatalog = applyOfiyatCaptureToCatalog(catalog, capture, localAssets);
    const floorSidecar = createOfiyatUnavailableFloorSidecar(capture.capturedAt);
    const manifest = {
      schemaVersion: 1,
      projectSlug: 'ofiyat',
      generatedAt: capture.capturedAt,
      capture: expectedCaptureProvenance,
      frame4: {
        coordinateSystem: { width: 4096, height: 2359, viewBox: '0 0 4096 2359' },
        inputs: [
          sourceRecord({ sourceLabel: sourceRenderLabel, publicPath: '/kayan/ofiyat/source/frame-4-original.webp', body: sourceRender, metadata: renderMetadata }),
          { sourceLabel: sourceMaskLabel, publicPath: '/kayan/ofiyat/source/frame-4-original.svg', bytes: sourceMask.length, sha256: sha256(sourceMask), format: 'svg', width: 4096, height: 2359 },
          sourceRecord({ sourceLabel: sourceAnnotationLabel, publicPath: '/kayan/ofiyat/source/block-annotation.png', body: sourceAnnotation, metadata: annotationMetadata }),
        ],
        blockPathMap: OFIYAT_BLOCK_PATH_MAP,
        outputs: [
          outputRecord('/kayan/ofiyat/frame-4-desktop.webp', sourceRender, renderMetadata),
          outputRecord('/kayan/ofiyat/frame-4-mobile.webp', mobile, mobileMetadata),
          { publicPath: '/kayan/ofiyat/block-selector-mask.svg', bytes: productionMask.length, sha256: sha256(productionMask), format: 'svg', width: 4096, height: 2359 },
        ],
      },
      publicPageAssets: verifiedPublicPageAssets,
      productionCatalog: {
        projectSlug: 'ofiyat',
        unitCount: 585,
        bundleSha256: sha256(canonicalJSON(nextCatalog.projects.find((item) => item.project.slug === 'ofiyat'))),
      },
      catalogAssets: {
        phaseImageCount: 3,
        representativeLayoutCount: 261,
        exactUnitPlanCount: 0,
        assets: catalogAssetRecords,
      },
    };
    validateFreshOfiyatCatalog(nextCatalog, capture, manifest);
    validatePublishedOfiyatCatalog(nextCatalog, manifest);
    validateOfiyatUnavailableFloorSidecar(floorSidecar, capture.capturedAt);
    const manifestBody = canonicalJSON(manifest);
    const readmeBody = Buffer.from(renderReadme(manifest, manifestBody));
    assertPublicProvenancePrivacy(manifestBody, 'staged Ofiyat asset-manifest.json');
    assertPublicProvenancePrivacy(readmeBody, 'staged Ofiyat README.md');
    await stageBody(stageRoot, catalogPath, canonicalJSON(nextCatalog), entries);
    await stageBody(stageRoot, floorSidecarPath, canonicalJSON(floorSidecar), entries);
    await stageBody(stageRoot, manifestPath, manifestBody, entries);
    await stageBody(stageRoot, readmePath, readmeBody, entries);

    if (sha256(await readFile(catalogPath)) !== sha256(catalogBody)) throw new Error('website/data/kayan-catalog.json changed during Ofiyat staging; refusing to overwrite concurrent work');
    await commitTransaction(entries);
    const summary = await verifyEverything({ catalog: nextCatalog, manifest, sourceRender, sourceMask, sourceAnnotation, includeDist: false });
    console.log(JSON.stringify({ mode: 'build', ...summary }, null, 2));
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

async function check() {
  const [catalogBody, manifestBody, sourceRender, sourceMask, sourceAnnotation] = await Promise.all([
    readFile(catalogPath),
    readFile(manifestPath),
    inspectFile(publicDestination('/kayan/ofiyat/source/frame-4-original.webp'), 'Frame 4 WebP local byte-copy'),
    inspectFile(publicDestination('/kayan/ofiyat/source/frame-4-original.svg'), 'Frame 4 SVG local byte-copy'),
    inspectFile(publicDestination('/kayan/ofiyat/source/block-annotation.png'), 'Frame 4 annotation local byte-copy'),
  ]);
  if (sha256(sourceRender) !== OFIYAT_SOURCE_RENDER_SHA256 || sha256(sourceMask) !== OFIYAT_SOURCE_MASK_SHA256 || sha256(sourceAnnotation) !== OFIYAT_SOURCE_ANNOTATION_SHA256) throw new Error('A Frame 4 original byte-copy hash changed');
  const catalog = JSON.parse(catalogBody.toString('utf8'));
  const manifest = JSON.parse(manifestBody.toString('utf8'));
  if (!manifestBody.equals(canonicalJSON(manifest))) throw new Error('Ofiyat asset manifest is not canonical JSON');
  const summary = await verifyEverything({ catalog, manifest, sourceRender, sourceMask, sourceAnnotation, includeDist: true });
  console.log(JSON.stringify({ mode: 'check', ...summary }, null, 2));
}

async function auditCapture() {
  const [catalogBody, captureBody, manifestBody] = await Promise.all([
    readFile(catalogPath),
    readFile(capturePath),
    readFile(manifestPath),
  ]);
  const catalog = JSON.parse(catalogBody.toString('utf8'));
  const capture = JSON.parse(captureBody.toString('utf8'));
  const manifest = JSON.parse(manifestBody.toString('utf8'));
  validateOfiyatCapture(capture);
  if (captureBody.length !== expectedCaptureProvenance.bytes || sha256(captureBody) !== expectedCaptureProvenance.sha256 || capture.capturedAt !== expectedCaptureProvenance.capturedAt) throw new Error('Ofiyat raw capture differs from its pinned local-audit provenance');
  validateFreshOfiyatCatalog(catalog, capture, manifest);
  validatePublishedOfiyatCatalog(catalog, manifest);
  console.log(JSON.stringify({ mode: 'audit-capture', units: 585, captureSha256: expectedCaptureProvenance.sha256 }, null, 2));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await (checkOnly ? check() : auditCaptureOnly ? auditCapture() : build());
