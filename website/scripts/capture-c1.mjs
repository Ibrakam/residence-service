import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceRoot = path.join(root, 'source', 'c1');
const rawDir = path.join(sourceRoot, 'raw');
const pagesDir = path.join(sourceRoot, 'pages');
const endpoint = 'https://mbc.uz/api';
const project = '2';
const type = 'residential';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const safeHeaders = (headers) => Object.fromEntries(
  ['date', 'content-type', 'cache-control', 'server', 'x-ratelimit-limit', 'x-ratelimit-remaining']
    .map((name) => [name, headers.get(name)])
    .filter(([, value]) => value),
);

async function post(route, values) {
  const requestedAt = new Date().toISOString();
  const body = new URLSearchParams(values);
  const response = await fetch(`${endpoint}/${route}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return {
    requestedAt,
    completedAt: new Date().toISOString(),
    request: { method: 'POST', url: `${endpoint}/${route}`, fields: Object.fromEntries(body) },
    response: { status: response.status, headers: safeHeaders(response.headers), bytes: Buffer.byteLength(text), sha256: sha256(text) },
    payload: JSON.parse(text),
  };
}

async function get(url) {
  const requestedAt = new Date().toISOString();
  const response = await fetch(url, { headers: { Accept: 'text/html' } });
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { requestedAt, completedAt: new Date().toISOString(), url, headers: safeHeaders(response.headers), bytes: Buffer.byteLength(text), sha256: sha256(text), text };
}

function buildingRows(html, floor) {
  const rows = [];
  const item = /<li class="floor-flats__item" data-id="([^"]+)">([\s\S]*?)<\/li>/g;
  for (const match of html.matchAll(item)) {
    const body = match[2];
    const value = (className) => body.match(new RegExp(`<div class="${className}">([^<]*)<\\/div>`))?.[1]?.trim() ?? '';
    rows.push({ crmId: match[1], floor, number: value('floor-flats__number'), rooms: Number(value('floor-flats__rooms')), area: Number(value('floor-flats__square')), status: value('floor-flats__status') });
  }
  return rows;
}

function buildingPolygonIds(html) {
  return [...html.matchAll(/<polygon\b[^>]*\bdata-id="([^"]+)"[^>]*>/gi)].map((match) => match[1]);
}

await mkdir(rawDir, { recursive: true });
await mkdir(pagesDir, { recursive: true });
const captureStartedAt = new Date().toISOString();
const resultBefore = await post('result', { project, type });
const first = await post('plans', { project, type, page: '1' });
const pages = [first];
for (let page = 2; page <= Number(first.payload.plans.last_page); page += 1) {
  pages.push(await post('plans', { project, type, page: String(page) }));
}
const resultAfter = await post('result', { project, type });
const units = pages.flatMap((page) => page.payload.plans.data);

const pageCaptures = {};
for (const language of ['ru', 'uz', 'en']) {
  const capture = await get(`https://mbc.uz/${language}/project/c1`);
  await writeFile(path.join(pagesDir, `${language}.html`), capture.text);
  pageCaptures[language] = { url: capture.url, requestedAt: capture.requestedAt, completedAt: capture.completedAt, headers: capture.headers, bytes: capture.bytes, sha256: capture.sha256 };
}

const buildingFloorRows = [];
const buildingResponses = [];
const buildingPolygonIdsByFloor = [];
for (let floor = 2; floor <= 30; floor += 1) {
  const capture = await get(`https://mbc.uz/ru/building/26?floor=${floor}`);
  const rows = buildingRows(capture.text, floor);
  const polygonIds = buildingPolygonIds(capture.text);
  buildingFloorRows.push(...rows);
  buildingPolygonIdsByFloor.push(...polygonIds.map((crmId) => ({ floor, crmId })));
  buildingResponses.push({ floor, url: capture.url, headers: capture.headers, bytes: capture.bytes, sha256: capture.sha256, rowCount: rows.length, polygonCount: polygonIds.length, polygonIds });
}

const apiAvailable = units.filter((unit) => unit.status === 'AVAILABLE' && unit.type === type);
const apiAvailableIds = new Set(apiAvailable.map((unit) => String(unit.crm_id)));
const allPolygonIds = new Set(buildingPolygonIdsByFloor.map((entry) => entry.crmId));
const buildingAvailableIds = new Set([...apiAvailableIds].filter((crmId) => allPolygonIds.has(crmId)));
const buildingListedAvailableIds = new Set(buildingFloorRows.filter((unit) => unit.status === 'AVAILABLE').map((unit) => unit.crmId));
const listedAvailableWithoutPolygon = [...buildingListedAvailableIds].filter((crmId) => !allPolygonIds.has(crmId));
const missingFromBuilding = apiAvailable.filter((unit) => !buildingAvailableIds.has(String(unit.crm_id))).map((unit) => ({ id: unit.id, crmId: String(unit.crm_id), number: String(unit.number), floor: Number(unit.floor), rooms: Number(unit.rooms), area: Number(unit.square) }));
const manifest = {
  project: { id: 2, slug: 'c1', name: 'C1', buildingId: 26 },
  captureStartedAt,
  captureCompletedAt: new Date().toISOString(),
  source: { pages: 'project pages in ru/uz/en', apiPlans: `${endpoint}/plans`, apiResult: `${endpoint}/result`, building: 'building 26, floors 2–30' },
  requestPolicy: 'API requests are application/x-www-form-urlencoded with project=2 and type=residential; no cookies, credentials, CSRF tokens or browser storage persisted.',
  counts: {
    resultBefore: Number(resultBefore.payload.result),
    plans: units.length,
    availableResidential: apiAvailable.length,
    resultAfter: Number(resultAfter.payload.result),
    buildingAvailableUnique: buildingAvailableIds.size,
    buildingListedAvailableUnique: buildingListedAvailableIds.size,
    missingFromBuilding: missingFromBuilding.length,
  },
  polygonEvidence: { parser: 'SVG polygon[data-id]', availableIds: [...buildingAvailableIds].sort(), listedAvailableIds: [...buildingListedAvailableIds].sort(), listedAvailableWithoutPolygon },
  reconciliation: 'The apartment catalogue uses the typed /api/plans snapshot as canonical. Building 26 is a floor-polygon presentation and exposes fewer AVAILABLE CRM IDs; its missing rows are preserved as ordinary catalogue entries without invented facade or floor polygons.',
  stable: Number(resultBefore.payload.result) === units.length && units.length === Number(resultAfter.payload.result) && units.every((unit) => unit.status === 'AVAILABLE' && unit.type === type) && buildingAvailableIds.size === buildingListedAvailableIds.size && listedAvailableWithoutPolygon.length === 0,
  serverDates: { firstResult: resultBefore.response.headers.date, firstPlansPage: pages[0].response.headers.date, lastPlansPage: pages.at(-1).response.headers.date, finalResult: resultAfter.response.headers.date },
  pages: pageCaptures,
  missingFromBuilding,
  rawFiles: ['plans-all-pages.json', 'result-checks.json', 'building-26.json'],
};

if (!manifest.stable) throw new Error(`Snapshot changed during capture: ${JSON.stringify(manifest.counts)}`);
await writeFile(path.join(rawDir, 'plans-all-pages.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), pages }, null, 2)}\n`);
await writeFile(path.join(sourceRoot, 'result-checks.json'), `${JSON.stringify({ resultBefore, resultAfter }, null, 2)}\n`);
await writeFile(path.join(rawDir, 'building-26.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), responses: buildingResponses, rows: buildingFloorRows, polygons: buildingPolygonIdsByFloor }, null, 2)}\n`);
await writeFile(path.join(sourceRoot, 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
