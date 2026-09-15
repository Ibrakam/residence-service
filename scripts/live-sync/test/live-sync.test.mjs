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
import { captureFromDirectSource, directSourceInternals } from '../src/direct.mjs';
import { loadTemplate } from '../src/cli.mjs';
import { opaqueMbcSourceKey, templateMbcSourceKey } from '../src/mbc-identity.mjs';
import { normalizeKayanPropertyResponses, normalizeMbcProjects, normalizeNrgBiCapture, normalizeRegnumPages, normalizeSunPages, normalizeUysotTable } from '../src/normalize.mjs';
import { getProvider, mbcProjects } from '../src/providers.mjs';
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
  assert.deepEqual(mbcProjects.map(({ id, slug }) => ({ id, slug })), [
    { id: 1, slug: 'regnum-plaza' },
    { id: 2, slug: 'c1' },
    { id: 3, slug: 'soy-boyi' },
    { id: 18, slug: 'saadiyat' },
  ]);
  assert.deepEqual(getProvider('mbc').outputFiles, ['regnum-plaza-catalog.json', 'c1-catalog.json', 'soy-boyi-catalog.json', 'saadiyat-catalog.json']);
  const mbc = directSourceInternals.mbcPlansBody(mbcProjects[1], 2);
  assert.deepEqual(Object.fromEntries(mbc), { project: '2', type: 'residential', page: '2' });
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
  const mbc = await loadTemplate('mbc');
  assert.deepEqual(Object.keys(mbc), mbcProjects.map((project) => project.slug));
  for (const project of mbcProjects) assert.ok(mbc[project.slug].units.length > 0);
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
  const row = { id: 1, crm_id: 11, square: 50, floor: 2, rooms: 2, project_slug: 'regnum-plaza', type: 'residential', status: 'AVAILABLE', queue: '1', section: '2', number: '12', end: '2026', is_price: 0 };
  const result = normalizeRegnumPages([{ plans: { total: 1, current_page: 1, last_page: 1, data: [row] } }]);
  assert.equal(result.audit.uniqueCrmIds, 1);
  assert.equal(result.artifact.units[0].sourceId, '11');
  assert.equal(result.artifact.units[0].sourceKey, opaqueMbcSourceKey('regnum-plaza', '11'));
  assert.ok(!result.artifact.units[0].sourceKey.includes('11'));
});

test('MBC source keys retain compatible templates and hide new CRM ids deterministically', () => {
  assert.equal(templateMbcSourceKey('c1', { sourceKey: 'c1:retained-safe-key', id: '74', phase: '1' }), 'c1:retained-safe-key');
  assert.equal(templateMbcSourceKey('c1', { id: '74', phase: '1' }), 'catalog:c1:1:eb624dbe56eb6620ae62');
  assert.equal(templateMbcSourceKey('regnum-plaza', { id: '12', queue: 3 }), 'catalog:regnum-plaza:queue-3:6b51d431df5d7f141cbe');

  const first = opaqueMbcSourceKey('c1', '14858507');
  assert.equal(first, opaqueMbcSourceKey('c1', '14858507'));
  assert.notEqual(first, opaqueMbcSourceKey('saadiyat', '14858507'));
  assert.match(first, /^mbc:c1:[a-f0-9]{24}$/);
  assert.ok(!first.includes('14858507'));
});

function mbcRow(project, id, crmId = Number(id) + 10_000) {
  return {
    id,
    crm_id: crmId,
    square: 50,
    floor: 2,
    rooms: 2,
    project_slug: project.slug,
    type: 'residential',
    status: 'AVAILABLE',
    queue: '1',
    section: '2',
    number: String(id),
    end: '2028',
    is_price: 0,
  };
}

function mbcGroups() {
  return mbcProjects.map((project, projectIndex) => {
    const first = mbcRow(project, projectIndex * 10 + 1);
    if (projectIndex !== 0) return { project, pages: [{ plans: { total: 1, current_page: 1, last_page: 1, data: [first] } }] };
    const second = mbcRow(project, projectIndex * 10 + 2);
    return {
      project,
      pages: [
        { plans: { total: 2, current_page: 1, last_page: 2, data: [first] } },
        { plans: { total: 2, current_page: 2, last_page: 2, data: [second] } },
      ],
    };
  });
}

test('MBC capture posts exact residential and commercial evidence requests for every owned project', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = Object.fromEntries(new URLSearchParams(options.body));
    requests.push({ url, method: options.method, body });
    const project = mbcProjects.find((candidate) => String(candidate.id) === body.project);
    assert.ok(project);
    return new Response(JSON.stringify({ plans: { total: 1, current_page: 1, last_page: 1, data: [mbcRow(project, project.id)] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const capture = await captureFromDirectSource(getProvider('mbc'));
  assert.deepEqual(capture.errors, []);
  assert.deepEqual(requests.map((request) => request.body), mbcProjects.flatMap((project) => [
    { project: String(project.id), type: 'residential', page: '1' },
    { project: String(project.id), type: 'commercial', page: '1' },
  ]));
  assert.ok(requests.every((request) => request.url === 'https://mbc.uz/api/plans' && request.method === 'POST'));
  assert.deepEqual(capture.records.map((record) => record.scope.projectSlug), mbcProjects.flatMap((project) => [project.slug, project.slug]));
  assert.deepEqual(capture.records.map((record) => record.scope.propertyType), mbcProjects.flatMap(() => ['residential', 'commercial']));
});

test('MBC normalization publishes four complete owned artifacts and retains local plans', () => {
  const planFields = ['planPublicPath', 'plan', 'plan', 'planImageUrl'];
  const expectedPlanPaths = {};
  const templates = Object.fromEntries(mbcProjects.map((project, index) => {
    const id = String(index * 10 + 1);
    const crmId = String(Number(id) + 10_000);
    const phase = project.slug === 'saadiyat' ? '2' : '1';
    const section = project.slug === 'saadiyat' ? 'A2' : '2';
    const templatePublicId = project.slug === 'soy-boyi' ? 'stale-public-id' : id;
    expectedPlanPaths[project.slug] = `/${project.slug}/plans/${id}.webp`;
    return [project.slug, { units: [{
      id: templatePublicId,
      crmId,
      number: id,
      rooms: 2,
      area: 50,
      floor: 2,
      phase,
      section,
      [planFields[index]]: expectedPlanPaths[project.slug],
      ...(project.slug === 'soy-boyi' ? { sourceKey: 'soy-boyi:stale-public-id' } : {}),
    }] }];
  }));
  const groups = mbcGroups();
  groups.find((group) => group.project.slug === 'saadiyat').pages[0].plans.data[0] = {
    ...groups.find((group) => group.project.slug === 'saadiyat').pages[0].plans.data[0],
    queue: '2',
    section: 'A2',
  };
  const result = normalizeMbcProjects(groups, '2026-09-14T12:00:00.000Z', templates);
  assert.deepEqual(result.artifacts.map((entry) => entry.filename), mbcProjects.map((project) => `${project.slug}-catalog.json`));
  assert.ok(Object.values(result.audit).every((audit) => audit.complete && audit.propertyType === 'residential'));
  for (const [index, entry] of result.artifacts.entries()) {
    const project = mbcProjects[index];
    assert.equal(entry.artifact.projectSlug, project.slug);
    assert.equal(entry.artifact.projectId, project.id);
    assert.equal(entry.artifact.developerSlug, 'murad-buildings');
    assert.equal(entry.artifact.sourceCount, entry.artifact.units.length);
    assert.equal(entry.artifact.units[0].planImageUrl, expectedPlanPaths[project.slug]);
    assert.equal(entry.artifact.units[0].publicPrice, false);
    assert.equal(entry.artifact.units[0].price, undefined);
  }
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'soy-boyi').artifact.units[0].sourceKey, 'soy-boyi:stale-public-id');
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'c1').artifact.units[0].sourceKey, 'catalog:c1:1:4fc82b26aecb47d2868c');
  const unmatchedRegnum = result.artifacts.find((entry) => entry.artifact.projectSlug === 'regnum-plaza').artifact.units[1];
  assert.equal(unmatchedRegnum.sourceKey, opaqueMbcSourceKey('regnum-plaza', unmatchedRegnum.sourceId));
  assert.ok(!unmatchedRegnum.sourceKey.includes(unmatchedRegnum.sourceId));
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'regnum-plaza').artifact.units[0].phaseSlug, 'q1-s2');
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'regnum-plaza').artifact.units[0].queueLabel, 'I очередь');
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'saadiyat').artifact.units[0].phaseSlug, 'q2-sa2');
  assert.equal(result.artifacts.find((entry) => entry.artifact.projectSlug === 'saadiyat').artifact.units[0].phaseName, 'A2');
  assert.deepEqual(
    result.artifacts.find((entry) => entry.artifact.projectSlug === 'soy-boyi').artifact.queues.map(({ queueKey, queueLabel, queueOrder }) => ({ queueKey, queueLabel, queueOrder })),
    [
      { queueKey: 'q1', queueLabel: 'I очередь', queueOrder: 1 },
      { queueKey: 'q2', queueLabel: 'II очередь', queueOrder: 2 },
      { queueKey: 'q3', queueLabel: 'III очередь', queueOrder: 3 },
      { queueKey: 'q4', queueLabel: 'IV очередь', queueOrder: 4 },
    ],
    'queue I remains explicit CRM metadata even when the residential rows currently begin at raw q2',
  );
});

test('MBC queue labels use authoritative card order instead of raw q-number ordinals', () => {
  const regnum = mbcProjects.find((project) => project.slug === 'regnum-plaza');
  const rows = [mbcRow(regnum, 1), { ...mbcRow(regnum, 2), queue: '3' }];
  const result = normalizeRegnumPages([{ plans: { total: 2, current_page: 1, last_page: 1, data: rows } }]);
  assert.deepEqual(result.artifact.units.map(({ queueKey, queueLabel, queueOrder }) => ({ queueKey, queueLabel, queueOrder })), [
    { queueKey: 'q1', queueLabel: 'I очередь', queueOrder: 1 },
    { queueKey: 'q3', queueLabel: 'II очередь', queueOrder: 2 },
  ]);
});

test('Soy queue I metadata survives while commercial inventory remains excluded', () => {
  const soy = mbcProjects.find((project) => project.slug === 'soy-boyi');
  const residential = [
    ...Array.from({ length: 32 }, (_, index) => ({ ...mbcRow(soy, 1000 + index), queue: '2' })),
    ...Array.from({ length: 102 }, (_, index) => ({ ...mbcRow(soy, 2000 + index), queue: '3' })),
    ...Array.from({ length: 75 }, (_, index) => ({ ...mbcRow(soy, 3000 + index), queue: '4' })),
  ];
  const commercial = [
    { ...mbcRow(soy, 4001), type: 'commercial', queue: '1', rooms: 0 },
    { ...mbcRow(soy, 4002), type: 'commercial', queue: '1', rooms: 0 },
    ...Array.from({ length: 3 }, (_, index) => ({ ...mbcRow(soy, 4100 + index), type: 'commercial', queue: '4', rooms: 0 })),
  ];
  const groups = mbcGroups().map((group) => group.project.slug === soy.slug ? {
    project: soy,
    residentialPages: [{ plans: { total: residential.length, current_page: 1, last_page: 1, data: residential } }],
    commercialPages: [{ plans: { total: commercial.length, current_page: 1, last_page: 1, data: commercial } }],
  } : group);
  const result = normalizeMbcProjects(groups);
  const artifact = result.artifacts.find((entry) => entry.artifact.projectSlug === soy.slug).artifact;
  assert.equal(artifact.units.length, 209);
  assert.equal(artifact.units.some((unit) => unit.propertyType !== 'apartment'), false);
  assert.deepEqual(artifact.completeness.queueCounts, {
    residential: { 2: 32, 3: 102, 4: 75 },
    commercial: { 1: 2, 4: 3 },
  });
  assert.equal(artifact.queues[0].queueKey, 'q1');
  assert.equal(artifact.queues[0].queueLabel, 'I очередь');
  assert.equal(artifact.excludedCommercial, 5);
});

test('Saadiyat audit exposes a changed live queue count instead of masking the CRM-card delta', () => {
  const saadiyat = mbcProjects.find((project) => project.slug === 'saadiyat');
  const residential = [
    ...Array.from({ length: 41 }, (_, index) => ({ ...mbcRow(saadiyat, 5000 + index), queue: '1' })),
    ...Array.from({ length: 115 }, (_, index) => ({ ...mbcRow(saadiyat, 6000 + index), queue: '2' })),
  ];
  const groups = mbcGroups().map((group) => group.project.slug === saadiyat.slug ? {
    project: saadiyat,
    residentialPages: [{ plans: { total: residential.length, current_page: 1, last_page: 1, data: residential } }],
    commercialPages: [{ plans: { total: 0, current_page: 1, last_page: 1, data: [] } }],
  } : group);
  const result = normalizeMbcProjects(groups);
  const reconciliation = result.audit['saadiyat'].queueReconciliation;
  assert.equal(reconciliation.referenceCardObservedAt, '2026-09-15T11:27:41+05:00');
  assert.deepEqual(reconciliation.queues.map(({ queueKey, feedResidentialCount, referenceCardResidentialCount, residentialDelta }) => ({
    queueKey, feedResidentialCount, referenceCardResidentialCount, residentialDelta,
  })), [
    { queueKey: 'q1', feedResidentialCount: 41, referenceCardResidentialCount: 42, residentialDelta: -1 },
    { queueKey: 'q2', feedResidentialCount: 115, referenceCardResidentialCount: 115, residentialDelta: 0 },
  ]);
});

test('MBC normalization fails closed on missing pages, duplicates, wrong type, or an incomplete project set', () => {
  const incomplete = mbcGroups();
  incomplete[0].pages.pop();
  assert.throws(() => normalizeMbcProjects(incomplete), /captured 1 of 2 pages/);

  const duplicate = mbcGroups();
  duplicate[0].pages[1].plans.data[0].id = duplicate[0].pages[0].plans.data[0].id;
  assert.throws(() => normalizeMbcProjects(duplicate), /duplicate id/);

  const duplicateCrm = mbcGroups();
  duplicateCrm[0].pages[1].plans.data[0].crm_id = duplicateCrm[0].pages[0].plans.data[0].crm_id;
  assert.throws(() => normalizeMbcProjects(duplicateCrm), /duplicate CRM id/);

  const wrongType = mbcGroups();
  wrongType[1].pages[0].plans.data[0].type = 'commercial';
  assert.throws(() => normalizeMbcProjects(wrongType), /is not residential/);

  const exposedPrice = mbcGroups();
  exposedPrice[1].pages[0].plans.data[0].is_price = 1;
  assert.throws(() => normalizeMbcProjects(exposedPrice), /public-price policy changed/);

  const unmatchedTemplates = Object.fromEntries(mbcProjects.map((project) => [project.slug, { units: [{
    id: 'not-current', crmId: 'not-current', number: 'not-current', rooms: 9, area: 999, floor: 99, phase: '9', section: '9', plan: `/${project.slug}/plans/stale.webp`,
  }] }]));
  assert.throws(() => normalizeMbcProjects(mbcGroups(), undefined, unmatchedTemplates), /could not match any local plan/);

  assert.throws(() => normalizeMbcProjects(mbcGroups().slice(0, 3)), /requires 4 project groups/);
});

test('KAYAN maps only Ofiyat residential phases to queues and keeps parking independent', () => {
  const houses = [
    { id: 154813, number: 'M-1', floor: 1, rooms: 2, propertyType: 'apartment' },
    { id: 153505, number: 'O1-1', floor: 2, rooms: 2, propertyType: 'apartment' },
    { id: 153506, number: 'O2-1', floor: 3, rooms: 3, propertyType: 'apartment' },
    { id: 154273, number: 'P-1', floor: -1, rooms: null, propertyType: 'parking' },
  ];
  const responses = houses.map((house, index) => ({
    status: 'success',
    data: {
      filteredCount: 1,
      properties: [{
        id: 50_000 + index,
        house_id: house.id,
        floor: house.floor,
        rooms_amount: house.rooms,
        number: house.number,
        sectionName: '1',
        area: { area_total: 50 + index },
        status: 'AVAILABLE',
        price: { value: 500_000_000 + index, pricePerMeter: 10_000_000 },
        propertyType: house.propertyType,
      }],
    },
  }));
  const result = normalizeKayanPropertyResponses(responses, '2026-09-15T07:00:00.000Z');
  const mirador = result.artifact.projects.find((item) => item.project.slug === 'mirador');
  const ofiyat = result.artifact.projects.find((item) => item.project.slug === 'ofiyat');
  assert.deepEqual(mirador.project.queues, []);
  assert.deepEqual(ofiyat.project.queues.map(({ queueKey, queueLabel, queueOrder }) => ({ queueKey, queueLabel, queueOrder })), [
    { queueKey: 'phase-1', queueLabel: 'I очередь', queueOrder: 1 },
    { queueKey: 'phase-2', queueLabel: 'II очередь', queueOrder: 2 },
  ]);
  assert.equal(ofiyat.units.find((unit) => unit.phaseSlug === 'phase-1').queueLabel, 'I очередь');
  assert.equal(ofiyat.units.find((unit) => unit.phaseSlug === 'phase-2').queueLabel, 'II очередь');
  assert.equal(ofiyat.units.find((unit) => unit.phaseSlug === 'parking').queueKey, undefined);
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
