import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  constants as fsConstants,
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceStandaloneRoot = resolve(websiteRoot, 'dist/standalone');
const sourceStandaloneEntry = resolve(sourceStandaloneRoot, 'server.js');
const sourceBuildEntry = resolve(sourceStandaloneRoot, 'dist/server/index.js');
const projects = [
  '4u',
  'bayterak',
  'botanika-saroyi',
  'flagman',
  'jomiy',
  'maftun-makon',
  'meros',
  'mirador',
  'ofiyat',
  'regnum-plaza',
  'sado',
  'sun',
  'voha',
  'yangibaxt',
  'zamon',
];
const languages = ['ru', 'uz', 'en'];
const expectedExplorerKeys = ['area', 'entrance', 'floor', 'number', 'phaseSlug', 'rooms', 'sourceKey', 'status'];
const publicAssetChecks = [
  { path: '/kayan/ofiyat/hero.webp', contentType: 'image/webp' },
  { path: '/kayan/mirador/hero.webp', contentType: 'image/webp' },
  { path: '/kayan/mirador/floor-schemes/entrance-3-floor-16.webp', contentType: 'image/webp' },
  { path: '/sun/sun-official-booklet.pdf', contentType: 'application/pdf', range: true },
  { path: '/sun/video/hero-mobile.mp4', contentType: 'video/mp4', range: true },
];

const rawBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

assert.equal(Number(process.versions.node.split('.')[0]), 22, `Base-path deployment smoke must run on Node 22.x, received ${process.versions.node}`);
assert.match(rawBasePath, /^\/[a-z0-9][a-z0-9-]*$/i, 'NEXT_PUBLIC_APP_BASE_PATH must be one non-root path segment with a leading slash (for production: /tencrop)');
assert.ok(siteOrigin, 'NEXT_PUBLIC_SITE_URL is required');
assert.doesNotThrow(() => new URL(siteOrigin), 'NEXT_PUBLIC_SITE_URL must be an absolute URL');
assert.ok(existsSync(sourceStandaloneEntry), 'Standalone server is missing; run npm run build with the same base-path environment first');
assert.ok(existsSync(sourceBuildEntry), 'Standalone server bundle is incomplete');
assert.ok(existsSync(resolve(sourceStandaloneRoot, 'node_modules/react/package.json')), 'Standalone React runtime closure is missing');
const runtimeManifest = JSON.parse(readFileSync(resolve(sourceStandaloneRoot, 'STANDALONE_RUNTIME.json'), 'utf8'));
assert.deepEqual(runtimeManifest.packages?.map(({ name, version }) => `${name}@${version}`), ['react@19.2.8'], 'Standalone runtime closure changed without review');

function cloneTreeWithLinks(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    if (entry.isDirectory()) {
      cloneTreeWithLinks(sourcePath, destinationPath);
    } else if (entry.isSymbolicLink()) {
      symlinkSync(readlinkSync(sourcePath), destinationPath);
    } else if (entry.isFile()) {
      try {
        linkSync(sourcePath, destinationPath);
      } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        copyFileSync(sourcePath, destinationPath, fsConstants.COPYFILE_FICLONE);
      }
    } else {
      throw new Error(`Unsupported standalone entry: ${sourcePath}`);
    }
  }
}

// Starting inside website/dist can accidentally resolve a missing package from
// website/node_modules. Materialize the whole artifact below a fresh external
// directory so the smoke exercises the same dependency boundary as production.
const isolationRoot = realpathSync(mkdtempSync(join(tmpdir(), 'residence-standalone-smoke-')));
const standaloneRoot = resolve(isolationRoot, 'standalone');
cloneTreeWithLinks(sourceStandaloneRoot, standaloneRoot);
for (let ancestor = dirname(standaloneRoot); ; ancestor = dirname(ancestor)) {
  assert.ok(!existsSync(resolve(ancestor, 'node_modules')), `Isolation ancestor unexpectedly provides node_modules: ${ancestor}`);
  if (dirname(ancestor) === ancestor) break;
}
const standaloneEntry = resolve(standaloneRoot, 'server.js');

const publicPrefix = `${siteOrigin}${rawBasePath}`;
const isPublicBaseUrl = (value) => value === publicPrefix
  || value.startsWith(`${publicPrefix}/`)
  || value.startsWith(`${publicPrefix}?`)
  || value.startsWith(`${publicPrefix}#`);
const isBasePath = (value) => value === rawBasePath
  || value.startsWith(`${rawBasePath}/`)
  || value.startsWith(`${rawBasePath}?`)
  || value.startsWith(`${rawBasePath}#`);

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function headTags(html) {
  return [...html.matchAll(/<(?:link|meta)\b[^>]*>/gi)].map((match) => attributes(match[0]));
}

function collectJsonLdUrls(value, result = []) {
  if (typeof value === 'string') {
    if (value === siteOrigin || value.startsWith(`${siteOrigin}/`)) result.push(value);
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdUrls(item, result);
    return result;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectJsonLdUrls(item, result);
  }
  return result;
}

function assertNoFilesystemLeaks(value, context) {
  assert.ok(!value.includes('/Users/'), `${context} leaks an absolute macOS filesystem path`);
  assert.ok(!value.includes('file://'), `${context} leaks a file URL`);
  assert.ok(!/[A-Za-z]:\\/.test(value), `${context} leaks an absolute Windows filesystem path`);
}

function assertRootRelativeAttributes(html, context) {
  for (const tag of html.matchAll(/<[a-z][^>]*>/gi)) {
    const attrs = attributes(tag[0]);
    for (const name of ['href', 'src', 'action', 'poster']) {
      const value = attrs[name];
      if (value?.startsWith('/') && !value.startsWith('//')) {
        assert.ok(isBasePath(value), `${context} contains an unprefixed ${name}=${value}`);
      }
    }
    if (!attrs.srcset) continue;
    for (const candidate of attrs.srcset.split(',')) {
      const value = candidate.trim().split(/\s+/, 1)[0];
      if (value?.startsWith('/') && !value.startsWith('//')) {
        assert.ok(isBasePath(value), `${context} contains an unprefixed srcset URL ${value}`);
      }
    }
  }
}

function assertProjectMetadata(html, context) {
  const tags = headTags(html);
  const canonical = tags.find((tag) => tag.rel?.split(/\s+/).includes('canonical'))?.href;
  assert.ok(canonical, `${context} is missing a canonical URL`);
  assert.ok(isPublicBaseUrl(canonical), `${context} canonical escapes the public base path: ${canonical}`);

  const alternates = tags.filter((tag) => tag.rel?.split(/\s+/).includes('alternate') && tag.hreflang);
  assert.ok(alternates.length >= 3, `${context} must expose RU/UZ/EN alternates`);
  for (const alternate of alternates) {
    assert.ok(isPublicBaseUrl(alternate.href), `${context} hreflang ${alternate.hreflang} escapes the public base path: ${alternate.href}`);
  }

  const openGraphUrl = tags.find((tag) => tag.property === 'og:url')?.content;
  if (openGraphUrl) assert.ok(isPublicBaseUrl(openGraphUrl), `${context} og:url escapes the public base path: ${openGraphUrl}`);

  for (const match of html.matchAll(/<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi)) {
    const structuredData = JSON.parse(decodeHtml(match[1].trim()));
    for (const value of collectJsonLdUrls(structuredData)) {
      assert.ok(isPublicBaseUrl(value), `${context} JSON-LD URL escapes the public base path: ${value}`);
    }
  }
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const port = address.port;
      server.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function waitForServer(localOrigin, child, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vinext start exited before becoming ready (${child.exitCode})\n${logs()}`);
    try {
      const response = await fetch(`${localOrigin}${rawBasePath}`, { redirect: 'manual' });
      if (response.status > 0) return;
    } catch {
      // The listener is not ready yet.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for vinext start\n${logs()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolveExit) => child.once('exit', () => resolveExit(true))),
    delay(3_000).then(() => false),
  ]);
  if (!stopped && child.exitCode === null) child.kill('SIGKILL');
}

async function fetchText(localOrigin, path, expectedStatus = 200) {
  const response = await fetch(`${localOrigin}${path}`, { redirect: 'manual' });
  const body = await response.text();
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}, expected ${expectedStatus}: ${body.slice(0, 240)}`);
  assertNoFilesystemLeaks([...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'), `${path} headers`);
  assertNoFilesystemLeaks(body, `${path} body`);
  return { response, body };
}

async function mapWithConcurrency(values, concurrency, callback) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await callback(values[index], index);
    }
  });
  await Promise.all(workers);
}

const port = await freePort();
const localOrigin = `http://127.0.0.1:${port}`;
let stdout = '';
let stderr = '';
const child = spawn(process.execPath, [
  '--permission',
  `--allow-fs-read=${standaloneRoot}`,
  standaloneEntry,
], {
  cwd: standaloneRoot,
  env: {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: '/nonexistent',
    TMPDIR: tmpdir(),
    NODE_ENV: 'production',
    NEXT_PUBLIC_APP_BASE_PATH: rawBasePath,
    NEXT_PUBLIC_SITE_URL: siteOrigin,
    HOST: '127.0.0.1',
    PORT: String(port),
    LEAD_BACKEND_URL: 'http://127.0.0.1:9/v1/leads',
    CATALOG_API_URL: '',
    LEAD_FORWARD_URL: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-24_000); });
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-24_000); });
const logs = () => `${stdout}\n${stderr}`.trim();

try {
  await waitForServer(localOrigin, child, logs);

  const htmlRoutes = [rawBasePath, `${rawBasePath}/privacy?lang=en`];
  for (const path of htmlRoutes) {
    const { body } = await fetchText(localOrigin, path);
    assertRootRelativeAttributes(body, path);
  }

  const projectRoutes = projects.flatMap((project) => (
    languages.flatMap((language) => [
      `${rawBasePath}/${project}?lang=${language}`,
      `${rawBasePath}/${project}/apartments?lang=${language}`,
    ])
  ));

  const assetPaths = new Set();
  await mapWithConcurrency(projectRoutes, 6, async (path) => {
    const { body } = await fetchText(localOrigin, path);
    assertRootRelativeAttributes(body, path);
    assertProjectMetadata(body, path);
    for (const match of body.matchAll(/<(?:link|script)\b[^>]*>/gi)) {
      const tag = attributes(match[0]);
      const value = tag.href ?? tag.src;
      if (typeof value === 'string' && value.startsWith(`${rawBasePath}/_next/`)) {
        assetPaths.add(value.split('?', 1)[0]);
      }
    }
  });

  await mapWithConcurrency(projectRoutes, 6, async (path) => {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${localOrigin}${path}${separator}_rsc`, {
      redirect: 'manual',
      headers: { Accept: 'text/x-component', RSC: '1' },
    });
    const body = await response.text();
    assert.equal(response.status, 200, `${path} RSC navigation returned ${response.status}`);
    assert.ok(response.headers.get('content-type')?.startsWith('text/x-component'), `${path} RSC navigation has the wrong Content-Type`);
    assert.ok(body.length > 0, `${path} RSC navigation returned an empty body`);
    assertNoFilesystemLeaks(body, `${path} RSC body`);
  });

  assert.ok(assetPaths.size > 0, 'No built asset URL was found in project HTML');
  const standaloneClientRoot = resolve(standaloneRoot, 'dist/client');
  for (const assetPath of assetPaths) {
    const assetFile = resolve(standaloneClientRoot, `.${assetPath}`);
    assert.ok(assetFile.startsWith(`${standaloneClientRoot}/`), `Built asset escapes the standalone client directory: ${assetPath}`);
    assert.ok(existsSync(assetFile), `Built asset is missing from standalone output: ${assetPath}`);
  }

  // vinext 1.0.0-beta.8 does not expose its generated App Router asset-prefix
  // exports to startProdServer, so path-prefixed _next files currently need to
  // be served directly from dist/standalone/dist/client by the reverse proxy.
  const representativeAsset = [...assetPaths][0];
  const directAssetResponse = await fetch(`${localOrigin}${representativeAsset}`, { redirect: 'manual' });
  assert.ok(directAssetResponse.status === 200 || directAssetResponse.status === 404, `Unexpected direct standalone asset status ${directAssetResponse.status}`);
  const staticProxyRequired = directAssetResponse.status === 404;
  if (!staticProxyRequired) {
    assertNoFilesystemLeaks([...directAssetResponse.headers].map(([name, value]) => `${name}: ${value}`).join('\n'), `${representativeAsset} headers`);
  }

  for (const asset of publicAssetChecks) {
    const publicPath = `${rawBasePath}${asset.path}`;
    const response = await fetch(`${localOrigin}${publicPath}`, {
      redirect: 'manual',
      headers: asset.range ? { Range: 'bytes=0-1023' } : undefined,
    });
    assert.equal(response.status, asset.range ? 206 : 200, `${publicPath} returned ${response.status}`);
    assert.ok(response.headers.get('content-type')?.startsWith(asset.contentType), `${publicPath} has the wrong Content-Type`);
    assert.match(response.headers.get('cache-control') ?? '', /public,\s*max-age=3600/, `${publicPath} has the wrong cache policy`);
    if (asset.range) assert.equal(response.headers.get('accept-ranges'), 'bytes', `${publicPath} does not advertise byte ranges`);
    assertNoFilesystemLeaks([...response.headers].map(([name, value]) => `${name}: ${value}`).join('\n'), `${publicPath} headers`);
    assert.ok((await response.arrayBuffer()).byteLength > 0, `${publicPath} returned an empty body`);
  }

  const explorerResponse = await fetch(`${localOrigin}${rawBasePath}/api/kayan/ofiyat-explorer`, { redirect: 'manual' });
  assert.equal(explorerResponse.status, 200, 'Ofiyat explorer API must be available below the base path');
  assert.match(explorerResponse.headers.get('cache-control') ?? '', /max-age=300/, 'Ofiyat explorer API has the wrong cache policy');
  const explorer = await explorerResponse.json();
  assert.equal(explorer.items?.length, 414, 'Ofiyat explorer API item count changed');
  for (const [index, item] of explorer.items.entries()) {
    assert.deepEqual(Object.keys(item).sort(), expectedExplorerKeys, `Ofiyat explorer item ${index} exposes an unexpected field set`);
  }

  const { body: sitemap } = await fetchText(localOrigin, `${rawBasePath}/sitemap.xml`);
  const sitemapUrls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => decodeHtml(match[1]));
  assert.ok(sitemapUrls.length >= 92, `Sitemap contains only ${sitemapUrls.length} URLs`);
  assert.ok(sitemapUrls.includes(`${publicPrefix}/ofiyat?lang=en`), 'Sitemap is missing a base-prefixed project URL');
  for (const value of sitemapUrls) assert.ok(isPublicBaseUrl(value), `Sitemap URL escapes the public base path: ${value}`);

  const { body: robots } = await fetchText(localOrigin, `${rawBasePath}/robots.txt`);
  assert.match(robots, new RegExp(`Allow:\\s*${rawBasePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), 'robots.txt has the wrong allow path');
  assert.ok(robots.includes(`Sitemap: ${publicPrefix}/sitemap.xml`), 'robots.txt has the wrong sitemap URL');

  await fetchText(localOrigin, '/ofiyat', 404);
  await fetchText(localOrigin, '/sitemap.xml', 404);

  console.log(`Base-path deployment smoke passed on Node ${process.versions.node}: ${projectRoutes.length} localized HTML pages plus ${projectRoutes.length} RSC navigations, 2 shared pages, ${assetPaths.size} referenced build assets, ${publicAssetChecks.length} public image/floor/PDF/video assets, 414 API items, sitemap and robots all stay below ${rawBasePath}. Reverse-proxy static alias required: ${staticProxyRequired}.`);
} catch (error) {
  if (logs()) console.error(`vinext output:\n${logs()}`);
  throw error;
} finally {
  await stopServer(child);
  rmSync(isolationRoot, { force: true, recursive: true });
}
