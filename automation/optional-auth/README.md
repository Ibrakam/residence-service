# Optional consumer browsing

Consumer residence pages, public catalogue data, plans and media open without a
Telegram session. A compact sign-in link remains available. Each residence opens
its **existing application form** after five visible seconds, once per project
per tab. It waits for another dialog or intro to close and does not repeat after
a manual application. Existing validation, consent and amoCRM handlers are used.
The main TenCorp homepage has no automatic application prompt.

The Uzbekistan geo rule and main-only SEO rule remain unchanged. The main map,
account, identity, registry, global sync, monthly sales, analytics/operator and
machine/webhook boundaries remain protected. Anonymous applications still pass
the signed form nonce, origin, Turnstile and rate checks at lead-guard.

Public catalogue paths use an explicit published-project allowlist. The original
two catalogue-health URLs return only published project health fields. SANAT's
existing read-only placement POST now validates fixed public project IDs and
bounded pagination and strips booking/contact/internal metadata.

Run from the repository root using Node 22:

```sh
python3 -m unittest discover -s automation/optional-auth -p 'test_*.py' -v
node website/scripts/test-optional-session-guard.mjs
node website/scripts/test-public-consumer-projections.mjs
node automation/optional-auth/test-client.cjs
```

The Chromium test accepts `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE` when
dependencies are outside the repository. It never submits an application.

Deploy the reviewed Residence frontend with the `/residence-assets` namespace
using the existing deployment runbook **before** opening Nginx. The installer
checks that the active compiled client contains the optional-aware session guard.
The deployment smoke helper must support the explicit marker below and retain
all private/operator/machine checks.

After review, install `client.js` and `configure-nginx.py` root-owned below
`/opt/tencorp-optional-auth`, then run as root:

```sh
python3 /opt/tencorp-optional-auth/configure-nginx.py --apply
```

The installer holds the existing geo/config lock, validates exact locations,
backs up original contents and modes, writes atomically, tests Nginx, reloads,
then polls guest/public/private read-only contracts. Failure restores originals.
Only after verification does it create root-only
`/etc/tencorp-auth-gateway/optional-consumer-enabled` with exact contents
`optional-consumer-v1\n`. Use its printed backup directory for rollback:

```sh
python3 /opt/tencorp-optional-auth/configure-nginx.py --rollback /root/tencorp-optional-auth-backups/TIMESTAMP
```

A second apply deliberately fails. Future changes require a reviewed migration;
do not disable the default fail-closed authentication gate globally.
