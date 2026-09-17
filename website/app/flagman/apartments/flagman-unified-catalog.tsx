'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

export type FlagmanSafeUnit = {
  id: string;
  sourceKey: string;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  maxFloor: number;
  entrance: number;
  status: 'available';
  repairIncluded?: boolean;
  price: number;
  regularPrice: number;
  pricePerM2: number;
  currency: string;
  plan: string;
};

export type FlagmanSafeSnapshot = {
  project: {
    slug: string;
    name: string;
    propertyType: string;
    address: string;
    class: string;
    catalogMaxFloor: number;
    status: string;
  };
  capturedAt: string;
  totalCount: number;
  units: FlagmanSafeUnit[];
};

type Language = 'ru' | 'uz' | 'en';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const capabilities: CatalogCapabilities = {
  visualFlow: false,
  exactUnitPlans: true,
  secondaryPlans: false,
  pricesVisible: true,
  phases: false,
  buildings: false,
  entrances: true,
};

const presentation: CatalogPresentation = {
  brand: 'FLAGMAN',
  brandSubtitle: 'TASHKENT',
  eyebrow: { ru: 'FLAGMAN · ГОТОВЫЙ ДОМ', uz: 'FLAGMAN · TAYYOR UY', en: 'FLAGMAN · COMPLETED' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'в частной галерее.', uz: 'xususiy galereyada.', en: 'in a private gallery.' },
  lead: {
    ru: 'Реальные предложения каталога — с точными планировками, площадями, этажами и актуальными условиями.',
    uz: 'Haqiqiy katalog takliflari — aniq rejalar, maydonlar, qavatlar va dolzarb shartlar bilan.',
    en: 'Real catalogue listings with exact plans, areas, floors and current terms.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/flagman?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=flagman&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'flagman-language',
  cardPageSize: 6,
  defaultSort: 'price-asc',
  disclaimer: {
    ru: 'Состав предложений, цены и статусы обновляются автоматически. Наличие и условия подтверждает отдел продаж. Пустые позиции и недоступные статусы не выдумываются.',
    uz: 'Takliflar, narxlar va holatlar avtomatik yangilanadi. Mavjudlik va shartlarni savdo bo‘limi tasdiqlaydi. Bo‘sh joylar va mavjud bo‘lmagan holatlar to‘qib chiqarilmaydi.',
    en: 'Listings, prices and statuses update automatically. The sales team confirms availability and terms. Missing positions and unavailable statuses are not invented.',
  },
  theme: {
    '--catalog-ink': '#242826',
    '--catalog-paper': '#ede9df',
    '--catalog-surface': '#fbfaf6',
    '--catalog-accent': '#867761',
    '--catalog-accent-soft': '#cfc1ac',
  },
};

export function FlagmanUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: FlagmanSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('flagman', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => ({
    id: String(unit.id),
    unitKey: unit.sourceKey || undefined,
    number: String(unit.number),
    rooms: unit.rooms,
    area: unit.area,
    floor: unit.floor,
    maxFloor: unit.maxFloor,
    entrance: unit.entrance ? String(unit.entrance) : undefined,
    propertyType: 'apartment',
    status: unit.status,
    repairIncluded: unit.repairIncluded,
    price: unit.price > 0 ? unit.price : undefined,
    regularPrice: unit.regularPrice > 0 ? unit.regularPrice : undefined,
    pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
    currency: unit.currency,
    plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
  })), [snapshot.units]);

  const availableCount = liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length;
  const totalCount = liveProject?.totalUnits ?? snapshot.totalCount;

  return <ApartmentCatalog
    project={{
      slug: 'flagman',
      name: snapshot.project.name,
      address: snapshot.project.address,
      className: snapshot.project.class,
      statusLabel: { ru: 'Готовый дом', uz: 'Tayyor uy', en: 'Completed' },
      availableCount,
      totalCount,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
