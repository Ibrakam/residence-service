import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const websiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(websiteRoot, '..');
const defaultCaptureDirectory = '/var/folders/vn/fxfkn0g926s6kb7wx9jbkkbm0000gn/T/kayan-mirador-official-final-2026-08-31';
const captureDirectoryArgument = process.argv.find((value) => value.startsWith('--capture-dir='));
const captureDirectory = resolve(captureDirectoryArgument?.slice('--capture-dir='.length) || defaultCaptureDirectory);
const mappingPath = resolve(repositoryRoot, 'backend/data/raw/kayan/mappings/mirador-plans.json');
const floorMappingPath = resolve(repositoryRoot, 'backend/data/raw/kayan/mappings/mirador-floor-schemes.json');
const expectedManifestPath = resolve(repositoryRoot, 'backend/data/raw/kayan/mappings/expected/mirador-floor-scheme-universe-2026-08-31.json');
const companionPath = resolve(repositoryRoot, 'backend/data/raw/kayan/mappings/expected/mirador-floor-scheme-companion-2026-08-31.tsv');
const rawScreenshotRoot = resolve(repositoryRoot, 'backend/data/raw/kayan/mappings/floor-schemes/mirador/2026-08-31');
const publicSchemeRoot = resolve(websiteRoot, 'public/kayan/mirador/floor-schemes');
const clientPath = resolve(websiteRoot, 'data/mirador-floor-schemes.json');
const captureObservedAt = '2026-08-31T17:49:54Z';
const sourceScreenshotPathPrefix = 'backend/data/raw/kayan/mappings/floor-schemes/mirador/2026-08-31/';
const publicImagePathPrefix = '/kayan/mirador/floor-schemes/';
const canvas = { x: 160, y: 257, width: 1501, height: 439 };
const extendedDetectionHeight = 488;
const foregroundThreshold = 8;
const cropPadding = 24;
const touchRadius = 22;
const expectedCompanionNumbers = ['44', '45', '47', '48', '49', '114', '115', '116', '118', '119'];

function sha256(body) {
  return createHash('sha256').update(body).digest('hex');
}

function sourceFileName(entrance, floor) {
  return `mirador-s${entrance}-f${String(floor).padStart(2, '0')}.png`;
}

function imageFileName(entrance, floor) {
  return `entrance-${entrance}-floor-${String(floor).padStart(2, '0')}.webp`;
}

function locationForUnitNumber(unitNumber) {
  if (unitNumber >= 1 && unitNumber <= 49) {
    return { entrance: '1', floor: 2 + Math.floor((unitNumber - 1) / 7) };
  }
  if (unitNumber >= 50 && unitNumber <= 53) return { entrance: '2', floor: 2 };
  if (unitNumber >= 54 && unitNumber <= 119) {
    return { entrance: '2', floor: 3 + Math.floor((unitNumber - 54) / 6) };
  }
  if (unitNumber >= 120 && unitNumber <= 209) {
    return { entrance: '3', floor: 2 + Math.floor((unitNumber - 120) / 6) };
  }
  throw new Error(`Apartment ${unitNumber} is outside the official Mirador 1..209 universe`);
}

function unitNumbersForScheme(entrance, floor) {
  if (entrance === '1' && floor >= 2 && floor <= 8) {
    const base = 1 + (floor - 2) * 7;
    return Array.from({ length: 7 }, (_, index) => base + index);
  }
  if (entrance === '2' && floor === 2) return [50, 51, 52, 53];
  if (entrance === '2' && floor >= 3 && floor <= 13) {
    const base = 54 + (floor - 3) * 6;
    return Array.from({ length: 6 }, (_, index) => base + index);
  }
  if (entrance === '3' && floor >= 2 && floor <= 16) {
    const base = 120 + (floor - 2) * 6;
    return Array.from({ length: 6 }, (_, index) => base + index);
  }
  throw new Error(`Unexpected Mirador entrance/floor ${entrance}/${floor}`);
}

function centersForScheme(entrance, floor) {
  if (entrance === '1' && floor >= 2 && floor <= 8) {
    return [[953, 359], [990, 421], [990, 486], [983, 564], [897, 572], [813, 575], [813, 489]];
  }
  if (entrance === '2' && floor === 2) {
    return [[1036, 499], [931, 562], [806, 560], [807, 376]];
  }
  if (entrance === '2' && floor >= 3 && floor <= 13) {
    return [[1018, 401], [1038, 536], [949, 529], [878, 536], [785, 529], [781, 410]];
  }
  if (entrance === '3' && floor >= 2 && floor <= 16) {
    return [[1055, 564], [991, 649], [908, 647], [771, 632], [760, 504], [782, 380]];
  }
  throw new Error(`Unexpected Mirador entrance/floor geometry ${entrance}/${floor}`);
}

function expectedSchemeCombos() {
  return [
    ...Array.from({ length: 7 }, (_, index) => ({ entrance: '1', floor: index + 2 })),
    ...Array.from({ length: 12 }, (_, index) => ({ entrance: '2', floor: index + 2 })),
    ...Array.from({ length: 15 }, (_, index) => ({ entrance: '3', floor: index + 2 })),
  ];
}

function detectTightCrop(data, width, height, channels) {
  if (width !== canvas.width || ![canvas.height, extendedDetectionHeight].includes(height) || channels < 3) {
    throw new Error(`Unexpected canvas raster ${width}x${height}x${channels}`);
  }
  const pixelCount = width * height;
  const foreground = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * channels;
    foreground[index] = (
      data[offset] < 255 - foregroundThreshold
      || data[offset + 1] < 255 - foregroundThreshold
      || data[offset + 2] < 255 - foregroundThreshold
    ) ? 1 : 0;
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largest = null;
  for (let seed = 0; seed < pixelCount; seed += 1) {
    if (!foreground[seed] || visited[seed]) continue;
    let head = 0;
    let tail = 0;
    let count = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[tail++] = seed;
    visited[seed] = 1;
    while (head < tail) {
      const current = queue[head++];
      const y = Math.floor(current / width);
      const x = current - y * width;
      count += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (foreground[next] && !visited[next]) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    if (!largest || count > largest.pixelCount) largest = { pixelCount: count, minX, minY, maxX, maxY };
  }
  if (!largest || largest.pixelCount < 15_000) throw new Error('No plausible connected floor-plan component found in the official canvas');
  const componentWidth = largest.maxX - largest.minX + 1;
  const componentHeight = largest.maxY - largest.minY + 1;
  if (largest.minX < 350 || largest.maxX > 1150 || componentWidth < 200 || componentWidth > 700 || componentHeight < 200 || componentHeight > canvas.height) {
    throw new Error(`Detected component is outside the audited central plan ROI: ${JSON.stringify(largest)}`);
  }
  const x = Math.max(0, largest.minX - cropPadding);
  const y = Math.max(0, largest.minY - cropPadding);
  const right = Math.min(width, largest.maxX + 1 + cropPadding);
  const bottom = Math.min(height, largest.maxY + 1 + cropPadding);
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    padding: cropPadding,
    detector: 'largest-8-connected-nonwhite-component-v1',
    foregroundThreshold,
    componentPixelCount: largest.pixelCount,
    componentBounds: {
      x: largest.minX,
      y: largest.minY,
      width: componentWidth,
      height: componentHeight,
    },
  };
}

function squareHotspot(fullCenter, tightCrop, width, height) {
  const x = fullCenter[0] - canvas.x - tightCrop.x;
  const y = fullCenter[1] - canvas.y - tightCrop.y;
  const left = Math.max(0, x - touchRadius);
  const top = Math.max(0, y - touchRadius);
  const right = Math.min(width, x + touchRadius);
  const bottom = Math.min(height, y + touchRadius);
  if (right - left !== 44 || bottom - top !== 44) {
    throw new Error(`44px hotspot centered at ${fullCenter.join(',')} was unexpectedly clamped after crop`);
  }
  return {
    points: `${left},${top} ${right},${top} ${right},${bottom} ${left},${bottom}`,
    label: { x, y },
  };
}

async function stageBuffer(target, body, token) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.capture-${token}`;
  await unlink(temporary).catch(() => {});
  await writeFile(temporary, body);
  return { target, temporary };
}

async function commitStagedFiles(entries, { failAfterCommits = 0 } = {}) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const states = entries.map((entry) => ({ ...entry, backup: `${entry.target}.backup-${token}`, backedUp: false, committed: false }));
  if (new Set(states.map((entry) => entry.target)).size !== states.length) throw new Error('Capture transaction contains duplicate targets');
  try {
    let committed = 0;
    for (const state of states) {
      try {
        await stat(state.temporary);
      } catch {
        throw new Error(`Staged capture output disappeared: ${state.temporary}`);
      }
    }
    for (const state of states) {
      try {
        await stat(state.target);
        await rename(state.target, state.backup);
        state.backedUp = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      await rename(state.temporary, state.target);
      state.committed = true;
      committed += 1;
      if (failAfterCommits > 0 && committed === failAfterCommits) throw new Error(`Injected capture commit failure after ${committed} files`);
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const state of [...states].reverse()) {
      try {
        if (state.committed) await unlink(state.target).catch(() => {});
        if (state.backedUp) await rename(state.backup, state.target);
        await unlink(state.temporary).catch(() => {});
      } catch (rollbackError) {
        rollbackErrors.push(String(rollbackError));
      }
    }
    if (rollbackErrors.length) throw new Error(`${String(error)}; rollback failures: ${rollbackErrors.join('; ')}`);
    throw error;
  }
  for (const state of states) if (state.backedUp) await unlink(state.backup).catch(() => {});
}

async function runCaptureCommitRollbackSelfTest() {
  const directory = await mkdtemp(resolve(tmpdir(), 'mirador-capture-transaction-'));
  try {
    const targets = ['source.png', 'scheme.webp', 'artifact.json'].map((name) => resolve(directory, name));
    for (const [index, target] of targets.entries()) await writeFile(target, `old-${index}`);
    const stage = async () => Promise.all(targets.map((target, index) => stageBuffer(target, Buffer.from(`new-${index}`), `fixture-${index}`)));
    try {
      await commitStagedFiles(await stage(), { failAfterCommits: 2 });
      throw new Error('Capture transaction fixture did not inject a middle failure');
    } catch (error) {
      if (!String(error).includes('Injected capture commit failure')) throw error;
    }
    for (const [index, target] of targets.entries()) {
      if (await readFile(target, 'utf8') !== `old-${index}`) throw new Error('Capture transaction did not restore every original after failure');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function validateCompanionEvidence(mapping) {
  const records = mapping.associations
    .filter((association) => association.expectedSnapshotMatch === false)
    .sort((left, right) => Number(left.number) - Number(right.number));
  if (records.length !== 10 || JSON.stringify(records.map((record) => record.number)) !== JSON.stringify(expectedCompanionNumbers)) {
    throw new Error('The public DOM companion evidence must contain the known 10 apartments outside the locked snapshot');
  }
  for (const record of records) {
    const expected = locationForUnitNumber(Number(record.number));
    if (record.entrance !== expected.entrance || record.floor !== expected.floor || !Number.isFinite(record.area) || !Number.isInteger(record.rooms)) {
      throw new Error(`Companion evidence ${record.number} does not match the official entrance/floor universe`);
    }
  }
  const body = `${records.map((record) => `${record.number}\t${record.entrance}\t${record.floor}\t${record.area}\t${record.rooms}`).join('\n')}\n`;
  return { records, body, byteSha256: sha256(Buffer.from(body)) };
}

const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
const catalog = JSON.parse(await readFile(resolve(websiteRoot, 'data/kayan-catalog.json'), 'utf8'));
const bundle = catalog.projects.find((item) => item.project.slug === 'mirador');
if (!bundle || bundle.units.length !== 199) throw new Error('Official capture import requires the locked 199-unit Mirador catalog snapshot');
const snapshotByNumber = new Map(bundle.units.map((unit) => [unit.number, unit]));
if (snapshotByNumber.size !== 199) throw new Error('Locked Mirador snapshot contains duplicate apartment numbers');
const companion = validateCompanionEvidence(mapping);
await runCaptureCommitRollbackSelfTest();
const companionByNumber = new Map(companion.records.map((record) => [record.number, record]));

const assignments = Array.from({ length: 209 }, (_, index) => {
  const unitNumber = String(index + 1);
  const expected = locationForUnitNumber(index + 1);
  const snapshotUnit = snapshotByNumber.get(unitNumber);
  if (snapshotUnit) {
    if (snapshotUnit.entrance !== expected.entrance || snapshotUnit.floor !== expected.floor || typeof snapshotUnit.sourceKey !== 'string' || !snapshotUnit.sourceKey) {
      throw new Error(`Locked snapshot apartment ${unitNumber} does not match its official floor assignment`);
    }
    return { entrance: expected.entrance, floor: expected.floor, unitNumber, unitKey: snapshotUnit.sourceKey, evidence: 'locked-snapshot' };
  }
  if (!companionByNumber.has(unitNumber)) throw new Error(`Apartment ${unitNumber} is absent from both the locked snapshot and official companion evidence`);
  return { entrance: expected.entrance, floor: expected.floor, unitNumber, unitKey: null, evidence: 'official-public-companion' };
});
if (assignments.filter((assignment) => assignment.unitKey === null).length !== 10) throw new Error('Expected exactly 10 companion-only floor assignments');

const expectedManifest = {
  schemaVersion: 2,
  projectSlug: 'mirador',
  sourceObservedAt: captureObservedAt,
  schemeCount: 34,
  unitCount: 209,
  lockedSnapshotUnitCount: 199,
  companionUnitCount: 10,
  assignments,
};
const expectedManifestBody = Buffer.from(`${JSON.stringify(expectedManifest, null, 2)}\n`);
const expectedManifestByteSha256 = sha256(expectedManifestBody);
const companionSummary = {
  source: 'mirador-plans-public-dom-v1',
  sourceObservedAt: mapping.capturedAt,
  recordCount: 10,
  unitNumbers: expectedCompanionNumbers,
  recordsSha256: companion.byteSha256,
};

const token = `${process.pid}-${Date.now()}`;
const staged = [];
const schemes = [];
try {
  for (const { entrance, floor } of expectedSchemeCombos()) {
    const fileName = sourceFileName(entrance, floor);
    const sourcePath = resolve(captureDirectory, fileName);
    if (!sourcePath.startsWith(`${captureDirectory}${sep}`)) throw new Error(`Unsafe source screenshot path ${sourcePath}`);
    const sourceBody = await readFile(sourcePath);
    if (sourceBody[0] !== 0xff || sourceBody[1] !== 0xd8 || sourceBody[2] !== 0xff) throw new Error(`${fileName} does not preserve the supplied JPEG magic bytes`);
    const sourceMetadata = await sharp(sourceBody).metadata();
    if (sourceMetadata.format !== 'jpeg' || sourceMetadata.width !== 1661 || sourceMetadata.height !== 811) {
      throw new Error(`${fileName} must be the official 1661x811 capture (the supplied .png-named files contain JPEG bytes)`);
    }
    let detectionHeight = canvas.height;
    let canvasRaster = await sharp(sourceBody)
      .extract({ left: canvas.x, top: canvas.y, width: canvas.width, height: canvas.height })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    let tightCrop = detectTightCrop(canvasRaster.data, canvasRaster.info.width, canvasRaster.info.height, canvasRaster.info.channels);
    if (tightCrop.componentBounds.y + tightCrop.componentBounds.height >= canvas.height - 1) {
      detectionHeight = extendedDetectionHeight;
      canvasRaster = await sharp(sourceBody)
        .extract({ left: canvas.x, top: canvas.y, width: canvas.width, height: detectionHeight })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      tightCrop = detectTightCrop(canvasRaster.data, canvasRaster.info.width, canvasRaster.info.height, canvasRaster.info.channels);
      if (tightCrop.componentBounds.y + tightCrop.componentBounds.height >= detectionHeight - 1) {
        throw new Error(`${fileName} plan component still touches the audited extended detection boundary`);
      }
    }
    tightCrop.detectionHeight = detectionHeight;
    const derivedBody = await sharp(sourceBody)
      .extract({ left: canvas.x + tightCrop.x, top: canvas.y + tightCrop.y, width: tightCrop.width, height: tightCrop.height })
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    const derivedMetadata = await sharp(derivedBody).metadata();
    if (derivedMetadata.format !== 'webp' || derivedMetadata.width !== tightCrop.width || derivedMetadata.height !== tightCrop.height || derivedBody.length < 1024) {
      throw new Error(`Derived floor scheme ${entrance}/${floor} failed its image manifest check`);
    }
    const unitNumbers = unitNumbersForScheme(entrance, floor);
    const centers = centersForScheme(entrance, floor);
    if (unitNumbers.length !== centers.length) throw new Error(`Hotspot geometry count differs for entrance ${entrance}, floor ${floor}`);
    const zones = unitNumbers.map((number, index) => {
      const assignment = assignments[number - 1];
      if (assignment.entrance !== entrance || assignment.floor !== floor) throw new Error(`Assignment ${number} is in the wrong scheme`);
      return {
        unitKey: assignment.unitKey,
        unitNumber: String(number),
        ...squareHotspot(centers[index], tightCrop, tightCrop.width, tightCrop.height),
      };
    });
    const rawScreenshotTarget = resolve(rawScreenshotRoot, fileName);
    const publicTarget = resolve(publicSchemeRoot, imageFileName(entrance, floor));
    staged.push(await stageBuffer(rawScreenshotTarget, sourceBody, `${token}-raw-${entrance}-${floor}`));
    staged.push(await stageBuffer(publicTarget, derivedBody, `${token}-webp-${entrance}-${floor}`));
    schemes.push({
      entrance,
      floor,
      imageUrl: `${publicImagePathPrefix}${imageFileName(entrance, floor)}`,
      imageSha256: sha256(derivedBody),
      imageBytes: derivedBody.length,
      width: tightCrop.width,
      height: tightCrop.height,
      sourceScreenshot: {
        path: `${sourceScreenshotPathPrefix}${fileName}`,
        sha256: sha256(sourceBody),
        bytes: sourceBody.length,
        mediaType: 'image/jpeg',
        width: sourceMetadata.width,
        height: sourceMetadata.height,
        canvas,
        tightCrop,
      },
      zones,
    });
  }

  const declaredFloors = schemes.map(({ entrance, floor }) => ({ entrance, floor }));
  const declaredUnitHotspots = schemes.flatMap((scheme) => scheme.zones.map((zone) => ({
    entrance: scheme.entrance,
    floor: scheme.floor,
    unitNumber: zone.unitNumber,
  })));
  if (schemes.length !== 34 || declaredUnitHotspots.length !== 209) throw new Error('Official capture must contain exactly 34 schemes and 209 hotspots');
  if (new Set(declaredUnitHotspots.map((item) => item.unitNumber)).size !== 209) throw new Error('Official capture unit-number universe is not exactly unique');

  const rawArtifact = {
    schemaVersion: 2,
    projectSlug: 'mirador',
    capturedAt: captureObservedAt,
    captureStatus: 'captured-complete',
    captureScope: {
      mode: 'complete',
      declaredBlocks: [],
      declaredEntrances: ['1', '2', '3'],
      declaredFloors,
      declaredUnitHotspots,
      schemeCount: 34,
      hotspotCount: 209,
      auditedExclusions: [],
    },
    source: {
      observedAt: captureObservedAt,
      status: 'captured-read-only',
      tenantOrigin: 'https://pb21432.profitbase.ru',
      houseId: 154813,
      accountId: 21432,
      routes: {
        catalog: '/eco/catalog/house/154813/smallGrid?accountId=21432&context=agencyOffice',
        floor: '/api/v4/json/floor?houseId=154813',
        board: '/board?houseId=154813',
        facade: '/facade?houseId=154813',
      },
      method: 'Authenticated read-only KAYAN/Profitbase browser capture. Thirty-four fully rendered official floor canvases were supplied in .png-named files whose preserved bytes are JPEG. Each public floor asset is a deterministic lossless WebP crop of the largest connected plan/wall component starting inside the audited 1501x439 canvas ROI; a component touching the lower ROI boundary is followed into a fixed extended source window. No plan pixels were redrawn.',
      note: 'The CRM exposes entrances 1-3 but no verified mapping from the seven visual hero blocks to entrances. blockEntranceMapping intentionally remains null. Hotspots are 44x44 square targets centered on the verified official apartment badge positions. No cookies, credentials, tokens or authentication headers are stored.',
    },
    validation: {
      lockedSnapshotCapturedAt: bundle.project.phases.find((phase) => phase.slug === 'main').updatedAt,
      lockedSnapshotRecordCount: 199,
      officialUniverseRecordCount: 209,
      companionEvidence: {
        path: 'expected/mirador-floor-scheme-companion-2026-08-31.tsv',
        byteSha256: companion.byteSha256,
      },
      schemeCount: 34,
      hotspotCount: 209,
      sourceScreenshotCount: 34,
      coordinateSystem: 'image-pixels',
      imagePathPrefix: publicImagePathPrefix,
      blockEntranceMapping: null,
      expectedUniverseManifest: {
        path: 'expected/mirador-floor-scheme-universe-2026-08-31.json',
        byteSha256: expectedManifestByteSha256,
      },
    },
    schemes,
  };

  const clientArtifact = {
    schemaVersion: 2,
    projectSlug: 'mirador',
    capturedAt: captureObservedAt,
    captureStatus: 'captured-complete',
    captureScope: rawArtifact.captureScope,
    sourceStatus: 'captured-read-only',
    sourceObservedAt: captureObservedAt,
    floorSchemeCount: 34,
    hotspotCount: 209,
    blockEntranceMapping: null,
    companionEvidence: companionSummary,
    schemes: schemes.map((scheme) => ({
      entrance: scheme.entrance,
      floor: scheme.floor,
      imageUrl: scheme.imageUrl,
      imageSha256: scheme.imageSha256,
      imageBytes: scheme.imageBytes,
      width: scheme.width,
      height: scheme.height,
      sourceScreenshotSha256: scheme.sourceScreenshot.sha256,
      sourceCrop: {
        x: canvas.x + scheme.sourceScreenshot.tightCrop.x,
        y: canvas.y + scheme.sourceScreenshot.tightCrop.y,
        width: scheme.sourceScreenshot.tightCrop.width,
        height: scheme.sourceScreenshot.tightCrop.height,
      },
      zones: scheme.zones,
    })),
    expectedUniverse: {
      sourceObservedAt: captureObservedAt,
      expectedManifestByteSha256,
      schemeCount: 34,
      unitCount: 209,
      lockedSnapshotUnitCount: 199,
      companionUnitCount: 10,
      assignments,
    },
  };
  const clientJSON = JSON.stringify(clientArtifact);
  if (/tenantOrigin|houseId|accountId|"routes"|sourceScreenshot"\s*:\s*\{|profitbase\.ru/i.test(clientJSON)) {
    throw new Error('Sanitized floor-scheme sidecar leaked private/raw source metadata');
  }

  staged.push(await stageBuffer(expectedManifestPath, expectedManifestBody, `${token}-universe`));
  staged.push(await stageBuffer(companionPath, Buffer.from(companion.body), `${token}-companion`));
  staged.push(await stageBuffer(floorMappingPath, Buffer.from(`${JSON.stringify(rawArtifact, null, 2)}\n`), `${token}-raw-artifact`));
  staged.push(await stageBuffer(clientPath, Buffer.from(`${JSON.stringify(clientArtifact, null, 2)}\n`), `${token}-client-artifact`));
  await commitStagedFiles(staged);

  console.log(JSON.stringify({
    captureDirectory,
    capturedAt: captureObservedAt,
    schemes: schemes.length,
    hotspots: declaredUnitHotspots.length,
    snapshotUnits: 199,
    companionUnits: 10,
    sourceScreenshots: schemes.length,
    expectedManifestByteSha256,
    companionRecordsSha256: companion.byteSha256,
  }, null, 2));
} catch (error) {
  for (const entry of staged) await unlink(entry.temporary).catch(() => {});
  throw error;
}
