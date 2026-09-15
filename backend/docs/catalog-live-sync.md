# Continuous catalog synchronization

`cmd/sync-catalogs` coordinates provider-specific capture wrappers and the
existing PostgreSQL catalog importer. It is a one-shot command designed for a
systemd timer. The coordinator never reads login forms itself: each wrapper
uses its own already enrolled server-browser profile and writes a complete
catalog into the directory supplied in `CATALOG_OUTPUT_DIR`.

## Safety contract

- Each provider has an independent PostgreSQL advisory lock. An overlapping
  timer invocation exits as `skipped` instead of starting a second browser.
- Capture runs in a new private staging directory with a configured timeout.
  The process group is killed on timeout. Its stdout and stderr are discarded,
  so an upstream page or wrapper cannot put cookies or tokens in service logs.
- The capture child receives only a small browser/runtime environment allowlist.
  In particular, `DATABASE_URL`, Telegram variables, and unrelated service
  secrets are not inherited.
- Symbolic links, special files, more than 1,024 output files, and more than
  512 MiB of output are rejected before parsing.
- The candidate must contain exactly the configured projects. Every project
  must be a complete catalog, meet its explicit first-run record floor, not be
  older than its freshness window or its last accepted capture, and not lose
  more rows than the configured percentage. An official source count, when
  present, is also enforced.
- Deactivation, upserts, provenance, the successful run marker, and provider /
  project health are committed in one PostgreSQL transaction. A capture,
  validation, guard, or import failure leaves the last accepted catalog active.
- The importer also rejects a project timestamp older than the currently stored
  rows, so a legacy bootstrap import cannot silently overwrite newer live data.
- Public health returns stable error codes only; command output and raw database
  errors are never exposed.

The tracked `catalog-sync.example.json` contains initial project ownership and
conservative safety floors. Review those floors against the first complete CRM
capture before installing it. Lowering a floor or increasing the allowed drop
is an explicit operator decision, not an automatic recovery action.

MBC coordinator floors now cover the full residential lifecycle rather than the
old AVAILABLE-only public feed: Regnum Plaza 700, C1 220, Soy Bo‘yi 950,
Saadiyat 460, and SARBON 175. The browser normalizer enforces the same floors
before the coordinator sees a candidate. These values remain deliberately below
the reviewed 2026-09-15 live totals, so normal inventory movement is accepted
while a partial house snapshot cannot pass. The browser normalizer additionally
enforces a positive reviewed floor for each of the ten residential houses,
preventing one missing queue from being masked by the rest of its project.

## Capture wrapper contract

The configured command is executed directly, without a shell. Its executable
path and optional working directory must be absolute. It receives:

```text
CATALOG_OUTPUT_DIR=/var/lib/residence-catalog-sync/.provider-random/data
CATALOG_PROVIDER=provider-name
TMPDIR=/var/lib/residence-catalog-sync/.provider-random/tmp
```

The coordinator also forwards only the explicitly supported loopback collector
settings (`LIVE_SYNC_CAPTURE_DIR` and provider-specific `LIVE_SYNC_CDP_*_URL`).
It does not forward the rest of the service environment. CDP listeners must
remain bound to loopback; never publish a browser debugging port.

It must exit non-zero on expired authentication, CAPTCHA, incomplete pagination,
network failure, or parsing uncertainty. On success it writes one or more files
accepted by the existing importer (`*-catalog.json` or `avalon-units.json`) to
`CATALOG_OUTPUT_DIR`. A provider must not copy browser profiles, cookies,
responses containing credentials, or debugging traces into that directory.
Files ending in `*-client.json` are intentionally treated as partial and are
rejected by live synchronization.

For Kayan, one invocation must output both `mirador` and `ofiyat`; they commit
together. MBC attaches to the already-authorized smart-catalog OOPIF on the same
loopback CDP listener and reads only exact GET responses from Profitbase tenant
host `pb12218.profitbase.ru`. The collector first visits the project overview to
capture projects, the complete house universe, and custom statuses, then visits
each allowlisted house. The normal unattended target selector accepts only one
of the ten reviewed MBC house paths. After a browser restart, the unit also opens
the exact authorized MBC applications page; if the catalogue iframe is absent,
the collector clicks its single `Витрина объектов` button and waits for the
new iframe. Chrome creates that OOPIF with an empty target URL, so the paused
child is matched by asking the outer DOM only for a boolean exact tag/origin/path
proof; the iframe URL and its opaque query never leave the browser. Request
interception is armed before the click and before the child resumes. Storage,
cookies, and headers are never read. Because an unrelated
overview path does not identify a tenant, it remains selectable only by an
explicit target ID outside this guarded bootstrap. After a successful run, the
iframe remains on an allowlisted MBC house path.

The established `mbc` invocation outputs Regnum Plaza, C1, Soy Bo‘yi, and
Saadiyat as one atomic candidate from nine houses. `mbc-sarbon` uses the same
read-only browser contract but owns only SARBON house 164684, so its outage or
schema drift cannot freeze the four established projects. Both wrappers share
an exclusive browser lock, preventing their independent timers from navigating
the same authorized iframe concurrently. Only
`typePurpose=residential` rows are apartments; this intentionally retains
residential penthouses and duplexes while excluding parking, storage, and
commercial stock. The Profitbase property ID is stable CRM provenance: the
public `sourceKey` retains an existing template identity when available,
otherwise it is a deterministic project-namespaced SHA-256 value that does not
contain the raw ID.

Every property `customStatusId` must resolve to the same explicit `baseStatus`
carried by the property. `AVAILABLE`, `BOOKED`, `SOLD`, `UNAVAILABLE`,
`EXECUTION`, and `UNKNOWN` are retained as raw lifecycle evidence and normalized
to the backend's four status buckets. A missing row is never interpreted as a
sale. Profitbase provides no historical sale timestamp, so a baseline SOLD row
adds only an immutable all-time known-sold fact; only a later accepted explicit
transition into SOLD enters the forward monthly sales ledger.
Production ownership is Kayan → Mirador/Ofiyat, MBC → Regnum Plaza/C1/Soy
Bo‘yi/Saadiyat, MBC SARBON → SARBON, Uysot → Avalon Residence, Human2Human → SUN, and NRG/BI → 4U, Bayterak,
Botanika Saroyi, Flagman, Jomiy, Maftun Makon, Meros, Sad'O, Voha, Yangi Baxt,
and Zamon. These six provider entries cover all 20 projects. Alemica remains a
discovery-only source until its authenticated identifiers and schema are mapped;
its wrapper must fail closed and it is deliberately absent from the runnable
configuration.

For 4U, the NRG wrapper performs anonymous, read-only placement-detail lookups
and validates the exact unit-bound S3 original plus its 1,600/400/200 variants.
It sniffs image bytes instead of trusting the `.png` filename (the list
variants currently contain JPEG), checks dimensions, size, and SHA-256, and
persists only audit metadata and the suffixless original URL. The website uses
the 1,600px derivative for cards and the original for the plan dialog. If a
new original or card preview fails validation, normalization emits no new plan
URL and the existing unit upsert retains `units.plan_image_url` as its
last-known-good value. The collector atomically persists the sanitized audit in
its private capture directory. Later runs reuse a row only while its complete
validated record remains exactly bound to the same block/unit/number asset
identity, so unchanged runs add zero plan-detail requests and zero image bytes;
new, changed, or previously invalid rows alone are re-audited.

## Build and preflight (no deployment)

From `backend/`:

```bash
go test ./...
go vet ./...
go build -trimpath -o /tmp/residence-catalog-sync ./cmd/sync-catalogs
/tmp/residence-catalog-sync -config ./catalog-sync.example.json -check-config
```

`-check-config` does not connect to PostgreSQL and does not execute a capture.
After the server-only configuration and wrappers are installed, validate a
single provider without changing PostgreSQL catalog data or sync status:

```bash
/usr/local/bin/residence-catalog-sync \
  -config /etc/residence-catalog-sync/config.json \
  -provider kayan \
  -dry-run
```

The dry run still accesses the provider and PostgreSQL read-only to compare the
candidate with the last accepted baseline. Its stdout is machine-readable JSON.

## Installation outline

These are release steps for an operator; the repository does not run them
automatically.

1. From `/var/www/residence-service/current/backend`, build
   `./cmd/sync-catalogs` and install it as
   `/usr/local/bin/residence-catalog-sync`.
2. Create an unprivileged `residence-catalog-sync` account. Create
   `/var/lib/residence-catalog-sync` mode `0700`, owned by that account.
3. Install reviewed capture wrappers under `/opt/residence-live-sync`. On a
   fresh host, install the complete tracked browser stack from
   `scripts/live-sync/deploy/systemd/`: `residence-live-display.service`,
   `residence-live-openbox.service`, `residence-live-browser-main.service`,
   `residence-live-vnc.service`, and `residence-live-novnc.service`. On an
   already provisioned Kayan host, replace at least the updated
   `residence-live-browser-main.service`. Run `systemctl daemon-reload` and
   restart that browser unit during a planned maintenance window. The unit opens both the Kayan agent and the exact
   `https://partners.mbc.uz/cabinet/applications` page on every fresh browser
   start. Use the private VNC endpoint once to sign in to both accounts in the
   dedicated `residence-crm-browser` profile; never place those credentials in
   the sync configuration. Before enabling MBC timers, confirm that the MBC
   account page exposes exactly one `Витрина объектов` control and that opening
   it produces an allowlisted smart-catalog iframe. Then
   create `/var/lib/residence-live-sync/captures` mode `0700`; grant the service
   account access only to these paths and the loopback browser debugging ports.
   Before enabling the NRG timer, install the verified
   `website/data/4u-plan-audit.json` as mode-`0600`
   `/var/lib/residence-live-sync/captures/nrg-bi/plan-assets-cache.json`, owned
   by that service account. This avoids a 126+ MiB asset bootstrap during the
   first scheduled run; `npm --prefix website run verify:4u` checks schema,
   hashes, all 176 identities, and zero-request cache reuse.
4. Install the reviewed JSON as `/etc/residence-catalog-sync/config.json` and a
   root-owned mode-`0600` `runtime.env` containing `DATABASE_URL`. Never put the
   database URL or CRM credentials in Git or shell command arguments. Keep at
   least three PostgreSQL pool connections (the default is sufficient): one
   holds the provider lock, another performs the atomic import, and a third can
   persist a sanitized failure status before the failed transaction unwinds. The tracked
   `deploy/residence-catalog-sync.runtime.env.example` lists the non-secret,
   loopback-only collector settings; the CLI refuses to use the development
   database fallback when `DATABASE_URL` is absent.
5. Apply migration `0015_catalog_provider_sync.sql` through the normal backend
   release migration step.
6. Copy the tracked `residence-catalog-sync@.service` and `.timer` to
   `/etc/systemd/system`, run `systemctl daemon-reload`, then run `-check-config`
   and a `-dry-run` for every provider.
7. Only after all dry runs pass, enable the reviewed instances, for example:

```bash
systemctl enable --now residence-catalog-sync@kayan.timer
systemctl enable --now residence-catalog-sync@mbc.timer
systemctl enable --now residence-catalog-sync@mbc-sarbon.timer
systemctl enable --now residence-catalog-sync@uysot.timer
systemctl enable --now residence-catalog-sync@human2human.timer
systemctl enable --now residence-catalog-sync@nrg-bi.timer
```

Keep `IMPORT_ON_START=false` for the API after live synchronization is enabled.
The versioned importer remains available for an explicit recovery operation and
its timestamp guard prevents an older recovery artifact from replacing newer
rows.

## Health and operations

`GET /v1/sync/catalog-status` returns provider and project entries with:

- `status`: latest attempt (`running`, `succeeded`, or `failed`);
- `lastAttemptAt` and `lastSuccessAt`;
- `lastCapturedAt` and `recordCount` for projects;
- `freshness`: `fresh` until `freshUntil`, otherwise `stale`. `freshUntil` is
  based on the source capture time (the oldest project for provider status),
  not merely on when the import command finished;
- `errorCode`: a non-secret stable code such as `capture_timeout`,
  `candidate_invalid`, or `completeness_guard_failed`.

A failed attempt can still report `fresh` while the last-known-good data is
inside its freshness window. Alert on `freshness=stale`; investigate the
machine error code and the provider wrapper privately. Do not weaken a guard or
delete the last successful data as an automatic response.
