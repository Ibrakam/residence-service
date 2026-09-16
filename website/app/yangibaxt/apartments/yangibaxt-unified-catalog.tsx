'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPlan, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type YangiBaxtSafeSnapshot = {
  project: string;
  capturedAt: string;
  totalCount: number;
  evaluationTime: number;
  units: Array<{
    id: string; sourceKey: string; number: string; rooms: number; area: number; floor: number; maxFloor: number;
    entrance: number; building: string; propertyType: string; status: 'available' | 'reserved' | 'sold' | 'unavailable';
    price: number; regularPrice: number; pricePerM2: number; currency: string; plan: string; floorPositionPlan: string;
    promotion: { deadlineUtc?: string } | null;
  }>;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const capabilities: CatalogCapabilities = { visualFlow: false, exactUnitPlans: true, secondaryPlans: true, pricesVisible: true, phases: false, buildings: true, entrances: true };
const presentation: CatalogPresentation = {
  brand: 'YANGI BAXT', brandSubtitle: 'BY NRG-BI',
  eyebrow: { ru: 'Городской квартал', uz: 'Shahar mavzesi', en: 'Urban neighbourhood' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'для нового счастья.', uz: 'yangi baxt uchun.', en: 'for a new beginning.' },
  lead: {
    ru: 'Квартиры с точным планом и официальным расположением на этаже — в едином каталоге.',
    uz: 'Aniq reja va qavatdagi rasmiy joylashuvga ega xonadonlar yagona katalogda.',
    en: 'Apartments with an exact plan and official floor position in one catalogue.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/yangibaxt?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=yangibaxt&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12', storageKey: 'yangibaxt-language', cardPageSize: 12, defaultSort: 'status',
  disclaimer: {
    ru: 'Рабочие статусы каталога нормализованы без подмены данных. Цены и доступность обновляются автоматически; условия подтверждает отдел продаж.',
    uz: 'Katalogdagi ish holatlari maʼlumotlarni almashtirmasdan normallashtirilgan. Narx va mavjudlik avtomatik yangilanadi; shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'Workflow statuses are normalised without replacing source data. Prices and availability update automatically; the sales team confirms terms.',
  },
  theme: { '--catalog-ink': '#163d43', '--catalog-paper': '#f0eadb', '--catalog-surface': '#fdf9ef', '--catalog-accent': '#a93f4d', '--catalog-accent-soft': '#efb9bc' },
};

export function YangiBaxtUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: YangiBaxtSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('yangibaxt', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => {
    const deadline = unit.promotion?.deadlineUtc ? Date.parse(unit.promotion.deadlineUtc) : Number.NaN;
    const campaignActive = Number.isFinite(deadline) && snapshot.evaluationTime < deadline;
    const price = campaignActive ? unit.price : unit.regularPrice || unit.price;
    const plans: CatalogPlan[] = [];
    if (unit.plan) plans.push({ src: unit.plan, kind: 'unit' });
    if (unit.floorPositionPlan && unit.floorPositionPlan !== unit.plan) plans.push({ src: unit.floorPositionPlan, kind: 'floor-position' });
    return {
      id: String(unit.id), unitKey: unit.sourceKey || undefined, number: String(unit.number), rooms: unit.rooms,
      area: unit.area, floor: unit.floor, maxFloor: unit.maxFloor, entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.building || undefined, propertyType: 'apartment', status: unit.status,
      price: price > 0 ? price : undefined, regularPrice: campaignActive && unit.regularPrice > price ? unit.regularPrice : undefined,
      pricePerM2: price > 0 && unit.area > 0 ? price / unit.area : unit.pricePerM2 || undefined, currency: unit.currency, plans,
    };
  }), [snapshot.evaluationTime, snapshot.units]);
  return <ApartmentCatalog
    project={{ slug: 'yangibaxt', name: snapshot.project, address: 'Ташкент, Ахангаранский проспект', className: 'Comfort+', availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length, totalCount: liveProject?.totalUnits ?? snapshot.totalCount }}
    units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt} dataSource={dataSource}
  />;
}
