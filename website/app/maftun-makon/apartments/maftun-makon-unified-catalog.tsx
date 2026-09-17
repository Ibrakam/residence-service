'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type MaftunMakonSafeSnapshot = {
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
    oldPrice: number | null;
    pricePerM2: number;
    currency: string;
    floor: number;
    totalFloors: number;
    entrance: number;
    building: string;
    status: 'available';
    repairIncluded?: boolean;
    plan: string | null;
  }>;
};
type SourceUnit = MaftunMakonSafeSnapshot['units'][number];

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
  brand: 'MAFTUN MAKON',
  brandSubtitle: 'NRG-BI × AL-BINA',
  eyebrow: { ru: 'ГОРОД В ГОРОДЕ · LIVE CATALOGUE', uz: 'SHAHAR ICHIDA SHAHAR · LIVE CATALOGUE', en: 'A CITY WITHIN A CITY · LIVE CATALOGUE' },
  title: { ru: 'Найдите свой', uz: 'Portal ortidagi', en: 'Find your' },
  accent: { ru: 'сад за порталом.', uz: 'bog‘ingizni toping.', en: 'garden beyond the portal.' },
  lead: {
    ru: 'Актуальный каталог без переименования скрытых или проданных квартир в свободные.',
    uz: 'Yashirilgan yoki sotilgan xonadonlarni mavjud deb ko‘rsatmaydigan dolzarb katalog.',
    en: 'A current catalogue that never presents hidden or sold apartments as available.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/maftun-makon?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=maftun-makon&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'maftun-makon-language-v1',
  cardPageSize: 12,
  defaultSort: 'price-asc',
  availableOnlyDefault: true,
  disclaimer: {
    ru: 'Состав предложений, цены, акции и статусы обновляются автоматически. Информация не является публичной офертой.',
    uz: 'Takliflar, narxlar, aksiyalar va holatlar avtomatik yangilanadi. Ma’lumot ommaviy oferta emas.',
    en: 'Listings, prices, promotions and statuses update automatically. This information is not a public offer.',
  },
  theme: {
    '--catalog-ink': '#173126',
    '--catalog-paper': '#ede7d8',
    '--catalog-surface': '#fffaf0',
    '--catalog-accent': '#9b6c38',
    '--catalog-accent-soft': '#d9b47b',
  },
};

export function MaftunMakonUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: MaftunMakonSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('maftun-makon', embeddedSnapshot);
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
      status: 'available',
      repairIncluded: unit.repairIncluded,
      price: unit.price > 0 ? unit.price : undefined,
      regularPrice: typeof unit.oldPrice === 'number' && unit.oldPrice > unit.price ? unit.oldPrice : undefined,
      pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
      currency: unit.currency,
      plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
    };
  }), [snapshot.units]);

  return <ApartmentCatalog
    project={{
      slug: 'maftun-makon',
      name: 'Maftun Makon',
      address: 'Проспект Янги Узбекистон · Ташкент',
      className: 'Comfort · Comfort+ · Business',
      availableCount: liveProject?.availableUnits ?? units.length,
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
