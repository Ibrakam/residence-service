'use client';

import { useMemo } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogUnit, LocalizedCatalogCopy } from '@/app/catalog/types';
import { liveCatalogQueueOptions, useLiveCatalogSnapshot } from '@/app/live-catalog';
import { regnumQueueCode, regnumQueueKey, regnumQueueOrder } from '@/app/regnum-plaza/regnum-queues';

type Language = 'ru' | 'uz' | 'en';
export type RegnumSafeSnapshot = {
  project: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  projectFacts: { address: LocalizedCatalogCopy; class: LocalizedCatalogCopy };
  units: Array<{
    id: string; sourceKey?: string; number: string; rooms: number; area: number; floor: number;
    section: number; queue?: number | string; queueKey?: string; queueLabel?: string; queueDisplayCode?: string; queueOrder?: number;
    status: 'available' | 'reserved' | 'sold' | 'unavailable'; planPublicPath: string;
  }>;
};

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const capabilities: CatalogCapabilities = { visualFlow: false, exactUnitPlans: true, secondaryPlans: false, pricesVisible: false, phases: false, buildings: false, entrances: true };
const presentation: CatalogPresentation = {
  brand: 'REGNUM', brandSubtitle: 'PLAZA',
  eyebrow: { ru: 'Бизнес-класс', uz: 'Biznes klass', en: 'Business class' },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'в последней коллекции.', uz: 'so‘nggi kolleksiyadan.', en: 'from the final collection.' },
  lead: {
    ru: 'Текущие предложения по очередям и секциям. Публичная стоимость предоставляется только по запросу.',
    uz: 'Bosqich va seksiyalar bo‘yicha joriy takliflar. Ommaviy narx faqat so‘rov bo‘yicha beriladi.',
    en: 'Current listings by phase and section. Public pricing is available on request only.',
  },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/regnum-plaza?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=regnum-plaza&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12', storageKey: 'regnum-language', cardPageSize: 12, defaultSort: 'status',
  disclaimer: {
    ru: 'Числовые цены не публикуются. Для двух позиций официальный план не опубликован — вместо него показан честный placeholder.',
    uz: 'Raqamli narxlar eʼlon qilinmaydi. Ikki pozitsiya uchun rasmiy reja berilmagan — uning o‘rnida aniq placeholder ko‘rsatiladi.',
    en: 'Numeric prices are not published. Two listings have no official plan, so an explicit placeholder is shown instead.',
  },
  theme: { '--catalog-ink': '#1f2221', '--catalog-paper': '#ece3d5', '--catalog-surface': '#f8f2e8', '--catalog-accent': '#9b5338', '--catalog-accent-soft': '#cb8e51' },
};

export function RegnumUnifiedCatalog({ snapshot: embeddedSnapshot, initialLanguage = 'ru' }: { snapshot: RegnumSafeSnapshot; initialLanguage?: Language }) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot('regnum-plaza', embeddedSnapshot);
  const queueMetadata = useMemo(() => liveProject?.queues ?? [], [liveProject?.queues]);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => {
    const queueKey = regnumQueueKey(unit);
    const displayCode = regnumQueueCode(unit, queueMetadata);
    return {
      id: String(unit.id), unitKey: unit.sourceKey || undefined, number: String(unit.number), rooms: unit.rooms,
      area: unit.area, floor: unit.floor, entrance: unit.section ? String(unit.section) : undefined,
      queueKey, queueLabel: unit.queueLabel || (displayCode ? `${displayCode} очередь` : undefined),
      queueDisplayCode: displayCode, queueOrder: regnumQueueOrder(unit, queueMetadata),
      propertyType: 'apartment', status: unit.status, currency: 'UZS',
      plans: unit.planPublicPath ? [{ src: unit.planPublicPath, kind: 'unit' as const }] : [],
    };
  }), [queueMetadata, snapshot.units]);
  const queues = useMemo(() => {
    const live = liveCatalogQueueOptions(liveProject);
    if (live.length >= 2) return live.map((queue) => ({ key: queue.queueKey, label: queue.queueLabel, displayCode: queue.queueDisplayCode, order: queue.queueOrder, availableCount: queue.availableUnits }));
    const options = new Map<string, { key: string; label: string; displayCode?: string; order: number; availableCount: number }>();
    units.forEach((unit) => {
      if (!unit.queueKey) return;
      const current = options.get(unit.queueKey);
      options.set(unit.queueKey, { key: unit.queueKey, label: unit.queueLabel || unit.queueKey, displayCode: unit.queueDisplayCode, order: unit.queueOrder ?? Number.MAX_SAFE_INTEGER, availableCount: (current?.availableCount ?? 0) + 1 });
    });
    return [...options.values()].sort((left, right) => left.order - right.order);
  }, [liveProject, units]);
  return <ApartmentCatalog
    project={{ slug: 'regnum-plaza', name: snapshot.project, address: snapshot.projectFacts.address[initialLanguage] ?? snapshot.projectFacts.address.ru, className: snapshot.projectFacts.class[initialLanguage] ?? snapshot.projectFacts.class.ru, availableCount: liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length, totalCount: liveProject?.totalUnits ?? snapshot.officialTotalAtCapture, queues }}
    units={units} capabilities={capabilities} presentation={presentation} initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt} dataSource={dataSource}
  />;
}
