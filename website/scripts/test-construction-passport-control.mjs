import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseConstructionPassports,
  publishedProjectKeys,
  projectKeyForLandingPath,
  safeOfficialPassportURL,
} from '../app/construction-passports.ts';

assert.equal(projectKeyForLandingPath('/'), 'avalon-residence');
assert.equal(projectKeyForLandingPath('/soy-boyi'), 'soy-boyi');
assert.equal(projectKeyForLandingPath('/soy-boyi/'), 'soy-boyi');
assert.equal(projectKeyForLandingPath('/portal/soy-boyi', '/portal'), 'soy-boyi');
assert.equal(publishedProjectKeys.size, 20);
for (const key of publishedProjectKeys) {
  const path = key === 'avalon-residence' ? '/' : `/${key}`;
  assert.equal(projectKeyForLandingPath(path), key, `${key} must have an exact landing route`);
}
for (const path of ['/soy-boyi/apartments', '/privacy', '/analytics', '/market-map', '/v1', '/unknown-project', '/SOY-BOYI', '/soy-boyievil']) {
  assert.equal(projectKeyForLandingPath(path), '', `${path} must not render the landing-page control`);
}

const official = 'https://api-nazorat.mc.uz/object-info/240228796';
assert.equal(safeOfficialPassportURL(official), official);
for (const unsafe of [
  'http://api-nazorat.mc.uz/object-info/240228796',
  'https://user@api-nazorat.mc.uz/object-info/240228796',
  'https://api-nazorat.mc.uz:443/object-info/240228796',
  'https://api-nazorat.mc.uz.evil.example/object-info/240228796',
  'https://api-nazorat.mc.uz/object-info/0',
  'https://api-nazorat.mc.uz/object-info/%32%34',
  'https://api-nazorat.mc.uz/object-info/240228796?download=1',
  'https://api-nazorat.mc.uz/object-info/240228796#details',
  'javascript:alert(1)',
]) {
  assert.equal(safeOfficialPassportURL(unsafe), '', `unsafe passport URL escaped: ${unsafe}`);
}

const payload = {
  projectKey: 'soy-boyi',
  linked: true,
  objectCount: 2,
  passports: [
    { objectId: 22, name: 'Soy Bo‘yi II', address: 'Tashkent', url: 'https://api-nazorat.mc.uz/object-info/222', linkedAt: '2026-09-16T10:00:00Z' },
    { objectId: 11, name: 'Soy Bo‘yi I', address: '', url: 'https://api-nazorat.mc.uz/object-info/111', linkedAt: '2026-09-15T10:00:00Z' },
  ],
};
assert.deepEqual(parseConstructionPassports(payload, 'soy-boyi')?.map((item) => item.url), [
  'https://api-nazorat.mc.uz/object-info/222',
  'https://api-nazorat.mc.uz/object-info/111',
]);
assert.equal(parseConstructionPassports(payload, 'sun'), null, 'a response for another project must fail closed');
assert.deepEqual(parseConstructionPassports({ projectKey: 'sun', linked: false, objectCount: 0, passports: [] }, 'sun'), []);
assert.equal(parseConstructionPassports({ ...payload, passports: [{ ...payload.passports[0], url: 'https://evil.example/object-info/222' }] }, 'soy-boyi'), null);

const [layout, avalonPage, component, styles, backendRegistry] = await Promise.all([
  readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/construction-passport-control.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
  readFile(new URL('../../backend/internal/httpapi/project_registry.go', import.meta.url), 'utf8'),
]);
const backendProjectKeys = new Set([...backendRegistry.matchAll(/^\s*"([a-z0-9-]+)":\s*\{passportPath:/gm)].map((match) => match[1]));
assert.deepEqual([...publishedProjectKeys].sort(), [...backendProjectKeys].sort(), 'frontend landing routes must exactly match the backend published registry');
assert.match(layout, /<ConstructionPassportControl\s*\/>/);
assert.doesNotMatch(avalonPage, /api-nazorat\.mc\.uz\/object-info\/240228796/, 'Avalon must use the universal control instead of a page-local anchor');
assert.doesNotMatch(component, /api-nazorat\.mc\.uz\/object-info\/240228796/, 'the universal control must not invent an Avalon fallback before the map link exists');
assert.match(component, /\/v1\/construction-passports\//);
assert.match(component, /\/residence-api\/catalog/, 'the control must use the nginx catalogue API prefix');
assert.match(component, /credentials:\s*'include'/);
assert.match(component, /cache:\s*'no-store'/);
assert.doesNotMatch(component, /setInterval\(/, 'passport refreshes must not create synchronized fixed polling waves');
assert.match(component, /refreshIntervalMs\s*=\s*120_000/, 'successful refreshes should poll no more than every two minutes');
assert.match(component, /const delay = nextRefreshDelayMs\(consecutiveFailures\)/, 'refreshes must calculate their next backoff-aware delay');
assert.match(component, /refreshTimer = window\.setTimeout\(/, 'refreshes must use a rescheduled timeout');
assert.match(component, /Math\.random\(\)/, 'refresh scheduling must be jittered across browser sessions');
assert.match(component, /2 \*\* exponent/, 'failed refreshes must use exponential backoff');
assert.match(component, /window\.addEventListener\('focus',\s*refreshWhenForegrounded\)/);
assert.match(component, /passports\.length === 1/);
assert.match(component, /showModal\(\)/);
assert.match(component, /<svg[^>]*aria-hidden="true"/, 'the control icon must be inlined so it cannot fall through to another nginx site');
assert.doesNotMatch(component, /construction-nazorat\.svg/, 'the control must not depend on an unrouted root-level public asset');
assert.match(component, /clearCurrent\(\)/, 'unlinked, invalid, and unavailable responses must fail closed instead of keeping a stale passport');
assert.match(component, /dialogRef\.current\?\.close\(\)/, 'a shrinking passport set must close the chooser explicitly');
assert.doesNotMatch(component, /\/market-map\/api\//, 'the browser must not bypass the Residence BFF or the Market Map Basic gate');
assert.match(styles, /construction-passport-link--universal/);
assert.match(styles, /construction-passport-dialog::backdrop/);
assert.match(styles, /construction-passport-dialog\[open\][^{]*\{[^}]*grid-template-rows:auto minmax\(0,1fr\)[^}]*overflow:hidden/s);

console.log('Construction passport control contract: PASS');
