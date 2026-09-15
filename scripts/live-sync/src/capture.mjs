import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { matchAllowedUrl, safeUrlMetadata } from './allowlist.mjs';
import { connectProviderTarget } from './cdp.mjs';
import { containsObviousSecret, sanitizeJsonText } from './redact.mjs';

const sha256 = (body) => createHash('sha256').update(body).digest('hex');
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
const uysotDocumentForbiddenCode = 'uysot_document_http_403';
const uysotDocumentForbiddenMessage = 'app.uysot.uz top-level document returned HTTP 403 before SPA startup';

function isMbcProvider(provider) {
  return provider.id === 'mbc' || provider.id === 'mbc-sarbon';
}

function mbcHouseScope(provider, houseId) {
  for (const project of provider.projectDefinitions ?? []) {
    const house = project.profitbaseHouses?.find((candidate) => candidate.id === houseId);
    if (house) return {
      endpoint: 'properties',
      projectSlug: project.slug,
      projectId: project.id,
      profitbaseProjectId: project.profitbaseProjectId,
      houseId,
      queueSourceValue: house.queueSourceValue,
      offset: 0,
    };
  }
  return null;
}

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
    const verification = provider.browserVerificationPost;
    if (verification && url.origin === verification.origin && url.pathname === verification.path && !url.search && !url.hash) {
      // Let the real browser complete the host's own checkpoint. The collector
      // never reads, logs, rewrites, or persists this request body or response.
      return { action: 'continue-browser-verification' };
    }
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
  connectTarget = connectProviderTarget,
} = {}) {
  const captureStartedAt = Date.now();
  const { client, target } = await connectTarget(provider, cdpEndpoint, targetId);
  const methods = new Map();
  const eligible = new Map();
  const records = [];
  const blocked = [];
  const errors = [];
  let failureCode = null;
  let mainFrameId = null;
  const forbiddenDocumentFrameIds = new Set();
  let uysotTableRequestId = null;
  const kayanHouseIds = new Set();
  const mbcRequiredHouseIds = new Set(
    isMbcProvider(provider)
      ? provider.projectDefinitions.flatMap((project) => project.profitbaseHouses.map((house) => house.id))
      : [],
  );
  const mbcHouseIds = new Set();
  const mbcSingletons = new Set();
  const mbcPendingKeys = new Set();
  const mbcCompletedKeys = new Set();
  const mbcRequiredSingletons = new Set(['projects', 'houses', 'customStatuses']);
  let completionResolve;
  const completion = new Promise((resolve) => { completionResolve = resolve; });

  const mbcCaptureComplete = () => isMbcProvider(provider)
    && mbcHouseIds.size === mbcRequiredHouseIds.size
    && [...mbcRequiredSingletons].every((endpoint) => mbcSingletons.has(endpoint));

  const failUysotDocumentForbidden = () => {
    if (failureCode) return;
    failureCode = uysotDocumentForbiddenCode;
    errors.push(`${uysotDocumentForbiddenCode}: ${uysotDocumentForbiddenMessage}`);
    completionResolve();
  };

  const stopRequest = client.on('Network.requestWillBeSent', ({ requestId, request }) => {
    methods.set(requestId, String(request?.method || '').toUpperCase());
  });
  const stopFrame = client.on('Page.frameNavigated', ({ frame }) => {
    if (provider.id !== 'uysot' || !frame?.id || frame.parentId != null) return;
    mainFrameId = frame.id;
    if (forbiddenDocumentFrameIds.has(mainFrameId)) failUysotDocumentForbidden();
  });
  const stopResponse = client.on('Network.responseReceived', ({ requestId, response, type, frameId }) => {
    if (provider.id === 'uysot' && !failureCode && frameId && type === 'Document') {
      let hostname = null;
      try { hostname = new URL(response?.url).hostname; } catch {}
      if (provider.pageHosts.includes(hostname) && Number(response?.status) === 403) {
        if (frameId === mainFrameId) failUysotDocumentForbidden();
        else forbiddenDocumentFrameIds.add(frameId);
        return;
      }
    }
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
    let dedupeKey = null;
    if (isMbcProvider(provider) && match.url.hostname === provider.profitbaseHost) {
      if (match.url.pathname === '/api/v4/json/property') {
        if (match.url.searchParams.get('returnFilteredCount') !== 'true'
          || match.url.searchParams.get('showQueueCount') !== 'false'
          || [...match.url.searchParams.keys()].length !== 3) return;
        const houseId = Number(match.url.searchParams.get('houseId'));
        scope = mbcHouseScope(provider, houseId);
        if (!scope) return;
        // The reviewed smart-catalog request returns the complete house in one
        // response and does not carry an offset. A newly paginated contract is
        // rejected until its page size/order semantics are separately audited.
        scope.offset = 0;
        dedupeKey = `properties:${houseId}`;
      } else if (match.url.pathname === '/api/v4/json/projects') {
        scope = { endpoint: 'projects' };
        dedupeKey = 'projects';
      } else if (match.url.pathname === '/api/v4/json/house') {
        scope = { endpoint: 'houses' };
        dedupeKey = 'houses';
      } else if (match.url.pathname === '/api/v4/json/custom-status/list') {
        if (match.url.searchParams.get('lang') !== 'ru' || [...match.url.searchParams.keys()].length !== 1) return;
        scope = { endpoint: 'customStatuses' };
        dedupeKey = 'customStatuses';
      } else return;
      if (mbcPendingKeys.has(dedupeKey) || mbcCompletedKeys.has(dedupeKey)) return;
      mbcPendingKeys.add(dedupeKey);
    }
    eligible.set(requestId, { method, url: response.url, status: response.status, mimeType: response.mimeType, scope, dedupeKey });
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
      if (response.dedupeKey) mbcCompletedKeys.add(response.dedupeKey);
      if (provider.id === 'uysot' && response.method === 'POST' && new URL(response.url).pathname === '/v1/smart-catalog/table') completionResolve();
      if (provider.id === 'kayan' && response.scope?.houseId) {
        kayanHouseIds.add(response.scope.houseId);
        if (kayanHouseIds.size === 4) completionResolve();
      }
      if (isMbcProvider(provider)) {
        if (response.scope?.endpoint === 'properties') {
          const properties = record.value?.data?.properties;
          const filteredCount = Number(record.value?.data?.filteredCount);
          if (String(record.value?.status ?? '').toLowerCase() !== 'success'
            || !Array.isArray(properties)
            || !Number.isSafeInteger(filteredCount)
            || filteredCount < 0
            || properties.length !== filteredCount) {
            errors.push(`MBC house ${response.scope.houseId} property response is not a complete unpaginated result`);
          } else {
            mbcHouseIds.add(response.scope.houseId);
          }
        }
        else if (mbcRequiredSingletons.has(response.scope?.endpoint)) mbcSingletons.add(response.scope.endpoint);
        if (mbcCaptureComplete()) completionResolve();
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      if (response.dedupeKey) mbcPendingKeys.delete(response.dedupeKey);
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
    // A freshly bootstrapped MBC OOPIF arrives paused at target creation. Its
    // JavaScript is resumed only now, after this capture's Fetch guard and
    // response listeners are installed, leaving no unguarded child-target gap.
    await client.resumeIfWaitingForDebugger?.();
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
    } else if (isMbcProvider(provider)) {
      if (!reload) throw new Error(`${provider.id}: complete Profitbase capture requires the initial projects reload`);
      const projectsPath = provider.targetPaths?.[0];
      if (!projectsPath) throw new Error(`${provider.id}: Profitbase projects target path is not configured`);
      // Start from the MBC project/house screen. It is the only reviewed view
      // that emits the projects, complete house universe, and custom-status
      // dictionaries. Assigning only pathname preserves the opaque tenant
      // context inside the authorized OOPIF and never exposes query values.
      await client.call('Runtime.evaluate', {
        expression: `location.pathname === ${JSON.stringify(projectsPath)} ? location.reload() : location.pathname = ${JSON.stringify(projectsPath)}`,
      });
      const captureDeadline = captureStartedAt + timeoutMs;
      const singletonDeadline = Math.min(captureDeadline, Date.now() + 20_000);
      while (![...mbcRequiredSingletons].every((endpoint) => mbcSingletons.has(endpoint)) && Date.now() < singletonDeadline) await delay(100);
      for (const path of provider.navigationPaths) {
        const expectedHouseId = Number(path.match(/\/house\/(\d+)\//)?.[1]);
        if (!mbcHouseIds.has(expectedHouseId)) {
          // Only pathname is assigned, so the authorized iframe retains its
          // opaque account context without exposing it to the collector.
          await client.call('Runtime.evaluate', {
            expression: `location.pathname === ${JSON.stringify(path)} ? location.reload() : location.pathname = ${JSON.stringify(path)}`,
          });
        }
        const deadline = Math.min(captureDeadline, Date.now() + 20_000);
        while (!mbcHouseIds.has(expectedHouseId) && Date.now() < deadline) await delay(100);
        if (!mbcHouseIds.has(expectedHouseId)) errors.push(`MBC house ${expectedHouseId} response was not observed`);
      }
    } else if (reload) await client.call('Page.reload', { ignoreCache: true });
    // Every MBC house is visited synchronously above. Avoid creating a losing
    // timeout promise after the complete response set has already arrived: the
    // timer would otherwise keep the short-lived collector process alive until
    // the full capture timeout despite having a valid candidate ready.
    if (!isMbcProvider(provider) || !mbcCaptureComplete()) {
      const completionWaitMs = isMbcProvider(provider)
        ? Math.max(0, captureStartedAt + timeoutMs - Date.now())
        : timeoutMs;
      await Promise.race([completion, delay(completionWaitMs)]);
    }
    const hasUysotTable = () => records.some((record) => record.method === 'POST' && record.url?.origin === 'https://service.app.uysot.uz' && record.url?.path === '/v1/smart-catalog/table');
    // A cold Uysot SPA occasionally finishes bootstrapping without issuing its
    // showroom request. One bounded reload makes the scheduled collector
    // reliable while retaining the same exact read-only interception guard.
    if (provider.id === 'uysot' && !failureCode && !hasUysotTable() && reload) {
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
    stopFrame();
    stopRequest();
    client.close();
  }

  if (provider.id === 'uysot' && !failureCode && !uysotTableRequestId) errors.push('Uysot table request was not observed');
  if (provider.id === 'kayan' && kayanHouseIds.size !== 4) errors.push(`KAYAN captured ${kayanHouseIds.size}/4 required houses`);
  if (isMbcProvider(provider)) {
    if (mbcHouseIds.size !== mbcRequiredHouseIds.size) errors.push(`MBC captured ${mbcHouseIds.size}/${mbcRequiredHouseIds.size} required houses`);
    for (const endpoint of mbcRequiredSingletons) if (!mbcSingletons.has(endpoint)) errors.push(`MBC ${endpoint} response was not observed`);
  }
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
      exactBrowserVerificationException: provider.browserVerificationPost?.path ?? null,
    },
    blocked,
    errors,
    failureCode,
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
