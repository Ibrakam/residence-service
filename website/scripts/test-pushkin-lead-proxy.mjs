import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { POST } from '../app/v1/leads/route.ts';

// A local fake sink verifies the actual proxy contract without creating a lead
// in the user's production amoCRM or sending any contact data externally.
let captured;
const server = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  captured = { body: JSON.parse(body), contract: request.headers['x-tencorp-lead-contract'], method: request.method };
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ success: true, receipt: 'local-qa-only' }));
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const previous = process.env.LEAD_BACKEND_URL;
process.env.LEAD_BACKEND_URL = `http://127.0.0.1:${server.address().port}/v1/leads`;
try {
  const input = { projectSlug: 'pushkin', name: 'Local QA', phone: '+998000000000', consent: true,
    goal: 'live', language: 'ru', lang: 'ru', unitKey: 'taqsim:pushkin:10a2c39b-b652-49ec-9d6b-3f2889d93257',
    formContext: 'projectSlug=pushkin;lang=ru;surface=catalog:card', utm_source: 'local-qa' };
  const response = await POST(new Request('http://127.0.0.1/v1/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
  assert.equal(response.status, 200); assert.equal((await response.json()).forwarded, true);
  assert.equal(captured.contract, 'residence-v1'); assert.equal(captured.method, 'POST');
  assert.deepEqual(captured.body, input);
  const bad = await POST(new Request('http://127.0.0.1/v1/leads', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'no' }));
  assert.equal(bad.status, 415);
  console.log('Pushkin lead proxy: shared residence contract, project/unit identity, consent, attribution and successful upstream acknowledgement passed (local mock only).');
} finally {
  if (previous === undefined) delete process.env.LEAD_BACKEND_URL; else process.env.LEAD_BACKEND_URL = previous;
  server.close(); server.closeAllConnections();
}
