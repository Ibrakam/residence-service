import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = (process.env.CATALOG_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const outputPath = resolve(root, 'data/kayan-catalog.json');
const projectSlugs = ['mirador', 'ofiyat'];

const locality = Object.freeze({
  mirador: Object.freeze({
    exactPrefix: '/kayan/mirador/plans/exact/',
    representativePrefix: '/kayan/mirador/plans/representative/',
    phasePrefix: '/kayan/mirador/',
  }),
  ofiyat: Object.freeze({
    exactPrefix: '/kayan/ofiyat/plans/exact/',
    representativePrefix: '/kayan/ofiyat/plans/representative/',
    phasePrefix: '/kayan/ofiyat/phases/',
    expectedUnits: 585,
    expectedLayouts: 261,
    expectedPhases: 3,
  }),
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function identityPart(value, context) {
  const part = String(value ?? '');
  if (!part || part.includes('\u001f')) throw new Error(`${context} is empty or unsafe`);
  return part;
}

export function kayanUnitTuple(unit, slug, context = 'unit') {
  if (!isRecord(unit) || unit.projectSlug !== slug || !Number.isSafeInteger(Number(unit.floor))) throw new Error(`${context} has invalid project/floor identity`);
  return [
    identityPart(unit.phaseSlug, `${context}.phaseSlug`),
    identityPart(unit.entrance, `${context}.entrance`),
    String(Number(unit.floor)),
    identityPart(unit.number, `${context}.number`),
  ].join('\u001f');
}

function indexUnits(units, slug, context) {
  if (!Array.isArray(units)) throw new Error(`${context} units are missing`);
  const bySourceKey = new Map();
  const tuples = new Set();
  for (const [index, unit] of units.entries()) {
    const sourceKey = identityPart(unit?.sourceKey, `${context} unit ${index + 1}.sourceKey`);
    const tuple = kayanUnitTuple(unit, slug, `${context} unit ${sourceKey}`);
    if (bySourceKey.has(sourceKey)) throw new Error(`${context} has duplicate unit sourceKey ${sourceKey}`);
    if (tuples.has(tuple)) throw new Error(`${context} has duplicate full unit tuple ${tuple}`);
    bySourceKey.set(sourceKey, { unit, tuple });
    tuples.add(tuple);
  }
  return { bySourceKey, tuples };
}

function layoutIdentity(layout, slug, context) {
  if (!isRecord(layout) || layout.projectSlug !== slug) throw new Error(`${context} has invalid project identity`);
  return `${identityPart(layout.phaseSlug, `${context}.phaseSlug`)}\u001f${identityPart(layout.sourceId, `${context}.sourceId`)}`;
}

function indexLayouts(layouts, slug, context) {
  if (!Array.isArray(layouts)) throw new Error(`${context} layouts are missing`);
  const indexed = new Map();
  for (const [index, layout] of layouts.entries()) {
    const key = layoutIdentity(layout, slug, `${context} layout ${index + 1}`);
    if (indexed.has(key)) throw new Error(`${context} has duplicate representative layout ${key}`);
    indexed.set(key, layout);
  }
  return indexed;
}

function indexPhases(phases, context) {
  if (!Array.isArray(phases)) throw new Error(`${context} phases are missing`);
  const indexed = new Map();
  for (const [index, phase] of phases.entries()) {
    const slug = identityPart(phase?.slug, `${context} phase ${index + 1}.slug`);
    if (indexed.has(slug)) throw new Error(`${context} has duplicate phase ${slug}`);
    indexed.set(slug, phase);
  }
  return indexed;
}

function isRemote(value) {
  return typeof value === 'string' && /^https?:\/\//.test(value);
}

function isLocal(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix) && !value.includes('://') && !/[?#\\%]/.test(value);
}

export function preserveKayanLocalAssets({ slug, project, units, layouts, previous }) {
  const config = locality[slug];
  if (!config || !isRecord(project) || project.slug !== slug || !isRecord(previous) || previous.project?.slug !== slug) throw new Error(`Cannot preserve ${slug} without matching project snapshots`);

  const incomingUnits = indexUnits(units, slug, `incoming ${slug}`);
  const previousUnits = indexUnits(previous.units, slug, `previous ${slug}`);
  const incomingLayouts = indexLayouts(layouts, slug, `incoming ${slug}`);
  const previousLayouts = indexLayouts(previous.layouts, slug, `previous ${slug}`);
  const incomingPhases = indexPhases(project.phases, `incoming ${slug}`);
  const previousPhases = indexPhases(previous.project.phases, `previous ${slug}`);

  if (config.expectedUnits && incomingUnits.tuples.size !== config.expectedUnits) throw new Error(`${slug} sync has ${incomingUnits.tuples.size} units, expected ${config.expectedUnits}`);
  if (config.expectedLayouts && incomingLayouts.size !== config.expectedLayouts) throw new Error(`${slug} sync has ${incomingLayouts.size} layouts, expected ${config.expectedLayouts}`);
  if (config.expectedPhases && incomingPhases.size !== config.expectedPhases) throw new Error(`${slug} sync has ${incomingPhases.size} phases, expected ${config.expectedPhases}`);

  for (const [sourceKey, incoming] of incomingUnits.bySourceKey) {
    const retained = previousUnits.bySourceKey.get(sourceKey);
    const retainedPath = retained?.unit?.planImageUrl;
    if (isLocal(retainedPath, config.exactPrefix)) {
      if (retained.tuple !== incoming.tuple) throw new Error(`${slug} unit ${sourceKey} changed full tuple; refusing to retain an exact plan`);
      incoming.unit.planImageUrl = retainedPath;
    } else if (slug === 'ofiyat') {
      delete incoming.unit.planImageUrl;
    }
    if (slug === 'ofiyat' && Object.hasOwn(incoming.unit, 'planImageUrl') && !isLocal(incoming.unit.planImageUrl, config.exactPrefix)) {
      throw new Error(`Ofiyat sync attempted to retain a non-local or unverified exact unit plan for ${sourceKey}`);
    }
  }

  for (const [key, layout] of incomingLayouts) {
    const retained = previousLayouts.get(key);
    if (isLocal(retained?.imageUrl, config.representativePrefix) && isLocal(retained?.thumbnailUrl ?? retained.imageUrl, config.representativePrefix)) {
      layout.imageUrl = retained.imageUrl;
      layout.thumbnailUrl = retained.thumbnailUrl ?? retained.imageUrl;
    }
    if (slug === 'ofiyat' && (!isLocal(layout.imageUrl, config.representativePrefix) || !isLocal(layout.thumbnailUrl, config.representativePrefix))) {
      throw new Error(`Ofiyat sync would regress representative layout ${key} to a remote or unverified path`);
    }
  }

  for (const [phaseSlug, phase] of incomingPhases) {
    const retainedPath = previousPhases.get(phaseSlug)?.imageUrl;
    if (isLocal(retainedPath, config.phasePrefix)) phase.imageUrl = retainedPath;
    if (slug === 'ofiyat' && !isLocal(phase.imageUrl, config.phasePrefix)) throw new Error(`Ofiyat sync would regress phase ${phaseSlug} to a remote or unverified image`);
  }

  if (slug === 'ofiyat') {
    if ([...incomingLayouts.values()].some((layout) => isRemote(layout.imageUrl) || isRemote(layout.thumbnailUrl))) throw new Error('Ofiyat sync retained a remote representative layout URL');
    if ([...incomingPhases.values()].some((phase) => isRemote(phase.imageUrl))) throw new Error('Ofiyat sync retained a remote phase URL');
  }
  return { project, units, layouts };
}

async function getJSON(path) {
  const response = await fetch(`${apiBase}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function getAllUnits(slug) {
  const items = [];
  const limit = 500;
  let declaredTotal;
  let offset = 0;
  for (;;) {
    const page = await getJSON(`/v1/projects/${slug}/units?limit=${limit}&offset=${offset}`);
    if (!Array.isArray(page?.items) || !Number.isSafeInteger(page.total) || page.total < 0 || (declaredTotal !== undefined && page.total !== declaredTotal)) throw new Error(`${slug} unit pagination contract is invalid or changed mid-sync`);
    declaredTotal = page.total;
    if (!page.items.length && items.length < declaredTotal) throw new Error(`${slug} unit pagination stopped before its declared total`);
    items.push(...page.items);
    if (items.length > declaredTotal) throw new Error(`${slug} unit pagination exceeded its declared total`);
    if (items.length === declaredTotal) return items;
    offset = items.length;
  }
}

async function main() {
  const previousBody = await readFile(outputPath);
  const previousSnapshot = JSON.parse(previousBody.toString('utf8'));
  if (!Array.isArray(previousSnapshot.projects)) throw new Error('Existing KAYAN production catalogue is missing its projects');

  const projects = [];
  for (const slug of projectSlugs) {
    const [project, units, layoutsResponse] = await Promise.all([
      getJSON(`/v1/projects/${slug}`),
      getAllUnits(slug),
      getJSON(`/v1/projects/${slug}/layouts`),
    ]);
    if (!Array.isArray(layoutsResponse?.items)) throw new Error(`${slug} layout response is invalid`);
    const previous = previousSnapshot.projects.find((item) => item?.project?.slug === slug);
    projects.push(preserveKayanLocalAssets({ slug, project, units, layouts: layoutsResponse.items, previous }));
  }

  const nextBody = Buffer.from(`${JSON.stringify({ generatedAt: new Date().toISOString(), projects }, null, 2)}\n`);
  const temporaryPath = `${outputPath}.staged-${process.pid}-${Date.now()}`;
  await mkdir(dirname(outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, nextBody, { flag: 'wx' });
    const currentBody = await readFile(outputPath);
    if (!currentBody.equals(previousBody)) throw new Error('KAYAN production catalogue changed during sync; refusing to overwrite concurrent work');
    await rename(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
  }
  console.log(`Saved ${projects.reduce((sum, item) => sum + item.units.length, 0)} units to ${outputPath}`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
