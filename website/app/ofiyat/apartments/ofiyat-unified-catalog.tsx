'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type {
  CatalogCapabilities,
  CatalogLanguage,
  CatalogPresentation,
  CatalogPropertyType,
  CatalogUnit,
} from '@/app/catalog/types';
import { useLiveCatalogUnits } from '@/app/live-catalog';
import { projectConfigs } from '@/app/kayan/project-data';
import {
  isOfiyatApartmentPhase,
  ofiyatExactPlanPath,
  ofiyatRepresentativePlanPath,
  selectOfiyatPublicApartments,
  type OfiyatPublicBundle,
  type OfiyatPublicUnit,
} from './ofiyat-public-bundle';

type Props = {
  initialBundle: OfiyatPublicBundle;
  snapshotGeneratedAt?: string;
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

const config = projectConfigs.ofiyat;

const capabilities: CatalogCapabilities = {
  visualFlow: false,
  exactUnitPlans: false,
  secondaryPlans: false,
  pricesVisible: true,
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

function phaseLabel(slug: string) {
  if (slug === 'phase-1') return 'I';
  if (slug === 'phase-2') return 'II';
  if (slug === 'parking') return 'Parking';
  return slug;
}

function propertyType(value: string): CatalogPropertyType {
  const normalized = value.toLocaleLowerCase('ru');
  if (normalized.includes('parking')) return 'parking';
  if (normalized.includes('commercial') || normalized.includes('commerce')) return 'commercial';
  return 'apartment';
}

export function OfiyatUnifiedCatalog({ initialBundle, snapshotGeneratedAt, initialLanguage = 'ru' }: Props) {
  const currentSearch = useSearchParams().toString();
  const { data: liveUnits, dataSource, refreshedAt, project: liveProject } = useLiveCatalogUnits<OfiyatPublicUnit>('ofiyat', initialBundle.units);
  const maxFloors = useMemo(() => new Map(initialBundle.project.phases.map((phase) => [phase.slug, phase.floorsTotal])), [initialBundle.project.phases]);
  const representativePlans = useMemo(() => new Map(initialBundle.representativePlans
    .filter((plan) => isOfiyatApartmentPhase(plan.phaseSlug) && ofiyatRepresentativePlanPath(plan.imageUrl))
    .map((plan) => [`${plan.phaseSlug}:${plan.rooms}`, plan.imageUrl])), [initialBundle.representativePlans]);
  const publicApartments = useMemo(() => selectOfiyatPublicApartments(liveUnits), [liveUnits]);

  const units = useMemo<CatalogUnit[]>(() => publicApartments.map((unit) => {
    const exactPlan = ofiyatExactPlanPath(unit.planImageUrl) || undefined;
    const representativePlan = !exactPlan && typeof unit.rooms === 'number'
      ? representativePlans.get(`${unit.phaseSlug}:${unit.rooms}`)
      : undefined;

    return {
      id: String(unit.id),
      unitKey: unit.sourceKey || undefined,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: maxFloors.get(unit.phaseSlug) || undefined,
      entrance: unit.entrance,
      phase: phaseLabel(unit.phaseSlug),
      propertyType: propertyType(unit.propertyType),
      status: unit.status,
      price: unit.price > 0 ? unit.price : undefined,
      pricePerM2: unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
      currency: unit.currency,
      plans: exactPlan
        ? [{ src: exactPlan, kind: 'unit' as const }]
        : representativePlan
          ? [{ src: representativePlan, kind: 'representative' as const }]
          : [],
    };
  }), [publicApartments, maxFloors, representativePlans]);

  const presentation = useMemo<CatalogPresentation>(() => ({
    brand: 'OFIYAT',
    brandSubtitle: 'RESIDENCE',
    eyebrow: {
      ru: config.copy.ru.eyebrow,
      uz: config.copy.uz.eyebrow,
      en: config.copy.en.eyebrow,
    },
    title: {
      ru: 'Выберите квартиру',
      uz: 'Xonadonni tanlang',
      en: 'Choose an apartment',
    },
    accent: {
      ru: 'в гармонии с городом.',
      uz: 'shahar bilan uyg‘unlikda.',
      en: 'in harmony with the city.',
    },
    lead: {
      ru: config.copy.ru.description,
      uz: config.copy.uz.description,
      en: config.copy.en.description,
    },
    backLabel: {
      ru: 'О проекте',
      uz: 'Loyiha haqida',
      en: 'About the project',
    },
    backHref: (language) => localizedHref('/ofiyat', language, currentSearch),
    privacyHref: (language) => localizedHref('/privacy', language, currentSearch, {
      project: 'ofiyat',
      from: 'catalog',
    }),
    phone: '+998 78 113 77 12',
    storageKey: 'kayan-language',
    cardPageSize: 18,
    defaultSort: 'status',
    disclaimer: {
      ru: 'Точные планы квартир и этажные схемы источником не опубликованы. Типовые локальные планы отмечены как примеры и подбираются только по очереди и числу комнат. Цены показываются лишь для свободных объектов; актуальность и условия подтверждает менеджер.',
      uz: 'Manbada xonadonlarning aniq rejalari va qavat sxemalari e’lon qilinmagan. Lokal namunaviy rejalar alohida belgilangan va faqat bosqich hamda xonalar soni bo‘yicha tanlanadi. Narx faqat mavjud obyektlar uchun ko‘rsatiladi; dolzarblik va shartlarni menejer tasdiqlaydi.',
      en: 'The source does not publish exact apartment plans or floor schemes. Local representative plans are labelled as examples and matched only by phase and room count. Prices are shown only for available properties; a manager confirms availability and terms.',
    },
    theme: {
      '--catalog-ink': config.palette.ink,
      '--catalog-paper': config.palette.paper,
      '--catalog-surface': '#fffdf8',
      '--catalog-accent': config.palette.accent,
      '--catalog-accent-soft': '#d7b49d',
    },
  }), [currentSearch]);

  const liveApartmentTotal = liveProject?.phases
    ?.filter((phase) => isOfiyatApartmentPhase(phase.slug))
    .reduce((total, phase) => total + phase.totalUnits, 0);
  const availableCount = units.length;
  const totalCount = liveApartmentTotal || initialBundle.project.totalUnits;

  return <ApartmentCatalog
    project={{
      slug: 'ofiyat',
      name: 'OFIYAT',
      availableCount,
      totalCount,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? liveProject?.updatedAt ?? initialBundle.project.updatedAt ?? snapshotGeneratedAt}
    dataSource={dataSource}
  />;
}
