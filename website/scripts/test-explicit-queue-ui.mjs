import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { regnumQueueCode, regnumQueueKey, regnumQueueLabel } from '../app/regnum-plaza/regnum-queues.ts';

const [liveCatalog, regnumCatalog, regnumPage, regnumLanding, saadiyatCatalog, regnumCss, saadiyatCss] = await Promise.all([
  readFile(new URL('../app/live-catalog.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/apartments/regnum-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/apartments/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/regnum-page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/saadiyat/apartments/saadiyat-catalog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/regnum-plaza/apartments/regnum-catalog.css', import.meta.url), 'utf8'),
  readFile(new URL('../app/saadiyat/apartments/saadiyat-catalog.css', import.meta.url), 'utf8'),
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

assert.match(regnumCatalog, /liveCatalogQueueOptions\(project\)/);
assert.match(regnumCatalog, /unit\.queueKey === selectedQueue/);
assert.match(regnumCatalog, /queueOptions\.length \? null : <label>/);
assert.match(regnumCatalog, /queueCounts\.get\(queue\.queueKey\)[\s\S]+> 0/);
assert.match(regnumCatalog, /new URLSearchParams\(searchParams\.toString\(\)\)[\s\S]+params\.set\('lang', language\)[\s\S]+params\.delete\('queue'\)/);
assert.match(regnumCatalog, /new URLSearchParams\(window\.location\.search\); params\.set\('lang', language\)/);
assert.match(regnumCatalog, /function buildRegnumMatrixGroups/);
assert.doesNotMatch(regnumCatalog, /snapshot\.matrix/);
assert.doesNotMatch(regnumCatalog, /Q\{unit\.queue\}|<dd>\{unit\.queue\}/);
assert.match(regnumCatalog, /facts=\{lead\.unit \? \[\x60\$\{regnumQueueLabel/);
assert.match(regnumPage, /regnumQueueLabel\(unit, language\)/);
assert.match(regnumLanding, /regnumQueueLabel\(unit, language, queueOptions\)/);
assert.match(regnumLanding, /facts=\{lead\?\.unit \? \[regnumQueueLabel/);

assert.match(saadiyatCatalog, /liveCatalogQueueOptions\(project\)/);
assert.match(saadiyatCatalog, /unit\.queueKey === selectedQueue/);
assert.match(saadiyatCatalog, /queueOptions\.length \? null : <label>/);
assert.match(saadiyatCatalog, /queueCounts\.get\(queue\.queueKey\)[\s\S]+> 0/);
assert.match(saadiyatCatalog, /new URLSearchParams\(searchParams\.toString\(\)\)[\s\S]+params\.set\('lang', language\)[\s\S]+params\.delete\('queue'\)/);
assert.match(regnumCss, /\.rpc-queues/);
assert.match(saadiyatCss, /\.sac-queues/);

console.log('Explicit queue UI contract passed: Saadiyat and Regnum selectors use authoritative queue keys, Regnum q3 renders as II, and the matrix is rebuilt from current units.');
