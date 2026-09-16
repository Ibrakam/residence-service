'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPlan, CatalogPresentation, CatalogUnit, LocalizedCatalogCopy } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type SunSafeSnapshot = {
  project: string;
  capturedAt: string;
  totalCount: number;
  address: LocalizedCatalogCopy;
  positioning: LocalizedCatalogCopy;
  units: Array<{
    id: string; sourceKey: string; number: string; rooms: number; area: number; floor: number; maxFloor: number;
    entrance: number; building: string; propertyType: string; status: 'available' | 'reserved' | 'sold' | 'unavailable';
    price: number; regularPrice: number; pricePerM2: number; currency: string; plan: string; floorPositionPlan: string;
  }>;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const capabilities: CatalogCapabilities = { visualFlow: false, exactUnitPlans: true, secondaryPlans: true, pricesVisible: true, phases: false, buildings: true, entrances: true };
const presentation: CatalogPresentation = {
  brand: 'SUN', brandSubtitle: 'HUMAN2HUMAN',
  eyebrow: { ru: 'Клубный проект', uz: 'Klub loyihasi', en: 'Club-format project' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'в ритме солнца.', uz: 'quyosh ritmida.', en: 'in the rhythm of the sun.' },
  lead: {
    ru: 'Актуальные квартиры SUN с двумя официальными листами: точным планом и расположением на этаже.',
    uz: 'SUN’ning dolzarb xonadonlari ikki rasmiy varaq bilan: aniq reja va qavatdagi joylashuv.',
    en: 'Current SUN apartments with two official sheets: the exact plan and floor position.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/sun?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=sun&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12', storageKey: 'sun-language', cardPageSize: 9, defaultSort: 'status',
  disclaimer: {
    ru: 'Показываются только актуальные доступные квартиры. Цены и статусы обновляются автоматически; финальные условия подтверждает отдел продаж.',
    uz: 'Faqat dolzarb mavjud xonadonlar ko‘rsatiladi. Narxlar va holatlar avtomatik yangilanadi; yakuniy shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'Only current available apartments are shown. Prices and statuses update automatically; the sales team confirms final terms.',
  },
  theme: { '--catalog-ink': '#090909', '--catalog-paper': '#e9e4dc', '--catalog-surface': '#f8f5ef', '--catalog-accent': '#ff5b00', '--catalog-accent-soft': '#ffb184' },
};

export function SunUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: SunSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('sun', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => {
    const plans: CatalogPlan[] = [];
    if (unit.plan) plans.push({ src: unit.plan, kind: 'unit' });
    if (unit.floorPositionPlan && unit.floorPositionPlan !== unit.plan) plans.push({ src: unit.floorPositionPlan, kind: 'floor-position' });
    return {
      id: String(unit.id), unitKey: unit.sourceKey || undefined, number: String(unit.number), rooms: unit.rooms,
      area: unit.area, floor: unit.floor, maxFloor: unit.maxFloor, entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.building || undefined, propertyType: 'apartment', status: unit.status,
      price: unit.price > 0 ? unit.price : undefined, regularPrice: unit.regularPrice > unit.price ? unit.regularPrice : undefined,
      pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined, currency: unit.currency, plans,
    };
  }), [snapshot.units]);
  return <ApartmentCatalog
    project={{ slug: 'sun', name: snapshot.project, address: snapshot.address[initialLanguage] ?? snapshot.address.ru, className: 'Club residence', availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length, totalCount: liveProject?.totalUnits ?? snapshot.totalCount }}
    units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt} dataSource={dataSource}
  />;
}
