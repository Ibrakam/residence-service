import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sarbonPublicSnapshot, sarbonPublicUnit } from "../data/sarbon-public.mjs";
import { sarbonOffersLabel } from "../app/sarbon/apartments/sarbon-offers.mjs";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");
const json = async (file) => JSON.parse(await read(file));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requiredUnitKeys = ["id", "unitKey", "sourceOrder", "number", "rooms", "area", "floor", "section", "phase", "completion", "status", "priceVisibility", "plan", "planStatus"];
const privateKeys = ["crmId", "sourceKey", "sourceCreatedAt", "sourceUpdatedAt", "sourceUrl", "sourceSha256", "sourceBytes", "serverDate", "price", "pricePerM2", "numericPrice"];
const auditCapture = process.argv.includes("--audit-capture");

const [catalog, mediaManifest, catalogManifest, landing, landingCss, catalogue, landingPage, cataloguePage, liveCatalog, vite, proxy, sitemap, privacy, packageText] = await Promise.all([
  json("data/sarbon-catalog.json"), json("data/sarbon-media-manifest.json"), json("data/sarbon-catalog-manifest.json"), read("app/sarbon/sarbon-page.tsx"), read("app/sarbon/sarbon.css"), read("app/sarbon/apartments/sarbon-catalog.tsx"), read("app/sarbon/page.tsx"), read("app/sarbon/apartments/page.tsx"), read("app/live-catalog.ts"), read("vite.config.ts"), read("proxy.ts"), read("app/sitemap.ts"), read("app/privacy/page.tsx"), read("package.json"),
]);

assert.equal(catalog.schemaVersion, 1);
assert.ok(Number.isFinite(Date.parse(catalog.capturedAt)));
assert.equal(catalog.source, "https://mbc.uz/api/plans");
assert.equal(catalog.sourceLanding, "https://mbc.uz/ru/project/sarbon");
assert.equal(catalog.officialTotalAtCapture, 20);
assert.equal(catalog.sourceCount, 20);
assert.deepEqual(catalog.project, { id: 21, slug: "sarbon", name: "SARBON", class: "business", developerSlug: "murad-buildings" });
assert.deepEqual(catalog.queues, [{ sourceId: "1", queueKey: "q1", queueLabel: "I очередь", queueDisplayCode: "I", queueOrder: 1 }]);
assert.equal(catalog.availableResidentialTotal, 20);
assert.equal(catalog.excludedCommercial, 0);
assert.equal(catalog.planCount, 20);
assert.equal(catalog.uniquePlanCount, 18);
assert.equal(catalog.missingPlanCount, 0);
assert.equal(catalog.units.length, 20);

const countBy = (key) => Object.fromEntries([...new Set(catalog.units.map((unit) => unit[key]))].map((value) => [value, catalog.units.filter((unit) => unit[key] === value).length]));
assert.deepEqual(countBy("rooms"), { 2: 1, 3: 8, 4: 11 });
assert.deepEqual(catalog.filters.area, { min: 44.26, max: 97.28 });
assert.deepEqual(catalog.filters.floors, [2, 3, 4, 5, 6, 7, 8, 10]);
assert.deepEqual(catalog.filters.sections, ["1", "2", "3", "4"]);
assert.deepEqual(catalog.filters.phases, ["1"]);
assert.deepEqual(catalog.filters.completions, ["2028"]);
assert.ok(catalog.units.every((unit) => unit.status === "AVAILABLE"
  && unit.phase === "1"
  && unit.phaseSlug === `q1-s${unit.section}`
  && unit.phaseName === `S${unit.section}`
  && unit.queueKey === "q1"
  && unit.queueLabel === "I очередь"
  && unit.queueDisplayCode === "I"
  && unit.queueOrder === 1
  && unit.completion === "2028"
  && unit.priceVisibility === "request-only"));
assert.equal(new Set(catalog.units.map((unit) => unit.id)).size, 20);
assert.equal(new Set(catalog.units.map((unit) => unit.unitKey)).size, 20);
assert.ok(new Set(catalog.units.map((unit) => unit.number)).size < 20, "fixture must keep repeated display numbers across sections");
assert.ok(catalog.units.some((unit, index) => catalog.units.some((other, otherIndex) => index !== otherIndex && unit.number === other.number && unit.section !== other.section)), "repeated numbers must prove identity is not display-number-only");
assert.equal(new Set(catalog.units.map((unit) => unit.plan)).size, 18);

const publicSnapshot = sarbonPublicSnapshot(catalog);
assert.equal(publicSnapshot.units.length, 20);
for (const unit of publicSnapshot.units) {
  assert.deepEqual(Object.keys(unit), requiredUnitKeys);
  assert.equal(typeof unit.id, "string");
  assert.equal(typeof unit.unitKey, "string");
  assert.ok(unit.plan?.startsWith("/sarbon/plans/") || unit.plan === null);
  for (const key of privateKeys) assert.ok(!(key in unit), `public unit leaked ${key}`);
}
assert.deepEqual(Object.keys(sarbonPublicUnit(catalog.units[0])), requiredUnitKeys);
const publicPayload = JSON.stringify(publicSnapshot);
for (const key of privateKeys) assert.ok(!publicPayload.includes(`"${key}"`), `public snapshot leaked ${key}`);
assert.ok(!/"price"\s*:\s*\d/.test(JSON.stringify(catalog)), "catalog serialized a numeric price");
assert.ok(!/"pricePerM2"\s*:/.test(JSON.stringify(catalog)), "catalog serialized price per m²");

assert.deepEqual([1, 2, 5, 11, 21].map((count) => sarbonOffersLabel("ru", count)), ["предложение", "предложения", "предложений", "предложений", "предложение"]);
assert.deepEqual([1, 2, 5, 11, 21].map((count) => sarbonOffersLabel("en", count)), ["offer", "offers", "offers", "offers", "offers"]);
assert.deepEqual([1, 2, 5, 11, 21].map((count) => sarbonOffersLabel("uz", count)), ["ta taklif", "ta taklif", "ta taklif", "ta taklif", "ta taklif"]);

for (const unit of catalog.units) {
  assert.equal(unit.unitKey, `sarbon:${unit.id}`);
  assert.equal(unit.sourceKey, `sarbon:${unit.id}`);
  const file = path.join(root, "public", unit.plan.replace(/^\//, ""));
  await access(file);
  const info = await sharp(file).metadata();
  assert.equal(info.format, "webp");
  assert.ok((info.width ?? 0) > 200 && (info.height ?? 0) > 200);
}
assert.equal(catalogManifest.counts.units, 20);
assert.equal(catalogManifest.counts.plans, 20);
assert.equal(catalogManifest.counts.uniquePlans, 18);
assert.equal(catalogManifest.assets.length, 18);
assert.ok(!JSON.stringify(catalogManifest).includes("https://"));
assert.ok(!JSON.stringify(mediaManifest).includes("https://"));
assert.equal(mediaManifest.assets.length, 12);
assert.equal(mediaManifest.assets.find((asset) => asset.name === "hero").derivatives.length, 4);
assert.equal(mediaManifest.assets.find((asset) => asset.name === "hero-mobile-source").derivatives.length, 0);
for (const asset of mediaManifest.assets.flatMap((item) => item.derivatives)) {
  const file = path.join(root, "public", asset.localPath.replace(/^\//, ""));
  await access(file); const info = await sharp(file).metadata(); const fileStat = await stat(file);
  assert.equal(info.width, asset.width); assert.equal(info.height, asset.height); assert.ok(fileStat.size > 1000);
}

for (const required of ["21", "1 023", "39 600", "до 12 этажей", "новый ташкент", "41.283289", "69.498216", "керамогранита", "клинкерной плитки", "гранатовые", "охристые", "бежевые", "общие гостиные", "детские комнаты", "библиотека", "murad buildings", "+998 78 113 77 12"]) assert.ok(landing.toLowerCase().includes(required), `landing misses confirmed fact: ${required}`);
for (const forbidden of ["KAYAN", "старт продаж", "не построено", "Скачать PDF", "mbc.uz", "43° / SKYLINE"]) assert.ok(!landing.includes(forbidden), `landing contains forbidden copy/link: ${forbidden}`);
assert.ok(landing.includes("butun loyihaga emas") && landing.includes("not to the entire project"));
assert.ok(landing.includes("Loyiha vizualizatsiyasi / CGI") && landing.includes("Project visualisation / CGI"));
assert.ok(landing.includes("import(\"lenis\")") && landingCss.includes("prefers-reduced-motion") && landing.includes("IntersectionObserver"));
assert.ok(landing.includes("let cancelled = false") && landing.includes("if (cancelled) return") && landing.includes("cancelled = true"));
assert.ok(landing.includes("aria-modal=\"true\"") && landing.includes("ArrowLeft") && landing.includes("ArrowRight") && landing.includes("Escape"));
assert.ok(landing.includes(`button:not([disabled]):not([tabindex=\"-1\"])`) && catalogue.includes(`button:not([disabled]):not([tabindex=\"-1\"])`));
assert.ok(landing.includes("aria-label={t.amenitiesLabel}") && landing.includes("scrollAmenities(-1)") && landing.includes("scrollAmenities(1)"));
assert.ok(landingCss.includes(".sarbon-amenities__controls button { width:48px; height:48px;") && landingCss.includes(".sarbon-amenities:focus-visible"));
assert.ok(landing.includes("projectSlug=\"sarbon\"") && landing.includes("requireConsent") && landing.includes("from: \"landing\""));
assert.ok(catalogue.includes("view === \"cards\"") && catalogue.includes("view === \"chess\"") && !catalogue.includes("floor-plan") && !catalogue.includes("chess-plus"));
assert.ok(catalogue.includes("scrollBy") && catalogue.includes("ArrowLeft") && catalogue.includes("ArrowRight"));
assert.ok(catalogue.includes("catalogLeadIdentity") && catalogue.includes("rememberLiveCatalogUnit") && catalogue.includes("projectSlug=\"sarbon\"") && catalogue.includes("requireConsent"));
assert.ok(catalogue.includes('useLiveCatalogSnapshot("sarbon", embeddedSnapshot)') && landing.includes('useLiveCatalogSnapshot("sarbon", embeddedSnapshot)'));
assert.ok(liveCatalog.includes("'sarbon'") && liveCatalog.includes("projectSlug !== '4u'"), "Sarbon live units must keep matched local plans and reject untrusted remote plan URLs");
assert.ok(cataloguePage.includes("snapshot.units.some((unit) => unit.id === params?.unit)") && catalogue.includes("String(item.id) === initialState.unitId"));
assert.ok(catalogue.includes("loading=\"lazy\"") && catalogue.includes("setVisible((value) => value + 8)"));
assert.ok(catalogue.includes("price: \"По запросу\"") && catalogue.includes("price: \"So‘rov bo‘yicha\"") && catalogue.includes("price: \"On request\""));
for (const staleCopy of ["Текущий snapshot", "Joriy snapshot", "Current snapshot", "Joriy rasmiy snapshotda", "current official snapshot"]) {
  assert.ok(!landing.includes(staleCopy) && !catalogue.includes(staleCopy), `Sarbon contains stale user-facing copy: ${staleCopy}`);
}
assert.ok(landingPage.includes("ApartmentComplex") && landingPage.includes("BreadcrumbList") && !landingPage.includes("KAYAN"));
assert.ok(cataloguePage.includes("ApartmentComplex") && cataloguePage.includes("BreadcrumbList"));
assert.ok(/containsCanonicalPath\(pathname, ['"]\/source\/sarbon['"]\)/.test(vite));
assert.ok(vite.includes("/data/sarbon-catalog.json") && vite.includes("/data/sarbon-catalog-manifest.json") && vite.includes("sarbon[^/]*(?:\\/|$)"));
assert.ok(proxy.includes("'/sarbon/:path*'"));
assert.ok(sitemap.includes("'sarbon'"));
assert.ok(privacy.includes("sarbon:") && privacy.includes('path: "/sarbon"') && privacy.includes('params?.project !== "sarbon"'));
const packageJson = JSON.parse(packageText); assert.equal(packageJson.scripts["verify:sarbon"], "node scripts/test-sarbon-contract.mjs"); assert.ok(packageJson.scripts.prebuild.includes("verify:sarbon"));

if (auditCapture) {
  const [capture, resultChecks, plans, commercial, sourceMedia, sourcePlans] = await Promise.all([
    json("source/sarbon/capture-manifest.json"),
    json("source/sarbon/result-checks.json"),
    json("source/sarbon/raw/plans-residential-all-pages.json"),
    json("source/sarbon/raw/plans-commercial-all-pages.json"),
    json("source/sarbon/media-manifest.json"),
    json("source/sarbon/plans-manifest.json"),
  ]);
  assert.equal(catalog.capturedAt, capture.captureCompletedAt);
  assert.equal(capture.project.crmId, 57946);
  assert.equal(capture.stable, true);
  assert.deepEqual(capture.counts, { before: { all: 20, residential: 20, commercial: 0 }, plans: { residential: 20, commercial: 0 }, after: { all: 20, residential: 20, commercial: 0 } });
  assert.equal(capture.source.officialPages.length, 3);
  assert.deepEqual(capture.source.officialPages.map((page) => page.name), ["ru", "uz", "en"]);
  assert.match(capture.requestPolicy, /no cookies/i);
  assert.match(capture.requestPolicy, /credentials omitted/i);
  assert.equal(resultChecks.commercialBefore.payload.result, null);
  assert.equal(resultChecks.commercialAfter.payload.result, null);
  assert.equal(commercial.pages.length, 1);
  assert.equal(commercial.pages[0].payload.plans.total, 0);
  assert.equal(commercial.pages[0].payload.plans.data.length, 0);
  assert.equal(plans.pages.length, 3);
  assert.equal(plans.pages.flatMap((page) => page.payload.plans.data).length, 20);
  assert.equal(sourceMedia.assets.find((asset) => asset.name === "hero").sourceSha256, sourceMedia.assets.find((asset) => asset.name === "hero-mobile-source").sourceSha256);
  assert.equal(sourcePlans.assets.length, 18);
  assert.ok(sourcePlans.assets.every((asset) => asset.sourceUrl?.startsWith("https://pb12218.profitbase.ru/")));
  for (const record of capture.rawFiles) { const value = await read(`source/sarbon/${record.file}`); assert.equal(Buffer.byteLength(value), record.bytes); assert.equal(sha256(value), record.sha256); }
  for (const page of capture.source.officialPages) { const value = await read(`source/sarbon/${page.localFile}`); assert.equal(Buffer.byteLength(value), page.bytes); assert.equal(sha256(value), page.sha256); }
  for (const asset of sourceMedia.assets) { const file = path.join(root, "source", "sarbon", asset.sourceFile); const value = await readFile(file); assert.equal(value.length, asset.sourceBytes); assert.equal(sha256(value), asset.sourceSha256); }
}

console.log(`Sarbon contract verified: 20/20 residential, 0 commercial, 20 plans, 18 unique plans${auditCapture ? ", capture audited" : ""}.`);
