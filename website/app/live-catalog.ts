'use client';

import { useEffect, useMemo, useState } from 'react';

export type LiveCatalogStatus = 'available' | 'reserved' | 'sold' | 'unavailable';

export type LiveCatalogProject = {
  slug: string;
  name: string;
  totalUnits: number;
  availableUnits: number;
  updatedAt?: string;
  phases?: Array<{
    slug: string;
    name: string;
    floorsTotal: number;
    totalUnits: number;
    availableUnits: number;
  }>;
};

export type LiveCatalogUnit = {
  id: number;
  sourceKey: string;
  projectSlug: string;
  phaseSlug: string;
  phaseName: string;
  propertyType: string;
  rawPropertyType: string;
  status: LiveCatalogStatus;
  rawStatus: string;
  number: string;
  entrance?: string;
  floor: number;
  area: number;
  rooms?: number;
  price?: number;
  pricePerM2?: number;
  currency: string;
  planImageUrl?: string;
  isActive: boolean;
  sourceUpdatedAt: string;
  updatedAt: string;
};

type LivePayload = {
  project: LiveCatalogProject;
  units: LiveCatalogUnit[];
  refreshedAt: string;
};

type LiveProjectPayload = {
  project: LiveCatalogProject;
  refreshedAt: string;
};

export type CatalogDataSource = 'live' | 'cached' | 'embedded';

export function catalogLeadIdentity(unit: unknown): { unitKey?: string } {
  if (!isRecord(unit)) return {};
  const sourceKey = typeof unit.sourceKey === 'string' ? unit.sourceKey.trim() : '';
  if (sourceKey) return { unitKey: sourceKey };
  // Embedded IDs belong to legacy presentation bundles and are not CRM IDs.
  // A general project lead is safer than submitting an identity that may point
  // at another row or fail the backend consistency check.
  return {};
}

export function parseCatalogDate(value: unknown, dateOnlyAtNoonUTC = false): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = dateOnlyAtNoonUTC && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00Z`
    : value;
  const date = new Date(normalized);
  return Number.isFinite(date.getTime()) ? date : null;
}

type CatalogState<T> = {
  data: T;
  dataSource: CatalogDataSource;
  refreshedAt?: string;
  project?: LiveCatalogProject;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const configuredAPI = process.env.NEXT_PUBLIC_CATALOG_API_URL?.trim().replace(/\/+$/, '');
const catalogAPI = configuredAPI || `${appBasePath}/residence-api`;
const refreshIntervalMs = 60_000;
const requestTimeoutMs = 15_000;
const cachedPayloadMaxAgeMs = 7 * 24 * 60 * 60 * 1_000;
const cacheVersion = 1;
const availableOnlyCatalogues = new Set(['4u', 'flagman', 'maftun-makon', 'regnum-plaza', 'sado', 'sun', 'voha']);

function cacheKey(projectSlug: string) {
  return `tencorp:live-catalog:v${cacheVersion}:${projectSlug}`;
}

function projectCacheKey(projectSlug: string) {
  return `tencorp:live-catalog-project:v${cacheVersion}:${projectSlug}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLiveUnit(value: unknown, projectSlug: string): value is LiveCatalogUnit {
  if (!isRecord(value)) return false;
  return value.projectSlug === projectSlug
    && typeof value.sourceKey === 'string'
    && typeof value.number === 'string'
    && typeof value.floor === 'number'
    && Number.isFinite(value.floor)
    && typeof value.area === 'number'
    && Number.isFinite(value.area)
    && typeof value.sourceUpdatedAt === 'string'
    && Number.isFinite(Date.parse(value.sourceUpdatedAt))
    && typeof value.status === 'string'
    && ['available', 'reserved', 'sold', 'unavailable'].includes(value.status);
}

function isLivePayload(value: unknown, projectSlug: string): value is LivePayload {
  if (!isRecord(value) || !isRecord(value.project) || !Array.isArray(value.units)) return false;
  if (value.project.slug !== projectSlug || typeof value.project.totalUnits !== 'number') return false;
  if (typeof value.refreshedAt !== 'string' || !Number.isFinite(Date.parse(value.refreshedAt))) return false;
  return value.units.length === value.project.totalUnits
    && value.units.every((unit) => isLiveUnit(unit, projectSlug));
}

function isLiveProject(value: unknown, projectSlug: string): value is LiveCatalogProject {
  return isRecord(value)
    && value.slug === projectSlug
    && typeof value.name === 'string'
    && typeof value.totalUnits === 'number'
    && Number.isInteger(value.totalUnits)
    && value.totalUnits >= 0
    && typeof value.availableUnits === 'number'
    && Number.isInteger(value.availableUnits)
    && value.availableUnits >= 0
    && value.availableUnits <= value.totalUnits;
}

function readCachedProject(projectSlug: string): LiveProjectPayload | null {
  try {
    const raw = window.localStorage.getItem(projectCacheKey(projectSlug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isLiveProject(parsed.project, projectSlug) || typeof parsed.refreshedAt !== 'string') return null;
    if (!Number.isFinite(Date.parse(parsed.refreshedAt)) || Date.now() - Date.parse(parsed.refreshedAt) > cachedPayloadMaxAgeMs) return null;
    return parsed as LiveProjectPayload;
  } catch {
    return null;
  }
}

function saveCachedProject(projectSlug: string, payload: LiveProjectPayload) {
  try {
    window.localStorage.setItem(projectCacheKey(projectSlug), JSON.stringify(payload));
  } catch {
    // Storage can be disabled or full. The in-memory last-known-good still works.
  }
}

function readCachedPayload(projectSlug: string): LivePayload | null {
  try {
    const raw = window.localStorage.getItem(cacheKey(projectSlug));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLivePayload(parsed, projectSlug)) return null;
    if (Date.now() - Date.parse(parsed.refreshedAt) > cachedPayloadMaxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedPayload(projectSlug: string, payload: LivePayload) {
  try {
    window.localStorage.setItem(cacheKey(projectSlug), JSON.stringify(payload));
  } catch {
    // Storage can be disabled or full. The in-memory last-known-good still works.
  }
}

async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal,
  });
  if (!response.ok) throw new Error(`catalog request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchLivePayload(projectSlug: string, signal: AbortSignal): Promise<LivePayload> {
  const projectURL = `${catalogAPI}/v1/projects/${encodeURIComponent(projectSlug)}`;
  const unitsURL = `${projectURL}/units`;
  const [project, firstPage] = await Promise.all([
    fetchJSON<LiveCatalogProject>(projectURL, signal),
    fetchJSON<{ items: unknown[]; total: number; limit: number; offset: number }>(`${unitsURL}?limit=500&offset=0`, signal),
  ]);

  if (!project || project.slug !== projectSlug || !Number.isInteger(firstPage.total) || firstPage.total < 0) {
    throw new Error('catalog response has an invalid project or total');
  }

  const rawUnits = [...firstPage.items];
  const requests: Array<Promise<{ items: unknown[] }>> = [];
  for (let offset = 500; offset < firstPage.total; offset += 500) {
    requests.push(fetchJSON<{ items: unknown[] }>(`${unitsURL}?limit=500&offset=${offset}`, signal));
  }
  const pages = await Promise.all(requests);
  pages.forEach((page) => rawUnits.push(...page.items));

  if (rawUnits.length !== firstPage.total || rawUnits.length !== project.totalUnits) {
    throw new Error('catalog response is partial');
  }
  if (!rawUnits.every((unit) => isLiveUnit(unit, projectSlug))) {
    throw new Error('catalog response has invalid units');
  }
  const generations = new Set(rawUnits.map((unit) => Date.parse(unit.sourceUpdatedAt as string)));
  if (generations.size > 1) {
    throw new Error('catalog response spans multiple import generations');
  }

  const units = rawUnits as LiveCatalogUnit[];
  const sourceTimes = units.map((unit) => Date.parse(unit.sourceUpdatedAt)).filter(Number.isFinite);
  const projectTime = project.updatedAt ? Date.parse(project.updatedAt) : Number.NaN;
  const sourceTimestamps = [...sourceTimes, ...(Number.isFinite(projectTime) ? [projectTime] : [])];
  const refreshedAt = new Date(sourceTimestamps.length ? Math.max(...sourceTimestamps) : Date.now()).toISOString();
  return { project, units, refreshedAt };
}

function useLivePayload(projectSlug: string) {
  const [payload, setPayload] = useState<LivePayload | null>(null);
  const [dataSource, setDataSource] = useState<CatalogDataSource>('embedded');

  useEffect(() => {
    let disposed = false;
    let activeRequest: AbortController | null = null;
    const restoreCached = window.setTimeout(() => {
      if (disposed) return;
      const cached = readCachedPayload(projectSlug);
      if (!cached) return;
      setPayload(cached);
      setDataSource('cached');
    }, 0);

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const next = await fetchLivePayload(projectSlug, controller.signal);
        if (disposed) return;
        setPayload(next);
        setDataSource('live');
        saveCachedPayload(projectSlug, next);
      } catch {
        // Keep the last complete API response, then the embedded catalogue.
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();
    void refresh();
    const interval = window.setInterval(() => void refresh(), refreshIntervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      activeRequest?.abort();
      window.clearTimeout(restoreCached);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [projectSlug]);

  return { payload, dataSource };
}

function normalized(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function localEntrance(unit: Record<string, unknown>) {
  return unit.entrance ?? unit.section ?? '';
}

function exactIdentity(unit: Record<string, unknown>) {
  const area = typeof unit.area === 'number' ? unit.area.toFixed(2) : normalized(unit.area);
  return [normalized(unit.number), unit.floor ?? '', normalized(localEntrance(unit)), unit.rooms ?? '', area].join('|');
}

function looseIdentity(unit: Record<string, unknown>) {
  return [normalized(unit.number), unit.floor ?? '', normalized(localEntrance(unit))].join('|');
}

function phaseAffinity(local: Record<string, unknown>, live: LiveCatalogUnit) {
  const localPhase = normalized(local.phaseSlug ?? local.phaseName ?? local.phase ?? local.buildingDisplay ?? local.building ?? local.block ?? local.queue);
  if (!localPhase) return 0;
  const livePhase = normalized(`${live.phaseSlug} ${live.phaseName}`);
  if (localPhase === normalized(live.phaseSlug) || localPhase === normalized(live.phaseName)) return 4;
  return livePhase.includes(localPhase) || localPhase.includes(normalized(live.phaseSlug)) ? 2 : 0;
}

function takeBestMatch(
  candidates: Record<string, unknown>[] | undefined,
  live: LiveCatalogUnit,
  used: Set<Record<string, unknown>>,
) {
  const available = (candidates ?? []).filter((candidate) => !used.has(candidate));
  if (!available.length) return undefined;
  const best = available.sort((a, b) => phaseAffinity(b, live) - phaseAffinity(a, live))[0];
  used.add(best);
  return best;
}

function numericLike(templateValue: unknown, value: string | undefined) {
  if (typeof templateValue !== 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : templateValue;
}

function statusFor(projectSlug: string, status: LiveCatalogStatus) {
  if (projectSlug === 'avalon-residence') {
    if (status === 'available') return 'free';
    if (status === 'sold') return 'sold';
    return 'occupied';
  }
  if (projectSlug === 'sun') return status === 'reserved' ? 'reserve' : status;
  return status;
}

function assignIfPresent(target: Record<string, unknown>, key: string, value: unknown) {
  if (key in target) target[key] = value;
}

function schemaDefault(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, schemaDefault(nested)]));
  }
  if (typeof value === 'string') return '';
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
}

/**
 * New API units must never borrow listing-specific values from a different
 * embedded unit. This keeps the local object shape expected by each bespoke
 * catalogue, while every value starts empty until the normalized API fills it.
 */
function emptyUnitFromSchema(template: Record<string, unknown> | undefined) {
  if (!template) return {};
  return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, schemaDefault(value)]));
}

function assignPlan(result: Record<string, unknown>, planImageUrl: string) {
  for (const key of [
    'plan',
    'planUrl',
    'planImageUrl',
    'primaryPlanPath',
    'thumbnail',
    'planPublicPath',
    'sourcePlan',
    'planSource',
    'sheetPage1',
  ]) {
    assignIfPresent(result, key, planImageUrl);
  }

  for (const key of ['planSourceUrls', 'planUrls']) {
    if (!isRecord(result[key])) continue;
    result[key] = Object.fromEntries(Object.entries(result[key]).map(([nestedKey, nestedValue]) => [
      nestedKey,
      /(?:page\s*2|secondary|second)/i.test(nestedKey) ? nestedValue : planImageUrl,
    ]));
  }
}

function publicPlanPath(value: string | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '';
  return value;
}

function adaptUnit(
  projectSlug: string,
  live: LiveCatalogUnit,
  template: Record<string, unknown> | undefined,
  fallbackTemplate: Record<string, unknown> | undefined,
  index: number,
  maxFloor: number,
) {
  const matched = Boolean(template);
  const result: Record<string, unknown> = matched
    ? { ...template }
    : emptyUnitFromSchema(fallbackTemplate);
  const currentPrice = live.price ?? 0;
  const currentPricePerM2 = live.pricePerM2 ?? (live.price && live.area ? live.price / live.area : 0);

  result.id = matched && template?.id !== undefined ? template.id : live.id;
  result.sourceKey = live.sourceKey;
  result.number = numericLike(result.number, live.number);
  result.floor = live.floor;
  result.area = live.area;
  if (live.rooms !== undefined) result.rooms = live.rooms;
  result.currency = live.currency || 'UZS';

  assignIfPresent(result, 'sourceKey', live.sourceKey);
  assignIfPresent(result, 'unitKey', live.sourceKey);
  assignIfPresent(result, 'phaseSlug', live.phaseSlug);
  assignIfPresent(result, 'phaseName', live.phaseName);
  assignIfPresent(result, 'propertyType', live.propertyType);
  assignIfPresent(result, 'rawPropertyType', live.rawPropertyType);
  assignIfPresent(result, 'rawStatus', live.rawStatus);
  assignIfPresent(result, 'statusOriginal', live.rawStatus);
  assignIfPresent(result, 'status', statusFor(projectSlug, live.status));
  assignIfPresent(result, 'isActive', live.isActive);
  assignIfPresent(result, 'isSale', live.status === 'available');
  assignIfPresent(result, 'canBuy', live.status === 'available');
  assignIfPresent(result, 'strictOfferEligible', live.status === 'available');
  assignIfPresent(result, 'sourceUpdatedAt', live.sourceUpdatedAt);
  assignIfPresent(result, 'updatedAt', live.updatedAt);
  assignIfPresent(result, 'entrance', numericLike(result.entrance, live.entrance));
  assignIfPresent(result, 'section', numericLike(result.section, live.entrance));
  assignIfPresent(result, 'price', currentPrice);
  assignIfPresent(result, 'effectivePrice', currentPrice);
  assignIfPresent(result, 'displayPrice', currentPrice);
  assignIfPresent(result, 'pricePerM2', currentPricePerM2);
  assignIfPresent(result, 'currentPricePerM2', currentPricePerM2);
  assignIfPresent(result, 'sourcePricePerM2', currentPricePerM2);
  assignIfPresent(result, 'totalPriceWithDiscountRaw', currentPrice);
  // The normalized contract currently exposes one effective price. Never invent
  // a crossed-out "before discount" price until the API supplies it explicitly.
  assignIfPresent(result, 'oldPrice', 0);
  assignIfPresent(result, 'regularPrice', 0);
  assignIfPresent(result, 'snapshotCampaignPrice', null);
  assignIfPresent(result, 'campaignActive', false);
  assignIfPresent(result, 'promotion', null);
  assignIfPresent(result, 'maxFloor', maxFloor);
  assignIfPresent(result, 'totalFloors', maxFloor);
  assignIfPresent(result, 'sourceOrder', index);

  const phaseName = live.phaseName || live.phaseSlug;
  assignIfPresent(result, 'phase', phaseName);
  assignIfPresent(result, 'building', phaseName);
  assignIfPresent(result, 'buildingDisplay', phaseName);
  assignIfPresent(result, 'buildingId', live.phaseSlug);
  assignIfPresent(result, 'block', phaseName);
  assignIfPresent(result, 'blockName', phaseName);
  const queue = Number(live.phaseSlug.match(/\d+/)?.[0] ?? live.phaseName.match(/\d+/)?.[0]);
  if (Number.isFinite(queue)) assignIfPresent(result, 'queue', queue);

  const planPath = publicPlanPath(live.planImageUrl);
  if (planPath) assignPlan(result, planPath);

  return result;
}

function countBy<T>(values: T[]) {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return counts;
}

function summary<T>(values: T[]) {
  return [...countBy(values)].map(([value, count]) => ({ value, count }));
}

function numericRange(values: unknown[]) {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : { min: 0, max: 0 };
}

function updateFilterMetadata(snapshot: Record<string, unknown>, units: Record<string, unknown>[]) {
  const rooms = units.map((unit) => unit.rooms).filter((value): value is number => typeof value === 'number');
  const floors = units.map((unit) => unit.floor).filter((value): value is number => typeof value === 'number');
  const entrances = units.map((unit) => localEntrance(unit)).filter((value) => value !== '');
  const areas = units.map((unit) => unit.area);
  const prices = units.map((unit) => unit.price);
  const pricePerM2 = units.map((unit) => unit.pricePerM2 ?? unit.currentPricePerM2 ?? unit.sourcePricePerM2);

  if (isRecord(snapshot.filterSummary)) {
    const filters = { ...snapshot.filterSummary };
    const existingRooms = filters.rooms;
    if (Array.isArray(existingRooms)) filters.rooms = existingRooms.some(isRecord) ? summary(rooms) : [...new Set(rooms)].sort((a, b) => a - b);
    if (Array.isArray(filters.roomCounts)) filters.roomCounts = summary(rooms);
    if (Array.isArray(filters.entrances)) filters.entrances = filters.entrances.some(isRecord)
      ? summary(entrances).map(({ value, count }) => ({ value: numericLike(0, String(value)), count }))
      : [...new Set(entrances)].sort();
    if (Array.isArray(filters.statuses)) filters.statuses = summary(units.map((unit) => unit.statusOriginal ?? unit.rawStatus ?? unit.status));
    if (Array.isArray(filters.isSale)) filters.isSale = summary(units.map((unit) => Boolean(unit.isSale)));
    if (Array.isArray(filters.canBuy)) filters.canBuy = summary(units.map((unit) => Boolean(unit.canBuy)));
    if (isRecord(filters.repairIncluded)) filters.repairIncluded = { true: units.filter((unit) => unit.repairIncluded === true).length, false: units.filter((unit) => unit.repairIncluded !== true).length };
    if (isRecord(filters.studio)) filters.studio = { true: units.filter((unit) => unit.studio === true).length, false: units.filter((unit) => unit.studio !== true).length };

    const areaRange = numericRange(areas);
    const priceRange = numericRange(prices);
    const ppmRange = numericRange(pricePerM2);
    const floorRange = numericRange(floors);
    for (const [key, value] of Object.entries({ areaMin: areaRange.min, areaMax: areaRange.max, currentPriceMin: priceRange.min, currentPriceMax: priceRange.max, originalPriceMin: priceRange.min, originalPriceMax: priceRange.max, sourcePricePerM2Min: ppmRange.min, sourcePricePerM2Max: ppmRange.max, floorMin: floorRange.min, floorMax: floorRange.max })) {
      if (key in filters) filters[key] = value;
    }
    if (isRecord(filters.ranges)) {
      const ranges = { ...filters.ranges };
      for (const key of ['area']) if (key in ranges) ranges[key] = areaRange;
      for (const key of ['currentCampaignPrice', 'sourceTotalPrice', 'snapshotPrice', 'rawTotalPrice', 'campaignPrice']) if (key in ranges) ranges[key] = priceRange;
      for (const key of ['sourcePricePerM2', 'snapshotPricePerM2']) if (key in ranges) ranges[key] = ppmRange;
      if ('floor' in ranges) ranges.floor = floorRange;
      filters.ranges = ranges;
    }
    snapshot.filterSummary = filters;
  }

  if (isRecord(snapshot.filters)) {
    const filters = { ...snapshot.filters };
    if (Array.isArray(filters.roomCounts)) filters.roomCounts = summary(rooms);
    if (Array.isArray(filters.floors)) filters.floors = [...new Set(floors)].sort((a, b) => a - b);
    if (Array.isArray(filters.entrances)) filters.entrances = [...new Set(entrances)].sort();
    if (Array.isArray(filters.statuses)) filters.statuses = summary(units.map((unit) => unit.statusOriginal ?? unit.rawStatus ?? unit.status)).map(({ value, count }) => ({ status: value, count }));
    if (isRecord(filters.area)) filters.area = numericRange(areas);
    if (isRecord(filters.campaignPrice)) filters.campaignPrice = numericRange(prices);
    snapshot.filters = filters;
  }
}

export function mergeLiveCatalogUnits<T extends object>(projectSlug: string, embeddedUnits: readonly T[], liveUnits: LiveCatalogUnit[]) {
  const exact = new Map<string, Record<string, unknown>[]>();
  const loose = new Map<string, Record<string, unknown>[]>();
  const embedded = embeddedUnits as readonly Record<string, unknown>[];
  embedded.forEach((unit) => {
    const exactKey = exactIdentity(unit);
    const looseKey = looseIdentity(unit);
    exact.set(exactKey, [...(exact.get(exactKey) ?? []), unit]);
    loose.set(looseKey, [...(loose.get(looseKey) ?? []), unit]);
  });

  const used = new Set<Record<string, unknown>>();
  const floorByPhase = new Map<string, number>();
  const displayUnits = availableOnlyCatalogues.has(projectSlug)
    ? liveUnits.filter((unit) => unit.status === 'available')
    : liveUnits;
  displayUnits.forEach((unit) => floorByPhase.set(unit.phaseSlug, Math.max(floorByPhase.get(unit.phaseSlug) ?? 0, unit.floor)));

  return displayUnits.map((unit, index) => {
    const record = unit as unknown as Record<string, unknown>;
    const template = takeBestMatch(exact.get(exactIdentity(record)), unit, used)
      ?? takeBestMatch(loose.get(looseIdentity(record)), unit, used);
    const fallbackTemplate = embedded.find((candidate) => candidate.rooms === unit.rooms)
      ?? embedded[0];
    const phaseFloor = floorByPhase.get(unit.phaseSlug) ?? unit.floor;
    const knownFloor = Number(template?.maxFloor ?? template?.totalFloors ?? phaseFloor);
    return adaptUnit(projectSlug, unit, template, fallbackTemplate, index, Math.max(phaseFloor, knownFloor)) as T;
  });
}

function mergeSnapshot<T extends { units: readonly object[] }>(projectSlug: string, embedded: T, payload: LivePayload): T {
  const units = mergeLiveCatalogUnits(projectSlug, embedded.units, payload.units);
  const next = { ...embedded, units } as T;
  const mutable = next as unknown as Record<string, unknown>;
  const freshness = payload.project.updatedAt || payload.units[0]?.sourceUpdatedAt || payload.refreshedAt;
  for (const key of ['capturedAt', 'capturedAtUzt', 'generatedAt', 'dbUpdatedAt']) {
    if (key in mutable) mutable[key] = freshness;
  }
  for (const key of ['officialTotalAtCapture', 'sourceCount']) {
    if (key in mutable) mutable[key] = payload.project.totalUnits;
  }
  if ('offerCount' in mutable) mutable.offerCount = payload.project.availableUnits;
  updateFilterMetadata(mutable, units as Record<string, unknown>[]);
  return next;
}

export function useLiveCatalogSnapshot<T extends { units: readonly object[] }>(projectSlug: string, embeddedSnapshot: T): CatalogState<T> {
  const { payload, dataSource } = useLivePayload(projectSlug);
  const data = useMemo(
    () => payload ? mergeSnapshot(projectSlug, embeddedSnapshot, payload) : embeddedSnapshot,
    [embeddedSnapshot, payload, projectSlug],
  );
  return { data, dataSource, refreshedAt: payload?.project.updatedAt ?? payload?.refreshedAt, project: payload?.project };
}

export function useLiveCatalogUnits<T extends object>(projectSlug: string, embeddedUnits: readonly T[]): CatalogState<T[]> {
  const { payload, dataSource } = useLivePayload(projectSlug);
  const data = useMemo(
    () => payload ? mergeLiveCatalogUnits(projectSlug, embeddedUnits, payload.units) : [...embeddedUnits],
    [embeddedUnits, payload, projectSlug],
  );
  return { data, dataSource, refreshedAt: payload?.project.updatedAt ?? payload?.refreshedAt, project: payload?.project };
}

export function useLiveCatalogProject(projectSlug: string, embeddedProject: LiveCatalogProject): CatalogState<LiveCatalogProject> {
  const [project, setProject] = useState(embeddedProject);
  const [dataSource, setDataSource] = useState<CatalogDataSource>('embedded');
  const [refreshedAt, setRefreshedAt] = useState(embeddedProject.updatedAt);

  useEffect(() => {
    let disposed = false;
    let activeRequest: AbortController | null = null;
    const restoreCached = window.setTimeout(() => {
      if (disposed) return;
      const cached = readCachedProject(projectSlug);
      if (!cached) return;
      setProject(cached.project);
      setRefreshedAt(cached.project.updatedAt ?? cached.refreshedAt);
      setDataSource('cached');
    }, 0);

    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      activeRequest?.abort();
      const controller = new AbortController();
      activeRequest = controller;
      const timeout = window.setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const next = await fetchJSON<LiveCatalogProject>(`${catalogAPI}/v1/projects/${encodeURIComponent(projectSlug)}`, controller.signal);
        if (!isLiveProject(next, projectSlug)) throw new Error('catalog response has an invalid project');
        const nextPayload = { project: next, refreshedAt: new Date().toISOString() };
        if (disposed) return;
        setProject(next);
        setRefreshedAt(next.updatedAt ?? nextPayload.refreshedAt);
        setDataSource('live');
        saveCachedProject(projectSlug, nextPayload);
      } catch {
        // Keep the last complete project response, then the embedded summary.
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onOnline = () => void refresh();
    void refresh();
    const interval = window.setInterval(() => void refresh(), refreshIntervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      disposed = true;
      activeRequest?.abort();
      window.clearTimeout(restoreCached);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [projectSlug]);

  return { data: project, dataSource, refreshedAt };
}

export function liveCatalogAPIBase() {
  return catalogAPI;
}
