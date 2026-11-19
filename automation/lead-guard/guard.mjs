import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const TTL = 15 * 60_000;
const PATHS = new Map([
  ['/v1/agency-leads', 'agency-v1'], ['/v1/leads', 'residence-v1'],
  ['/tencrop/v1/leads', 'residence-v1'], ['/api/submit', 'legacy'],
]);
const INTERESTS = ['Купить квартиру', 'Продать недвижимость', 'Инвестиции', 'Аренда'];
const PROJECTS = new Set(['avalon-residence', 'mirador', 'ofiyat', 'meros', 'sado', 'flagman', '4u', 'voha', 'maftun-makon', 'botanika-saroyi', 'bayterak', 'zamon', 'yangibaxt', 'jomiy', 'regnum-plaza', 'sun', 'pushkin', 'dormon-hills', 'c1', 'saadiyat', 'sarbon', 'soy-boyi']);
const PAGE_ROOTS = new Set([...PROJECTS, 'avalon', 'sanat', 'san-at', 'tencrop', 'tencorp', 'apartments']);
export class Rejection extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const reject = (status, code) => { throw new Rejection(status, code); };
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);

export function createGuard({ secret, database = ':memory:', origins = ['https://form.tencorp.uz'],
  sitekey = '', turnstileSecret = '', turnstileRequired = true, fetchImpl = fetch, now = Date.now, audit = () => {},
  upstream = 'http://127.0.0.1:3000/api/submit' } = {}) {
  if (typeof secret !== 'string' || secret.length < 43) throw Error('LEAD_GUARD_SECRET must have at least 256 bits');
  if (Boolean(sitekey) !== Boolean(turnstileSecret)) throw Error('Turnstile requires both sitekey and secret');
  if (turnstileRequired && !sitekey) throw Error('Turnstile keys required unless TURNSTILE_REQUIRED=false explicitly');
  const allowed = new Set(origins.map(v => { const u = new URL(v); if (u.protocol !== 'https:' || u.origin !== v) throw Error('Origins must be HTTPS origins'); return v; }));
  const target = new URL(upstream);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.pathname !== '/api/submit') throw Error('Upstream must be loopback /api/submit');
  const db = new DatabaseSync(database);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1500;
    CREATE TABLE IF NOT EXISTS nonce(id TEXT PRIMARY KEY, session TEXT NOT NULL, issued INTEGER NOT NULL, expires INTEGER NOT NULL, source TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rate(key TEXT PRIMARY KEY, tokens REAL NOT NULL, updated INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS duplicate(key TEXT PRIMARY KEY, expires INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS nonce_expiry ON nonce(expires);
    CREATE INDEX IF NOT EXISTS rate_expiry ON rate(expires);
    CREATE INDEX IF NOT EXISTS duplicate_expiry ON duplicate(expires);`);
  const hmac = v => createHmac('sha256', secret).update(v).digest('base64url');
  const digest = v => hmac(v);
  const sign = v => `${v}.${hmac(v)}`;
  function verify(v) {
    if (typeof v !== 'string' || v.length > 500) return null;
    const parts = v.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/u.test(parts[0]) || !/^[A-Za-z0-9_-]{43}$/u.test(parts[1])) return null;
    const expected = Buffer.from(hmac(parts[0])); const supplied = Buffer.from(parts[1]);
    return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? parts[0] : null;
  }
  const nonceGet = db.prepare('SELECT * FROM nonce WHERE id=?');
  const rateGet = db.prepare('SELECT tokens,updated FROM rate WHERE key=?');
  const ratePut = db.prepare('INSERT INTO rate(key,tokens,updated,expires) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET tokens=excluded.tokens,updated=excluded.updated,expires=excluded.expires');
  function takeRate(key, capacity, period) {
    const hashed = digest(key); const t = now(); const row = rateGet.get(hashed);
    const balance = row ? Math.min(capacity, row.tokens + Math.max(0, t - row.updated) * capacity / period) : capacity;
    if (balance < 1) reject(429, 'rate_limited');
    ratePut.run(hashed, balance - 1, t, t + 86_400_000);
  }
  let operations = 0;
  function cleanup() {
    if (++operations % 50 !== 1) return;
    for (const table of ['nonce', 'rate', 'duplicate']) db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE expires < ? LIMIT 500)`).run(now());
  }
  function sourceUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) reject(403, 'invalid_source');
    let u; try { u = new URL(value); } catch { reject(403, 'invalid_source'); }
    if (!allowed.has(u.origin) || u.username || u.password) reject(403, 'invalid_source');
    u.hash = '';
    return u;
  }
  function session(headers) {
    const cookie = headers.get('cookie') || '';
    const values = cookie.split(';').map(x => x.trim()).filter(x => x.startsWith('__Host-tc_form='));
    if (values.length !== 1) return null;
    const value = verify(values[0].slice('__Host-tc_form='.length));
    return value && /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
  function ip(headers) {
    const value = headers.get('x-real-ip');
    return value && /^[a-f0-9:.]{1,64}$/iu.test(value) ? value : 'unknown';
  }
  function event(code, headers, route, status) {
    audit({ security_event: code, ip: ip(headers), route, status, time: new Date(now()).toISOString() });
  }
  function challenge(url, headers) {
    cleanup();
    if (headers.get('sec-fetch-site') === 'cross-site') reject(403, 'invalid_origin');
    const ref = sourceUrl(headers.get('referer'));
    if (headers.has('origin') && headers.get('origin') !== ref.origin) reject(403, 'invalid_origin');
    const requested = url.searchParams.get('page') || url.searchParams.get('path') || `${ref.pathname}${ref.search}`;
    if (!requested.startsWith('/') || requested.startsWith('//') || requested.includes('\\')) reject(403, 'invalid_source');
    const source = sourceUrl(new URL(requested, ref.origin).href);
    if (source.pathname !== '/' && !PAGE_ROOTS.has(source.pathname.split('/')[1])) reject(403, 'invalid_source');
    // Browsers may truncate Referrer to origin: signed sources are restricted
    // to the same origin and are never used for network requests.
    takeRate(`challenge-ip:${ip(headers)}`, 15, 60_000);
    let sid = session(headers); let cookie;
    if (!sid) { sid = randomBytes(32).toString('base64url'); cookie = `__Host-tc_form=${sign(sid)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`; }
    takeRate(`challenge-session:${sid}`, 10, 60_000);
    const id = randomBytes(32).toString('base64url');
    if (db.prepare('SELECT count(*) AS count FROM nonce').get().count >= 100_000) reject(503, 'verification_unavailable');
    const clean = new URL(source); clean.hash = '';
    // Never retain names, phones, tokens, auth codes in challenge state.
    for (const key of [...clean.searchParams.keys()]) if (/(name|phone|email|password|secret|token|auth|code)/iu.test(key)) clean.searchParams.delete(key);
    db.prepare('INSERT INTO nonce(id,session,issued,expires,source) VALUES(?,?,?,?,?)').run(digest(id), digest(sid), now(), now() + TTL, clean.href);
    return { body: { token: sign(id), sitekey, expiresIn: TTL / 1000, minAgeMs: 1000 }, cookie };
  }
  function validatePayload(input, contract) {
    if (!object(input)) reject(400, 'invalid_payload');
    if (input.website !== undefined && input.website !== '') reject(400, 'bot_detected');
    const body = { ...input };
    delete body.security_token; delete body.turnstile_token; delete body.website;
    if (!text(body.name, 2, 120)) reject(400, 'invalid_name');
    // Field semantics allow real apostrophes and every Unicode script, while
    // SQL syntax is not a meaningful person's name.
    if (!/^[\p{L}\p{M}\s.'‘’ʻʼ\-]+$/u.test(body.name) || !/\p{L}/u.test(body.name)) reject(400, 'invalid_name');
    const phonePattern = contract === 'legacy' ? /^\+?\d[\d\s()+-]{7,24}$/u : /^\+998\d{9}$/u;
    if (typeof body.phone !== 'string' || !phonePattern.test(body.phone)) reject(400, 'invalid_phone');
    if (contract === 'agency-v1') {
      if (Object.keys(body).some(k => !['name', 'phone', 'interest', 'consent', 'landing_url'].includes(k)) || !INTERESTS.includes(body.interest) || body.consent !== true) reject(400, 'invalid_payload');
    } else {
      if (!['live', 'invest', 'rent'].includes(body.goal)) reject(400, 'invalid_goal');
      if (contract === 'residence-v1' && (body.consent !== true || !PROJECTS.has(body.projectSlug) || !['ru', 'uz', 'en'].includes(body.language ?? body.lang) || !text(body.formContext ?? body.context, 1, 2048))) reject(400, 'invalid_payload');
    }
    if (body.landing_url) sourceUrl(body.landing_url);
    for (const apartment of [body.lastViewedApartment, body.last_viewed_apartment]) {
      if (object(apartment) && typeof apartment.url === 'string' && apartment.url) {
        sourceUrl(new URL(apartment.url, [...allowed][0]).href);
      }
    }
    return body;
  }
  async function submit(route, input, headers) {
    cleanup();
    const contract = PATHS.get(route); if (!contract) reject(404, 'not_found');
    const origin = headers.get('origin');
    if (!allowed.has(origin) || headers.get('sec-fetch-site') === 'cross-site') reject(403, 'invalid_origin');
    const ref = sourceUrl(headers.get('referer'));
    if (ref.origin !== origin) reject(403, 'invalid_origin');
    takeRate(`attempt:${ip(headers)}`, 8, 60_000);
    if (headers.get('x-lead-honeypot')) reject(400, 'bot_detected');
    const body = validatePayload(input, contract);
    const sid = session(headers); const id = verify(headers.get('x-lead-token') || input.security_token);
    if (!sid || !id) reject(403, 'verification_required');
    const nonce = nonceGet.get(digest(id));
    if (!nonce || nonce.session !== digest(sid) || nonce.expires <= now() || nonce.used || new URL(nonce.source).origin !== origin) reject(403, 'invalid_verification');
    if (now() - nonce.issued < 1000) reject(403, 'verification_too_fast');
    if (sitekey) {
      const turnstileToken = headers.get('x-turnstile-token') || input.turnstile_token;
      if (!text(turnstileToken, 1, 2048)) reject(403, 'verification_required');
      let result;
      try {
        const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ secret: turnstileSecret, response: turnstileToken, remoteip: ip(headers) }),
          redirect: 'error', signal: AbortSignal.timeout(4000),
        });
        result = response.ok ? await response.json() : null;
      } catch { reject(503, 'verification_unavailable'); }
      if (result?.success !== true || result.hostname !== new URL(origin).hostname || result.action !== 'lead_submit') reject(403, 'verification_failed');
    }
    const duplicateKey = digest(`${body.phone.replace(/\D/gu, '')}:${body.projectSlug ?? 'agency'}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      const current = nonceGet.get(digest(id));
      if (!current || current.used || current.expires <= now()) reject(409, 'already_submitted');
      const dupe = db.prepare('SELECT expires FROM duplicate WHERE key=?').get(duplicateKey);
      if (dupe && dupe.expires > now()) reject(409, 'duplicate_submission');
      takeRate(`submit-ip:${ip(headers)}`, 2, 60_000);
      takeRate(`submit-session:${sid}`, 2, 60_000);
      takeRate(`submit-phone:${body.phone.replace(/\D/gu, '')}`, 2, 600_000);
      db.prepare('UPDATE nonce SET used=1 WHERE id=?').run(digest(id));
      db.prepare('INSERT INTO duplicate(key,expires,state) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET expires=excluded.expires,state=excluded.state').run(duplicateKey, now() + 300_000, 'processing');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    body.landing_url = nonce.source;
    const forwarded = { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Real-IP': ip(headers) };
    if (contract !== 'legacy') forwarded['X-Tencorp-Lead-Contract'] = contract;
    for (const name of ['x-tencorp-web-visitor', 'x-tencorp-web-session']) {
      const value = headers.get(name);
      if (value && value.length <= 400 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value)) forwarded[name] = value;
    }
    for (const name of ['dnt', 'sec-gpc']) if (headers.get(name) === '1') forwarded[name] = '1';
    try {
      const response = await fetchImpl(target, { method: 'POST', headers: forwarded, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(8000) });
      const raw = await boundedResponse(response);
      let receipt; try { receipt = JSON.parse(raw); } catch { throw Error('invalid_receipt'); }
      if (!object(receipt)) throw Error('invalid_receipt');
      if (response.ok && receipt.success === true) {
        db.prepare('UPDATE duplicate SET state=? WHERE key=?').run('confirmed', duplicateKey);
        event('lead_confirmed', headers, route, 200);
        return { status: response.status, body: receipt };
      }
      event('lead_unconfirmed', headers, route, 502);
      return { status: response.status === 429 ? 429 : 502, body: { success: false, error: 'lead_delivery_unconfirmed' } };
    } catch {
      // The CRM may have committed even when its receipt was lost. Keep the
      // durable nonce and dedup reservation to prevent blind retries.
      event('lead_delivery_uncertain', headers, route, 502);
      return { status: 502, body: { success: false, error: 'lead_delivery_unconfirmed' } };
    }
  }
  return { challenge, submit, event, close: () => db.close(), paths: PATHS };
}

async function boundedResponse(response) {
  const reader = response.body?.getReader(); if (!reader) return '';
  const parts = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) { await reader.cancel(); throw Error('large_receipt'); } parts.push(value); }
  return Buffer.concat(parts).toString('utf8');
}
