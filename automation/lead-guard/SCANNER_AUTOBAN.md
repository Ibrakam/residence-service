# Confirmed scanner automatic blocking

The detector runs as `tencorp-security-monitor`, with no capabilities and no
systemd control-socket access. It can read Nginx/journal logs and write only its
own private detector state. It cannot write the root policy, helper state,
UFW rules or Nginx configuration. The existing form alerts remain enabled.

A separate fixed root helper independently rereads Nginx-owned access logs;
the detector's candidate file only wakes it. It never trusts candidate IPs,
request bodies, queries, User-Agent or X-Forwarded-For. It requires, in a real
180-second window, at least30 distinct failed request events, eight distinct
known exploit/secret paths, two exploit families, and at least one secret-file
family. API documentation, ordinary404s, WordPress-only probes and crawlers do
not suffice. Timestamp checks, cursor/rotation handling, UTF-8 replacement,
ASCII-safe classification, byte budgets and independent evidence validation
prevent replay and detector-state poisoning.

Both IPv4 and IPv6 are supported. Non-global addresses, the origin server,
explicit operator addresses and reviewed proxy networks are protected. The
installer adds the current SSH operator address privately. Cloudflare ranges
were checked22November2026 against:

- https://www.cloudflare.com/ips-v4/
- https://www.cloudflare.com/ips-v6/

Keep the root-owned `/etc/tencorp-scanner-autoban/policy.json` current if
operators/proxies change. Detector group has read-only access. If the site's
DNS no longer points directly to the reviewed origin addresses, NEW autobans
pause; generic detection alerts continue. Review CDN/real-IP configuration
before re-enabling a deployment behind a proxy.

Automatic blocks last seven days; manual scanner blocks remain permanent.
Only exact single IPs are permitted. Maximum250 active automatic leases and
three new/expired leases per run bound firewall growth and work. The helper
uses its own UFW comment and a separate generated Nginx denylist, preserving
manual rules. Expiry and operator removal continue when new blocking is
disabled or UFW is inactive. It deletes only helper-owned UFW rules, even if a
separate manual Nginx deny for the same IP remains.

Helper state and original proof files are root-only under
`/var/lib/tencorp-scanner-autoban`, separate from detector state. A pending
verified incident survives a firewall outage and retries during its seven-day
lease. Every stored lease is checked against its original proof SHA, its exact
owned persistent UFW rule and current kernel status. Bot confirmation is sent
only after a real kernel DROP is verified and state is persisted; notification
failures retry without inserting a second ban. Telegram acknowledgement
ambiguity can cause an occasional repeated notification after a network
failure; no fake block messages are sent. No test message is sent by install.

The existing approved CRM/security bot is supplied through systemd credentials;
tokens are never copied into source, output, process arguments or logs.
Notifications include the blocked scanner IP, aggregate reason and expiry;
request bodies/queries/visitor identifiers are not included. Audit metadata is
bounded to500 files/90days. Active proof files are removed with their leases.

Disable new bans: set `enabled:false` in the policy; expiry still runs. Do not
stop the expiry timer unless intentionally freezing existing blocks.

Unblock an automatically managed IP with the fixed helper:

```sh
sudo /usr/bin/python3 /opt/tencorp-lead-guard/scanner-autoban.py --unban 203.0.113.9
```

The sample is a documentation address. A production unban command must use the
actual canonical single address. This removes only helper-managed rules. It
does not remove independent manual bans. For trusted operators, add the real
address to `operatorCidrs` first; the next helper run removes its own block.

Checks without applying blocks or sending messages:

```sh
python3 automation/lead-guard/test_scanner_autoban.py
sudo python3 /opt/tencorp-lead-guard/scanner-autoban.py \
  --replay /root/tencorp-secret-probe-20261122-0710.json
journalctl -u tencorp-scanner-autoban
systemctl status tencorp-scanner-autoban.path tencorp-scanner-autoban.timer
```

The sandbox profile is validated against this server's `nf_tables` iptables
backend. It deliberately does not require the nonexistent legacy
`/run/xtables.lock`. Reevaluate the sandbox before changing firewall backends.
