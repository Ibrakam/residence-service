import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = resolve(websiteRoot, 'data/sado-catalog.json');
const outputDirectory = resolve(websiteRoot, 'public/sado');
const planDirectory = resolve(outputDirectory, 'plans');
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));

const editorialAssets = [
  ['hero', 'https://s3.bi.group/biclick/content-manager/IMG_1059_72b1a107f2.JPG', 1920, 84],
  ['hero-mobile', 'https://s3.bi.group/biclick/content-manager/IMG_1059_72b1a107f2.JPG', 900, 82],
  ['terrace', 'https://s3.bi.group/biclick/content-manager/BI_SADO_BUSINESS_TERRASA_697f2ed21a.jpg', 1440, 82],
  ['courtyard-wide', 'https://s3.bi.group/biclick/content-manager/2_1d4db27673.jpg', 1760, 83],
  ['location', 'https://s3.bi.group/biclick/content-manager/BI_SADO_CAM_PTICHKA_jpg_kopiya_4_a32b6f145c.jpg', 1600, 80],
  ['architecture', 'https://s3.bi.group/biclick/content-manager/668_A1665_d96d1d7ebe.jpg', 1440, 82],
  ['courtyard-1', 'https://s3.bi.group/biclick/content-manager/668_A1853_ee011a2541.jpg', 1280, 80],
  ['courtyard-2', 'https://s3.bi.group/biclick/content-manager/668_A1841_72d698b5ab.jpg', 1280, 80],
  ['courtyard-3', 'https://s3.bi.group/biclick/content-manager/668_A1781_e804b92f81.jpg', 1280, 80],
  ['courtyard-4', 'https://s3.bi.group/biclick/content-manager/668_A1849_4e2a09e3fc.jpg', 1280, 80],
  ['playground', 'https://s3.bi.group/biclick/content-manager/668_A1771_8074096fb4.jpg', 1280, 80],
  ['hall-1', 'https://s3.bi.group/biclick/content-manager/668_A1472_4cda91258e.jpg', 1280, 81],
  ['hall-2', 'https://s3.bi.group/biclick/content-manager/668_A1478_1_e47c12b0ea.jpg', 1280, 81],
  ['hall-3', 'https://s3.bi.group/biclick/content-manager/668_A1506_54af74b0bd.jpg', 1280, 81],
  ['parking', 'https://s3.bi.group/biclick/content-manager/6_9a3377b60a.jpg', 1280, 80],
  ['storage', 'https://s3.bi.group/biclick/content-manager/vx2xkz1wot9ruswqrqqew4sx67hez5a0_b0cf3be8d2.webp', 1100, 80],
  ['charging', 'https://s3.bi.group/biclick/content-manager/zapravka_1_3b4eb68df3.webp', 1100, 80],
  ['bicycle', 'https://s3.bi.group/biclick/content-manager/Parking_3_57a43b9e12.webp', 1100, 80],
  ['landscape-1', 'https://s3.bi.group/biclick/content-manager/668_A1435_6d334b34ed.jpg', 1280, 81],
  ['landscape-2', 'https://s3.bi.group/biclick/content-manager/668_A1761_8684701332.jpg', 1280, 81],
  ['landscape-3', 'https://s3.bi.group/biclick/content-manager/668_A1758_c95f669b36.jpg', 1280, 81],
  ['summer-kitchen', 'https://s3.bi.group/biclick/content-manager/668_A1691_3fd3fec346.jpg', 1200, 81],
  ['amphitheatre', 'https://s3.bi.group/biclick/content-manager/668_A1702_6d4806af5e.jpg', 1200, 81],
  ['fitness', 'https://s3.bi.group/biclick/content-manager/668_A1699_af3eef07b5.jpg', 1200, 81],
  ['construction-1', 'https://s3.bi.group/biclick/content-manager/668_A5354_344f720461.jpg', 1280, 79],
  ['construction-2', 'https://s3.bi.group/biclick/content-manager/668_A5374_e35dddad3c.jpg', 1280, 79],
  ['construction-3', 'https://s3.bi.group/biclick/content-manager/668_A5358_755bc229ec.jpg', 1280, 79],
];

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

async function downloadAndConvert(url, output, width, quality) {
  const temporary = resolve(tmpdir(), `sado-${process.pid}-${Math.random().toString(36).slice(2)}.source`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  await writeFile(temporary, new Uint8Array(await response.arrayBuffer()));
  try {
    await run('cwebp', ['-quiet', '-q', String(quality), '-mt', '-resize', String(width), '0', temporary, '-o', output]);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

await mkdir(planDirectory, { recursive: true });

await pool(editorialAssets, 3, async ([name, url, width, quality]) => {
  await downloadAndConvert(url, resolve(outputDirectory, `${name}.webp`), width, quality);
});

await pool(snapshot.units, 10, async (unit) => {
  await downloadAndConvert(unit.planUrl, resolve(planDirectory, `${unit.id}.webp`), 760, 82);
});

console.log(`Saved ${editorialAssets.length} editorial images and ${snapshot.units.length} plans to ${outputDirectory}`);
