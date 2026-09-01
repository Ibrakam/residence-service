const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

type JsonRecord = Record<string, unknown>;

type ReadJsonResult<T extends JsonRecord> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export type ForwardResult =
  | { ok: true; status: number }
  | { ok: false; error: 'forward_timeout' | 'forward_unavailable' | 'forward_response_too_large' };

export function leadJson(body: object, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function readBodyBytes(request: Request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      return { error: 'invalid_content_length' as const };
    }
    if (parsedLength > MAX_REQUEST_BYTES) return { error: 'payload_too_large' as const };
  }

  if (!request.body) return { error: 'invalid_json' as const };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { error: 'payload_too_large' as const };
      }
      chunks.push(value);
    }
  } catch {
    return { error: 'invalid_body' as const };
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes };
}

export async function readLeadJson<T extends JsonRecord>(request: Request): Promise<ReadJsonResult<T>> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { ok: false, response: leadJson({ success: false, error: 'unsupported_media_type' }, 415) };
  }

  const body = await readBodyBytes(request);
  if ('error' in body) {
    return {
      ok: false,
      response: leadJson(
        { success: false, error: body.error },
        body.error === 'payload_too_large' ? 413 : 400,
      ),
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body.bytes));
  } catch {
    return { ok: false, response: leadJson({ success: false, error: 'invalid_json' }, 400) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, response: leadJson({ success: false, error: 'invalid_payload' }, 400) };
  }
  return { ok: true, value: value as T };
}

export function safeForwardUrl(candidate: string, requireHttps = process.env.NODE_ENV === 'production') {
  try {
    const parsed = new URL(candidate);
    if ((requireHttps ? parsed.protocol !== 'https:' : !['http:', 'https:'].includes(parsed.protocol))
      || parsed.username
      || parsed.password
      || parsed.hash) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function responseWithinLimit(response: Response) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      return false;
    }
  }

  if (!response.body) return true;
  const reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return true;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        return false;
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    return false;
  }
}

export async function forwardLeadJson(destination: URL, payload: JsonRecord): Promise<ForwardResult> {
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
    return { ok: false, error: 'forward_unavailable' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(destination, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: serialized,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!await responseWithinLimit(response)) {
      return { ok: false, error: 'forward_response_too_large' };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
        ? 'forward_timeout'
        : 'forward_unavailable',
    };
  } finally {
    clearTimeout(timeout);
  }
}
