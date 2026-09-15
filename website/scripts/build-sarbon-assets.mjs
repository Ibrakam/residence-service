import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const outputRoot = path.join(root, "public", "sarbon", "media");
const originalRoot = path.join(root, "source", "sarbon", "media-originals");
const sourceManifestPath = path.join(root, "source", "sarbon", "media-manifest.json");
const publicManifestPath = path.join(root, "data", "sarbon-media-manifest.json");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const assets = [
  ["hero", "https://mbc.uz/storage/projects/0b220398-ba9a-4026-a68e-9a59b4a156a1.webp", "cgi-render", 2200],
  ["hero-mobile-source", "https://mbc.uz/storage/projects/18dd10c3-2310-4825-bae4-4d4381a84b76.webp", "cgi-render", 2200],
  ["logo", "https://mbc.uz/storage/projects/d2f2a53d-933d-4213-acd1-a34c1092f705.webp", "official-logo", 900],
  ["aerial", "https://mbc.uz/storage/projects/97d91b17-5baa-4c05-8f8c-c00fee3da2b0.webp", "overview-cgi", 2000],
  ["architecture-01", "https://mbc.uz/storage/archs/b55fa9dd-1abd-49e4-bb8b-e7b09f6d65ef.webp", "cgi-render", 1800],
  ["architecture-02", "https://mbc.uz/storage/archs/c2827982-a4da-4cff-bf77-5484ae8518fd.webp", "cgi-render", 1800],
  ["architecture-03", "https://mbc.uz/storage/archs/eb44e218-f5bd-4157-8b34-4c806761bb99.webp", "cgi-render", 1800],
  ["amenity-01", "https://mbc.uz/storage/inners/34e0e4b9-5698-4eaa-80f4-89ce09050982.webp", "cgi-render", 1800],
  ["amenity-02", "https://mbc.uz/storage/inners/a1f2094b-de4f-4130-8289-8fbdb26fab8b.webp", "cgi-render", 1800],
  ["amenity-03", "https://mbc.uz/storage/inners/8cc93de9-b42c-4efb-baaf-76d02fd90723.webp", "cgi-render", 1800],
  ["amenity-04", "https://mbc.uz/storage/inners/4e5bf372-9d1c-4569-a293-cf28868eace6.webp", "cgi-render", 1800],
  ["amenity-05", "https://mbc.uz/storage/inners/bc26a30b-fbb4-4cd4-b05d-6964eb3494e2.webp", "cgi-render", 1800],
];

await mkdir(outputRoot, { recursive: true });
await mkdir(originalRoot, { recursive: true });
const sourceAssets = [];
const publicAssets = [];

for (const [name, sourceUrl, classification, maxWidth] of assets) {
  const response = await fetch(sourceUrl, { headers: { Accept: "image/*" }, credentials: "omit" });
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
  const original = Buffer.from(await response.arrayBuffer());
  const sourceHash = sha256(original);
  const sourceName = sourceUrl.split("/").at(-1);
  await writeFile(path.join(originalRoot, sourceName), original);
  const originalMeta = await sharp(original).metadata();
  const derivatives = [];

  const variants = name === "hero"
    ? [
        { key: "wide", width: maxWidth, height: 1000, fit: "cover", position: "centre" },
        { key: "mobile", width: 900, height: 1200, fit: "cover", position: "attention" },
      ]
    : name === "hero-mobile-source"
      ? []
      : [{ key: "main", width: maxWidth, height: maxWidth, fit: "inside", position: "centre" }];

  for (const variant of variants) {
    for (const format of ["webp", "avif"]) {
      const pipeline = sharp(original).rotate().resize({
        width: variant.width, height: variant.height, fit: variant.fit,
        position: variant.position, withoutEnlargement: variant.fit === "inside",
      });
      const output = format === "avif"
        ? await pipeline.avif({ quality: 58, effort: 5 }).toBuffer()
        : await pipeline.webp({ quality: 84, effort: 5 }).toBuffer();
      const hash = sha256(output);
      const fileName = `${name}-${variant.key}-${hash.slice(0, 12)}.${format}`;
      await writeFile(path.join(outputRoot, fileName), output);
      const metadata = await sharp(output).metadata();
      const record = { variant: variant.key, format, localPath: `/sarbon/media/${fileName}`, mime: `image/${format}`, width: metadata.width, height: metadata.height };
      derivatives.push(record);
    }
  }

  if (name === "hero-mobile-source" && sourceHash !== sourceAssets.find((item) => item.name === "hero")?.sourceSha256) {
    throw new Error("Official Sarbon mobile hero is no longer byte-identical to the desktop hero; review the crop policy");
  }
  publicAssets.push({ name, classification, derivatives });
  sourceAssets.push({ name, classification, sourceUrl, sourceFile: `media-originals/${sourceName}`, sourceSha256: sourceHash, sourceBytes: original.length, sourceWidth: originalMeta.width, sourceHeight: originalMeta.height, serverDate: response.headers.get("date"), derivatives });
}

const publicManifest = { schemaVersion: 1, project: "SARBON", note: "All project imagery is official CGI/render material; no documentary construction photography is used.", assets: publicAssets };
const sourceManifest = { ...publicManifest, generatedAt: new Date().toISOString(), sourcePage: "https://mbc.uz/ru/project/sarbon", assets: sourceAssets };
await writeFile(publicManifestPath, `${JSON.stringify(publicManifest, null, 2)}\n`);
await writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);
console.log(`Built ${publicAssets.flatMap((asset) => asset.derivatives).length} responsive Sarbon media derivatives.`);
