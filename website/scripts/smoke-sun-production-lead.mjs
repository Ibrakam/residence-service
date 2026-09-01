import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicCatalog = JSON.parse(await readFile(resolve(websiteRoot, 'data/sun-client.json'), 'utf8'));
assert.equal(publicCatalog.units?.length, 51, 'SUN production lead smoke requires the sanitized 51-unit snapshot');
const controlUnit = publicCatalog.units[0];
assert.match(controlUnit?.unitKey ?? '', /^sun-[a-z0-9-]+$/, 'SUN production lead smoke requires a stable public unit key');

const tempRoot = await mkdtemp(join(tmpdir(), 'sun-lead-smoke.'));
const keyPath = join(tempRoot, 'sink-key.pem');
const certPath = join(tempRoot, 'sink-cert.pem');
const children = new Set();
let sink;

function freePort() {
  return new Promise((resolvePort, rejectPort) => {
    const probe = createNetServer();
    probe.once('error', rejectPort);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function productionEnvironment(port, forwardUrl) {
  const environment = { ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1' };
  environment.SUN_LEAD_FORWARD_URL = '';
  if (forwardUrl) {
    environment.SUN_LEAD_FORWARD_URL = forwardUrl;
    environment.NODE_EXTRA_CA_CERTS = certPath;
  }
  return environment;
}

function startProduction(port, forwardUrl) {
  const child = spawn(process.execPath, [resolve(websiteRoot, 'node_modules/vinext/dist/cli.js'), 'start', '-H', '127.0.0.1', '-p', String(port)], {
    cwd: websiteRoot,
    env: productionEnvironment(port, forwardUrl),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);
  let output = '';
  const collect = (chunk) => { output = `${output}${chunk}`.slice(-12_000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('exit', () => children.delete(child));
  return { child, output: () => output };
}

async function waitForServer(url, processState) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (processState.child.exitCode !== null) throw new Error(`Production server exited early:\n${processState.output()}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.status === 200) return;
    } catch {
      // Production server is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
  }
  throw new Error(`Timed out waiting for production server:\n${processState.output()}`);
}

async function stopProduction(processState) {
  if (processState.child.exitCode !== null) return;
  processState.child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => processState.child.once('exit', resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 4_000)),
  ]);
  if (processState.child.exitCode === null) processState.child.kill('SIGKILL');
}

function generalPayload(name) {
  return {
    name,
    phone: '+998901234567',
    goal: 'live',
    consent: true,
    formContext: 'projectSlug=sun;lang=en;surface=landing:footer',
    projectSlug: 'sun',
    lang: 'en',
    language: 'en',
  };
}

function unitPayload(name) {
  return {
    ...generalPayload(name),
    formContext: `projectSlug=sun;lang=en;surface=catalog:card;unitKey=${controlUnit.unitKey}`,
    unitKey: controlUnit.unitKey,
    lastViewedApartment: {
      unitKey: controlUnit.unitKey,
      viewedAt: '2026-08-31T00:00:00.000Z',
      url: 'https://form.tencorp.uz/sun/apartments?lang=en',
    },
    price: 1,
    area: 99999,
    effectivePrice: 2,
    uuid: 'must-not-forward',
    arbitrary: 'drop-me',
    utm_source: 'sun-production-smoke',
  };
}

async function postLead(port, payload, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/sun-lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: await response.json() };
}

try {
  const openssl = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', keyPath, '-out', certPath,
  ], { encoding: 'utf8' });
  assert.equal(openssl.status, 0, `Could not create temporary HTTPS certificate: ${openssl.stderr}`);

  const received = [];
  sink = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (request, response) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) request.destroy();
      else chunks.push(chunk);
    });
    request.on('end', () => {
      assert.equal(request.method, 'POST', 'SUN sink received a non-POST request');
      assert.equal(request.url, '/lead', 'SUN sink received an unexpected path');
      received.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    sink.once('error', rejectListen);
    sink.listen(0, '127.0.0.1', resolveListen);
  });
  const sinkAddress = sink.address();
  assert(typeof sinkAddress === 'object' && sinkAddress, 'Temporary SUN HTTPS sink did not bind');

  const configuredPort = await freePort();
  const configured = startProduction(configuredPort, `https://127.0.0.1:${sinkAddress.port}/lead`);
  await waitForServer(`http://127.0.0.1:${configuredPort}/sun?lang=en`, configured);

  const nameProbe = await postLead(configuredPort, generalPayload('Test User'));
  assert.equal(nameProbe.status, 200, 'Production name-based test marker must not bypass SUN delivery');
  assert.equal(nameProbe.body.forwarded, true, 'Production Test User SUN lead was not forwarded');
  assert.equal(received.length, 1, 'Production Test User must produce exactly one SUN sink request');

  const headerProbe = await postLead(configuredPort, unitPayload('Header Probe'), { 'X-Sun-QA': '1' });
  assert.equal(headerProbe.status, 200, 'Public QA header must not bypass production SUN delivery');
  assert.equal(headerProbe.body.forwarded, true, 'Production QA-header SUN lead was not forwarded');
  assert.equal(received.length, 2, 'Production QA-header SUN lead must produce a second sink request');

  const forwardedUnitLead = received[1];
  assert.equal(forwardedUnitLead.unitKey, controlUnit.unitKey, 'Forwarded SUN unit key is not canonical');
  assert.equal(typeof forwardedUnitLead.unitKey, 'string', 'Forwarded SUN unit key must remain a string');
  assert.equal(forwardedUnitLead.unit.unitKey, controlUnit.unitKey, 'Forwarded canonical SUN unit identity mismatch');
  assert.equal(forwardedUnitLead.unit.number, controlUnit.number, 'Forwarded canonical SUN unit number mismatch');
  assert.equal(forwardedUnitLead.unit.area, controlUnit.area, 'Client-spoofed SUN area reached the sink');
  assert.equal(forwardedUnitLead.unit.effectivePrice, controlUnit.effectivePrice, 'Client-spoofed SUN effective price reached the sink');
  assert.equal(forwardedUnitLead.unit.regularPrice, controlUnit.regularPrice, 'Forwarded SUN regular price mismatch');
  assert.equal(forwardedUnitLead.unit.pricePerM2, controlUnit.pricePerM2, 'Forwarded SUN price/m² mismatch');
  assert.equal(forwardedUnitLead.unit.snapshotCampaignPrice, null, 'SUN snapshot campaign price must be null');
  assert.equal(forwardedUnitLead.unit.campaignActive, false, 'SUN campaign must be inactive');
  assert.equal(forwardedUnitLead.unit.campaignDeadline, null, 'SUN campaign deadline must be null');
  assert.equal(forwardedUnitLead.lastViewedApartment.unitKey, controlUnit.unitKey, 'SUN last-viewed unit was not canonicalized');
  assert.equal(forwardedUnitLead.utm_source, 'sun-production-smoke', 'Allowlisted SUN tracking was dropped');
  assert(!Object.hasOwn(forwardedUnitLead, 'price') && !Object.hasOwn(forwardedUnitLead, 'area') && !Object.hasOwn(forwardedUnitLead, 'arbitrary'), 'Untrusted SUN top-level fields reached the sink');
  const forwardedText = JSON.stringify(forwardedUnitLead);
  for (const forbidden of ['api.macroserver.uz', 'sourceUrl', 'localSourcePath', 'floorPlanSourceUrl', 'detailLocalPath', 'must-not-forward', '"uuid"', '"unitId"', '"crmId"', '"internalId"']) {
    assert(!forwardedText.includes(forbidden), `Forwarded SUN payload leaked ${forbidden}`);
  }
  assert.deepEqual(received.map((entry) => entry.name), ['Test User', 'Header Probe'], 'Unexpected production SUN sink payloads');
  await stopProduction(configured);

  const unconfiguredPort = await freePort();
  const unconfigured = startProduction(unconfiguredPort);
  await waitForServer(`http://127.0.0.1:${unconfiguredPort}/sun?lang=en`, unconfigured);
  const unavailable = await postLead(unconfiguredPort, generalPayload('Ordinary Person'));
  assert.equal(unavailable.status, 503, 'Production SUN without a lead backend must return HTTP 503');
  assert.equal(unavailable.body.error, 'lead_delivery_unconfigured', 'Unexpected unconfigured SUN production error');
  const unavailableNameMarker = await postLead(unconfiguredPort, generalPayload('Test User'));
  assert.equal(unavailableNameMarker.status, 503, 'Production SUN Test User without a backend must not bypass delivery');
  const unavailableHeaderMarker = await postLead(unconfiguredPort, generalPayload('Header Probe'), { 'X-Sun-QA': '1' });
  assert.equal(unavailableHeaderMarker.status, 503, 'Production SUN QA header without a backend must not bypass delivery');
  assert.equal(received.length, 2, 'Unconfigured production SUN leads must not reach the previous sink');
  await stopProduction(unconfigured);

  console.log(`SUN production lead smoke passed: configured HTTPS forwarding canonicalized public key ${controlUnit.unitKey}; 2/2 leads reached the sink; ordinary/name/header probes without a backend returned 503 (3/3).`);
} finally {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (sink) {
    sink.closeAllConnections?.();
    await new Promise((resolveClose) => sink.close(resolveClose));
  }
  assert(tempRoot.startsWith(`${tmpdir()}/sun-lead-smoke.`), 'Refusing to remove an unexpected SUN temporary path');
  await rm(tempRoot, { recursive: true, force: true });
}
