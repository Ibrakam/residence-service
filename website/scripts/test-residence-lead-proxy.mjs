import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const received = [];
let responseMode = 'success';

const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  received.push({
    headers: request.headers,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
  });
  response.setHeader('Content-Type', 'application/json');
  if (responseMode === 'success') {
    response.end(JSON.stringify({ success: true, eventId: 'mock-event' }));
  } else {
    response.end(JSON.stringify({}));
  }
});

await new Promise((resolve, reject) => {
  upstream.once('error', reject);
  upstream.listen(0, '127.0.0.1', resolve);
});

try {
  const address = upstream.address();
  assert.ok(address && typeof address === 'object');
  process.env.LEAD_BACKEND_URL = `http://127.0.0.1:${address.port}/api/submit`;

  const { POST } = await import('../app/v1/leads/route.ts');
  const lead = {
    name: 'Mock User',
    phone: '+998901234567',
    goal: 'live',
    consent: true,
    projectSlug: 'mirador',
    lang: 'ru',
    language: 'ru',
    formContext: 'mirador:catalog:unit',
    unitKey: 'mock-unit-key',
  };

  const success = await POST(new Request('http://localhost/v1/leads', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Real-IP': '203.0.113.9',
      'X-Forwarded-For': '198.51.100.2',
    },
    body: JSON.stringify(lead),
  }));
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    success: true,
    eventId: 'mock-event',
    forwarded: true,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].headers['x-tencorp-lead-contract'], 'residence-v1');
  assert.equal(received[0].headers['x-real-ip'], '203.0.113.9');
  assert.equal(received[0].headers['x-forwarded-for'], '203.0.113.9');
  assert.deepEqual(received[0].body, lead);

  responseMode = 'invalid';
  const invalid = await POST(new Request('http://localhost/v1/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
  }));
  assert.equal(invalid.status, 502);
  assert.deepEqual(await invalid.json(), {
    success: false,
    error: 'invalid_lead_backend_response',
  });

  console.log('Residence lead proxy contract: PASS (mock upstream only; no CRM write)');
} finally {
  await new Promise((resolve) => upstream.close(resolve));
}
