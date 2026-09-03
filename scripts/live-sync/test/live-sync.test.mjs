import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLoopbackCdp, matchAllowedUrl, safeUrlMetadata } from '../src/allowlist.mjs';
import { atomicRunDirectory, atomicWriteFile, pruneRunDirectories } from '../src/atomic.mjs';
import { classifyRequest, parseUysotReadOnlyBody } from '../src/capture.mjs';
import { directSourceInternals } from '../src/direct.mjs';
import { loadTemplate } from '../src/cli.mjs';
import { normalizeNrgBiCapture, normalizeRegnumPages, normalizeSunPages, normalizeUysotTable } from '../src/normalize.mjs';
import { getProvider } from '../src/providers.mjs';
import { containsObviousSecret, sanitizeValue } from '../src/redact.mjs';

test('CLI executes when the installed package is reached through a release symlink', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'live-sync-symlink-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const link = join(root, 'current');
  await symlink(fileURLToPath(new URL('../', import.meta.url)), link, 'dir');
  const output = execFileSync(process.execPath, [join(link, 'src', 'cli.mjs'), 'status', '--json'], { encoding: 'utf8' });
  const rows = JSON.parse(output);
  assert.ok(Array.isArray(rows) && rows.some((row) => row.id === 'mbc'));
});

test('CDP is loopback-only and safe URL metadata drops values', () => {
  assert.equal(assertLoopbackCdp('http://127.0.0.1:9222').port, '9222');
  assert.throws(() => assertLoopbackCdp('http://46.62.227.229:9222'), /loopback/);
  assert.deepEqual(safeUrlMetadata('https://example.test/x?token=secret&page=2'), {
    origin: 'https://example.test', path: '/x', queryKeys: ['page', 'token'],
  });
});

test('Uysot POST exception is exact, bounded, and preserves the required order shape', () => {
  const input = JSON.stringify({ page: 4, size: 10, orders: {}, houseId: [1074] });
  assert.deepEqual(parseUysotReadOnlyBody(input), { page: 1, size: 500, orders: {}, houseId: [1074] });
  assert.throws(() => parseUysotReadOnlyBody(JSON.stringify({ page: 1, size: 10, orders: {}, houseId: [1074], delete: true })), /unexpected keys/);
  assert.throws(() => parseUysotReadOnlyBody(JSON.stringify({ page: 1, size: 10, orders: {}, houseId: [1] })), /1074/);
  assert.equal(classifyRequest(getProvider('uysot'), { method: 'POST', url: 'https://service.app.uysot.uz/v1/smart-catalog/table', postData: input }).action, 'continue-read-post');
  assert.deepEqual(
    classifyRequest(getProvider('uysot'), {
      method: 'POST',
      url: 'https://app.uysot.uz/.well-known/vercel/security/request-challenge',
      postData: 'opaque-browser-verification-body',
    }),
    { action: 'continue-browser-verification' },
    'the exact Uysot host checkpoint may pass through without reading or retaining its opaque body',
  );
  assert.equal(classifyRequest(getProvider('uysot'), { method: 'POST', url: 'https://app.uysot.uz/.well-known/vercel/security/request-challenge?unexpected=1', postData: '{}' }).action, 'block');
  assert.equal(classifyRequest(getProvider('uysot'), { method: 'POST', url: 'https://service.app.uysot.uz/.well-known/vercel/security/request-challenge', postData: '{}' }).action, 'block');
  assert.equal(classifyRequest(getProvider('uysot'), { method: 'POST', url: 'https://service.app.uysot.uz/v1/smart-catalog/delete', postData: input }).action, 'block');
  assert.ok(getProvider('uysot').launchFlags.includes('--enable-unsafe-swiftshader'));
});

test('provider allowlist rejects unexpected Kayan query keys', () => {
  const provider = getProvider('kayan');
  assert.ok(matchAllowedUrl(provider, 'https://pb21432.profitbase.ru/api/v4/json/property?houseId=154813&returnFilteredCount=true&showQueueCount=true'));
  assert.equal(matchAllowedUrl(provider, 'https://pb21432.profitbase.ru/api/v4/json/property?houseId=154813&apiKey=secret'), null);
  assert.equal(matchAllowedUrl(provider, 'https://pb21432.profitbase.ru/api/v4/json/property-delete?houseId=154813'), null);
});

test('redaction removes personal/capability fields and secret scan is repeatable', () => {
  const sanitized = sanitizeValue({ external_link: 'https://capability.test/opaque', special_notes: 'private', nested: { password: 'secret' } });
  assert.deepEqual(sanitized, { external_link: '[REDACTED]', special_notes: '[REDACTED]', nested: { password: '[REDACTED]' } });
  const token = ['eyJ', 'abcdefghijklmnop', '.', 'abcdefghijklmnop', '.', 'abcdefghijklmnop'].join('');
  assert.equal(containsObviousSecret(token), true);
  assert.equal(containsObviousSecret(token), true);
});

test('direct-source bodies use exact read-only scopes', () => {
  const provider = getProvider('nrg-bi');
  const project = provider.projectDefinitions[0];
  assert.deepEqual(Object.keys(directSourceInternals.nrgPlacementBody(provider, project, 1)).sort(), ['companyIds', 'filterTags', 'pageNo', 'pageSize', 'propertyTypes', 'realEstateUUIDs']);
  assert.equal(directSourceInternals.nrgPlacementBody(provider, project, 1).pageSize, 300);
  const sun = directSourceInternals.sunObjectsBody(7);
  assert.equal(sun.action, 'objects_list');
  assert.equal(sun.auth_token, null);
  assert.deepEqual(Object.keys(sun.data).sort(), ['activity', 'cabinetMode', 'category', 'complex_id', 'filters', 'page']);
});

test('publishable providers require complete public artwork templates', async () => {
  const kayan = await loadTemplate('kayan');
  assert.equal(kayan.projects.length, 2);
  assert.ok(kayan.projects.reduce((sum, project) => sum + project.layouts.length, 0) > 0);
  const root = await mkdtemp(join(tmpdir(), 'live-sync-template-'));
  const incomplete = join(root, 'kayan-catalog.json');
  await writeFile(incomplete, JSON.stringify({ projects: [] }));
  await assert.rejects(loadTemplate('kayan', incomplete), /enrichment template is incomplete/);
});

test('Uysot normalization requires and emits a complete 268-row universe', () => {
  const rows = Array.from({ length: 268 }, (_, index) => {
    const building = index < 90 ? ['B1', 1] : index < 180 ? ['A', 2] : ['B2', 3];
    return {
      id: index + 1, number: String(index + 1), floor: 1, rooms: '1', area: 40, totalArea: 40,
      apartment: true, repaired: false, commerceStatus: index === 0 ? 'BOOKED' : 'SALE',
      pricePeraAreaRepaired: 1, pricePerAreaNotRepaired: 1, priceRepaired: 40, priceNotRepaired: 40,
      buildingName: building[0], buildingId: building[1], houseName: 'Avalon', houseId: 1074,
      currency: { ccy: 'UZS' }, companyId: 504, entrance: 1,
    };
  });
  const result = normalizeUysotTable({ accept: true, errors: [], errorMessage: null, data: { data: rows, totalPages: 1, currentPage: 1, totalElements: 268 } });
  assert.equal(result.audit.complete, true);
  assert.equal(result.artifact.units.length, 268);
});

test('Regnum normalization enforces both public and CRM identities', () => {
  const row = { id: 1, crm_id: 11, square: 50, floor: 2, rooms: 2, project_slug: 'regnum-plaza', status: 'AVAILABLE', queue: '1', section: '2', number: '12', end: '2026' };
  const result = normalizeRegnumPages([{ plans: { total: 1, current_page: 1, last_page: 1, data: [row] } }]);
  assert.equal(result.audit.uniqueCrmIds, 1);
  assert.equal(result.artifact.units[0].sourceId, '11');
});

function sunRow(id, number) {
  return {
    id, status: 'available', public_house_name: 'ЖК SUN (Блок А)', houseFloors: 12,
    estate: { house: 1, estate_floor: 2, estate_rooms: 1, estate_area: '40.5', geo_flatnum: number, geo_house_entrance: 1, estate_price: 100, estate_price_m2: 2 },
  };
}

test('SUN normalization accepts intentional page overlap but rejects conflicts', () => {
  const first = sunRow(1, 'A1');
  const second = sunRow(2, 'A2');
  const result = normalizeSunPages([
    { objects: [first, second], count: 2, isLastPage: false },
    { objects: [second], count: 2, isLastPage: true },
  ]);
  assert.equal(result.audit.observedRecords, 2);
  assert.throws(() => normalizeSunPages([
    { objects: [first, second], count: 2, isLastPage: false },
    { objects: [{ ...second, status: 'sold' }], count: 2, isLastPage: true },
  ]), /conflicting duplicate/);
});

test('NRG normalization covers all eleven project adapters and requires an empty terminal page', () => {
  const provider = getProvider('nrg-bi');
  const groups = provider.projectDefinitions.map((project, index) => ({
    project,
    apartmentPropertyTypeUUID: provider.apartmentPropertyTypeUUID,
    pages: [
      { placements: [{
        uuid: `unit-${index}`, realEstateUUID: project.realEstateUUID, roomCount: 1, name: '1', square: 40,
        floor: 2, entrance: 1, priceBySquare: 10, maxFloor: 10, blockName: 'Block 1', blockId: `block-${index}`,
        totalPrice: 400, totalPriceWithDiscount: 400, placementStatusName: 'Снятие резерва', isSale: true,
        propertyType: { uuid: provider.apartmentPropertyTypeUUID, name: 'Квартира' },
      }] },
      { placements: [] },
    ],
    realEstate: { realEstates: [{ uuid: project.realEstateUUID, placementCount: 1, propertyTypes: [{ uuid: provider.apartmentPropertyTypeUUID, name: 'Квартира' }] }] },
  }));
  const result = normalizeNrgBiCapture(groups);
  assert.equal(result.artifacts.length, 11);
  assert.ok(Object.values(result.audit).every((audit) => audit.complete));
  groups[0].pages.pop();
  assert.throws(() => normalizeNrgBiCapture(groups), /pagination evidence/);
});

test('atomic writes publish complete mode-0600 files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-sync-test-'));
  const path = join(root, 'nested', 'catalog.json');
  await atomicWriteFile(path, '{"ok":true}\n');
  assert.equal(await readFile(path, 'utf8'), '{"ok":true}\n');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('retention keeps current, bounds successful runs, and never touches staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'live-sync-retention-'));
  const retention = { successfulRuns: 2, failedRuns: 1, maximumAgeMs: 60_000, maximumBytes: 1024 * 1024, raceGraceMs: 0 };
  for (let index = 0; index < 4; index += 1) {
    await atomicRunDirectory(root, 'test-provider', [
      ['capture-index.json', JSON.stringify({ index })],
      ['completeness.json', JSON.stringify({ complete: true })],
      ['success.json', JSON.stringify({ complete: true })],
    ], retention);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const providerRoot = join(root, 'test-provider');
  let pointer = JSON.parse(await readFile(join(providerRoot, 'current.json'), 'utf8'));
  let runs = (await readdir(providerRoot)).filter((name) => /^\d{4}-/.test(name));
  assert.equal(runs.length, 2);
  assert.ok(runs.includes(pointer.runId));

  for (let index = 0; index < 2; index += 1) {
    await atomicRunDirectory(root, 'test-provider', [['capture-index.json', JSON.stringify({ failed: index })]], retention);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  pointer = JSON.parse(await readFile(join(providerRoot, 'current.json'), 'utf8'));
  runs = (await readdir(providerRoot)).filter((name) => /^\d{4}-/.test(name));
  const classifications = await Promise.all(runs.map(async (runId) => {
    try { await stat(join(providerRoot, runId, 'success.json')); return 'successful'; } catch { return 'failed'; }
  }));
  assert.equal(classifications.filter((value) => value === 'successful').length, 2);
  assert.equal(classifications.filter((value) => value === 'failed').length, 1);
  assert.ok(runs.includes(pointer.runId));

  const staging = join(providerRoot, '.staging-manual');
  await mkdir(staging);
  await writeFile(join(staging, 'in-progress'), 'do not delete');
  await pruneRunDirectories(providerRoot, 'test-provider', { ...retention, successfulRuns: 1, maximumAgeMs: 1, maximumBytes: 1 });
  const finalRuns = (await readdir(providerRoot)).filter((name) => /^\d{4}-/.test(name));
  assert.deepEqual(finalRuns, [pointer.runId]);
  assert.equal(await readFile(join(staging, 'in-progress'), 'utf8'), 'do not delete');
});
