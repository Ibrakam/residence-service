# Lead security gateway

Deployed 2026-11-19 on loopback4350 ahead of the existing amoCRM sink3000.
The four existing exact Nginx routes retain their previous login boundaries:
`/v1/agency-leads`, `/v1/leads`, `/tencrop/v1/leads`, `/api/submit`.

## Runtime

`tencorp-lead-guard.service` uses Node22 `node:sqlite` and no npm dependencies.
State is private `/var/lib/tencorp-lead-guard/guard.sqlite`; IP/session/phone
identifiers are keyed hashes. Nonce validity15minutes, minimum age1second;
single-use reservations survive restarts. Phone/project duplicates are blocked
for5minutes, including uncertain CRM responses. No rejected body or telephone
is logged. Rate limits are independent per IP, session and phone.

Production files: `/opt/tencorp-lead-guard`, configuration
`/etc/tencorp-lead-guard/guard.env` (root0600). Required
`LEAD_GUARD_SECRET` is generated locally with32randombytes. It is not a browser
credential. Allowed production origin is `https://form.tencorp.uz`.

The frontend is injected before other page scripts through Nginx's HTML
response filter. It wraps only four same-origin JSONPOSTs. It obtains a signed
cookie-bound challenge and attaches headers without modifying app payloads.
Honeypots are keyboard-excluded. Optional Turnstile offers RU/UZ/EN accessible
verification with cancel/expiry/error handling. GET content is never challenged.

## Turnstile activation (pending real Cloudflare keys)

Create a Managed widget in the owner's Cloudflare account for
`form.tencorp.uz` only. Do not permit localhost, use testing keys in production,
or send secrets in chat. Put the real paired `TURNSTILE_SITEKEY` and
`TURNSTILE_SECRET` into the private guard.env; set `TURNSTILE_REQUIRED=true`.
Restart `tencorp-lead-guard`, then test real browser flows without generating
unrequested CRM leads. Server checks hostname and `action=lead_submit`.
Until activation the explicit `TURNSTILE_REQUIRED=false` enables nonce/rate/
source controls but does not prove humanity. ManagedCloudflareWAF/DDoS is a
separate account/DNS integration and is not enabled by this gateway.

## Notifications

`tencorp-security-monitor.timer` checks each minute. It reuses the approved CRM
alert bot and recipient via systemdcredential (no token copied into source).
It alerts on3guard rejections,5secretprobes/429s, or10confirmedleads per bounded
window. Per-category15minute cooldown prevents alert floods. No message bodies
or visitor PII are sent. `security-monitor.py --test` sends a labelled test.

## Verification and operations

```
node --test automation/lead-guard/guard.test.mjs
node --check automation/lead-guard/client.js
python3 /opt/tencorp-lead-guard/smoke-production.py
```

The smoke uses a private existing login fixture in memory, checks27HTMLpages,
preserved guest gates, token issuance and rejection of missing proofs. It never
sends a valid lead. Tests exercise upstream success against mocks, concurrent
replay, restart persistence, spoofed sources, SQLprobes, legitimate Uzbek and
apostrophe names, and Turnstile hostname/action failures.

After regenerating Nginx configurations, reapply `configure-nginx.py` and run
the smoke. It backs up affected files below `/root/tencorp-security-backups`,
checks syntax before reload and rolls back on errors. If rolling back the
gateway, restore both backed-up Nginx files and validate/reload Nginx before
stopping the sidecar. Never remove nonce verification while leaving only the
browser widget as protection. Service restarts briefly failclosed503.

UFW allows inbound22/80/443IPv4+IPv6; scanner95.216.224.55 is denied in both
UFW and Nginx. SSH passwords and keyboardinteractiveauth disabled through
`/etc/ssh/sshd_config.d/00-tencorp-security.conf`; keylogin verified afterward.
Existing daily database backups and automaticOSsecurityupdates remain enabled.
Full backup restoration has not been exercised by this change.

SEO: existing project/login/robots restrictions are preserved. Form-only
protection does not make pages behind those restrictions indexable.
