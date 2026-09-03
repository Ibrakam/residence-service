function fail(message) {
  throw new Error(message);
}

export function assertLoopbackCdp(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:') fail('CDP endpoint must use http on loopback');
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) fail('CDP endpoint must be bound to loopback');
  if (url.username || url.password || url.search || url.hash) fail('CDP endpoint must not contain credentials, query, or fragment');
  return url;
}

export function matchAllowedUrl(provider, value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  for (const rule of provider.allowedResponses) {
    if (url.protocol !== rule.protocol || url.hostname !== rule.host) continue;
    if (!rule.pathPrefixes.some((pattern) => pattern.endsWith('*') ? url.pathname.startsWith(pattern.slice(0, -1)) : url.pathname === pattern)) continue;
    if (rule.queryKeys) {
      for (const key of url.searchParams.keys()) if (!rule.queryKeys.includes(key)) return null;
    }
    return { rule, url };
  }
  return null;
}

export function assertAllowedUrl(provider, value) {
  const match = matchAllowedUrl(provider, value);
  if (!match) fail(`${provider.id}: URL is outside the source allowlist`);
  return match.url;
}

export function assertAllowedMethod(provider, method) {
  const normalized = String(method || '').toUpperCase();
  if (!provider.allowedMethods.includes(normalized)) fail(`${provider.id}: method ${normalized || '(empty)'} is not allowed`);
  return normalized;
}

export function safeUrlMetadata(value) {
  const url = new URL(value);
  // Query values can carry opaque access data. Keep only sorted parameter names.
  const queryKeys = [...new Set(url.searchParams.keys())].sort();
  return {
    origin: url.origin,
    path: url.pathname,
    queryKeys,
  };
}
