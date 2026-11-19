'use client';

import { useEffect, useMemo, useState } from 'react';
import capture from '../../data/dormon-showroom-prices.json';
import { catalogFreshness, fetchCatalogSyncHealth, useLiveCatalogUnits, type CatalogSyncProject, type LiveCatalogUnit } from '../live-catalog';

type Prices = Readonly<Record<string, number>>;
type PriceRow = { block: unknown; floor: unknown; number: unknown; price: unknown };

const projectSlug = 'dormon-hills';
const captureSource = 'https://app.uysot.uz/showroom/';
const capturedAt = Date.parse(capture.capturedAt);
const captureExpiresAt = capturedAt + 24 * 60 * 60_000;
const emptyPrices: Prices = Object.freeze({});

// The catalog adapter uses the embedded row's shape to select live fields.
const catalogSchema: Array<Pick<LiveCatalogUnit, 'phaseName' | 'floor' | 'number' | 'sourceUpdatedAt' | 'propertyType' | 'currency' | 'status' | 'isActive' | 'price'>> = [{
  phaseName: '', floor: 0, number: '', sourceUpdatedAt: '', propertyType: '', currency: '', status: 'unavailable', isActive: false, price: 0,
}];

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function keyPart(value: unknown): number | undefined {
  const numeric = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return positiveInteger(numeric) ? numeric : undefined;
}

function priceKey(block: unknown, floor: unknown, number: unknown): string {
  const blockName = typeof block === 'string' ? /^(?:БЛОК[\s-]+)?([АБВГД])$/.exec(block.trim().toUpperCase())?.[1] : undefined;
  const floorNumber = keyPart(floor);
  const unitNumber = keyPart(number);
  return blockName && floorNumber && unitNumber ? `${blockName}:${floorNumber}:${unitNumber}` : '';
}

export function dormonShowroomPriceKey(block: string, floor: string | number, number: number): string {
  return priceKey(block, floor, number);
}

function buildPrices(rows: Iterable<PriceRow>): Prices {
  const prices: Record<string, number> = {};
  const seen = new Set<string>();
  for (const { block, floor, number, price } of rows) {
    const key = priceKey(block, floor, number);
    if (!key) continue;
    if (seen.has(key)) delete prices[key];
    else if (positiveInteger(price)) prices[key] = price;
    seen.add(key);
  }
  return prices;
}

const capturedPrices = capture.source === captureSource && Number.isFinite(capturedAt) ? buildPrices(capture.units) : emptyPrices;

export function useDormonShowroomPrices(): Prices {
  const { data, dataSource, refreshedAt } = useLiveCatalogUnits(projectSlug, catalogSchema);
  const [now, setNow] = useState(0);
  const [health, setHealth] = useState<CatalogSyncProject>();

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setNow(Date.now());
      if (dataSource === 'live') {
        const projects = await fetchCatalogSyncHealth();
        const matching = projects.filter((project) => project.projectSlug === projectSlug);
        if (active) setHealth(matching.length === 1 ? matching[0] : undefined);
      }
    };
    const initial = window.setTimeout(() => void refresh(), 0);
    const polling = window.setInterval(() => void refresh(), 30_000);
    const expireCapture = captureExpiresAt - Date.now();
    const expiry = expireCapture > 0 && expireCapture <= 24 * 60 * 60_000
      ? window.setTimeout(() => setNow(Date.now()), expireCapture)
      : undefined;
    return () => {
      active = false;
      window.clearTimeout(initial);
      window.clearInterval(polling);
      window.clearTimeout(expiry);
    };
  }, [dataSource, refreshedAt]);

  return useMemo(() => {
    if (now && dataSource === 'live' && catalogFreshness(refreshedAt, health, now) === 'live') {
      return buildPrices(data.filter((row) => row.propertyType === 'apartment').map((row) => ({
        block: row.phaseName,
        floor: row.floor,
        number: row.number,
        price: row.isActive === true && row.status === 'available' && row.currency === 'UZS'
          && catalogFreshness(row.sourceUpdatedAt, health, now) === 'live' ? row.price : undefined,
      })));
    }
    // A newer API generation may have withdrawn an offer from the capture.
    if (Date.parse(refreshedAt ?? '') >= capturedAt) return emptyPrices;
    return capturedAt <= now && now < captureExpiresAt ? capturedPrices : emptyPrices;
  }, [data, dataSource, health, now, refreshedAt]);
}
