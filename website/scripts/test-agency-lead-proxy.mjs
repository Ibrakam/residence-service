import assert from 'node:assert/strict';
import { POST } from '../app/v1/agency-leads/route.ts';

const oldFetch = globalThis.fetch;
const oldUrl = process.env.LEAD_BACKEND_URL;
const oldMode = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';
process.env.LEAD_BACKEND_URL = 'http://127.0.0.1:3000/api/submit';
const valid = { name: 'Test Person', phone: '+998901234567', interest: 'Продать недвижимость', consent: true };
const request = (body = valid, headers = {}) => new Request('http://127.0.0.1:4320/v1/agency-leads', {
  method: 'POST', headers: { Origin: 'https://form.tencorp.uz', 'Content-Type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls += 1;
  assert.equal(String(url), process.env.LEAD_BACKEND_URL);
  assert.equal(options.headers['X-Tencorp-Lead-Contract'], 'agency-v1');
  assert.deepEqual(JSON.parse(options.body), valid);
  assert.equal(options.headers.Cookie, undefined);
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers['X-Forwarded-For'], undefined);
  assert.equal(options.headers['X-Real-IP'], '1.2.3.4');
  return Response.json({ success: true, leadId: 123, secret: 'must not leak' });
};
try {
  const result = await POST(request(valid, { 'X-Real-IP': '1.2.3.4', Cookie: 'private', 'X-Forwarded-For': 'spoof' }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { success: true });
  for (const body of [{ ...valid, consent: false }, { ...valid, projectSlug: 'sanat' }, { ...valid, phone: '123' }, { ...valid, name: '\nName' }, { ...valid, interest: 'unknown' }, [], 'invalid']) {
    // Leading/trailing whitespace is deliberately normalized, embedded controls are not.
    if (body?.name === '\nName') body.name = 'Na\nme';
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal((await POST(request(valid, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await POST(request(valid, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal((await POST(request('x'.repeat(4097)))).status, 413);
  assert.equal(calls, 1);
  for (const response of [Response.json({}), Response.json({ success: false }), new Response('HTML'), Response.json({ success: true }, { status: 500 })]) {
    globalThis.fetch = async () => response;
    assert.equal((await POST(request())).status, 502);
  }
  globalThis.fetch = async () => Response.json({ success: false }, { status: 429 });
  assert.equal((await POST(request())).status, 429);
  globalThis.fetch = async () => { throw new Error('network'); };
  assert.equal((await POST(request())).status, 502);
  delete process.env.LEAD_BACKEND_URL;
  assert.equal((await POST(request())).status, 503);
  console.log('Agency lead proxy: origin, bounded payload, consent, strict receipt, safe errors PASS; no real leads sent');
} finally {
  globalThis.fetch = oldFetch;
  if (oldUrl === undefined) delete process.env.LEAD_BACKEND_URL; else process.env.LEAD_BACKEND_URL = oldUrl;
  if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
}
