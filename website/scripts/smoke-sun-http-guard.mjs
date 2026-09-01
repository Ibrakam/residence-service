import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = new URL(process.argv[2] ?? process.env.SUN_GUARD_BASE_URL ?? 'http://localhost:3000');
assert(['http:', 'https:'].includes(baseUrl.protocol), 'SUN guard smoke base URL must use HTTP or HTTPS');

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
  ['uppercase source', '/SOURCE/sun/private-canonical.json'],
  ['mixed-case source', '/Source/SUN/private-canonical.json'],
  ['nested raw API source', '/source/sun/api/details/123.json'],
  ['double slash source', '/source//sun/private-canonical.json'],
  ['leading double slash source', '//SOURCE/sun/private-canonical.json'],
  ['leading triple slash source', '///SOURCE/sun/private-canonical.json'],
  ['encoded slash source', '/source%2Fsun/private-canonical.json'],
  ['double-encoded slash source', '/source%252Fsun/private-canonical.json'],
  ['encoded backslash source', '/source%5Csun/private-canonical.json'],
  ['double-encoded backslash source', '/source%255Csun/private-canonical.json'],
  ['deeply encoded slash source', `/source${deeplyEncodedSlash}sun/private-canonical.json`],
  ['over-cap encoded slash fails closed', `/source${overCapEncodedSlash}sun/private-canonical.json`],
  ['malformed escape source', '/SOURCE/%ZZ/../sun/private-canonical.json'],
  ['APFS long-s compatibility source', '/%C5%BFource/sun/private-canonical.json'],
  ['fullwidth compatibility source', '/%EF%BD%93ource/sun/private-canonical.json'],
  ['encoded dot segment source', '/source/decoy/%2e%2e/sun/private-canonical.json'],
  ['double-encoded dot segment source', '/source/decoy/%252e%252e/sun/private-canonical.json'],
  ['source raw query', '/SOURCE/sun/private-canonical.json?raw'],
  ['uppercase capture script', '/SCRIPTS/capture-sun.mjs'],
  ['double slash build script', '/SCRIPTS//build-sun-catalog.mjs'],
  ['encoded slash verifier script', '/SCRIPTS%2Fverify-sun.mjs'],
  ['leading double slash script', '//SCRIPTS/smoke-sun-http-guard.mjs'],
  ['production lead smoke source', '/SCRIPTS/smoke-sun-production-lead.mjs'],
  ['uppercase API source', '/APP/api/sun-lead/route.ts'],
  ['double slash API source', '/APP//api//sun-lead//route.ts'],
  ['leading double slash API source', '//APP/api/sun-lead/route.ts'],
  ['encoded API source separators', '/app%2Fapi%2Fsun-lead%2Froute.ts'],
  ['uppercase private data', '/DATA/sun-private.json'],
  ['legacy catalog data', '/DATA/sun-catalog.json'],
  ['double slash private data', '/DATA//sun-private-canonical.json'],
  ['encoded public-data suffix', '/data/sun-client.json%3Fraw'],
  ['@fs uppercase source', `${fsRoot}/SOURCE/SUN/private-canonical.json`],
  ['mixed-case @fs source', `${fsRoot.replace('/@fs', '/@FS')}/Source/SUN/private-canonical.json`],
  ['@fs encoded root slash', `/@fs/%2F${encodedWebsiteRoot.slice(1)}/source/sun/private-canonical.json`],
  ['@fs double-encoded root slash', `/@fs/%252F${encodedWebsiteRoot.slice(1)}/SOURCE/sun/private-canonical.json`],
  ['encoded @fs API source', `/%40fs${encodedWebsiteRoot}/APP/api/sun-lead/route.ts?raw`],
  ['@fs uppercase build script', `${fsRoot}/SCRIPTS/build-sun-catalog.mjs`],
];

for (const [label, target] of blocked) {
  const response = await directRequest(target);
  assert.equal(response.status, 404, `${label}: expected HTTP 404, received ${response.status}`);
  assert.equal(response.body, 'Not found', `${label}: response did not come from the private-source guard`);
  assert.match(String(response.headers['cache-control'] ?? ''), /(?:^|,)\s*no-store(?:,|$)/, `${label}: missing no-store`);
  assert.match(String(response.headers['content-type'] ?? ''), /^text\/plain\b/i, `${label}: unexpected content type`);
  console.log(`BLOCK 404 ${Buffer.byteLength(response.body)} ${label}`);
}

const publicCatalog = await directRequest('/data/sun-client.json');
assert.equal(publicCatalog.status, 200, 'Sanitized SUN public catalog must remain reachable');
const publicCatalogJson = JSON.parse(publicCatalog.body);
assert.equal(publicCatalogJson.units?.length, 51, 'Sanitized SUN public catalog has unexpected available-unit count');
for (const forbidden of ['api.macroserver.uz', 'auth_token', 'sourceUrl', 'localSourcePath', 'floorPlanSourceUrl', 'detailLocalPath']) {
  assert(!publicCatalog.body.includes(forbidden), `Sanitized SUN public catalog leaked ${forbidden}`);
}
console.log(`ALLOW 200 ${Buffer.byteLength(publicCatalog.body)} sanitized SUN client catalog`);

for (const target of ['/sun?lang=ru', '/sun/apartments?lang=en', '/robots.txt', '/sitemap.xml']) {
  const response = await directRequest(target);
  assert.equal(response.status, 200, `${target}: public route must remain reachable`);
  console.log(`ALLOW 200 ${Buffer.byteLength(response.body)} ${target}`);
}

const qaPayload = JSON.stringify({
  name: 'SUN HTTP Guard Probe',
  phone: '+998901234567',
  goal: 'live',
  consent: true,
  formContext: 'projectSlug=sun;lang=en;surface=landing:footer',
  projectSlug: 'sun',
  lang: 'en',
  language: 'en',
});
const qaLead = await directRequest('/api/sun-lead', {
  method: 'POST',
  body: qaPayload,
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(qaPayload), 'X-Sun-QA': '1' },
});
assert.equal(qaLead.status, 200, 'SUN POST API must remain reachable');
const qaBody = JSON.parse(qaLead.body);
assert.equal(qaBody.receipt, 'qa-test-local-only', 'SUN guard smoke QA lead must stay local-only');
assert.equal(qaBody.stored, false, 'SUN guard smoke QA lead must not be stored');
assert.equal(qaBody.forwarded, false, 'SUN guard smoke QA lead must not be forwarded');
console.log(`ALLOW 200 ${Buffer.byteLength(qaLead.body)} QA POST /api/sun-lead`);

console.log(`SUN HTTP guard smoke passed: ${blocked.length} private path variants blocked, sanitized data and 6 public/runtime requests allowed.`);
