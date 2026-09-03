import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { makeBodyRecord } from './capture.mjs';

const MBC_ENDPOINT = 'https://mbc.uz/api/plans';
const NRG_BASE = 'https://apigw.bi.group/sales-picker/microfe-v3';
const SUN_EMBED = 'https://api.macroserver.uz/estate/embedjs/?domain=human2human.uz';
const SUN_CANONICAL_CATALOG = 'https://api.macroserver.uz/estate/catalog/';
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

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

async function request({ label, url, method = 'GET', headers = {}, body = null, attempts = 4, timeoutMs = 60_000 }) {
  let lastStatus = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
      if (!RETRYABLE.has(response.status) || attempt === attempts) break;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
    await delay(250 * attempt);
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

async function captureMbc(records) {
  let total = null;
  let lastPage = null;
  for (let page = 1; page <= 100; page += 1) {
    const form = new URLSearchParams({ project: '1', page: String(page) });
    exactKeys(Object.fromEntries(form), ['page', 'project'], 'MBC request');
    const result = await jsonResponse({
      label: `MBC plans page ${page}`,
      url: MBC_ENDPOINT,
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: form.toString(),
    });
    const plans = assertObject(result.value?.plans, `MBC page ${page}.plans`);
    if (!Array.isArray(plans.data)) throw new Error(`MBC page ${page}.plans.data is not an array`);
    if (Number(plans.current_page) !== page) throw new Error(`MBC page ${page} current_page mismatch`);
    if (!Number.isSafeInteger(Number(plans.total)) || Number(plans.total) <= 0) throw new Error(`MBC page ${page} total is invalid`);
    if (!Number.isSafeInteger(Number(plans.last_page)) || Number(plans.last_page) <= 0) throw new Error(`MBC page ${page} last_page is invalid`);
    total ??= Number(plans.total);
    lastPage ??= Number(plans.last_page);
    if (Number(plans.total) !== total || Number(plans.last_page) !== lastPage) throw new Error('MBC pagination declaration changed during capture');
    recordResponse(records, { id: `mbc-plans-${page}`, canonicalUrl: MBC_ENDPOINT, scope: { endpoint: 'plans', page }, result });
    if (page === lastPage) return;
  }
  throw new Error('MBC pagination exceeded the safety limit');
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

async function nrgPost(endpoint, body, label) {
  if (!['placementList', 'realEstateList'].includes(endpoint)) throw new Error('NRG endpoint is outside the allowlist');
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

async function captureNrgBi(provider, records) {
  for (const project of provider.projectDefinitions) {
    let sawEmptyPage = false;
    for (let page = 1; page <= 50; page += 1) {
      const result = await nrgPost('placementList', nrgPlacementBody(provider, project, page), `NRG ${project.slug} placement page ${page}`);
      if (!Array.isArray(result.value?.placements)) throw new Error(`NRG ${project.slug} placementList has no placements array`);
      recordResponse(records, {
        id: `nrg-bi-${project.slug}-placements-${page}`,
        canonicalUrl: `${NRG_BASE}/placementList`,
        scope: { projectSlug: project.slug, endpoint: 'placementList', page },
        result,
      });
      if (result.value.placements.length === 0) {
        sawEmptyPage = true;
        break;
      }
      if (result.value.placements.length > provider.pageSize) throw new Error(`NRG ${project.slug} exceeded requested page size`);
    }
    if (!sawEmptyPage) throw new Error(`NRG ${project.slug} pagination did not reach an empty page`);
    const estate = await nrgPost('realEstateList', nrgEstateBody(provider, project), `NRG ${project.slug} realEstateList`);
    if (!Array.isArray(estate.value?.realEstates)) throw new Error(`NRG ${project.slug} realEstateList has no realEstates array`);
    recordResponse(records, {
      id: `nrg-bi-${project.slug}-real-estate`,
      canonicalUrl: `${NRG_BASE}/realEstateList`,
      scope: { projectSlug: project.slug, endpoint: 'realEstateList', page: 1 },
      result: estate,
    });
  }
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
export async function captureFromDirectSource(provider) {
  const records = [];
  const errors = [];
  try {
    if (provider.id === 'mbc') await captureMbc(records);
    else if (provider.id === 'nrg-bi') await captureNrgBi(provider, records);
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
  nrgPlacementBody,
  nrgEstateBody,
  sunObjectsBody,
  sunBusinessProjection,
});
