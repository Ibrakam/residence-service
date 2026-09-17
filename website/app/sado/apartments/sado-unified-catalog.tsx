'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type SadoSafeSnapshot = {
  project: string;
  generatedAt: string;
  sourceCount: number;
  units: Array<{
    id: string | number;
    sourceKey?: string;
    number: string;
    rooms: number;
    area: number;
    class: 'business' | 'comfort';
    price: number | null;
    listPrice: number | null;
    block: string;
    floor: number;
    maxFloor: number;
    entrance: number;
    status: 'available';
    repairIncluded?: boolean;
    plan: string;
  }>;
};
type SourceUnit = SadoSafeSnapshot['units'][number];

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
  brand: "SAD'O",
  brandSubtitle: 'YASHNABAD · TASHKENT',
  eyebrow: { ru: 'BUSINESS & COMFORT · LIVE CATALOGUE', uz: 'BUSINESS & COMFORT · LIVE CATALOGUE', en: 'BUSINESS & COMFORT · LIVE CATALOGUE' },
  title: { ru: 'Выберите пространство,', uz: 'Sizni tinglaydigan', en: 'Choose a space' },
  accent: { ru: 'которое услышит вас.', uz: 'makonni tanlang.', en: 'that listens to you.' },
  lead: {
    ru: 'Реальные предложения с точными планировками, этажами, площадями и актуальными условиями.',
    uz: 'Aniq rejalar, qavatlar, maydonlar va dolzarb shartlarga ega haqiqiy takliflar.',
    en: 'Real listings with exact plans, floors, areas and current terms.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/sado?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=sado&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'sado-language',
  cardPageSize: 12,
  defaultSort: 'price-asc',
  availableOnlyDefault: true,
  disclaimer: {
    ru: 'Каталог показывает опубликованные предложения. Проданные и снятые с публикации квартиры не подменяются свободными; наличие подтверждает отдел продаж.',
    uz: 'Katalog e’lon qilingan takliflarni ko‘rsatadi. Sotilgan va e’londan olingan xonadonlar mavjud deb ko‘rsatilmaydi; mavjudlikni savdo bo‘limi tasdiqlaydi.',
    en: 'The catalogue shows published listings. Sold and withdrawn homes are never presented as available; the sales team confirms availability.',
  },
  theme: {
    '--catalog-ink': '#173b30',
    '--catalog-paper': '#eee7da',
    '--catalog-surface': '#fbf7ef',
    '--catalog-accent': '#b97b59',
    '--catalog-accent-soft': '#e4b997',
  },
};

function planFor(unit: SourceUnit) {
  return unit.plan.startsWith('/') ? unit.plan : '';
}

export function SadoUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: SadoSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('sado', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((rawUnit) => {
    const unit = rawUnit as SourceUnit;
    const plan = planFor(unit);
    return {
      id: String(unit.id),
      unitKey: unit.sourceKey || undefined,
      number: String(unit.number),
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: unit.maxFloor,
      entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.block || undefined,
      propertyType: 'apartment',
      status: 'available',
      repairIncluded: unit.repairIncluded,
      price: typeof unit.price === 'number' && unit.price > 0 ? unit.price : undefined,
      regularPrice: typeof unit.listPrice === 'number' && unit.listPrice > (unit.price ?? 0) ? unit.listPrice : undefined,
      pricePerM2: typeof unit.price === 'number' && unit.price > 0 && unit.area > 0 ? Math.round(unit.price / unit.area) : undefined,
      currency: 'UZS',
      plans: plan ? [{ src: plan, kind: 'unit' as const }] : [],
    };
  }), [snapshot.units]);

  return <ApartmentCatalog
    project={{
      slug: 'sado',
      name: "Sad'O",
      address: 'Яшнабадский район · улица Паркентская',
      className: 'Business & Comfort',
      availableCount: liveProject?.availableUnits ?? units.length,
      totalCount: liveProject?.totalUnits ?? snapshot.sourceCount,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.generatedAt}
    dataSource={dataSource}
  />;
}
