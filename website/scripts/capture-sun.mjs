import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceParent = resolve(websiteRoot, 'source');
const sourceRoot = resolve(sourceParent, 'sun');
const stagingRoot = resolve(sourceParent, `.sun-capture-${process.pid}`);
const replace = process.argv.includes('--replace');
const domain = 'human2human.uz';
const complexId = 5092562;
const expectedHouseIds = [5092560, 5092636, 5092717, 5092830];
const expectedPlanIds = [259704, 259705, 259706, 259710, 259713, 259714, 259715, 259716, 259717, 259722, 259723, 259724, 259725, 259726, 259727, 259728];
const mediaIds = [34, 51, 52, 53, 54, 55, 73, 89, 90, 91, 92, 93, 94, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 526, 527, 528, 529];

const staticAssets = [
  { id: 'sun-logo', url: 'https://human2human.uz/wp-content/uploads/2025/04/logo-main.svg', localPath: 'assets/brand/logo-main.svg', classification: 'official-brand-logo' },
  { id: 'h2h-logo', url: 'https://human2human.uz/wp-content/uploads/2025/04/logo.svg', localPath: 'assets/brand/h2h-logo.svg', classification: 'official-developer-logo' },
  { id: 'hero-desktop', url: 'https://human2human.uz/wp-content/uploads/2025/09/human2_main.mp4', localPath: 'assets/video/hero-desktop.mp4', classification: 'official-mixed-cgi-construction-video' },
  { id: 'hero-mobile', url: 'https://human2human.uz/wp-content/uploads/2025/09/human2_main_mob.mp4', localPath: 'assets/video/hero-mobile.mp4', classification: 'official-mixed-cgi-construction-video' },
  { id: 'booklet', url: 'https://human2human.uz/wp-content/uploads/2025/06/buklet-zhk-sun_compressed.pdf', localPath: 'assets/booklet/sun-official-booklet.pdf', classification: 'official-archival-marketing-booklet' },
];

const cmsSources = [
  { id: 'landing-html', url: 'https://human2human.uz/', localPath: 'cms/landing.html', classification: 'official-current-landing-page' },
  { id: 'wordpress-page-13', url: 'https://human2human.uz/wp-json/wp/v2/pages/13', localPath: 'cms/page-13.json', classification: 'official-wordpress-page-rest' },
  { id: 'wordpress-posts', url: 'https://human2human.uz/wp-json/wp/v2/posts?per_page=100', localPath: 'cms/posts.json', classification: 'official-wordpress-posts-rest' },
  { id: 'robots', url: 'https://human2human.uz/robots.txt', localPath: 'cms/robots.txt', classification: 'official-crawl-policy' },
  { id: 'sitemap-index', url: 'https://human2human.uz/sitemap_index.xml', localPath: 'cms/sitemap-index.xml', classification: 'official-sitemap-index' },
  { id: 'page-sitemap', url: 'https://human2human.uz/page-sitemap.xml', localPath: 'cms/page-sitemap.xml', classification: 'official-page-sitemap' },
  { id: 'post-sitemap', url: 'https://human2human.uz/post-sitemap.xml', localPath: 'cms/post-sitemap.xml', classification: 'official-post-sitemap' },
];

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function jsonBuffer(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
function parseJson(buffer, label) {
  try { return JSON.parse(buffer.toString('utf8')); }
  catch (error) { fail(`${label}: invalid JSON (${error instanceof Error ? error.message : String(error)})`); }
}
async function exists(path) { try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; } }
async function write(relativePath, buffer) {
  const path = resolve(stagingRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}

const records = [];
const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function retryDelay(attempt, response) {
  const retryAfter = response?.headers.get('retry-after');
  const seconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : 0;
  return Math.min(15_000, Math.max(seconds * 1_000, 750 * (2 ** (attempt - 1))));
}

async function fetchRecord({ id, url, localPath, classification, method = 'GET', body = null, headers = {}, timeoutMs = 60_000, attempts = 6 }) {
  const requestedAt = new Date().toISOString();
  let response;
  let buffer;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: '*/*', 'User-Agent': 'SUN snapshot capture/1.0 (+offline source bundle)', ...headers },
        ...(body === null ? {} : { body }),
        redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
      });
      if (retryableStatuses.has(response.status) && attempt < attempts) {
        lastError = new Error(`HTTP ${response.status}`);
        await response.body?.cancel().catch(() => {});
      } else {
        try {
          buffer = Buffer.from(await response.arrayBuffer());
          break;
        } catch (error) {
          lastError = error;
          response = undefined;
          buffer = undefined;
          if (attempt === attempts) break;
        }
      }
    } catch (error) {
      lastError = error;
      response = undefined;
      buffer = undefined;
      if (attempt === attempts) break;
    }
    const delay = retryDelay(attempt, response);
    console.warn(`${id}: attempt ${attempt}/${attempts} failed (${lastError instanceof Error ? lastError.message : String(lastError)}); retrying in ${delay}ms`);
    await new Promise((resolveWait) => setTimeout(resolveWait, delay));
  }
  if (!response || !buffer) fail(`${id}: fetch failed after retries (${lastError instanceof Error ? lastError.message : String(lastError)})`);
  assert(response.ok, `${id}: HTTP ${response.status} for ${url}`);
  await write(localPath, buffer);
  const record = {
    id, method, url, finalUrl: response.url, localPath, classification,
    requestBody: body && headers['Content-Type'] === 'application/json' ? JSON.parse(body) : null,
    requestedAt, completedAt: new Date().toISOString(), serverDate: response.headers.get('date'),
    httpStatus: response.status, contentType: response.headers.get('content-type'),
    sourceByteSize: buffer.byteLength, localByteSize: buffer.byteLength,
    sourceSha256: sha256(buffer), localSha256: sha256(buffer),
  };
  records.push(record);
  return { buffer, value: response.headers.get('content-type')?.includes('json') ? parseJson(buffer, id) : null, record };
}

async function catalogPost(catalogUrl, action, data, localPath) {
  return fetchRecord({
    id: `macro-${action}-${localPath.replaceAll('/', '-')}`,
    url: catalogUrl,
    localPath,
    classification: 'official-macrocrm-api-response',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ action, data, auth_token: null, locale: 'ru' }),
  });
}

async function pool(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

function mediaClassification(id) {
  if (id === 34 || id === 73 || (id >= 51 && id <= 55)) return 'official-cgi-architecture';
  if (id >= 89 && id <= 94) return 'official-cgi-courtyard-concept';
  if (id >= 98 && id <= 102) return 'official-cgi-lounge-concept';
  if (id >= 103 && id <= 112) return 'official-cgi-exploited-roof-concept';
  if (id >= 113 && id <= 118) return 'official-cgi-lobby-concept';
  if (id >= 526 && id <= 529) return 'official-construction-photo-2026-08-15';
  return 'official-wordpress-media';
}

function mediaName(media) {
  const extension = extname(new URL(media.source_url).pathname).toLowerCase() || '.bin';
  const label = media.id === 34 ? 'overview' : media.id === 73 ? 'overview-dark' : media.id === 526 ? 'construction-a' : media.id === 527 ? 'construction-v' : media.id === 528 ? 'construction-d' : media.id === 529 ? 'construction-g' : `media-${String(media.id).padStart(3, '0')}`;
  return `assets/official/${label}${extension}`;
}

async function main() {
  await mkdir(sourceParent, { recursive: true });
  assert(!(await exists(stagingRoot)), `Unexpected staging path already exists: ${stagingRoot}`);
  if (await exists(sourceRoot)) assert(replace, 'source/sun already exists; rerun with --replace to create a timestamped backup after a successful capture');
  await mkdir(stagingRoot, { recursive: false });
  const capturedAt = new Date().toISOString();
  console.log(`SUN capture started ${capturedAt}`);

  await pool(cmsSources, 2, fetchRecord);

  const mediaRestUrl = `https://human2human.uz/wp-json/wp/v2/media?include=${mediaIds.join(',')}&per_page=100&orderby=include`;
  const mediaRest = await fetchRecord({ id: 'wordpress-media-inventory', url: mediaRestUrl, localPath: 'cms/media.json', classification: 'official-wordpress-media-rest' });
  const media = mediaRest.value;
  assert(Array.isArray(media) && media.length === mediaIds.length, `Expected ${mediaIds.length} WordPress media rows, found ${media?.length}`);
  assert(mediaIds.every((id) => media.some((item) => item.id === id)), 'WordPress media inventory is missing a required official media ID');

  await pool(staticAssets, 2, (asset) => fetchRecord({ ...asset, timeoutMs: 180_000 }));
  await pool(media, 5, (item) => fetchRecord({
    id: `wordpress-media-${item.id}`,
    url: item.source_url,
    localPath: mediaName(item),
    classification: mediaClassification(item.id), timeoutMs: 120_000,
  }));

  const embed = await fetchRecord({
    id: 'macro-embed-js',
    url: `https://api.macroserver.uz/estate/embedjs/?domain=${domain}`,
    localPath: 'api/handshake/embedjs.js',
    classification: 'official-macrocrm-bootstrap-script',
  });
  const apiMatch = embed.buffer.toString('utf8').match(/api_url:\s*'([^']+)'/);
  assert(apiMatch, 'MacroCRM embed JS did not expose api_url');
  const requestUrl = new URL(apiMatch[1].replaceAll('&amp;', '&'));
  const handshakeUuid = randomUUID();
  for (const [key, value] of Object.entries({
    type: 'catalog', iframemode: 'true', inline: 'true', locale: 'ru', fromApi: 'true',
    domain_config: '[object Object]', domain_config_overwrite: '[object Object]', issetJQuery: '1', uuid: handshakeUuid,
  })) requestUrl.searchParams.set(key, value);
  const signed = await fetchRecord({
    id: 'macro-signed-catalog-handshake', url: requestUrl.href,
    localPath: 'api/handshake/signed-catalog.json', classification: 'official-macrocrm-signed-handshake',
  });
  const catalogUrl = signed.value?.url;
  assert(typeof catalogUrl === 'string' && new URL(catalogUrl).origin === 'https://api.macroserver.uz', 'MacroCRM returned an unexpected signed catalogue URL');

  const getData = await catalogPost(catalogUrl, 'get_data', {}, 'api/get-data.json');
  assert(getData.value?.success === true, 'MacroCRM get_data failed');
  assert(getData.value.complexes?.some((item) => item.id === complexId && item.name === 'ЖК SUN'), 'SUN complex 5092562 was not found');
  const houseIds = getData.value.houses?.map((item) => item.id).sort((a, b) => a - b);
  assert(JSON.stringify(houseIds) === JSON.stringify([...expectedHouseIds].sort((a, b) => a - b)), `Unexpected public house IDs: ${houseIds}`);

  await catalogPost(catalogUrl, 'complexes_filter_by', {
    filters: {}, category: 'flat', activity: 'sell', cabinetMode: false, complex_id: [complexId],
  }, 'api/complexes-filter-by.json');
  const housesFilter = await catalogPost(catalogUrl, 'houses_filter_by', {
    filters: {}, category: 'flat', activity: 'sell', cabinetMode: false, complex_id: complexId,
  }, 'api/houses-filter-by.json');
  assert(housesFilter.value?.success === true, 'MacroCRM houses_filter_by failed');

  const estateTopology = await pool(expectedHouseIds, 4, async (houseId) => {
    const response = await catalogPost(catalogUrl, 'get_estates', {
      house_id: houseId, category: 'flat', activity: 'sell', filters: {}, cabinetMode: false,
    }, `api/estates/house-${houseId}.json`);
    assert(response.value?.success === true && Array.isArray(response.value?.estates), `get_estates failed for house ${houseId}`);
    return response.value;
  });

  const pages = [];
  for (let page = 0; page < 40; page += 1) {
    const response = await catalogPost(catalogUrl, 'objects_list', {
      category: 'flat', activity: 'sell', filters: {}, complex_id: complexId, page, cabinetMode: false,
    }, `api/objects/page-${String(page).padStart(2, '0')}.json`);
    assert(Array.isArray(response.value?.objects), `objects_list page ${page} did not return objects`);
    pages.push(response.value);
    if (response.value.isLastPage && page > 0) break;
  }
  assert(pages.length === 11, `Expected unusual 11-page MacroCRM contract (0–10), found ${pages.length}`);
  assert(pages[0].objects.length === 60 && pages.slice(1, 10).every((page) => page.objects.length === 30) && pages[10].objects.length === 6, 'MacroCRM pagination shape changed');
  const objectMap = new Map();
  for (const page of pages) for (const object of page.objects) {
    assert(Number.isSafeInteger(object.id), `Non-numeric unit ID: ${object.id}`);
    objectMap.set(object.id, object);
  }
  const objects = [...objectMap.values()].sort((left, right) => left.id - right.id);
  const rawStatusCounts = Object.fromEntries(['available', 'booked', 'sold'].map((status) => [status, objects.filter((item) => item.status === status).length]));
  const normalizedStatusCounts = { available: rawStatusCounts.available, reserve: rawStatusCounts.booked, sold: rawStatusCounts.sold };
  assert(objects.length === 306, `Expected 306 deduplicated flat records, found ${objects.length}`);
  assert(rawStatusCounts.available === 51 && rawStatusCounts.booked === 41 && rawStatusCounts.sold === 214, `Unexpected raw status counts ${JSON.stringify(rawStatusCounts)}`);
  const available = objects.filter((item) => item.status === 'available');

  const details = await pool(available, 5, async (object) => {
    const response = await catalogPost(catalogUrl, 'get_estate', {
      estate_id: object.id, house_id: object.estate.house, cabinetMode: false,
    }, `api/details/${object.id}.json`);
    assert(response.value?.success === true && response.value?.estate?.id === object.id, `get_estate failed for ${object.id}`);
    assert(response.value.estate.status === 'available', `Detail ${object.id} is no longer available`);
    return response.value;
  });

  const planFiles = new Map();
  const floorPlans = new Map();
  for (const detail of details) {
    for (const plan of detail.estate.plans ?? []) {
      if (!['primary', 'second'].includes(plan.type)) continue;
      const previous = planFiles.get(plan.file_id);
      if (previous) assert(previous.file_url === plan.file_url && previous.type === plan.type, `Plan file ${plan.file_id} changed within the same capture`);
      else planFiles.set(plan.file_id, plan);
    }
    const floorUrl = detail.estate.floor_plans?.img;
    if (floorUrl) {
      const match = floorUrl.match(/\/get\/\d+\/(\d+)\//);
      assert(match, `Could not identify floor-plan file in ${floorUrl}`);
      floorPlans.set(Number(match[1]), floorUrl);
    }
  }
  assert(planFiles.size === 32, `Expected 32 unique primary/second plan files, found ${planFiles.size}`);
  assert(floorPlans.size === 27, `Expected 27 unique floor-plan sources, found ${floorPlans.size}`);
  const capturedPlanIds = [...new Set(details.map((item) => item.estate.estate.plans_id))].sort((a, b) => a - b);
  assert(JSON.stringify(capturedPlanIds) === JSON.stringify(expectedPlanIds), `Unexpected current plan topology: ${capturedPlanIds}`);

  await pool([...planFiles.values()], 5, (plan) => fetchRecord({
    id: `macro-plan-file-${plan.file_id}-${plan.type}`,
    url: plan.file_url,
    localPath: `assets/plans/${plan.file_id}-${plan.type}.${String(plan.file_ext || 'jpg').toLowerCase()}`,
    classification: `official-current-unit-plan-${plan.type}`,
  }));
  await pool([...floorPlans], 5, ([fileId, url]) => fetchRecord({
    id: `macro-floor-plan-${fileId}`, url,
    localPath: `assets/floor-plans/${fileId}.jpg`,
    classification: 'official-floor-context-source-not-used-as-ui-mode',
  }));

  const captureIndex = {
    schemaVersion: 1, project: 'SUN', projectSlug: 'sun', capturedAt,
    timestampBasis: 'Local capture clock at the start of this successful network operation; individual records retain request/completion times and HTTP Date when provided.',
    operation: 'network', domain, complexId, handshakeUuid,
    assertions: {
      objectCount: objects.length,
      rawStatusCounts,
      normalizedStatusCounts,
      statusCounts: rawStatusCounts,
      availableDetailSuccess: details.length,
      estateTopologyResponses: estateTopology.length,
      planFileCount: planFiles.size,
      floorPlanFileCount: floorPlans.size,
      houseIds,
      planIds: capturedPlanIds,
    },
    records: records.sort((left, right) => left.localPath.localeCompare(right.localPath)),
  };
  await write('capture-index.json', jsonBuffer(captureIndex));

  if (await exists(sourceRoot)) {
    const backup = resolve(sourceParent, `.sun-backup-${capturedAt.replaceAll(':', '-').replaceAll('.', '-')}`);
    await rename(sourceRoot, backup);
    console.log(`Previous source/sun preserved at ${backup}`);
  }
  await rename(stagingRoot, sourceRoot);

  const build = spawnSync(process.execPath, ['scripts/build-sun-catalog.mjs'], { cwd: websiteRoot, encoding: 'utf8' });
  if (build.stdout) process.stdout.write(build.stdout);
  if (build.stderr) process.stderr.write(build.stderr);
  assert(build.status === 0, `Fresh SUN capture succeeded but offline build failed with status ${build.status}`);

  const index = JSON.parse(await readFile(resolve(sourceRoot, 'capture-index.json'), 'utf8'));
  console.log(`SUN capture complete: ${index.assertions.objectCount} records, ${index.assertions.rawStatusCounts.available} available details, ${index.assertions.rawStatusCounts.booked} raw booked → ${index.assertions.normalizedStatusCounts.reserve} reserve, ${index.assertions.planFileCount} plan files, ${index.assertions.floorPlanFileCount} unique floor sources.`);
}

main().catch(async (error) => {
  if (await exists(stagingRoot)) await rm(stagingRoot, { recursive: true, force: true });
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
