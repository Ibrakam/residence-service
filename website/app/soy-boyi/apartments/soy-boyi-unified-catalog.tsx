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
import { useLiveCatalogSnapshot } from '@/app/live-catalog';
import { soyQueueKey, soyQueueLabel, soyQueueOptions } from './soy-boyi-queues.mjs';

export type SoyBoyiSafeUnit = {
  id: string;
  unitKey: string;
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
  completion?: string | null;
  status: 'AVAILABLE';
  priceVisibility: 'request-only';
  plan?: string | null;
  planStatus: 'available' | 'missing-at-source';
};

export type SoyBoyiSafeSnapshot = {
  schemaVersion: number;
  capturedAt: string;
  serverDate: string;
  availableResidentialTotal: number;
  excludedCommercial: number;
  planCount: number;
  missingPlanCount: number;
  units: SoyBoyiSafeUnit[];
};

type Props = {
  snapshot: SoyBoyiSafeSnapshot;
  initialLanguage?: CatalogLanguage;
};

type SoyQueueDefinition = {
  key: string;
  order: number;
  count: number;
  queueLabel?: string;
  label?: string;
  displayCode?: string;
  queueDisplayCode?: string;
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

export function SoyBoyiUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: Props) {
  const searchParams = useSearchParams();
  const currentSearch = searchParams.toString();
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('soy-boyi', embeddedSnapshot);
  const queueDefinitions = useMemo<SoyQueueDefinition[]>(
    () => soyQueueOptions(snapshot.units, liveProject?.queues) as SoyQueueDefinition[],
    [liveProject?.queues, snapshot.units],
  );
  const queueByKey = useMemo(
    () => new Map<string, SoyQueueDefinition>(queueDefinitions.map((queue) => [queue.key, queue])),
    [queueDefinitions],
  );

  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => {
    const queueKey = soyQueueKey(unit);
    const queue = queueByKey.get(queueKey);
    return {
      id: unit.id,
      unitKey: unit.sourceKey || unit.unitKey,
      number: unit.number,
      rooms: unit.rooms > 0 ? unit.rooms : undefined,
      area: unit.area,
      floor: unit.floor,
      entrance: unit.section || undefined,
      queueKey: queueKey || undefined,
      queueLabel: unit.queueLabel || (queue ? soyQueueLabel(queue, 'ru') : undefined),
      queueDisplayCode: unit.queueDisplayCode || queue?.displayCode,
      queueOrder: unit.queueOrder || queue?.order,
      propertyType: 'apartment',
      status: 'available',
      plans: unit.plan ? [{ src: unit.plan, kind: 'unit' as const }] : [],
    };
  }), [queueByKey, snapshot.units]);

  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: 'SOY BO‘YI',
    brandSubtitle: 'TASHKENT',
    eyebrow: {
      ru: 'БИЗНЕС-КЛАСС · У РЕКИ',
      uz: 'BIZNES-KLASS · DARYO BO‘YIDA',
      en: 'BUSINESS CLASS · BY THE RIVER',
    },
    title: {
      ru: 'Выберите квартиру',
      uz: 'Xonadonni tanlang',
      en: 'Choose an apartment',
    },
    accent: {
      ru: 'у реки.',
      uz: 'daryo bo‘yida.',
      en: 'by the river.',
    },
    lead: {
      ru: 'Актуальные квартиры с площадями, этажами, секциями, очередями и точными планировками; данные обновляются из CRM.',
      uz: 'Maydonlar, qavatlar, seksiyalar, navbatlar va aniq rejalar bilan dolzarb xonadonlar; ma’lumotlar CRM’dan yangilanadi.',
      en: 'Current apartments with areas, floors, sections, phases and exact plans, updated from the CRM.',
    },
    backLabel: {
      ru: 'О проекте',
      uz: 'Loyiha haqida',
      en: 'About the project',
    },
    backHref: (language) => localizedHref('/soy-boyi', language, currentSearch),
    privacyHref: (language) => localizedHref('/privacy', language, currentSearch, {
      project: 'soy-boyi',
      from: 'catalog',
    }),
    phone: '+998 78 113 77 12',
    storageKey: 'soy-boyi-language',
    cardPageSize: 12,
    defaultSort: 'status',
    availableOnlyDefault: true,
    disclaimer: {
      ru: `Показано ${snapshot.availableResidentialTotal} доступных жилых квартир; ${snapshot.excludedCommercial} коммерческих помещений исключены. Для ${snapshot.planCount} квартир опубликованы точные планы, для ${snapshot.missingPlanCount} план отсутствует в источнике. Цены не опубликованы — наличие и условия подтверждает менеджер.`,
      uz: `${snapshot.availableResidentialTotal} ta mavjud turar joy xonadoni ko‘rsatilgan; ${snapshot.excludedCommercial} ta tijorat obyekti chiqarib tashlangan. ${snapshot.planCount} ta xonadon uchun aniq rejalar chop etilgan, ${snapshot.missingPlanCount} tasida manbada reja yo‘q. Narxlar e’lon qilinmagan — mavjudlik va shartlarni menejer tasdiqlaydi.`,
      en: `${snapshot.availableResidentialTotal} available residential apartments are shown; ${snapshot.excludedCommercial} commercial units are excluded. Exact plans are published for ${snapshot.planCount} apartments; ${snapshot.missingPlanCount} have no plan in the source. Prices are not published; a manager confirms availability and terms.`,
    },
    theme: {
      '--catalog-ink': '#153f3e',
      '--catalog-paper': '#f4f2ea',
      '--catalog-surface': '#fffdf8',
      '--catalog-accent': '#307473',
      '--catalog-accent-soft': '#e7bb8c',
    },
  }), [currentSearch, snapshot.availableResidentialTotal, snapshot.excludedCommercial, snapshot.missingPlanCount, snapshot.planCount]);

  const queues = useMemo(() => queueDefinitions.map((queue) => ({
    key: queue.key,
    label: queue.queueLabel || queue.label || soyQueueLabel(queue, 'ru'),
    displayCode: queue.displayCode || queue.queueDisplayCode,
    order: queue.order,
    availableCount: queue.count,
  })), [queueDefinitions]);

  return <ApartmentCatalog
    project={{
      slug: 'soy-boyi',
      name: 'Soy Bo‘yi',
      address: '3A Yusuf Sakkaki Avenue, Tashkent',
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
