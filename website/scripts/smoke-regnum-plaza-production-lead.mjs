import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = await mkdtemp(join(tmpdir(), 'regnum-lead-smoke.'));
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
  environment.REGNUM_LEAD_FORWARD_URL = '';
  delete environment.REGNUM_QA_SECRET;
  if (forwardUrl) {
    environment.REGNUM_LEAD_FORWARD_URL = forwardUrl;
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
    } catch { /* Server is still starting. */ }
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

function leadPayload(name) {
  return {
    name,
    phone: '+998901234567',
    goal: 'live',
    consent: true,
    formContext: 'projectSlug=regnum-plaza;lang=en;surface=landing:footer',
    projectSlug: 'regnum-plaza',
    lang: 'en',
    language: 'en',
  };
}

async function postLead(port, name, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/regnum-plaza-lead`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(leadPayload(name)),
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
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      received.push(payload);
      if (payload.name === 'Oversized Response') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ padding: 'x'.repeat(70 * 1024) }));
        return;
      }
      if (payload.name === 'Redirect Probe') {
        response.writeHead(307, { Location: '/redirected' });
        response.end();
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{"ok":true}');
    });
  });
  await new Promise((resolveListen, rejectListen) => {
    sink.once('error', rejectListen);
    sink.listen(0, '127.0.0.1', resolveListen);
  });
  const sinkAddress = sink.address();
  assert(typeof sinkAddress === 'object' && sinkAddress, 'Temporary HTTPS sink did not bind');

  const configuredPort = await freePort();
  const configured = startProduction(configuredPort, `https://127.0.0.1:${sinkAddress.port}/lead`);
  await waitForServer(`http://127.0.0.1:${configuredPort}/regnum-plaza?lang=en`, configured);

  const nameProbe = await postLead(configuredPort, 'Test User');
  assert.equal(nameProbe.status, 200, 'Production name-based test marker must not bypass delivery');
  assert.equal(nameProbe.body.forwarded, true, 'Production Test User lead was not forwarded');
  assert.equal(received.length, 1, 'Production Test User must produce exactly one sink request');

  const headerProbe = await postLead(configuredPort, 'Header Probe', { 'X-Regnum-QA': '1' });
  assert.equal(headerProbe.status, 200, 'Public QA header must not bypass production delivery');
  assert.equal(headerProbe.body.forwarded, true, 'Production QA-header lead was not forwarded');
  assert.equal(received.length, 2, 'Production QA-header lead must produce a second sink request');
  assert.deepEqual(received.map((entry) => entry.name), ['Test User', 'Header Probe'], 'Unexpected production sink payloads');
  const oversizedResponse = await postLead(configuredPort, 'Oversized Response');
  assert.equal(oversizedResponse.status, 502, 'Oversized upstream response must fail closed');
  assert.equal(oversizedResponse.body.error, 'forward_response_too_large', 'Unexpected oversized upstream response error');
  const redirectProbe = await postLead(configuredPort, 'Redirect Probe');
  assert.equal(redirectProbe.status, 502, 'Lead forwarding must not follow an upstream redirect');
  assert.equal(redirectProbe.body.error, 'forward_unavailable', 'Unexpected upstream redirect error');
  assert.equal(received.length, 4, 'Blocked redirect must not create a redirected sink request');
  await stopProduction(configured);

  const unconfiguredPort = await freePort();
  const unconfigured = startProduction(unconfiguredPort);
  await waitForServer(`http://127.0.0.1:${unconfiguredPort}/regnum-plaza?lang=en`, unconfigured);
  const unavailable = await postLead(unconfiguredPort, 'Ordinary Person');
  assert.equal(unavailable.status, 503, 'Production without a lead backend must return HTTP 503');
  assert.equal(unavailable.body.error, 'lead_delivery_unconfigured', 'Unexpected unconfigured production error');
  const unavailableNameMarker = await postLead(unconfiguredPort, 'Test User');
  assert.equal(unavailableNameMarker.status, 503, 'Production Test User without a backend must not bypass delivery');
  const unavailableHeaderMarker = await postLead(unconfiguredPort, 'Header Probe', { 'X-Regnum-QA': '1' });
  assert.equal(unavailableHeaderMarker.status, 503, 'Production public QA header without a backend must not bypass delivery');
  assert.equal(received.length, 4, 'Unconfigured production lead must not reach the previous sink');
  await stopProduction(unconfigured);

  console.log('Regnum production lead smoke passed: normal delivery works, upstream responses are capped at 64 KiB, redirects are blocked, and unconfigured delivery fails closed with 503.');
} finally {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  if (sink) {
    sink.closeAllConnections?.();
    await new Promise((resolveClose) => sink.close(resolveClose));
  }
  assert(tempRoot.startsWith(`${tmpdir()}/regnum-lead-smoke.`), 'Refusing to remove an unexpected temporary path');
  await rm(tempRoot, { recursive: true, force: true });
}
