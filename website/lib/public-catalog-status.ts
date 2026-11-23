import { publishedProjectKeys } from '../app/construction-passports';

type JsonObject = Record<string, unknown>;
export type PublicCatalogHealth = {
  projectSlug: string;
  status: 'running' | 'succeeded' | 'failed' | 'unknown';
  freshness: 'fresh' | 'stale';
  lastCapturedAt?: string;
  freshUntil?: string;
};
const endpoint = 'http://127.0.0.1:4300/v1/sync/catalog-status';
const responseLimit = 128 * 1024;
const cacheLifetime = 5000;
let cached: { expires: number; value: { items: Array<{ projects: PublicCatalogHealth[] }> } } | undefined;
let inflight: Promise<{ items: Array<{ projects: PublicCatalogHealth[] }> }> | undefined;

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function date(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return;
  return value;
}

export function publicCatalogStatus(value: unknown, now = Date.now()) {
  if (!record(value) || !Array.isArray(value.items) || value.items.length > 100) throw Error('Invalid catalog status');
  const projects: PublicCatalogHealth[] = [];
  const seen = new Set<string>();
  for (const provider of value.items) {
    if (!record(provider) || !Array.isArray(provider.projects) || provider.projects.length > 2000) throw Error('Invalid catalog status');
    for (const source of provider.projects) {
      if (!record(source) || typeof source.projectSlug !== 'string' || !publishedProjectKeys.has(source.projectSlug)) continue;
      if (seen.has(source.projectSlug)) throw Error('Duplicate catalog project health');
      seen.add(source.projectSlug);
      const status = source.status === 'running' || source.status === 'succeeded' || source.status === 'failed' ? source.status : 'unknown';
      const captured = date(source.lastCapturedAt), until = date(source.freshUntil);
      const plausibleCapture = captured && Date.parse(captured) <= now + 5 * 60_000 ? captured : undefined;
      const freshness = source.freshness === 'fresh' && plausibleCapture && until && Date.parse(until) > now ? 'fresh' : 'stale';
      projects.push({ projectSlug: source.projectSlug, status, freshness,
        ...(plausibleCapture ? { lastCapturedAt: plausibleCapture } : {}), ...(until ? { freshUntil: until } : {}) });
    }
  }
  // No provider names, unpublished slugs, raw errors, counts, URLs or secrets
  // cross this boundary. Existing client flattening still reads items.projects.
  return { items: [{ projects }] };
}

async function boundedJSON(response: Response) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > responseLimit)) throw Error('Oversized catalog status');
  if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body) throw Error('Catalog status unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > responseLimit) { await reader.cancel(); throw Error('Oversized catalog status'); }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { body.set(chunk, cursor); cursor += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function loadPublicCatalogStatus() {
  if (cached && cached.expires > Date.now()) return cached.value;
  if (inflight) return inflight;
  inflight = (async () => {
    const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store',
      credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(5000) });
    const value = publicCatalogStatus(await boundedJSON(response));
    cached = { value, expires: Date.now() + cacheLifetime };
    return value;
  })();
  try { return await inflight; }
  catch (error) { cached = undefined; throw error; }
  finally { inflight = undefined; }
}
