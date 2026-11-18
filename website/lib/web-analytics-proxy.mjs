/**
 * Forward edge-selected analytics tokens, never login credentials.
 * @param {Headers} headers
 * @returns {Record<string, string>}
 */
export function webAnalyticsProxyHeaders(headers) {
  if (headers.get('sec-gpc') === '1') return { 'Sec-GPC': '1' };
  if (headers.get('dnt') === '1') return { DNT: '1' };
  /** @type {Record<string, string>} */
  const selected = {};
  for (const name of ['x-tencorp-web-visitor', 'x-tencorp-web-session']) {
    const value = headers.get(name);
    if (value && value.length <= 400 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) selected[name] = value;
  }
  return selected;
}
