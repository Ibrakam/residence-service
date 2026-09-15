#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { atomicRunDirectory, atomicWriteFile, jsonBody } from './atomic.mjs';
import { captureFiles, captureFromAuthorizedTab } from './capture.mjs';
import { captureFromDirectSource } from './direct.mjs';
import { mergeNrgBlockRegistries, nrgBiSeedBlockRegistry, normalizeNrgBlockRegistry } from './nrg-block-registry.mjs';
import {
  loadCaptureDirectory,
  loadLegacyProviderInput,
  normalizeKayanSnapshots,
  normalizeKayanPropertyResponses,
  normalizeMbcProfitbaseCapture,
  normalizeMbcProjects,
  normalizeNrgBiCapture,
  normalizeRegnumPages,
  normalizeSunPages,
  normalizeUysotTable,
} from './normalize.mjs';
import { getProvider, providerStatus } from './providers.mjs';

const repositoryRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

function usage() {
  return `Residence live-sync collector

Usage:
  node src/cli.mjs status [--json]
  node src/cli.mjs capture --provider ID [--cdp http://127.0.0.1:PORT] --output DIR [--timeout-ms N] [--no-reload]
  node src/cli.mjs collect --provider ID [--cdp http://127.0.0.1:PORT] --capture-output DIR --catalog-output DIR
  node src/cli.mjs dry-run --provider ID --input PATH [--legacy] [--template PATH]
  node src/cli.mjs normalize --provider ID --input PATH [--legacy] --output DIR [--template PATH]

The capture command attaches only to a loopback CDP endpoint and never reads
cookies, request headers, localStorage, sessionStorage, passwords, or tokens.
`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument ${arg}`);
    const key = arg.slice(2);
    if (['json', 'legacy', 'no-reload'].includes(key)) options[key] = true;
    else {
      const value = rest[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[key] = value;
    }
  }
  return { command, options };
}

function providerAlias(value) {
  if (value === 'regnum') return 'mbc';
  if (value === 'human2human') return 'sun';
  return value;
}

function isMbcProvider(providerId) {
  return providerId === 'mbc' || providerId === 'mbc-sarbon';
}

function validateTemplate(providerId, template, path, project = null) {
  if (providerId === 'kayan') {
    const projects = Array.isArray(template?.projects) ? template.projects : [];
    const slugs = new Set(projects.map((item) => item?.project?.slug));
    const layouts = projects.reduce((sum, item) => sum + (Array.isArray(item?.layouts) ? item.layouts.length : 0), 0);
    if (!slugs.has('mirador') || !slugs.has('ofiyat') || layouts === 0) throw new Error(`KAYAN enrichment template is incomplete: ${path}`);
  } else if (isMbcProvider(providerId)) {
    const units = Array.isArray(template?.units) ? template.units : [];
    const observedSlug = template?.projectSlug ?? template?.project?.slug;
    if (project && observedSlug !== project.slug) throw new Error(`MBC ${project.slug} enrichment template has unexpected project ${JSON.stringify(observedSlug)}: ${path}`);
    const ids = new Set();
    const crmIds = new Set();
    for (const unit of units) {
      const id = String(unit?.id ?? '').trim();
      if (!id || ids.has(id)) throw new Error(`MBC ${project?.slug ?? ''} enrichment template has invalid or duplicate unit IDs: ${path}`);
      ids.add(id);
      const crmId = String(unit?.crmId ?? unit?.sourceId ?? '').trim();
      if (crmId && crmIds.has(crmId)) throw new Error(`MBC ${project?.slug ?? ''} enrichment template has a duplicate CRM ID: ${path}`);
      if (crmId) crmIds.add(crmId);
    }
    const hasLocalPlan = units.some((unit) => ['planImageUrl', 'plan', 'planPublicPath', 'primaryPlanPath']
      .some((key) => typeof unit?.[key] === 'string' && unit[key].startsWith(`/${project.slug}/`) && !unit[key].startsWith('//')));
    if (!units.length || !hasLocalPlan) throw new Error(`MBC ${project?.slug ?? ''} enrichment template has no local plans: ${path}`);
  } else if (providerId === 'sun') {
    if (!Array.isArray(template?.units) || !template.units.some((unit) => typeof unit?.primaryPlanPath === 'string')) throw new Error(`SUN enrichment template has no plans: ${path}`);
  }
  return template;
}

export async function loadTemplate(providerId, explicitPath) {
  const defaults = {
    kayan: 'website/data/kayan-catalog.json',
    sun: 'website/data/sun-client.json',
  };
  if (isMbcProvider(providerId)) {
    const projects = getProvider(providerId).projectDefinitions;
    const templates = {};
    for (const project of projects) {
      const filename = project.templateFile;
      const explicitCandidate = explicitPath
        ? (basename(explicitPath).endsWith('.json') ? resolve(dirname(explicitPath), filename) : resolve(explicitPath, filename))
        : null;
      const candidates = explicitCandidate ? [explicitCandidate] : [
        ...(process.env.LIVE_SYNC_TEMPLATE_DIR ? [resolve(process.env.LIVE_SYNC_TEMPLATE_DIR, filename)] : []),
        resolve(packageRoot, 'templates', filename),
        resolve(process.cwd(), 'website/data', filename),
        resolve(repositoryRoot, 'website/data', filename),
      ];
      let found = false;
      for (const path of [...new Set(candidates)]) {
        try {
          templates[project.slug] = validateTemplate(providerId, JSON.parse(await readFile(path, 'utf8')), path, project);
          found = true;
          break;
        } catch (error) {
          if (error?.code === 'ENOENT' && !explicitPath) continue;
          throw error;
        }
      }
      if (!found) throw new Error(`${providerId}: required public enrichment template ${filename} is missing; set LIVE_SYNC_TEMPLATE_DIR or install it under ${packageRoot}/templates`);
    }
    return templates;
  }
  const relative = defaults[providerId];
  if (!relative) return null;
  const filename = basename(relative);
  const candidates = explicitPath ? [resolve(explicitPath)] : [
    ...(process.env.LIVE_SYNC_TEMPLATE_DIR ? [resolve(process.env.LIVE_SYNC_TEMPLATE_DIR, filename)] : []),
    resolve(packageRoot, 'templates', filename),
    resolve(process.cwd(), 'website/data', filename),
    resolve(repositoryRoot, relative),
  ];
  for (const path of [...new Set(candidates)]) {
    try {
      return validateTemplate(providerId, JSON.parse(await readFile(path, 'utf8')), path);
    } catch (error) {
      if (error?.code === 'ENOENT' && !explicitPath) continue;
      throw error;
    }
  }
  throw new Error(`${providerId}: required public enrichment template ${filename} is missing; set LIVE_SYNC_TEMPLATE_DIR or install it under ${packageRoot}/templates`);
}

function normalize(providerId, input, capturedAt, template, legacy = false) {
  if (providerId === 'uysot') return normalizeUysotTable(input, capturedAt);
  if (isMbcProvider(providerId)) {
    if (legacy) {
      if (providerId !== 'mbc') throw new Error(`${providerId}: legacy MBC captures are not supported`);
      const result = normalizeRegnumPages(input, capturedAt, template?.['regnum-plaza'] ?? null);
      return { artifacts: [{ filename: 'regnum-plaza-catalog.json', artifact: result.artifact }], audit: { 'regnum-plaza': result.audit } };
    }
    return normalizeMbcProfitbaseCapture(input, capturedAt, template, getProvider(providerId).projectDefinitions);
  }
  if (providerId === 'sun') return normalizeSunPages(input, capturedAt, template);
  if (providerId === 'kayan') return legacy ? normalizeKayanSnapshots(input, capturedAt, template) : normalizeKayanPropertyResponses(input, capturedAt, template);
  if (providerId === 'nrg-bi') return normalizeNrgBiCapture(input, capturedAt);
  throw new Error(`${providerId}: capture-only discovery adapter; no publishable normalizer exists`);
}

function inputFromCapture(providerId, capture) {
  if (providerId === 'uysot') {
    const record = capture.records.find((item) => item.method === 'POST' && item.url?.origin === 'https://service.app.uysot.uz' && item.url?.path === '/v1/smart-catalog/table');
    if (!record) throw new Error('Uysot capture does not contain the guarded table response');
    return record.value;
  }
  if (isMbcProvider(providerId)) {
    const provider = getProvider(providerId);
    const singleton = (endpoint) => {
      const records = capture.records.filter((item) => item.method === 'GET'
        && item.url?.origin === `https://${provider.profitbaseHost}`
        && item.scope?.endpoint === endpoint);
      if (records.length !== 1) throw new Error(`MBC Profitbase capture has ${records.length}/1 ${endpoint} responses`);
      return records[0].value;
    };
    const propertyRecords = capture.records.filter((item) => item.method === 'GET'
      && item.url?.origin === `https://${provider.profitbaseHost}`
      && item.url?.path === '/api/v4/json/property'
      && item.scope?.endpoint === 'properties');
    const expectedProjects = new Map(provider.projectDefinitions.map((project) => [project.slug, project]));
    for (const record of propertyRecords) {
      const project = expectedProjects.get(record.scope?.projectSlug);
      const house = project?.profitbaseHouses.find((candidate) => candidate.id === Number(record.scope?.houseId));
      if (!project || !house
        || Number(record.scope?.projectId) !== project.id
        || Number(record.scope?.profitbaseProjectId) !== project.profitbaseProjectId
        || String(record.scope?.queueSourceValue) !== house.queueSourceValue) {
        throw new Error('MBC Profitbase capture contains a property response outside the exact project/house scope');
      }
    }
    const groups = provider.projectDefinitions.map((project) => ({
      project,
      houses: project.profitbaseHouses.map((house) => {
        const records = propertyRecords
          .filter((item) => item.scope.projectSlug === project.slug && Number(item.scope.houseId) === house.id)
          .sort((left, right) => Number(left.scope.offset) - Number(right.scope.offset));
        if (records.length !== 1 || Number(records[0].scope.offset) !== 0) {
          throw new Error(`MBC Profitbase capture has ${records.length}/1 complete ${project.slug} house ${house.id} property responses`);
        }
        return { houseId: house.id, pages: records.map((item) => item.value) };
      }),
    }));
    const expectedPropertyRecords = groups.reduce((sum, group) => sum + group.houses.reduce((count, house) => count + house.pages.length, 0), 0);
    if (propertyRecords.length !== expectedPropertyRecords) throw new Error('MBC Profitbase capture contains duplicate or unexpected property responses');
    return {
      projects: singleton('projects'),
      houses: singleton('houses'),
      customStatuses: singleton('customStatuses'),
      groups,
    };
  }
  if (providerId === 'sun') {
    const pages = capture.records
      .filter((item) => item.scope?.endpoint === 'objects_list' && Array.isArray(item.value?.objects))
      .sort((left, right) => Number(left.scope.page) - Number(right.scope.page))
      .map((item, index) => {
        if (Number(item.scope.page) !== index) throw new Error('SUN pagination scope is not contiguous');
        return item.value;
      });
    if (!pages.length) throw new Error('SUN capture has no objects_list responses');
    return pages;
  }
  if (providerId === 'kayan') {
    const responses = capture.records
      .filter((item) => item.method === 'GET' && item.url?.origin === 'https://pb21432.profitbase.ru' && item.url?.path === '/api/v4/json/property')
      .map((item) => item.value);
    if (responses.length !== 4) throw new Error(`KAYAN capture has ${responses.length}/4 required property responses`);
    return responses;
  }
  if (providerId === 'nrg-bi') {
    const provider = getProvider(providerId);
    const expectedProjectSlugs = new Set(provider.projectDefinitions.map((project) => project.slug));
    const registryRecords = capture.records.filter((item) => item.method === 'DERIVED'
      && item.url?.origin === 'https://apigw.bi.group'
      && item.url?.path === '/sales-picker/microfe-v3/realEstateList'
      && item.scope?.endpoint === 'blockRegistry'
      && item.scope?.derived === true);
    if (registryRecords.length !== 1) throw new Error(`NRG capture has ${registryRecords.length}/1 block registry candidate records`);
    const blockRegistry = normalizeNrgBlockRegistry(registryRecords[0].value, 'NRG capture block registry');
    const matrixRecords = capture.records.filter((item) => item.scope?.endpoint === 'blockMatrix');
    for (const record of matrixRecords) {
      if (record.method !== 'POST'
        || record.url?.origin !== 'https://apigw.bi.group'
        || record.url?.path !== '/sales-picker/microfe-v3/blockMatrix'
        || !expectedProjectSlugs.has(record.scope?.projectSlug)) {
        throw new Error('NRG capture contains a blockMatrix response outside the exact provider/project scope');
      }
    }
    let expectedMatrixRecords = 0;
    const groups = provider.projectDefinitions.map((project) => {
      const pageRecords = capture.records
        .filter((item) => item.scope?.projectSlug === project.slug && item.scope?.endpoint === 'placementList')
        .sort((left, right) => Number(left.scope.page) - Number(right.scope.page));
      const pages = pageRecords.map((item, index) => {
        if (item.method !== 'POST' || item.url?.origin !== 'https://apigw.bi.group' || item.url?.path !== '/sales-picker/microfe-v3/placementList') {
          throw new Error(`NRG ${project.slug} placementList response is outside the exact endpoint scope`);
        }
        if (Number(item.scope.page) !== index + 1) throw new Error(`NRG ${project.slug} pagination scope is not contiguous`);
        return item.value;
      });
      const realEstateRecords = capture.records.filter((item) => item.scope?.projectSlug === project.slug && item.scope?.endpoint === 'realEstateList');
      if (realEstateRecords.length !== 1) throw new Error(`NRG ${project.slug} has ${realEstateRecords.length} realEstateList responses`);
      const realEstateRecord = realEstateRecords[0];
      if (realEstateRecord.method !== 'POST' || realEstateRecord.url?.origin !== 'https://apigw.bi.group' || realEstateRecord.url?.path !== '/sales-picker/microfe-v3/realEstateList') {
        throw new Error(`NRG ${project.slug} realEstateList response is outside the exact endpoint scope`);
      }
      const estate = realEstateRecord.value?.realEstates?.find((item) => item?.uuid === project.realEstateUUID);
      if (!estate || !Array.isArray(estate.blocks) || estate.blocks.length === 0) throw new Error(`NRG ${project.slug} realEstateList has no requested-project block universe`);
      const requiredProject = blockRegistry.projects[project.slug];
      if (!requiredProject || requiredProject.realEstateUUID !== project.realEstateUUID) throw new Error(`NRG ${project.slug} block registry project identity mismatch`);
      const blocks = new Map();
      for (const [index, block] of requiredProject.blocks.entries()) {
        const blockId = String(block?.id ?? '').trim();
        if (!blockId || blocks.has(blockId)) throw new Error(`NRG ${project.slug} block registry has an invalid or duplicate block identity`);
        blocks.set(blockId, { block, index: index + 1 });
      }
      for (const block of estate.blocks) {
        const expected = blocks.get(String(block?.id ?? '').trim());
        if (!expected || expected.block.name !== block.name) throw new Error(`NRG ${project.slug} realEstateList block is outside or conflicts with the trusted registry candidate`);
      }
      expectedMatrixRecords += blocks.size;
      const projectMatrices = matrixRecords.filter((item) => item.scope.projectSlug === project.slug);
      if (projectMatrices.length !== blocks.size) throw new Error(`NRG ${project.slug} has ${projectMatrices.length}/${blocks.size} required blockMatrix responses`);
      const snapshotAttempts = new Set([...projectMatrices, ...pageRecords].map((item) => Number(item.scope?.consistencyAttempt)));
      if (snapshotAttempts.size !== 1) throw new Error(`NRG ${project.slug} capture mixes bounded consistency attempts`);
      const [consistencyAttempt] = snapshotAttempts;
      if (!Number.isSafeInteger(consistencyAttempt) || consistencyAttempt < 1 || consistencyAttempt > provider.consistencyAttempts) {
        throw new Error(`NRG ${project.slug} capture has an invalid bounded consistency attempt`);
      }
      const matrixByBlock = new Map();
      for (const record of projectMatrices) {
        const blockId = String(record.scope?.blockId ?? '').trim();
        const expected = blocks.get(blockId);
        if (!expected || matrixByBlock.has(blockId) || Number(record.scope?.blockIndex) !== expected.index) {
          throw new Error(`NRG ${project.slug} blockMatrix scope is missing, duplicated, or outside realEstateList`);
        }
        matrixByBlock.set(blockId, record.value);
      }
      const blockMatrices = [...blocks.keys()].map((blockId) => matrixByBlock.get(blockId));
      let planAssets;
      if (project.slug === '4u') {
        const auditRecords = capture.records.filter((item) => item.method === 'DERIVED'
          && item.url?.origin === 'https://s3.bi.group'
          && item.url?.path === '/crm-clients-e1csales/layouts/'
          && item.scope?.projectSlug === '4u'
          && item.scope?.endpoint === 'planAssetAudit'
          && item.scope?.derived === true);
        if (auditRecords.length !== 1) throw new Error(`NRG 4u has ${auditRecords.length}/1 plan asset audit records`);
        planAssets = auditRecords[0].value;
      }
      return {
        project,
        apartmentPropertyTypeUUID: provider.apartmentPropertyTypeUUID,
        pages,
        realEstate: realEstateRecord.value,
        requiredBlocks: requiredProject.blocks,
        blockMatrices,
        consistencyAttempt,
        ...(planAssets ? { planAssets } : {}),
      };
    });
    if (matrixRecords.length !== expectedMatrixRecords) throw new Error(`NRG capture has ${matrixRecords.length}/${expectedMatrixRecords} exact blockMatrix records`);
    return groups;
  }
  throw new Error(`${providerId}: current authenticated response contract is still discovery-only`);
}

function artifactFilename(providerId) {
  return {
    uysot: 'avalon-units.json',
    sun: 'sun-catalog.json',
    kayan: 'kayan-catalog.json',
  }[providerId];
}

function artifactEntries(providerId, result) {
  if (isMbcProvider(providerId) || providerId === 'nrg-bi') return result.artifacts;
  return [{ filename: artifactFilename(providerId), artifact: result.artifact }];
}

function isDirectProvider(provider) {
  return ['public-read-post', 'signed-public-read-post'].includes(provider.captureMode);
}

function nrgPlanCachePath(root) {
  return resolve(root, 'nrg-bi', 'plan-assets-cache.json');
}

function nrgBlockRegistryPath(root) {
  return resolve(root, 'nrg-bi', 'block-registry.json');
}

async function loadNrgPlanAssetCache(root) {
  if (!root) return null;
  const path = nrgPlanCachePath(root);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 8 * 1024 * 1024) return null;
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Missing, corrupt, oversized, or special caches fail closed to a fresh
    // source audit; they never prevent current catalogue collection.
    return null;
  }
}

async function loadNrgBlockRegistry(root) {
  if (!root) return normalizeNrgBlockRegistry(nrgBiSeedBlockRegistry);
  const path = nrgBlockRegistryPath(root);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 1024 * 1024) {
      throw new Error(`NRG block registry is not a safe bounded regular file: ${path}`);
    }
    const persisted = normalizeNrgBlockRegistry(JSON.parse(await readFile(path, 'utf8')), 'NRG persisted block registry');
    return mergeNrgBlockRegistries(nrgBiSeedBlockRegistry, persisted);
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeNrgBlockRegistry(nrgBiSeedBlockRegistry);
    throw error;
  }
}

function planAssetAuditFromCapture(capture) {
  const records = capture.records.filter((item) => item.method === 'DERIVED'
    && item.url?.origin === 'https://s3.bi.group'
    && item.url?.path === '/crm-clients-e1csales/layouts/'
    && item.scope?.projectSlug === '4u'
    && item.scope?.endpoint === 'planAssetAudit'
    && item.scope?.derived === true);
  return records.length === 1 ? records[0].value : null;
}

function blockRegistryFromCapture(capture) {
  const records = capture.records.filter((item) => item.method === 'DERIVED'
    && item.url?.origin === 'https://apigw.bi.group'
    && item.url?.path === '/sales-picker/microfe-v3/realEstateList'
    && item.scope?.endpoint === 'blockRegistry'
    && item.scope?.derived === true);
  return records.length === 1 ? normalizeNrgBlockRegistry(records[0].value, 'NRG captured block registry') : null;
}

async function persistNrgCaches(providerId, root, capture) {
  if (providerId !== 'nrg-bi' || !root) return;
  const audit = planAssetAuditFromCapture(capture);
  if (!audit) throw new Error('NRG 4u plan asset audit is unavailable for cache persistence');
  const registry = blockRegistryFromCapture(capture);
  if (!registry) throw new Error('NRG block registry is unavailable for cache persistence');
  await atomicWriteFile(nrgPlanCachePath(root), jsonBody(audit));
  await atomicWriteFile(nrgBlockRegistryPath(root), jsonBody(mergeNrgBlockRegistries(nrgBiSeedBlockRegistry, registry)));
}

async function captureProvider(provider, options) {
  if (isDirectProvider(provider)) {
    const captureRoot = options['capture-output'] ?? options.output;
    const planAssetCache = provider.id === 'nrg-bi' ? await loadNrgPlanAssetCache(captureRoot) : null;
    const blockRegistry = provider.id === 'nrg-bi' ? await loadNrgBlockRegistry(captureRoot) : null;
    return captureFromDirectSource(provider, { planAssetCache, blockRegistry });
  }
  if (!options.cdp) throw new Error(`${provider.id}: browser capture requires --cdp`);
  return captureFromAuthorizedTab(provider, {
    cdpEndpoint: options.cdp,
    targetId: options['target-id'] ?? null,
    timeoutMs: Number(options['timeout-ms'] ?? 45_000),
    reload: !options['no-reload'],
  });
}

async function statusCommand(json) {
  const rows = providerStatus();
  if (json) process.stdout.write(jsonBody(rows));
  else for (const row of rows) {
    process.stdout.write(`${row.id.padEnd(8)} ${row.maturity.padEnd(30)} projects=${row.projects.join(',') || '(unmapped)'}${row.blocker ? `\n  gap: ${row.blocker}` : ''}\n`);
  }
}

async function captureCommand(options) {
  const providerId = providerAlias(options.provider);
  const provider = getProvider(providerId);
  if (!options.output) throw new Error('capture requires --output');
  const capture = await captureProvider(provider, options);
  const files = captureFiles(capture);
  let normalized = null;
  if (provider.maturity !== 'discovery') {
    try {
      const template = await loadTemplate(providerId, options.template);
      normalized = normalize(providerId, inputFromCapture(providerId, capture), capture.capturedAt, template);
      for (const artifact of artifactEntries(providerId, normalized)) files.push([`artifacts/${artifact.filename}`, jsonBody(artifact.artifact)]);
      files.push(['completeness.json', jsonBody(normalized.audit)]);
    } catch (error) {
      capture.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (normalized && capture.errors.length === 0) files.push(['success.json', jsonBody({ provider: providerId, complete: true })]);
  // Regenerate index after normalization errors were appended.
  const finalFiles = [...captureFiles(capture), ...files.filter(([path]) => path.startsWith('artifacts/') || path === 'completeness.json' || path === 'success.json')];
  if (normalized && capture.errors.length === 0) await persistNrgCaches(providerId, options.output, capture);
  const destination = await atomicRunDirectory(options.output, providerId, finalFiles);
  process.stdout.write(jsonBody({ provider: providerId, destination, responseBodies: capture.records.length, blockedRequests: capture.blocked.length, errors: capture.errors, normalized: Boolean(normalized), audit: normalized?.audit ?? null }));
  if ((!normalized || capture.errors.length) && provider.maturity !== 'discovery') process.exitCode = 2;
}

async function collectCommand(options) {
  const providerId = providerAlias(options.provider);
  const provider = getProvider(providerId);
  if (!options['capture-output'] || !options['catalog-output']) {
    throw new Error('collect requires --capture-output and --catalog-output');
  }
  if (provider.maturity === 'discovery') throw new Error(provider.blocker ?? `${providerId}: discovery-only adapter`);
  const template = await loadTemplate(providerId, options.template);
  const capture = await captureProvider(provider, options);
  let result;
  try {
    result = normalize(providerId, inputFromCapture(providerId, capture), capture.capturedAt, template);
  } catch (error) {
    capture.errors.push(error instanceof Error ? error.message : String(error));
  }
  const evidenceFiles = captureFiles(capture);
  if (result) {
    evidenceFiles.push(['completeness.json', jsonBody(result.audit)]);
    for (const entry of artifactEntries(providerId, result)) evidenceFiles.push([`artifacts/${entry.filename}`, jsonBody(entry.artifact)]);
  }
  if (result && capture.errors.length === 0) evidenceFiles.push(['success.json', jsonBody({ provider: providerId, complete: true })]);
  const captureDestination = await atomicRunDirectory(options['capture-output'], providerId, evidenceFiles);
  if (!result || capture.errors.length) {
    throw new Error(`${providerId}: no complete publishable catalogue; evidence=${captureDestination}; errors=${capture.errors.join('; ') || '(none)'}`);
  }
  const artifacts = [];
  for (const entry of artifactEntries(providerId, result)) {
    const catalogPath = resolve(options['catalog-output'], entry.filename);
    await atomicWriteFile(catalogPath, jsonBody(entry.artifact));
    artifacts.push(catalogPath);
  }
  await persistNrgCaches(providerId, options['capture-output'], capture);
  process.stdout.write(jsonBody({ provider: providerId, artifacts, evidence: captureDestination, audit: result.audit }));
}

async function normalizeCommand(command, options) {
  const providerId = providerAlias(options.provider);
  const provider = getProvider(providerId);
  if (!options.input) throw new Error(`${command} requires --input`);
  if (provider.maturity === 'discovery' && providerId !== 'kayan') throw new Error(provider.blocker ?? `${providerId}: discovery-only`);
  const template = await loadTemplate(providerId, options.template);
  let input;
  let capturedAt = new Date().toISOString();
  if (options.legacy) input = await loadLegacyProviderInput(providerId, options.input);
  else {
    const capture = await loadCaptureDirectory(options.input);
    capturedAt = capture.capturedAt;
    input = inputFromCapture(providerId, capture);
  }
  const result = normalize(providerId, input, capturedAt, template, Boolean(options.legacy));
  if (command === 'dry-run') {
    process.stdout.write(jsonBody({ provider: providerId, artifacts: artifactEntries(providerId, result).map((entry) => entry.filename), audit: result.audit, write: false }));
    return;
  }
  if (!options.output) throw new Error('normalize requires --output');
  const destination = await atomicRunDirectory(options.output, providerId, [
    ...artifactEntries(providerId, result).map((entry) => [`artifacts/${entry.filename}`, jsonBody(entry.artifact)]),
    ['completeness.json', jsonBody(result.audit)],
    ['success.json', jsonBody({ provider: providerId, complete: true })],
  ]);
  process.stdout.write(jsonBody({ provider: providerId, artifacts: artifactEntries(providerId, result).map((entry) => entry.filename), destination, audit: result.audit }));
}

export async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(usage());
    return;
  }
  if (command === 'status') return statusCommand(options.json);
  if (command === 'capture') return captureCommand(options);
  if (command === 'collect') return collectCommand(options);
  if (command === 'dry-run' || command === 'normalize') return normalizeCommand(command, options);
  throw new Error(`Unknown command ${command}\n\n${usage()}`);
}

function canonicalModuleUrl(value) {
  try { return pathToFileURL(realpathSync(resolve(value))).href; } catch { return ''; }
}

const invoked = process.argv[1] ? canonicalModuleUrl(process.argv[1]) : '';
if (invoked === canonicalModuleUrl(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`live-sync: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
