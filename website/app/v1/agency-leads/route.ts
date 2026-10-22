const MAX_BODY_BYTES = 4_096;
const TIMEOUT_MS = 8_000;
const INTERESTS = ['Купить квартиру', 'Продать недвижимость', 'Инвестиции', 'Аренда'];

function json(status: number, success: boolean, error?: string) {
  return Response.json({ success, ...(error ? { error } : {}) }, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}

async function boundedText(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new Error('missing_body');
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('payload_too_large');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  // Only this bounded homepage form is public. Residence forms and catalogues
  // retain their existing authentication boundary; no session reaches the sink.
  const origin = process.env.NODE_ENV === 'production'
    ? 'https://form.tencorp.uz' : new URL(request.url).origin;
  if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json(403, false, 'invalid_origin');
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json(415, false, 'unsupported_media_type');
  }
  const declaredSize = request.headers.get('content-length');
  if (declaredSize && (!/^\d+$/.test(declaredSize) || Number(declaredSize) > MAX_BODY_BYTES)) {
    return json(413, false, 'payload_too_large');
  }
  let raw: unknown;
  try { raw = JSON.parse(await boundedText(request.body)); }
  catch (error) { return json(error instanceof Error && error.message === 'payload_too_large' ? 413 : 400, false, 'invalid_payload'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return json(400, false, 'invalid_payload');
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['name', 'phone', 'interest', 'consent'].includes(key))) {
    return json(400, false, 'invalid_payload');
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name)
    || typeof input.phone !== 'string' || !/^\+998\d{9}$/.test(input.phone)
    || typeof input.interest !== 'string' || !INTERESTS.includes(input.interest)
    || input.consent !== true) return json(400, false, 'invalid_payload');

  let backend: URL;
  try {
    backend = new URL(process.env.LEAD_BACKEND_URL ?? '');
    if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.hash) throw new Error();
  } catch { return json(503, false, 'lead_delivery_unconfigured'); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const clientIp = request.headers.get('x-real-ip')?.trim();
  try {
    const response = await fetch(backend, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json',
        'X-Tencorp-Lead-Contract': 'agency-v1',
        ...(clientIp && clientIp.length <= 64 && /^[0-9a-f:.]+$/iu.test(clientIp) ? { 'X-Real-IP': clientIp } : {}),
      },
      body: JSON.stringify({ name, phone: input.phone, interest: input.interest, consent: true }),
      cache: 'no-store', signal: controller.signal,
    });
    const receipt = JSON.parse(await boundedText(response.body)) as { success?: boolean };
    if (!response.ok || receipt?.success !== true) {
      return json(response.status === 429 ? 429 : 502, false, 'lead_delivery_unconfirmed');
    }
    return json(200, true);
  } catch {
    return json(502, false, controller.signal.aborted ? 'lead_delivery_timeout' : 'lead_delivery_unavailable');
  } finally { clearTimeout(timeout); }
}
