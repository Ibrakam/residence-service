import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = new URL(process.argv[2] ?? process.env.REGNUM_GUARD_BASE_URL ?? 'http://localhost:3000');
assert(['http:', 'https:'].includes(baseUrl.protocol), 'Guard smoke base URL must use HTTP or HTTPS');

const basePrefix = baseUrl.pathname === '/' ? '' : baseUrl.pathname.replace(/\/$/, '');
const encodedWebsiteRoot = websiteRoot.split('/').map(encodeURIComponent).join('/');
const fsRoot = `/@fs${encodedWebsiteRoot}`;
const deeplyEncodedSlash = Array.from({ length: 24 }).reduce((value) => encodeURIComponent(value), '/');
const overCapEncodedSlash = Array.from({ length: 40 }).reduce((value) => encodeURIComponent(value), '/');

function directRequest(target, { method = 'GET', body, headers = {} } = {}) {
  const transport = baseUrl.protocol === 'https:' ? httpsRequest : httpRequest;
  const requestPath = `${basePrefix}${target.startsWith('/') ? target : `/${target}`}`;
  return new Promise((resolveRequest, rejectRequest) => {
    const request = transport({
      protocol: baseUrl.protocol,
      hostname: baseUrl.hostname,
      port: baseUrl.port || undefined,
      method,
      path: requestPath,
      headers: { Accept: '*/*', Connection: 'close', ...headers },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolveRequest({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(20_000, () => request.destroy(new Error(`Timed out requesting ${target}`)));
    request.on('error', rejectRequest);
    if (body) request.write(body);
    request.end();
  });
}

const blocked = [
  ['uppercase source', '/SOURCE/regnum-plaza/private-canonical.json'],
  ['mixed-case source', '/Source/Regnum-Plaza/private-canonical.json'],
  ['double slash source', '/source//regnum-plaza/private-canonical.json'],
  ['leading double slash source', '//SOURCE/regnum-plaza/private-canonical.json'],
  ['leading triple slash source', '///SOURCE/regnum-plaza/private-canonical.json'],
  ['encoded slash source', '/source%2Fregnum-plaza/private-canonical.json'],
  ['double-encoded slash source', '/source%252Fregnum-plaza/private-canonical.json'],
  ['encoded backslash source', '/source%5Cregnum-plaza/private-canonical.json'],
  ['double-encoded backslash source', '/source%255Cregnum-plaza/private-canonical.json'],
  ['deeply encoded slash source', `/source${deeplyEncodedSlash}regnum-plaza/private-canonical.json`],
  ['over-cap encoded slash fails closed', `/source${overCapEncodedSlash}regnum-plaza/private-canonical.json`],
  ['malformed escape source', '/SOURCE/%ZZ/../regnum-plaza/private-canonical.json'],
  ['APFS long-s compatibility source', '/%C5%BFource/regnum-plaza/private-canonical.json'],
  ['fullwidth compatibility source', '/%EF%BD%93ource/regnum-plaza/private-canonical.json'],
  ['encoded dot segment source', '/source/decoy/%2e%2e/regnum-plaza/private-canonical.json'],
  ['double-encoded dot segment source', '/source/decoy/%252e%252e/regnum-plaza/private-canonical.json'],
  ['source raw query', '/SOURCE/regnum-plaza/private-canonical.json?raw'],
  ['uppercase build script', '/SCRIPTS/build-regnum-plaza-catalog.mjs'],
  ['double slash build script', '/SCRIPTS//build-regnum-plaza-catalog.mjs'],
  ['encoded slash build script', '/SCRIPTS%2Fbuild-regnum-plaza-catalog.mjs'],
  ['leading double slash build script', '//SCRIPTS/build-regnum-plaza-catalog.mjs'],
  ['mixed verifier script', '/Scripts/VERIFY-Regnum-Plaza.mjs?import'],
  ['guard smoke source', '/scripts/smoke-regnum-plaza-http-guard.mjs?url'],
  ['production lead smoke source', '/SCRIPTS/smoke-regnum-plaza-production-lead.mjs'],
  ['uppercase API source', '/APP/api/regnum-plaza-lead/route.ts'],
  ['double slash API source', '/APP//api//regnum-plaza-lead//route.ts'],
  ['leading double slash API source', '//APP/api/regnum-plaza-lead/route.ts'],
  ['encoded API source separators', '/app%2Fapi%2Fregnum-plaza-lead%2Froute.ts'],
  ['uppercase legacy data', '/DATA/regnum-plaza-catalog.json'],
  ['double slash legacy data', '/DATA//regnum-plaza-catalog.json'],
  ['encoded legacy data suffix', '/data/regnum-plaza-catalog.json%3Fraw'],
  ['@fs uppercase source', `${fsRoot}/SOURCE/Regnum-Plaza/private-canonical.json`],
  ['mixed-case @fs source', `${fsRoot.replace('/@fs', '/@FS')}/Source/Regnum-Plaza/private-canonical.json`],
  ['@fs encoded root slash', `/@fs/%2F${encodedWebsiteRoot.slice(1)}/source/regnum-plaza/private-canonical.json`],
  ['@fs double-encoded root slash', `/@fs/%252F${encodedWebsiteRoot.slice(1)}/SOURCE/regnum-plaza/private-canonical.json`],
  ['encoded @fs API source', `/%40fs${encodedWebsiteRoot}/APP/api/regnum-plaza-lead/route.ts?raw`],
  ['@fs uppercase script', `${fsRoot}/SCRIPTS/build-regnum-plaza-catalog.mjs`],
];

for (const [label, target] of blocked) {
  const response = await directRequest(target);
  assert.equal(response.status, 404, `${label}: expected HTTP 404, received ${response.status}`);
  assert.equal(response.body, 'Not found', `${label}: response did not come from the Regnum guard`);
  assert.match(String(response.headers['cache-control'] ?? ''), /(?:^|,)\s*no-store(?:,|$)/, `${label}: missing no-store`);
  assert.match(String(response.headers['content-type'] ?? ''), /^text\/plain\b/i, `${label}: unexpected content type`);
  console.log(`BLOCK 404 ${Buffer.byteLength(response.body)} ${label}`);
}

const publicCatalog = await directRequest('/data/regnum-plaza-client.json');
assert.equal(publicCatalog.status, 200, 'Sanitized public catalog must remain reachable');
const publicCatalogJson = JSON.parse(publicCatalog.body);
assert.equal(publicCatalogJson.units?.length, 12, 'Sanitized public catalog has unexpected unit count');
for (const forbidden of ['crmId', 'effectivePrice', 'regularPrice', 'pricePerM2', '1247619891', '10729747600']) {
  assert(!publicCatalog.body.includes(forbidden), `Sanitized public catalog leaked ${forbidden}`);
}
console.log(`ALLOW 200 ${Buffer.byteLength(publicCatalog.body)} sanitized client catalog`);

for (const target of ['/regnum-plaza?lang=ru', '/regnum-plaza/apartments?lang=en']) {
  const response = await directRequest(target);
  assert.equal(response.status, 200, `${target}: public page must remain reachable`);
  console.log(`ALLOW 200 ${Buffer.byteLength(response.body)} ${target}`);
}

const qaPayload = JSON.stringify({
  name: 'QA Test HTTP Guard',
  phone: '+998901234567',
  goal: 'live',
  consent: true,
  formContext: 'projectSlug=regnum-plaza;lang=en;surface=landing:footer',
  projectSlug: 'regnum-plaza',
  lang: 'en',
  language: 'en',
});
const qaLead = await directRequest('/api/regnum-plaza-lead', {
  method: 'POST',
  body: qaPayload,
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(qaPayload), 'X-Regnum-QA': '1' },
});
assert.equal(qaLead.status, 200, 'Regnum POST API must remain reachable');
assert.equal(JSON.parse(qaLead.body).receipt, 'qa-test-local-only', 'Guard smoke QA lead must stay local-only');
console.log(`ALLOW 200 ${Buffer.byteLength(qaLead.body)} QA POST /api/regnum-plaza-lead`);

console.log(`Regnum HTTP guard smoke passed: ${blocked.length} private path variants blocked by guard, 4 public/runtime requests allowed.`);
