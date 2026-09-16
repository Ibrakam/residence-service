'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';

export type VohaSafeSnapshot = {
  project: string;
  capturedAt: string;
  totalCount: number;
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
    propertyType: string;
    status: 'available' | 'reserved' | 'sold' | 'unavailable';
    price: number;
    regularPrice: number;
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
  phases: true,
  buildings: false,
  entrances: true,
};
const presentation: CatalogPresentation = {
  brand: 'VOHA',
  brandSubtitle: 'BY NRG-BI',
  eyebrow: { ru: 'Пространство у воды', uz: 'Suv bo‘yidagi makon', en: 'A place by the water' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'в своём ритме.', uz: 'o‘z ritmingizda.', en: 'at your own pace.' },
  lead: {
    ru: 'Полный каталог Voha: точные планировки, очереди, этажи, цены и статусы.',
    uz: 'Voha to‘liq katalogi: aniq rejalar, bosqichlar, qavatlar, narxlar va holatlar.',
    en: 'The complete Voha catalogue with exact plans, phases, floors, prices and statuses.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/voha?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=voha&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'voha-language',
  cardPageSize: 12,
  defaultSort: 'status',
  disclaimer: {
    ru: 'Наличие, цены и условия обновляются автоматически и подтверждаются отделом продаж.',
    uz: 'Mavjudlik, narxlar va shartlar avtomatik yangilanadi hamda savdo bo‘limi tomonidan tasdiqlanadi.',
    en: 'Availability, pricing and terms update automatically and are confirmed by the sales team.',
  },
  theme: {
    '--catalog-ink': '#0d2f32',
    '--catalog-paper': '#e5dfd1',
    '--catalog-surface': '#f7f4ed',
    '--catalog-accent': '#a98a59',
    '--catalog-accent-soft': '#c7bba5',
  },
};

export function VohaUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: VohaSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('voha', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => ({
    id: String(unit.id), unitKey: unit.sourceKey || undefined, number: String(unit.number), rooms: unit.rooms,
    area: unit.area, floor: unit.floor, maxFloor: unit.maxFloor, entrance: unit.entrance || undefined,
    phase: unit.phase || undefined, propertyType: 'apartment', status: unit.status,
    price: unit.price > 0 ? unit.price : undefined,
    regularPrice: unit.regularPrice > 0 ? unit.regularPrice : undefined,
    pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
    currency: unit.currency, plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
  })), [snapshot.units]);
  return <ApartmentCatalog
    project={{ slug: 'voha', name: snapshot.project, address: 'Ташкент, ул. Кайнарсой, 136А', className: 'Business', availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length, totalCount: liveProject?.totalUnits ?? snapshot.totalCount }}
    units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt} dataSource={dataSource}
  />;
}
