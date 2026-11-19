import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuard } from './guard.mjs';

const origin = 'https://form.tencorp.uz';
const payload = { name: "O'Connor", phone: '+998901234567', interest: 'Инвестиции', consent: true };
function setup(overrides = {}) {
  let time = 1_800_000_000_000;
  const calls = []; const events = [];
  const guard = createGuard({ secret: 'x'.repeat(43), turnstileRequired: false, now: () => time,
    audit: e => events.push(e), fetchImpl: async (url, options) => { calls.push({ url: String(url), ...options }); return Response.json({ success: true, eventId: 'receipt' }); }, ...overrides });
  const headers = new Headers({ origin, referer: `${origin}/?lang=ru`, 'x-real-ip': '203.0.113.10' });
  const issue = (extra = '') => {
    const result = guard.challenge(new URL(`${origin}/lead-security/challenge?page=${encodeURIComponent('/?lang=ru')}${extra}`), headers);
    if (result.cookie) headers.set('cookie', result.cookie.split(';')[0]);
    headers.set('x-lead-token', result.body.token);
    return result;
  };
  return { guard, calls, events, headers, issue, advance: n => { time += n; } };
}

test('valid apostrophe name sent once with canonical source, no credentials, confirmed receipt', async t => {
  const s = setup(); t.after(s.guard.close);
  const challenge = s.issue(); assert.match(challenge.cookie, /Secure; HttpOnly; SameSite=Strict/u);
  s.headers.set('authorization', 'private-login'); s.headers.set('x-tencorp-web-session', 'invalid');
  s.advance(1100);
  const response = await s.guard.submit('/v1/agency-leads', payload, s.headers);
  assert.equal(response.status, 200); assert.equal(s.calls.length, 1);
  const body = JSON.parse(s.calls[0].body);
  assert.equal(body.name, "O'Connor"); assert.equal(body.landing_url, `${origin}/?lang=ru`);
  assert.equal(s.calls[0].headers['X-Tencorp-Lead-Contract'], 'agency-v1');
  assert.equal(s.calls[0].headers.cookie, undefined); assert.equal(s.calls[0].headers.authorization, undefined);
  await assert.rejects(s.guard.submit('/v1/agency-leads', payload, s.headers), { status: 403 });
  assert.equal(s.calls.length, 1);
  assert.equal(JSON.stringify(s.events).includes(payload.phone), false);
});

test('missing proof, cross origin, localhost attribution, SQL names and honeypot cannot write', async t => {
  for (const [name, mutate, modifyHeaders] of [
    ['missing proof', p => p, h => h.delete('x-lead-token')],
    ['cross origin', p => p, h => h.set('origin', 'https://evil.example')],
    ['localhost', p => ({ ...p, landing_url: 'http://localhost:3000/' })],
    ['SQL payload', p => ({ ...p, name: "1' AND SLEEP(4)-- -" })],
    ['honeypot', p => p, h => h.set('x-lead-honeypot', 'http://spam.example')],
  ]) {
    await t.test(name, async t => { const s = setup(); t.after(s.guard.close); s.issue(); s.advance(1100); modifyHeaders?.(s.headers);
      await assert.rejects(s.guard.submit('/v1/agency-leads', mutate(payload), s.headers)); assert.equal(s.calls.length, 0); });
  }
});

test('too-fast submit can be corrected; schema rejection does not consume proof', async t => {
  const s = setup(); t.after(s.guard.close); s.issue();
  await assert.rejects(s.guard.submit('/v1/agency-leads', payload, s.headers), { code: 'verification_too_fast' });
  s.advance(1100);
  await assert.rejects(s.guard.submit('/v1/agency-leads', { ...payload, phone: 'invalid' }, s.headers), { code: 'invalid_phone' });
  assert.equal((await s.guard.submit('/v1/agency-leads', payload, s.headers)).status, 200);
});

test('concurrent replay and separate proof for duplicate phone cannot create another lead', async t => {
  const s = setup(); t.after(s.guard.close); s.issue(); s.advance(1100);
  const results = await Promise.allSettled([s.guard.submit('/v1/agency-leads', payload, s.headers), s.guard.submit('/v1/agency-leads', payload, s.headers)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(s.calls.length, 1);
  s.issue(); s.advance(1100);
  await assert.rejects(s.guard.submit('/v1/agency-leads', payload, s.headers), { code: 'duplicate_submission' }); assert.equal(s.calls.length, 1);
});

test('proof binds session and has an expiry', async t => {
  const s = setup(); t.after(s.guard.close); s.issue(); s.advance(1100);
  const h = new Headers(s.headers); h.set('cookie', '__Host-tc_form=forged.signature');
  await assert.rejects(s.guard.submit('/v1/agency-leads', payload, h), { code: 'verification_required' });
  s.advance(15 * 60_000);
  await assert.rejects(s.guard.submit('/v1/agency-leads', payload, s.headers), { code: 'invalid_verification' }); assert.equal(s.calls.length, 0);
});

test('IP submissions limited across different sessions and phones', async t => {
  const s = setup(); t.after(s.guard.close);
  for (let i = 0; i < 2; i++) { s.issue(); s.advance(1100); await s.guard.submit('/v1/agency-leads', { ...payload, phone: `+99890123456${i}` }, s.headers); }
  s.headers.delete('cookie'); s.issue(); s.advance(1100);
  await assert.rejects(s.guard.submit('/v1/agency-leads', { ...payload, phone: '+998901234569' }, s.headers), { code: 'rate_limited' }); assert.equal(s.calls.length, 2);
});

test('uncertain delivery keeps reservation, including process restart', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'lead-guard-test-')); const database = join(folder, 'guard.sqlite');
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const opts = { database, fetchImpl: async () => { throw Error('timeout after send'); } };
  const s = setup(opts); s.issue(); s.advance(1100);
  assert.equal((await s.guard.submit('/v1/agency-leads', payload, s.headers)).status, 502); s.guard.close();
  const retry = setup({ database }); t.after(retry.guard.close); retry.issue(); retry.advance(2200);
  await assert.rejects(retry.guard.submit('/v1/agency-leads', payload, retry.headers), { code: 'duplicate_submission' }); assert.equal(retry.calls.length, 0);
});

test('Turnstile failure/hostname/action mismatch cannot write; valid token works', async t => {
  for (const result of [{ success: false }, { success: true, hostname: 'evil.example', action: 'lead_submit' }, { success: true, hostname: 'form.tencorp.uz', action: 'login' }, { success: true, hostname: 'form.tencorp.uz', action: 'lead_submit' }]) {
    await t.test(JSON.stringify(result), async t => {
      let writes = 0;
      const s = setup({ sitekey: 'public', turnstileSecret: 'private', turnstileRequired: true, fetchImpl: async (url, options) => {
        if (String(url).includes('siteverify')) { assert.equal(JSON.parse(options.body).secret, 'private'); return Response.json(result); }
        writes++; return Response.json({ success: true });
      } }); t.after(s.guard.close); s.issue(); s.advance(1100); s.headers.set('x-turnstile-token', 'token');
      const correct = result.success && result.hostname === 'form.tencorp.uz' && result.action === 'lead_submit';
      if (correct) assert.equal((await s.guard.submit('/v1/agency-leads', payload, s.headers)).status, 200);
      else await assert.rejects(s.guard.submit('/v1/agency-leads', payload, s.headers), { code: 'verification_failed' });
      assert.equal(writes, correct ? 1 : 0);
    });
  }
});

test('startup cannot silently omit Turnstile or accept external upstream', () => {
  assert.throws(() => createGuard({ secret: 'x'.repeat(43) }), /Turnstile keys required/u);
  assert.throws(() => createGuard({ secret: 'x'.repeat(43), turnstileRequired: false, upstream: 'https://evil.example/api/submit' }), /loopback/u);
});

test('residence and legacy contracts preserve callers including location hash and signed analytics', async t => {
  for (const route of ['/v1/leads', '/tencrop/v1/leads', '/api/submit']) {
    await t.test(route, async t => {
      const s = setup(); t.after(s.guard.close); s.issue(); s.advance(1100);
      const body = { name: 'Али Ғулом', phone: '+998901234567', goal: 'live', consent: true, projectSlug: 'dormon-hills', language: 'ru', formContext: 'Планировка', landing_url: `${origin}/dormon-hills#plans`, lastViewedApartment: { url: '/dormon-hills/apartments?lang=ru' } };
      s.headers.set('x-tencorp-web-visitor', `visitor.${'a'.repeat(43)}`);
      assert.equal((await s.guard.submit(route, body, s.headers)).status, 200);
      assert.equal(s.calls[0].headers['x-tencorp-web-visitor'], `visitor.${'a'.repeat(43)}`);
      assert.equal(s.calls[0].headers['X-Tencorp-Lead-Contract'], route === '/api/submit' ? undefined : 'residence-v1');
      assert.equal(JSON.parse(s.calls[0].body).formContext, 'Планировка');
    });
  }
});

test('Uzbek left apostrophes accepted; punctuation-only names rejected before writes', async t => {
  const s = setup(); t.after(s.guard.close); s.issue(); s.advance(1100);
  await assert.rejects(s.guard.submit('/v1/agency-leads', { ...payload, name: "'..." }, s.headers), { code: 'invalid_name' });
  assert.equal((await s.guard.submit('/v1/agency-leads', { ...payload, name: 'G‘ayrat Mu‘minov' }, s.headers)).status, 200);
});
