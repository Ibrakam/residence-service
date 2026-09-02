#!/usr/bin/env node
import fs from "node:fs/promises";

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const [templatePath, outputPath, valuesJson] = process.argv.slice(2);
if (!templatePath || !outputPath || !valuesJson) {
  process.stderr.write("usage: render-plist.mjs TEMPLATE OUTPUT VALUES_JSON\n");
  process.exit(2);
}

const values = JSON.parse(valuesJson);
let output = await fs.readFile(templatePath, "utf8");
for (const [name, value] of Object.entries(values)) {
  output = output.replaceAll(`__${name}__`, escapeXml(value));
}
if (/__[A-Z0-9_]+__/.test(output)) throw new Error("Unresolved launchd template placeholder");
await fs.writeFile(outputPath, output, { mode: 0o600, flag: "w" });
await fs.chmod(outputPath, 0o600);
