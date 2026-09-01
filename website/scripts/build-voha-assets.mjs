import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicRoot = new URL('../public/voha/', import.meta.url);
const imageRoot = new URL('../public/voha/images/', import.meta.url);
const planRoot = new URL('../public/voha/plans/', import.meta.url);
const dataRoot = new URL('../data/', import.meta.url);
const capturedAt = '2026-08-30T00:00:00+05:00';
const browserSnapshotPath = '/tmp/voha-catalog-browser.json';

const assets = [
  ['hero', 'https://s3.bi.group/biclick/content-manager/668_A8223_224f3d2703.jpg', 'actual-photo', 'Hero: канал, пирс и готовый двор'],
  ['hero-alt', 'https://s3.bi.group/biclick/content-manager/668_A8212_resized_e737f3817c.jpg', 'actual-photo', 'Канал и архитектура'],
  ['private-garden', 'https://s3.bi.group/biclick/content-manager/668_A8290_c22bb9a99d.jpg', 'actual-photo', 'Зелёный приватный двор'],
  ['waterside', 'https://s3.bi.group/biclick/content-manager/20260515_DSC_7972_Uluchsheno_Um_shuma_f723eb3a19.jpg', 'actual-photo', 'Жизнь у воды'],
  ['architecture-01', 'https://s3.bi.group/biclick/content-manager/668_A8284_resized_445d35af02.jpg', 'actual-photo', 'Натуральный камень и алюминиевые панели'],
  ['architecture-02', 'https://s3.bi.group/biclick/content-manager/668_A8294_resized_332afa2600.jpg', 'actual-photo', 'Фасад и озеленение'],
  ['architecture-03', 'https://s3.bi.group/biclick/content-manager/668_A8289_resized_78fed72399.jpg', 'actual-photo', 'Архитектура двора'],
  ['landscape-01', 'https://s3.bi.group/biclick/content-manager/668_A5662_228474700f.jpg', 'actual-photo', 'Многоуровневое озеленение'],
  ['landscape-02', 'https://s3.bi.group/biclick/content-manager/668_A5747_648f607c6a.jpg', 'actual-photo', 'Зрелая зелень'],
  ['landscape-03', 'https://s3.bi.group/biclick/content-manager/668_A5690_e56cf4d95f.jpg', 'actual-photo', 'Озеленённый двор'],
  ['courtyard-01', 'https://s3.bi.group/biclick/content-manager/668_A8233_resized_eee9f66982.jpg', 'actual-photo', 'Тихий двор'],
  ['courtyard-02', 'https://s3.bi.group/biclick/content-manager/668_A1144_resized_f957a1d13a.jpg', 'actual-photo', 'Пространство двора'],
  ['water-01', 'https://s3.bi.group/biclick/content-manager/668_A8218_853446af5c.jpg', 'actual-photo', 'Канал во дворе'],
  ['water-02', 'https://s3.bi.group/biclick/content-manager/668_A8419_resized_237cdbd495.jpg', 'actual-photo', 'Пирс у воды'],
  ['water-03', 'https://s3.bi.group/biclick/content-manager/668_A8219_resized_fb9bd117a6.jpg', 'actual-photo', 'Прогулочная зона у канала'],
  ['water-04', 'https://s3.bi.group/biclick/content-manager/668_A8483_resized_f81c08d75e.jpg', 'actual-photo', 'Водная зона и зелень'],
  ['hall-phase-1-01', 'https://s3.bi.group/biclick/content-manager/668_A1247_resized_8e33e0e59a.jpg', 'actual-photo', 'Холл I очереди'],
  ['hall-phase-1-02', 'https://s3.bi.group/biclick/content-manager/668_A0890_resized_fe114b409e.jpg', 'actual-photo', 'Холл I очереди'],
  ['hall-phase-1-03', 'https://s3.bi.group/biclick/content-manager/668_A0900_resized_13ef17f6b7.jpg', 'actual-photo', 'Холл I очереди'],
  ['hall-phase-2-01', 'https://s3.bi.group/biclick/content-manager/2_4_2_a6b600aa6e.jpg', 'official-concept', 'Концепция холла II очереди'],
  ['hall-phase-2-02', 'https://s3.bi.group/biclick/content-manager/2_5_blok_2_3de777efae.jpg', 'official-concept', 'Концепция холла II очереди'],
  ['hall-phase-2-03', 'https://s3.bi.group/biclick/content-manager/8_BLOK_2_f8d64d2bcd.jpg', 'official-concept', 'Концепция холла II очереди'],
  ['service-01', 'https://s3.bi.group/biclick/content-manager/N018997_resized_1362b65d06.jpg', 'actual-photo', 'Управляющая компания'],
  ['service-02', 'https://s3.bi.group/biclick/content-manager/668_A5132_resized_915572afb2.jpg', 'actual-photo', 'Сервис и территория'],
  ['construction-01', 'https://s3.bi.group/biclick/content-manager/668_A5265_51d5ce800b.jpg', 'construction-photo-2026-07', 'Отчёт о строительстве, июль 2026'],
  ['construction-02', 'https://s3.bi.group/biclick/content-manager/668_A5306_6f7ded8e67.jpg', 'construction-photo-2026-07', 'Отчёт о строительстве, июль 2026'],
  ['construction-03', 'https://s3.bi.group/biclick/content-manager/668_A5253_0891f01a00.jpg', 'construction-photo-2026-07', 'Отчёт о строительстве, июль 2026'],
];

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function optimisePhoto(name, source) {
  const input = await fetchBuffer(source);
  const output = new URL(`./images/${name}.webp`, publicRoot);
  await sharp(input).rotate().resize({ width: 2200, height: 1650, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, effort: 5 }).toFile(fileURLToPath(output));
  if (name === 'hero') {
    await sharp(input).rotate().resize({ width: 900, height: 1200, fit: 'cover', position: 'centre' }).webp({ quality: 80, effort: 5 }).toFile(fileURLToPath(new URL('./images/hero-mobile.webp', publicRoot)));
  }
}

async function main() {
  await Promise.all([mkdir(publicRoot, { recursive: true }), mkdir(imageRoot, { recursive: true }), mkdir(planRoot, { recursive: true }), mkdir(dataRoot, { recursive: true })]);
  const raw = JSON.parse(await readFile(browserSnapshotPath, 'utf8'));
  await Promise.all(assets.map(([name, source]) => optimisePhoto(name, source)));

  const units = [];
  for (const unit of raw.units) {
    const plan = `/voha/plans/${unit.id}.webp`;
    const input = await fetchBuffer(unit.planSource);
    await sharp(input).rotate().resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true, background: '#f7f4ed' }).flatten({ background: '#f7f4ed' }).webp({ quality: 84, effort: 5 }).toFile(fileURLToPath(new URL(`./plans/${unit.id}.webp`, publicRoot)));
    units.push({ ...unit, promotion: Boolean(unit.oldPrice), pricePerM2: Math.round(unit.price / unit.area), currency: 'UZS', plan });
  }

  const catalog = { ...raw, capturedAt, officialTotalAtCapture: units.length, selectionMethod: 'All 104 published listings loaded in the official catalogue with its Show more control in Browser.', units };
  await writeFile(new URL('./voha-catalog.json', dataRoot), `${JSON.stringify(catalog, null, 2)}\n`);

  const bookletSource = 'https://s3.bi.group/biclick/content-manager/VOHA_a298c20363.pdf';
  if (existsSync('/tmp/voha-official-booklet.pdf')) await copyFile('/tmp/voha-official-booklet.pdf', new URL('./voha-official-booklet.pdf', publicRoot));
  else await writeFile(new URL('./voha-official-booklet.pdf', publicRoot), await fetchBuffer(bookletSource));

  const manifest = {
    project: 'Voha', capturedAt,
    landing: 'https://nrg-bi.uz/uz-ru/landing/voha',
    catalog: raw.source,
    booklet: bookletSource,
    panorama: 'https://uzbekistan360.uz/ru/location/nrg-voha0Kw',
    camera: 'https://rtsp.me/embed/3Ny3iFi8/',
    officialContacts: { phone: '1360', salesOffices: ['ул. Нукус, 91/1', 'ул. Айбека, 38Б'] },
    projectAddress: 'Ташкент, улица Кайнарсой, 136А',
    catalogueAddress: 'г. Ташкент, ул. Карасу Буйи 21',
    factsVerifiedOn: '2026-08-30',
    assets: assets.map(([name, source, kind, caption]) => ({ local: `/voha/images/${name}.webp`, source, kind, caption })),
    notes: [
      'The landing page labels its project imagery as Live / photographs.',
      'Phase II lobby visuals are kept separately as official concepts because the official PDF warns that construction imagery may change.',
      'The brochure is preserved byte-for-byte from the official URL and contains its own non-offer and conditional-image disclaimers.',
      'Construction photography is explicitly dated July 2026; it is not presented as a live feed.',
    ],
  };
  await writeFile(new URL('./voha-sources.json', dataRoot), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Voha assets: ${assets.length} photos/concepts, ${units.length} plans, 1 official PDF`);
}

await main();
