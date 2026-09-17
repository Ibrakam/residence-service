'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogStatus, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type ZamonSafeSnapshot = {
  project: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  units: Array<{
    id: string | number;
    sourceKey?: string;
    number: string;
    rooms: number;
    area: number;
    price: number;
    oldPrice: number;
    currentPricePerM2: number;
    currency: string;
    floor: number;
    totalFloors: number;
    entrance: number;
    building: string;
    plan: string;
    status?: string;
    statusOriginal: string;
    isSale: boolean;
    repairIncluded?: boolean;
  }>;
};
type SourceUnit = ZamonSafeSnapshot['units'][number];

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

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
  brand: 'ZAMON',
  brandSubtitle: 'NRG-BI · TASHKENT',
  eyebrow: { ru: 'ХРОНОЛОГИЯ СВЕТА', uz: 'YORUG‘LIK XRONOLOGIYASI', en: 'A CHRONOLOGY OF LIGHT' },
  title: { ru: 'Реестр', uz: 'Yorug‘lik', en: 'The light' },
  accent: { ru: 'света.', uz: 'reyestri.', en: 'register.' },
  lead: {
    ru: 'Актуальные предложения с точными планировками, ценами, этажами и нормализованными статусами.',
    uz: 'Aniq rejalar, narxlar, qavatlar va me’yorlashtirilgan holatlarga ega dolzarb takliflar.',
    en: 'Current listings with exact plans, prices, floors and normalized statuses.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/zamon?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=zamon&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'zamon-language',
  cardPageSize: 12,
  defaultSort: 'status',
  disclaimer: {
    ru: 'Каталог обновляется автоматически и не гарантирует юридическую доступность. Наличие и актуальные условия подтверждает отдел продаж.',
    uz: 'Katalog avtomatik yangilanadi va huquqiy mavjudlikni kafolatlamaydi. Mavjudlik va amaldagi shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'The catalogue updates automatically and does not guarantee legal availability. The sales team confirms availability and current terms.',
  },
  theme: {
    '--catalog-ink': '#25221e',
    '--catalog-paper': '#eee8dc',
    '--catalog-surface': '#fbf8f0',
    '--catalog-accent': '#a6573e',
    '--catalog-accent-soft': '#d5aa79',
  },
};

function statusFor(unit: SourceUnit): CatalogStatus {
  const canonical = String(unit.status ?? '').toLowerCase();
  if (canonical === 'available' || canonical === 'reserved' || canonical === 'sold' || canonical === 'unavailable') return canonical;
  const raw = unit.statusOriginal.toLocaleLowerCase('ru');
  if (['свободно', 'снятие брони', 'снятие резерва', 'расторжение'].includes(raw)) return 'available';
  if (['бронь', 'бронирование', 'договор составлен', 'договор согласован'].includes(raw)) return 'reserved';
  if (raw === 'продано') return 'sold';
  return unit.isSale ? 'available' : 'unavailable';
}

export function ZamonUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: ZamonSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('zamon', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((rawUnit) => {
    const unit = rawUnit as SourceUnit;
    return {
      id: String(unit.id),
      unitKey: unit.sourceKey || undefined,
      number: String(unit.number),
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: unit.totalFloors,
      entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.building || undefined,
      propertyType: 'apartment',
      status: statusFor(unit),
      repairIncluded: unit.repairIncluded,
      price: unit.price > 0 ? unit.price : undefined,
      regularPrice: unit.oldPrice > unit.price ? unit.oldPrice : undefined,
      pricePerM2: unit.currentPricePerM2 > 0 ? unit.currentPricePerM2 : undefined,
      currency: unit.currency,
      plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
    };
  }), [snapshot.units]);
  const embeddedAvailable = units.filter((unit) => unit.status === 'available').length;

  return <ApartmentCatalog
    project={{
      slug: 'zamon',
      name: 'Zamon',
      address: 'Улица Таларык · Ташкент',
      className: 'Comfort',
      availableCount: liveProject?.availableUnits ?? embeddedAvailable,
      totalCount: liveProject?.totalUnits ?? snapshot.officialTotalAtCapture,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
