import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(process.argv[2] ?? '/tmp/meros-official-cards.json');
const outputPath = resolve(websiteRoot, 'data/meros-catalog.json');
const planDirectory = resolve(websiteRoot, 'public/meros/plans');
const source = JSON.parse(await readFile(sourcePath, 'utf8'));

const phaseDefinitions = {
  'NRG Meros Business': { id: 301, slug: 'business', name: 'Business', sortOrder: 10 },
  'NRG Meros Comfort - 1': { id: 302, slug: 'comfort-1', name: 'Comfort 1', sortOrder: 20 },
  'NRG Meros Comfort 2': { id: 303, slug: 'comfort-2', name: 'Comfort 2', sortOrder: 30 },
};

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.once('error', rejectRun);
    child.once('exit', (code) => code === 0 ? resolveRun() : rejectRun(new Error(`${command} exited with ${code}`)));
  });
}

async function pool(items, concurrency, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }));
}

await mkdir(planDirectory, { recursive: true });

const units = source.units.map((unit, index) => {
  const phase = phaseDefinitions[unit.phaseName];
  if (!phase) throw new Error(`Unknown MEROS phase: ${unit.phaseName}`);
  const id = index + 30001;
  const planFile = `${String(index + 1).padStart(4, '0')}.webp`;
  return {
    id,
    sourceKey: `meros:${phase.slug}:${unit.entrance}:${unit.floor}:${unit.number}:${index + 1}`,
    projectSlug: 'meros',
    phaseSlug: phase.slug,
    phaseName: phase.name,
    propertyType: 'apartment',
    rawPropertyType: 'Квартира',
    status: 'available',
    rawStatus: 'Доступно на официальном сайте',
    number: unit.number,
    entrance: unit.entrance,
    floor: unit.floor,
    area: unit.area,
    rooms: unit.rooms,
    price: unit.price,
    pricePerM2: Math.round((unit.price / unit.area) * 100) / 100,
    currency: 'UZS',
    planImageUrl: `/meros/plans/${planFile}`,
    isActive: true,
    sourceUpdatedAt: source.capturedAt,
    updatedAt: source.capturedAt,
    due: unit.due,
    maxFloor: unit.maxFloor,
  };
});

await pool(source.units, 12, async (unit, index) => {
  const output = resolve(planDirectory, `${String(index + 1).padStart(4, '0')}.webp`);
  const temporary = resolve(tmpdir(), `meros-plan-${process.pid}-${index + 1}.png`);
  const response = await fetch(unit.sourceUrl);
  if (!response.ok) throw new Error(`Plan ${index + 1}: HTTP ${response.status}`);
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
  try {
    await run('cwebp', ['-quiet', '-q', '80', '-mt', temporary, '-o', output]);
  } finally {
    await unlink(temporary).catch(() => {});
  }
});

const phases = Object.values(phaseDefinitions).map((definition) => {
  const phaseUnits = units.filter((unit) => unit.phaseSlug === definition.slug);
  return {
    id: definition.id,
    slug: definition.slug,
    name: definition.name,
    sourceId: `nrg-bi-meros-${definition.slug}`,
    propertyType: 'apartment',
    sortOrder: definition.sortOrder,
    floorsTotal: Math.max(...phaseUnits.map((unit) => unit.maxFloor ?? unit.floor)),
    totalUnits: phaseUnits.length,
    availableUnits: phaseUnits.length,
  };
});

const snapshot = {
  capturedAt: source.capturedAt,
  source: source.source,
  project: {
    id: 301,
    developerSlug: 'nrg-bi',
    slug: 'meros',
    name: 'Meros',
    totalUnits: units.length,
    availableUnits: units.length,
    updatedAt: source.capturedAt,
    phases,
  },
  units,
  layouts: [],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Saved ${units.length} MEROS units and plans to ${outputPath}`);
