import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function requestWorker(port) {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port, path: '/', agent: false }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode !== 200) reject(new Error(`unexpected status ${response.statusCode}`));
        else resolve(Number.parseInt(body, 10));
      });
    });
    request.once('error', reject);
    request.setTimeout(2_000, () => request.destroy(new Error('request timed out')));
  });
}

async function collectWorkers(port, expected, timeoutMs = 10_000) {
  const workers = new Set();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && workers.size < expected) {
    try { workers.add(await requestWorker(port)); } catch { await delay(50); }
  }
  return workers;
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'residence-cluster-'));
const entrypoint = join(fixtureRoot, 'server.js');
const workerEntrypoint = join(fixtureRoot, 'worker-server.js');
cpSync(new URL('./standalone-cluster-server.mjs', import.meta.url), entrypoint);
writeFileSync(workerEntrypoint, `
  import { createServer } from 'node:http';
  const server = createServer((_request, response) => response.end(String(process.pid)));
  server.listen(Number.parseInt(process.env.PORT, 10), '127.0.0.1');
`, 'utf8');

const port = await freePort();
let output = '';
const child = spawn(process.execPath, [entrypoint], {
  cwd: fixtureRoot,
  env: { PATH: process.env.PATH ?? '', PORT: String(port), WEB_CONCURRENCY: '2' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

try {
  const initialWorkers = await collectWorkers(port, 2);
  assert.equal(initialWorkers.size, 2, `expected two serving workers; output:\n${output}`);

  const terminatedWorker = [...initialWorkers][0];
  process.kill(terminatedWorker, 'SIGKILL');
  const replacementWorkers = await collectWorkers(port, 2);
  assert.equal(replacementWorkers.size, 2, `expected replacement worker; output:\n${output}`);
  assert.ok([...replacementWorkers].some((pid) => !initialWorkers.has(pid)), 'cluster did not replace the terminated worker');

  child.kill('SIGTERM');
  const exit = await Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    delay(5_000).then(() => null),
  ]);
  assert.ok(exit, `cluster did not stop gracefully; output:\n${output}`);
  assert.equal(exit.code, 0, `cluster exited unsuccessfully (${JSON.stringify(exit)}); output:\n${output}`);

  writeFileSync(workerEntrypoint, 'process.exit(73);\n', 'utf8');
  let crashOutput = '';
  const crashingChild = spawn(process.execPath, [entrypoint], {
    cwd: fixtureRoot,
    env: { PATH: process.env.PATH ?? '', PORT: String(port), WEB_CONCURRENCY: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  crashingChild.stdout.on('data', (chunk) => { crashOutput += chunk; });
  crashingChild.stderr.on('data', (chunk) => { crashOutput += chunk; });
  const crashExit = await Promise.race([
    new Promise((resolve) => crashingChild.once('exit', (code, signal) => resolve({ code, signal }))),
    delay(10_000).then(() => null),
  ]);
  if (!crashExit) crashingChild.kill('SIGKILL');
  assert.ok(crashExit, `crashing cluster did not stop after its restart threshold; output:\n${crashOutput}`);
  assert.equal(crashExit.code, 1, `crashing cluster exit=${JSON.stringify(crashExit)}; output:\n${crashOutput}`);
  assert.match(crashOutput, /worker crash loop detected/, 'crash-loop shutdown was not reported');

  console.log('Standalone frontend cluster passed: shared-port workers, replacement, graceful shutdown and bounded crash recovery.');
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  rmSync(fixtureRoot, { recursive: true, force: true });
}
