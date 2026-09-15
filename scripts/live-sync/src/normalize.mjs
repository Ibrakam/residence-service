import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { opaqueMbcSourceKey, templateMbcSourceKey } from './mbc-identity.mjs';
import { expectedNrgOriginalUrl, expectedNrgPlanUrl, nrgPlanAssetGeometryValid, nrgPlanVariants } from './nrg-plan-assets.mjs';
import { mbcProjects, nrgBiApartmentPropertyTypeUUID, nrgBiProjects } from './providers.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function integer(value) { const number = Number(value); return Number.isSafeInteger(number) ? number : null; }
function positive(value) { const number = finite(value); return number !== null && number > 0 ? number : null; }
function optionalPositive(value) { return value === null || value === undefined || value === '' ? null : positive(value); }

function status(value) {
  switch (String(value ?? '').trim().toUpperCase()) {
    case 'SALE': case 'AVAILABLE': case 'FREE': case 'СВОБОДНО': return 'available';
    case 'BOOKED': case 'BOOKING': case 'RESERVED': case 'БРОНЬ': case 'ДОГОВОР СОСТАВЛЕН': case 'ДОГОВОР СОГЛАСОВАН': return 'reserved';
    case 'SOLD': case 'ПРОДАНО': return 'sold';
    case 'OCCUPIED': case 'ЗАНЯТО': case 'ЗАКРЫТО': case 'РУКОВОДСТВО': return 'unavailable';
    default: return 'unknown';
  }
}

function numberText(value, label) {
  const text = String(value ?? '').trim();
  assert(text, `${label} is empty`);
  return text;
}

function parsePriceText(value) {
  const digits = String(value ?? '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function statusCounts(units) {
  const result = {};
  for (const unit of units) result[unit.status] = (result[unit.status] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function completeness({ expected, units, identities, extra = {} }) {
  return {
    complete: units.length === expected && identities.size === units.length,
    expectedRecords: expected,
    observedRecords: units.length,
    uniqueIdentities: identities.size,
    statusCounts: statusCounts(units),
    ...extra,
  };
}

export function normalizeUysotTable(root, capturedAt = new Date().toISOString()) {
  assert(record(root), 'Uysot response root must be an object');
  assert(root.accept === true, 'Uysot response accept must be true');
  assert(!root.errorMessage, 'Uysot response has errorMessage');
  assert(!Array.isArray(root.errors) || root.errors.length === 0, 'Uysot response has errors');
  const envelope = root.data;
  assert(record(envelope), 'Uysot response data envelope is missing');
  assert(Array.isArray(envelope.data), 'Uysot response data.data must be an array');
  const totalElements = integer(envelope.totalElements);
  assert(totalElements !== null && totalElements >= 0, 'Uysot totalElements is invalid');
  assert(integer(envelope.totalPages) === 1, 'Uysot size=500 response must contain exactly one page');
  assert(integer(envelope.currentPage) === 1, 'Uysot currentPage must be 1');
  assert(envelope.data.length === totalElements, `Uysot returned ${envelope.data.length} rows but declared ${totalElements}`);
  assert(totalElements >= 268, `Uysot row count ${totalElements} is below the approved completeness floor 268`);

  const officialIds = new Set();
  const buildingNumbers = new Set();
  const buildings = new Set();
  const companyIds = new Set();
  const units = envelope.data.map((row, index) => {
    assert(record(row), `Uysot row ${index + 1} must be an object`);
    const officialId = integer(row.id);
    const houseId = integer(row.houseId);
    const buildingId = integer(row.buildingId);
    const companyId = integer(row.companyId);
    const floor = integer(row.floor);
    const rooms = integer(row.rooms);
    const area = positive(row.area);
    const building = numberText(row.buildingName, `Uysot row ${index + 1}.buildingName`);
    const number = numberText(row.number, `Uysot row ${index + 1}.number`);
    assert(officialId !== null && officialId > 0, `Uysot row ${index + 1}.id is invalid`);
    assert(houseId === 1074, `Uysot row ${officialId} belongs to unexpected house ${houseId}`);
    assert(buildingId !== null && buildingId > 0, `Uysot row ${officialId}.buildingId is invalid`);
    assert(companyId !== null && companyId > 0, `Uysot row ${officialId}.companyId is invalid`);
    assert(floor !== null && floor >= 0, `Uysot row ${officialId}.floor is invalid`);
    assert(rooms !== null && rooms >= 0, `Uysot row ${officialId}.rooms is invalid`);
    assert(area !== null, `Uysot row ${officialId}.area is invalid`);
    assert(typeof row.apartment === 'boolean' && typeof row.repaired === 'boolean', `Uysot row ${officialId} apartment/repair flags are invalid`);
    const normalizedStatus = status(row.commerceStatus);
    assert(normalizedStatus !== 'unknown', `Uysot row ${officialId} has unknown commerceStatus ${JSON.stringify(row.commerceStatus)}`);
    assert(!officialIds.has(officialId), `Uysot duplicate official id ${officialId}`);
    const buildingNumber = `${buildingId}\u001f${number}`;
    assert(!buildingNumbers.has(buildingNumber), `Uysot duplicate building/number ${building}/${number}`);
    officialIds.add(officialId);
    buildingNumbers.add(buildingNumber);
    buildings.add(building);
    companyIds.add(companyId);

    const pricePerM2 = row.repaired ? optionalPositive(row.pricePeraAreaRepaired) : optionalPositive(row.pricePerAreaNotRepaired);
    const price = row.repaired ? optionalPositive(row.priceRepaired) : optionalPositive(row.priceNotRepaired);
    return {
      id: String(officialId),
      legacyId: `${building}-${number}`,
      sourceKey: `uysot:${officialId}`,
      projectSlug: 'avalon-residence',
      phaseSlug: `building-${buildingId}`,
      phaseName: building,
      houseId,
      companyId,
      buildingId,
      building,
      entrance: String(row.entrance ?? ''),
      number,
      floor,
      rooms,
      area,
      totalArea: positive(row.totalArea) ?? area,
      apartment: row.apartment,
      propertyType: row.apartment ? 'apartment' : 'commercial',
      repair: row.repaired ? 'С ремонтом' : 'Без ремонта',
      repaired: row.repaired,
      status: normalizedStatus,
      rawStatus: String(row.commerceStatus),
      pricePerM2,
      price,
      currency: String(row.currency?.ccy || 'UZS'),
      isSale: normalizedStatus === 'available',
    };
  });
  for (const expected of ['B1', 'A', 'B2']) assert(buildings.has(expected), `Uysot response is missing building ${expected}`);
  assert(companyIds.size === 1 && companyIds.has(504), `Uysot response has unexpected company IDs: ${[...companyIds].join(', ')}`);
  const audit = completeness({
    expected: totalElements,
    units,
    identities: officialIds,
    extra: { uniqueBuildingNumbers: buildingNumbers.size, buildings: [...buildings].sort(), companyId: 504, houseId: 1074 },
  });
  assert(audit.complete, 'Uysot completeness checks failed');
  return {
    artifact: {
      capturedAt,
      sourceCount: totalElements,
      houseId: 1074,
      companyId: 504,
      source: 'https://app.uysot.uz/showroom/',
      completeness: audit,
      units,
    },
    audit,
  };
}

function localPlanPath(unit, projectSlug) {
  for (const key of ['planImageUrl', 'plan', 'planPublicPath', 'primaryPlanPath']) {
    const value = unit?.[key];
    if (typeof value === 'string' && value.startsWith(`/${projectSlug}/`) && !value.startsWith('//')) return value;
  }
  return null;
}

function mbcUnitSignature(unit) {
  const number = String(unit?.number ?? '').trim();
  const rooms = integer(unit?.rooms);
  const area = positive(unit?.square ?? unit?.area);
  const floor = integer(unit?.floor);
  const queue = String(unit?.queue ?? unit?.phase ?? '').trim();
  const section = String(unit?.section ?? '').trim();
  if (!number || rooms === null || area === null || floor === null || !queue || !section) return null;
  return [number, rooms, area.toFixed(4), floor, queue, section].join('\u001f');
}

function mbcPhasePart(value, label) {
  const text = numberText(value, label);
  assert(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/i.test(text), `${label} contains unsupported characters`);
  return { text, slug: text.toLowerCase().replaceAll('_', '-'), value: integer(text) ?? text };
}

function mbcTemplateLookup(template) {
  const byCrmId = new Map();
  const bySignature = new Map();
  const ambiguousSignatures = new Set();
  for (const unit of template?.units ?? []) {
    const crmId = String(unit?.crmId ?? unit?.sourceId ?? '').trim();
    if (crmId) byCrmId.set(crmId, unit);
    const signature = mbcUnitSignature(unit);
    if (!signature) continue;
    if (bySignature.has(signature)) ambiguousSignatures.add(signature);
    else bySignature.set(signature, unit);
  }
  for (const signature of ambiguousSignatures) bySignature.delete(signature);
  return (row, crmId) => byCrmId.get(crmId) ?? bySignature.get(mbcUnitSignature(row)) ?? {};
}

function mbcQueueDefinitions(project) {
  assert(Array.isArray(project?.queues) && project.queues.length > 0, `MBC ${project?.slug ?? '(unknown)'} queue metadata is missing`);
  const bySourceValue = new Map();
  const keys = new Set();
  const orders = new Set();
  for (const definition of project.queues) {
    assert(record(definition), `MBC ${project.slug} queue metadata row is invalid`);
    const sourceValue = numberText(definition.sourceValue, `MBC ${project.slug} queue sourceValue`);
    const queueKey = numberText(definition.queueKey, `MBC ${project.slug} queueKey`);
    const queueLabel = numberText(definition.queueLabel, `MBC ${project.slug} queueLabel`);
    const queueDisplayCode = numberText(definition.queueDisplayCode, `MBC ${project.slug} queueDisplayCode`);
    const queueOrder = integer(definition.queueOrder);
    assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(queueKey), `MBC ${project.slug} queueKey ${queueKey} is invalid`);
    assert(queueOrder !== null && queueOrder > 0, `MBC ${project.slug} queue ${queueKey} order is invalid`);
    assert(!bySourceValue.has(sourceValue), `MBC ${project.slug} duplicate queue sourceValue ${sourceValue}`);
    assert(!keys.has(queueKey), `MBC ${project.slug} duplicate queueKey ${queueKey}`);
    assert(!orders.has(queueOrder), `MBC ${project.slug} duplicate queueOrder ${queueOrder}`);
    const referenceResidentialCount = project.queueReferenceObservedAt === undefined
      ? null
      : integer(definition.referenceResidentialCount);
    if (project.queueReferenceObservedAt !== undefined) {
      assert(Number.isFinite(Date.parse(project.queueReferenceObservedAt)), `MBC ${project.slug} queue reference timestamp is invalid`);
      assert(referenceResidentialCount !== null && referenceResidentialCount >= 0, `MBC ${project.slug} queue ${queueKey} reference count is invalid`);
    }
    const normalized = { sourceId: sourceValue, queueKey, queueLabel, queueDisplayCode, queueOrder, referenceResidentialCount };
    bySourceValue.set(sourceValue, normalized);
    keys.add(queueKey);
    orders.add(queueOrder);
  }
  const definitions = [...bySourceValue.values()].sort((left, right) => left.queueOrder - right.queueOrder);
  return {
    bySourceValue,
    queues: definitions.map(({ referenceResidentialCount: _reference, ...queue }) => queue),
    definitions,
    referenceObservedAt: project.queueReferenceObservedAt ?? null,
  };
}

function mbcRowsFromPages(pages, slug, propertyType, allowEmpty = false) {
  assert(Array.isArray(pages) && pages.length > 0, `MBC ${slug} ${propertyType} capture has no pages`);
  const rows = [];
  let declaredTotal = null;
  let declaredLastPage = null;
  for (const [index, root] of pages.entries()) {
    assert(record(root?.plans) && Array.isArray(root.plans.data), `MBC ${slug} ${propertyType} page ${index + 1} is invalid`);
    const total = integer(root.plans.total);
    const currentPage = integer(root.plans.current_page);
    const lastPage = integer(root.plans.last_page);
    assert(total !== null && (allowEmpty ? total >= 0 : total > 0), `MBC ${slug} ${propertyType} page ${index + 1} total is invalid`);
    assert(currentPage === index + 1, `MBC ${slug} ${propertyType} page ${index + 1} current_page mismatch`);
    assert(lastPage !== null && lastPage > 0, `MBC ${slug} ${propertyType} page ${index + 1} last_page is invalid`);
    if (declaredTotal === null) declaredTotal = total;
    if (declaredLastPage === null) declaredLastPage = lastPage;
    assert(total === declaredTotal, `MBC ${slug} ${propertyType} total changed during capture`);
    assert(lastPage === declaredLastPage, `MBC ${slug} ${propertyType} last_page changed during capture`);
    rows.push(...root.plans.data);
  }
  assert(pages.length === declaredLastPage, `MBC ${slug} ${propertyType} captured ${pages.length} of ${declaredLastPage} pages`);
  assert(rows.length === declaredTotal, `MBC ${slug} ${propertyType} captured ${rows.length} of ${declaredTotal} rows`);
  return rows;
}

function mbcCategoryQueueCounts(rows) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.queue ?? '').trim() || 'unassigned';
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true })));
}

function mbcQueueReconciliation(queueDefinitions, residentialRows, commercialRows) {
  const residential = mbcCategoryQueueCounts(residentialRows);
  const commercial = mbcCategoryQueueCounts(commercialRows);
  return {
    referenceCardObservedAt: queueDefinitions.referenceObservedAt,
    queues: queueDefinitions.definitions.map((queue) => {
      const feedResidentialCount = residential[queue.sourceId] ?? 0;
      return {
        queueKey: queue.queueKey,
        queueLabel: queue.queueLabel,
        sourceValue: queue.sourceId,
        feedResidentialCount,
        feedCommercialCount: commercial[queue.sourceId] ?? 0,
        ...(queue.referenceResidentialCount === null ? {} : {
          referenceCardResidentialCount: queue.referenceResidentialCount,
          residentialDelta: feedResidentialCount - queue.referenceResidentialCount,
        }),
      };
    }),
    unassignedFeed: {
      residential: residential.unassigned ?? 0,
      commercial: commercial.unassigned ?? 0,
    },
  };
}

const mbcProfitbaseBaseStatuses = new Set(['AVAILABLE', 'BOOKED', 'SOLD', 'UNAVAILABLE', 'EXECUTION', 'UNKNOWN']);

function mbcProfitbaseLifecycle(value, label) {
  const rawStatus = numberText(value, label).toUpperCase();
  assert(mbcProfitbaseBaseStatuses.has(rawStatus), `${label} is unsupported`);
  if (rawStatus === 'AVAILABLE') return { rawStatus, normalizedStatus: 'available' };
  if (rawStatus === 'BOOKED' || rawStatus === 'EXECUTION') return { rawStatus, normalizedStatus: 'reserved' };
  if (rawStatus === 'SOLD') return { rawStatus, normalizedStatus: 'sold' };
  return { rawStatus, normalizedStatus: 'unavailable' };
}

function normalizeMbcProject(group, capturedAt, template, { fullLifecycle = false } = {}) {
  const project = group?.project;
  assert(record(project), 'MBC project metadata is missing');
  assert(Number.isSafeInteger(project.id) && project.id > 0, 'MBC project id is invalid');
  const slug = numberText(project.slug, 'MBC project slug');
  const queueDefinitions = mbcQueueDefinitions(project);
  const pages = group?.residentialPages ?? group?.pages;
  const rows = Array.isArray(group?.residentialRows) ? group.residentialRows : mbcRowsFromPages(pages, slug, 'residential');
  const commercialRows = group?.commercialPages ? mbcRowsFromPages(group.commercialPages, slug, 'commercial', true) : [];
  for (const [index, row] of commercialRows.entries()) {
    assert(record(row), `MBC ${slug} commercial row ${index + 1} is invalid`);
    assert(String(row.type) === 'commercial', `MBC ${slug} excluded row ${row.id ?? index + 1} is not commercial`);
    assert(String(row.status).toUpperCase() === 'AVAILABLE', `MBC ${slug} excluded commercial row ${row.id ?? index + 1} is not available`);
    const sourceValue = String(row.queue ?? '').trim();
    if (sourceValue) assert(queueDefinitions.bySourceValue.has(sourceValue), `MBC ${slug} commercial row ${row.id ?? index + 1} references unknown CRM queue ${sourceValue}`);
  }
  const retainedUnit = mbcTemplateLookup(template);
  const publicIdentities = new Set();
  const crmIdentities = new Set();
  const sourceKeyIdentities = new Set();
  const units = rows.map((row, index) => {
    assert(record(row), `MBC ${slug} row ${index + 1} is invalid`);
    const crmId = numberText(row.crm_id ?? row.id, `MBC ${slug} row ${index + 1}.crm_id`);
    const publicId = row.public_id === null || row.crm_id === undefined
      ? null
      : numberText(row.public_id ?? row.id, `MBC ${slug} row ${index + 1}.id`);
    if (publicId !== null) assert(!publicIdentities.has(publicId), `MBC ${slug} duplicate id ${publicId}`);
    assert(!crmIdentities.has(crmId), `MBC ${slug} duplicate CRM id ${crmId}`);
    if (publicId !== null) publicIdentities.add(publicId);
    crmIdentities.add(crmId);
    const area = positive(row.square);
    const floor = integer(row.floor);
    const rooms = integer(row.rooms);
    assert(area !== null && floor !== null && rooms !== null, `MBC ${slug} row ${crmId} dimensions are invalid`);
    assert(String(row.project_slug) === slug, `MBC ${slug} row ${crmId} has unexpected project`);
    assert(String(row.type) === 'residential', `MBC ${slug} row ${crmId} is not residential`);
    const lifecycle = fullLifecycle
      ? mbcProfitbaseLifecycle(row.status, `MBC ${slug} row ${crmId}.status`)
      : { rawStatus: numberText(row.status, `MBC ${slug} row ${crmId}.status`).toUpperCase(), normalizedStatus: status(row.status) };
    if (!fullLifecycle) assert(lifecycle.rawStatus === 'AVAILABLE' && lifecycle.normalizedStatus === 'available', `MBC ${slug} row ${crmId} is not available`);
    assert(Number(row.is_price) === 0, `MBC ${slug} row ${crmId} public-price policy changed`);
    const queueSource = mbcPhasePart(row.queue, `MBC ${slug} row ${crmId}.queue`);
    const queue = queueDefinitions.bySourceValue.get(queueSource.text);
    assert(queue, `MBC ${slug} row ${crmId} references unknown CRM queue ${queueSource.text}`);
    const section = mbcPhasePart(row.section, `MBC ${slug} row ${crmId}.section`);
    const sectionName = integer(section.text) === null ? section.text : `S${section.text}`;
    const retained = retainedUnit(row, crmId);
    const planImageUrl = localPlanPath(retained, slug);
    const sourceKey = numberText(
      templateMbcSourceKey(slug, retained) || opaqueMbcSourceKey(slug, crmId),
      `MBC ${slug} row ${crmId}.sourceKey`,
    );
    assert(!sourceKeyIdentities.has(sourceKey), `MBC ${slug} duplicate sourceKey ${sourceKey}`);
    sourceKeyIdentities.add(sourceKey);
    return {
      id: crmId,
      sourceId: crmId,
      ...(publicId === null ? {} : { publicId }),
      sourceKey,
      projectSlug: slug,
      phaseSlug: `${queue.queueKey}-s${section.slug}`,
      // A phase here is the physical section. Queue presentation is carried
      // only by the explicit queue* fields and never folded into its name.
      phaseName: sectionName,
      queueKey: queue.queueKey,
      queueLabel: queue.queueLabel,
      queueDisplayCode: queue.queueDisplayCode,
      queueOrder: queue.queueOrder,
      sourceOrder: index,
      number: numberText(row.number, `MBC ${slug} row ${crmId}.number`),
      rooms,
      area,
      floor,
      queue: queueSource.value,
      section: section.value,
      entrance: section.text,
      completion: String(retained.completion ?? row.end ?? ''),
      status: lifecycle.normalizedStatus,
      rawStatus: lifecycle.rawStatus,
      propertyType: 'apartment',
      rawPropertyType: String(row.raw_property_type ?? 'residential'),
      isSale: lifecycle.normalizedStatus === 'available',
      publicPrice: false,
      displayPriceKey: 'priceOnRequest',
      priceVisibility: 'request-only',
      ...(planImageUrl ? { planImageUrl } : {}),
      ...(positive(retained.planWidth) && positive(retained.planHeight) ? { planWidth: Number(retained.planWidth), planHeight: Number(retained.planHeight) } : {}),
    };
  });
  const retainedPlanCount = units.filter((unit) => unit.planImageUrl).length;
  const availableUnits = units.filter((unit) => unit.status === 'available');
  if (template && availableUnits.length > 0) assert(availableUnits.some((unit) => unit.planImageUrl), `MBC ${slug} could not match any current available unit to its local plan template`);
  const audit = completeness({
    expected: rows.length,
    units,
    identities: crmIdentities,
    extra: {
      uniquePublicIds: publicIdentities.size, uniqueCrmIds: crmIdentities.size,
      uniqueSourceKeys: sourceKeyIdentities.size, retainedPlanCount, projectId: project.id,
      propertyType: 'residential', excludedCommercial: commercialRows.length,
      excludedNonResidential: integer(group?.excludedNonResidential) ?? 0,
      queueCounts: { residential: mbcCategoryQueueCounts(availableUnits), commercial: mbcCategoryQueueCounts(commercialRows) },
      lifecycleQueueCounts: Object.fromEntries(queueDefinitions.queues.map((queue) => [queue.queueKey, statusCounts(units.filter((unit) => unit.queueKey === queue.queueKey))])),
      queueReconciliation: mbcQueueReconciliation(queueDefinitions, availableUnits, commercialRows),
      lifecycleStatusValues: fullLifecycle ? [...mbcProfitbaseBaseStatuses] : ['AVAILABLE'],
      availabilityPolicy: fullLifecycle
        ? 'authenticated Profitbase property inventory; customStatusId/baseStatus is authoritative and disappearance is never a sale'
        : 'public MBC plans feed publishes AVAILABLE residential inventory only',
      saleDatePolicy: fullLifecycle ? 'Profitbase exposes no sale timestamp; baseline SOLD contributes only to all-time known-sold totals' : null,
    },
  });
  assert(audit.complete, `MBC ${slug} completeness checks failed`);
  return {
    artifact: {
      schemaVersion: 1,
      project: project.name,
      projectSlug: slug,
      projectId: project.id,
      developerSlug: 'murad-buildings',
      capturedAt,
      officialTotalAtCapture: rows.length,
      sourceCount: rows.length,
      availableResidentialTotal: availableUnits.length,
      reservedResidentialTotal: units.filter((unit) => unit.status === 'reserved').length,
      soldResidentialTotal: units.filter((unit) => unit.status === 'sold').length,
      unavailableResidentialTotal: units.filter((unit) => unit.status === 'unavailable').length,
      excludedCommercial: commercialRows.length,
      publicPrice: false,
      source: fullLifecycle ? 'https://pb12218.profitbase.ru/api/v4/json/property' : 'https://mbc.uz/api/plans',
      sourceLanding: project.sourceLanding,
      queues: queueDefinitions.queues,
      completeness: audit,
      units,
    },
    audit,
  };
}

function mbcProfitbaseDataArray(root, label) {
  const value = Array.isArray(root) ? root : root?.data;
  assert(Array.isArray(value), `${label} is not an array`);
  return value;
}

function mbcProfitbaseStatuses(root) {
  assert(root?.success === true && record(root?.data) && Array.isArray(root.data.customStatuses), 'MBC Profitbase custom status response is invalid');
  const statuses = new Map();
  for (const [index, row] of root.data.customStatuses.entries()) {
    assert(record(row), `MBC Profitbase custom status ${index + 1} is invalid`);
    const id = integer(row.id);
    assert(id !== null && id > 0 && !statuses.has(id), `MBC Profitbase custom status ${index + 1} has an invalid or duplicate id`);
    const lifecycle = mbcProfitbaseLifecycle(row.baseStatus, `MBC Profitbase custom status ${id}.baseStatus`);
    statuses.set(id, lifecycle.rawStatus);
  }
  return statuses;
}

function mbcProfitbaseHouseRows(houseInput, project, houseDefinition, customStatuses) {
  assert(Array.isArray(houseInput?.pages) && houseInput.pages.length > 0, `MBC ${project.slug} house ${houseDefinition.id} has no property pages`);
  const properties = [];
  let declaredTotal = null;
  for (const [index, root] of houseInput.pages.entries()) {
    assert(String(root?.status ?? '').toLowerCase() === 'success' && record(root?.data) && Array.isArray(root.data.properties), `MBC ${project.slug} house ${houseDefinition.id} page ${index + 1} is invalid`);
    const filteredCount = integer(root.data.filteredCount);
    assert(filteredCount !== null && filteredCount >= 0, `MBC ${project.slug} house ${houseDefinition.id} page ${index + 1} filteredCount is invalid`);
    declaredTotal ??= filteredCount;
    assert(filteredCount === declaredTotal, `MBC ${project.slug} house ${houseDefinition.id} filteredCount changed during normalization`);
    properties.push(...root.data.properties);
  }
  assert(properties.length === declaredTotal, `MBC ${project.slug} house ${houseDefinition.id} normalized ${properties.length} of ${declaredTotal} properties`);
  const identities = new Set();
  let excludedNonResidential = 0;
  const residentialRows = [];
  for (const [index, property] of properties.entries()) {
    assert(record(property), `MBC ${project.slug} house ${houseDefinition.id} property ${index + 1} is invalid`);
    const id = integer(property.id);
    assert(id !== null && id > 0 && !identities.has(id), `MBC ${project.slug} house ${houseDefinition.id} property has an invalid or duplicate id`);
    identities.add(id);
    assert(integer(property.house_id) === houseDefinition.id, `MBC ${project.slug} property ${id} belongs to another house`);
    assert(integer(property.projectId) === project.profitbaseProjectId, `MBC ${project.slug} property ${id} belongs to another project`);
    const purpose = numberText(property.typePurpose, `MBC ${project.slug} property ${id}.typePurpose`);
    const customStatusId = integer(property.customStatusId);
    const authoritativeBaseStatus = customStatuses.get(customStatusId);
    assert(authoritativeBaseStatus, `MBC ${project.slug} property ${id} references unknown custom status`);
    const observedBaseStatus = numberText(property.status, `MBC ${project.slug} property ${id}.status`).toUpperCase();
    assert(observedBaseStatus === authoritativeBaseStatus, `MBC ${project.slug} property ${id} status/customStatusId mismatch`);
    if (purpose !== 'residential') {
      excludedNonResidential += 1;
      continue;
    }
    const area = positive(property.area?.area_total);
    const floor = integer(property.floor);
    const rooms = integer(property.rooms_amount);
    assert(area !== null && floor !== null && floor > 0 && rooms !== null && rooms >= 0, `MBC ${project.slug} property ${id} dimensions are invalid`);
    residentialRows.push({
      id,
      crm_id: id,
      public_id: null,
      square: area,
      rooms,
      floor,
      number: numberText(property.number, `MBC ${project.slug} property ${id}.number`),
      project_slug: project.slug,
      type: 'residential',
      raw_property_type: numberText(property.propertyType, `MBC ${project.slug} property ${id}.propertyType`),
      status: authoritativeBaseStatus,
      is_price: 0,
      queue: houseDefinition.queueSourceValue,
      section: numberText(property.sectionName, `MBC ${project.slug} property ${id}.sectionName`),
      end: '',
    });
  }
  assert(
    residentialRows.length >= houseDefinition.minimumResidentialUnits,
    `MBC ${project.slug} house ${houseDefinition.id} residential count ${residentialRows.length} is below safety floor ${houseDefinition.minimumResidentialUnits}`,
  );
  return { residentialRows, excludedNonResidential };
}

export function normalizeMbcProfitbaseCapture(input, capturedAt = new Date().toISOString(), templates = {}, projectDefinitions = mbcProjects) {
  assert(record(input), 'MBC Profitbase capture is invalid');
  assert(Array.isArray(projectDefinitions) && projectDefinitions.length > 0, 'MBC Profitbase provider has no project definitions');
  const customStatuses = mbcProfitbaseStatuses(input.customStatuses);
  const projects = mbcProfitbaseDataArray(input.projects, 'MBC Profitbase projects');
  assert(input.houses?.success === true, 'MBC Profitbase house response is invalid');
  const houses = mbcProfitbaseDataArray(input.houses, 'MBC Profitbase houses');
  assert(Array.isArray(input.groups), 'MBC Profitbase project groups are invalid');
  const groupsBySlug = new Map();
  for (const group of input.groups) {
    const slug = numberText(group?.project?.slug, 'MBC Profitbase project group slug');
    assert(!groupsBySlug.has(slug), `MBC Profitbase capture duplicates project group ${slug}`);
    groupsBySlug.set(slug, group);
  }
  const projectIds = new Set();
  const globalPropertyIds = new Set();
  const normalizedGroups = [];
  for (const project of projectDefinitions) {
    const sourceProjects = projects.filter((candidate) => integer(candidate?.id) === project.profitbaseProjectId);
    const sourceProject = sourceProjects[0];
    assert(sourceProjects.length === 1 && String(sourceProject?.title ?? '').trim() === project.profitbaseProjectTitle, `MBC ${project.slug} Profitbase project identity changed`);
    assert(!projectIds.has(project.profitbaseProjectId), `MBC duplicate Profitbase project ${project.profitbaseProjectId}`);
    projectIds.add(project.profitbaseProjectId);
    const sourceHouses = houses.filter((house) => integer(house?.projectId) === project.profitbaseProjectId && house?.isArchive !== true);
    const allowedHouseIds = new Set([...project.profitbaseHouses.map((house) => house.id), ...project.excludedProfitbaseHouseIds]);
    assert(sourceHouses.length === allowedHouseIds.size && sourceHouses.every((house) => allowedHouseIds.has(integer(house.id))), `MBC ${project.slug} Profitbase house universe changed`);
    const capturedGroup = groupsBySlug.get(project.slug);
    assert(capturedGroup && Number(capturedGroup.project?.id) === project.id, `MBC Profitbase capture is missing project ${project.slug}`);
    assert(Array.isArray(capturedGroup.houses), `MBC ${project.slug} captured houses are invalid`);
    const capturedHouses = new Map();
    for (const house of capturedGroup.houses) {
      const houseId = integer(house?.houseId);
      assert(houseId !== null && !capturedHouses.has(houseId), `MBC ${project.slug} capture has an invalid or duplicate house`);
      capturedHouses.set(houseId, house);
    }
    const residentialRows = [];
    let excludedNonResidential = 0;
    for (const definition of project.profitbaseHouses) {
      const sourceHouse = sourceHouses.find((house) => integer(house?.id) === definition.id);
      assert(sourceHouse && String(sourceHouse.title ?? '').trim() === definition.title, `MBC ${project.slug} house ${definition.id} identity changed`);
      const normalized = mbcProfitbaseHouseRows(capturedHouses.get(definition.id), project, definition, customStatuses);
      for (const row of normalized.residentialRows) {
        assert(!globalPropertyIds.has(row.id), `MBC Profitbase duplicates property ${row.id} across houses`);
        globalPropertyIds.add(row.id);
      }
      residentialRows.push(...normalized.residentialRows);
      excludedNonResidential += normalized.excludedNonResidential;
    }
    assert(capturedHouses.size === project.profitbaseHouses.length, `MBC ${project.slug} capture contains an unexpected house`);
    assert(residentialRows.length >= project.minimumResidentialUnits, `MBC ${project.slug} residential count ${residentialRows.length} is below safety floor ${project.minimumResidentialUnits}`);
    normalizedGroups.push({ project, residentialRows, excludedNonResidential });
  }
  assert(groupsBySlug.size === projectDefinitions.length, 'MBC Profitbase capture contains an unexpected project group');
  const artifacts = [];
  const audit = {};
  for (const group of normalizedGroups) {
    const result = normalizeMbcProject(group, capturedAt, templates?.[group.project.slug] ?? null, { fullLifecycle: true });
    artifacts.push({ filename: `${group.project.slug}-catalog.json`, artifact: result.artifact });
    audit[group.project.slug] = result.audit;
  }
  return { artifacts, audit };
}

export function normalizeMbcProjects(groups, capturedAt = new Date().toISOString(), templates = {}, projectDefinitions = mbcProjects) {
  assert(Array.isArray(projectDefinitions) && projectDefinitions.length > 0, 'MBC provider has no project definitions');
  assert(Array.isArray(groups) && groups.length === projectDefinitions.length, `MBC capture requires ${projectDefinitions.length} project groups, received ${groups?.length ?? 0}`);
  const expected = new Map(projectDefinitions.map((project) => [project.slug, project]));
  const seen = new Set();
  const artifacts = [];
  const audits = {};
  for (const group of groups) {
    const slug = numberText(group?.project?.slug, 'MBC project slug');
    const project = expected.get(slug);
    assert(project, `MBC capture contains unexpected project ${slug}`);
    assert(!seen.has(slug), `MBC duplicate project group ${slug}`);
    assert(Number(group.project.id) === project.id, `MBC ${slug} project id mismatch`);
    seen.add(slug);
    const result = normalizeMbcProject({
      project,
      pages: group.pages,
      residentialPages: group.residentialPages,
      commercialPages: group.commercialPages,
    }, capturedAt, templates?.[slug] ?? null);
    artifacts.push({ filename: `${slug}-catalog.json`, artifact: result.artifact });
    audits[slug] = result.audit;
  }
  for (const project of projectDefinitions) assert(seen.has(project.slug), `MBC capture is missing project ${project.slug}`);
  return { artifacts, audit: audits };
}

// Compatibility helper for reviewing historical Regnum-only captures.
export function normalizeRegnumPages(pages, capturedAt = new Date().toISOString(), template = null) {
  return normalizeMbcProject({ project: mbcProjects.find((project) => project.slug === 'regnum-plaza'), residentialPages: pages }, capturedAt, template);
}

const nrgUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nrgMatrixStatusMap = Object.freeze({ FREE: 'available', BOOKED: 'reserved', SOLD: 'sold' });

function nrgUuid(value, label) {
  const id = numberText(value, label);
  assert(nrgUuidPattern.test(id), `${label} is not a UUID`);
  return id;
}

function nrgMatrixStatus(row, label) {
  const raw = numberText(row?.placementUIStatus, `${label}.placementUIStatus`);
  const normalized = nrgMatrixStatusMap[raw];
  assert(normalized, `${label} has unknown placementUIStatus ${JSON.stringify(raw)}`);
  assert(typeof row.isSale === 'boolean', `${label}.isSale must be boolean`);
  assert(row.isSale === (raw === 'FREE'), `${label} has inconsistent placementUIStatus/isSale`);
  return normalized;
}

function nrgMatrixRows(slug, estate, matrices) {
  assert(Array.isArray(estate.blocks) && estate.blocks.length > 0, `NRG ${slug} realEstateList has no blocks`);
  assert(estate.blocks.length <= 100, `NRG ${slug} realEstateList exceeds the block safety limit`);
  assert(Array.isArray(matrices) && matrices.length === estate.blocks.length, `NRG ${slug} has ${matrices?.length ?? 0}/${estate.blocks.length} required blockMatrix responses`);
  const blockById = new Map();
  for (const [index, block] of estate.blocks.entries()) {
    assert(record(block), `NRG ${slug} block ${index + 1} is invalid`);
    const blockId = nrgUuid(block.id, `NRG ${slug} block ${index + 1}.id`);
    assert(!blockById.has(blockId), `NRG ${slug} realEstateList duplicates block ${blockId}`);
    blockById.set(blockId, { ...block, name: numberText(block.name, `NRG ${slug} block ${blockId}.name`) });
  }

  const matrixByBlock = new Map();
  for (const [index, matrix] of matrices.entries()) {
    assert(record(matrix), `NRG ${slug} blockMatrix ${index + 1} is invalid`);
    const blockId = nrgUuid(matrix.blockUUID, `NRG ${slug} blockMatrix ${index + 1}.blockUUID`);
    const block = blockById.get(blockId);
    assert(block, `NRG ${slug} blockMatrix contains foreign block ${blockId}`);
    assert(!matrixByBlock.has(blockId), `NRG ${slug} blockMatrix duplicates block ${blockId}`);
    assert(numberText(matrix.blockName, `NRG ${slug} blockMatrix ${blockId}.blockName`) === block.name, `NRG ${slug} blockMatrix ${blockId} name mismatch`);
    assert(Array.isArray(matrix.entrances), `NRG ${slug} blockMatrix ${blockId}.entrances is invalid`);
    matrixByBlock.set(blockId, matrix);
  }
  for (const blockId of blockById.keys()) assert(matrixByBlock.has(blockId), `NRG ${slug} blockMatrix is missing block ${blockId}`);

  const identities = new Set();
  const rows = [];
  for (const [blockId, block] of blockById) {
    const matrix = matrixByBlock.get(blockId);
    const entranceKeys = new Set();
    let blockPlacementCount = 0;
    for (const [entranceIndex, entrance] of matrix.entrances.entries()) {
      assert(record(entrance), `NRG ${slug} block ${blockId} entrance ${entranceIndex + 1} is invalid`);
      const entranceNumber = integer(entrance.entrance);
      assert(entranceNumber !== null, `NRG ${slug} block ${blockId} entrance ${entranceIndex + 1} number is invalid`);
      assert(!entranceKeys.has(entranceNumber), `NRG ${slug} block ${blockId} duplicates entrance ${entranceNumber}`);
      entranceKeys.add(entranceNumber);
      assert(Array.isArray(entrance.floors), `NRG ${slug} block ${blockId} entrance ${entranceNumber}.floors is invalid`);
      const floorKeys = new Set();
      for (const [floorIndex, floor] of entrance.floors.entries()) {
        assert(record(floor), `NRG ${slug} block ${blockId} entrance ${entranceNumber} floor ${floorIndex + 1} is invalid`);
        const floorNumber = integer(floor.floor);
        assert(floorNumber !== null, `NRG ${slug} block ${blockId} entrance ${entranceNumber} floor number is invalid`);
        assert(!floorKeys.has(floorNumber), `NRG ${slug} block ${blockId} entrance ${entranceNumber} duplicates floor ${floorNumber}`);
        floorKeys.add(floorNumber);
        assert(Array.isArray(floor.placements), `NRG ${slug} block ${blockId} entrance ${entranceNumber} floor ${floorNumber}.placements is invalid`);
        blockPlacementCount += floor.placements.length;
        assert(blockPlacementCount <= 5_000, `NRG ${slug} block ${blockId} exceeds the matrix placement safety limit`);
        for (const [placementIndex, placement] of floor.placements.entries()) {
          const label = `NRG ${slug} block ${blockId} placement ${placementIndex + 1}`;
          assert(record(placement), `${label} is invalid`);
          const placementUUID = nrgUuid(placement.placementUUID, `${label}.placementUUID`);
          assert(!identities.has(placementUUID), `NRG ${slug} duplicate matrix placement UUID ${placementUUID}`);
          identities.add(placementUUID);
          assert(nrgUuid(placement.blockUUID, `${label}.blockUUID`) === blockId, `${label} blockUUID mismatch`);
          assert(numberText(placement.blockName, `${label}.blockName`) === block.name, `${label} blockName mismatch`);
          assert(integer(placement.entrance) === entranceNumber && integer(placement.floor) === floorNumber, `${label} entrance/floor mismatch`);
          const rooms = integer(placement.roomCount);
          assert(rooms !== null && rooms >= 0 && positive(placement.square) !== null, `${label} dimensions are invalid`);
          numberText(placement.placementName, `${label}.placementName`);
          const propertyTypeUUID = nrgUuid(placement.propertyTypeUUID, `${label}.propertyTypeUUID`);
          assert(record(placement.propertyType) && nrgUuid(placement.propertyType.uuid, `${label}.propertyType.uuid`) === propertyTypeUUID, `${label} property type identity mismatch`);
          assert(numberText(placement.propertyTypeName, `${label}.propertyTypeName`) === numberText(placement.propertyType.name, `${label}.propertyType.name`), `${label} property type name mismatch`);
          const normalizedStatus = nrgMatrixStatus(placement, label);
          rows.push({ placement, block, entrance: entranceNumber, floor: floorNumber, normalizedStatus });
        }
      }
    }
  }
  assert(rows.length <= 30_000, `NRG ${slug} exceeds the project matrix placement safety limit`);
  return { rows, identities, blockCount: blockById.size };
}

function normalize4uPlanAudit(value, rows) {
  assert(record(value) && value.schemaVersion === 1 && value.projectSlug === '4u', 'NRG 4u plan asset audit metadata is invalid');
  const activeRows = rows.filter((row) => row?.isSale === true);
  assert(Array.isArray(value.units), 'NRG 4u plan asset audit has no units array');
  assert(value.activeUnitCount === activeRows.length && value.auditedUnitCount === activeRows.length && value.units.length === activeRows.length, 'NRG 4u plan asset audit coverage is incomplete');
  const activeById = new Map(activeRows.map((row) => [String(row.uuid), row]));
  const selectedById = new Map();
  const seen = new Set();
  let verifiedOriginals = 0;
  let invalidOriginals = 0;
  let publishablePlans = 0;
  const hashes = new Map();
  const verifiedVariants = new Map(nrgPlanVariants.map((variant) => [variant, 0]));

  for (const unit of value.units) {
    assert(record(unit), 'NRG 4u plan asset audit unit is invalid');
    const id = numberText(unit.unitId, 'NRG 4u plan asset audit unitId');
    assert(!seen.has(id), `NRG 4u plan asset audit duplicates unit ${id}`);
    seen.add(id);
    const row = activeById.get(id);
    assert(record(row), `NRG 4u plan asset audit contains inactive or unknown unit ${id}`);
    assert(String(unit.blockId) === String(row.blockId) && String(unit.number) === String(row.name), `NRG 4u plan asset audit identity mismatch for ${id}`);
    assert(record(unit.original), `NRG 4u original plan asset is missing for ${id}`);
    assert(Array.isArray(unit.variants) && unit.variants.length === nrgPlanVariants.length, `NRG 4u plan asset variants are incomplete for ${id}`);
    const variants = new Map();
    for (const asset of unit.variants) {
      assert(record(asset) && nrgPlanVariants.includes(asset.variant) && !variants.has(asset.variant), `NRG 4u plan asset variant is invalid for ${id}`);
      assert(typeof asset.ok === 'boolean', `NRG 4u plan asset result is invalid for ${id}/${asset.variant}`);
      variants.set(asset.variant, asset);
      if (asset.ok === true) {
        assert(asset.url === expectedNrgPlanUrl(row, asset.variant), `NRG 4u verified plan URL mismatch for ${id}/${asset.variant}`);
        assert(asset.status === 200 && asset.declaredMimeType === 'image/jpeg' && asset.mimeType === 'image/jpeg', `NRG 4u verified plan response is invalid for ${id}/${asset.variant}`);
        assert(nrgPlanAssetGeometryValid(asset.variant, asset), `NRG 4u verified plan dimensions are invalid for ${id}/${asset.variant}`);
        assert(typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256), `NRG 4u verified plan hash is invalid for ${id}/${asset.variant}`);
        verifiedVariants.set(asset.variant, verifiedVariants.get(asset.variant) + 1);
      }
    }
    assert(nrgPlanVariants.every((variant) => variants.has(variant)), `NRG 4u plan asset variant set changed for ${id}`);
    const original = unit.original;
    assert(typeof original.ok === 'boolean', `NRG 4u original plan result is invalid for ${id}`);
    if (original.ok === true) {
      const expected = expectedNrgOriginalUrl(row);
      assert(original.variant === 'original' && original.url === expected, `NRG 4u verified original URL mismatch for ${id}`);
      assert(original.status === 200 && ['application/octet-stream', 'image/png'].includes(original.declaredMimeType) && original.mimeType === 'image/png', `NRG 4u verified original MIME is invalid for ${id}`);
      assert(nrgPlanAssetGeometryValid('original', original), `NRG 4u verified original dimensions are invalid for ${id}`);
      assert(typeof original.sha256 === 'string' && /^[a-f0-9]{64}$/.test(original.sha256), `NRG 4u verified original hash is invalid for ${id}`);
      hashes.set(original.sha256, [...(hashes.get(original.sha256) ?? []), id]);
      verifiedOriginals += 1;
    } else {
      invalidOriginals += 1;
    }
    const expectedSelected = original.ok === true && variants.get(1600)?.ok === true ? expectedNrgOriginalUrl(row) : null;
    assert(unit.selectedOriginalUrl === expectedSelected, `NRG 4u selected plan pair mismatch for ${id}`);
    if (expectedSelected) {
      selectedById.set(id, expectedSelected);
      publishablePlans += 1;
    }
  }
  assert(seen.size === activeRows.length, 'NRG 4u plan asset audit is missing an active unit');
  assert(value.verifiedOriginals === verifiedOriginals && value.missingOriginals === invalidOriginals, 'NRG 4u plan asset audit summary does not match its units');
  assert(value.publishablePlans === publishablePlans, 'NRG 4u publishable plan summary does not match its units');
  assert(record(value.variants), 'NRG 4u plan variant summary is missing');
  for (const variant of nrgPlanVariants) {
    const summary = value.variants[String(variant)];
    const valid = verifiedVariants.get(variant);
    assert(record(summary) && summary.attempted === activeRows.length && summary.valid === valid && summary.invalid === activeRows.length - valid, `NRG 4u ${variant}px summary does not match its units`);
  }
  const originalSummary = value.variants.original;
  assert(record(originalSummary) && originalSummary.attempted === activeRows.length && originalSummary.valid === verifiedOriginals && originalSummary.invalid === invalidOriginals, 'NRG 4u original summary does not match its units');
  return {
    selectedById,
    summary: {
      auditedActiveUnits: seen.size,
      verifiedOriginals,
      missingOriginals: invalidOriginals,
      publishablePlans,
      duplicateOriginalGroups: [...hashes.values()].filter((ids) => ids.length > 1).length,
      selectionPolicy: 'validated suffixless detail original plus validated 1600px card preview',
      lastKnownGoodPolicy: 'invalid current original or preview is omitted so the importer retains an existing non-empty URL',
    },
  };
}

/** Normalize the public BI sales-picker responses used by the eleven NRG projects. */
export function normalizeNrgBiCapture(groups, capturedAt = new Date().toISOString()) {
  assert(Array.isArray(groups) && groups.length === nrgBiProjects.length, `NRG capture requires ${nrgBiProjects.length} project groups, received ${groups?.length ?? 0}`);
  const expectedProjects = new Map(nrgBiProjects.map((project) => [project.slug, project]));
  const projectSlugs = new Set();
  const artifacts = [];
  const audits = {};
  for (const group of groups) {
    assert(record(group?.project), 'NRG project metadata is missing');
    const slug = numberText(group.project.slug, 'NRG project slug');
    const configuredProject = expectedProjects.get(slug);
    assert(configuredProject, `NRG capture contains unexpected project ${slug}`);
    assert(!projectSlugs.has(slug), `NRG duplicate project group ${slug}`);
    projectSlugs.add(slug);
    assert(group.project.realEstateUUID === configuredProject.realEstateUUID && group.project.name === configuredProject.name, `NRG ${slug} configured project identity mismatch`);
    assert(group.apartmentPropertyTypeUUID === nrgBiApartmentPropertyTypeUUID, `NRG ${slug} apartment property type identity mismatch`);
    assert(Array.isArray(group.pages) && group.pages.length >= 1, `NRG ${slug} pagination evidence is incomplete`);
    const lastPage = group.pages.at(-1);
    assert(Array.isArray(lastPage?.placements) && lastPage.placements.length === 0, `NRG ${slug} did not reach an empty terminal page`);
    const rows = group.pages.slice(0, -1).flatMap((page, index) => {
      assert(Array.isArray(page?.placements), `NRG ${slug} page ${index + 1} has no placements`);
      assert(page.placements.length > 0 && page.placements.length <= 300, `NRG ${slug} page ${index + 1} size is invalid`);
      return page.placements;
    });
    assert(record(group.realEstate) && Array.isArray(group.realEstate.realEstates), `NRG ${slug} realEstateList is invalid`);
    const estate = group.realEstate.realEstates.find((item) => item?.uuid === group.project.realEstateUUID);
    assert(record(estate), `NRG ${slug} realEstateList does not contain the requested project`);
    assert(Array.isArray(estate.propertyTypes) && estate.propertyTypes.some((item) => item?.uuid === group.apartmentPropertyTypeUUID), `NRG ${slug} has no apartment property type`);
    const mixedPlacementCount = integer(estate.placementCount);
    assert(mixedPlacementCount === null || mixedPlacementCount >= rows.length, `NRG ${slug} apartment rows exceed realEstateList mixed placementCount`);
    const requiredBlocks = group.requiredBlocks ?? estate.blocks;
    if (group.requiredBlocks) {
      assert(Array.isArray(requiredBlocks) && requiredBlocks.length > 0, `NRG ${slug} trusted block registry is empty`);
      const requiredById = new Map(requiredBlocks.map((block) => [String(block?.id ?? ''), block]));
      assert(requiredById.size === requiredBlocks.length, `NRG ${slug} trusted block registry contains duplicate blocks`);
      for (const block of estate.blocks) {
        const required = requiredById.get(String(block?.id ?? ''));
        assert(required && required.name === block.name, `NRG ${slug} realEstateList block conflicts with the trusted block registry`);
      }
    }
    const matrix = nrgMatrixRows(slug, { blocks: requiredBlocks }, group.blockMatrices);
    const matrixBlockIds = requiredBlocks.map((block) => String(block.id)).sort();
    const matrixApartments = matrix.rows.filter(({ placement }) => placement.propertyTypeUUID === group.apartmentPropertyTypeUUID);
    assert(matrixApartments.length > 0, `NRG ${slug} blockMatrix has no apartments`);
    const matrixApartmentById = new Map(matrixApartments.map((entry) => [String(entry.placement.placementUUID), entry]));

    const listedById = new Map();
    for (const [index, row] of rows.entries()) {
      assert(record(row), `NRG ${slug} row ${index + 1} is invalid`);
      const id = nrgUuid(row.uuid, `NRG ${slug} row ${index + 1}.uuid`);
      assert(!listedById.has(id), `NRG ${slug} duplicate placementList UUID ${id}`);
      listedById.set(id, row);
      assert(String(row.realEstateUUID) === group.project.realEstateUUID, `NRG ${slug} row ${id} realEstateUUID mismatch`);
      assert(row.propertyType?.uuid === group.apartmentPropertyTypeUUID, `NRG ${slug} row ${id} is not an apartment`);
      assert(typeof row.isSale === 'boolean', `NRG ${slug} row ${id}.isSale must be boolean`);
      const matrixEntry = matrixApartmentById.get(id);
      assert(matrixEntry, `NRG ${slug} placementList UUID ${id} is missing from blockMatrix`);
      const placement = matrixEntry.placement;
      if (placement.placementUIStatus === 'FREE') {
        assert(row.isSale === true, `NRG ${slug} FREE placementList UUID ${id} is not marked for sale`);
      }
      assert(nrgUuid(row.blockId, `NRG ${slug} row ${id}.blockId`) === placement.blockUUID, `NRG ${slug} row ${id} block identity mismatch`);
      assert(numberText(row.blockName, `NRG ${slug} row ${id}.blockName`) === placement.blockName, `NRG ${slug} row ${id} block name mismatch`);
      assert(numberText(row.name, `NRG ${slug} row ${id}.name`) === placement.placementName, `NRG ${slug} row ${id} number mismatch`);
      assert(integer(row.floor) === matrixEntry.floor && integer(row.entrance) === matrixEntry.entrance, `NRG ${slug} row ${id} entrance/floor mismatch`);
      assert(integer(row.roomCount) === integer(placement.roomCount) && positive(row.square) === positive(placement.square), `NRG ${slug} row ${id} dimensions do not reconcile with blockMatrix`);
    }
    const matrixFreeIds = new Set(matrixApartments.filter(({ placement }) => placement.placementUIStatus === 'FREE').map(({ placement }) => placement.placementUUID));
    for (const id of matrixFreeIds) {
      assert(listedById.get(id)?.isSale === true, `NRG ${slug} FREE inventory is missing from placementList`);
    }
    const staleListingCount = [...listedById].filter(([id, row]) => row.isSale === true && !matrixFreeIds.has(id)).length;
    const staleListingLimit = Math.min(25, Math.ceil(matrixApartments.length * 0.01));
    assert(staleListingCount <= staleListingLimit, `NRG ${slug} placementList has ${staleListingCount}/${staleListingLimit} bounded stale listings`);
    const matrixFreeRows = [...matrixFreeIds].map((id) => listedById.get(id));
    const planAudit = slug === '4u' ? normalize4uPlanAudit(group.planAssets, matrixFreeRows) : null;

    const identities = new Set();
    const maxFloorByBlock = new Map();
    for (const entry of matrixApartments) maxFloorByBlock.set(entry.placement.blockUUID, Math.max(maxFloorByBlock.get(entry.placement.blockUUID) ?? entry.floor, entry.floor));
    const units = matrixApartments.map(({ placement, normalizedStatus, entrance, floor }, index) => {
      const id = nrgUuid(placement.placementUUID, `NRG ${slug} matrix apartment ${index + 1}.placementUUID`);
      assert(!identities.has(id), `NRG ${slug} duplicate apartment placement UUID ${id}`);
      identities.add(id);
      const row = listedById.get(id) ?? null;
      const number = numberText(placement.placementName, `NRG ${slug} matrix apartment ${id}.placementName`);
      const rooms = integer(placement.roomCount);
      const area = positive(placement.square);
      const blockId = nrgUuid(placement.blockUUID, `NRG ${slug} matrix apartment ${id}.blockUUID`);
      const blockName = numberText(placement.blockName, `NRG ${slug} matrix apartment ${id}.blockName`);
      const campaignPrice = slug === '4u'
        ? optionalPositive(row?.discount?.stock?.data?.find((item) => optionalPositive(item?.priceWithDiscount))?.priceWithDiscount)
        : null;
      const price = normalizedStatus === 'available'
        ? campaignPrice ?? optionalPositive(row?.totalPriceWithDiscount) ?? optionalPositive(row?.totalPrice) ?? optionalPositive(placement.totalPrice)
        : null;
      const pricePerM2 = normalizedStatus === 'available'
        ? (campaignPrice ? campaignPrice / area : optionalPositive(row?.priceBySquare) ?? optionalPositive(placement.price) ?? (price ? price / area : null))
        : null;
      const planImageUrl = planAudit?.selectedById.get(id)
        ?? (slug !== '4u' && typeof row?.photoURL1600 === 'string' && row.photoURL1600.startsWith('https://') ? row.photoURL1600 : null);
      return {
        id,
        sourceId: id,
        sourceKey: `nrg-bi:${slug}:${id}`,
        projectSlug: slug,
        phaseSlug: `block-${blockId}`,
        phaseName: blockName,
        propertyType: 'apartment',
        rawPropertyType: String(placement.propertyTypeName || placement.propertyType?.name || 'Квартира'),
        number,
        building: blockName,
        block: blockName,
        blockId,
        entrance: String(entrance),
        floor,
        maxFloor: integer(row?.maxFloor) ?? maxFloorByBlock.get(blockId),
        rooms,
        area,
        status: normalizedStatus,
        rawStatus: placement.placementUIStatus,
        isSale: placement.isSale,
        price,
        pricePerM2,
        currency: 'UZS',
        ...(planImageUrl ? { planImageUrl } : {}),
      };
    });
    const audit = completeness({
      expected: matrixApartments.length,
      units,
      identities,
      extra: {
        sourceProjectUuid: group.project.realEstateUUID,
        apartmentPropertyTypeUuid: group.apartmentPropertyTypeUUID,
        terminalEmptyPage: true,
        realEstateListMixedPlacementCount: mixedPlacementCount,
        matrixBlockCount: matrix.blockCount,
        matrixBlockIds,
        matrixPlacementCount: matrix.rows.length,
        apartmentMatrixPlacementCount: matrixApartments.length,
        placementListCount: rows.length,
        freePlacementsReconciled: matrixFreeIds.size,
        consistencyAttempt: Number.isSafeInteger(group.consistencyAttempt) ? group.consistencyAttempt : null,
        staleListingCount,
        staleListingLimit,
        lifecycleIdentityField: 'placementUUID',
        lifecycleStatusField: 'placementUIStatus',
        lifecycleStatusValues: ['FREE', 'BOOKED', 'SOLD'],
        availabilityPolicy: 'blockMatrix is authoritative; every FREE must exist in placementList with isSale===true; bounded active BOOKED/SOLD listing lag is ignored',
        saleDatePolicy: 'blockMatrix has no sale timestamp; baseline SOLD contributes only to all-time known-sold totals',
        ...(planAudit ? { planAssets: planAudit.summary } : {}),
      },
    });
    assert(audit.complete, `NRG ${slug} completeness checks failed`);
    audits[slug] = audit;
    artifacts.push({
      filename: `${slug}-catalog.json`,
      artifact: {
        project: group.project.name,
        projectSlug: slug,
        realEstateUUID: group.project.realEstateUUID,
        capturedAt,
        sourceCount: matrixApartments.length,
        source: 'https://apigw.bi.group/sales-picker/microfe-v3/blockMatrix',
        availabilitySource: 'https://apigw.bi.group/sales-picker/microfe-v3/placementList',
        availabilityPolicy: 'explicit blockMatrix.placementUIStatus; every FREE is reconciled with placementList.isSale===true; bounded active BOOKED/SOLD listing lag is ignored',
        historicalSaleDates: null,
        matrixBlockIds,
        completeness: audit,
        units,
      },
    });
  }
  for (const project of nrgBiProjects) assert(projectSlugs.has(project.slug), `NRG capture is missing project ${project.slug}`);
  return { artifacts, audit: audits };
}

const sunBlocks = Object.freeze({
  'А': 'A', 'A': 'A', 'В': 'V', 'V': 'V', 'Г': 'G', 'G': 'G', 'Д': 'D', 'D': 'D',
});

function sunBlock(row) {
  const raw = String(row.public_house_name ?? '').match(/(?:Блок|Block)\s+([^\s)]+)/i)?.[1] ?? '';
  const block = sunBlocks[raw.toUpperCase()];
  assert(block, `SUN row ${row.id} has unknown block in ${JSON.stringify(row.public_house_name)}`);
  return block;
}

function sunKey(block, number, floor) {
  const unit = String(number).toLowerCase().replaceAll(/[^a-zа-яё0-9]+/giu, '-').replace(/^[-]+|[-]+$/g, '');
  return `sun-${block.toLowerCase()}-${unit}-f${floor}`;
}

function sunBusinessProjection(row) {
  const estate = row?.estate ?? {};
  return {
    id: row?.id, status: row?.status, publicHouseName: row?.public_house_name,
    houseFloors: row?.houseFloors, houseId: row?.house_id,
    estate: {
      house: estate.house, number: estate.geo_flatnum, floor: estate.estate_floor,
      rooms: estate.estate_rooms, area: estate.estate_area, entrance: estate.geo_house_entrance,
      price: estate.estate_price, pricePerSquareMeter: estate.estate_price_m2,
    },
  };
}

export function normalizeSunPages(pages, capturedAt = new Date().toISOString(), template = null) {
  assert(Array.isArray(pages) && pages.length > 0, 'SUN capture has no object pages');
  const map = new Map();
  let declaredCount = null;
  let sawLastPage = false;
  for (const [index, page] of pages.entries()) {
    assert(Array.isArray(page?.objects), `SUN page ${index} has no objects`);
    const count = integer(page.count);
    if (count !== null) {
      if (declaredCount === null) declaredCount = count;
      assert(declaredCount === count, 'SUN declared count changed during capture');
    }
    if (page.isLastPage) sawLastPage = true;
    for (const row of page.objects) {
      const id = integer(row.id);
      assert(id !== null && id > 0, 'SUN row id is invalid');
      if (map.has(id)) {
        assert(JSON.stringify(sunBusinessProjection(map.get(id))) === JSON.stringify(sunBusinessProjection(row)), `SUN conflicting duplicate id ${id}`);
        continue;
      }
      map.set(id, row);
    }
  }
  assert(sawLastPage, 'SUN capture did not reach the last page');
  if (declaredCount === null) declaredCount = map.size;
  assert(map.size === declaredCount, `SUN captured ${map.size} of ${declaredCount} rows`);
  const retainedByKey = new Map((template?.units ?? []).map((unit) => [String(unit.unitKey ?? unit.id), unit]));
  const identities = new Set();
  const units = [...map.values()].sort((left, right) => Number(left.id) - Number(right.id)).map((row) => {
    const estate = row.estate;
    assert(record(estate), `SUN row ${row.id} estate is missing`);
    const block = sunBlock(row);
    const floor = integer(estate.estate_floor);
    const rooms = integer(estate.estate_rooms);
    const area = positive(estate.estate_area);
    const number = numberText(estate.geo_flatnum, `SUN row ${row.id}.number`);
    assert(floor !== null && rooms !== null && area !== null, `SUN row ${row.id} dimensions are invalid`);
    const unitKey = sunKey(block, number, floor);
    assert(!identities.has(unitKey), `SUN duplicate unit identity ${unitKey}`);
    identities.add(unitKey);
    const normalizedStatus = status(row.status);
    assert(normalizedStatus !== 'unknown', `SUN row ${row.id} has unknown status ${row.status}`);
    const retained = retainedByKey.get(unitKey) ?? {};
    const rawPrice = normalizedStatus === 'available' ? optionalPositive(estate.estate_price) : null;
    const rawPricePerM2 = normalizedStatus === 'available' ? optionalPositive(estate.estate_price_m2) : null;
    return {
      id: unitKey,
      sourceId: String(row.id),
      sourceKey: unitKey,
      projectSlug: 'sun',
      phaseSlug: `block-${block.toLowerCase()}`,
      phaseName: `Блок ${block}`,
      unitKey,
      number,
      block,
      blockName: block,
      building: block,
      buildingId: integer(estate.house),
      floor,
      maxFloor: integer(row.houseFloors) ?? floor,
      entrance: String(estate.geo_house_entrance ?? ''),
      rooms,
      area,
      price: rawPrice,
      pricePerM2: rawPricePerM2,
      status: normalizedStatus,
      rawStatus: String(row.status),
      isSale: normalizedStatus === 'available',
      currency: 'UZS',
      ...(retained.primaryPlanPath ? { planImageUrl: retained.primaryPlanPath } : {}),
    };
  });
  const audit = completeness({ expected: declaredCount, units, identities });
  assert(audit.complete, 'SUN completeness checks failed');
  return {
    artifact: {
      project: 'SUN',
      projectSlug: 'sun',
      capturedAt,
      sourceCount: declaredCount,
      source: 'https://human2human.uz/#/macrocatalog/complexes/list',
      completeness: audit,
      units,
    },
    audit,
  };
}

function kayanPropertyType(value) {
  return /парк/i.test(value) ? 'parking' : 'apartment';
}

const kayanProjectQueues = Object.freeze({
  ofiyat: Object.freeze([
    Object.freeze({ sourceId: 'phase-1', queueKey: 'phase-1', queueLabel: 'I очередь', queueDisplayCode: 'I', queueOrder: 1 }),
    Object.freeze({ sourceId: 'phase-2', queueKey: 'phase-2', queueLabel: 'II очередь', queueDisplayCode: 'II', queueOrder: 2 }),
  ]),
});

function kayanQueue(projectSlug, phaseSlug, propertyType) {
  if (propertyType !== 'apartment') return null;
  const definitions = kayanProjectQueues[projectSlug];
  if (!definitions) return null;
  const queue = definitions.find((candidate) => candidate.sourceId === phaseSlug) ?? null;
  assert(queue, `KAYAN ${projectSlug} residential phase ${phaseSlug} has no authoritative queue metadata`);
  return queue;
}

export function normalizeKayanSnapshots(snapshots, capturedAt = new Date().toISOString(), template = null) {
  assert(Array.isArray(snapshots) && snapshots.length > 0, 'KAYAN capture has no house snapshots');
  const retainedProjects = new Map((template?.projects ?? []).map((item) => [item?.project?.slug, item]));
  const byProject = new Map();
  for (const source of snapshots) {
    assert(source?.schemaVersion === 1 && record(source.house) && Array.isArray(source.records), 'KAYAN snapshot schema is invalid');
    const slug = numberText(source.house.projectSlug, 'KAYAN project slug');
    const project = byProject.get(slug) ?? { phases: [], units: [], layouts: [], identities: new Set(), captured: [] };
    const phaseSlug = numberText(source.house.phaseSlug, `${slug} phase slug`);
    const propertyType = kayanPropertyType(source.house.propertyType);
    const queue = kayanQueue(slug, phaseSlug, propertyType);
    project.phases.push({
      id: source.house.sourceId,
      sourceId: source.house.sourceId,
      slug: phaseSlug,
      name: source.house.phaseName,
      propertyType,
      sortOrder: project.phases.length + 1,
      imageUrl: source.house.card?.image ?? '',
      ...(queue ?? {}),
    });
    for (const row of source.records) {
      const number = numberText(row.number, `${slug}/${phaseSlug} unit number`);
      const floor = integer(row.floor);
      const area = positive(String(row.areaText).replace(',', '.'));
      assert(floor !== null && area !== null, `${slug}/${phaseSlug}/${number} dimensions are invalid`);
      const sourceKey = [source.house.sourceId, propertyType, row.entrance, row.floor, number].join(':').toLowerCase();
      assert(!project.identities.has(sourceKey), `KAYAN duplicate ${sourceKey}`);
      project.identities.add(sourceKey);
      const normalizedStatus = status(row.rawStatus);
      assert(normalizedStatus !== 'unknown', `KAYAN ${sourceKey} has unknown status ${row.rawStatus}`);
      const price = parsePriceText(row.priceText);
      project.units.push({
        id: sourceKey,
        sourceKey,
        projectSlug: slug,
        phaseSlug,
        phaseName: source.house.phaseName,
        ...(queue ?? {}),
        propertyType,
        rawPropertyType: row.propertyType,
        status: normalizedStatus,
        rawStatus: row.rawStatus,
        number,
        entrance: String(row.entrance ?? ''),
        floor,
        area,
        rooms: integer(row.roomsText),
        price,
        pricePerM2: price ? price / area : null,
        currency: 'UZS',
      });
    }
    project.layouts.push(...(source.layouts ?? []).map((layout) => ({ ...layout, projectSlug: slug, phaseSlug })));
    project.captured.push(new Date(source.capturedAt).getTime());
    byProject.set(slug, project);
  }

  const projects = [];
  const audits = {};
  for (const [slug, value] of byProject) {
    const retained = retainedProjects.get(slug);
    const retainedUnits = new Map((retained?.units ?? []).map((unit) => [unit.sourceKey, unit]));
    for (const unit of value.units) if (retainedUnits.get(unit.sourceKey)?.planImageUrl?.startsWith(`/kayan/${slug}/`)) unit.planImageUrl = retainedUnits.get(unit.sourceKey).planImageUrl;
    const retainedLayouts = new Map((retained?.layouts ?? []).map((layout) => [`${layout.phaseSlug}\u001f${layout.sourceId}`, layout]));
    value.layouts = value.layouts.map((layout) => {
      const previous = retainedLayouts.get(`${layout.phaseSlug}\u001f${layout.sourceId}`);
      return previous?.imageUrl?.startsWith(`/kayan/${slug}/`) ? { ...layout, imageUrl: previous.imageUrl, thumbnailUrl: previous.thumbnailUrl ?? previous.imageUrl } : layout;
    });
    const retainedPhases = new Map((retained?.project?.phases ?? []).map((phase) => [phase.slug, phase]));
    value.phases = value.phases.map((phase) => retainedPhases.get(phase.slug)?.imageUrl?.startsWith(`/kayan/${slug}/`) ? { ...phase, imageUrl: retainedPhases.get(phase.slug).imageUrl } : phase);
    const projectCapturedAt = new Date(Math.max(...value.captured)).toISOString();
    const audit = completeness({ expected: value.units.length, units: value.units, identities: value.identities });
    audits[slug] = audit;
    projects.push({
      project: {
        developerSlug: 'kayan', slug, name: snapshots.find((item) => item.house.projectSlug === slug)?.house.projectName ?? slug,
        totalUnits: value.units.length,
        availableUnits: value.units.filter((unit) => unit.status === 'available').length,
        updatedAt: projectCapturedAt,
        phases: value.phases,
        queues: kayanProjectQueues[slug] ?? [],
      },
      sourceCount: value.units.length,
      completeness: audit,
      units: value.units,
      layouts: value.layouts,
    });
  }
  assert(projects.some((item) => item.project.slug === 'mirador') && projects.some((item) => item.project.slug === 'ofiyat'), 'KAYAN capture must contain Mirador and Ofiyat');
  return { artifact: { generatedAt: capturedAt, projects }, audit: audits };
}

const kayanHouses = Object.freeze({
  154813: Object.freeze({ projectSlug: 'mirador', projectName: 'Mirador', phaseSlug: 'main', phaseName: 'Mirador', propertyType: 'apartment' }),
  153505: Object.freeze({ projectSlug: 'ofiyat', projectName: 'Ofiyat', phaseSlug: 'phase-1', phaseName: 'I очередь', propertyType: 'apartment' }),
  153506: Object.freeze({ projectSlug: 'ofiyat', projectName: 'Ofiyat', phaseSlug: 'phase-2', phaseName: 'II очередь', propertyType: 'apartment' }),
  154273: Object.freeze({ projectSlug: 'ofiyat', projectName: 'Ofiyat', phaseSlug: 'parking', phaseName: 'Паркинг', propertyType: 'parking' }),
});

export function normalizeKayanPropertyResponses(responses, capturedAt = new Date().toISOString(), template = null) {
  assert(Array.isArray(responses) && responses.length === 4, `KAYAN requires four house responses, received ${responses?.length ?? 0}`);
  const responseByHouse = new Map();
  for (const root of responses) {
    assert(root?.status === 'success' && record(root.data), 'KAYAN property response status/data is invalid');
    assert(Array.isArray(root.data.properties), 'KAYAN data.properties must be an array');
    const filteredCount = integer(root.data.filteredCount);
    assert(filteredCount !== null && filteredCount >= 0, 'KAYAN filteredCount is invalid');
    assert(root.data.properties.length === filteredCount, `KAYAN returned ${root.data.properties.length} of ${filteredCount} properties`);
    const houseIds = new Set(root.data.properties.map((row) => integer(row?.house_id)));
    assert(houseIds.size === 1, 'KAYAN response mixes or omits house IDs');
    const houseId = [...houseIds][0];
    assert(kayanHouses[houseId], `KAYAN response has unexpected house ${houseId}`);
    assert(!responseByHouse.has(houseId), `KAYAN duplicate house response ${houseId}`);
    responseByHouse.set(houseId, root.data.properties);
  }
  for (const houseId of Object.keys(kayanHouses).map(Number)) assert(responseByHouse.has(houseId), `KAYAN missing house ${houseId}`);

  const retainedProjects = new Map((template?.projects ?? []).map((item) => [item?.project?.slug, item]));
  const globalIds = new Set();
  const grouped = new Map();
  for (const [houseId, rows] of responseByHouse) {
    const house = kayanHouses[houseId];
    const queue = kayanQueue(house.projectSlug, house.phaseSlug, house.propertyType);
    const retainedProject = retainedProjects.get(house.projectSlug);
    const retainedUnits = new Map((retainedProject?.units ?? []).map((unit) => [unit.sourceKey, unit]));
    const project = grouped.get(house.projectSlug) ?? { phases: [], units: [], identities: new Set(), expected: 0 };
    project.expected += rows.length;
    project.phases.push({
      sourceId: String(houseId),
      slug: house.phaseSlug,
      name: house.phaseName,
      propertyType: house.propertyType,
      sortOrder: project.phases.length + 1,
      imageUrl: retainedProject?.project?.phases?.find((phase) => phase.slug === house.phaseSlug)?.imageUrl ?? '',
      ...(queue ?? {}),
    });
    for (const [index, row] of rows.entries()) {
      assert(record(row), `KAYAN house ${houseId} row ${index + 1} is invalid`);
      const officialId = integer(row.id);
      const rowHouseId = integer(row.house_id);
      const floor = integer(row.floor);
      const rooms = house.propertyType === 'parking' ? null : integer(row.rooms_amount);
      const number = numberText(row.number, `KAYAN house ${houseId} row ${index + 1}.number`);
      const entrance = numberText(row.sectionName, `KAYAN house ${houseId} row ${index + 1}.sectionName`);
      const area = positive(row.area?.area_total);
      assert(officialId !== null && officialId > 0, `KAYAN house ${houseId} row ${index + 1}.id is invalid`);
      assert(rowHouseId === houseId, `KAYAN row ${officialId} house mismatch`);
      // Profitbase represents underground parking levels with negative floors.
      assert(floor !== null && floor >= -10 && area !== null, `KAYAN row ${officialId} dimensions are invalid`);
      assert(rooms === null || rooms >= 0, `KAYAN row ${officialId}.rooms_amount is invalid`);
      assert(!globalIds.has(officialId), `KAYAN duplicate official id ${officialId}`);
      globalIds.add(officialId);
      const normalizedStatus = status(row.status);
      assert(normalizedStatus !== 'unknown', `KAYAN row ${officialId} has unknown status ${JSON.stringify(row.status)}`);
      const sourceKey = `${houseId}:${house.propertyType}:${entrance}:${floor}:${number}`.toLowerCase();
      assert(!project.identities.has(sourceKey), `KAYAN duplicate identity ${sourceKey}`);
      project.identities.add(sourceKey);
      const price = normalizedStatus === 'available' ? optionalPositive(row.price?.value) : null;
      const pricePerM2 = normalizedStatus === 'available' ? optionalPositive(row.price?.pricePerMeter) : null;
      const retained = retainedUnits.get(sourceKey);
      project.units.push({
        id: String(officialId),
        sourceId: String(officialId),
        sourceKey,
        projectSlug: house.projectSlug,
        phaseSlug: house.phaseSlug,
        phaseName: house.phaseName,
        ...(queue ?? {}),
        propertyType: house.propertyType,
        rawPropertyType: String(row.propertyType || house.propertyType),
        status: normalizedStatus,
        rawStatus: String(row.status),
        number,
        entrance,
        floor,
        area,
        rooms,
        price,
        pricePerM2,
        currency: 'UZS',
        ...(retained?.planImageUrl?.startsWith(`/kayan/${house.projectSlug}/`) ? { planImageUrl: retained.planImageUrl } : {}),
      });
    }
    grouped.set(house.projectSlug, project);
  }

  const projects = [];
  const audits = {};
  for (const slug of ['mirador', 'ofiyat']) {
    const value = grouped.get(slug);
    assert(value, `KAYAN missing project ${slug}`);
    const retained = retainedProjects.get(slug);
    const audit = completeness({ expected: value.expected, units: value.units, identities: value.identities });
    assert(audit.complete, `KAYAN ${slug} completeness checks failed`);
    audits[slug] = audit;
    projects.push({
      project: {
        developerSlug: 'kayan',
        slug,
        name: slug === 'mirador' ? 'Mirador' : 'Ofiyat',
        totalUnits: value.units.length,
        availableUnits: value.units.filter((unit) => unit.status === 'available').length,
        updatedAt: capturedAt,
        phases: value.phases,
        queues: kayanProjectQueues[slug] ?? [],
      },
      sourceCount: value.expected,
      completeness: audit,
      units: value.units,
      layouts: retained?.layouts ?? [],
    });
  }
  return { artifact: { generatedAt: capturedAt, projects }, audit: audits };
}

export async function loadCaptureDirectory(path) {
  const root = resolve(path);
  const index = JSON.parse(await readFile(resolve(root, 'capture-index.json'), 'utf8'));
  assert(Array.isArray(index.records), 'capture-index records are missing');
  const records = [];
  for (const item of index.records) {
    assert(typeof item.bodyPath === 'string' && !item.bodyPath.startsWith('/') && !item.bodyPath.includes('..'), 'unsafe capture body path');
    const body = await readFile(resolve(root, item.bodyPath), 'utf8');
    assert(sha256(body) === item.sha256, `capture body checksum mismatch: ${item.bodyPath}`);
    records.push({ ...item, value: JSON.parse(body) });
  }
  return { ...index, records };
}

export async function loadLegacyProviderInput(providerId, inputPath) {
  const root = resolve(inputPath);
  if (providerId === 'uysot') return JSON.parse(await readFile(root, 'utf8'));
  if (providerId === 'regnum' || providerId === 'mbc') {
    const names = (await readdir(resolve(root, 'api'))).filter((name) => /^plans-\d+\.json$/.test(name)).sort();
    return Promise.all(names.map((name) => readFile(resolve(root, 'api', name), 'utf8').then(JSON.parse)));
  }
  if (providerId === 'sun') {
    const names = (await readdir(resolve(root, 'api/objects'))).filter((name) => /^page-\d+\.json$/.test(name)).sort();
    return Promise.all(names.map((name) => readFile(resolve(root, 'api/objects', name), 'utf8').then(JSON.parse)));
  }
  if (providerId === 'kayan') {
    const names = (await readdir(root)).filter((name) => /^(?:mirador|ofiyat[^/]*)\.json$/.test(name)).sort();
    return Promise.all(names.map((name) => readFile(resolve(root, name), 'utf8').then(JSON.parse)));
  }
  fail(`${providerId}: no legacy input loader`);
}
