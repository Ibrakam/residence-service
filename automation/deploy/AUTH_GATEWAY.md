# TENCORP shared Telegram authentication gateway

This runbook prepares a single server-side session for every customer-facing
site on `https://form.tencorp.uz`. It is intentionally a deployment plan, not
an unattended production installer. Nothing in this directory contains a real
Telegram credential, creates a production user, changes Nginx, or starts a
service by itself.

The gateway runs as `tencorp-auth-gateway` on `127.0.0.1:4340`. Nginx asks its
private `/internal/check` endpoint before serving protected pages, application
assets, catalog data, or write APIs. The browser holds only the opaque
`__Host-tencorp_session` cookie; PostgreSQL stores its SHA-256 hash. A verified
phone claim is mandatory. Every Telegram user who consents to share a verified
phone number is created with active access; there is no allowlist.

## Credential boundaries

Telegram uses two different credentials:

- The OIDC Client ID and Client Secret shown by the BotFather **Login Widget**
  settings belong in `/etc/tencorp-auth-gateway/gateway.env`.
- The Bot API token and independent webhook secret belong in
  `/etc/tencorp-auth-gateway/bot.env`. The base service does not load this
  file. An enable-only systemd drop-in loads it for the optional `/start` and
  `/help` webhook; the OIDC exchange never uses it.

The Bot API token is not an OIDC Client Secret and cannot replace one. Any Bot
API token **or OIDC Client Secret** pasted into a chat, terminal command, log,
or repository must be revoked/regenerated in BotFather and replaced on the
server before production use. Do not copy a credential back out of chat.

In BotFather, open the dedicated auth bot and choose **Login Widget**. The two
fields are not interchangeable. Add exactly:

```text
Redirect URIs:   https://form.tencorp.uz/__auth/telegram/callback
Trusted Origins: https://form.tencorp.uz
```

Keep the default `RS256` signing algorithm. The gateway requests
`openid profile phone`; access is denied when `phone_number` is missing or
`phone_number_verified` is not true. Save the displayed Client ID and Client
Secret directly into the root-owned gateway env, never into source control.
Telegram's current setup and OIDC contract are documented at
<https://core.telegram.org/bots/telegram-login>.

## PostgreSQL provisioning

Create a dedicated runtime role without placing its password in shell history:

```sql
CREATE ROLE tencorp_auth_gateway LOGIN NOINHERIT NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
\password tencorp_auth_gateway
GRANT CONNECT ON DATABASE residence_service TO tencorp_auth_gateway;
\connect residence_service
ALTER ROLE tencorp_auth_gateway IN DATABASE residence_service
  SET search_path = pg_catalog, public;
```

Apply `backend/migrations/0014_web_auth.sql` as the existing migration owner,
not as the runtime role. Then run the reviewed grants file as the migration
owner:

```bash
psql -X -v ON_ERROR_STOP=1 "$DATABASE_ADMIN_URL" \
  -f automation/deploy/postgresql/tencorp-auth-gateway-grants.sql
```

Run the grants verifier after every future migration. It revokes the gateway's
direct access to every public table/sequence/function, grants only the required
columns of `web_auth_users`, the two short-lived auth tables, and the identity
sequence, and fails if any unrelated public relation is reachable. The runtime
cannot select stored phone/photo values or change the operator-owned `status`.
The migration owner remains responsible for DDL; `AUTH_AUTO_MIGRATE` is forced
off by systemd.

Phone numbers are personal data. Before production enablement, the public
privacy policy must say why Telegram identity and phone are stored, how long
sessions/account data are retained, who receives the data, and how deletion is
requested. Backups and database operator access must follow the same policy.

## Auth user administration

Install `tencorp-auth-admin.sh` as `/usr/local/sbin/tencorp-auth-admin`, owned by
`root:root` with mode `0750`. It is a root-only operator tool: it connects only
to the local `residence_service` database through `runuser -u postgres` and
`psql -X`, does not read `gateway.env`, and never selects session hashes.

```bash
sudo /usr/local/sbin/tencorp-auth-admin list
sudo /usr/local/sbin/tencorp-auth-admin list --all
sudo /usr/local/sbin/tencorp-auth-admin block TELEGRAM_ID
sudo /usr/local/sbin/tencorp-auth-admin unblock TELEGRAM_ID
sudo /usr/local/sbin/tencorp-auth-admin delete TELEGRAM_ID
sudo sh -c \
  'umask 077; /usr/local/sbin/tencorp-auth-admin export --all > /root/tencorp-auth-users.csv'
```

`list` and `export` show active users unless `--all` is supplied; both include
the verified phone and the current count of unrevoked, unexpired sessions.
Blocking immediately revokes every session, and unblocking requires a fresh
sign-in. Deleting removes the user and cascades to every session and is not
reversible. List and CSV output contain personal data: keep them out of shell
debug traces, tickets, chat, and ordinary logs, and remove exports according to
the privacy retention policy.

## Service installation

Build `./cmd/auth-gateway` on the release builder and place the binary plus the
matching `backend/migrations/` directory in an immutable root-owned release:

```text
/opt/tencorp-auth-gateway/releases/<UTC timestamp>-<commit>/auth-gateway
/opt/tencorp-auth-gateway/releases/<UTC timestamp>-<commit>/migrations/
/opt/tencorp-auth-gateway/current -> releases/<active release>
/etc/tencorp-auth-gateway/gateway.env
/etc/tencorp-auth-gateway/bot.env                         # optional
/etc/systemd/system/tencorp-auth-gateway.service.d/      # optional
```

Create the non-login service identity and configuration directory:

```bash
sudo useradd --system --user-group --home-dir /nonexistent \
  --shell /usr/sbin/nologin tencorp-auth-gateway
sudo install -d -o root -g root -m 0755 /etc/tencorp-auth-gateway
sudo install -o root -g root -m 0600 \
  automation/deploy/tencorp-auth-gateway.env.example \
  /etc/tencorp-auth-gateway/gateway.env
```

Replace every placeholder without printing secrets. Install
`systemd/tencorp-auth-gateway.service`, review the complete diff, then run:

```bash
sudo systemd-analyze verify /etc/systemd/system/tencorp-auth-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable --now tencorp-auth-gateway.service
sudo systemctl is-active tencorp-auth-gateway.service
sudo ss -ltnp | grep -F '127.0.0.1:4340'
curl --fail --silent --show-error http://127.0.0.1:4340/healthz
```

The listener must never be `0.0.0.0`, `[::]`, or publicly firewalled open.
There is deliberately no public Nginx mapping for `/healthz`.

The service writes structured `web_auth_event` records to stdout with only two
closed fields: `event` and `outcome`. Use these codes to alert on OIDC, database,
blocked-account, logout, and bot-delivery failures. They deliberately contain
no request URI/query, Telegram/profile identifier, phone, cookie, state, code,
token, provider error, or database error text. Keep Nginx access logging off for
the auth URLs so callback codes and states never enter an edge log; do not add
dynamic fields to the gateway logger without extending its leak-regression test.

## Bot presentation

Copy `tencorp-auth-bot.env.example` to `bot.env`, install a newly rotated token
and its numeric bot ID, and keep the file `root:root` mode `0600`. Merely
creating this file does not expose its values to the disabled gateway service.
The profile script parses this file as data rather than sourcing shell code,
does not put either secret in argv, and suppresses Bot API responses. Generate
the independent webhook secret directly into the protected file and validate
it without making an external change:

```bash
sudo automation/deploy/configure-tencorp-auth-bot.sh --initialize-webhook-secret
sudo automation/deploy/configure-tencorp-auth-bot.sh --check
```

It installs localized RU/UZ/EN names and descriptions, publishes only the
supported `/start` and `/help` commands, adds a menu
button for the site, and registers the webhook with Telegram's secret header.
The first registration drops pending updates accumulated before the handler was
installed. If a reviewed square JPG path is provided, the script also uploads
the avatar. It does not and cannot register OIDC Allowed URLs or reveal the
Client Secret; those remain a manual BotFather step.

The message webhook is optional and disabled by default. Finish the gateway and
Nginx rollout below first, including the public webhook location. Then install
the reviewed drop-in, restart, and prove the gateway is healthy before making
the one-shot Bot API change:

```bash
sudo install -d -o root -g root -m 0755 \
  /etc/systemd/system/tencorp-auth-gateway.service.d
sudo install -o root -g root -m 0644 \
  automation/deploy/systemd/tencorp-auth-gateway-bot-webhook.conf \
  /etc/systemd/system/tencorp-auth-gateway.service.d/bot-webhook.conf
sudo systemctl daemon-reload
sudo systemctl restart tencorp-auth-gateway.service
sudo systemctl is-active tencorp-auth-gateway.service
curl --fail --silent --show-error http://127.0.0.1:4340/healthz
sudo automation/deploy/configure-tencorp-auth-bot.sh --apply
```

Do not add `bot.env` to the base unit: a disabled gateway must not inherit the
Bot API token. Telegram OIDC remains functional without the drop-in. The apply
operation intentionally uses `drop_pending_updates=true`; rerunning it discards
updates queued immediately before that call, so use it as an operator-controlled
initial registration/profile refresh, not a periodic job. Never reuse the
privileged ticket bot or its token.

## Nginx contract

Install all seven snippets as root-owned mode `0644` under
`/etc/nginx/snippets/` before any configuration references them:

```text
tencorp-auth-rate-limits.conf
tencorp-auth-public-proxy.conf
tencorp-auth-gateway.conf
tencorp-auth-gate.conf
tencorp-auth-protect-page.conf
tencorp-auth-protect-api.conf
tencorp-auth-exempt.conf
```

Include `tencorp-auth-rate-limits.conf` exactly once in Nginx's `http` context,
outside every `server` block. It defines distinct limits for login rendering,
OIDC start/callback, the Bot API webhook, and other public auth endpoints. The
login renderer allows a burst of 60 because a gated deployment checks all 35
site routes from one IP; the state-changing OIDC start endpoint remains limited
to a burst of 5. Never apply a request limit to `/__tencorp-auth/check`, because
every protected request depends on that internal subrequest.

The Nginx rollout has two deliberately separate phases. First include
`tencorp-auth-gateway.conf` exactly once inside the TLS server block while the
existing sites are still open. It exposes `/__auth/*`, creates an
Nginx-internal check location, and defines two unauthorized handlers, but it
does **not** install a server-level `auth_request`. This bootstrap phase is
required so an operator can complete the real OIDC flow and provision the
authenticated deployment-smoke session before closing the sites. The public URI
is preserved when proxying auth routes. The internal Nginx URI
`/__tencorp-auth/check` maps to the backend's `/internal/check`; neither check
nor the loopback health route is public.

Only at the final reviewed cutover, include `tencorp-auth-gate.conf` exactly
once in the same TLS server block and add the page/API/exception includes below
to the live locations. The gate installs the server-level, fail-closed
`auth_request`. Every proxy/static content location then inherits the session
check unless it explicitly includes `tencorp-auth-exempt.conf`; a newly added
unclassified location therefore fails closed rather than becoming public. Do
not include `tencorp-auth-gate.conf`, `tencorp-auth-protect-page.conf`, or
`tencorp-auth-protect-api.conf` during the bootstrap reload.

The public `GET /__auth/account` page is the user-facing session screen. It
shows the signed-in Telegram profile and same-origin forms for signing out of
the current browser or all sessions. The existing `/__auth/` wildcard gives it
the general auth rate limit; no separate static assets are required.

The page protect snippet changes the inherited `401` into an internal render of
`/__auth/login` only for a GET that accepts HTML. It overwrites
`X-Original-URI` with immutable `$request_uri`, and the gateway validates that
value as a local path. There is no dynamic `return_to` interpolation in a
`Location` header. The API snippet changes the inherited failure into a
non-cacheable JSON `401`; an unauthenticated POST, fetch, data API, or asset
never receives login HTML. If the gateway or PostgreSQL is unavailable,
`auth_request` fails closed with a 5xx.

Add the page snippet inside these existing content locations:

```nginx
include /etc/nginx/snippets/tencorp-auth-protect-page.conf;
```

- exact `/` in `/etc/nginx/snippets/residence-root-route.conf`;
- `location ^~ /avalon/`;
- `location ^~ /tencrop/`;
- exact `/sanat/` and `/sanat/flats`;
- the regex containing the 15 direct projects: `4u`, `bayterak`,
  `botanika-saroyi`, `flagman`, `jomiy`, `maftun-makon`, `meros`, `mirador`,
  `ofiyat`, `regnum-plaza`, `sado`, `sun`, `voha`, `yangibaxt`, and `zamon`;
- `location ^~ /tencorp/`;
- `location ^~ /u/` and the final legacy `location /` fallback.

The exact `/avalon`, `/tencrop`, `/sanat`, and `/tencorp` locations may keep
their path-only redirects: they expose no site content and their destinations
are gated. An Nginx `return` executes before access handlers, so merely adding
an auth include to those redirect-only locations would not gate the redirect.

Add the API snippet inside every location that serves protected data, writes,
or project/framework assets:

```nginx
include /etc/nginx/snippets/tencorp-auth-protect-api.conf;
```

- `/avalon/_next/static/`;
- every `/residence-assets/` content location, including `_next/static`;
- exact `/v1/leads`, `/residence-api/catalog/`,
  `/api/kayan/ofiyat-explorer`, and `/kayan/`;
- `/tencrop/_next/static/`, exact `/tencrop/v1/leads`, and
  `/tencrop/api/catalog/`;
- `/sanat-assets/`;
- exact `/api/submit`, exact `/api/nrg-apartments`, and generic `/api/`;
- both root `/_next/` locations;
- root `/assets/`, the `/images|fonts/` regex, `/favicon.svg`, and `/icon.svg`.

The `/residence-api/catalog` and `/tencrop/api/catalog` slash redirects may
remain path-only redirects; their trailing-slash data locations are gated.
Replace the current `/sitemap.xml` proxy with a `404` while the ecosystem is
closed.

Keep only these explicit exceptions outside browser SSO. Because the gate is
at server scope, every proxied/static exception must include
`tencorp-auth-exempt.conf` (or an equivalent reviewed `auth_request off`):

- `/__auth/*`, including the secret-header-validated Telegram bot webhook and
  the six fixed, versioned UI assets under `/__auth/assets/`;
- exact `/privacy` and its path-only `/privacy/` redirect;
- exact `/robots.txt`, replaced with `User-agent: *` and `Disallow: /`;
- Certbot's `/.well-known/acme-challenge/` location;
- `/__residence-ticket-worker/*`, which retains its own Bearer validation;
- exact `/api/amo-webhook`, which retains its current secret webhook contract;
- `/market-map` and `/analytics`, which retain their current operator Basic
  authentication and must not inherit browser SSO;
- loopback-only health routes and any future server-to-server webhook with its
  own authenticated boundary.

Do not remove the operator authorization from `/market-map` or `/analytics`,
do not use `satisfy any`, and do not replace an operator
`401`/`WWW-Authenticate` response with login HTML. Explicitly disable only the
inherited browser `auth_request` inside those locations while leaving their
Basic configuration intact. Record the current analytics authorization
behavior before the edit and prove it is unchanged afterward. `/market-map/`
must still challenge with its existing Basic realm after rollout.

Both protected page/API snippets clear `Cookie`, `Authorization`, and every
`X-Auth-*` request header before proxying the main request. The session bearer
is consumed only by the internal edge check and must never reach an application
log or an external upstream such as the apartment catalogue. Independent
operator/webhook locations are exempt but still clear the shared Cookie and
spoofable `X-Auth-*` headers; only their explicitly reviewed Basic/Bearer
credential is forwarded. Every non-auth upstream also has `Set-Cookie` hidden,
so it cannot replace the host-wide auth or browser-binding cookie. Only the
auth gateway's public dynamic routes may set those cookies.

Nginx `return` directives run before access checks. Redirect-only `return 30x`
locations expose no content and may point to a gated destination, but every
content-producing `return 2xx` location must be treated as an explicit public exception
or replaced by a normal protected content handler. Review the complete live
`nginx -T` output for these directives before enabling the gate.

The public robots location should be replaced, not duplicated:

```nginx
location = /robots.txt {
    include /etc/nginx/snippets/tencorp-auth-exempt.conf;
    default_type text/plain;
    return 200 "User-agent: *\nDisallow: /\n";
}
```

Proxy exact `/privacy` to the auth gateway with
`tencorp-auth-public-proxy.conf`; its localized legal HTML contains inline CSS,
no JavaScript, and references only the six fixed auth assets. Keep the
dedicated `/__auth/assets/` proxy public and immutable, but never exempt a main
application asset prefix or JavaScript chunk that can contain catalog data.

## Rollout gate and smoke contract

Do **not** enable the Nginx gate while the existing Residence deployer still
requires public page/assets to return 2xx. Its candidate and direct loopback
checks must continue to require all 31 routes plus the exact framework asset to
return 2xx. Its public checks must be changed to the closed-site contract below,
and the deploy must still prove the service PID/cwd and late
`DEPLOY_CONFIRMED` marker before reporting success.

Required unauthenticated public checks:

- `GET /`, `/sanat/`, `/avalon/`, `/tencorp/`, `/tencrop/`, and both routes for
  every direct project, with `Accept: text/html`, return the self-contained
  login page as 200 and contain
  `method="post" action="/__auth/telegram/start"`;
- representative framework/image assets return 401 with
  `Cache-Control: private, no-store`;
- `/residence-api/catalog/` and `/api/kayan/ofiyat-explorer` return 401;
- protected POST routes return 401 without forwarding a body upstream;
- all six `/__auth/assets/` files remain 200 with their exact image/font
  content type, HSTS, and `public, max-age=31536000, immutable`, never
  `private` or `no-store`;
- direct public access to `/__tencorp-auth/check` does not expose the internal
  endpoint;
- `/privacy` remains readable, `/robots.txt` disallows `/`, and sitemap is
  closed;
- the ticket worker still exercises its Bearer contract, market-map still
  exercises Basic auth, and `/analytics` still returns its independent `401`
  with `Basic realm="TenCorp Analytics"`.

The gated deployer is selected only by this exact root-controlled marker:

```text
/etc/tencorp-auth-gateway/public-gate-enabled
tencorp-auth-gate-v1
```

When the marker is absent, the existing open-site public 2xx checks remain in
force. An unsupported marker, missing fixture, unsafe owner/mode, or malformed
token fails before release work begins. Gated mode requires
`/etc/tencorp-auth-gateway/deploy-smoke-session`, owned by root with mode `0600`,
containing only the 43-character opaque value of an
`__Host-tencorp_session` cookie and one trailing newline. Never put the cookie
in argv, an environment variable, logs, source, or a systemd unit. The deployer
copies it into a mode-`0600` curl config under `/run`, uses only that filename,
and removes the temporary config and `/__auth/me` response on every exit.

Provision this persistent fixture with a dedicated smoke Telegram account
through the real OIDC flow. The default session has a fixed 30-day lifetime; it
does not refresh on use. Record its `sessionExpiresAt`, monitor it, and replace
the fixture well before expiry. Because every automated gated deployment needs
the fixture, the deployer deliberately does not call logout or delete the
stored token after each run. If the file or token may have leaked, revoke that
account's sessions with `POST /__auth/logout-all`, remove the fixture, and
provision a new session before further deployments.

Use the reviewed enrollment helper while the public site is still in bootstrap
mode and the fixture does not yet exist:

```bash
automation/deploy/test-enroll-tencorp-auth-smoke.sh
sudo automation/deploy/enroll-tencorp-auth-smoke.sh
```

The root script asks, without echoing, for the numeric Telegram ID of the
dedicated smoke account and prints a single-use enrollment URL. Open that URL
in a private browser with no existing TENCORP session, finish Telegram login as
that exact account, and share the verified phone when Telegram asks. The script
holds the Residence deployment lock, runs the one-shot capture helper as
`tencorp-auth-gateway`, and limits the enrollment window to 30 minutes. It
temporarily sends only the exact Telegram callback location to
`127.0.0.1:4341`; login, start, bot webhook, and every other auth route remain
on `127.0.0.1:4340`. On success, timeout, signal, or error it restores and
reloads the callback on `4340` before inspecting any captured credential. It
then verifies the file boundary, owner, mode, expected Telegram identity,
verified-phone flag, and public `/__auth/me` contract before installing the
fixture as `root:root` mode `0600`. It never enables or changes the public gate
marker, never overwrites an existing fixture, and never prints the session or
identity response.

Authenticated checks prove all 31 direct/root routes and an exact framework
asset return 2xx, the protected catalog API returns JSON, and `/__auth/me`
contains a Telegram identity plus `phoneNumberVerified: true` without exposing
the phone number, profile-photo URL, or internal database ID to browser code.
They also prove the self-contained `/__auth/account` page exposes both sign-out controls. As a
separate one-time acceptance test, use a disposable human session to prove both
logout endpoints invalidate cookies; never use the persistent deployment
fixture for that test.
Production automation must not manufacture a database session or an untracked
permanent user.

Install the auth-aware deployer while the marker is absent. With only the rate
limits and `tencorp-auth-gateway.conf` wired into Nginx, render the complete
configuration, run `nginx -t`, reload, and prove that `/__auth/login` and the
OIDC start/callback route are reachable while an ordinary site route remains
open. Complete the real OIDC flow through that public bootstrap route and
provision the fixture. Then stage the complete gated Nginx edit, including
`tencorp-auth-gate.conf` and every location classification, and run `nginx -t`
again. Finally hold
`/run/lock/residence-root-deploy.lock` while reloading the reviewed gated Nginx
configuration and atomically installing the marker. This avoids a deploy
starting in open-site mode after the public gate is live. Run
`test-auth-gateway-deployment.sh` before this cutover and the complete live
smoke contract immediately afterward. Do not enable the marker or gate if that
test fails.

Before reload, render the complete configuration and inspect the diff, then run
`nginx -t`. Install every snippet before referencing it. Reload atomically and
run the full contract. If any exception, operator boundary, or authenticated
route differs, restore the previous Nginx config and reload; the gateway service
and database can remain in place while the routing issue is investigated.
