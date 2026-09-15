import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "source", "sarbon");
const rawRoot = path.join(sourceRoot, "raw");
const pagesRoot = path.join(sourceRoot, "pages");
const apiRoot = "https://mbc.uz/api";
const projectId = "21";
const sourcePages = {
  ru: "https://mbc.uz/ru/project/sarbon",
  uz: "https://mbc.uz/uz/project/sarbon",
  en: "https://mbc.uz/en/project/sarbon",
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const safeHeaders = (headers) => Object.fromEntries(
  ["date", "content-type", "cache-control", "server", "x-ratelimit-limit", "x-ratelimit-remaining"]
    .map((name) => [name, headers.get(name)])
    .filter(([, value]) => value),
);

async function post(route, values) {
  const requestedAt = new Date().toISOString();
  const fields = new URLSearchParams(values);
  const response = await fetch(`${apiRoot}/${route}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: fields,
    credentials: "omit",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  return {
    requestedAt,
    completedAt: new Date().toISOString(),
    request: { method: "POST", url: `${apiRoot}/${route}`, fields: Object.fromEntries(fields) },
    response: { status: response.status, headers: safeHeaders(response.headers), bytes: Buffer.byteLength(text), sha256: sha256(text) },
    payload: JSON.parse(text),
  };
}

async function capturePlans(type) {
  const first = await post("plans", { project: projectId, type, page: "1" });
  const lastPage = Number(first.payload?.plans?.last_page);
  if (!Number.isInteger(lastPage) || lastPage < 1) throw new Error(`Invalid ${type} page count`);
  const pages = [first];
  for (let page = 2; page <= lastPage; page += 1) {
    pages.push(await post("plans", { project: projectId, type, page: String(page) }));
  }
  return { capturedAt: new Date().toISOString(), type, pages };
}

async function capturePage(name, url) {
  const response = await fetch(url, { headers: { Accept: "text/html" }, credentials: "omit" });
  const rawHtml = await response.text();
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const html = rawHtml.replace(/<meta\b[^>]*\bname=["']csrf-token["'][^>]*>/giu, "");
  await writeFile(path.join(pagesRoot, `${name}.html`), html);
  return {
    name, url, status: response.status, serverDate: response.headers.get("date"),
    contentType: response.headers.get("content-type"), bytes: Buffer.byteLength(html), sha256: sha256(html),
    localFile: `pages/${name}.html`,
  };
}

function normalizedResult(record) {
  const value = record.payload?.result;
  return value == null ? 0 : Number(value);
}

await mkdir(rawRoot, { recursive: true });
await mkdir(pagesRoot, { recursive: true });
const captureStartedAt = new Date().toISOString();
const [allBefore, residentialBefore, commercialBefore] = await Promise.all([
  post("result", { project: projectId }),
  post("result", { project: projectId, type: "residential" }),
  post("result", { project: projectId, type: "commercial" }),
]);
const [residential, commercial] = await Promise.all([capturePlans("residential"), capturePlans("commercial")]);
const [allAfter, residentialAfter, commercialAfter] = await Promise.all([
  post("result", { project: projectId }),
  post("result", { project: projectId, type: "residential" }),
  post("result", { project: projectId, type: "commercial" }),
]);
const officialPages = [];
for (const [name, url] of Object.entries(sourcePages)) officialPages.push(await capturePage(name, url));

const residentialRows = residential.pages.flatMap((page) => page.payload.plans.data);
const commercialRows = commercial.pages.flatMap((page) => page.payload.plans.data);
const counts = {
  before: { all: normalizedResult(allBefore), residential: normalizedResult(residentialBefore), commercial: normalizedResult(commercialBefore) },
  plans: { residential: residentialRows.length, commercial: commercialRows.length },
  after: { all: normalizedResult(allAfter), residential: normalizedResult(residentialAfter), commercial: normalizedResult(commercialAfter) },
};
const stable = counts.before.all === counts.after.all
  && counts.before.residential === counts.plans.residential
  && counts.before.residential === counts.after.residential
  && counts.before.commercial === counts.plans.commercial
  && counts.before.commercial === counts.after.commercial
  && counts.before.all === counts.before.residential + counts.before.commercial;
if (!stable) throw new Error(`Snapshot changed during capture: ${JSON.stringify(counts)}`);
if (residentialRows.some((row) => row.project_id !== 21 || row.type !== "residential" || row.status !== "AVAILABLE")) throw new Error("Residential capture contains an unexpected project, type or status");
if (commercialRows.some((row) => row.project_id !== 21 || row.type !== "commercial" || row.status !== "AVAILABLE")) throw new Error("Commercial capture contains an unexpected project, type or status");

const rawOutputs = [
  ["raw/plans-residential-all-pages.json", `${JSON.stringify(residential, null, 2)}\n`],
  ["raw/plans-commercial-all-pages.json", `${JSON.stringify(commercial, null, 2)}\n`],
  ["result-checks.json", `${JSON.stringify({ allBefore, residentialBefore, commercialBefore, allAfter, residentialAfter, commercialAfter }, null, 2)}\n`],
];
for (const [relativePath, contents] of rawOutputs) await writeFile(path.join(sourceRoot, relativePath), contents);

const manifest = {
  schemaVersion: 1,
  project: { id: 21, crmId: 57946, slug: "sarbon", name: "SARBON", developerSlug: "murad-buildings" },
  captureStartedAt,
  captureCompletedAt: new Date().toISOString(),
  source: { apiPlans: `${apiRoot}/plans`, apiResult: `${apiRoot}/result`, officialPages },
  requestPolicy: "application/x-www-form-urlencoded; credentials omitted; no cookies, authentication, CSRF tokens or browser storage persisted",
  counts,
  stable,
  reconciliation: `Official endpoints agree on ${counts.plans.residential} AVAILABLE residential records and ${counts.plans.commercial} AVAILABLE commercial records. A null commercial /result response is normalized to zero.`,
  serverDates: {
    firstResult: allBefore.response.headers.date,
    firstResidentialPage: residential.pages[0].response.headers.date,
    lastResidentialPage: residential.pages.at(-1).response.headers.date,
    finalResult: allAfter.response.headers.date,
  },
  rawFiles: rawOutputs.map(([file, contents]) => ({ file, bytes: Buffer.byteLength(contents), sha256: sha256(contents) })),
};
await writeFile(path.join(sourceRoot, "capture-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest, null, 2));
