import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const sourceDir = path.join(root, 'source', 'saadiyat', 'raw');
const endpoint = 'https://mbc.uz/api';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const safeHeaders = (headers) => Object.fromEntries(
  ['date', 'content-type', 'cache-control', 'server', 'x-ratelimit-limit', 'x-ratelimit-remaining']
    .map((name) => [name, headers.get(name)])
    .filter(([, value]) => value),
);

async function post(route, values) {
  const startedAt = new Date().toISOString();
  const body = new URLSearchParams(values);
  const response = await fetch(`${endpoint}/${route}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  return {
    requestedAt: startedAt,
    completedAt: new Date().toISOString(),
    request: { method: 'POST', url: `${endpoint}/${route}`, fields: Object.fromEntries(body) },
    response: { status: response.status, headers: safeHeaders(response.headers), bytes: Buffer.byteLength(text), sha256: sha256(text) },
    payload: JSON.parse(text),
  };
}

async function capturePlans(name, values) {
  const first = await post('plans', { ...values, page: '1' });
  const lastPage = Number(first.payload.plans.last_page);
  const pages = [first];
  for (let page = 2; page <= lastPage; page += 1) pages.push(await post('plans', { ...values, page: String(page) }));
  await writeFile(path.join(sourceDir, `${name}.json`), `${JSON.stringify({ capturedAt: new Date().toISOString(), pages }, null, 2)}\n`);
  return { pages, units: pages.flatMap((page) => page.payload.plans.data) };
}

await mkdir(sourceDir, { recursive: true });
const captureStartedAt = new Date().toISOString();
const allResultBefore = await post('result', { project: '18' });
const residentialResultBefore = await post('result', { project: '18', type: 'residential' });
const commercialResultBefore = await post('result', { project: '18', type: 'commercial' });
const all = await capturePlans('plans-all-pages', { project: '18' });
const allResultAfter = await post('result', { project: '18' });
const residentialResultAfter = await post('result', { project: '18', type: 'residential' });
const commercialResultAfter = await post('result', { project: '18', type: 'commercial' });

const availableResidential = all.units.filter((unit) => unit.status === 'AVAILABLE' && unit.type === 'residential');
const availableCommercial = all.units.filter((unit) => unit.status === 'AVAILABLE' && unit.type === 'commercial');
const manifest = {
  project: { id: 18, slug: 'saadiyat', name: 'SAADIYAT' },
  captureStartedAt,
  captureCompletedAt: new Date().toISOString(),
  source: { pages: 'https://mbc.uz/{ru|uz|en}/project/saadiyat', apiPlans: `${endpoint}/plans`, apiResult: `${endpoint}/result` },
  requestPolicy: 'application/x-www-form-urlencoded; no cookies, CSRF tokens, credentials or browser storage persisted',
  counts: {
    resultBefore: { all: allResultBefore.payload.result, residential: residentialResultBefore.payload.result, commercial: commercialResultBefore.payload.result },
    plans: { all: all.units.length, residential: availableResidential.length, commercial: availableCommercial.length },
    resultAfter: { all: allResultAfter.payload.result, residential: residentialResultAfter.payload.result, commercial: commercialResultAfter.payload.result },
    publicApartmentCatalog: availableResidential.length,
  },
  reconciliation: 'The untyped /api/plans and /api/result totals include residential and commercial stock. The public apartment catalogue uses only records where type=residential and status=AVAILABLE. Commercial records are preserved in the raw capture but excluded from the apartment UI.',
  stable: allResultBefore.payload.result === all.units.length && all.units.length === allResultAfter.payload.result
    && residentialResultBefore.payload.result === availableResidential.length && availableResidential.length === residentialResultAfter.payload.result
    && commercialResultBefore.payload.result === availableCommercial.length && availableCommercial.length === commercialResultAfter.payload.result,
  serverDates: {
    firstResult: allResultBefore.response.headers.date,
    firstPlansPage: all.pages[0].response.headers.date,
    lastPlansPage: all.pages.at(-1).response.headers.date,
    finalResult: allResultAfter.response.headers.date,
  },
  rawFiles: ['plans-all-pages.json'],
};

if (!manifest.stable) throw new Error(`Snapshot changed during capture: ${JSON.stringify(manifest.counts)}`);
await writeFile(path.join(root, 'source', 'saadiyat', 'capture-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(root, 'source', 'saadiyat', 'result-checks.json'), `${JSON.stringify({ allResultBefore, residentialResultBefore, commercialResultBefore, allResultAfter, residentialResultAfter, commercialResultAfter }, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
