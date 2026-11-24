import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, globals = {}) {
  const file = new URL(path, import.meta.url);
  const source = readFileSync(file, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Response, Request, URL, Uint8Array,
    TextDecoder, AbortSignal, process: { env: {} }, fetch: globals.fetch, Date: globals.Date || Date,
    require(name) { assert.equal(name, '../app/construction-passports');return load('../app/construction-passports.ts'); },
  }, { filename: file.pathname });
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const now = Date.parse('2026-11-24T00:00:00Z');
const health = { items: [{ provider: 'PRIVATE_PROVIDER', error: 'PRIVATE_TOKEN', projects: [
  { projectSlug: '4u', status: 'succeeded', freshness: 'fresh', lastCapturedAt: '2026-11-23T23:59:00Z', freshUntil: '2026-11-24T01:00:00Z', secret: 'PRIVATE' },
  { projectSlug: 'unpublished-import', secret: 'PRIVATE' },
] }] };
const status = load('../lib/public-catalog-status.ts');
const safe = plain(status.publicCatalogStatus(health, now));
assert.deepEqual(safe, { items: [{ projects: [{ projectSlug: '4u', status: 'succeeded', freshness: 'fresh', lastCapturedAt: '2026-11-23T23:59:00Z', freshUntil: '2026-11-24T01:00:00Z' }] }] });
assert.ok(!JSON.stringify(safe).includes('PRIVATE'));
assert.equal(status.publicCatalogStatus(health, now + 2 * 3600_000).items[0].projects[0].freshness, 'stale');
const future = structuredClone(health);future.items[0].projects[0].lastCapturedAt = '2027-01-01T00:00:00Z';
assert.equal(status.publicCatalogStatus(future, now).items[0].projects[0].freshness, 'stale');
const duplicate = structuredClone(health);duplicate.items[0].projects.push(duplicate.items[0].projects[0]);
assert.throws(() => status.publicCatalogStatus(duplicate, now));
assert.throws(() => status.publicCatalogStatus({ items: [{}] }, now));
let requests = 0, clock = now, mode = 'ok';
class Clock extends Date { static now() { return clock; } }
const cached = load('../lib/public-catalog-status.ts', { Date: Clock, fetch: async (url, init) => {
  requests++;assert.equal(url, 'http://127.0.0.1:4300/v1/sync/catalog-status');assert.equal(init.redirect, 'error');assert.equal(init.credentials, 'omit');
  if (mode === 'failure') throw Error('offline');
  if (mode === 'oversize') return new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': String(129 * 1024) } });
  return Response.json(health);
} });
await Promise.all(Array.from({length:20}, () => cached.loadPublicCatalogStatus()));assert.equal(requests, 1);
await cached.loadPublicCatalogStatus();assert.equal(requests, 1);
clock += 5001;mode = 'failure';await assert.rejects(cached.loadPublicCatalogStatus());assert.equal(requests, 2);
mode = 'oversize';await assert.rejects(cached.loadPublicCatalogStatus());assert.equal(requests, 3);
mode = 'ok';await cached.loadPublicCatalogStatus();assert.equal(requests, 4);

const companyIds = ['5cba02b4-8abd-11ee-ab79-001dd8b7289a'];
const realEstateUUIDs = ['f318fc96-8c05-40df-a695-6de9b9a695c0'];
const propertyTypes = ['5990a172-812a-4fee-b4f5-c860cca824d7'];
const input = { companyIds, realEstateUUIDs, propertyTypes, pageNo: 1, pageSize: 200 };
const upstreamData = { placements: [{ uuid: 'public-unit', realEstateUUID: realEstateUUIDs[0], roomCount: 2, square: 53.57, totalPrice: 100, isSale: true,
  photoURL200: 'https://cdn.example/plan.png', photoURL400: 'javascript:alert(1)', photoURL1600: 'https://user:secret@cdn.example/plan.png',
  individualBooking: { customer: { phone: 'PRIVATE' } }, isFavorite: true, liquidityId: 'PRIVATE', discount: {stock: 'PRIVATE'},
  propertyType: { uuid: propertyTypes[0], name: 'Квартира', customer: 'PRIVATE' }, layoutType: {name:'2 комнаты'} }], parkingSchemes: {token:'PRIVATE'} };
let posts = 0;
const nrg = load('../lib/public-sanat-placements.ts', { fetch: async (url, init) => {
  posts++;assert.equal(url, 'https://apigw.bi.group/sales-picker/microfe-v3/placementList');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  assert.deepEqual(JSON.parse(init.body), input);assert.deepEqual(Object.keys(init.headers).sort(), ['Accept','Content-Type']);
  return Response.json(upstreamData);
} });
assert.deepEqual(plain(nrg.sanatPlacementInput(input)), input);
for (const invalid of [{...input,pageNo:0},{...input,pageSize:201},{...input,pageNo:1.1},{...input,companyIds:['OTHER']},{...input,extra:'field'}]) assert.throws(() => nrg.sanatPlacementInput(invalid), error => error.status === 400);
const projected = plain(nrg.publicSanatPlacements(upstreamData));
assert.equal(projected.placements[0].photoURL200, 'https://cdn.example/plan.png');
assert.equal(projected.placements[0].isSale, true, 'the public availability boolean is required by the actual catalogue client');
assert.ok(!('isFavorite' in projected.placements[0]), 'availability must not expose unrelated boolean metadata');
assert.ok(!('photoURL400' in projected.placements[0]));assert.ok(!('photoURL1600' in projected.placements[0]));
assert.equal(projected.parkingSchemes,null);assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
const availabilityFixtures = plain(nrg.publicSanatPlacements({ placements: [
  upstreamData.placements[0],
  { ...upstreamData.placements[0], uuid: 'sold-unit', isSale: false },
  ...['true', 1, null, { available: true }, undefined].map((isSale, index) => ({
    ...upstreamData.placements[0], uuid: `malformed-${index}`, isSale,
  })),
] })).placements;
assert.equal(availabilityFixtures[1].isSale, false, 'a sold unit must retain false rather than become available');
for (const unit of availabilityFixtures.slice(2)) assert.ok(!Object.hasOwn(unit, 'isSale'), 'malformed availability values must be omitted');
// Match the production SANAT client's post-pagination availability predicate.
const visibleUnits = availabilityFixtures.filter(unit => unit && unit.isSale === true
  && typeof unit.uuid === 'string' && Number.isFinite(unit.square) && Number.isFinite(unit.totalPrice));
assert.deepEqual(visibleUnits.map(unit => unit.uuid), ['public-unit'], 'the real client filter must retain the available priced unit and exclude sold/malformed availability');
assert.throws(() => nrg.publicSanatPlacements({placements:[{realEstateUUID:'OTHER'}]}));
const request = (body = JSON.stringify(input), headers={}) => new Request('https://form.tencorp.uz/api/nrg-apartments', {method:'POST',headers:{'Content-Type':'application/json', Origin:'https://form.tencorp.uz',...headers},body});
await nrg.requestSanatPlacements(request());assert.equal(posts,1);
for (const [req,code] of [[request('{}'),400],[request('['),400],[request('x'.repeat(4097)),413],[request(undefined,{'Content-Type':'text/plain'}),415],[request(undefined,{Origin:'https://other.example'}),403],[request(undefined,{'Sec-Fetch-Site':'cross-site'}),403]]) await assert.rejects(nrg.requestSanatPlacements(req), error => error.status === code);
assert.equal(posts,1,'invalid input must never contact upstream');
console.log('Public consumer projections, privacy, bounds, cache and fixed upstreams: PASS');
