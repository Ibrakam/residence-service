'use client';

import type { ComponentType, CSSProperties } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ApartmentCatalog } from '@/app/catalog/apartment-catalog';
import type { CatalogCapabilities, CatalogPresentation, CatalogPropertyType, CatalogUnit } from '@/app/catalog/types';
import { hasMiradorCatalogIntent, MIRADOR_VISUAL_FLOW_MEDIA } from '@/app/kayan/mirador-flow-policy';
import type { MiradorExplorerSelection } from '@/app/kayan/mirador-block-explorer';
import type { CatalogBundle } from '@/app/kayan/project-page';
import { projectConfigs, type KayanLanguage } from '@/app/kayan/project-data';
import { useLiveCatalogUnits } from '@/app/live-catalog';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

type ExplorerProps = {
  language: KayanLanguage;
  catalogHref: string;
  variant: 'catalog';
  onLead?: (selection: MiradorExplorerSelection) => void;
};

type ExplorerComponent = ComponentType<ExplorerProps>;

function useMiradorVisualFlow() {
  const [Explorer, setExplorer] = useState<ExplorerComponent | null>(null);

  useEffect(() => {
    const media = window.matchMedia(MIRADOR_VISUAL_FLOW_MEDIA);
    const allowedOnEntry = media.matches && !hasMiradorCatalogIntent(window.location.search);
    let disposed = false;

    if (allowedOnEntry) {
      void import('@/app/kayan/mirador-block-explorer').then((module) => {
        if (!disposed) setExplorer(() => module.MiradorBlockExplorer as ExplorerComponent);
      });
    }

    const onChange = () => {
      if (media.matches) return;
      setExplorer(null);
    };
    media.addEventListener('change', onChange);
    return () => {
      disposed = true;
      media.removeEventListener('change', onChange);
    };
  }, []);

  return { Explorer, available: Boolean(Explorer) };
}

function representativePlan(unit: CatalogBundle['units'][number], layouts: CatalogBundle['layouts']) {
  if (unit.propertyType === 'parking' || typeof unit.rooms !== 'number') return undefined;
  return layouts
    .filter((layout) => layout.phaseSlug === unit.phaseSlug && layout.rooms === unit.rooms && layout.imageUrl)
    .sort((left, right) => right.availableCount - left.availableCount || left.sourceId.localeCompare(right.sourceId, 'ru', { numeric: true }))[0]?.imageUrl;
}

function propertyType(value: string): CatalogPropertyType {
  const normalized = value.toLocaleLowerCase('ru');
  if (normalized.includes('parking')) return 'parking';
  if (normalized.includes('commercial') || normalized.includes('commerce')) return 'commercial';
  return 'apartment';
}

const capabilities: CatalogCapabilities = {
  visualFlow: true,
  exactUnitPlans: true,
  secondaryPlans: false,
  pricesVisible: true,
  phases: false,
  buildings: false,
  entrances: true,
};

const config = projectConfigs.mirador;

const presentation: CatalogPresentation = {
  brand: 'MIRADOR',
  brandSubtitle: 'PRIVATE RESIDENCE',
  eyebrow: { ru: config.copy.ru.eyebrow, uz: config.copy.uz.eyebrow, en: config.copy.en.eyebrow },
  title: { ru: 'Выберите квартиру', uz: 'Xonadonni tanlang', en: 'Choose an apartment' },
  accent: { ru: 'с новой точки зрения.', uz: 'yangi nigoh bilan.', en: 'from a new perspective.' },
  lead: { ru: config.copy.ru.description, uz: config.copy.uz.description, en: config.copy.en.description },
  backLabel: { ru: 'О проекте', uz: 'Loyiha haqida', en: 'About the project' },
  backHref: (language) => `${appBasePath}/mirador?lang=${language}`,
  privacyHref: (language) => `${appBasePath}/privacy?project=mirador&lang=${language}&from=catalog`,
  phone: '+998 78 113 77 12',
  storageKey: 'kayan-language',
  cardPageSize: 18,
  defaultSort: 'status',
  disclaimer: {
    ru: 'Визуальные блоки 1–7 не связываются с подъездами без подтверждённых данных. В каталоге показываются только реальные квартиры и проверенные схемы.',
    uz: '1–7 vizual bloklar tasdiqlangan ma’lumotsiz kirishlar bilan bog‘lanmaydi. Katalogda faqat haqiqiy xonadonlar va tekshirilgan rejalar ko‘rsatiladi.',
    en: 'Visual blocks 1–7 are not mapped to entrances without verified data. The catalogue shows only real apartments and verified plans.',
  },
  theme: {
    '--catalog-ink': config.palette.ink,
    '--catalog-paper': config.palette.paper,
    '--catalog-surface': '#fffdf8',
    '--catalog-accent': config.palette.accent,
    '--catalog-accent-soft': '#d9c49a',
  },
};

const explorerStyle = {
  '--kayan-ink': config.palette.ink,
  '--kayan-paper': config.palette.paper,
  '--kayan-paper-2': config.palette.paperAlt,
  '--kayan-accent': config.palette.accent,
  '--kayan-secondary': config.palette.secondary,
  '--kayan-menu': config.palette.menu,
} as CSSProperties;

export function MiradorUnifiedCatalog({ initialBundle, snapshotGeneratedAt, initialLanguage = 'ru' }: { initialBundle: CatalogBundle; snapshotGeneratedAt?: string; initialLanguage?: KayanLanguage }) {
  const { data: liveUnits, dataSource, refreshedAt, project: liveProject } = useLiveCatalogUnits('mirador', initialBundle.units);
  const { Explorer, available: visualAvailable } = useMiradorVisualFlow();
  const maxFloors = useMemo(() => new Map(initialBundle.project.phases.map((phase) => [phase.slug, phase.floorsTotal])), [initialBundle.project.phases]);
  const units = useMemo<CatalogUnit[]>(() => liveUnits.map((unit) => {
    const exactPlan = unit.planImageUrl;
    const fallbackPlan = exactPlan ? undefined : representativePlan(unit, initialBundle.layouts);
    return {
      id: String(unit.id),
      unitKey: unit.sourceKey || undefined,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: maxFloors.get(unit.phaseSlug),
      entrance: unit.entrance,
      phase: unit.phaseName,
      propertyType: propertyType(unit.propertyType),
      status: unit.status,
      price: unit.price && unit.price > 0 ? unit.price : undefined,
      pricePerM2: unit.pricePerM2 && unit.pricePerM2 > 0 ? unit.pricePerM2 : undefined,
      currency: unit.currency,
      plans: exactPlan
        ? [{ src: exactPlan, kind: 'unit' as const }]
        : fallbackPlan
          ? [{ src: fallbackPlan, kind: 'representative' as const }]
          : [],
    };
  }), [initialBundle.layouts, liveUnits, maxFloors]);

  const availableCount = liveProject?.availableUnits ?? units.filter((unit) => unit.status === 'available').length;
  const totalCount = liveProject?.totalUnits ?? initialBundle.project.totalUnits;

  return <ApartmentCatalog
    project={{
      slug: 'mirador',
      name: 'MIRADOR',
      address: config.copy[initialLanguage].address,
      className: 'Business class',
      availableCount,
      totalCount,
    }}
    units={units}
    capabilities={capabilities}
    presentation={presentation}
    initialLanguage={initialLanguage}
    refreshedAt={refreshedAt ?? liveProject?.updatedAt ?? snapshotGeneratedAt ?? initialBundle.project.updatedAt}
    dataSource={dataSource}
    visualFlowAvailable={visualAvailable}
    visualFlow={(language, actions) => Explorer ? <div className="kayan-site--mirador mirador-unified-flow" style={explorerStyle}><Explorer language={language} catalogHref={`${appBasePath}/mirador/apartments?lang=${language}#catalog`} variant="catalog" onLead={(selection) => actions.openLead(selection.unitKey)} /></div> : null}
  />;
}
