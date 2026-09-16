'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';

export type MerosSafeSnapshot = {
  capturedAt: string;
  totalCount: number;
  project: { name: string; totalUnits: number; availableUnits: number };
  units: Array<{
    id: string;
    sourceKey: string;
    number: string;
    rooms: number;
    area: number;
    floor: number;
    maxFloor: number;
    entrance: string;
    phase: string;
    phaseSlug: string;
    propertyType: string;
    status: 'available' | 'reserved' | 'sold' | 'unavailable';
    price: number;
    pricePerM2: number;
    currency: string;
    plan: string;
  }>;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const capabilities: CatalogCapabilities = {
  visualFlow: false,
  exactUnitPlans: true,
  secondaryPlans: false,
  pricesVisible: true,
  phases: false,
  buildings: true,
  entrances: true,
};

const presentation: CatalogPresentation = {
  brand: 'MEROS',
  brandSubtitle: 'RESIDENCE',
  eyebrow: { ru: 'Наследие в центре города', uz: 'Shahar markazidagi meros', en: 'A legacy in the city centre' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'с характером.', uz: 'o‘ziga xos.', en: 'with character.' },
  lead: {
    ru: 'Единый каталог реальных предложений с точными планировками, ценами и актуальными статусами.',
    uz: 'Aniq rejalar, narxlar va dolzarb holatlarga ega haqiqiy takliflarning yagona katalogi.',
    en: 'One catalogue of real listings with exact plans, prices and current statuses.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/meros?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=meros&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'meros-language',
  cardPageSize: 12,
  defaultSort: 'status',
  buildingLabel: { ru: 'Коллекция', uz: 'Kolleksiya', en: 'Collection' },
  allBuildingsLabel: { ru: 'Все коллекции', uz: 'Barcha kolleksiyalar', en: 'All collections' },
  disclaimer: {
    ru: 'Статусы, цены и состав предложений обновляются автоматически. Финальные условия подтверждает отдел продаж.',
    uz: 'Holatlar, narxlar va takliflar tarkibi avtomatik yangilanadi. Yakuniy shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'Statuses, prices and listings update automatically. The sales team confirms final terms.',
  },
  theme: {
    '--catalog-ink': '#241c18',
    '--catalog-paper': '#eee5d8',
    '--catalog-surface': '#fbf7f0',
    '--catalog-accent': '#6b2438',
    '--catalog-accent-soft': '#d9c8b4',
  },
};

export function MerosUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: MerosSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('meros', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => ({
    id: String(unit.id),
    unitKey: unit.sourceKey || undefined,
    number: String(unit.number),
    rooms: unit.rooms,
    area: unit.area,
    floor: unit.floor,
    maxFloor: unit.maxFloor,
    entrance: unit.entrance || undefined,
    building: unit.phase || undefined,
    propertyType: 'apartment',
    status: unit.status,
    price: unit.price > 0 ? unit.price : undefined,
    pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
    currency: unit.currency,
    plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
  })), [snapshot.units]);

  return <ApartmentCatalog
    project={{
      slug: 'meros',
      name: snapshot.project.name,
      address: 'Ташкент, Мирабадский район, ул. 8 Марта',
      className: 'Business & Comfort',
      availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length,
      totalCount: liveProject?.totalUnits ?? snapshot.totalCount,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
