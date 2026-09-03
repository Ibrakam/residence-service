import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { matchAllowedUrl, safeUrlMetadata } from './allowlist.mjs';
import { connectProviderTarget } from './cdp.mjs';
import { containsObviousSecret, sanitizeJsonText } from './redact.mjs';

const sha256 = (body) => createHash('sha256').update(body).digest('hex');
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function parseUysotReadOnlyBody(postData) {
  let body;
  try { body = JSON.parse(postData || ''); } catch { throw new Error('Uysot table request body is not JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Uysot table request body must be an object');
  const keys = Object.keys(body).sort();
  const allowed = ['houseId', 'orders', 'page', 'size'];
  if (keys.some((key) => !allowed.includes(key))) throw new Error(`Uysot table request has unexpected keys: ${keys.join(', ')}`);
  if (!Array.isArray(body.houseId) || body.houseId.length !== 1 || Number(body.houseId[0]) !== 1074) throw new Error('Uysot table request must be scoped to houseId 1074');
  const emptyOrderObject = body.orders && typeof body.orders === 'object' && !Array.isArray(body.orders) && Object.keys(body.orders).length === 0;
  const boundedOrderArray = Array.isArray(body.orders) && body.orders.length <= 20;
  if (!emptyOrderObject && !boundedOrderArray) throw new Error('Uysot table orders must be an empty object or bounded array');
  if (!Number.isSafeInteger(Number(body.page)) || Number(body.page) < 1) throw new Error('Uysot table page is invalid');
  if (!Number.isSafeInteger(Number(body.size)) || Number(body.size) < 1) throw new Error('Uysot table size is invalid');
  return { page: 1, size: 500, orders: emptyOrderObject ? {} : [], houseId: [1074] };
}

export function classifyRequest(provider, request) {
  const method = String(request.method || '').toUpperCase();
  if (safeMethods.has(method)) return { action: 'continue' };
  if (provider.id === 'uysot' && method === 'POST') {
    let url;
    try { url = new URL(request.url); } catch { return { action: 'block', reason: 'invalid URL' }; }
    if (url.origin !== 'https://service.app.uysot.uz' || url.pathname !== '/v1/smart-catalog/table' || url.search) {
      return { action: 'block', reason: 'non-allowlisted POST' };
    }
    return { action: 'continue-read-post', body: parseUysotReadOnlyBody(request.postData) };
  }
  return { action: 'block', reason: 'non-read method' };
}

export function makeBodyRecord({ id, method, url, status, mimeType, text, capturedAt, scope = null }) {
  const sanitized = sanitizeJsonText(text);
  if (containsObviousSecret(sanitized)) throw new Error(`${id}: sanitized response still contains a secret-like field`);
  const body = `${JSON.stringify(sanitized, null, 2)}\n`;
  return {
    id,
    method,
    url: safeUrlMetadata(url),
    status,
    mimeType,
    capturedAt,
    ...(scope ? { scope } : {}),
    bytes: Buffer.byteLength(body),
    sha256: sha256(body),
    body,
    value: sanitized,
  };
}

async function getResponseBody(client, requestId) {
  const result = await client.call('Network.getResponseBody', { requestId });
  return result.base64Encoded ? Buffer.from(result.body, 'base64').toString('utf8') : result.body;
}

/**
 * Capture JSON response bodies from an already-authorized browser tab. The code
 * never calls Network.getCookies, Storage.*, DOMStorage.*, or reads request
 * headers. All non-read methods are failed, with one exact Uysot table exception
 * whose body is rewritten to a bounded, read-only page query.
 */
export async function captureFromAuthorizedTab(provider, {
  cdpEndpoint,
  targetId = null,
  timeoutMs = 45_000,
  reload = true,
} = {}) {
  const { client, target } = await connectProviderTarget(provider, cdpEndpoint, targetId);
  const methods = new Map();
  const eligible = new Map();
  const records = [];
  const blocked = [];
  const errors = [];
  let uysotTableRequestId = null;
  const kayanHouseIds = new Set();
  let completionResolve;
  const completion = new Promise((resolve) => { completionResolve = resolve; });

  const stopRequest = client.on('Network.requestWillBeSent', ({ requestId, request }) => {
    methods.set(requestId, String(request?.method || '').toUpperCase());
  });
  const stopResponse = client.on('Network.responseReceived', ({ requestId, response, type }) => {
    const method = methods.get(requestId) || '';
    const match = matchAllowedUrl(provider, response.url);
    if (!match || !['XHR', 'Fetch'].includes(type) || response.status < 200 || response.status >= 300) return;
    if (method !== 'GET' && !(provider.id === 'uysot' && method === 'POST' && match.url.pathname === '/v1/smart-catalog/table')) return;
    if (!/json/i.test(response.mimeType || '')) return;
    let scope = null;
    if (provider.id === 'kayan' && match.url.hostname === 'pb21432.profitbase.ru' && match.url.pathname === '/api/v4/json/property') {
      const houseId = Number(match.url.searchParams.get('houseId'));
      if ([154813, 153505, 153506, 154273].includes(houseId)) scope = { houseId };
      else return;
    }
    eligible.set(requestId, { method, url: response.url, status: response.status, mimeType: response.mimeType, scope });
  });
  const stopFinished = client.on('Network.loadingFinished', async ({ requestId }) => {
    const response = eligible.get(requestId);
    if (!response) return;
    eligible.delete(requestId);
    try {
      const text = await getResponseBody(client, requestId);
      const record = makeBodyRecord({
        id: `${provider.id}-${records.length + 1}`,
        ...response,
        text,
        capturedAt: new Date().toISOString(),
      });
      records.push(record);
      if (provider.id === 'uysot' && response.method === 'POST' && new URL(response.url).pathname === '/v1/smart-catalog/table') completionResolve();
      if (provider.id === 'kayan' && response.scope?.houseId) {
        kayanHouseIds.add(response.scope.houseId);
        if (kayanHouseIds.size === 4) completionResolve();
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  });
  const stopPaused = client.on('Fetch.requestPaused', async ({ requestId, request, networkId }) => {
    try {
      const decision = classifyRequest(provider, request);
      if (decision.action === 'block') {
        blocked.push({ method: String(request.method || '').toUpperCase(), url: safeUrlMetadata(request.url), reason: decision.reason });
        await client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        return;
      }
      if (decision.action === 'continue-read-post') {
        uysotTableRequestId = networkId ?? null;
        await client.call('Fetch.continueRequest', {
          requestId,
          postData: Buffer.from(JSON.stringify(decision.body)).toString('base64'),
        });
        return;
      }
      await client.call('Fetch.continueRequest', { requestId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Chrome can cancel a resource during navigation after emitting
      // requestPaused. That interception ID is already gone and is not a data
      // or safety failure.
      if (!message.includes('Invalid InterceptionId')) errors.push(message);
      await client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  });

  try {
    await client.call('Network.enable', { maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 32 * 1024 * 1024 });
    await client.call('Page.enable');
    await client.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    if (provider.id === 'kayan') {
      for (const path of provider.navigationPaths) {
        const expectedHouseId = Number(path.match(/\/house\/(\d+)\//)?.[1]);
        // Assigning pathname preserves the existing query entirely inside the
        // authorized OOPIF. No query value is returned to or copied by us.
        await client.call('Runtime.evaluate', { expression: `location.pathname = ${JSON.stringify(path)}` });
        const deadline = Date.now() + Math.min(timeoutMs, 20_000);
        while (!kayanHouseIds.has(expectedHouseId) && Date.now() < deadline) await delay(100);
        if (!kayanHouseIds.has(expectedHouseId)) errors.push(`KAYAN house ${expectedHouseId} response was not observed`);
      }
    } else if (reload) await client.call('Page.reload', { ignoreCache: true });
    await Promise.race([completion, delay(timeoutMs)]);
    const hasUysotTable = () => records.some((record) => record.method === 'POST' && record.url?.origin === 'https://service.app.uysot.uz' && record.url?.path === '/v1/smart-catalog/table');
    // A cold Uysot SPA occasionally finishes bootstrapping without issuing its
    // showroom request. One bounded reload makes the scheduled collector
    // reliable while retaining the same exact read-only interception guard.
    if (provider.id === 'uysot' && !hasUysotTable() && reload) {
      await client.call('Page.reload', { ignoreCache: true });
      await Promise.race([completion, delay(timeoutMs)]);
    }
    // Let loadingFinished handlers settle without retaining an open interceptor.
    await delay(400);
  } finally {
    await client.call('Fetch.disable').catch(() => {});
    stopPaused();
    stopFinished();
    stopResponse();
    stopRequest();
    client.close();
  }

  if (provider.id === 'uysot' && !uysotTableRequestId) errors.push('Uysot table request was not observed');
  if (provider.id === 'kayan' && kayanHouseIds.size !== 4) errors.push(`KAYAN captured ${kayanHouseIds.size}/4 required houses`);
  return {
    schemaVersion: 1,
    provider: provider.id,
    capturedAt: new Date().toISOString(),
    target: { id: target.id, type: target.type, url: target.url },
    safety: {
      cdpLoopbackOnly: true,
      requestHeadersRead: false,
      browserStorageRead: false,
      cookiesRead: false,
      unsafeMethodsBlocked: true,
      exactReadPostException: provider.id === 'uysot' ? '/v1/smart-catalog/table' : null,
    },
    blocked,
    errors,
    records,
  };
}

export function captureFiles(capture) {
  const files = [];
  const index = {
    ...capture,
    records: capture.records.map(({ body, value, ...record }, index) => ({ ...record, bodyPath: `responses/${String(index + 1).padStart(3, '0')}.json` })),
  };
  files.push(['capture-index.json', `${JSON.stringify(index, null, 2)}\n`]);
  capture.records.forEach((record, index) => files.push([`responses/${String(index + 1).padStart(3, '0')}.json`, record.body]));
  return files;
}
