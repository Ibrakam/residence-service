# Uzbekistan-only web access

All customer sites currently share `form.tencorp.uz`. The Nginx server rewrite
gate runs before location-level redirects, static files, authentication and
application APIs. Unknown and non-UZ addresses receive a non-cacheable 403 page.
Browser login, OIDC callback, analytics, map and static assets obey the same rule.
Existing Telegram login and protected-resource checks remain in place for UZ users.

## Source and trust

Country data is derived from **DB-IP Country Lite** (monthly release), not the
RIR registrant's legal country. IPv4 and IPv6 are supported. Country accuracy
is approximate; an Uzbek subscriber using a foreign VPN exits abroad and is
blocked. No IP-only rule can prevent a foreign visitor using an Uzbek proxy.

Source: <https://db-ip.com/db/download/ip-to-country-lite>, CSV format:
<https://db-ip.com/db/format/ip-to-country-lite/csv.html>.
Data license: CC BY 4.0. A DB-IP attribution link is injected into HTML pages
and included in the denied page. The full database is not shipped in Git.

Nginx uses `$remote_addr` and trusts **no** forwarded IP or country header.
There is currently no CDN/reverse proxy in front of the origin. A future CDN
requires a reviewed change to both this gate and scanner IP attribution;
never trust an arbitrary `X-Forwarded-For` or `CF-IPCountry` header.

## Narrow infrastructure exceptions

These exceptions do not grant access to website pages:

- Exact loopback and server-owned global addresses: existing deployment checks
  and local service health. No operator-wide foreign/private network allowlist.
- GET/HEAD for a single HTTP-01 challenge token, on HTTP and HTTPS: certificate renewal.
- POST to the exact amoCRM webhook and Telegram bot webhook: existing secrets.
- POST to one amoCRM chat scope: existing body HMAC and configured-scope check.
- GET/HEAD of a UUID chat-media capability: existing signature/revocation check.
- Enumerated ticket-runner methods and routes: existing Bearer and lease checks.

OIDC callbacks are browser redirects and are **not** exempt. Generic `/api/`,
`/__auth/`, media prefixes and caller-supplied authentication headers do not
grant an exception. Foreign search crawlers are also blocked by this policy.
Outbound CRM synchronization is unaffected.

## Install and verify

Copy this directory to root-owned `/opt/tencorp-geo-access`. First prepare data:

```sh
python3 /opt/tencorp-geo-access/update-country.py \
  --source /root/dbip-country-lite-YYYY-MM.csv.gz --month YYYY-MM \
  --prepare /var/lib/tencorp-geo-access/prepared
python3 /opt/tencorp-geo-access/test-nginx-runtime.py \
  /var/lib/tencorp-geo-access/prepared
python3 /opt/tencorp-geo-access/configure-nginx.py \
  --apply /var/lib/tencorp-geo-access/prepared
```

The runtime test starts a temporary Nginx listening only on loopback. Its
synthetic source-IP header is confined to that isolated instance and never
configured in production. It checks UZ and foreign IPv4/IPv6, spoofed forwarding
headers, auth/static routes, machine-method restrictions and error-page caching.
It sends no application writes or real leads.

Then install the updater service/timer, run `systemctl daemon-reload`, verify
with `systemd-analyze verify`, and enable `tencorp-geo-access-update.timer`.
Test real UZ access and foreign denial, guest/authenticated boundaries, SSL
renewal dry-run and all independent integration checks after installation.
Do not print session fixtures, webhook secrets, signatures or personal data.

## Update, failure, rollback

The daily updater checks the current monthly source and retains the last
validated list if download, validation or Nginx activation fails. Updates are
atomic and serialized with the installer through
`/run/lock/tencorp-geo-access.lock`. There is no per-request network lookup.

Installation backups are root-only under `/root/tencorp-geo-access-backups/`.
For a complete rollback, stop the updater timer **and** service, then run:

```sh
systemctl stop tencorp-geo-access-update.timer tencorp-geo-access-update.service
systemctl disable tencorp-geo-access-update.timer
python3 /opt/tencorp-geo-access/configure-nginx.py \
  --rollback /root/tencorp-geo-access-backups/INSTALL_TIMESTAMP
```

This restores the previous Nginx configuration and data and tests/reloads it.
SSH and the firewall are not changed by the geo gate. Existing scanner bans
continue to apply, including to UZ clients.
