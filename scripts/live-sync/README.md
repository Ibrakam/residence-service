# Residence live catalogue collectors

These adapters capture complete, current unit catalogues for the 20 Residence
projects without changing any source CRM. They publish only full
`*-catalog.json` files (plus `avalon-units.json`); an authentication, schema,
pagination, identity, or count uncertainty makes the command exit non-zero.

## Verified source contracts (2026-09-03)

| Adapter | Projects | Read-only upstream contract | Verified result |
| --- | --- | --- | --- |
| `kayan` | Mirador, Ofiyat | Authorized Profitbase OOPIF, exact `GET https://pb21432.profitbase.ru/api/v4/json/property`; allowed query keys are `houseId`, `returnFilteredCount`, `showQueueCount`; house IDs `154813`, `153505`, `153506`, `154273` | Mirador 209; Ofiyat apartments/parking 585; every response satisfied `properties.length === filteredCount` |
| `uysot` | Avalon Residence | Authorized showroom; exact read-only `POST https://service.app.uysot.uz/v1/smart-catalog/table`, body keys `page,size,orders,houseId`, forced to page 1/size 500/house 1074 | 268 unique units, declared 268, one page, buildings A/B1/B2 |
| `mbc` | Regnum Plaza, C1, Soy Bo‘yi, Saadiyat | Public read-only `POST https://mbc.uz/api/plans`; each project uses the exact URL-encoded keys `project={1\|2\|3\|18}&type={residential\|commercial}&page=N` | Every project/category must provide all declared pages; published rows must be `AVAILABLE residential` with unique public and CRM IDs; all four established artifacts publish atomically |
| `mbc-sarbon` | SARBON | The same public read-only MBC endpoint and exact body contract, restricted to `project=21&type={residential\|commercial}&page=N` | A complete SARBON-only candidate; failure or an empty feed cannot block the established four-project MBC transaction |
| `sun` | SUN | Public `GET /estate/embedjs/`, `GET /estate/request/get_request_url/`, then read-only `POST https://api.macroserver.uz/estate/catalog/` action `objects_list` | Pages 0–10 contain 336 overlapping rows and exactly 306 stable unique IDs: 51 available, 41 reserved, 214 sold |
| `nrg-bi` | 4U, Bayterak, Botanika Saroyi, Flagman, Jomiy, Maftun Makon, Meros, Sado, Voha, Yangibaxt, Zamon | Public read-only `POST https://apigw.bi.group/sales-picker/microfe-v3/placementList` and `/realEstateList`; 4U additionally uses exact anonymous `/placement` detail lookups and exact `GET` requests to its unit-bound `s3.bi.group/crm-clients-e1csales/layouts/` assets. Apartment type and project UUID are allowlisted; page size is capped at 300 and pagination must reach an empty page | Current 4U apartment coverage is 176/176 active rows. Every 4U suffixless detail original and `_1600`/`_400`/`_200` variant is fetched, MIME-sniffed, dimension/byte checked, hashed, and bound to the same block/unit/number before publication. Other project counts remain capture-derived. |

`alemica` is intentionally discovery-only. Its catalogue gateway routes are
known, but no unambiguous Residence project-to-real-estate mapping has been
verified. Its wrapper therefore fails closed instead of publishing stale or
misattributed data. The eleven applicable projects above use the evidenced
public BI sales-picker source.

## Safety boundary

- Browser collection attaches only to a loopback CDP endpoint.
- Uysot may run its own exact, queryless Vercel browser checkpoint POST before
  loading the showroom. That request is passed through unchanged, while its
  opaque body and response are never read, logged, rewritten, or persisted.
  Interactive checkpoints are never solved by the collector and require the
  operator to complete them in the existing browser session.
- Kayan and Uysot reuse server-side persistent Chrome profiles. No collector
  calls cookie, request-header, Storage, localStorage, or sessionStorage APIs.
- Every browser request is checked against an exact host/path/method/query-key
  allowlist. Mutating methods are blocked. Uysot has one exact read-only POST
  exception whose request is constrained to house 1074.
- MBC, SUN, and NRG use fixed read-only query bodies and no credentials. The
  `mbc` run owns Regnum Plaza, C1, Soy Bo‘yi, and Saadiyat together; an invalid
  row or incomplete pagination prevents all four established artifacts from
  being published. `mbc-sarbon` reuses the exact guarded MBC transport and
  normalizer but owns only SARBON, isolating both transactions. HTTP 429 retries
  honor the source's bounded `Retry-After` window without accepting a partial
  candidate.
- `mbc-sarbon` uses the coordinator's current positive floor at
  `minimumRecords: 1`. A legitimate zero-AVAILABLE sold-out feed therefore
  fails only this isolated provider and preserves its last-known-good catalogue;
  authoritative zero support needs a separately reviewed coordinator contract.
- 4U publishes a plan URL only when both the 3,000px-or-larger suffixless PNG
  original and its 1,600px JPEG card preview pass exact identity, origin, MIME,
  dimensions, byte-size, and body-hash checks. The `.png` suffix on list
  variants is not trusted: current bytes are JPEG. Invalid current assets are
  omitted so the importer's `COALESCE(NULLIF(...), plan_image_url)` keeps the
  last-known-good URL. The raw image bodies are never stored in Git or capture
  evidence. A mode-0600 audit cache at
  `<LIVE_SYNC_CAPTURE_DIR>/nrg-bi/plan-assets-cache.json` reuses only complete
  records whose exact block UUID, unit UUID, number, and four immutable asset
  URLs still match `placementList`. Consequently a normal five-minute run does
  no detail or image requests; only new, changed, or previously invalid units
  repeat their one detail request and four asset downloads.
- MBC's public response `id` is retained only as provenance because it changes
  when the listing set changes. Stable unit matching uses `crm_id`, but raw CRM
  IDs are never embedded in public `sourceKey` values. Existing template keys
  are retained by CRM ID (or Regnum's exact unambiguous public-fact tuple); a
  previously unseen row gets a deterministic, project-namespaced SHA-256 key.
  Templates that predate explicit keys retain the backend importer's historical
  opaque key so an upgrade does not break saved lead/unit references.
- SUN's short-lived signed catalogue URL exists only in memory. It is never
  logged or written. Request bodies and headers are never written.
- Response JSON is sanitized before evidence is written; capability links,
  personal notes, credential-like fields, JWTs, and bearer values are removed.
- Capture directories and files are mode 0700/0600. Evidence run directories
  and catalogue files are published with atomic rename.
- Evidence retention is bounded per provider: the current run is never removed;
  within 24 hours the collector retains at most 12 successful and 3 failed
  runs, subject to a 256 MiB cap. A 15-minute grace protects concurrent
  publishers, and `.staging-*` directories are never cleanup candidates.
  A run is successful only when an error-free normalization writes its small
  `success.json` marker; partial/error evidence is counted against the failed
  run allowance.

Uysot Chrome must be started with `--enable-unsafe-swiftshader`; this is also
declared in `providers.mjs`. Both CDP listeners must remain loopback-only:

```text
main/Kayan: 127.0.0.1:9222
Uysot:      127.0.0.1:9223
```

## Commands

From this directory:

```sh
npm run check
npm test
node src/cli.mjs status
```

A non-publishing live capture writes atomic evidence, completeness metadata,
and a candidate artifact under a new run directory:

```sh
node src/cli.mjs capture --provider mbc --output /tmp/residence-captures
node src/cli.mjs capture --provider mbc-sarbon --output /tmp/residence-captures
node src/cli.mjs capture --provider sun --output /tmp/residence-captures
node src/cli.mjs capture --provider nrg-bi --output /tmp/residence-captures
node src/cli.mjs capture --provider kayan --cdp http://127.0.0.1:9222 --output /tmp/residence-captures
node src/cli.mjs capture --provider uysot --cdp http://127.0.0.1:9223 --output /tmp/residence-captures
```

Revalidate an existing capture without writing a catalogue:

```sh
node src/cli.mjs dry-run --provider kayan --input /tmp/residence-captures/kayan/RUN_ID
node src/cli.mjs dry-run --provider uysot --input /tmp/residence-captures/uysot/RUN_ID
node src/cli.mjs dry-run --provider mbc --input /tmp/residence-captures/mbc/RUN_ID
node src/cli.mjs dry-run --provider mbc-sarbon --input /tmp/residence-captures/mbc-sarbon/RUN_ID
node src/cli.mjs dry-run --provider nrg-bi --input /tmp/residence-captures/nrg-bi/RUN_ID
```

Production wrappers require a fresh output directory supplied by the caller:

```sh
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-mbc
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-mbc-sarbon
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-human2human
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-nrg-bi
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-kayan
CATALOG_OUTPUT_DIR=/run/residence-sync/catalogs bin/capture-uysot
```

Seed the first production 4U plan audit from the reviewed, sanitized snapshot
before enabling the five-minute NRG timer. The owner must be the account that
runs `capture-nrg-bi`; later successful runs replace this file atomically:

```sh
install -d -o residence-catalog-sync -g residence-catalog-sync -m 0700 \
  /var/lib/residence-live-sync/captures/nrg-bi
install -o residence-catalog-sync -g residence-catalog-sync -m 0600 \
  website/data/4u-plan-audit.json \
  /var/lib/residence-live-sync/captures/nrg-bi/plan-assets-cache.json
```

`npm --prefix website run verify:4u` proves that every cache row matches the
committed catalogue and that a bootstrap refresh reuses all rows without a
network request. If the seed is absent, corrupt, oversized, or mismatched, the
collector safely performs the full first audit instead of trusting it.

Optional environment variables are `LIVE_SYNC_CAPTURE_DIR`,
`LIVE_SYNC_CDP_KAYAN_URL`, and `LIVE_SYNC_CDP_UYSOT_URL`. MBC, SUN, and NRG do
not need CDP.

Kayan, SUN, and all five MBC projects deliberately require their public
artwork-enrichment templates; the collector fails before capture if one is
missing or malformed, so a standalone installation cannot silently erase
plans/layouts during sync. Package these seven files with the collector:

```text
/opt/residence-live-sync/templates/kayan-catalog.json
/opt/residence-live-sync/templates/regnum-plaza-client.json
/opt/residence-live-sync/templates/c1-catalog.json
/opt/residence-live-sync/templates/soy-boyi-catalog.json
/opt/residence-live-sync/templates/saadiyat-catalog.json
/opt/residence-live-sync/templates/sarbon-catalog.json
/opt/residence-live-sync/templates/sun-client.json
```

Their canonical repository sources are `website/data/kayan-catalog.json`, the
five matching MBC files under `website/data`, and `website/data/sun-client.json`.
Alternatively set `LIVE_SYNC_TEMPLATE_DIR` to a read-only directory containing
those filenames, or preserve `website/data` below the collector working
directory. These files contain public catalogue/artwork metadata; the packaging
security scan found no Telegram token, JWT, bearer value, or MacroCRM signed URL.
Retention can be tightened with `LIVE_SYNC_RETENTION_SUCCESSFUL_RUNS`,
`LIVE_SYNC_RETENTION_FAILED_RUNS`, `LIVE_SYNC_RETENTION_MAX_AGE_HOURS`,
`LIVE_SYNC_RETENTION_MAX_BYTES`, and
`LIVE_SYNC_RETENTION_RACE_GRACE_SECONDS`.

To verify the complete wrapper output against the backend importer:

```sh
cd backend
go run ./cmd/import-catalogs -dry-run -data-dir /run/residence-sync/catalogs
```

A combined run now produces exactly 19 catalog files for 20 projects. Record
counts are intentionally validated against each capture's official declaration
and the configured last-known-good baseline rather than frozen in this guide.
