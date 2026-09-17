'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogStatus, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type BayterakSafeSnapshot = {
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
type SourceUnit = BayterakSafeSnapshot['units'][number];

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
  brand: 'BAY',
  brandSubtitle: 'TERAK · NEW TASHKENT',
  eyebrow: { ru: 'ЗОЛОТАЯ ОСЬ НОВОГО ТАШКЕНТА', uz: 'YANGI TOSHKENTNING OLTIN O‘QI', en: 'THE GOLDEN AXIS OF NEW TASHKENT' },
  title: { ru: 'Выберите дом', uz: 'Yangi shahardagi', en: 'Choose a home' },
  accent: { ru: 'в новом городе.', uz: 'uyingizni tanlang.', en: 'in the new city.' },
  lead: {
    ru: 'Квартиры Comfort+ и Business с точными локальными планировками и автоматически обновляемыми статусами.',
    uz: 'Aniq mahalliy rejalar va avtomatik yangilanadigan holatlarga ega Comfort+ va Business xonadonlari.',
    en: 'Comfort+ and Business apartments with exact local plans and automatically updated statuses.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/bayterak?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=bayterak&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'bayterak-language',
  cardPageSize: 12,
  defaultSort: 'status',
  disclaimer: {
    ru: 'Статусы источника нормализованы по правилам каталога. Наличие, цена, акция и условия сделки подтверждаются отделом продаж.',
    uz: 'Manba holatlari katalog qoidalari bo‘yicha me’yorlashtirilgan. Mavjudlik, narx, aksiya va bitim shartlarini savdo bo‘limi tasdiqlaydi.',
    en: 'Source statuses are normalized under the catalogue rules. The sales team confirms availability, price, promotion and transaction terms.',
  },
  theme: {
    '--catalog-ink': '#3a1717',
    '--catalog-paper': '#eee5d8',
    '--catalog-surface': '#fff9ef',
    '--catalog-accent': '#9c372f',
    '--catalog-accent-soft': '#d5a56d',
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

export function BayterakUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: BayterakSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('bayterak', embeddedSnapshot);
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
      slug: 'bayterak',
      name: 'Bayterak',
      address: 'Новый Ташкент',
      className: 'Comfort+ · Business',
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
