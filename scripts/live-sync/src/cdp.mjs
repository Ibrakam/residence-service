import { setTimeout as delay } from 'node:timers/promises';
import { assertLoopbackCdp, safeUrlMetadata } from './allowlist.mjs';

export class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => this.#receive(event.data));
    socket.addEventListener('close', () => this.#close(new Error('CDP connection closed')));
    socket.addEventListener('error', () => this.#close(new Error('CDP connection failed')));
  }

  static async connect(webSocketDebuggerUrl, timeoutMs = 10_000) {
    const parsed = new URL(webSocketDebuggerUrl);
    if (!['ws:', 'wss:'].includes(parsed.protocol)) throw new Error('Invalid CDP websocket URL');
    if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw new Error('CDP websocket must resolve to loopback');
    const socket = new WebSocket(parsed.href);
    await Promise.race([
      new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', () => reject(new Error('Could not connect to CDP websocket')), { once: true });
      }),
      delay(timeoutMs, undefined, { ref: false }).then(() => { throw new Error('Timed out connecting to CDP websocket'); }),
    ]);
    return new CdpClient(socket);
  }

  #receive(raw) {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return; }
    if (message.id) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result ?? {});
      return;
    }
    const listeners = this.#listeners.get(message.method);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      listener(message.params ?? {}, { sessionId: message.sessionId ?? null });
    }
  }

  #close(error) {
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  call(method, params = {}, timeoutMs = 20_000, sessionId = null) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method}: timed out`));
      }, timeoutMs);
      timeout.unref?.();
      this.#pending.set(id, {
        method,
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.#socket.send(JSON.stringify({
        id,
        method,
        params,
        ...(sessionId ? { sessionId } : {}),
      }));
    });
  }

  close() {
    this.#socket.close();
  }
}

class CdpSessionClient {
  #root;
  #sessionId;
  #waitingForDebugger;
  #beforeResume;
  #cleanup;

  constructor(root, sessionId, waitingForDebugger, beforeResume, cleanup = []) {
    this.#root = root;
    this.#sessionId = sessionId;
    this.#waitingForDebugger = waitingForDebugger;
    this.#beforeResume = beforeResume;
    this.#cleanup = cleanup;
  }

  on(method, listener) {
    return this.#root.on(method, (params, metadata) => {
      if (metadata.sessionId === this.#sessionId) listener(params);
    });
  }

  call(method, params = {}, timeoutMs = 20_000) {
    return this.#root.call(method, params, timeoutMs, this.#sessionId);
  }

  async resumeIfWaitingForDebugger() {
    if (!this.#waitingForDebugger) return;
    this.#waitingForDebugger = false;
    await this.#beforeResume?.();
    await this.call('Runtime.runIfWaitingForDebugger');
  }

  close() {
    for (const cleanup of this.#cleanup.splice(0)) cleanup();
    this.#root.close();
  }
}

async function cdpGet(base, path) {
  const endpoint = new URL(path, base);
  const response = await fetch(endpoint, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`CDP ${endpoint.pathname}: HTTP ${response.status}`);
  return response.json();
}

export async function listTargets(cdpEndpoint) {
  const base = assertLoopbackCdp(cdpEndpoint);
  const targets = await cdpGet(base, '/json/list');
  if (!Array.isArray(targets)) throw new Error('CDP target list is invalid');
  return targets.map(({ id, type, url, webSocketDebuggerUrl }) => {
    let hostname = null;
    let urlMetadata = null;
    try {
      hostname = new URL(url).hostname;
      urlMetadata = safeUrlMetadata(url);
    } catch {}
    // Discard the raw target URL immediately: authorized OOPIF URLs can carry
    // opaque query values. Only host/path/query-key metadata leaves this scope.
    return { id, type, hostname, url: urlMetadata, webSocketDebuggerUrl };
  });
}

export function targetMatchesProvider(provider, target, explicitTargetId = null) {
  if (!target.webSocketDebuggerUrl || (explicitTargetId && target.id !== explicitTargetId)) return false;
  if (!['page', 'iframe'].includes(target.type)) return false;
  if (!provider.pageHosts.includes(target.hostname)) return false;
  if (target.url?.origin !== `https://${target.hostname}`) return false;
  const path = target.url?.path ?? '';
  const hasTargetRules = (provider.targetPaths?.length ?? 0) > 0 || (provider.targetHouseIds?.length ?? 0) > 0;
  if (!hasTargetRules) return true;
  // A projects overview path does not identify a Profitbase tenant. It is
  // eligible only when an operator supplied this exact CDP target ID. Normal
  // unattended selection starts from an allowlisted tenant-specific house.
  if (provider.targetPaths?.includes(path)) return explicitTargetId === target.id;
  const houseId = Number(path.match(/^\/eco\/catalog\/house\/(\d+)(?:\/|$)/)?.[1]);
  return Number.isSafeInteger(houseId) && provider.targetHouseIds?.includes(houseId);
}

export function selectProviderTarget(provider, targets, explicitTargetId = null) {
  const candidates = targets.filter((target) => targetMatchesProvider(provider, target, explicitTargetId));
  if (candidates.length === 0) {
    const visible = targets.filter((target) => target.type === 'page').map((target) => target.hostname ?? '(invalid URL)');
    throw new Error(`${provider.id}: no matching authorized tab on CDP endpoint; page hosts: ${[...new Set(visible)].join(', ') || '(none)'}`);
  }
  // Prefer the exact application page over an iframe or service worker.
  candidates.sort((left, right) => Number(right.type === 'page') - Number(left.type === 'page'));
  const preferredType = candidates[0].type;
  const preferred = candidates.filter((candidate) => candidate.type === preferredType);
  if (preferred.length > 1 && !explicitTargetId) {
    throw new Error(`${provider.id}: multiple matching authorized catalogue targets; refusing an ambiguous account selection`);
  }
  const target = preferred[0];
  return target;
}

export function browserBootstrapExpression(controlText) {
  const expected = JSON.stringify(String(controlText));
  return `(() => {
    const normalize = (value) => String(value || '').trim().replace(/\\s+/g, ' ');
    const controls = Array.from(document.querySelectorAll('button'));
    const matches = controls.filter((control) => normalize(control.innerText || control.textContent) === ${expected});
    if (matches.length !== 1) return false;
    matches[0].click();
    return true;
  })()`;
}

export function classifyBootstrapRequest(request) {
  const method = String(request?.method ?? '').toUpperCase();
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'continue' : 'block';
}

export function browserFrameProofFunction() {
  return `function(expectedOrigin, expectedPath) {
    try {
      const candidate = new URL(this.getAttribute('src') || '', document.baseURI);
      return this.tagName === 'IFRAME'
        && candidate.origin === expectedOrigin
        && candidate.pathname === expectedPath;
    } catch {
      return false;
    }
  }`;
}

async function connectTargetClient(target, cdpEndpoint) {
  const debuggerUrl = new URL(target.webSocketDebuggerUrl);
  const cdpBase = assertLoopbackCdp(cdpEndpoint);
  debuggerUrl.hostname = cdpBase.hostname;
  debuggerUrl.port = cdpBase.port;
  return CdpClient.connect(debuggerUrl.href);
}

async function proveAttachedFrame(outerClient, targetId, bootstrap) {
  let objectId = null;
  try {
    const owner = await outerClient.call('DOM.getFrameOwner', { frameId: targetId });
    if (!owner?.backendNodeId) return false;
    const resolved = await outerClient.call('DOM.resolveNode', { backendNodeId: owner.backendNodeId });
    objectId = resolved?.object?.objectId ?? null;
    if (!objectId) return false;
    const result = await outerClient.call('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: browserFrameProofFunction(),
      arguments: [{ value: bootstrap.targetOrigin }, { value: bootstrap.targetPath }],
      returnByValue: true,
    });
    return result?.result?.value === true;
  } finally {
    if (objectId) await outerClient.call('Runtime.releaseObject', { objectId }).catch(() => {});
  }
}

async function bootstrapProviderTarget(provider, targets, cdpEndpoint) {
  const bootstrap = provider.browserBootstrap;
  if (!bootstrap) return null;
  const pages = targets.filter((target) => target.type === 'page'
    && target.webSocketDebuggerUrl
    && target.url?.origin === bootstrap.origin
    && target.url?.path === bootstrap.path);
  if (pages.length !== 1) {
    throw new Error(`${provider.id}: expected exactly one authorized bootstrap page, found ${pages.length}`);
  }
  const outerClient = await connectTargetClient(pages[0], cdpEndpoint);
  const guardedSessions = new Set();
  const pendingInterceptions = new Map();
  const trackInterception = (sessionId, operation) => {
    const operations = pendingInterceptions.get(sessionId) ?? new Set();
    operations.add(operation);
    pendingInterceptions.set(sessionId, operations);
    operation.finally(() => {
      operations.delete(operation);
      if (operations.size === 0) pendingInterceptions.delete(sessionId);
    });
  };
  const intercept = (client, sessionId, requestId, request) => {
    const operation = (async () => {
      if (classifyBootstrapRequest(request) === 'continue') {
        await client.call('Fetch.continueRequest', { requestId });
      } else {
        await client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
      }
    })().catch(async () => {
      await client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    });
    trackInterception(sessionId, operation);
  };
  const stopOuterPaused = outerClient.on('Fetch.requestPaused', ({ requestId, request }, metadata) => {
    if (metadata.sessionId !== null) return;
    intercept(outerClient, 'outer-page', requestId, request);
  });
  const stopAttachedPaused = outerClient.on('Fetch.requestPaused', ({ requestId, request }, metadata) => {
    if (!metadata.sessionId || !guardedSessions.has(metadata.sessionId)) return;
    const sessionClient = {
      call: (method, params) => outerClient.call(method, params, 20_000, metadata.sessionId),
    };
    intercept(sessionClient, metadata.sessionId, requestId, request);
  });

  let candidateResolve;
  let candidateReject;
  const candidate = new Promise((resolve, reject) => {
    candidateResolve = resolve;
    candidateReject = reject;
  });
  let selected = false;
  const attachedOperations = new Set();
  const trackAttachedOperation = (operation) => {
    attachedOperations.add(operation);
    operation.finally(() => attachedOperations.delete(operation));
  };
  const stopAttached = outerClient.on('Target.attachedToTarget', (params) => {
    const operation = (async () => {
      const sessionId = params?.sessionId;
      if (!sessionId || params?.targetInfo?.type !== 'iframe') return;
      const targetId = params.targetInfo.targetId;
      guardedSessions.add(sessionId);
      await outerClient.call('Fetch.enable', {
        patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      }, 20_000, sessionId);
      const intended = await proveAttachedFrame(outerClient, targetId, bootstrap);
      if (intended && !selected) {
        if (params.waitingForDebugger !== true) {
          throw new Error(`${provider.id}: catalogue iframe was not paused before bootstrap traffic`);
        }
        const targetOrigin = new URL(bootstrap.targetOrigin);
        selected = true;
        candidateResolve({
          sessionId,
          target: {
            id: targetId,
            type: 'iframe',
            hostname: targetOrigin.hostname,
            url: { origin: targetOrigin.origin, path: bootstrap.targetPath, queryKeys: [] },
            webSocketDebuggerUrl: 'attached-session',
          },
        });
        return;
      }
      if (params.waitingForDebugger === true) {
        await outerClient.call('Runtime.runIfWaitingForDebugger', {}, 20_000, sessionId);
      }
    })().catch((error) => {
      if (!selected) candidateReject(error);
    });
    trackAttachedOperation(operation);
  });

  const cleanup = () => {
    stopAttached();
    stopAttachedPaused();
    stopOuterPaused();
  };
  try {
    // Arm both the outer page and automatic child-target interception before
    // clicking. New OOPIFs are paused at creation; the chosen catalogue target
    // is resumed only after capture listeners have taken over its Fetch domain.
    await outerClient.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await outerClient.call('DOM.enable');
    await outerClient.call('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: 'iframe', exclude: false }, { exclude: true }],
    });
    const result = await outerClient.call('Runtime.evaluate', {
      expression: browserBootstrapExpression(bootstrap.controlText),
      returnByValue: true,
    });
    if (result?.result?.value !== true) {
      throw new Error(`${provider.id}: authorized bootstrap control is unavailable`);
    }
    const chosen = await Promise.race([
      candidate,
      delay(bootstrap.timeoutMs, undefined, { ref: false }).then(() => {
        throw new Error(`${provider.id}: authorized catalogue did not open after bootstrap`);
      }),
    ]);
    const pending = pendingInterceptions.get(chosen.sessionId);
    if (pending) await Promise.allSettled([...pending]);
    guardedSessions.delete(chosen.sessionId);
    // The child is still paused at Runtime startup, so disabling the temporary
    // bootstrap Fetch domain cannot let its application JavaScript run. This
    // also avoids two listeners handling the same interception during handoff.
    await outerClient.call('Fetch.disable', {}, 20_000, chosen.sessionId);
    const client = new CdpSessionClient(
      outerClient,
      chosen.sessionId,
      true,
      null,
      [cleanup],
    );
    return { client, target: chosen.target };
  } catch (error) {
    await Promise.allSettled([...attachedOperations]);
    for (const sessionId of guardedSessions) {
      await outerClient.call('Runtime.runIfWaitingForDebugger', {}, 5_000, sessionId).catch(() => {});
    }
    cleanup();
    outerClient.close();
    throw error;
  }
}

export async function connectProviderTarget(provider, cdpEndpoint, explicitTargetId = null) {
  const targets = await listTargets(cdpEndpoint);
  const matches = targets.filter((target) => targetMatchesProvider(provider, target, explicitTargetId));
  if (matches.length === 0 && !explicitTargetId && provider.browserBootstrap) {
    const overviews = targets.filter((target) => target.type === 'iframe'
      && target.webSocketDebuggerUrl
      && provider.targetPaths?.includes(target.url?.path)
      && targetMatchesProvider(provider, target, target.id));
    if (overviews.length > 1) {
      throw new Error(`${provider.id}: multiple catalogue overview targets; refusing an ambiguous account selection`);
    }
    if (overviews.length === 1) {
      const target = selectProviderTarget(provider, targets, overviews[0].id);
      const client = await connectTargetClient(target, cdpEndpoint);
      return { client, target };
    }
    return bootstrapProviderTarget(provider, targets, cdpEndpoint);
  }
  const target = selectProviderTarget(provider, targets, explicitTargetId);
  const client = await connectTargetClient(target, cdpEndpoint);
  return { client, target };
}
