const forbiddenKey = /(?:^|_)(?:access|refresh|id)?token(?:$|_)|auth(?:orization)?|cookie|password|passwd|secret|csrf|xsrf|session|jwt|credential|api[_-]?key|private[_-]?key|client[_-]?secret|special[_-]?notes?|external[_-]?link|comment|manager|customer|phone|email/i;
const jwt = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g;
const bearer = /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi;
const querySecret = /([?&](?:access_token|refresh_token|token|auth|authorization|signature|sig|key|code)=)[^&#\s"']+/gi;

function redactString(value) {
  return value
    .replace(jwt, '[REDACTED_JWT]')
    .replace(bearer, 'Bearer [REDACTED]')
    .replace(querySecret, '$1[REDACTED]');
}

export function sanitizeValue(value, depth = 0) {
  if (depth > 40) throw new Error('Response nesting exceeds safety limit');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value !== 'object') return null;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey.test(key)) {
      output[key] = '[REDACTED]';
      continue;
    }
    output[key] = sanitizeValue(child, depth + 1);
  }
  return output;
}

export function sanitizeJsonText(text, maximumBytes = 32 * 1024 * 1024) {
  const bytes = Buffer.byteLength(text);
  if (bytes > maximumBytes) throw new Error(`Response is too large (${bytes} bytes)`);
  const parsed = JSON.parse(text);
  return sanitizeValue(parsed);
}

export function sanitizeDomText(text, maximumBytes = 4 * 1024 * 1024) {
  if (Buffer.byteLength(text) > maximumBytes) throw new Error('DOM capture is too large');
  return redactString(text)
    .replace(/(<input\b[^>]*(?:type=["']?(?:password|email|tel)|name=["']?[^ >]*(?:token|password|phone|email))[^>]*\bvalue=)(["'])[^"']*\2/gi, '$1$2[REDACTED]$2')
    .replace(/(<meta\b[^>]*(?:csrf|token)[^>]*\bcontent=)(["'])[^"']*\2/gi, '$1$2[REDACTED]$2');
}

export function containsObviousSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  jwt.lastIndex = 0;
  bearer.lastIndex = 0;
  return jwt.test(text) || bearer.test(text) || /"(?:access_token|refresh_token|password|authorization|cookie|client_secret)"\s*:\s*"(?!\[REDACTED)/i.test(text);
}
