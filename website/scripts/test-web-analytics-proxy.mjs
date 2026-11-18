import assert from 'node:assert/strict';
import { webAnalyticsProxyHeaders } from '../lib/web-analytics-proxy.mjs';

const token = 'public_signed_identifier.' + 's'.repeat(43);
const headers = new Headers({
  'x-tencorp-web-visitor': token, 'x-tencorp-web-session': token,
  Cookie: '__Host-tencorp_session=must-not-forward', Authorization: 'Basic must-not-forward',
  'x-auth-user-id': '123',
});
assert.deepEqual(webAnalyticsProxyHeaders(headers), { 'x-tencorp-web-visitor': token, 'x-tencorp-web-session': token });
headers.set('DNT', '1');
assert.deepEqual(webAnalyticsProxyHeaders(headers), { DNT: '1' });
headers.set('Sec-GPC', '1');
assert.deepEqual(webAnalyticsProxyHeaders(headers), { 'Sec-GPC': '1' });
assert.deepEqual(webAnalyticsProxyHeaders(new Headers({ 'x-tencorp-web-visitor': 'bad', 'x-tencorp-web-session': 'x'.repeat(401) })), {});
console.log('Web analytics proxy: bounded signed tokens only, no login credentials, and privacy signals suppress analytics identity.');
