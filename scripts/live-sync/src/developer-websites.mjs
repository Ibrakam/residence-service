import { makeBodyRecord } from './capture.mjs';

const KAYAN = Object.freeze([
  { slug: 'mirador', name: 'Mirador', id: 56301, houses: { 'Mirador I': { id: 154813, slug: 'main', name: 'Mirador' } } },
  { slug: 'ofiyat', name: 'Ofiyat', id: 56018, houses: {
    'I очередь': { id: 153505, slug: 'phase-1', name: 'I очередь' },
    'II очередь': { id: 153506, slug: 'phase-2', name: 'II очередь' },
    'Паркинг': { id: 154273, slug: 'parking', name: 'Паркинг' },
  } },
]);
const TYPES = Object.freeze({ residential: 'apartment', parking: 'parking', commerce: 'commercial', office: 'commercial' });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const numeric = value => ['number', 'string'].includes(typeof value) && /^-?\d+(?:\.\d+)?$/.test(String(value).trim()) && Number.isFinite(Number(value));

async function boundedText(response, limit) {
  check(response.ok, `Public developer source returned HTTP ${response.status}`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    check(bytes <= limit, 'Public developer response exceeded size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function read(url, options = {}) {
  // All call sites use fixed HTTPS origins/paths. No source-provided URL is fetched.
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(45_000) });
  return { response, text: await boundedText(response, 4 * 1024 * 1024) };
}
function derived(records, provider, url, scope, value) {
  records.push(makeBodyRecord({ id: `${provider}-${records.length + 1}`, method: 'DERIVED', url, status: 200,
    mimeType: 'application/json', text: JSON.stringify(value), capturedAt: new Date().toISOString(),
    scope: { ...scope, derived: true } }));
}
function projectIdentity(html, project) {
  check(new RegExp(`<body[^>]*data-project=["']${project.name}["']`, 'i').test(html), 'KAYAN project document identity changed');
  const select = html.match(/filter-select-projects[\s\S]*?<\/select>/)?.[0];
  check(select?.includes(`value="${project.id}"`) || select?.includes(`value='${project.id}'`), 'KAYAN public project ID changed');
}
function projectPage(rows, project, type) {
  check(Array.isArray(rows) && rows.length <= 12, 'KAYAN public pagination shape changed');
  for (const row of rows) {
    check(Number(row.projectId) === project.id && row.projectName === project.name, 'KAYAN public row belongs to another project');
    check(row.typePurpose === (['commerce', 'office'].includes(type) ? 'commercial' : type)
      && (type !== 'office' || row.propertyType === 'office'), 'KAYAN public row property type mismatch');
    check(Number.isSafeInteger(row.id) && row.id > 0, 'KAYAN public row has no stable official ID');
    check(project.houses[row.houseName], 'KAYAN public row has unknown physical house');
  }
}
export async function captureKayanWebsite(records) {
  for (const project of KAYAN) {
    const { response, text: html } = await read(`https://kayan.uz/ru/project/${project.slug}`);
    projectIdentity(html, project);
    const csrf = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/)?.[1];
    // Anonymous website session is ephemeral; never record HTML, token, headers or cookies.
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    check(csrf && cookie, 'KAYAN anonymous website session is unavailable');
    const fetchPage = async (type, page) => {
      const { text } = await read('https://kayan.uz/api/filter', { method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded',
          'x-requested-with': 'XMLHttpRequest', 'x-csrf-token': csrf, cookie },
        body: new URLSearchParams({ project_id: String(project.id), propertyTypeAliases: type, page: String(page), size: '12' }).toString() });
      let value; try { value = JSON.parse(text); } catch { throw new Error('KAYAN public filter returned non-JSON content'); }
      check(value?.data?.success === true, 'KAYAN public filter failed');
      const rows = value.data.plans?.data;
      projectPage(rows, project, type);
      return rows;
    };
    const seen = new Set();
    for (const type of Object.keys(TYPES)) {
      let first;
      for (let page = 1; page <= 100; page += 1) {
        const rows = await fetchPage(type, page);
        first ??= JSON.stringify(rows);
        for (const row of rows) { check(!seen.has(row.id), 'KAYAN duplicated unit across public pages/types'); seen.add(row.id); }
        derived(records, 'kayan', 'https://kayan.uz/api/filter',
          { endpoint: 'websitePlans', projectSlug: project.slug, projectId: project.id, propertyType: type, page }, { rows, terminal: rows.length < 12 });
        if (rows.length < 12) break;
        check(page < 100, 'KAYAN public pagination exceeded limit');
      }
      check(JSON.stringify(await fetchPage(type, 1)) === first, 'KAYAN public listing changed during pagination; retry entire capture');
    }
  }
}

export function kayanWebsiteInput(capture) {
  const records = capture.records;
  check(records.length > 0 && records.every(row => row.method === 'DERIVED' && row.url?.origin === 'https://kayan.uz'
    && row.url.path === '/api/filter' && row.scope?.endpoint === 'websitePlans'), 'Unexpected KAYAN website capture record');
  const groups = KAYAN.map(project => ({ project, types: Object.keys(TYPES).map(type => {
    const pages = records.filter(row => row.scope.projectSlug === project.slug && row.scope.propertyType === type)
      .sort((a, b) => a.scope.page - b.scope.page);
    check(pages.length > 0 && pages.length <= 100, 'KAYAN website capture is missing required property type');
    pages.forEach((page, index) => {
      check(page.scope.projectId === project.id && page.scope.page === index + 1, 'KAYAN website pages are not contiguous or project-bound');
      projectPage(page.value?.rows, project, type);
      check(page.value.terminal === (index === pages.length - 1) && page.value.terminal === (page.value.rows.length < 12), 'KAYAN website pagination is incomplete');
    });
    return { type, rows: pages.flatMap(page => page.value.rows), records: pages.length };
  }) }));
  check(groups.reduce((sum, group) => sum + group.types.reduce((n, type) => n + type.records, 0), 0) === records.length, 'KAYAN unexpected/duplicate capture scope');
  return groups;
}

export function normalizeKayanWebsite(groups, capturedAt, template) {
  const audits = {}; const ids = new Set();
  const projects = groups.map(({ project, types }) => {
    const retained = template?.projects?.find(item => item.project?.slug === project.slug);
    check(retained, 'KAYAN enrichment template is missing project');
    const keys = new Set(); const phases = new Map();
    const units = types.flatMap(({ type, rows }) => rows.map(row => {
      projectPage([row], project, type);
      const house = project.houses[row.houseName];
      const number = String(row.number ?? '').trim(); const entrance = String(row.sectionName ?? '').trim();
      check(numeric(row.floor), 'KAYAN public floor is missing or invalid');
      check(numeric(row.rooms_amount), 'KAYAN public rooms are missing or invalid');
      check(numeric(row.area?.area_total), 'KAYAN public area is missing or invalid');
      const floor = Number(row.floor); const area = Number(row.area?.area_total); const rooms = Number(row.rooms_amount);
      check(['string', 'number'].includes(typeof row.number) && ['string', 'number'].includes(typeof row.sectionName) && number && number.length <= 64 && entrance && entrance.length <= 64 && Number.isInteger(floor) && floor >= -10 && floor <= 100 && area > 0 && Number.isFinite(area), 'KAYAN public dimensions are invalid');
      check(Number.isInteger(rooms) && rooms >= (type === 'residential' ? 1 : 0) && rooms <= 20, 'KAYAN public room count is invalid');
      check(!ids.has(row.id), 'KAYAN duplicate public ID'); ids.add(row.id);
      const kind = TYPES[type]; const sourceKey = `${house.id}:${kind}:${entrance}:${floor}:${number}`.toLowerCase();
      check(!keys.has(sourceKey), 'KAYAN duplicate physical unit identity'); keys.add(sourceKey);
      const old = retained.units?.find(unit => unit.sourceKey === sourceKey);
      check(!old || (Math.abs(Number(old.area) - area) < 0.02 && old.floor === floor), 'KAYAN public unit contradicts retained identity');
      const phase = retained.project.phases?.find(item => String(item.sourceId) === String(house.id));
      phases.set(house.id, { ...phase, sourceId: String(house.id), slug: house.slug, name: house.name, propertyType: house.slug === 'parking' ? 'parking' : 'apartment' });
      // Public KAYAN cards display neither prices nor explicit availability.
      // Omit status; the overlay importer preserves existing status and price.
      return { id: String(row.id), sourceId: String(row.id), sourceKey, projectSlug: project.slug,
        phaseSlug: house.slug, phaseName: house.name, houseId: house.id, propertyType: kind,
        rawPropertyType: type, number, entrance, floor, area,
        rooms: kind === 'parking' ? null : rooms, price: null, pricePerM2: null,
        ...(old?.planImageUrl?.startsWith(`/kayan/${project.slug}/`) ? { planImageUrl: old.planImageUrl } : {}) };
    }));
    const audit = { complete: true, inventoryComplete: false, expectedRecords: units.length, observedRecords: units.length, uniqueIdentities: keys.size };
    audits[project.slug] = audit;
    return { catalogScope: 'published-offers', sourceCount: units.length, officialCount: units.length, complete: false,
      project: { developerSlug: 'kayan', slug: project.slug, name: project.name, updatedAt: capturedAt, phases: [...phases.values()] },
      completeness: audit, units };
  });
  return { artifact: { generatedAt: capturedAt, catalogScope: 'published-offers', projects }, audit: audits };
}

export async function captureAvalonWebsite(records) {
  const { text: html } = await read('https://avalonresidence.uz/');
  const text = html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check(/Avalon\s+Residence/i.test(text) && /268\s*(?:ta\s*)?xonadon/i.test(text)
    && /Tuzel\s+massivi,\s*2-kvartal,\s*33/i.test(text), 'Avalon official website project identity changed');
  // The source publishes typical plans, not an apartment availability/price feed.
  // A checked zero-unit overlay preserves every existing apartment and price.
  derived(records, 'uysot', 'https://avalonresidence.uz/', { endpoint: 'marketingProject', projectSlug: 'avalon-residence' },
    { projectSlug: 'avalon-residence', marketingTotal: 268, unitListingAvailable: false, priceListingAvailable: false });
}
export function normalizeAvalonWebsite(capture, capturedAt) {
  check(capture.records.length === 1, 'Avalon marketing source has unexpected records');
  const row = capture.records[0];
  check(row.method === 'DERIVED' && row.url?.origin === 'https://avalonresidence.uz' && row.url.path === '/'
    && row.scope?.endpoint === 'marketingProject' && row.value?.projectSlug === 'avalon-residence'
    && row.value.marketingTotal === 268 && row.value.unitListingAvailable === false, 'Avalon website evidence is invalid');
  const audit = { complete: true, inventoryComplete: false, expectedRecords: 0, observedRecords: 0, uniqueIdentities: 0, sourceCoverage: 'marketing-only' };
  return { artifact: { capturedAt, catalogScope: 'published-offers', sourceCount: 0,
    project: { slug: 'avalon-residence', name: 'Avalon Residence', developerSlug: 'avalon', updatedAt: capturedAt },
    completeness: audit, units: [], source: { url: 'https://avalonresidence.uz/', coverage: 'marketing-only', marketingTotal: 268 } }, audit };
}
