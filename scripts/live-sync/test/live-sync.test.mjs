import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLoopbackCdp, matchAllowedUrl, safeUrlMetadata } from '../src/allowlist.mjs';
import { atomicRunDirectory, atomicWriteFile, pruneRunDirectories } from '../src/atomic.mjs';
import { captureFiles, captureFromAuthorizedTab, classifyRequest, makeBodyRecord, parseUysotReadOnlyBody } from '../src/capture.mjs';
import { captureFromDirectSource, directSourceInternals } from '../src/direct.mjs';
import { loadTemplate } from '../src/cli.mjs';
import { opaqueMbcSourceKey, templateMbcSourceKey } from '../src/mbc-identity.mjs';
import { mergeNrgBlockRegistries, nrgBiSeedBlockRegistry, normalizeNrgBlockRegistry } from '../src/nrg-block-registry.mjs';
import { auditNrgPlanAssets, expectedNrgOriginalUrl, expectedNrgPlanUrl, fetchNrgPlanDetails, imageMetadata, refreshNrgPlanAssets, validateNrgOriginalUrl, validateNrgPlanUrl } from '../src/nrg-plan-assets.mjs';
import { normalizeKayanPropertyResponses, normalizeMbcProjects, normalizeNrgBiCapture, normalizeRegnumPages, normalizeSunPages, normalizeUysotTable } from '../src/normalize.mjs';
import { getProvider, mbcProjects, mbcSarbonProjects } from '../src/providers.mjs';
import { containsObviousSecret, sanitizeValue } from '../src/redact.mjs';

function fakeUysotBrowser(reloadScripts, responseBody = '{}') {
  const listeners = new Map();
  const state = { calls: [], reloads: 0, closed: false };
  const client = {
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? new Set();
      methodListeners.add(listener);
      listeners.set(method, methodListeners);
      return () => methodListeners.delete(listener);
    },
    async emit(method, params) {
      for (const listener of [...(listeners.get(method) ?? [])]) await listener(params);
    },
    async call(method, params = {}) {
      state.calls.push({ method, params });
      if (method === 'Page.reload') {
        const script = reloadScripts[state.reloads++];
        if (script) await script(client);
      }
      if (method === 'Network.getResponseBody') return { body: responseBody, base64Encoded: false };
      return {};
    },
    close() { state.closed = true; },
  };
  return {
    state,
    connectTarget: async () => ({
      client,
      target: {
        id: 'uysot-page',
        type: 'page',
        url: { origin: 'https://app.uysot.uz', path: '/showroom/', queryKeys: [] },
      },
    }),
  };
}

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

test('Uysot capture stops after a top-level document HTTP 403 without retrying or reading its body', async () => {
  const fake = fakeUysotBrowser([
    async (client) => {
      await client.emit('Network.responseReceived', {
        requestId: 'document-403',
        frameId: 'main',
        type: 'Document',
        response: { url: 'https://app.uysot.uz/showroom/', status: 403, mimeType: 'text/html' },
      });
      await client.emit('Page.frameNavigated', { frame: { id: 'main' } });
    },
  ]);

  const capture = await captureFromAuthorizedTab(getProvider('uysot'), {
    cdpEndpoint: 'http://127.0.0.1:9223',
    timeoutMs: 1,
    connectTarget: fake.connectTarget,
  });

  assert.equal(fake.state.reloads, 1);
  assert.equal(fake.state.closed, true);
  assert.equal(capture.failureCode, 'uysot_document_http_403');
  assert.deepEqual(capture.errors, [
    'uysot_document_http_403: app.uysot.uz top-level document returned HTTP 403 before SPA startup',
  ]);
  assert.deepEqual(capture.records, []);
  assert.deepEqual(capture.blocked, []);
  assert.equal(fake.state.calls.some(({ method }) => method === 'Network.getResponseBody'), false);
  assert.equal(fake.state.calls.some(({ method }) => /Cookies|Storage/.test(method)), false);
});

test('Uysot capture ignores a subframe 403 and captures the guarded table response on its bounded retry', async () => {
  const input = JSON.stringify({ page: 4, size: 10, orders: {}, houseId: [1074] });
  const tableBody = JSON.stringify({ accept: true, errors: [], data: { data: [] } });
  const fake = fakeUysotBrowser([
    async (client) => {
      await client.emit('Page.frameNavigated', { frame: { id: 'main' } });
      await client.emit('Network.responseReceived', {
        requestId: 'child-document-403',
        frameId: 'child',
        type: 'Document',
        response: { url: 'https://app.uysot.uz/showroom/', status: 403, mimeType: 'text/html' },
      });
      await client.emit('Page.frameNavigated', { frame: { id: 'child', parentId: 'main' } });
    },
    async (client) => {
      await client.emit('Network.requestWillBeSent', {
        requestId: 'table-network',
        request: { method: 'POST' },
      });
      await client.emit('Fetch.requestPaused', {
        requestId: 'table-fetch',
        networkId: 'table-network',
        request: { method: 'POST', url: 'https://service.app.uysot.uz/v1/smart-catalog/table', postData: input },
      });
      await client.emit('Network.responseReceived', {
        requestId: 'table-network',
        frameId: 'main',
        type: 'Fetch',
        response: { url: 'https://service.app.uysot.uz/v1/smart-catalog/table', status: 200, mimeType: 'application/json' },
      });
      await client.emit('Network.loadingFinished', { requestId: 'table-network' });
    },
  ], tableBody);

  const capture = await captureFromAuthorizedTab(getProvider('uysot'), {
    cdpEndpoint: 'http://127.0.0.1:9223',
    timeoutMs: 1,
    connectTarget: fake.connectTarget,
  });

  assert.equal(fake.state.reloads, 2);
  assert.equal(capture.failureCode, null);
  assert.deepEqual(capture.errors, []);
  assert.equal(capture.records.length, 1);
  assert.equal(capture.records[0].url.path, '/v1/smart-catalog/table');
  const continuation = fake.state.calls.find(({ method }) => method === 'Fetch.continueRequest');
  assert.deepEqual(JSON.parse(Buffer.from(continuation.params.postData, 'base64').toString('utf8')), {
    page: 1, size: 500, orders: {}, houseId: [1074],
  });
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
  assert.deepEqual(mbcSarbonProjects.map(({ id, slug }) => ({ id, slug })), [{ id: 21, slug: 'sarbon' }]);
  assert.deepEqual(getProvider('mbc').outputFiles, ['regnum-plaza-catalog.json', 'c1-catalog.json', 'soy-boyi-catalog.json', 'saadiyat-catalog.json']);
  assert.deepEqual(getProvider('mbc-sarbon').outputFiles, ['sarbon-catalog.json']);
  const mbc = directSourceInternals.mbcPlansBody(mbcProjects[1], 2);
  assert.deepEqual(Object.fromEntries(mbc), { project: '2', type: 'residential', page: '2' });
  const sarbon = directSourceInternals.mbcPlansBody(mbcSarbonProjects[0], 3, 'commercial');
  assert.deepEqual(Object.fromEntries(sarbon), { project: '21', type: 'commercial', page: '3' });
  const provider = getProvider('nrg-bi');
  const project = provider.projectDefinitions[0];
  assert.deepEqual(Object.keys(directSourceInternals.nrgPlacementBody(provider, project, 1)).sort(), ['companyIds', 'filterTags', 'pageNo', 'pageSize', 'propertyTypes', 'realEstateUUIDs']);
  assert.equal(directSourceInternals.nrgPlacementBody(provider, project, 1).pageSize, 300);
  assert.deepEqual(directSourceInternals.nrgBlockMatrixBody('10000000-0000-4000-8000-000000000001'), { blockId: '10000000-0000-4000-8000-000000000001' });
  assert.throws(() => directSourceInternals.nrgBlockMatrixBody('not-a-block'), /not a UUID/);
  assert.equal(provider.maxBlocksPerProject, 100);
  assert.equal(provider.maxMatrixPlacementsPerBlock, 5_000);
  assert.equal(provider.maxMatrixPlacementsPerProject, 30_000);
  const boundedMatrix = { entrances: [{ floors: [{ placements: [{ placementUUID: 'x' }] }] }] };
  assert.equal(directSourceInternals.nrgMatrixPlacementCount(boundedMatrix, 'test matrix', 1), 1);
  assert.throws(() => directSourceInternals.nrgMatrixPlacementCount(boundedMatrix, 'test matrix', 0), /safety limit/);
  const sun = directSourceInternals.sunObjectsBody(7);
  assert.equal(sun.action, 'objects_list');
  assert.equal(sun.auth_token, null);
  assert.deepEqual(Object.keys(sun.data).sort(), ['activity', 'cabinetMode', 'category', 'complex_id', 'filters', 'page']);
});

test('NRG trusted block registry covers every configured project and only grows', () => {
  const provider = getProvider('nrg-bi');
  const seed = normalizeNrgBlockRegistry(nrgBiSeedBlockRegistry);
  assert.deepEqual(Object.keys(seed.projects), provider.projectDefinitions.map((project) => project.slug));
  assert.equal(Object.values(seed.projects).reduce((sum, project) => sum + project.blocks.length, 0), 64);
  const next = structuredClone(seed);
  next.projects['4u'].blocks = [{ id: '30000000-0000-4000-8000-000000000001', name: 'New official block' }];
  const merged = mergeNrgBlockRegistries(seed, next);
  assert.equal(merged.projects['4u'].blocks.length, seed.projects['4u'].blocks.length + 1);
  assert.ok(seed.projects['4u'].blocks.every(({ id }) => merged.projects['4u'].blocks.some((block) => block.id === id)));
  const duplicate = structuredClone(seed);
  duplicate.projects['4u'].blocks.push(duplicate.projects['4u'].blocks[0]);
  assert.throws(() => normalizeNrgBlockRegistry(duplicate), /invalid or duplicated/);
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
  const sarbon = await loadTemplate('mbc-sarbon');
  assert.deepEqual(Object.keys(sarbon), ['sarbon']);
  assert.ok(sarbon.sarbon.units.length > 0);
  assert.deepEqual(sarbon.sarbon.queues, [
    { sourceId: '1', queueKey: 'q1', queueLabel: 'I очередь', queueDisplayCode: 'I', queueOrder: 1 },
  ]);
  assert.ok(sarbon.sarbon.units.every((unit) => unit.phase === '1'
    && unit.phaseSlug === `q1-s${unit.section}`
    && unit.phaseName === `S${unit.section}`
    && unit.queueKey === 'q1'
    && unit.queueLabel === 'I очередь'
    && unit.queueDisplayCode === 'I'
    && unit.queueOrder === 1));
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

function mbcCaptureFixture(projects = mbcProjects, provider = 'mbc') {
  const capturedAt = '2026-09-15T12:00:00.000Z';
  const records = projects.flatMap((project) => {
    const row = mbcRow(project, 7_000 + project.id, 900_000 + project.id);
    return [
      { propertyType: 'residential', data: [row] },
      { propertyType: 'commercial', data: [] },
    ].map(({ propertyType, data }) => makeBodyRecord({
      id: `mbc-${project.slug}-${propertyType}-plans-1`,
      method: 'POST',
      url: 'https://mbc.uz/api/plans',
      status: 200,
      mimeType: 'application/json',
      text: JSON.stringify({ plans: { total: data.length, current_page: 1, last_page: 1, data } }),
      capturedAt,
      scope: { projectSlug: project.slug, projectId: project.id, propertyType, endpoint: 'plans', page: 1 },
    }));
  });
  return {
    schemaVersion: 1,
    provider,
    capturedAt,
    target: null,
    safety: { publicReadOnlyTransport: true, credentialsUsed: false },
    blocked: [],
    errors: [],
    records,
  };
}

async function writeMbcTemplateFixtures(root, projects = [...mbcProjects, ...mbcSarbonProjects]) {
  await mkdir(root, { recursive: true });
  for (const project of projects) {
    const row = mbcRow(project, 7_000 + project.id, 900_000 + project.id);
    const template = {
      projectSlug: project.slug,
      units: [{
        id: String(row.id),
        crmId: String(row.crm_id),
        number: row.number,
        rooms: row.rooms,
        area: row.square,
        floor: row.floor,
        phase: row.queue,
        section: row.section,
        plan: `/${project.slug}/plans/fixture.webp`,
      }],
    };
    await writeFile(join(root, project.templateFile), JSON.stringify(template));
  }
}

test('MBC CLI keeps the established four-project transaction separate from SARBON', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'live-sync-mbc-dry-run-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const templates = join(root, 'templates');
  await writeMbcTemplateFixtures(templates);
  const complete = await atomicRunDirectory(join(root, 'captures'), 'mbc', captureFiles(mbcCaptureFixture()));
  const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
  const mbcOutput = JSON.parse(execFileSync(process.execPath, [cli, 'dry-run', '--provider', 'mbc', '--input', complete, '--template', templates], { encoding: 'utf8' }));
  assert.equal(mbcOutput.write, false);
  assert.deepEqual(mbcOutput.artifacts, mbcProjects.map((project) => `${project.slug}-catalog.json`));
  assert.deepEqual(Object.keys(mbcOutput.audit), mbcProjects.map((project) => project.slug));
  assert.ok(Object.values(mbcOutput.audit).every((audit) => audit.complete && audit.observedRecords === 1));

  const partial = await atomicRunDirectory(
    join(root, 'partial-captures'),
    'mbc',
    captureFiles(mbcCaptureFixture(mbcProjects.slice(0, -1))),
  );
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'dry-run', '--provider', 'mbc', '--input', partial, '--template', templates], { encoding: 'utf8' }),
    (error) => /no complete saadiyat category pages/.test(String(error?.stderr)),
    'the established MBC provider must remain atomic across its four projects',
  );

  const sarbonCapture = mbcCaptureFixture(mbcSarbonProjects, 'mbc-sarbon');
  const sarbonComplete = await atomicRunDirectory(join(root, 'sarbon-captures'), 'mbc-sarbon', captureFiles(sarbonCapture));
  const sarbonOutput = JSON.parse(execFileSync(process.execPath, [cli, 'dry-run', '--provider', 'mbc-sarbon', '--input', sarbonComplete, '--template', templates], { encoding: 'utf8' }));
  assert.deepEqual(sarbonOutput.artifacts, ['sarbon-catalog.json']);
  assert.deepEqual(Object.keys(sarbonOutput.audit), ['sarbon']);
  assert.equal(sarbonOutput.audit.sarbon.complete, true);

  const emptySarbonCapture = await atomicRunDirectory(
    join(root, 'empty-sarbon-captures'),
    'mbc-sarbon',
    captureFiles(mbcCaptureFixture([], 'mbc-sarbon')),
  );
  assert.throws(
    () => execFileSync(process.execPath, [cli, 'dry-run', '--provider', 'mbc-sarbon', '--input', emptySarbonCapture, '--template', templates], { encoding: 'utf8' }),
    (error) => /no complete sarbon category pages/.test(String(error?.stderr)),
    'a broken SARBON candidate must fail without becoming part of the four-project MBC run',
  );
});

test('MBC capture honors a bounded Retry-After response and resumes the same exact request', async (t) => {
  assert.equal(directSourceInternals.retryAfterMilliseconds(new Response('', { status: 429, headers: { 'retry-after': '0' } })), 0);
  assert.equal(directSourceInternals.retryAfterMilliseconds(new Response('', { status: 429, headers: { 'retry-after': '9999' } })), 65_000);
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let attempts = 0;
  let firstBody = null;
  globalThis.fetch = async (_url, options) => {
    attempts += 1;
    const body = Object.fromEntries(new URLSearchParams(options.body));
    if (attempts === 1) {
      firstBody = body;
      return new Response('', { status: 429, headers: { 'retry-after': '0' } });
    }
    if (attempts === 2) assert.deepEqual(body, firstBody, 'the retry must not change project/category/page scope');
    const project = [...mbcProjects, ...mbcSarbonProjects].find((candidate) => String(candidate.id) === body.project);
    assert.ok(project);
    const data = body.type === 'commercial' ? [] : [mbcRow(project, project.id)];
    return new Response(JSON.stringify({ plans: { total: data.length, current_page: 1, last_page: 1, data } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const capture = await captureFromDirectSource(getProvider('mbc'));
  assert.deepEqual(capture.errors, []);
  assert.equal(attempts, mbcProjects.length * 2 + 1);
  assert.equal(capture.records.length, mbcProjects.length * 2);
});

test('MBC capture posts exact residential and commercial evidence requests for every owned project', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = Object.fromEntries(new URLSearchParams(options.body));
    requests.push({ url, method: options.method, body });
    const project = [...mbcProjects, ...mbcSarbonProjects].find((candidate) => String(candidate.id) === body.project);
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

  requests.length = 0;
  const sarbonCapture = await captureFromDirectSource(getProvider('mbc-sarbon'));
  assert.deepEqual(sarbonCapture.errors, []);
  assert.deepEqual(requests.map((request) => request.body), [
    { project: '21', type: 'residential', page: '1' },
    { project: '21', type: 'commercial', page: '1' },
  ]);
  assert.deepEqual(sarbonCapture.records.map((record) => record.scope.projectSlug), ['sarbon', 'sarbon']);
});

test('MBC normalization publishes four complete owned artifacts and retains local plans', () => {
  const planFields = {
    'regnum-plaza': 'planPublicPath',
    c1: 'plan',
    'soy-boyi': 'plan',
    saadiyat: 'planImageUrl',
  };
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
      [planFields[project.slug]]: expectedPlanPaths[project.slug],
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

test('isolated SARBON normalizer publishes only AVAILABLE residential rows', () => {
  const sarbon = mbcSarbonProjects[0];
  const residential = mbcRow(sarbon, 154, 57946);
  const commercial = { ...mbcRow(sarbon, 900, 88000), type: 'commercial', rooms: 0 };
  const groups = [{
    project: sarbon,
    residentialPages: [{ plans: { total: 1, current_page: 1, last_page: 1, data: [residential] } }],
    commercialPages: [{ plans: { total: 1, current_page: 1, last_page: 1, data: [commercial] } }],
  }];
  const template = { sarbon: { projectSlug: 'sarbon', units: [{
    id: '154', crmId: '57946', number: residential.number, rooms: 2, area: 50,
    floor: 2, phase: '1', phaseSlug: 'q1-s2', phaseName: 'S2', section: '2',
    queueKey: 'q1', queueLabel: 'I очередь', queueDisplayCode: 'I', queueOrder: 1,
    sourceKey: 'sarbon:154', plan: '/sarbon/plans/fixture.webp',
  }] } };
  const result = normalizeMbcProjects(groups, '2026-09-15T12:00:00.000Z', template, mbcSarbonProjects);
  assert.deepEqual(result.artifacts.map((entry) => entry.filename), ['sarbon-catalog.json']);
  const artifact = result.artifacts[0].artifact;
  assert.equal(artifact.projectId, 21);
  assert.equal(artifact.sourceLanding, 'https://mbc.uz/ru/project/sarbon');
  assert.equal(artifact.units.length, 1);
  assert.equal(artifact.units[0].sourceKey, 'sarbon:154');
  assert.equal(artifact.units[0].phaseSlug, template.sarbon.units[0].phaseSlug);
  assert.equal(artifact.units[0].phaseName, template.sarbon.units[0].phaseName);
  assert.equal(artifact.units[0].queueKey, template.sarbon.units[0].queueKey);
  assert.equal(artifact.units[0].planImageUrl, '/sarbon/plans/fixture.webp');
  assert.equal(artifact.units[0].propertyType, 'apartment');
  assert.equal(artifact.units[0].status, 'available');
  assert.equal(artifact.excludedCommercial, 1);
  assert.deepEqual(artifact.queues, [{ sourceId: '1', queueKey: 'q1', queueLabel: 'I очередь', queueDisplayCode: 'I', queueOrder: 1 }]);

  const sold = structuredClone(groups);
  sold[0].residentialPages[0].plans.data[0].status = 'SOLD';
  assert.throws(
    () => normalizeMbcProjects(sold, undefined, template, mbcSarbonProjects),
    /is not available/,
    'the isolated provider must keep the same customer-safe AVAILABLE-only contract',
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

  assert.throws(() => normalizeMbcProjects(mbcGroups().slice(0, -1)), /requires 4 project groups/);
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
  const groups = provider.projectDefinitions.map((project, index) => {
    const blockId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    const unit = {
      uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      realEstateUUID: project.realEstateUUID, roomCount: 1, name: '1', square: 40,
      floor: 2, entrance: 1, priceBySquare: 10, maxFloor: 10, blockName: 'Block 1',
      blockId,
      totalPrice: 400, totalPriceWithDiscount: 400, placementStatusName: 'Снятие резерва', isSale: true,
      propertyType: { uuid: provider.apartmentPropertyTypeUUID, name: 'Квартира' },
    };
    const matrixPlacement = (offset, placementUIStatus, isSale) => ({
      placementUUID: `20000000-0000-4000-8000-${String(index + 1 + offset).padStart(12, '0')}`,
      placementName: String(offset + 1), square: 40 + offset, price: 10, totalPrice: 400 + offset,
      repairSum: 0, repairPrice: 0, isRepaired: false,
      blockUUID: blockId, blockName: 'Block 1', floor: 2, entrance: 1, roomCount: 1,
      isSale, propertyTypeUUID: provider.apartmentPropertyTypeUUID, propertyTypeName: 'Квартира',
      propertyType: { uuid: provider.apartmentPropertyTypeUUID, name: 'Квартира' },
      placementUIStatus,
    });
    const available = { ...matrixPlacement(0, 'FREE', true), placementUUID: unit.uuid, placementName: unit.name, square: unit.square };
    const sold = matrixPlacement(100, 'SOLD', false);
    const booked = matrixPlacement(200, 'BOOKED', false);
    for (const variant of [1600, 400, 200]) unit[`photoURL${variant}`] = expectedNrgPlanUrl(unit, variant);
    if (project.slug === '4u') unit.discount = { stock: { data: [{ priceWithDiscount: 360 }] } };
    const planAssets = project.slug === '4u' ? {
      schemaVersion: 1, projectSlug: '4u', activeUnitCount: 1, auditedUnitCount: 1, verifiedOriginals: 1, missingOriginals: 0, publishablePlans: 1,
      variants: { original: { attempted: 1, valid: 1, invalid: 0 }, 1600: { attempted: 1, valid: 1, invalid: 0 }, 400: { attempted: 1, valid: 1, invalid: 0 }, 200: { attempted: 1, valid: 1, invalid: 0 } },
      units: [{
        unitId: unit.uuid, blockId: unit.blockId, number: unit.name, selectedOriginalUrl: expectedNrgOriginalUrl(unit),
        original: { variant: 'original', url: expectedNrgOriginalUrl(unit), status: 200, ok: true, declaredMimeType: 'application/octet-stream', mimeType: 'image/png', bytes: 300_000, width: 3510, height: 2482, sha256: 'b'.repeat(64) },
        variants: [1600, 400, 200].map((variant) => ({ variant, url: unit[`photoURL${variant}`], status: 200, ok: true, declaredMimeType: 'image/jpeg', mimeType: 'image/jpeg', bytes: variant === 1600 ? 100_000 : variant === 400 ? 10_000 : 5_000, width: variant, height: Math.round(variant * 0.707), sha256: String(variant).padStart(64, 'a').slice(-64) })),
      }],
    } : null;
    return {
      project,
      apartmentPropertyTypeUUID: provider.apartmentPropertyTypeUUID,
      pages: [{ placements: [unit] }, { placements: [] }],
      realEstate: { realEstates: [{
        uuid: project.realEstateUUID, placementCount: 1,
        propertyTypes: [{ uuid: provider.apartmentPropertyTypeUUID, name: 'Квартира' }],
        blocks: [{ id: blockId, name: 'Block 1', count: 1 }],
      }] },
      blockMatrices: [{
        blockUUID: blockId, blockName: 'Block 1', squareUnit: 'sqm',
        entrances: [{ entrance: 1, floors: [{ floor: 2, placements: [available, booked, sold] }] }],
      }],
      ...(planAssets ? { planAssets } : {}),
    };
  });
  const result = normalizeNrgBiCapture(groups);
  assert.equal(result.artifacts.length, 11);
  assert.ok(Object.values(result.audit).every((audit) => audit.complete));
  assert.ok(Object.values(result.audit).every((audit) => audit.statusCounts.available === 1 && audit.statusCounts.reserved === 1 && audit.statusCounts.sold === 1));
  const fourUArtifact = result.artifacts.find((item) => item.filename === '4u-catalog.json').artifact;
  const fourU = fourUArtifact.units.find((unit) => unit.status === 'available');
  assert.equal(fourU.planImageUrl, expectedNrgOriginalUrl(groups[0].pages[0].placements[0]));
  assert.equal(fourU.price, 360, '4U publishes the official active campaign price');
  assert.equal(fourU.pricePerM2, 9, '4U per-m² price follows the selected campaign total');
  assert.equal(fourUArtifact.sourceCount, 3);
  assert.equal(fourUArtifact.historicalSaleDates, null);
  assert.equal(fourUArtifact.units.find((unit) => unit.status === 'sold').price, null);
  assert.ok(fourUArtifact.units.every((unit) => unit.id === unit.sourceId && unit.sourceKey === `nrg-bi:4u:${unit.id}`));
  const invalidAudit = structuredClone(groups);
  invalidAudit[0].planAssets.units[0].original.width = 400;
  assert.throws(() => normalizeNrgBiCapture(invalidAudit), /dimensions are invalid/);
  const missingCurrentPreview = structuredClone(groups);
  missingCurrentPreview[0].planAssets.units[0].variants[0] = { variant: 1600, url: groups[0].pages[0].placements[0].photoURL1600, status: 503, ok: false, error: 'HTTP 503' };
  missingCurrentPreview[0].planAssets.units[0].selectedOriginalUrl = null;
  missingCurrentPreview[0].planAssets.publishablePlans = 0;
  missingCurrentPreview[0].planAssets.variants[1600] = { attempted: 1, valid: 0, invalid: 1 };
  const lkgCandidate = normalizeNrgBiCapture(missingCurrentPreview).artifacts.find((item) => item.filename === '4u-catalog.json').artifact.units.find((unit) => unit.status === 'available');
  assert.equal(lkgCandidate.planImageUrl, undefined, 'an invalid new preview must omit the URL so the database keeps its last-known-good plan');

  const missingMatrix = structuredClone(groups);
  missingMatrix[0].blockMatrices = [];
  assert.throws(() => normalizeNrgBiCapture(missingMatrix), /required blockMatrix responses/);
  const duplicateIdentity = structuredClone(groups);
  duplicateIdentity[0].blockMatrices[0].entrances[0].floors[0].placements[2].placementUUID = duplicateIdentity[0].blockMatrices[0].entrances[0].floors[0].placements[1].placementUUID;
  assert.throws(() => normalizeNrgBiCapture(duplicateIdentity), /duplicate matrix placement UUID/);
  const freeMismatch = structuredClone(groups);
  freeMismatch[0].blockMatrices[0].entrances[0].floors[0].placements[0].placementUIStatus = 'SOLD';
  freeMismatch[0].blockMatrices[0].entrances[0].floors[0].placements[0].isSale = false;
  assert.throws(() => normalizeNrgBiCapture(freeMismatch), /does not reconcile with blockMatrix/);
  const unknownLifecycle = structuredClone(groups);
  unknownLifecycle[0].blockMatrices[0].entrances[0].floors[0].placements[2].placementUIStatus = 'CONTRACT';
  assert.throws(() => normalizeNrgBiCapture(unknownLifecycle), /unknown placementUIStatus/);
  const retainedSoldBlock = structuredClone(groups);
  const historicalBlock = { id: '30000000-0000-4000-8000-000000000002', name: 'Previously accepted sold block' };
  const historicalSold = {
    ...retainedSoldBlock[1].blockMatrices[0].entrances[0].floors[0].placements[2],
    placementUUID: '40000000-0000-4000-8000-000000000002',
    placementName: '900', blockUUID: historicalBlock.id, blockName: historicalBlock.name,
  };
  retainedSoldBlock[1].requiredBlocks = [...retainedSoldBlock[1].realEstate.realEstates[0].blocks, historicalBlock];
  retainedSoldBlock[1].blockMatrices.push({
    blockUUID: historicalBlock.id, blockName: historicalBlock.name,
    entrances: [{ entrance: 1, floors: [{ floor: 2, placements: [historicalSold] }] }],
  });
  const retainedArtifact = normalizeNrgBiCapture(retainedSoldBlock).artifacts.find((item) => item.filename === 'bayterak-catalog.json').artifact;
  assert.equal(retainedArtifact.sourceCount, 4);
  assert.ok(retainedArtifact.matrixBlockIds.includes(historicalBlock.id));
  retainedSoldBlock[1].blockMatrices.pop();
  assert.throws(() => normalizeNrgBiCapture(retainedSoldBlock), /required blockMatrix responses/);
  const fullySoldListing = structuredClone(groups);
  fullySoldListing[1].pages = [{ placements: [] }];
  fullySoldListing[1].blockMatrices[0].entrances[0].floors[0].placements[0].placementUIStatus = 'SOLD';
  fullySoldListing[1].blockMatrices[0].entrances[0].floors[0].placements[0].isSale = false;
  const fullySoldArtifact = normalizeNrgBiCapture(fullySoldListing).artifacts.find((item) => item.filename === 'bayterak-catalog.json').artifact;
  assert.equal(fullySoldArtifact.completeness.statusCounts.available, undefined);
  assert.equal(fullySoldArtifact.completeness.statusCounts.sold, 2);
  const noTerminalPage = structuredClone(groups);
  noTerminalPage[0].pages.pop();
  assert.throws(() => normalizeNrgBiCapture(noTerminalPage), /empty terminal page/);
});

function testJpeg(width, height, discriminator = 0) {
  const header = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, discriminator & 0xff,
  ]);
  return Buffer.concat([header, Buffer.alloc(Math.max(2_000, width * 30), discriminator & 0xff), Buffer.from([0xff, 0xd9])]);
}

function testPng(width, height, payloadBytes = 100_000) {
  const chunk = (type, data) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length, 0);
    header.write(type, 4, 4, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.alloc(payloadBytes)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function testNrgPlanRow(index = 1) {
  const row = {
    uuid: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    blockId: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    name: String(index),
    isSale: true,
  };
  for (const variant of [1600, 400, 200]) row[`photoURL${variant}`] = expectedNrgPlanUrl(row, variant);
  return row;
}

test('NRG 4U plan URL and MIME checks bind an original to the exact source identity', () => {
  const row = testNrgPlanRow();
  assert.equal(validateNrgPlanUrl(row, 1600, row.photoURL1600), row.photoURL1600);
  assert.equal(validateNrgOriginalUrl(row, expectedNrgOriginalUrl(row)), expectedNrgOriginalUrl(row));
  assert.throws(() => validateNrgPlanUrl(row, 1600, `${row.photoURL1600}?token=not-allowed`), /not bound/);
  assert.throws(() => validateNrgPlanUrl({ ...row, uuid: testNrgPlanRow(2).uuid }, 1600, row.photoURL1600), /not bound/);
  assert.deepEqual(imageMetadata(testJpeg(1600, 1131)), { mimeType: 'image/jpeg', width: 1600, height: 1131 });
  assert.deepEqual(imageMetadata(testPng(3510, 2482)), { mimeType: 'image/png', width: 3510, height: 2482 });
});

test('NRG 4U detail lookup is an anonymous exact-identity POST', async () => {
  const rows = [testNrgPlanRow(1), testNrgPlanRow(2)].map((row) => ({
    ...row,
    realEstateUUID: 'c8945ad5-c737-42a6-a5c6-aa00375d3717',
    propertyType: { uuid: '5990a172-812a-4fee-b4f5-c860cca824d7' },
  }));
  const calls = [];
  const details = await fetchNrgPlanDetails(rows, {
    attempts: 1,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const row = rows.find((item) => item.uuid === JSON.parse(options.body).placementUUID);
      return new Response(JSON.stringify({
        placementUUID: row.uuid,
        realEstateUUID: row.realEstateUUID,
        blockId: row.blockId,
        placementName: row.name,
        propertyType: row.propertyType,
        photoURL1600: expectedNrgOriginalUrl(row),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(details.size, 2);
  assert.ok(calls.every((call) => call.url === 'https://apigw.bi.group/sales-picker/microfe-v3/placement'
    && call.options.method === 'POST' && call.options.credentials === 'omit' && call.options.redirect === 'error'));
  assert.deepEqual([...details.values()].map((item) => item.url), rows.map(expectedNrgOriginalUrl));
});

test('NRG 4U plan audit selects only a valid detail original and reports duplicates', async () => {
  const rows = [testNrgPlanRow(1), testNrgPlanRow(2)];
  const originalSources = new Map(rows.map((row) => [row.uuid, { unitId: row.uuid, status: 200, url: expectedNrgOriginalUrl(row) }]));
  const fetched = [];
  const fetchImpl = async (url, options) => {
    fetched.push({ url, options });
    const variant = Number(url.match(/_(1600|400|200)\.png$/)?.[1]);
    const original = !variant;
    const body = original ? testPng(3510, 2482) : testJpeg(variant, Math.round(variant * 0.707));
    return new Response(body, { status: 200, headers: { 'content-type': original ? 'application/octet-stream' : 'image/jpeg', 'content-length': String(body.length) } });
  };
  const { audit } = await auditNrgPlanAssets(rows, { fetchImpl, originalSources, attempts: 1, concurrency: 3 });
  assert.equal(fetched.length, 8);
  assert.ok(fetched.every((item) => item.options.credentials === 'omit' && item.options.redirect === 'error'));
  assert.equal(audit.activeUnitCount, 2);
  assert.equal(audit.verifiedOriginals, 2);
  assert.equal(audit.missingOriginals, 0);
  assert.equal(audit.publishablePlans, 2);
  assert.equal(audit.units[0].selectedOriginalUrl, expectedNrgOriginalUrl(rows[0]));
  assert.equal(audit.duplicateGroups.length, 4, 'identical official bytes are reported, not silently remapped');

  const wrongDimensions = async (url) => {
    const variant = Number(url.match(/_(1600|400|200)\.png$/)?.[1]);
    const original = !variant;
    const width = original ? 1600 : variant;
    const body = original ? testPng(width, 1131) : testJpeg(width, Math.round(width * 0.707), variant);
    return new Response(body, { status: 200, headers: { 'content-type': original ? 'application/octet-stream' : 'image/jpeg', 'content-length': String(body.length) } });
  };
  const failed = await auditNrgPlanAssets([rows[0]], { fetchImpl: wrongDimensions, originalSources, attempts: 1 });
  assert.equal(failed.audit.verifiedOriginals, 0);
  assert.equal(failed.audit.units[0].selectedOriginalUrl, null, 'a thumbnail must not replace a missing original');

  const missingPreview = async (url) => {
    const variant = Number(url.match(/_(1600|400|200)\.png$/)?.[1]);
    if (variant === 1600) return new Response('', { status: 503 });
    const original = !variant;
    const body = original ? testPng(3510, 2482) : testJpeg(variant, Math.round(variant * 0.707), variant);
    return new Response(body, { status: 200, headers: { 'content-type': original ? 'application/octet-stream' : 'image/jpeg', 'content-length': String(body.length) } });
  };
  const noPair = await auditNrgPlanAssets([rows[0]], { fetchImpl: missingPreview, originalSources, attempts: 1 });
  assert.equal(noPair.audit.verifiedOriginals, 1);
  assert.equal(noPair.audit.publishablePlans, 0);
  assert.equal(noPair.audit.units[0].selectedOriginalUrl, null, 'an invalid card preview must preserve the prior complete plan pair');
});

test('NRG 4U plan audit rejects a MIME mismatch and does not fetch an unbound URL', async () => {
  const row = testNrgPlanRow();
  row.photoURL400 = 'https://example.invalid/foreign.png';
  const originalSources = new Map([[row.uuid, { unitId: row.uuid, status: 200, url: expectedNrgOriginalUrl(row) }]]);
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    const variant = Number(url.match(/_(1600|400|200)\.png$/)?.[1]);
    const original = !variant;
    const body = original ? testPng(3510, 2482) : testJpeg(variant, Math.round(variant * 0.707), variant);
    return new Response(body, { status: 200, headers: { 'content-type': original ? 'image/jpeg' : 'image/jpeg', 'content-length': String(body.length) } });
  };
  const { audit } = await auditNrgPlanAssets([row], { fetchImpl, originalSources, attempts: 1 });
  assert.equal(fetched.length, 3);
  assert.equal(audit.units[0].selectedOriginalUrl, null);
  assert.match(audit.units[0].original.error, /MIME/);
  assert.match(audit.units[0].variants.find((item) => item.variant === 400).error, /not bound/);
});

test('NRG 4U persistent audit avoids a repeated full asset download and refreshes only a changed identity', async () => {
  const rows = [testNrgPlanRow(1), testNrgPlanRow(2)].map((row) => ({
    ...row,
    realEstateUUID: 'c8945ad5-c737-42a6-a5c6-aa00375d3717',
    propertyType: { uuid: '5990a172-812a-4fee-b4f5-c860cca824d7' },
  }));
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === 'POST') {
      const row = changedRows.find((item) => item.uuid === JSON.parse(options.body).placementUUID)
        ?? rows.find((item) => item.uuid === JSON.parse(options.body).placementUUID);
      return new Response(JSON.stringify({
        placementUUID: row.uuid, realEstateUUID: row.realEstateUUID, blockId: row.blockId,
        placementName: row.name, propertyType: row.propertyType, photoURL1600: expectedNrgOriginalUrl(row),
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const variant = Number(url.match(/_(1600|400|200)\.png$/)?.[1]);
    const original = !variant;
    const body = original ? testPng(3510, 2482) : testJpeg(variant, Math.round(variant * 0.707), variant);
    return new Response(body, { status: 200, headers: { 'content-type': original ? 'application/octet-stream' : 'image/jpeg', 'content-length': String(body.length) } });
  };
  let changedRows = rows;
  const first = await refreshNrgPlanAssets(rows, { fetchImpl, attempts: 1, capturedAt: '2026-09-15T08:00:00.000Z' });
  assert.equal(calls.filter((item) => item.method === 'POST').length, 2);
  assert.equal(calls.filter((item) => item.method === 'GET').length, 8);
  assert.deepEqual(first.audit.refresh, {
    cachePolicy: 'reuse a complete validated audit while its exact block/unit/number asset URLs are unchanged',
    reusedUnits: 0, refreshedUnits: 2, detailRequests: 2, assetRequests: 8,
    downloadedAssetBytes: first.audit.refresh.downloadedAssetBytes,
  });
  assert.ok(first.audit.refresh.downloadedAssetBytes > 200_000);

  calls.length = 0;
  const repeated = await refreshNrgPlanAssets(rows, { fetchImpl, attempts: 1, previousAudit: first.audit, capturedAt: '2026-09-15T08:05:00.000Z' });
  assert.equal(calls.length, 0, 'an unchanged five-minute run must not repeat detail or image requests');
  assert.equal(repeated.audit.refresh.reusedUnits, 2);
  assert.equal(repeated.audit.refresh.refreshedUnits, 0);
  assert.equal(repeated.audit.refresh.downloadedAssetBytes, 0);

  const changedBlock = '40000000-0000-4000-8000-000000000001';
  changedRows = rows.map((row, index) => {
    if (index !== 0) return row;
    const changed = { ...row, blockId: changedBlock };
    for (const variant of [1600, 400, 200]) changed[`photoURL${variant}`] = expectedNrgPlanUrl(changed, variant);
    return changed;
  });
  calls.length = 0;
  const changed = await refreshNrgPlanAssets(changedRows, { fetchImpl, attempts: 1, previousAudit: repeated.audit, capturedAt: '2026-09-15T08:10:00.000Z' });
  assert.equal(calls.filter((item) => item.method === 'POST').length, 1);
  assert.equal(calls.filter((item) => item.method === 'GET').length, 4);
  assert.equal(changed.audit.refresh.reusedUnits, 1);
  assert.equal(changed.audit.refresh.refreshedUnits, 1);
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
