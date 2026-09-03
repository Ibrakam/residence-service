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
      delay(timeoutMs).then(() => { throw new Error('Timed out connecting to CDP websocket'); }),
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
    for (const listener of [...listeners]) listener(message.params ?? {});
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

  call(method, params = {}, timeoutMs = 20_000) {
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
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
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

export async function connectProviderTarget(provider, cdpEndpoint, explicitTargetId = null) {
  const targets = await listTargets(cdpEndpoint);
  const candidates = targets.filter((target) => {
    if (!target.webSocketDebuggerUrl || (explicitTargetId && target.id !== explicitTargetId)) return false;
    return provider.pageHosts.includes(target.hostname);
  });
  if (candidates.length === 0) {
    const visible = targets.filter((target) => target.type === 'page').map((target) => target.hostname ?? '(invalid URL)');
    throw new Error(`${provider.id}: no matching authorized tab on CDP endpoint; page hosts: ${[...new Set(visible)].join(', ') || '(none)'}`);
  }
  // Prefer the exact application page over an iframe or service worker.
  candidates.sort((left, right) => Number(right.type === 'page') - Number(left.type === 'page'));
  const target = candidates[0];
  const debuggerUrl = new URL(target.webSocketDebuggerUrl);
  const cdpBase = assertLoopbackCdp(cdpEndpoint);
  debuggerUrl.hostname = cdpBase.hostname;
  debuggerUrl.port = cdpBase.port;
  const client = await CdpClient.connect(debuggerUrl.href);
  return { client, target };
}
