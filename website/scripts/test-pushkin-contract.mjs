import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const catalog = JSON.parse(await readFile(resolve(root, 'data/pushkin-catalog.json'), 'utf8'));
const map = JSON.parse(await readFile(resolve(root, 'data/pushkin-map.json'), 'utf8'));
assert.equal(catalog.projectSlug, 'pushkin'); assert.equal(catalog.complete, true);
assert.equal(catalog.units.length, catalog.officialTotalAtCapture);
assert.equal(new Set(catalog.units.map(u => u.id)).size, catalog.units.length);
assert.ok(Math.abs(map.coordinates[0] - (41 + 19 / 60 + 16.7 / 3600)) < 1e-9);
assert.ok(Math.abs(map.coordinates[1] - (69 + 18 / 60 + 55.3 / 3600)) < 1e-9);
const identityByNumber = new Map();
for (const unit of catalog.units) {
  assert.equal(unit.status, 'available'); assert.ok(unit.price > 0);
  assert.match(unit.sourceKey, /^taqsim:pushkin:[a-f0-9-]{36}$/);
  assert.ok(Math.abs(unit.price - unit.pricePerM2 * unit.area) <= 1);
  assert.match(unit.plan, /^\/pushkin\/plans\/[a-f0-9]{20}\.png$/);
  const bytes = await readFile(resolve(root, 'public', unit.plan.slice(1)));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  const key = `${unit.building}:${unit.number}`;
  assert.ok(!identityByNumber.has(key), `Duplicate apartment in the same section: ${key}`); identityByNumber.set(key, unit.id);
}
const permit = await readFile(resolve(root, 'public/pushkin/documents/construction-permit.pdf'));
assert.equal(permit.subarray(0, 5).toString(), '%PDF-');
for (const image of ['hero', 'architecture', 'aerial', 'terrace', 'arrival', 'detail', 'mark', 'project-scheme']) assert.ok((await stat(resolve(root, `public/pushkin/images/${image}.webp`))).size > 100);
const client = await readFile(resolve(root, 'app/pushkin/pushkin-page.tsx'), 'utf8');
assert.match(client, /projectSlug="pushkin"/); assert.match(client, /submitUrl=\{`\$\{base\}\/v1\/leads`\}/);
assert.match(client, /requireConsent/); assert.doesNotMatch(client, /pushkin-place\.uz.*(?:api|lead)/);
console.log(`Pushkin: ${catalog.units.length} unique apartments, section identities, cash prices, plans, documents, exact map coordinates and shared lead contract passed.`);
