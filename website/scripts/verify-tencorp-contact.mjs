import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = fileURLToPath(new URL('..', import.meta.url));
const canonicalHref = 'tel:+998781137712';
const canonicalLabel = '+998 78 113 77 12';
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

const failures = [];
for (const path of sourceFiles(join(websiteRoot, 'app'))) {
  const source = readFileSync(path, 'utf8');
  for (const [match] of source.matchAll(/tel:[^\s"'`<>{}]+/g)) {
    if (match !== canonicalHref) failures.push(`${relative(websiteRoot, path)}: non-TenCorp phone link ${match}`);
  }
  for (const [, value] of source.matchAll(/telephone:\s*["']([^"']+)["']/g)) {
    if (value !== canonicalHref.slice(4)) failures.push(`${relative(websiteRoot, path)}: non-TenCorp JSON-LD phone ${value}`);
  }
}

const clientDataFiles = ['data/sun-client.json', 'data/regnum-plaza-client.json'];
for (const file of clientDataFiles) {
  const data = JSON.parse(readFileSync(join(websiteRoot, file), 'utf8'));
  if (data.projectFacts?.phone !== canonicalLabel) failures.push(`${file}: projectFacts.phone is ${data.projectFacts?.phone ?? 'missing'}`);
}

const generatorFiles = ['scripts/build-sun-catalog.mjs', 'scripts/build-regnum-plaza-catalog.mjs'];
for (const file of generatorFiles) {
  const source = readFileSync(join(websiteRoot, file), 'utf8');
  if (!source.includes(`phone: '${canonicalLabel}'`)) failures.push(`${file}: canonical generated contact is missing`);
}

if (failures.length) {
  console.error(`TenCorp contact verification failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log(`TenCorp contact verification passed: every public phone link and JSON-LD phone uses ${canonicalLabel}.`);
