# Pushkin: local implementation and deferred rollout

The user deferred all production writes on 2026-11-06: continue locally and
wait for a separate instruction to deploy. Do not publish, edit the running
services, enable timers, or modify the production home map before that message.

## Routes and presentation

- `/pushkin?lang=ru|uz|en`: project landing page.
- `/pushkin/apartments?lang=ru|uz|en`: shared cards, availability grid, filters,
  exact plans and apartment enquiries.
- `/privacy?project=pushkin&lang=ru|uz|en`: project-aware privacy page.
- `/api/pushkin-catalog`: server-side current public Taqsim generation.
- `/pushkin/plans/<source-url-hash>.png`: initial local derivatives and a bounded,
  fixed-origin fallback for newly published plans.

The design follows the existing TenCorp Prata/Golos typography, cream paper,
dark green surfaces and a burgundy accent. The page is a classic architectural
hero followed by the project, amenities, a large benefit statement, gallery,
plan examples, payment options, three purchase steps, location, documents,
six FAQs and a final enquiry. The primary action is choosing an apartment;
all enquiry purposes use the shared TenCorp form. There are no invented reviews.
The hero describes Pushkin as a club residence near Pushkin metro. Benefits
cover the underground parking, play/sports areas, balconies and neighbourhood.
Metadata, language alternates, sitemap and the shared construction-passport
registry include Pushkin. A government passport is shown only if the existing
backend has a verified linkage; the Taqsim PDF is labelled by its actual source.

## Evidence and data semantics

Sources reviewed on 2026-11-06 (Asia/Tashkent):

- https://pushkin-place.uz/
- https://estate.taqsim.uz/complex/pushkin-klubnyy-dom

Taqsim publishes the class as Business, one house record with sections А/Б,
16 floors and Q4 2027. The developer site describes two blocks and calls the
project Premium. The page uses Business and does not conflate the source's
available listings with the project's total apartment count. The 3.1 metre
ceiling height and approximate 500 metres to metro are attributed to the
developer. Renderings are explicitly labelled visualisations.

The initial complete source generation has 131 available apartments, 48 unique
plan sources, and room partitions of 5 / 85 / 41 for 2 / 3 / 4 rooms. Apartment
numbers repeat across sections, so source UUIDs and section labels are retained.
Local plan derivatives preserve the whole image, with a maximum width of 2000
pixels. No floor polygons, reservations or sold apartments are fabricated.

The public complex response caps returned rows at 100 even when `size=200`.
`scripts/live-sync/src/taqsim.mjs` partitions by room count, and by floor if a
room partition is capped. It validates project/house UUIDs, statuses, plan source
paths, total/price-per-metre agreement, partition totals and the complete unique
apartment universe. A partial generation never overwrites the accepted file.
The final live check found one apartment changed to `in_work`: the public total
was still 131 but only 130 were available. The collector reconciles all source
identities before excluding `in_work`; `sourceTotal` and `sourceUnavailable`
record that distinction. Unknown statuses still reject the generation for review.
The capture includes `officialTotalAtCapture`, which the existing Go importer
understands, and stable keys `taqsim:pushkin:<uuid>`.

`price` is the published apartment price. `financingPriceFrom`, `monthlyFrom`
and `minPrepayFrom` remain separate fields. No bank quote or interest-free
payment calculation is invented. The source remains the authority for prices.
Server requests are coalesced and cached for three minutes per frontend worker;
failures back off for 30 seconds. The client clears unverified availability
and offers retry instead of presenting an embedded snapshot as live stock.

## Lead contract

Both landing and catalogue forms use the existing `/v1/leads` proxy, the
`residence-v1` contract and `projectSlug=pushkin`. Catalogue enquiries include
the stable `unitKey`; language, consent and advertising attribution are kept.
The phone link is the canonical TenCorp contact, +998 78 113 77 12. No enquiry
is submitted to the original developer or to Taqsim.

The proxy is tested with an ephemeral local mock sink. This does **not** verify
delivery to production amoCRM. The existing production sink must recognize
Pushkin and its unit references before rollout is reported complete.

## Production steps after the user's deployment instruction

1. Re-establish verified SSH access. Both known IPv4/IPv6 SSH and the public
   hostname were unreachable during local implementation. Read the actual
   active release/configuration and preserve rollback copies.
2. Install the reviewed collector and executable `bin/capture-taqsim` in the
   active immutable live-sync package. Merge `scripts/live-sync/deploy/taqsim-provider.json`
   as one additional provider in the **actual** catalogue-sync configuration;
   preserve all existing providers and policies. Do not replace it with an
   example configuration. Run a validated import before enabling its existing
   `residence-catalog-sync@taqsim.timer` template.
3. Deploy the backend project-registry addition if needed. Confirm that Pushkin
   exists in the catalogue database, has complete fresh units, and resolves the
   exact unit keys passed to the existing TenCorp amoCRM sink. Inspect/update
   that sink's existing project mapping, without changing its credentials.
4. Add the project to the real home-page map/list using
   `website/data/pushkin-map.json`. This file is a reviewed entry, **not** an
   assertion that the separate server-hosted home-map implementation has been
   edited. Inspect its current source contract before applying the entry. The
   user-specified coordinates are `[41.3213055556, 69.3153611111]` (latitude,
   longitude), slightly different from Taqsim's longitude. Keep every existing
   project, selection, map authorisation and pan/zoom behaviour.
5. Extend the existing authentication routes to Pushkin and its media/API with
   the same policy as other sales sites. Preserve the public root page and the
   authorised map loader. Validate Nginx before reloading it.
6. Use the normal reviewed root-release deployment and authenticated/guest
   smoke checks. Its project list now includes Pushkin. Verify all three
   languages, current catalogue, exact plans, existing pages, and the real
   amoCRM acknowledgement using the installation's approved test mechanism.
7. Upgrade the existing notification service to include the `taqsim` provider
   label only after the new provider has a successful fresh health record.
   Keep its verified private Telegram recipient and existing credentials.

No production write or deployment was performed during this local task.

## Local verification on 2026-11-06

- Node 22 production build and every configured prebuild contract passed;
  TypeScript completed without errors.
- All 62 live-sync tests passed, including the transition from available to
  `in_work`. Go Pushkin import, workspace counts and project-registry checks passed.
  The full importer suite still depends on private KAYAN raw fixtures absent
  from this clean checkout, so no full-suite pass is claimed.
- Local HTTP checks passed for all six landing/catalogue language routes,
  project privacy, a real PNG plan, an unknown-plan 404 and current live data.
  The final response reconciled 131 source records with 130 available offers.
- Browser checks covered RU/UZ/EN, 320/375 px layouts, section filtering,
  apartment identities, complete plan enlargement, gallery, payment tabs,
  keyboard navigation and empty-form validation. No real lead was sent.
- Pushkin enquiries show Business / Q4 2027 / Olmachi 21. Shared forms no
  longer inherit Avalon-specific location and completion facts for other projects.
- Browser screenshots are in the main workspace at
  `audit-reports/2026-11-06-pushkin/` (`desktop.png`, `mobile-uz.png`,
  `catalog.png`, `exact-plan.png`). The loopback preview runs on port 4176.

The large frontend bundle warning is pre-existing in the shared application;
it is not evidence of a failed build. Real amoCRM delivery, server authentication,
the production map insertion and the scheduled provider remain rollout checks.
