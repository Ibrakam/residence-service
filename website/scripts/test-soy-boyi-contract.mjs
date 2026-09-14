import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  soyBoyiPublicPreview,
  soyBoyiPublicSnapshot,
} from "../data/soy-boyi-public.mjs";

const root = process.cwd();
const fail = (message) => {
  throw new Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (relative) => readFile(path.join(root, relative), "utf8");
const bytes = (relative) =>
  readFile(path.join(root, relative.replace(/^\//, "")));
const exactKeys = (value, expected, label) => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    fail(`${label} keys changed: ${actual.join(", ")}`);
};

const [
  catalogText,
  catalogue,
  landing,
  landingPage,
  catalogPage,
  landingCss,
  catalogueCss,
  proxy,
  privacy,
  packageText,
  mediaText,
  planManifestText,
  importerText,
  vite,
] = await Promise.all([
  read("data/soy-boyi-catalog.json"),
  read("app/soy-boyi/apartments/soy-boyi-catalog.tsx"),
  read("app/soy-boyi/soy-boyi-page.tsx"),
  read("app/soy-boyi/page.tsx"),
  read("app/soy-boyi/apartments/page.tsx"),
  read("app/soy-boyi/soy-boyi.css"),
  read("app/soy-boyi/apartments/soy-boyi-catalog.css"),
  read("proxy.ts"),
  read("app/privacy/page.tsx"),
  read("package.json"),
  read("data/soy-boyi-media-manifest.json"),
  read("data/soy-boyi-catalog-manifest.json"),
  read("../backend/internal/importer/catalog.go"),
  read("vite.config.ts"),
]);
const snapshot = JSON.parse(catalogText);
const media = JSON.parse(mediaText);
const planManifest = JSON.parse(planManifestText);

if (snapshot.availableResidentialTotal !== 209 || snapshot.units.length !== 209)
  fail("Expected the stable 209-unit residential snapshot.");
if (
  snapshot.excludedCommercial !== 5 ||
  snapshot.planCount !== 207 ||
  snapshot.missingPlanCount !== 2
)
  fail(
    "Expected 5 excluded commercial entries, 207 plans and 2 missing plans.",
  );
if (
  snapshot.units.some(
    (unit) =>
      unit.status !== "AVAILABLE" || unit.priceVisibility !== "request-only",
  )
)
  fail("Unexpected status or public price visibility.");
if (
  snapshot.units.some(
    (unit) => Object.hasOwn(unit, "price") || Object.hasOwn(unit, "crmPrice"),
  )
)
  fail("A hidden numeric price entered the catalogue snapshot.");
if (snapshot.units.filter((unit) => unit.rooms === 0).length !== 3)
  fail("The three rooms=0 omission rows changed.");
if (
  snapshot.units.filter(
    (unit) => unit.plan === null && unit.planStatus === "missing-at-source",
  ).length !== 2
)
  fail("Missing plans are not represented explicitly.");
if (
  new Set(snapshot.units.map((unit) => unit.id)).size !==
    snapshot.units.length ||
  new Set(snapshot.units.map((unit) => unit.unitKey)).size !==
    snapshot.units.length
)
  fail("Public unit identity is not unique.");
if (
  snapshot.units.some(
    (unit) => unit.sourceKey !== unit.unitKey || !unit.sourceKey,
  )
)
  fail("Server sourceKey must exactly match the public unitKey.");
if (snapshot.project.developerSlug !== "murad-buildings")
  fail("Soy Bo‘yi must import under the Murad Buildings developer.");
if (
  snapshot.officialTotalAtCapture !== 209 ||
  snapshot.sourceCount !== 209 ||
  snapshot.source !== "https://mbc.uz/api/plans" ||
  snapshot.sourceLanding !== "https://mbc.uz/ru/project/soy-boyi"
)
  fail("Server snapshot lacks importer-recognized count/source metadata.");
if (
  !importerText.includes('firstString(values, "sourceKey")') ||
  !importerText.includes('sourceKey = "catalog:" + projectSlug')
)
  fail("Backend importer sourceKey contract changed; re-audit lead identity.");

const publicSnapshot = soyBoyiPublicSnapshot(snapshot);
const publicPreview = soyBoyiPublicPreview(snapshot, 3);
const publicUnitKeys = [
  "id",
  "unitKey",
  "sourceOrder",
  "number",
  "rooms",
  "area",
  "floor",
  "section",
  "phase",
  "completion",
  "status",
  "priceVisibility",
  "plan",
  "planStatus",
];
exactKeys(publicSnapshot.units[0], publicUnitKeys, "Public catalogue unit DTO");
publicPreview.forEach((unit, index) =>
  exactKeys(unit, publicUnitKeys, `Public landing unit DTO ${index + 1}`),
);
const serializedPublic = JSON.stringify({ publicSnapshot, publicPreview });
for (const forbidden of [
  "crmId",
  "sourceCreatedAt",
  "sourceUpdatedAt",
  "sourcePlanSha256",
  "sourceUrl",
  "sourceSha256",
  "sourceBytes",
  "sourceKey",
  "sourceLanding",
  "pricePerM2",
  '"price"',
]) {
  if (serializedPublic.includes(forbidden))
    fail(`Public DTO leaks ${forbidden}.`);
}
if (
  !landingPage.includes("soyBoyiPublicPreview(catalog, 3)") ||
  !catalogPage.includes("soyBoyiPublicSnapshot(catalog)")
)
  fail("Server routes do not use the executable DTO whitelist.");
if (
  !landingPage.includes("NEXT_PUBLIC_SITE_URL") ||
  !catalogPage.includes("NEXT_PUBLIC_SITE_URL") ||
  /const origin = ["']https:\/\/form\.tencorp\.uz/.test(
    `${landingPage}\n${catalogPage}`,
  )
)
  fail("Soy metadata and JSON-LD do not share the configured site origin.");
if (
  catalogPage.includes("unit.crmId") ||
  catalogPage.includes("identifier: unit.crmId")
)
  fail("JSON-LD exposes an internal CRM identifier.");

if (
  planManifest.counts.units !== 209 ||
  planManifest.counts.plans !== 207 ||
  planManifest.counts.missingPlans !== 2
)
  fail("Deploy-safe plan manifest counts changed.");
if (
  planManifest.snapshot.sha256 !== hash(catalogText) ||
  planManifest.snapshot.bytes !== Buffer.byteLength(catalogText)
)
  fail("Catalogue snapshot checksum is stale.");
const planByPath = new Map(
  planManifest.assets.map((item) => [item.localPath, item]),
);
for (const unit of snapshot.units) {
  if (!unit.plan) continue;
  const record = planByPath.get(unit.plan);
  if (!record) fail(`Plan manifest entry missing for ${unit.plan}.`);
  const buffer = await bytes(`public${unit.plan}`);
  if (
    record.bytes !== buffer.length ||
    record.sha256 !== hash(buffer) ||
    !path.basename(unit.plan).startsWith(record.sha256.slice(0, 16))
  )
    fail(`Plan integrity failed for ${unit.plan}.`);
}

const expectedMedia = {
  playground: "fe0df913-2f0c-4e07-a068-2f0841cd434b.webp",
  workout: "51406ebb-4cb8-4ad6-9f8a-75376b94cecf.webp",
  "summer-cinema": "0fbaab80-e4cb-4c64-a45f-bb11f3555548.webp",
  teahouse: "f3afcef3-8cd5-4107-ae7b-355fe432ede5.webp",
  "summer-pool": "2ac1f1a5-d747-4c28-9d8e-f82da44c3681.webp",
  bakery: "a47f0eb7-e172-4971-9404-207e2e370f19.webp",
  "guest-room": "bc2bff92-2abc-4132-a9df-47a120ce12b2.webp",
  playroom: "55769685-de84-4892-8152-722b07b6112a.webp",
};
if (media.assets.some((item) => item.name === "promenade"))
  fail("An amenity render is incorrectly named promenade.");
if (
  /sourceId|sourceUrl|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i.test(
    mediaText,
  )
)
  fail("Public media manifest leaks an upstream identifier or URL.");
for (const record of media.assets) {
  const buffer = await bytes(`public${record.localPath}`);
  if (
    buffer.length !== record.bytes ||
    hash(buffer) !== record.sha256 ||
    !path.basename(record.localPath).includes(record.sha256.slice(0, 12))
  )
    fail(`Media integrity failed for ${record.name}.`);
  if (record.mime === "image/webp") {
    const metadata = await sharp(buffer).metadata();
    if (
      metadata.format !== "webp" ||
      metadata.width !== record.width ||
      metadata.height !== record.height
    )
      fail(`Media dimensions or MIME changed for ${record.name}.`);
  }
}

const runtime = `${landing}\n${catalogue}\n${landingPage}\n${catalogPage}\n${landingCss}\n${catalogueCss}`;
if (
  /https?:\/\/(?:mbc\.uz|pb12218\.profitbase\.ru|fonts\.googleapis\.com|fonts\.gstatic\.com)/i.test(
    runtime,
  ) ||
  /@import\s+url/i.test(landingCss)
)
  fail("Runtime contains a forbidden remote asset request.");
if (
  /двор без машин|подземн(?:ый|ом) паркинг|автомобил(?:ей|и).*подзем|avtomobilsiz|yerosti parking|car-free|underground parking/i.test(
    runtime,
  )
)
  fail("Runtime contains an unsupported parking/car-free claim.");
if (/Студия|Studiya|Studio/.test(runtime))
  fail("rooms=0 is described as a studio.");
if (
  /Project (?:film|video) · CGI|Проектное видео · CGI|Loyiha videosi · CGI/.test(
    runtime,
  )
)
  fail("The official project video is incorrectly labelled CGI.");
if (
  !/chess:\s*["']Chessboard["']/.test(catalogue) ||
  !/\(\[["']cards["'],\s*["']chess["']\] as const\)/.test(catalogue) ||
  /chessPlus|floorPlan|Шахматка\+/.test(catalogue)
)
  fail("Catalogue modes violate the Cards + one Chessboard contract.");
if (
  !/id=\{`sbc-tab-\$\{item\}`\}/.test(catalogue) ||
  !/aria-controls=\{`sbc-panel-\$\{item\}`\}/.test(catalogue) ||
  !/id="sbc-panel-cards"[\s\S]{0,100}aria-labelledby="sbc-tab-cards"/.test(
    catalogue,
  ) ||
  !/id="sbc-panel-chess"[\s\S]{0,100}aria-labelledby="sbc-tab-chess"/.test(
    catalogue,
  )
)
  fail("Catalogue tabs and tabpanels are not linked bidirectionally.");
if (
  !/aria-label=\{t\.floor \+ ["'] ["'] \+ t\.from\}[\s\S]{0,120}value=\{floorFrom\}/.test(
    catalogue,
  ) ||
  !/aria-label=\{t\.floor \+ ["'] ["'] \+ t\.to\}[\s\S]{0,120}value=\{floorTo\}/.test(
    catalogue,
  ) ||
  !/aria-label=\{t\.area \+ ["'] ["'] \+ t\.from\}[\s\S]{0,120}value=\{areaFrom\}/.test(
    catalogue,
  ) ||
  !/aria-label=\{t\.area \+ ["'] ["'] \+ t\.to\}[\s\S]{0,120}value=\{areaTo\}/.test(
    catalogue,
  )
)
  fail("Range inputs lack distinct localized accessible names.");
if (
  !/role="dialog"[\s\S]{0,100}aria-modal="true"[\s\S]{0,100}aria-label=\{t\.menu\}/.test(
    landing,
  ) ||
  !/body\.style\.overflow = ["']hidden["']/.test(landing) ||
  !/returnFocus\?\.isConnected/.test(landing)
)
  fail("Mobile menu dialog lifecycle is incomplete.");
if (
  !landing.includes("const backgroundBlocked = Boolean(modalOpen || menu);") ||
  !/aria-hidden=\{backgroundBlocked \|\| undefined\}[\s\S]{0,100}inert=\{backgroundBlocked \? true : undefined\}/.test(
    landing,
  ) ||
  !/<a[\s\S]{0,80}className="soy-skip"[\s\S]{0,80}>\s*\{t\.skip\}\s*<\/a>\s*<header/.test(
    landing,
  )
)
  fail("Landing modal isolation does not include the skip link.");
if (!/useRef\(index\)/.test(landing) || /\[index, items\.length/.test(landing))
  fail("Gallery lifecycle reinitializes on slide changes.");
if (
  !landingCss.includes(".soy-motion-ready [data-soy-reveal]") ||
  /^\[data-soy-reveal\]\s*\{/m.test(landingCss) ||
  !landing.includes('root.classList.remove("soy-motion-ready")')
)
  fail(
    "Reveal animation is not progressively enhanced from visible SSR content.",
  );
if (!/role="status" aria-live="polite" aria-atomic="true"/.test(landing))
  fail("Gallery slide changes are not announced politely.");
if (
  !landing.includes('className="soy-video-toggle"') ||
  !landing.includes("prefers-reduced-motion: reduce") ||
  !landing.includes("video.pause()") ||
  /autoPlay/.test(landing) ||
  /aria-pressed=\{videoPlaying\}/.test(landing)
)
  fail("Hero video lacks a localized reduced-motion-safe play/pause control.");
if (
  !/const scrollbarWidth\s*=\s*window\.innerWidth\s*-\s*document\.documentElement\.clientWidth/.test(
    landing,
  ) ||
  !landing.includes("body.style.paddingRight = previousPaddingRight") ||
  !/const scrollbarWidth\s*=\s*window\.innerWidth\s*-\s*document\.documentElement\.clientWidth/.test(
    catalogue,
  ) ||
  !catalogue.includes("body.style.paddingRight = previousPaddingRight")
)
  fail("Custom overlays do not compensate and restore the scrollbar gutter.");
if (
  !/\.soy-header\.is-scrolled\s*\{[\s\S]{0,100}background:\s*rgba\(15,\s*54,\s*53,\s*0?\.96\)/.test(
    landingCss,
  )
)
  fail("Fixed header has no durable post-hero contrast state.");
if (
  !landing.includes('className="soy-rail-controls"') ||
  !landing.includes('event.key === "ArrowLeft"') ||
  !landing.includes("onPointerUp")
)
  fail("Landing rails need buttons, keyboard and touch controls.");
if (
  !landing.includes('window.matchMedia("(min-width: 1101px)")') ||
  !landing.includes("setMenu(null)")
)
  fail("Mobile menu does not close when the desktop breakpoint is crossed.");
if (
  !/overflow:\s*auto/.test(landingCss) ||
  !/max-height:\s*560px/.test(landingCss)
)
  fail("Landscape mobile menu is not height-safe.");
if (!/scroll-margin-top:\s*88px/.test(landingCss))
  fail("Fixed-header anchors lack scroll margin.");
if (
  !landing.includes("navigationTarget.current = item.id") ||
  !landing.includes("focus({ preventScroll: true })") ||
  ["story", "architecture", "amenities", "progress", "apartments"].some(
    (id) =>
      !new RegExp(`id="${id}"\\s+tabIndex=\\{-1\\}`).test(landing),
  )
)
  fail("Mobile anchor navigation does not move focus to its destination.");
if (
  !/URLSearchParams\(searchParams\.toString\(\)\)/.test(landing) ||
  !/URLSearchParams\(searchParams\.toString\(\)\)/.test(catalogue)
)
  fail("Internal links do not preserve tracking parameters.");
if (
  !/projectSlug="soy-boyi"/.test(landing) ||
  !/projectSlug="soy-boyi"/.test(catalogue) ||
  !/unitId=\{lead\.unit\?\.id\}/.test(`${landing}\n${catalogue}`) ||
  !/unitKey=\{lead\.unit\?\.unitKey\}/.test(`${landing}\n${catalogue}`)
)
  fail("Exact lead identity/context is incomplete.");
if (
  !/aria-label=\{t\.language\}/.test(landing) ||
  !/className="sbc-langs"[\s\S]{0,80}role="group"[\s\S]{0,80}aria-label=\{t\.language\}/.test(
    catalogue,
  ) ||
  !/className="soy-languages"[\s\S]{0,80}role="group"[\s\S]{0,80}aria-label=\{t\.language\}/.test(
    landing,
  )
)
  fail("Language selectors are not localized.");
if (
  !catalogue.includes("{t.skipResults}") ||
  !landing.includes("aria-label={t.footerNav}") ||
  !landing.includes("<nav aria-label={t.menu}>")
)
  fail("Localized navigation landmarks or catalogue skip link are incomplete.");
if (
  !/id="soy-main" tabIndex=\{-1\}/.test(landing) ||
  !/id="sbc-results" tabIndex=\{-1\}/.test(catalogue)
)
  fail("Skip-link targets are not programmatically focusable.");
if (
  !/aria-label=\{`\$\{t\.openDetails\}:[\s\S]{0,260}\$\{t\.phase\}/.test(
    catalogue,
  )
)
  fail("Apartment card accessible names omit key attributes.");
if (!/id="sbc-top"/.test(catalogue) || !/href="#sbc-top"/.test(catalogue))
  fail("Catalogue back-to-top link has no top target.");
if (
  !catalogue.includes("${t.price}: ${t.request}") ||
  !catalogue.includes("${formatArea(language, unit.area)} m²") ||
  !/id=\{`sbc-panel-\$\{mode\}`\}/.test(catalogue) ||
  !/id="sbc-panel-cards"[\s\S]{0,140}hidden/.test(catalogue) ||
  !/id="sbc-panel-chess"[\s\S]{0,140}hidden/.test(catalogue)
)
  fail("Card price naming or zero-results tab IDREF contract is incomplete.");
if (
  !privacy.includes("preserveSoyAttribution") ||
  !privacy.includes("utm_campaign") ||
  !privacy.includes("fbclid") ||
  !privacy.includes("tcid")
)
  fail("Soy privacy return links do not preserve attribution.");
if (
  !/function isSoyBoyiPrivatePath/.test(vite) ||
  !/["']\/source\/soy-boyi["']/.test(vite) ||
  !/["']\/data\/soy-boyi-catalog\.json["']/.test(vite) ||
  !/["']\/data\/soy-boyi-catalog-manifest\.json["']/.test(vite) ||
  !vite.includes("soy-boyi[^/]*(?:\\/|$)")
)
  fail("Vite dev guard does not deny Soy server-only data paths.");
if (
  !/'\/soy-boyi'/.test(proxy) ||
  !/'\/soy-boyi\/apartments'/.test(proxy) ||
  /'\/soy-boyi\/:path\*'/.test(proxy)
)
  fail("Proxy must match only the two Soy Bo‘yi document routes.");
if (
  !/["']soy-boyi["']:\s*\{[\s\S]{0,100}name:\s*["']SOY BO‘YI["'][\s\S]{0,100}path:\s*["']\/soy-boyi["']/.test(
    privacy,
  )
)
  fail("Privacy routing for Soy Bo‘yi is missing.");
if (
  !JSON.parse(packageText).scripts["verify:soy-boyi"] ||
  !JSON.parse(packageText).scripts.prebuild.includes("verify:soy-boyi")
)
  fail("Deploy-safe Soy Bo‘yi verification is not wired into prebuild.");
if (
  !/window\.matchMedia\(["']\(max-width: 850px\)["']\)[\s\S]{0,180}openModal\(["']detail["'], unit, opener\)/.test(
    catalogue,
  )
)
  fail(
    "Tablet/mobile chessboard selection does not open an immediate accessible drawer.",
  );
if (
  !/closeRef\.current\?\.focus\(\);[\s\S]{0,40}\}, \[state\.kind\]\)/.test(
    catalogue,
  )
)
  fail("Detail-to-plan transitions do not restore focus inside the modal.");
if (
  !/grid-template-columns:\s*minmax\(0,\s*1fr\) 360px/.test(catalogueCss) ||
  !/width:\s*360px/.test(catalogueCss)
)
  fail("Desktop detail width is outside the 320–390 px contract.");
if (
  !/\.sbc-filters\s*\{[\s\S]{0,180}max-height:\s*calc\(100vh - 118px\)[\s\S]{0,80}overflow-y:\s*auto/.test(
    catalogueCss,
  ) ||
  !/@media \(max-width: 850px\)[\s\S]{0,900}\.sbc-filters\s*\{[\s\S]{0,180}max-height:\s*none;[\s\S]{0,80}overflow:\s*visible/.test(
    catalogueCss,
  )
)
  fail("Sticky desktop filters are not viewport-scrollable or mobile-reset.");

if (process.argv.includes("--audit-capture")) {
  const capture = JSON.parse(
    await read("source/soy-boyi/capture-manifest.json"),
  );
  const checks = JSON.parse(await read("source/soy-boyi/result-checks.json"));
  const sourceMedia = JSON.parse(
    await read("source/soy-boyi/media-manifest.json"),
  );
  if (!capture.stable) fail("Capture is not stable.");
  const before = capture.counts.before,
    after = capture.counts.after,
    plans = capture.counts.plans;
  if (
    before.all !== 214 ||
    before.residential !== 209 ||
    before.commercial !== 5 ||
    JSON.stringify(before) !== JSON.stringify(after) ||
    plans.residential !== 209 ||
    plans.commercial !== 5
  )
    fail("Raw before/after reconciliation changed.");
  for (const record of capture.rawFiles) {
    const buffer = await readFile(
      path.join(root, "source", "soy-boyi", record.file),
    );
    if (buffer.length !== record.bytes || hash(buffer) !== record.sha256)
      fail(`Raw wrapper integrity failed for ${record.file}.`);
    const tampered = Buffer.concat([
      buffer.subarray(0, Math.max(0, buffer.length - 1)),
      Buffer.from(buffer.at(-1) === 10 ? " " : "\n"),
    ]);
    if (hash(tampered) === record.sha256)
      fail(`Negative tamper fixture did not invalidate ${record.file}.`);
  }
  for (const page of capture.source.officialPages) {
    const buffer = await readFile(
      path.join(root, "source", "soy-boyi", page.localFile),
    );
    if (buffer.length !== page.bytes || hash(buffer) !== page.sha256)
      fail(`Official page integrity failed for ${page.name}.`);
    if (/name=["']csrf-token["']/i.test(buffer.toString("utf8")))
      fail(`Persisted CSRF token remains in ${page.localFile}.`);
  }
  for (const [name, sourceId] of Object.entries(expectedMedia)) {
    const record = sourceMedia.assets.find((item) => item.name === name);
    if (
      !record ||
      record.sourceId !== sourceId ||
      !record.sourceUrl.endsWith(`/${sourceId}`)
    )
      fail(`Official amenity mapping changed for ${name}.`);
  }
  const residentialRaw = JSON.parse(
    await read("source/soy-boyi/raw/plans-residential-all-pages.json"),
  );
  const rawUnits = residentialRaw.pages.flatMap(
    (page) => page.payload.plans.data,
  );
  if (
    rawUnits.length !== 209 ||
    rawUnits.some(
      (unit) =>
        unit.type !== "residential" ||
        unit.status !== "AVAILABLE" ||
        Number(unit.is_price) !== 0,
    )
  )
    fail("Raw residential rows violate the capture contract.");
  if (
    checks.residentialBefore.payload.result !== rawUnits.length ||
    checks.residentialAfter.payload.result !== rawUnits.length
  )
    fail("Raw result checks do not reconcile with pages.");
}

await Promise.all(
  snapshot.units
    .filter((unit) => unit.plan)
    .map((unit) => access(path.join(root, "public", unit.plan))),
);
console.log(
  `Soy Bo‘yi contract passed: ${snapshot.units.length} residential AVAILABLE, ${snapshot.planCount} local plans, ${snapshot.missingPlanCount} source-missing plans, ${snapshot.excludedCommercial} commercial excluded${process.argv.includes("--audit-capture") ? ", raw capture audited" : ""}.`,
);
