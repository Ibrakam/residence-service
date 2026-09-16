import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { regnumQueueCode, regnumQueueKey, regnumQueueLabel } from '../app/regnum-plaza/regnum-queues.ts';
import { soyQueueOptions } from '../app/soy-boyi/apartments/soy-boyi-queues.mjs';

const [liveCatalog, sharedCatalog, regnumCatalog, regnumPage, regnumLanding, saadiyatCatalog, soyCatalog, sarbonCatalog] = await Promise.all([
  readFile(new URL('../app/live-catalog.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/catalog/apartment-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/apartments/regnum-unified-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/apartments/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/regnum-page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/saadiyat/apartments/saadiyat-unified-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/soy-boyi/apartments/soy-boyi-unified-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/sarbon/apartments/sarbon-unified-catalog.tsx', import.meta.url), 'utf8'),
]);

assert.equal(regnumQueueKey({ queue: 1 }), 'q1');
assert.equal(regnumQueueKey({ queue: 3 }), 'q3');
assert.equal(regnumQueueCode({ queue: 3 }), 'II');
assert.equal(regnumQueueLabel({ queue: 3 }, 'ru'), 'II очередь');
assert.equal(regnumQueueLabel({ queue: 3 }, 'uz'), 'II bosqich');
assert.equal(regnumQueueLabel({ queue: 3 }, 'en'), 'Phase II');
assert.equal(regnumQueueCode({ queueKey: 'q3', queueDisplayCode: 'II' }), 'II');
assert.equal(regnumQueueCode({ queueKey: 'q3', queueDisplayCode: 'III' }), 'II');
assert.match(liveCatalog, /return queues\.length >= 2 \? queues : \[\]/);

assert.match(sharedCatalog, /params\.get\('queue'\)/);
assert.match(sharedCatalog, /unit\.queueKey === queue/);
assert.match(sharedCatalog, /return options\.length >= 2 \? options : \[\]/);
assert.match(sharedCatalog, /disabled=\{item\.availableCount === 0\}/);
assert.match(sharedCatalog, /updateQuery\(\{ queue:/);
assert.match(sharedCatalog, /activeLeadUnit\?\.queueKey/);

assert.match(regnumCatalog, /liveCatalogQueueOptions\(liveProject\)/);
assert.match(regnumCatalog, /regnumQueueKey\(unit\)/);
assert.match(regnumCatalog, /regnumQueueCode\(unit, queueMetadata\)/);
assert.match(regnumCatalog, /queueLabel:\s*unit\.queueLabel\s*\|\|\s*\(displayCode/);
assert.doesNotMatch(regnumCatalog, /Q\{unit\.queue\}|<dd>\{unit\.queue\}/);
assert.match(regnumPage, /regnumQueueLabel\(unit, language\)/);
assert.match(regnumLanding, /regnumQueueLabel\(unit, language, queueOptions\)/);
assert.match(regnumLanding, /facts=\{lead\?\.unit \? \[regnumQueueLabel/);

assert.match(saadiyatCatalog, /liveCatalogQueueOptions\(liveProject\)/);
assert.match(saadiyatCatalog, /queueKey:\s*unit\.queueKey/);
assert.match(sarbonCatalog, /liveCatalogQueueOptions\(liveProject\)/);
assert.match(sarbonCatalog, /queueKey:\s*unit\.queueKey/);
assert.match(soyCatalog, /soyQueueOptions\(snapshot\.units, liveProject\?\.queues\)/);
assert.match(soyCatalog, /availableCount:\s*queue\.count/);

const soyQueues = soyQueueOptions([
  { phase: '2' }, { phase: '2' }, { phase: '3' }, { phase: '4' },
]);
assert.deepEqual(soyQueues.map(({ key, count }) => ({ key, count })), [
  { key: 'q1', count: 0 },
  { key: 'q2', count: 2 },
  { key: 'q3', count: 1 },
  { key: 'q4', count: 1 },
], 'Soy Bo\u2018yi preserves all four official queues and keeps empty q1 disabled');

console.log('Explicit queue UI contract passed: active unified catalogues use authoritative queue keys, Regnum q3 renders as II, and Soy Bo\u2018yi preserves q1-q4.');
