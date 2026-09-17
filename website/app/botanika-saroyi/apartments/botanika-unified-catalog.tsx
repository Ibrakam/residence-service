'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogStatus, CatalogUnit } from '@/app/catalog/types';
import { useLiveCatalogSnapshot } from '@/app/live-catalog';

type Language = 'ru' | 'uz' | 'en';
export type BotanikaSafeSnapshot = {
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
type SourceUnit = BotanikaSafeSnapshot['units'][number];

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
  brand: 'BOTANIKA',
  brandSubtitle: 'SAROYI',
  eyebrow: { ru: 'ЖИВОЙ АТЛАС ДОМА', uz: 'UYNING JONLI ATLASI', en: 'A LIVING ATLAS OF THE HOME' },
  title: { ru: 'Индекс', uz: 'Rezidensiyalar', en: 'An index of' },
  accent: { ru: 'резиденций.', uz: 'indeksi.', en: 'residences.' },
  lead: {
    ru: 'Точные локальные планировки и актуальные предложения с честно нормализованными статусами.',
    uz: 'Aniq mahalliy rejalar va holatlari halol me’yorlashtirilgan dolzarb takliflar.',
    en: 'Exact local plans and current listings with honestly normalized statuses.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/botanika-saroyi?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=botanika-saroyi&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'botanika-saroyi-language',
  cardPageSize: 12,
  defaultSort: 'status',
  disclaimer: {
    ru: 'Рабочие статусы источника нормализованы без подмены проданных объектов. Наличие, цена и условия подтверждаются отделом продаж.',
    uz: 'Manbadagi ishchi holatlar sotilgan obyektlarni almashtirmasdan me’yorlashtirilgan. Mavjudlik, narx va shartlarni savdo bo‘limi tasdiqlaydi.',
    en: 'Source workflow statuses are normalized without substituting sold units. The sales team confirms availability, prices and terms.',
  },
  theme: {
    '--catalog-ink': '#22241f',
    '--catalog-paper': '#eee9dc',
    '--catalog-surface': '#faf7ee',
    '--catalog-accent': '#7b5e36',
    '--catalog-accent-soft': '#d6bd83',
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

export function BotanikaUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: BotanikaSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('botanika-saroyi', embeddedSnapshot);
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
      slug: 'botanika-saroyi',
      name: 'Botanika Saroyi',
      address: 'Мирзо-Улугбекский район · рядом с Ботаническим садом',
      className: 'Business',
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
