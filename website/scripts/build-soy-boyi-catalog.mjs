import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourceRoot = path.join(root, "source", "soy-boyi");
const rawPath = path.join(
  sourceRoot,
  "raw",
  "plans-residential-all-pages.json",
);
const outputRoot = path.join(root, "public", "soy-boyi", "plans");
const snapshotPath = path.join(root, "data", "soy-boyi-catalog.json");
const publicManifestPath = path.join(
  root,
  "data",
  "soy-boyi-catalog-manifest.json",
);
const sourceManifestPath = path.join(sourceRoot, "plans-manifest.json");
const capture = JSON.parse(
  await readFile(path.join(sourceRoot, "capture-manifest.json"), "utf8"),
);
const rawText = await readFile(rawPath, "utf8");
const rawRecord = capture.rawFiles.find(
  (entry) => entry.file === "raw/plans-residential-all-pages.json",
);
if (
  !rawRecord ||
  Buffer.byteLength(rawText) !== rawRecord.bytes ||
  createHash("sha256").update(rawText).digest("hex") !== rawRecord.sha256
)
  throw new Error(
    "Residential raw wrapper failed its capture-manifest integrity check",
  );
const raw = JSON.parse(rawText);
const rows = raw.pages.flatMap((page) => page.payload.plans.data);
const units = rows.filter(
  (unit) => unit.type === "residential" && unit.status === "AVAILABLE",
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

if (!capture.stable || units.length !== capture.counts.plans.residential)
  throw new Error("Raw rows do not match the stable capture manifest");
if (units.some((unit) => Number(unit.is_price) !== 0))
  throw new Error("A source row unexpectedly exposes price");
await mkdir(outputRoot, { recursive: true });

const imageUrls = [
  ...new Set(
    units
      .map((unit) => unit.image)
      .filter((value) => typeof value === "string" && value),
  ),
];
const media = new Map();
let cursor = 0;
async function worker() {
  while (cursor < imageUrls.length) {
    const index = cursor;
    cursor += 1;
    const sourceUrl = imageUrls[index];
    const response = await fetch(sourceUrl, { headers: { Accept: "image/*" } });
    if (!response.ok)
      throw new Error(
        `Plan ${index + 1}/${imageUrls.length} returned HTTP ${response.status}`,
      );
    const original = Buffer.from(await response.arrayBuffer());
    const output = await sharp(original)
      .rotate()
      .resize({
        width: 980,
        height: 980,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 84, effort: 5 })
      .toBuffer();
    const outputHash = sha256(output);
    const fileName = `${outputHash.slice(0, 16)}.webp`;
    await writeFile(path.join(outputRoot, fileName), output);
    const metadata = await sharp(output).metadata();
    media.set(sourceUrl, {
      localPath: `/soy-boyi/plans/${fileName}`,
      sha256: outputHash,
      mime: "image/webp",
      bytes: output.length,
      width: metadata.width,
      height: metadata.height,
      sourceUrl,
      sourceSha256: sha256(original),
      sourceBytes: original.length,
      serverDate: response.headers.get("date"),
    });
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()));

const normalized = units.map((unit, sourceOrder) => {
  const plan = unit.image ? media.get(unit.image) : undefined;
  return {
    id: String(unit.id),
    crmId: String(unit.crm_id),
    unitKey: `soy-boyi:${unit.id}`,
    sourceKey: `soy-boyi:${unit.id}`,
    sourceOrder,
    number: String(unit.number),
    rooms: Number(unit.rooms),
    area: Number(unit.square),
    floor: Number(unit.floor),
    section: String(unit.section),
    phase: String(unit.queue),
    completion: unit.end == null ? null : String(unit.end),
    status: "AVAILABLE",
    priceVisibility: "request-only",
    plan: plan?.localPath ?? null,
    planStatus: plan ? "available" : "missing-at-source",
    sourceCreatedAt: unit.created_at,
    sourceUpdatedAt: unit.updated_at,
  };
});
const numeric = (key) =>
  [...new Set(normalized.map((unit) => unit[key]))].sort(
    (a, b) => Number(a) - Number(b),
  );
const snapshot = {
  schemaVersion: 1,
  source: "https://mbc.uz/api/plans",
  sourceLanding: "https://mbc.uz/ru/project/soy-boyi",
  officialTotalAtCapture: normalized.length,
  sourceCount: normalized.length,
  project: {
    id: 3,
    slug: "soy-boyi",
    name: "Soy Bo‘yi",
    class: "business",
    developerSlug: "murad-buildings",
  },
  capturedAt: capture.captureCompletedAt,
  serverDate: capture.serverDates.finalResult,
  availableResidentialTotal: normalized.length,
  excludedCommercial: capture.counts.plans.commercial,
  planCount: normalized.filter((unit) => unit.plan).length,
  missingPlanCount: normalized.filter((unit) => !unit.plan).length,
  reconciliation: capture.reconciliation,
  filters: {
    rooms: numeric("rooms"),
    floors: numeric("floor"),
    sections: numeric("section"),
    phases: numeric("phase"),
    completions: [...new Set(normalized.map((unit) => unit.completion))],
    area: {
      min: Math.min(...normalized.map((unit) => unit.area)),
      max: Math.max(...normalized.map((unit) => unit.area)),
    },
  },
  units: normalized,
};
const snapshotText = `${JSON.stringify(snapshot, null, 2)}\n`;
await writeFile(snapshotPath, snapshotText);

const publicAssets = [...media.values()]
  .map((record) => ({
    localPath: record.localPath,
    sha256: record.sha256,
    mime: record.mime,
    bytes: record.bytes,
    width: record.width,
    height: record.height,
  }))
  .sort((a, b) => a.localPath.localeCompare(b.localPath));
const publicManifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  snapshot: {
    file: "/data/soy-boyi-catalog.json",
    sha256: sha256(snapshotText),
    bytes: Buffer.byteLength(snapshotText),
  },
  counts: {
    units: normalized.length,
    plans: normalized.filter((unit) => unit.plan).length,
    missingPlans: normalized.filter((unit) => !unit.plan).length,
  },
  assets: publicAssets,
};
const sourceManifest = {
  ...publicManifest,
  rawFile: "raw/plans-residential-all-pages.json",
  assets: [...media.values()].sort((a, b) =>
    a.localPath.localeCompare(b.localPath),
  ),
};
await writeFile(
  publicManifestPath,
  `${JSON.stringify(publicManifest, null, 2)}\n`,
);
await writeFile(
  sourceManifestPath,
  `${JSON.stringify(sourceManifest, null, 2)}\n`,
);
console.log(
  `Built ${normalized.length} AVAILABLE residential units, ${snapshot.planCount} local plans and ${snapshot.missingPlanCount} source-missing plan placeholders.`,
);
