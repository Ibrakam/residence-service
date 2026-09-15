import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { makeBodyRecord } from './capture.mjs';
import { mergeNrgBlockRegistries, nrgBiSeedBlockRegistry, normalizeNrgBlockRegistry } from './nrg-block-registry.mjs';
import { refreshNrgPlanAssets } from './nrg-plan-assets.mjs';

const MBC_ENDPOINT = 'https://mbc.uz/api/plans';
const NRG_BASE = 'https://apigw.bi.group/sales-picker/microfe-v3';
const SUN_EMBED = 'https://api.macroserver.uz/estate/embedjs/?domain=human2human.uz';
const SUN_CANONICAL_CATALOG = 'https://api.macroserver.uz/estate/catalog/';
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 65_000;

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is not an object`);
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(assertObject(value, label)).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} keys changed (expected ${wanted.join(', ')}, observed ${actual.join(', ')})`);
  }
}

function assertExactUrl(value, { host, path, queryKeys = [] }, label) {
  const url = new URL(value);
  const actualQueryKeys = [...url.searchParams.keys()].sort();
  const expectedQueryKeys = [...queryKeys].sort();
  if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || url.pathname !== path) {
    throw new Error(`${label} URL failed the exact host/path allowlist`);
  }
  if (actualQueryKeys.length !== expectedQueryKeys.length || actualQueryKeys.some((key, index) => key !== expectedQueryKeys[index])) {
    throw new Error(`${label} URL query-key allowlist changed`);
  }
  return url;
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get('retry-after')?.trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Math.min(Number(value) * 1_000, MAX_RETRY_AFTER_MS);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(timestamp - Date.now(), 0), MAX_RETRY_AFTER_MS);
}

async function request({ label, url, method = 'GET', headers = {}, body = null, attempts = 4, timeoutMs = 60_000 }) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let retryDelayMs = 250 * attempt;
    try {
      const response = await fetch(url, {
        method,
        headers: { accept: 'application/json, text/plain, */*', 'user-agent': 'Residence live-sync/1.0', ...headers },
        body,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs),
      });
      lastStatus = response.status;
      if (response.ok) return response;
      if (response.status === 429) retryDelayMs = retryAfterMilliseconds(response) ?? retryDelayMs;
      await response.body?.cancel();
      if (!RETRYABLE.has(response.status) || attempt === attempts) break;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await delay(retryDelayMs);
  }
  throw new Error(`${label} failed${lastStatus ? ` with HTTP ${lastStatus}` : `: ${lastError instanceof Error ? lastError.name : 'network error'}`}`);
}

async function jsonResponse(options) {
  const response = await request(options);
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${options.label} returned non-JSON content`); }
  return { response, text, value };
}

function recordResponse(records, { id, canonicalUrl, scope, result }) {
  records.push(makeBodyRecord({
    id,
    method: 'POST',
    url: canonicalUrl,
    status: result.response.status,
    mimeType: result.response.headers.get('content-type') || 'application/json',
    text: result.text,
    capturedAt: new Date().toISOString(),
    scope,
  }));
}

function recordDerivedJson(records, { id, canonicalUrl, scope, value, capturedAt }) {
  records.push(makeBodyRecord({
    id,
    method: 'DERIVED',
    url: canonicalUrl,
    status: 200,
    mimeType: 'application/json',
    text: JSON.stringify(value),
    capturedAt,
    scope: { ...scope, derived: true },
  }));
}

function mbcPlansBody(project, page, propertyType = 'residential') {
  if (!Number.isSafeInteger(project?.id) || project.id <= 0 || typeof project.slug !== 'string' || !project.slug) {
    throw new Error('MBC project definition is invalid');
  }
  if (!Number.isSafeInteger(page) || page <= 0) throw new Error(`MBC ${project.slug} page is invalid`);
  if (!['residential', 'commercial'].includes(propertyType)) throw new Error(`MBC ${project.slug} property type is invalid`);
  const values = { project: String(project.id), type: propertyType, page: String(page) };
  exactKeys(values, ['page', 'project', 'type'], `MBC ${project.slug} request`);
  return new URLSearchParams(values);
}

async function captureMbc(provider, records) {
  if (!Array.isArray(provider.projectDefinitions) || provider.projectDefinitions.length === 0) {
    throw new Error('MBC provider has no project definitions');
  }
  for (const project of provider.projectDefinitions) {
    for (const propertyType of ['residential', 'commercial']) {
      let total = null;
      let lastPage = null;
      for (let page = 1; page <= 100; page += 1) {
        const form = mbcPlansBody(project, page, propertyType);
        const result = await jsonResponse({
          label: `MBC ${project.slug} ${propertyType} plans page ${page}`,
          url: MBC_ENDPOINT,
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'x-requested-with': 'XMLHttpRequest',
          },
          body: form.toString(),
        });
        const plans = assertObject(result.value?.plans, `MBC ${project.slug} page ${page}.plans`);
        if (!Array.isArray(plans.data)) throw new Error(`MBC ${project.slug} page ${page}.plans.data is not an array`);
        if (Number(plans.current_page) !== page) throw new Error(`MBC ${project.slug} page ${page} current_page mismatch`);
        if (!Number.isSafeInteger(Number(plans.total)) || Number(plans.total) < 0) throw new Error(`MBC ${project.slug} ${propertyType} page ${page} total is invalid`);
        if (!Number.isSafeInteger(Number(plans.last_page)) || Number(plans.last_page) <= 0) throw new Error(`MBC ${project.slug} page ${page} last_page is invalid`);
        total ??= Number(plans.total);
        lastPage ??= Number(plans.last_page);
        if (Number(plans.total) !== total || Number(plans.last_page) !== lastPage) {
          throw new Error(`MBC ${project.slug} ${propertyType} pagination declaration changed during capture`);
        }
        recordResponse(records, {
          id: `mbc-${project.slug}-${propertyType}-plans-${page}`,
          canonicalUrl: MBC_ENDPOINT,
          scope: { projectSlug: project.slug, projectId: project.id, propertyType, endpoint: 'plans', page },
          result,
        });
        if (page === lastPage) break;
        if (page === 100) throw new Error(`MBC ${project.slug} pagination exceeded the safety limit`);
      }
    }
  }
}

function nrgPlacementBody(provider, project, pageNo) {
  const body = {
    pageNo,
    pageSize: provider.pageSize,
    companyIds: [provider.companyUUID],
    realEstateUUIDs: [project.realEstateUUID],
    propertyTypes: [provider.apartmentPropertyTypeUUID],
    filterTags: {},
  };
  exactKeys(body, ['companyIds', 'filterTags', 'pageNo', 'pageSize', 'propertyTypes', 'realEstateUUIDs'], 'NRG placementList request');
  return body;
}

function nrgEstateBody(provider, project) {
  const body = { pageNo: 1, pageSize: 300, companyIds: [provider.companyUUID], realEstateUUIDs: [project.realEstateUUID] };
  exactKeys(body, ['companyIds', 'pageNo', 'pageSize', 'realEstateUUIDs'], 'NRG realEstateList request');
  return body;
}

function nrgUUID(value, label) {
  const id = String(value ?? '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${label} is not a UUID`);
  }
  return id;
}

function nrgBlockMatrixBody(blockId) {
  const id = nrgUUID(blockId, 'NRG blockMatrix blockId');
  const body = { blockId: id };
  exactKeys(body, ['blockId'], 'NRG blockMatrix request');
  return body;
}

function nrgMatrixPlacementCount(value, label, maximum) {
  const matrix = assertObject(value, label);
  if (!Array.isArray(matrix.entrances)) throw new Error(`${label}.entrances is not an array`);
  let count = 0;
  for (const [entranceIndex, entranceValue] of matrix.entrances.entries()) {
    const entrance = assertObject(entranceValue, `${label}.entrances[${entranceIndex}]`);
    if (!Array.isArray(entrance.floors)) throw new Error(`${label}.entrances[${entranceIndex}].floors is not an array`);
    for (const [floorIndex, floorValue] of entrance.floors.entries()) {
      const floor = assertObject(floorValue, `${label}.entrances[${entranceIndex}].floors[${floorIndex}]`);
      if (!Array.isArray(floor.placements)) throw new Error(`${label}.entrances[${entranceIndex}].floors[${floorIndex}].placements is not an array`);
      count += floor.placements.length;
      if (count > maximum) throw new Error(`${label} exceeded the placement safety limit ${maximum}`);
    }
  }
  return count;
}

function nrgMatrixRows(values, label) {
  const rows = [];
  for (const [matrixIndex, value] of values.entries()) {
    const matrix = assertObject(value, `${label} matrix ${matrixIndex + 1}`);
    if (!Array.isArray(matrix.entrances)) throw new Error(`${label} matrix ${matrixIndex + 1}.entrances is not an array`);
    for (const entrance of matrix.entrances) {
      if (!Array.isArray(entrance?.floors)) throw new Error(`${label} matrix ${matrixIndex + 1} has invalid floors`);
      for (const floor of entrance.floors) {
        if (!Array.isArray(floor?.placements)) throw new Error(`${label} matrix ${matrixIndex + 1} has invalid placements`);
        rows.push(...floor.placements);
      }
    }
  }
  return rows;
}

function nrgConsistencyAudit(matrixValues, placements, apartmentPropertyTypeUUID, label = 'NRG') {
  if (!Array.isArray(matrixValues) || !Array.isArray(placements)) throw new Error(`${label} consistency inputs are invalid`);
  const matrixById = new Map();
  const matrixFree = new Set();
  for (const [index, row] of nrgMatrixRows(matrixValues, label).entries()) {
    if (row?.propertyTypeUUID !== apartmentPropertyTypeUUID) continue;
    const id = nrgUUID(row?.placementUUID, `${label} matrix apartment ${index + 1}.placementUUID`);
    if (matrixById.has(id)) throw new Error(`${label} matrix duplicates apartment ${id}`);
    const lifecycle = String(row?.placementUIStatus ?? '');
    if (!['FREE', 'BOOKED', 'SOLD'].includes(lifecycle) || typeof row?.isSale !== 'boolean' || row.isSale !== (lifecycle === 'FREE')) {
      throw new Error(`${label} matrix apartment ${id} has invalid lifecycle fields`);
    }
    matrixById.set(id, row);
    if (lifecycle === 'FREE') matrixFree.add(id);
  }
  const listed = new Set();
  const listedFree = new Set();
  let missingListedFromMatrix = 0;
  let duplicatePlacementListCount = 0;
  for (const [index, row] of placements.entries()) {
    const id = nrgUUID(row?.uuid, `${label} placementList row ${index + 1}.uuid`);
    if (listed.has(id)) {
      duplicatePlacementListCount += 1;
      continue;
    }
    listed.add(id);
    if (row?.propertyType?.uuid !== apartmentPropertyTypeUUID || typeof row?.isSale !== 'boolean') {
      throw new Error(`${label} placementList apartment ${id} has invalid scope fields`);
    }
    if (row.isSale) listedFree.add(id);
    const matrixRow = matrixById.get(id);
    if (!matrixRow) {
      missingListedFromMatrix += 1;
      continue;
    }
  }
  let freeMissingFromList = 0;
  for (const id of matrixFree) if (!listedFree.has(id)) {
    freeMissingFromList += 1;
  }
  let staleListingCount = 0;
  for (const id of listedFree) if (!matrixFree.has(id) && matrixById.has(id)) staleListingCount += 1;
  const staleListingLimit = Math.min(25, Math.ceil(matrixById.size * 0.01));
  const hardMismatch = freeMissingFromList > 0 || missingListedFromMatrix > 0 || duplicatePlacementListCount > 0;
  return {
    exact: !hardMismatch && staleListingCount === 0,
    acceptable: !hardMismatch && staleListingCount <= staleListingLimit,
    matrixFreeCount: matrixFree.size,
    placementListFreeCount: listedFree.size,
    freeMissingFromList,
    missingListedFromMatrix,
    duplicatePlacementListCount,
    staleListingCount,
    staleListingLimit,
    matrixFreeIds: matrixFree,
  };
}

async function nrgConsistentSnapshot(captureAttempt, {
  slug,
  apartmentPropertyTypeUUID,
  attempts = 3,
  retryDelayMs = 250,
  wait = delay,
} = {}) {
  if (typeof captureAttempt !== 'function' || !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) {
    throw new Error(`NRG ${slug ?? '(unknown)'} consistency retry configuration is invalid`);
  }
  let lastAudit = null;
  let acceptableSnapshot = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const snapshot = await captureAttempt(attempt);
    lastAudit = nrgConsistencyAudit(
      snapshot.matrixResponses.map(({ result }) => result.value),
      snapshot.placements,
      apartmentPropertyTypeUUID,
      `NRG ${slug}`,
    );
    if (lastAudit.exact) return { ...snapshot, consistencyAttempt: attempt, consistencyAudit: lastAudit };
    if (lastAudit.acceptable) acceptableSnapshot = { ...snapshot, consistencyAttempt: attempt, consistencyAudit: lastAudit };
    if (attempt < attempts) await wait(retryDelayMs * attempt);
  }
  if (acceptableSnapshot) return acceptableSnapshot;
  throw new Error(
    `NRG ${slug} inventory changed during ${attempts} bounded snapshot attempts `
    + `(matrix FREE ${lastAudit.matrixFreeCount}, placementList FREE ${lastAudit.placementListFreeCount}, `
    + `missing-list ${lastAudit.freeMissingFromList}, missing-matrix ${lastAudit.missingListedFromMatrix}, `
    + `duplicate-list ${lastAudit.duplicatePlacementListCount}, stale-active ${lastAudit.staleListingCount}/${lastAudit.staleListingLimit})`,
  );
}

async function nrgPost(endpoint, body, label) {
  if (!['placementList', 'realEstateList', 'blockMatrix'].includes(endpoint)) throw new Error('NRG endpoint is outside the allowlist');
  const url = `${NRG_BASE}/${endpoint}`;
  assertExactUrl(url, { host: 'apigw.bi.group', path: `/sales-picker/microfe-v3/${endpoint}` }, label);
  return jsonResponse({
    label,
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function captureNrgBi(provider, records, { planAssetCache = null, blockRegistry = nrgBiSeedBlockRegistry } = {}) {
  const trustedRegistry = mergeNrgBlockRegistries(nrgBiSeedBlockRegistry, normalizeNrgBlockRegistry(blockRegistry));
  const registryCandidate = {
    schemaVersion: 1,
    provider: 'nrg-bi',
    source: `${NRG_BASE}/realEstateList`,
    reviewedAt: new Date().toISOString(),
    projects: {},
  };
  for (const project of provider.projectDefinitions) {
    const estate = await nrgPost('realEstateList', nrgEstateBody(provider, project), `NRG ${project.slug} realEstateList`);
    if (!Array.isArray(estate.value?.realEstates)) throw new Error(`NRG ${project.slug} realEstateList has no realEstates array`);
    const targetEstate = estate.value.realEstates.find((item) => item?.uuid === project.realEstateUUID);
    if (!targetEstate || typeof targetEstate !== 'object' || Array.isArray(targetEstate)) throw new Error(`NRG ${project.slug} realEstateList does not contain the requested project`);
    if (!Array.isArray(targetEstate.blocks) || targetEstate.blocks.length === 0) throw new Error(`NRG ${project.slug} realEstateList has no blocks`);
    const savedProject = trustedRegistry.projects[project.slug];
    if (!savedProject || savedProject.realEstateUUID !== project.realEstateUUID) throw new Error(`NRG ${project.slug} trusted block registry identity mismatch`);
    const requiredBlocks = new Map(savedProject.blocks.map((block) => [block.id, block]));
    for (const [index, block] of targetEstate.blocks.entries()) {
      const blockValue = assertObject(block, `NRG ${project.slug} block ${index + 1}`);
      const blockId = nrgBlockMatrixBody(blockValue.id).blockId;
      if (targetEstate.blocks.slice(0, index).some((candidate) => candidate?.id === blockId)) throw new Error(`NRG ${project.slug} realEstateList duplicates block ${blockId}`);
      const name = String(blockValue.name ?? '').trim();
      if (!name) throw new Error(`NRG ${project.slug} block ${blockId} has no name`);
      requiredBlocks.set(blockId, { id: blockId, name });
    }
    if (requiredBlocks.size > provider.maxBlocksPerProject) throw new Error(`NRG ${project.slug} exceeded the block safety limit ${provider.maxBlocksPerProject}`);
    registryCandidate.projects[project.slug] = { realEstateUUID: project.realEstateUUID, blocks: [...requiredBlocks.values()] };
    const snapshot = await nrgConsistentSnapshot(async (attempt) => {
      let matrixPlacements = 0;
      const matrixResponses = [];
      for (const [index, block] of registryCandidate.projects[project.slug].blocks.entries()) {
        const blockId = String(block.id);
        const matrix = await nrgPost('blockMatrix', nrgBlockMatrixBody(blockId), `NRG ${project.slug} attempt ${attempt} blockMatrix ${index + 1}/${requiredBlocks.size}`);
        if (String(matrix.value?.blockUUID ?? '') !== blockId) throw new Error(`NRG ${project.slug} blockMatrix ${blockId} identity mismatch`);
        if (String(matrix.value?.blockName ?? '').trim() !== String(block.name).trim()) throw new Error(`NRG ${project.slug} blockMatrix ${blockId} name mismatch`);
        matrixPlacements += nrgMatrixPlacementCount(matrix.value, `NRG ${project.slug} blockMatrix ${blockId}`, provider.maxMatrixPlacementsPerBlock);
        if (matrixPlacements > provider.maxMatrixPlacementsPerProject) {
          throw new Error(`NRG ${project.slug} exceeded the project matrix placement safety limit ${provider.maxMatrixPlacementsPerProject}`);
        }
        matrixResponses.push({ block, blockIndex: index + 1, result: matrix });
      }
      let sawEmptyPage = false;
      const placements = [];
      const placementResponses = [];
      for (let page = 1; page <= 50; page += 1) {
        const result = await nrgPost('placementList', nrgPlacementBody(provider, project, page), `NRG ${project.slug} attempt ${attempt} placement page ${page}`);
        if (!Array.isArray(result.value?.placements)) throw new Error(`NRG ${project.slug} placementList has no placements array`);
        placementResponses.push({ page, result });
        if (result.value.placements.length === 0) {
          sawEmptyPage = true;
          break;
        }
        placements.push(...result.value.placements);
        if (result.value.placements.length > provider.pageSize) throw new Error(`NRG ${project.slug} exceeded requested page size`);
      }
      if (!sawEmptyPage) throw new Error(`NRG ${project.slug} pagination did not reach an empty page`);
      return { matrixResponses, placementResponses, placements };
    }, {
      slug: project.slug,
      apartmentPropertyTypeUUID: provider.apartmentPropertyTypeUUID,
      attempts: provider.consistencyAttempts,
      retryDelayMs: provider.consistencyRetryDelayMs,
    });
    recordResponse(records, {
      id: `nrg-bi-${project.slug}-real-estate`,
      canonicalUrl: `${NRG_BASE}/realEstateList`,
      scope: { projectSlug: project.slug, endpoint: 'realEstateList', page: 1 },
      result: estate,
    });
    for (const { block, blockIndex, result } of snapshot.matrixResponses) {
      const blockId = String(block.id);
      recordResponse(records, {
        id: `nrg-bi-${project.slug}-block-matrix-${blockIndex}`,
        canonicalUrl: `${NRG_BASE}/blockMatrix`,
        scope: { projectSlug: project.slug, endpoint: 'blockMatrix', blockId, blockIndex, consistencyAttempt: snapshot.consistencyAttempt },
        result,
      });
    }
    for (const { page, result } of snapshot.placementResponses) recordResponse(records, {
      id: `nrg-bi-${project.slug}-placements-${page}`,
      canonicalUrl: `${NRG_BASE}/placementList`,
      scope: { projectSlug: project.slug, endpoint: 'placementList', page, consistencyAttempt: snapshot.consistencyAttempt },
      result,
    });
    const placements = snapshot.placements.filter((row) => snapshot.consistencyAudit.matrixFreeIds.has(String(row?.uuid ?? '')));
    if (project.slug === '4u') {
      const capturedAt = new Date().toISOString();
      const { audit } = await refreshNrgPlanAssets(placements, { capturedAt, previousAudit: planAssetCache });
      recordDerivedJson(records, {
        id: 'nrg-bi-4u-plan-asset-audit',
        canonicalUrl: 'https://s3.bi.group/crm-clients-e1csales/layouts/',
        scope: { projectSlug: '4u', endpoint: 'planAssetAudit' },
        value: audit,
        capturedAt,
      });
    }
  }
  const capturedAt = new Date().toISOString();
  const normalizedRegistry = normalizeNrgBlockRegistry(registryCandidate, 'NRG captured block registry');
  recordDerivedJson(records, {
    id: 'nrg-bi-block-registry-candidate',
    canonicalUrl: `${NRG_BASE}/realEstateList`,
    scope: { endpoint: 'blockRegistry', derived: true },
    value: normalizedRegistry,
    capturedAt,
  });
}

function macroEmbedApiUrl(js) {
  const raw = js.match(/api_url:\s*['"]([^'"]+)['"]/)?.[1];
  if (!raw) throw new Error('SUN embed script did not expose its request URL');
  return assertExactUrl(raw, {
    host: 'api.macroserver.uz',
    path: '/estate/request/get_request_url/',
    queryKeys: ['check', 'domain'],
  }, 'SUN handshake');
}

async function currentSunCatalogUrl() {
  assertExactUrl(SUN_EMBED, { host: 'api.macroserver.uz', path: '/estate/embedjs/', queryKeys: ['domain'] }, 'SUN embed');
  const embed = await request({ label: 'SUN embed script', url: SUN_EMBED });
  const handshakeUrl = macroEmbedApiUrl(await embed.text());
  const fixedParameters = {
    type: 'catalog',
    iframemode: 'true',
    inline: 'true',
    locale: 'ru',
    fromApi: 'true',
    domain_config: '[object Object]',
    domain_config_overwrite: '[object Object]',
    issetJQuery: '1',
    uuid: randomUUID(),
    cookie_base64: 'W10=',
  };
  for (const [key, value] of Object.entries(fixedParameters)) handshakeUrl.searchParams.set(key, value);
  const handshake = await jsonResponse({ label: 'SUN signed-catalog handshake', url: handshakeUrl });
  const signed = new URL(String(handshake.value?.url || ''));
  assertExactUrl(signed, {
    host: 'api.macroserver.uz',
    path: '/estate/catalog/',
    queryKeys: [
      'check', 'cookie_base64', 'domain', 'domain_config', 'domain_config_overwrite', 'fromApi',
      'iframemode', 'inline', 'issetJQuery', 'locale', 'time', 'token', 'type', 'uuid',
    ],
  }, 'SUN signed catalogue');
  // This signed URL is intentionally returned only in memory. It is never put
  // into a capture record, error, log, environment variable, or output file.
  return signed;
}

function sunObjectsBody(page) {
  const body = {
    action: 'objects_list',
    data: { category: 'flat', activity: 'sell', filters: {}, complex_id: 5092562, page, cabinetMode: false },
    auth_token: null,
    locale: 'ru',
  };
  exactKeys(body, ['action', 'auth_token', 'data', 'locale'], 'SUN objects_list request');
  exactKeys(body.data, ['activity', 'cabinetMode', 'category', 'complex_id', 'filters', 'page'], 'SUN objects_list data');
  return body;
}

function sunBusinessProjection(row) {
  const estate = row?.estate ?? {};
  return {
    id: row?.id,
    status: row?.status,
    publicHouseName: row?.public_house_name,
    houseFloors: row?.houseFloors,
    houseId: row?.house_id,
    estate: {
      house: estate.house,
      number: estate.geo_flatnum,
      floor: estate.estate_floor,
      rooms: estate.estate_rooms,
      area: estate.estate_area,
      entrance: estate.geo_house_entrance,
      price: estate.estate_price,
      pricePerSquareMeter: estate.estate_price_m2,
    },
  };
}

async function captureSun(records) {
  const signedUrl = await currentSunCatalogUrl();
  let declaredCount = null;
  const objectsById = new Map();
  for (let page = 0; page < 100; page += 1) {
    const result = await jsonResponse({
      label: `SUN objects_list page ${page}`,
      url: signedUrl,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sunObjectsBody(page)),
    });
    if (!Array.isArray(result.value?.objects)) throw new Error(`SUN page ${page} has no objects array`);
    if (!Number.isSafeInteger(Number(result.value.count)) || Number(result.value.count) <= 0) throw new Error(`SUN page ${page} count is invalid`);
    declaredCount ??= Number(result.value.count);
    if (Number(result.value.count) !== declaredCount) throw new Error('SUN count changed during capture');
    for (const row of result.value.objects) {
      const id = Number(row?.id);
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`SUN page ${page} contains an invalid object ID`);
      if (objectsById.has(id) && JSON.stringify(sunBusinessProjection(objectsById.get(id))) !== JSON.stringify(sunBusinessProjection(row))) {
        throw new Error(`SUN object ${id} changed between overlapping pages`);
      }
      objectsById.set(id, row);
    }
    recordResponse(records, {
      id: `sun-objects-${page}`,
      canonicalUrl: SUN_CANONICAL_CATALOG,
      scope: { endpoint: 'objects_list', page },
      result,
    });
    if (result.value.isLastPage === true) {
      // MacroCRM's page zero intentionally overlaps the later 30-row pages.
      // Completeness is therefore the exact set of stable object IDs, not the
      // raw sum of page lengths (currently 336 rows for 306 unique objects).
      if (objectsById.size !== declaredCount) throw new Error(`SUN captured ${objectsById.size} unique objects of ${declaredCount} declared`);
      return;
    }
    if (result.value.objects.length === 0) throw new Error('SUN returned an empty non-final page');
  }
  throw new Error('SUN pagination exceeded the safety limit');
}

/**
 * Adapter interface for server-independent, read-only POST APIs. Request
 * credentials are never used. The SUN signed URL exists only as a local value
 * for the duration of one capture and only response bodies are persisted.
 */
export async function captureFromDirectSource(provider, options = {}) {
  const records = [];
  const errors = [];
  try {
    if (provider.id === 'mbc' || provider.id === 'mbc-sarbon') await captureMbc(provider, records);
    else if (provider.id === 'nrg-bi') await captureNrgBi(provider, records, options);
    else if (provider.id === 'sun') await captureSun(records);
    else throw new Error(`${provider.id}: no direct-source adapter`);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  return {
    schemaVersion: 1,
    provider: provider.id,
    capturedAt: new Date().toISOString(),
    target: null,
    safety: {
      publicReadOnlyTransport: true,
      requestHeadersRead: false,
      browserStorageRead: false,
      cookiesRead: false,
      credentialsUsed: false,
      signedUrlPersisted: false,
      requestBodiesPersisted: false,
    },
    blocked: [],
    errors,
    records,
  };
}

export const directSourceInternals = Object.freeze({
  exactKeys,
  assertExactUrl,
  retryAfterMilliseconds,
  mbcPlansBody,
  nrgPlacementBody,
  nrgEstateBody,
  nrgBlockMatrixBody,
  nrgMatrixPlacementCount,
  nrgConsistencyAudit,
  nrgConsistentSnapshot,
  sunObjectsBody,
  sunBusinessProjection,
});
