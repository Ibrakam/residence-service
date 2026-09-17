import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [layout, guard] = await Promise.all([
  readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/session-revocation-guard.tsx', import.meta.url), 'utf8'),
]);

assert.match(layout, /<SessionRevocationGuard\s*\/>/, 'the session guard must cover every Residence document route');
assert.match(guard, /fetch\('\/__auth\/me'/, 'the guard must validate the server-side session');
assert.match(guard, /credentials:\s*'same-origin'/, 'the guard must send only same-origin session credentials');
assert.match(guard, /cache:\s*'no-store'/, 'session checks must never use a cached identity response');
assert.match(guard, /response\.status !== 401/, 'only an authoritative unauthorized response may trigger sign-in');
assert.match(guard, /window\.location\.replace\(loginURL\(\)\)/, 'revoked sessions must leave protected content immediately');
assert.match(guard, /window\.location\.pathname\}\$\{window\.location\.search/, 'sign-in must preserve the current path and query');
assert.doesNotMatch(guard, /window\.location\.hash/, 'the return target must remain compatible with the auth gateway safe-redirect policy');
assert.match(guard, /new URLSearchParams\(\{ error: 'session_expired', return_to: returnTo \}\)/, 'sign-in must preserve the current page');
assert.match(guard, /setInterval\(refreshVisibleSession, sessionCheckIntervalMs\)/, 'an open foreground page must revalidate periodically');
for (const event of ['focus', 'online', 'pageshow']) {
  assert.match(guard, new RegExp(`addEventListener\\('${event}'`), `the guard must revalidate on ${event}`);
}
assert.match(guard, /visibilitychange/, 'the guard must revalidate when a hidden tab becomes visible');
assert.match(guard, /if \(response\.status !== 401 \|\| redirecting\.current\) return;/, 'temporary auth-service failures must fail open for an already-authorized page');

console.log('Session revocation guard contract: PASS');
