'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPlan, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type JomiySafeSnapshot = {
  project: string;
  capturedAt: string;
  totalCount: number;
  evaluationTime: number;
  units: Array<{
    id: string; sourceKey: string; number: string; rooms: number; area: number; floor: number; maxFloor: number;
    entrance: number; building: string; propertyType: string; status: 'available' | 'reserved' | 'sold' | 'unavailable';
    repairIncluded?: boolean;
    price: number; regularPrice: number; pricePerM2: number; currency: string;
    promotion: { deadlineUtc?: string } | null;
    plan: string; floorPositionPlan: string;
  }>;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const capabilities: CatalogCapabilities = { visualFlow: false, exactUnitPlans: true, secondaryPlans: true, pricesVisible: true, phases: false, buildings: true, entrances: true };
const presentation: CatalogPresentation = {
  brand: 'JOMIY', brandSubtitle: 'BUSINESS RESIDENCE',
  eyebrow: { ru: 'Современная классика', uz: 'Zamonaviy klassika', en: 'Modern classic' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'по точным данным.', uz: 'aniq maʼlumotlar bilan.', en: 'with verified data.' },
  lead: {
    ru: 'Точные планы квартир и расположение на этаже, без внутренней статистики и технических полей.',
    uz: 'Ichki statistika va texnik maydonlarsiz aniq xonadon rejasi va qavatdagi joylashuvi.',
    en: 'Exact apartment plans and floor positions without internal statistics or technical fields.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/jomiy?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=jomiy&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12', storageKey: 'jomiy-language', cardPageSize: 12, defaultSort: 'status',
  disclaimer: {
    ru: 'Цены учитывают только активные на момент просмотра условия. Статусы и наличие обновляются автоматически и подтверждаются отделом продаж.',
    uz: 'Narxlar faqat ko‘rish paytida amal qiladigan shartlarni hisobga oladi. Holat va mavjudlik avtomatik yangilanadi hamda savdo bo‘limi tomonidan tasdiqlanadi.',
    en: 'Prices reflect only terms active at viewing time. Statuses and availability update automatically and are confirmed by the sales team.',
  },
  theme: { '--catalog-ink': '#242321', '--catalog-paper': '#f3eee2', '--catalog-surface': '#fbf8f0', '--catalog-accent': '#832f34', '--catalog-accent-soft': '#d8c19d' },
};

export function JomiyUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: JomiySafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('jomiy', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => {
    const deadline = unit.promotion?.deadlineUtc ? Date.parse(unit.promotion.deadlineUtc) : Number.NaN;
    const campaignActive = Number.isFinite(deadline) && snapshot.evaluationTime < deadline;
    const price = campaignActive && unit.price > 0 ? unit.price : unit.regularPrice || unit.price;
    const plans: CatalogPlan[] = [];
    if (unit.plan) plans.push({ src: unit.plan, kind: 'unit' });
    if (unit.floorPositionPlan && unit.floorPositionPlan !== unit.plan) plans.push({ src: unit.floorPositionPlan, kind: 'floor-position' });
    return {
      id: String(unit.id), unitKey: unit.sourceKey || undefined, number: String(unit.number), rooms: unit.rooms,
      area: unit.area, floor: unit.floor, maxFloor: unit.maxFloor, entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.building || undefined, propertyType: 'apartment', status: unit.status, repairIncluded: unit.repairIncluded,
      price: price > 0 ? price : undefined, regularPrice: campaignActive && unit.regularPrice > price ? unit.regularPrice : undefined,
      pricePerM2: price > 0 && unit.area > 0 ? price / unit.area : unit.pricePerM2 || undefined, currency: unit.currency, plans,
    };
  }), [snapshot.evaluationTime, snapshot.units]);
  return <ApartmentCatalog
    project={{ slug: 'jomiy', name: snapshot.project, address: 'Ташкент, Алмазарский район, ул. Уста Ширин, 21', className: 'Business', availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length, totalCount: liveProject?.totalUnits ?? snapshot.totalCount }}
    units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt} dataSource={dataSource}
  />;
}
