import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../app/session-revocation-guard.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
async function scenario(mode, pathname, status) {
  let effect, requests = 0, cleanup;
  const redirects = [], events = [];
  const window = {
    location: { pathname, search: '?rooms=2', replace: value => redirects.push(value) },
    setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: event => events.push(event.type),
  };
  const document = { visibilityState: 'visible', querySelector: () => mode ? { content: mode } : null,
    addEventListener() {}, removeEventListener() {} };
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, window, document,
    URLSearchParams, AbortController, DOMException, Event,
    require(name) { assert.equal(name, 'react'); return { useEffect: fn => { effect = fn; }, useRef: value => ({ current: value }) }; },
    fetch: async () => { requests++;return { status, ok: status === 200 }; },
  });
  module.exports.default();cleanup = effect();
  await new Promise(resolve => setImmediate(resolve));
  cleanup?.();
  return { requests, redirects, events, ready: window.__tencorpOptionalConsumerReady };
}
for (const path of ['/4u', '/dormon-hills/apartments', '/avalon', '/sanat/flats', '/tencrop/']) {
  const result = await scenario('optional', path, 401);
  assert.equal(result.requests, 0, 'optional consumer browsing must not poll guest identity');
  assert.equal(result.redirects.length, 0);
  assert.equal(result.ready, true);
  assert.deepEqual(result.events, ['tencorp:consumer-ready']);
}
for (const [mode, path] of [[undefined, '/4u'], ['optional', '/analytics'], ['optional', '/__auth/account']]) {
  const result = await scenario(mode, path, 401);
  assert.equal(result.requests, 1);
  assert.equal(result.redirects.length, 1);
  const url = new URL(result.redirects[0], 'https://form.tencorp.uz');
  assert.equal(url.pathname, '/__auth/login');
  assert.equal(url.searchParams.get('return_to'), path + '?rooms=2');
}
assert.equal((await scenario(undefined, '/4u', 503)).redirects.length, 0);
console.log('Optional/required session guard behavior: PASS');
