'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type {
  CatalogCapabilities,
  CatalogLanguage,
  CatalogPresentation,
  CatalogUnit,
} from '@/app/catalog/types';
import { liveCatalogQueueOptions, useLiveCatalogSnapshot } from '@/app/live-catalog';

export type SaadiyatSafeUnit = {
  id: string;
  sourceKey?: string;
  sourceOrder: number;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  section: string;
  phase: string;
  queueKey?: string;
  queueLabel?: string;
  queueDisplayCode?: string;
  queueOrder?: number;
  completionYear: string;
  status: 'AVAILABLE';
  priceVisibility?: 'request-only';
  priceVisible?: boolean;
  plan: string;
};

export type SaadiyatSafeSnapshot = {
  capturedAt: string;
  serverDate: string;
  officialUntypedTotal: number;
  excludedCommercial: number;
  availableResidentialTotal: number;
  units: SaadiyatSafeUnit[];
};

type Props = {
  snapshot: SaadiyatSafeSnapshot;
  initialLanguage?: CatalogLanguage;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}`
  : '';
const attributionKeys = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'tcid',
] as const;

const capabilities: CatalogCapabilities = {
  visualFlow: false,
  exactUnitPlans: true,
  secondaryPlans: false,
  pricesVisible: false,
  phases: true,
  buildings: false,
  entrances: true,
};

function localizedHref(
  pathname: string,
  language: CatalogLanguage,
  currentSearch: string,
  extra: Record<string, string> = {},
) {
  const current = new URLSearchParams(currentSearch);
  const next = new URLSearchParams({ lang: language, ...extra });
  attributionKeys.forEach((key) => {
    const value = current.get(key);
    if (value) next.set(key, value);
  });
  return `${appBasePath}${pathname}?${next.toString()}`;
}

export function SaadiyatUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: Props) {
  const currentSearch = useSearchParams().toString();
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('saadiyat', embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => ({
    id: unit.id,
    unitKey: unit.sourceKey || undefined,
    number: unit.number,
    rooms: unit.rooms > 0 ? unit.rooms : undefined,
    area: unit.area,
    floor: unit.floor,
    entrance: unit.section || undefined,
    phase: unit.queueKey ? undefined : unit.phase || undefined,
    queueKey: unit.queueKey,
    queueLabel: unit.queueLabel,
    queueDisplayCode: unit.queueDisplayCode,
    queueOrder: unit.queueOrder,
    propertyType: 'apartment',
    status: 'available',
    plans: [{ src: unit.plan, kind: 'unit' as const }],
  })), [snapshot.units]);

  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: 'SAADIYAT',
    brandSubtitle: 'TASHKENT',
    eyebrow: {
      ru: 'БИЗНЕС-КЛАСС · У ТИХОЙ ВОДЫ',
      uz: 'BIZNES-KLASS · SOKIN SUV YONIDA',
      en: 'BUSINESS CLASS · BESIDE QUIET WATER',
    },
    title: {
      ru: 'Выберите квартиру',
      uz: 'Xonadonni tanlang',
      en: 'Choose an apartment',
    },
    accent: {
      ru: 'в своём ритме.',
      uz: 'o‘z ritmingizda.',
      en: 'at your own rhythm.',
    },
    lead: {
      ru: 'Актуальные доступные квартиры с точными локальными планировками и автоматическим обновлением из CRM.',
      uz: 'Aniq lokal rejalar va CRM’dan avtomatik yangilanishga ega dolzarb xonadonlar.',
      en: 'Current available apartments with exact local plans and automatic CRM updates.',
    },
    backLabel: {
      ru: 'О проекте',
      uz: 'Loyiha haqida',
      en: 'About the project',
    },
    backHref: (language) => localizedHref('/saadiyat', language, currentSearch),
    privacyHref: (language) => localizedHref('/privacy', language, currentSearch, {
      project: 'saadiyat',
      from: 'catalog',
    }),
    phone: '+998 78 113 77 12',
    storageKey: 'saadiyat-language',
    cardPageSize: 18,
    defaultSort: 'status',
    availableOnlyDefault: true,
    disclaimer: {
      ru: `Показано ${snapshot.availableResidentialTotal} доступных жилых позиций; ${snapshot.excludedCommercial} коммерческих помещения исключены. Все планировки локальные и соответствуют конкретным позициям. Источник скрывает цены — условия подтверждает менеджер.`,
      uz: `${snapshot.availableResidentialTotal} ta mavjud turar joy pozitsiyasi ko‘rsatilgan; ${snapshot.excludedCommercial} ta tijorat obyekti chiqarib tashlangan. Barcha rejalar lokal va aniq pozitsiyalarga tegishli. Manba narxlarni yashiradi — shartlarni menejer tasdiqlaydi.`,
      en: `${snapshot.availableResidentialTotal} available residential entries are shown; ${snapshot.excludedCommercial} commercial units are excluded. Every plan is local and belongs to its exact listing. The source hides prices; a manager confirms the terms.`,
    },
    theme: {
      '--catalog-ink': '#3c1512',
      '--catalog-paper': '#f8f3e9',
      '--catalog-surface': '#fffdf8',
      '--catalog-accent': '#782a23',
      '--catalog-accent-soft': '#dfad62',
    },
  }), [currentSearch, snapshot.availableResidentialTotal, snapshot.excludedCommercial]);

  const queues = useMemo(() => liveCatalogQueueOptions(liveProject).map((queue) => ({
    key: queue.queueKey,
    label: queue.queueLabel,
    displayCode: queue.queueDisplayCode,
    order: queue.queueOrder,
    availableCount: queue.availableUnits,
  })), [liveProject]);

  return <ApartmentCatalog
    project={{
      slug: 'saadiyat',
      name: 'SAADIYAT',
      availableCount: liveProject?.availableUnits ?? snapshot.availableResidentialTotal,
      totalCount: liveProject?.totalUnits ?? snapshot.availableResidentialTotal,
      queues,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.serverDate ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
