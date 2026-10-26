# Uysot: isolated WARP transport

The operator approved Cloudflare WARP and its terms on 2026-10-26. Install only
the official signed `cloudflare-warp` package from `pkg.cloudflareclient.com`
for the actual Ubuntu release. The reviewed server uses Ubuntu 26.04
(`resolute`), package `2026.8.2115.0`. Never use an unofficial installer, a public
open proxy, certificate-verification bypass, or a system-wide WARP mode here.

Before registering or connecting, set and verify local-proxy mode:

```sh
warp-cli --accept-tos mode proxy
warp-cli --accept-tos proxy port 40000
warp-cli --accept-tos settings
```

Only after `Mode: WarpProxy on port 40000` is confirmed, register the device
with `warp-cli --accept-tos registration new` and connect with
`warp-cli --accept-tos connect`. Registration material stays under the client's
private server-side state; it must not be copied into Git or audit reports.

Verify the real data path (CLI `connect` alone is not readiness):

```sh
warp-cli --accept-tos status
ss -lntp
curl --fail --silent --show-error --max-time 25 \
  --socks5-hostname 127.0.0.1:40000 https://www.cloudflare.com/cdn-cgi/trace
```

The proxy must bind **only** `127.0.0.1:40000` and the proxied trace must contain
`warp=on`. A direct trace must still contain `warp=off` and the original server
address. Compare IPv4/IPv6 routes, policy rules and `resolvectl dns` with saved
pre-install values. The reviewed client adds a reserved policy rule for table
65743 in both IP families, but that table has no routes in proxy mode; traffic
therefore falls through to the unchanged main table. Do not remove the
daemon-managed rule. Verify the empty table and direct egress rather than
claiming byte-identical policy rules. Do not connect in `warp`, `warp+doh` or
`tunnel_only` mode.

Install `systemd/residence-live-browser-uysot-warp.conf` as
`/etc/systemd/system/residence-live-browser-uysot.service.d/20-warp-proxy.conf`.
It replaces only that browser's command, preserving its existing profile,
loopback CDP port, sandbox and TLS verification. SOCKS5 applies to the dedicated
Uysot browser; QUIC is disabled in that browser. The main CRM browser, frontend,
SSH and catalogue API remain direct. No Chrome or global proxy settings are
changed for them.

Pause only Uysot's capture/timer while signing in through the private server
browser. Do not read or export browser cookies, storage or authorization
headers. Do not persist the viewer password in source, command arguments or an
environment file. The persistent Chrome profile keeps the normal signed-in
session. Resume the existing capture service/timer after a complete validated
capture, and verify fresh health plus the actual production Avalon page.

The separate CRM notification service alerts on failed or stale captures,
including transport/session loss, and reports confirmed recovery. It does not
fabricate recovery merely because WARP is connected.

## Verification and rollback

Save the exact pre-existing drop-in (if any) before changing it. To restore the
previous direct browser, move **only** `20-warp-proxy.conf` out of that service's
drop-in directory, reload systemd and restart only
`residence-live-browser-uysot.service`. Never remove the browser profile or
accepted catalogue. Disconnect WARP when no scoped client needs it; do not alter
the server's default route, DNS or firewall for this setup.

On the reviewed server, network baselines and package-install logs are in
`/var/backups/tencorp-warp-20261026/`. Package installation added only new
dependencies, without upgrading or removing existing packages. WARP mode and
the browser override persist across service restarts/reboots.

Primary references:

- https://pkg.cloudflareclient.com/
- https://developers.cloudflare.com/warp-client/get-started/linux/
- https://developers.cloudflare.com/warp-client/warp-modes/#local-proxy
