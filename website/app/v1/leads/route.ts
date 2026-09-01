const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

type JsonObject = Record<string, unknown>;

function json(body: JsonObject, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

async function readLimitedBody(request: Request, limit: number) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) return { error: 'invalid_content_length' as const };
    if (parsedLength > limit) return { error: 'payload_too_large' as const };
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
      if (length > limit) {
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
  return { text: new TextDecoder().decode(bytes) };
}

function configuredBackendUrl() {
  const exactUrl = process.env.LEAD_BACKEND_URL?.trim();
  const catalogBase = process.env.CATALOG_API_URL?.trim();
  const candidate = exactUrl
    || (catalogBase ? `${catalogBase.replace(/\/+$/, '')}/v1/leads` : '')
    || (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:8080/v1/leads' : '');

  if (!candidate) return { error: 'lead_delivery_unconfigured' as const };

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { error: 'invalid_lead_backend_configuration' as const };
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    return { error: 'unsafe_lead_backend_configuration' as const };
  }
  return { url };
}

function trustedProxyClientIp(request: Request) {
  // Production binds this app to loopback and Nginx overwrites X-Real-IP with
  // the TCP client address. Never forward a browser-supplied X-Forwarded-For
  // chain to the amoCRM sink.
  const value = request.headers.get('x-real-ip')?.trim();
  if (!value || value.length > 64 || !/^[0-9a-f:.]+$/iu.test(value)) return undefined;
  return value;
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return json({ success: false, error: 'unsupported_media_type' }, 415);

  const incoming = await readLimitedBody(request, MAX_REQUEST_BYTES);
  if ('error' in incoming) {
    return json(
      { success: false, error: incoming.error },
      incoming.error === 'payload_too_large' ? 413 : 400,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(incoming.text);
  } catch {
    return json({ success: false, error: 'invalid_json' }, 400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return json({ success: false, error: 'invalid_payload' }, 400);
  }

  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) {
    return json({ success: false, error: 'payload_too_large' }, 413);
  }

  const backend = configuredBackendUrl();
  if ('error' in backend) return json({ success: false, error: backend.error }, 503);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  const clientIp = trustedProxyClientIp(request);
  let response: Response;
  try {
    response = await fetch(backend.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // The TenCorp sink applies the strict residence consent/project/unit
        // contract while preserving the existing legacy SAN'AT payload.
        'X-Tencorp-Lead-Contract': 'residence-v1',
        ...(clientIp ? { 'X-Real-IP': clientIp, 'X-Forwarded-For': clientIp } : {}),
      },
      body: serialized,
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (error) {
    return json(
      { success: false, error: error instanceof Error && error.name === 'AbortError' ? 'lead_delivery_timeout' : 'lead_delivery_unavailable' },
      502,
    );
  } finally {
    clearTimeout(timeout);
  }

  const responseBytes = new Uint8Array(await response.arrayBuffer());
  if (responseBytes.byteLength > MAX_RESPONSE_BYTES) {
    return json({ success: false, error: 'invalid_lead_backend_response' }, 502);
  }

  let responseBody: unknown;
  try {
    responseBody = JSON.parse(new TextDecoder().decode(responseBytes));
  } catch {
    return json({ success: false, error: 'invalid_lead_backend_response' }, 502);
  }
  if (!responseBody || typeof responseBody !== 'object' || Array.isArray(responseBody)) {
    return json({ success: false, error: 'invalid_lead_backend_response' }, 502);
  }
  if (response.ok && (responseBody as JsonObject).success !== true) {
    return json({ success: false, error: 'invalid_lead_backend_response' }, 502);
  }

  return json(
    response.ok
      ? { ...(responseBody as JsonObject), forwarded: true }
      : responseBody as JsonObject,
    response.status,
  );
}
