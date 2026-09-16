"use client";

import { useMemo } from "react";
import { ApartmentCatalog } from "@/app/catalog/apartment-catalog";
import type {
  CatalogCapabilities,
  CatalogLanguage,
  CatalogPresentation,
  CatalogUnit,
} from "@/app/catalog/types";
import { liveCatalogQueueOptions, useLiveCatalogSnapshot } from "@/app/live-catalog";

export type SarbonSafeUnit = {
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
  completion: string;
  status: "AVAILABLE";
  priceVisibility: "request-only";
  plan: string | null;
  planStatus: "available" | "missing-at-source";
};

export type SarbonSafeSnapshot = {
  schemaVersion: number;
  capturedAt: string;
  availableResidentialTotal: number;
  excludedCommercial: number;
  planCount: number;
  uniquePlanCount: number;
  missingPlanCount: number;
  units: SarbonSafeUnit[];
};

type Props = {
  snapshot: SarbonSafeSnapshot;
  initialLanguage?: CatalogLanguage;
  initialTracking: Record<string, string>;
  basePath: string;
  initialUnitId?: string;
};

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
  basePath: string,
  pathname: string,
  language: CatalogLanguage,
  tracking: Record<string, string>,
  extra: Record<string, string> = {},
) {
  const params = new URLSearchParams(tracking);
  params.set("lang", language);
  Object.entries(extra).forEach(([key, value]) => params.set(key, value));
  return `${basePath}${pathname}?${params.toString()}`;
}

export function SarbonUnifiedCatalog({
  snapshot: embeddedSnapshot,
  initialLanguage = "ru",
  initialTracking,
  basePath,
  initialUnitId,
}: Props) {
  const { data: snapshot, dataSource, refreshedAt, project: liveProject } = useLiveCatalogSnapshot("sarbon", embeddedSnapshot);
  const units = useMemo<CatalogUnit[]>(() => snapshot.units.map((unit) => ({
    id: unit.id,
    unitKey: unit.unitKey,
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
    propertyType: "apartment",
    status: "available",
    plans: unit.plan ? [{ src: unit.plan, kind: "unit" as const }] : [],
  })), [snapshot.units]);

  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: "SARBON",
    brandSubtitle: "NEW TASHKENT",
    eyebrow: {
      ru: "БИЗНЕС-КЛАСС · ПЕРВАЯ ОЧЕРЕДЬ",
      uz: "BIZNES-KLASS · BIRINCHI NAVBAT",
      en: "BUSINESS CLASS · PHASE ONE",
    },
    title: {
      ru: "Выберите квартиру",
      uz: "Xonadonni tanlang",
      en: "Choose an apartment",
    },
    accent: {
      ru: "в новом городе.",
      uz: "yangi shaharda.",
      en: "in the new city.",
    },
    lead: {
      ru: "Актуальные предложения первой очереди с точными локальными планировками и автоматическим обновлением из CRM.",
      uz: "Aniq lokal rejalar va CRM’dan avtomatik yangilanishga ega birinchi navbat takliflari.",
      en: "Current phase-one listings with exact local plans and automatic CRM updates.",
    },
    backLabel: {
      ru: "О проекте",
      uz: "Loyiha haqida",
      en: "About the project",
    },
    backHref: (language) => localizedHref(basePath, "/sarbon", language, initialTracking),
    privacyHref: (language) => localizedHref(basePath, "/privacy", language, initialTracking, {
      project: "sarbon",
      from: "catalog",
    }),
    phone: "+998 78 113 77 12",
    storageKey: "sarbon-language",
    cardPageSize: 8,
    defaultSort: "status",
    availableOnlyDefault: true,
    disclaimer: {
      ru: `Показано ${snapshot.availableResidentialTotal} доступных квартир первой очереди. Для ${snapshot.planCount} квартир опубликованы точные локальные планы (${snapshot.uniquePlanCount} уникальных схем). Цены не опубликованы — наличие и условия подтверждает менеджер. Шахматка не интерпретирует фасад или генплан.`,
      uz: `Birinchi navbatdagi ${snapshot.availableResidentialTotal} ta mavjud xonadon ko‘rsatilgan. ${snapshot.planCount} ta xonadon uchun aniq lokal rejalar chop etilgan (${snapshot.uniquePlanCount} ta noyob sxema). Narxlar e’lon qilinmagan — mavjudlik va shartlarni menejer tasdiqlaydi. Shaxmatka fasad yoki bosh rejani talqin qilmaydi.`,
      en: `${snapshot.availableResidentialTotal} available phase-one apartments are shown. Exact local plans are published for ${snapshot.planCount} apartments (${snapshot.uniquePlanCount} unique layouts). Prices are not published; a manager confirms availability and terms. The availability grid does not interpret the facade or masterplan.`,
    },
    theme: {
      "--catalog-ink": "#211d1b",
      "--catalog-paper": "#f2efe8",
      "--catalog-surface": "#fffdf8",
      "--catalog-accent": "#3a0515",
      "--catalog-accent-soft": "#d0ad6b",
    },
  }), [basePath, initialTracking, snapshot.availableResidentialTotal, snapshot.planCount, snapshot.uniquePlanCount]);

  const queues = useMemo(() => liveCatalogQueueOptions(liveProject).map((queue) => ({
    key: queue.queueKey,
    label: queue.queueLabel,
    displayCode: queue.queueDisplayCode,
    order: queue.queueOrder,
    availableCount: queue.availableUnits,
  })), [liveProject]);

  return <ApartmentCatalog
    key={initialUnitId || "catalog"}
    project={{
      slug: "sarbon",
      name: "SARBON",
      availableCount: liveProject?.availableUnits ?? snapshot.availableResidentialTotal,
      totalCount: liveProject?.totalUnits ?? snapshot.availableResidentialTotal,
      queues,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? snapshot.capturedAt}
    dataSource={dataSource}
  />;
}
