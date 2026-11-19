import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createGuard, Rejection } from './guard.mjs';

export function createServer(options = {}) {
  const guard = createGuard(options);
  const server = http.createServer(async (req, res) => {
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const send = (status, body, cookie) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', ...(cookie ? { 'Set-Cookie': cookie } : {}), ...(status === 429 ? { 'Retry-After': '60' } : {}) });
      res.end(JSON.stringify(body));
    };
    try {
      if (url.pathname === '/health' && req.method === 'GET') return send(200, { ok: true });
      if (url.pathname === '/lead-security/challenge' && req.method === 'GET') {
        const result = guard.challenge(url, headers); return send(200, result.body, result.cookie);
      }
      if (!guard.paths.has(url.pathname)) return send(404, { success: false, error: 'not_found' });
      if (req.method !== 'POST') return send(405, { success: false, error: 'method_not_allowed' });
      if (headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Rejection(415, 'unsupported_media_type');
      const max = url.pathname === '/v1/agency-leads' ? 4096 : 65536;
      const length = headers.get('content-length');
      if (length && (!/^\d+$/u.test(length) || Number(length) > max)) throw new Rejection(413, 'payload_too_large');
      let size = 0; const parts = [];
      for await (const part of req) { size += part.length; if (size > max) throw new Rejection(413, 'payload_too_large'); parts.push(part); }
      let body; try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new Rejection(400, 'invalid_json'); }
      const result = await guard.submit(url.pathname, body, headers); send(result.status, result.body);
    } catch (e) {
      const status = e instanceof Rejection ? e.status : 503;
      const code = e instanceof Rejection ? e.code : 'guard_unavailable';
      guard.event(code, headers, url.pathname.slice(0, 100), status);
      if (!res.headersSent) send(status, { success: false, error: code }); else res.end();
    }
  });
  server.requestTimeout = 12_000; server.headersTimeout = 10_000;
  server.on('close', guard.close);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer({ secret: process.env.LEAD_GUARD_SECRET, database: process.env.LEAD_GUARD_DATABASE || '/var/lib/tencorp-lead-guard/guard.sqlite',
    origins: (process.env.LEAD_GUARD_ORIGINS || 'https://form.tencorp.uz').split(','),
    sitekey: process.env.TURNSTILE_SITEKEY || '', turnstileSecret: process.env.TURNSTILE_SECRET || '',
    turnstileRequired: process.env.TURNSTILE_REQUIRED !== 'false',
    audit: e => console.log(JSON.stringify(e)) });
  server.listen(Number(process.env.LEAD_GUARD_PORT || 4350), '127.0.0.1');
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
