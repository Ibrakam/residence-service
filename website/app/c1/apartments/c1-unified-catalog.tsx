'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogLanguage, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

export type C1SafeUnit = {
  id: string;
  unitKey?: string;
  sourceKey?: string;
  sourceOrder: number;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  section: string;
  phase: string;
  completionYear: string;
  status: string;
  priceVisible: boolean;
  plan: string;
  hasOfficialFloorPolygon: boolean;
};

export type C1SafeSnapshot = {
  capturedAt: string;
  serverDate: string;
  availableTotal: number;
  interactiveBuildingTotal: number;
  reconciliation: string;
  counts: { rooms: Record<string, number> };
  filters: {
    rooms: number[];
    sections: string[];
    phases: string[];
    floors: number[];
    area: { min: number; max: number };
  };
  units: C1SafeUnit[];
};

type Language = 'ru' | 'uz' | 'en';

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';

const capabilities: CatalogCapabilities = {
  visualFlow: false,
  exactUnitPlans: true,
  secondaryPlans: false,
  pricesVisible: false,
  phases: true,
  buildings: false,
  entrances: true,
};

function trackedHref(path: string, language: CatalogLanguage, currentQuery: string, extra?: Record<string, string>) {
  const current = new URLSearchParams(currentQuery);
  const query = new URLSearchParams({ lang: language });
  current.forEach((value, key) => {
    if (key.startsWith('utm_') || key === 'tcid' || key === 'fbclid') query.append(key, value);
  });
  Object.entries(extra ?? {}).forEach(([key, value]) => query.set(key, value));
  return `${basePath}${path}?${query.toString()}`;
}

function isSafeAvailableUnit(unit: C1SafeUnit) {
  return (unit.status === 'AVAILABLE' || unit.status === 'available')
    && unit.priceVisible === false
    && /^\/c1\/plans\/[a-f0-9]{16}\.webp$/.test(unit.plan);
}

export function C1UnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: C1SafeSnapshot; initialLanguage?: Language }) {
  const params = useSearchParams();
  const currentQuery = params.toString();
  const { data: snapshot, dataSource, refreshedAt } = useLiveCatalogSnapshot('c1', embeddedSnapshot);

  const units = useMemo<CatalogUnit[]>(() => snapshot.units
    .filter(isSafeAvailableUnit)
    .map((unit) => ({
      id: String(unit.id),
      unitKey: unit.sourceKey?.trim() || unit.unitKey?.trim() || undefined,
      number: String(unit.number),
      rooms: unit.rooms > 0 ? unit.rooms : undefined,
      area: unit.area,
      floor: unit.floor,
      entrance: unit.section || undefined,
      phase: unit.phase || undefined,
      propertyType: 'apartment',
      status: 'available',
      plans: [{ src: unit.plan, kind: 'unit' }],
    })), [snapshot.units]);

  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: 'C1',
    brandSubtitle: 'TASHKENT',
    eyebrow: { ru: 'C1 · ПРЕМИУМ-КЛАСС', uz: 'C1 · PREMIUM-KLASS', en: 'C1 · PREMIUM' },
    title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
    accent: { ru: 'на своей высоте.', uz: 'o‘z balandligingizda.', en: 'at your elevation.' },
    lead: {
      ru: 'Доступные квартиры из официального каталога с точными локальными планировками. Сдача — I квартал 2028 года; цены — по запросу.',
      uz: 'Rasmiy katalogdagi mavjud xonadonlar aniq mahalliy rejalar bilan. Topshirish — 2028-yil I chorak; narxlar — so‘rov bo‘yicha.',
      en: 'Available apartments from the official catalogue with exact local plans. Completion is Q1 2028; prices are on request.',
    },
    backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
    backHref: (language) => trackedHref('/c1', language, currentQuery),
    privacyHref: (language) => trackedHref('/privacy', language, currentQuery, { project: 'c1', from: 'catalog' }),
    phone: '+998 78 113 77 12',
    storageKey: 'c1-language',
    cardPageSize: 12,
    defaultSort: 'status',
    availableOnlyDefault: true,
    disclaimer: {
      ru: 'Каталог использует типизированный API как канон. Три квартиры 26-го этажа не имеют проверенного полигона здания, поэтому визуальный выбор не показывается. Цены не публикуются; наличие и условия подтверждает менеджер.',
      uz: 'Katalog tiplangan API maʼlumotlarini asos sifatida ishlatadi. 26-qavatdagi uch xonadonning tekshirilgan bino poligoni yo‘q, shu sabab vizual tanlov ko‘rsatilmaydi. Narxlar eʼlon qilinmaydi; mavjudlik va shartlarni menejer tasdiqlaydi.',
      en: 'The typed API is the catalogue authority. Three floor-26 apartments have no verified building polygon, so visual selection is not shown. Prices are not published; a manager confirms availability and terms.',
    },
    theme: {
      '--catalog-ink': '#17202c',
      '--catalog-paper': '#e8ebef',
      '--catalog-surface': '#f8f9fb',
      '--catalog-accent': '#6e879f',
      '--catalog-accent-soft': '#b8c5d0',
    },
  }), [currentQuery]);

  return <ApartmentCatalog
    project={{
      slug: 'c1',
      name: 'C1',
      className: 'Premium',
      statusLabel: { ru: 'I квартал 2028', uz: '2028-yil I chorak', en: 'Q1 2028' },
      availableCount: units.length,
      totalCount: units.length,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
