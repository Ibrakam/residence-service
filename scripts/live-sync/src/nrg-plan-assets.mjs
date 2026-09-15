import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const nrgPlanVariants = Object.freeze([1600, 400, 200]);

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const acceptedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const acceptedGenericMimeTypes = new Set(['application/octet-stream', 'binary/octet-stream']);
const maximumAssetBytes = 8 * 1024 * 1024;
const minimumAssetBytes = new Map([['original', 100_000], [1600, 40_000], [400, 4_000], [200, 1_500]]);
const detailUrl = 'https://apigw.bi.group/sales-picker/microfe-v3/placement';

function text(value, label) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is empty`);
  return result;
}

function uuid(value, label) {
  const result = text(value, label);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw new Error(`${label} is not a UUID`);
  }
  return result;
}

export function expectedNrgPlanUrl(row, variant) {
  if (!nrgPlanVariants.includes(variant)) throw new Error(`Unsupported NRG plan variant ${variant}`);
  const blockId = uuid(row?.blockId, 'NRG plan blockId');
  const unitId = uuid(row?.uuid, 'NRG plan unit UUID');
  const number = text(row?.name, 'NRG plan unit number');
  return `https://s3.bi.group/crm-clients-e1csales/layouts/${blockId}/${unitId}/${encodeURIComponent(number)}_${variant}.png`;
}

export function expectedNrgOriginalUrl(row) {
  const blockId = uuid(row?.blockId, 'NRG original blockId');
  const unitId = uuid(row?.uuid, 'NRG original unit UUID');
  const number = text(row?.name, 'NRG original unit number');
  return `https://s3.bi.group/crm-clients-e1csales/layouts/${blockId}/${unitId}/${encodeURIComponent(number)}.png`;
}

export function validateNrgOriginalUrl(row, value) {
  const expected = expectedNrgOriginalUrl(row);
  if (typeof value !== 'string' || value !== expected) throw new Error('NRG original plan URL is not bound to its block, unit and number');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 's3.bi.group' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error('NRG original plan URL failed the exact origin allowlist');
  }
  return value;
}

export function validateNrgPlanUrl(row, variant, value) {
  const expected = expectedNrgPlanUrl(row, variant);
  if (typeof value !== 'string' || value !== expected) throw new Error(`NRG ${variant} plan URL is not bound to its block, unit and number`);
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 's3.bi.group' || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error(`NRG ${variant} plan URL failed the exact origin allowlist`);
  }
  return value;
}

function jpegMetadata(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff
    || buffer.lastIndexOf(Buffer.from([0xff, 0xd9])) !== buffer.length - 2) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 7) break;
      return { mimeType: 'image/jpeg', width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function pngMetadata(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  let offset = 8;
  let ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    if (length > maximumAssetBytes || offset + 12 + length > buffer.length) return null;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    offset += 12 + length;
    if (type === 'IEND') { ended = length === 0 && offset === buffer.length; break; }
  }
  if (!ended) return null;
  return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function webpMetadata(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return {
      mimeType: 'image/webp',
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }
  if (chunk === 'VP8L' && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { mimeType: 'image/webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
    return { mimeType: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

export function imageMetadata(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('Image body must be a Buffer');
  const metadata = jpegMetadata(buffer) ?? pngMetadata(buffer) ?? webpMetadata(buffer);
  if (!metadata || metadata.width <= 0 || metadata.height <= 0) throw new Error('NRG plan body is not a supported, dimensioned image');
  return metadata;
}

export function nrgPlanAssetGeometryValid(variant, { width, height, bytes }) {
  if (!['original', ...nrgPlanVariants].includes(variant)
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(bytes)
    || width <= 0 || height <= 0 || bytes < minimumAssetBytes.get(variant) || bytes > maximumAssetBytes) return false;
  const ratio = width / height;
  if (ratio < 1.3 || ratio > 1.55) return false;
  return variant === 'original'
    ? width >= 3000 && width <= 5000 && height >= 2000 && height <= 4000
    : width === variant;
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function reusableAuditUnit(row, unit) {
  if (!unit || typeof unit !== 'object' || Array.isArray(unit)
    || String(unit.unitId) !== String(row.uuid)
    || String(unit.blockId) !== String(row.blockId)
    || String(unit.number) !== String(row.name)
    || typeof unit.validatedAt !== 'string' || !Number.isFinite(Date.parse(unit.validatedAt))
    || !unit.original || unit.original.ok !== true || unit.original.variant !== 'original'
    || unit.original.status !== 200 || unit.original.url !== expectedNrgOriginalUrl(row)
    || !['application/octet-stream', 'image/png'].includes(unit.original.declaredMimeType)
    || unit.original.mimeType !== 'image/png' || !nrgPlanAssetGeometryValid('original', unit.original)
    || !validHash(unit.original.sha256) || unit.selectedOriginalUrl !== expectedNrgOriginalUrl(row)
    || !Array.isArray(unit.variants) || unit.variants.length !== nrgPlanVariants.length) return false;
  const variants = new Map(unit.variants.map((asset) => [asset?.variant, asset]));
  return nrgPlanVariants.every((variant) => {
    const asset = variants.get(variant);
    const expected = expectedNrgPlanUrl(row, variant);
    return row?.[`photoURL${variant}`] === expected
      && asset?.ok === true && asset.status === 200 && asset.url === expected
      && asset.declaredMimeType === 'image/jpeg' && asset.mimeType === 'image/jpeg'
      && nrgPlanAssetGeometryValid(variant, asset) && validHash(asset.sha256);
  });
}

/**
 * NRG layout URLs include block UUID, placement UUID and unit number and are
 * treated as immutable object identities. Reuse only a complete audit that is
 * still bound to those exact current placementList fields. Any new/changed or
 * previously invalid row is fetched again.
 */
export function reusableNrgPlanAuditUnits(rows, previousAudit) {
  const reusable = new Map();
  if (!previousAudit || typeof previousAudit !== 'object' || Array.isArray(previousAudit)
    || previousAudit.schemaVersion !== 1 || previousAudit.projectSlug !== '4u'
    || !Array.isArray(previousAudit.units)) return reusable;
  const previousById = new Map(previousAudit.units.map((unit) => [String(unit?.unitId ?? ''), unit]));
  for (const row of rows.filter((item) => item?.isSale === true)) {
    const unit = previousById.get(String(row.uuid));
    try {
      if (reusableAuditUnit(row, unit)) reusable.set(String(row.uuid), unit);
    } catch {
      // A malformed cached identity is a cache miss, never a reason to trust it.
    }
  }
  return reusable;
}

async function boundedResponseBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maximumAssetBytes) {
      await reader.cancel();
      throw new Error('response exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, bytes);
}

async function fetchAsset(url, { fetchImpl, attempts, timeoutMs, allowGenericMime = false }) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { accept: 'image/jpeg,image/png,image/webp', 'user-agent': 'Residence live-sync/1.0' },
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if (retryableStatuses.has(response.status) && attempt < attempts) {
          await delay(250 * attempt);
          continue;
        }
        return { status: response.status, error: `HTTP ${response.status}` };
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > maximumAssetBytes) return { status: response.status, error: 'response exceeds size limit' };
      const buffer = await boundedResponseBody(response);
      if (buffer.length === 0 || buffer.length > maximumAssetBytes) return { status: response.status, error: 'response size is invalid' };
      if (Number.isFinite(declaredLength) && declaredLength >= 0 && declaredLength !== buffer.length) return { status: response.status, error: 'content-length mismatch' };
      const metadata = imageMetadata(buffer);
      const declaredMimeType = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if ((!acceptedMimeTypes.has(declaredMimeType) && !(allowGenericMime && acceptedGenericMimeTypes.has(declaredMimeType)))
        || (acceptedMimeTypes.has(declaredMimeType) && declaredMimeType !== metadata.mimeType)) {
        return { status: response.status, error: 'declared MIME does not match image bytes' };
      }
      return {
        status: response.status,
        declaredMimeType,
        mimeType: metadata.mimeType,
        bytes: buffer.length,
        width: metadata.width,
        height: metadata.height,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        buffer,
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(250 * attempt);
    }
  }
  return { status: lastStatus, error: lastError instanceof Error ? lastError.message || lastError.name : 'network error' };
}

async function fetchDetail(row, { fetchImpl, attempts, timeoutMs }) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(detailUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'Residence live-sync/1.0' },
        body: JSON.stringify({ placementUUID: row.uuid }),
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      if (!response.ok) {
        if (retryableStatuses.has(response.status) && attempt < attempts) {
          await delay(250 * attempt);
          continue;
        }
        return { unitId: row.uuid, status: response.status, url: null, error: `HTTP ${response.status}` };
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > 2 * 1024 * 1024) return { unitId: row.uuid, status: response.status, url: null, error: 'detail response exceeds size limit' };
      const body = await response.text();
      if (Buffer.byteLength(body) > 2 * 1024 * 1024) return { unitId: row.uuid, status: response.status, url: null, error: 'detail response exceeds size limit' };
      const mimeType = String(response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
      if (mimeType !== 'application/json') return { unitId: row.uuid, status: response.status, url: null, error: 'detail response is not JSON' };
      const value = JSON.parse(body);
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || String(value.placementUUID) !== String(row.uuid)
        || String(value.realEstateUUID) !== String(row.realEstateUUID)
        || String(value.blockId) !== String(row.blockId)
        || String(value.placementName) !== String(row.name)
        || String(value.propertyType?.uuid) !== String(row.propertyType?.uuid)) {
        return { unitId: row.uuid, status: response.status, url: null, error: 'detail identity does not match placementList' };
      }
      let url;
      try { url = validateNrgOriginalUrl(row, value.photoURL1600); }
      catch (error) { return { unitId: row.uuid, status: response.status, url: null, error: error instanceof Error ? error.message : String(error) }; }
      return { unitId: row.uuid, status: response.status, url };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(250 * attempt);
    }
  }
  return { unitId: row.uuid, status: lastStatus, url: null, error: lastError instanceof Error ? lastError.name : 'network error' };
}

export async function fetchNrgPlanDetails(rows, {
  fetchImpl = fetch,
  concurrency = 10,
  attempts = 3,
  timeoutMs = 30_000,
} = {}) {
  if (!Array.isArray(rows)) throw new Error('NRG detail rows must be an array');
  const activeRows = rows.filter((row) => row?.isSale === true);
  const details = await pool(activeRows, concurrency, (row) => fetchDetail(row, { fetchImpl, attempts, timeoutMs }));
  return new Map(details.map((item) => [item.unitId, item]));
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  const output = new Array(items.length);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

function duplicateGroups(units, variant) {
  const byHash = new Map();
  for (const unit of units) {
    const asset = unit.variants.find((item) => item.variant === variant);
    if (!asset?.ok) continue;
    byHash.set(asset.sha256, [...(byHash.get(asset.sha256) ?? []), unit.unitId]);
  }
  return [...byHash.entries()]
    .filter(([, unitIds]) => unitIds.length > 1)
    .map(([sha256, unitIds]) => ({ variant, sha256, unitIds }))
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
}

/**
 * Audits the high-resolution suffixless 4U original from placement detail and
 * every list variant. Only the validated detail original is selected for
 * publication. If it is unavailable, normalization omits the new URL so the
 * backend importer's COALESCE policy retains its last-known-good URL.
 */
export async function auditNrgPlanAssets(rows, {
  capturedAt = new Date().toISOString(),
  fetchImpl = fetch,
  concurrency = 10,
  attempts = 3,
  timeoutMs = 30_000,
  retainOriginals = false,
  originalSources = new Map(),
  reusedUnits = new Map(),
} = {}) {
  if (!Array.isArray(rows)) throw new Error('NRG plan rows must be an array');
  const activeRows = rows.filter((row) => row?.isSale === true);
  const ids = new Set();
  for (const row of activeRows) {
    const id = uuid(row?.uuid, 'NRG active unit UUID');
    if (ids.has(id)) throw new Error(`NRG plan audit has duplicate unit ${id}`);
    ids.add(id);
  }

  const jobs = activeRows.filter((row) => !reusedUnits.has(String(row.uuid)))
    .flatMap((row) => [{ row, variant: 'original' }, ...nrgPlanVariants.map((variant) => ({ row, variant }))]);
  const results = await pool(jobs, concurrency, async ({ row, variant }) => {
    const original = variant === 'original';
    const field = original ? null : `photoURL${variant}`;
    let url;
    try {
      url = original
        ? validateNrgOriginalUrl(row, originalSources.get(row.uuid)?.url)
        : validateNrgPlanUrl(row, variant, row?.[field]);
    } catch (error) {
      const source = original ? originalSources.get(row.uuid) : null;
      return { unitId: String(row?.uuid ?? ''), variant, url: original ? source?.url ?? null : (typeof row?.[field] === 'string' ? row[field] : null), status: source?.status ?? null, ok: false, error: source?.error ?? (error instanceof Error ? error.message : String(error)) };
    }
    const fetched = await fetchAsset(url, { fetchImpl, attempts, timeoutMs, allowGenericMime: original });
    const geometryMatches = nrgPlanAssetGeometryValid(variant, fetched);
    const ok = fetched.status === 200 && !fetched.error && geometryMatches;
    return {
      unitId: row.uuid,
      variant,
      url,
      status: fetched.status,
      ok,
      ...(fetched.mimeType ? { mimeType: fetched.mimeType } : {}),
      ...(fetched.declaredMimeType ? { declaredMimeType: fetched.declaredMimeType } : {}),
      ...(fetched.bytes ? { bytes: fetched.bytes } : {}),
      ...(fetched.width ? { width: fetched.width, height: fetched.height } : {}),
      ...(fetched.sha256 ? { sha256: fetched.sha256 } : {}),
      ...(!ok ? { error: fetched.error ?? `image geometry/size is outside the ${variant} policy (${fetched.width ?? 'unknown'}×${fetched.height ?? 'unknown'}, ${fetched.bytes ?? 'unknown'} bytes)` } : {}),
      ...(retainOriginals && original && ok ? { buffer: fetched.buffer } : {}),
    };
  });

  const resultByUnit = new Map();
  for (const result of results) resultByUnit.set(result.unitId, [...(resultByUnit.get(result.unitId) ?? []), result]);
  const originals = new Map();
  const units = activeRows.map((row) => {
    const reused = reusedUnits.get(String(row.uuid));
    if (reused) return structuredClone(reused);
    const resultsForUnit = resultByUnit.get(row.uuid) ?? [];
    const original = resultsForUnit.find((item) => item.variant === 'original');
    const variants = resultsForUnit.filter((item) => item.variant !== 'original').sort((left, right) => right.variant - left.variant);
    if (retainOriginals && original?.buffer) originals.set(row.uuid, original.buffer);
    const { buffer: originalBuffer, ...serializableOriginal } = original ?? {};
    const serializableVariants = variants.map(({ buffer, ...item }) => item);
    return {
      unitId: row.uuid,
      blockId: row.blockId,
      number: String(row.name),
      validatedAt: capturedAt,
      original: serializableOriginal,
      variants: serializableVariants,
      selectedOriginalUrl: original?.ok && variants.find((item) => item.variant === 1600)?.ok ? original.url : null,
    };
  });
  const verifiedOriginals = units.filter((unit) => unit.original?.ok).length;
  const publishablePlans = units.filter((unit) => unit.selectedOriginalUrl).length;
  const variants = Object.fromEntries(['original', ...nrgPlanVariants].map((variant) => {
    const assets = units.map((unit) => variant === 'original' ? unit.original : unit.variants.find((item) => item.variant === variant)).filter(Boolean);
    return [String(variant), {
      attempted: assets.length,
      valid: assets.filter((asset) => asset.ok).length,
      invalid: assets.filter((asset) => !asset.ok).length,
    }];
  }));
  const originalDuplicates = (() => {
    const byHash = new Map();
    for (const unit of units) if (unit.original?.ok) byHash.set(unit.original.sha256, [...(byHash.get(unit.original.sha256) ?? []), unit.unitId]);
    return [...byHash.entries()].filter(([, unitIds]) => unitIds.length > 1).map(([sha256, unitIds]) => ({ variant: 'original', sha256, unitIds }));
  })();
  const duplicates = [...originalDuplicates, ...nrgPlanVariants.flatMap((variant) => duplicateGroups(units, variant))];
  const audit = {
    schemaVersion: 1,
    projectSlug: '4u',
    capturedAt,
    activeUnitCount: activeRows.length,
    auditedUnitCount: units.length,
    verifiedOriginals,
    missingOriginals: activeRows.length - verifiedOriginals,
    publishablePlans,
    variants,
    duplicateGroups: duplicates,
    selectionPolicy: 'publish only when the suffixless detail original and 1600px card preview both pass exact URL, MIME, byte and dimension validation',
    lastKnownGoodPolicy: 'omit a plan when its current original or card preview is invalid so the importer retains the existing non-empty plan URL',
    units,
  };
  return { audit, originals };
}

export async function refreshNrgPlanAssets(rows, {
  capturedAt = new Date().toISOString(),
  previousAudit = null,
  fetchImpl = fetch,
  concurrency = 10,
  attempts = 3,
  timeoutMs = 30_000,
} = {}) {
  if (!Array.isArray(rows)) throw new Error('NRG plan rows must be an array');
  const activeRows = rows.filter((row) => row?.isSale === true);
  const reusedUnits = reusableNrgPlanAuditUnits(activeRows, previousAudit);
  const rowsToRefresh = activeRows.filter((row) => !reusedUnits.has(String(row.uuid)));
  const originalSources = await fetchNrgPlanDetails(rowsToRefresh, { fetchImpl, concurrency, attempts, timeoutMs });
  const result = await auditNrgPlanAssets(activeRows, {
    capturedAt,
    fetchImpl,
    concurrency,
    attempts,
    timeoutMs,
    originalSources,
    reusedUnits,
  });
  const refreshedIds = new Set(rowsToRefresh.map((row) => String(row.uuid)));
  const downloadedAssetBytes = result.audit.units
    .filter((unit) => refreshedIds.has(String(unit.unitId)))
    .flatMap((unit) => [unit.original, ...unit.variants])
    .reduce((sum, asset) => sum + (Number.isSafeInteger(asset?.bytes) ? asset.bytes : 0), 0);
  result.audit.refresh = {
    cachePolicy: 'reuse a complete validated audit while its exact block/unit/number asset URLs are unchanged',
    reusedUnits: reusedUnits.size,
    refreshedUnits: rowsToRefresh.length,
    detailRequests: rowsToRefresh.length,
    assetRequests: rowsToRefresh.length * (1 + nrgPlanVariants.length),
    downloadedAssetBytes,
  };
  return result;
}
