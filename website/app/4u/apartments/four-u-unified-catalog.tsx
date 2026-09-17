'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type FourUSafeSnapshot = {
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
    phase: string;
    blockId: string;
    floor: number;
    maxFloor: number;
    entrance: string;
    status: 'available';
    repairIncluded?: boolean;
    planImageUrl: string;
    planOriginalUrl: string;
    planPreviewUrl: string;
    planThumbnailUrl: string;
  }>;
};
type SourceUnit = FourUSafeSnapshot['units'][number];

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
  brand: '4U',
  brandSubtitle: 'TASHKENT',
  eyebrow: { ru: 'BUSINESS · SAYRAM STREET', uz: 'BUSINESS · SAYRAM STREET', en: 'BUSINESS · SAYRAM STREET' },
  title: { ru: 'Выберите свою', uz: 'Xonadoningizni', en: 'Choose your' },
  accent: { ru: 'квартиру.', uz: 'tanlang.', en: 'apartment.' },
  lead: {
    ru: 'Локальная подборка реальных предложений с точными планировками; цены, наличие и статусы обновляются автоматически.',
    uz: 'Aniq rejali haqiqiy takliflarning mahalliy tanlovi; narxlar, mavjudlik va holatlar avtomatik yangilanadi.',
    en: 'A local selection of real listings with exact plans; prices, availability and statuses update automatically.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/4u?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=4u&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'fouru-language',
  cardPageSize: 12,
  defaultSort: 'price-asc',
  availableOnlyDefault: true,
  buildingLabel: { ru: 'Блок', uz: 'Blok', en: 'Block' },
  allBuildingsLabel: { ru: 'Все блоки', uz: 'Barcha bloklar', en: 'All blocks' },
  disclaimer: {
    ru: 'Показана локальная выборка из официального каталога. Состав, цены и статусы обновляются автоматически; условия подтверждает отдел продаж.',
    uz: 'Rasmiy katalogning mahalliy tanlovi ko‘rsatilgan. Tarkib, narx va holatlar avtomatik yangilanadi; shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'This is a local selection from the official catalogue. Listings, prices and statuses update automatically; the sales team confirms terms.',
  },
  theme: {
    '--catalog-ink': '#0b1838',
    '--catalog-paper': '#f3efe6',
    '--catalog-surface': '#fffaf2',
    '--catalog-accent': '#ee745b',
    '--catalog-accent-soft': '#f5a48c',
  },
};

function trustedPlan(unit: SourceUnit, value: string, suffix: '' | '_1600' | '_200') {
  if (value.startsWith('/4u/plans/') && !value.startsWith('//')) return value;
  const identity = /^nrg-bi:4u:([0-9a-f-]{36})$/i.exec(unit.sourceKey ?? '')?.[1]
    ?? (typeof unit.id === 'string' && /^[0-9a-f-]{36}$/i.test(unit.id) ? unit.id : '');
  if (!identity || !/^[0-9a-f-]{36}$/i.test(unit.blockId)) return '';
  const expected = `https://s3.bi.group/crm-clients-e1csales/layouts/${unit.blockId}/${identity}/${encodeURIComponent(unit.number)}${suffix}.png`;
  if (value !== expected) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 's3.bi.group' && !url.port && !url.username && !url.password && !url.search && !url.hash ? value : '';
  } catch {
    return '';
  }
}

export function FourUUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: FourUSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('4u', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((rawUnit) => {
    const unit = rawUnit as SourceUnit;
    const original = trustedPlan(unit, unit.planOriginalUrl || unit.planImageUrl, '');
    const preview = trustedPlan(unit, unit.planPreviewUrl, '_1600');
    const thumbnail = trustedPlan(unit, unit.planThumbnailUrl, '_200');
    return {
      id: String(unit.id),
      unitKey: unit.sourceKey || undefined,
      number: String(unit.number),
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: unit.maxFloor,
      entrance: unit.entrance ? String(unit.entrance) : undefined,
      building: unit.phase || undefined,
      propertyType: 'apartment',
      status: 'available',
      repairIncluded: unit.repairIncluded,
      price: unit.price > 0 ? unit.price : undefined,
      regularPrice: unit.oldPrice > unit.price ? unit.oldPrice : undefined,
      pricePerM2: unit.price > 0 && unit.area > 0 ? Math.round(unit.price / unit.area) : undefined,
      currency: 'UZS',
      plans: original || preview || thumbnail ? [{ src: original || preview || thumbnail, previewSrc: preview || thumbnail || original, fallbackSrc: preview || thumbnail || undefined, kind: 'unit' as const }] : [],
    };
  }), [snapshot.units]);

  return <ApartmentCatalog
    project={{
      slug: '4u',
      name: '4U Tashkent',
      address: 'Мирзо-Улугбекский район · улица Сайрам',
      className: 'Business',
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
