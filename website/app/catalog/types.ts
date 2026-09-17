import type { CSSProperties, ReactNode } from 'react';

export type CatalogLanguage = 'ru' | 'uz' | 'en';

export type CatalogStatus = 'available' | 'reserved' | 'sold' | 'unavailable';

export type CatalogPropertyType = 'apartment' | 'parking' | 'commercial';

export type CatalogPlanKind = 'unit' | 'floor-position' | 'representative';

export type CatalogSort = 'status' | 'price-asc' | 'price-desc' | 'area-asc' | 'area-desc' | 'floor-asc' | 'floor-desc';

export type CatalogPlan = {
  src: string;
  previewSrc?: string;
  fallbackSrc?: string;
  kind: CatalogPlanKind;
  label?: Partial<Record<CatalogLanguage, string>>;
};

export type CatalogQueue = {
  key: string;
  label: string;
  displayCode?: string;
  order: number;
  availableCount: number;
};

export type CatalogUnit = {
  id: string;
  unitKey?: string;
  number: string;
  rooms?: number;
  area: number;
  floor: number;
  maxFloor?: number;
  entrance?: string;
  building?: string;
  phase?: string;
  queueKey?: string;
  queueLabel?: string;
  queueDisplayCode?: string;
  queueOrder?: number;
  propertyType: CatalogPropertyType;
  status: CatalogStatus;
  price?: number;
  regularPrice?: number;
  pricePerM2?: number;
  currency?: string;
  /** Exact CRM finishing flag. Undefined means the provider does not expose it. */
  repairIncluded?: boolean;
  plans: CatalogPlan[];
};

export type CatalogProject = {
  slug: string;
  name: string;
  address?: string;
  className?: string;
  statusLabel?: Partial<Record<CatalogLanguage, string>>;
  availableCount: number;
  totalCount?: number;
  queues?: CatalogQueue[];
};

export type CatalogCapabilities = {
  visualFlow: boolean;
  exactUnitPlans: boolean;
  secondaryPlans: boolean;
  pricesVisible: boolean;
  phases: boolean;
  buildings: boolean;
  entrances: boolean;
};

export type LocalizedCatalogCopy = Partial<Record<CatalogLanguage, string>>;

export type CatalogPresentation = {
  brand: string;
  brandSubtitle?: string;
  eyebrow?: LocalizedCatalogCopy;
  title: LocalizedCatalogCopy;
  accent?: LocalizedCatalogCopy;
  lead?: LocalizedCatalogCopy;
  backLabel?: LocalizedCatalogCopy;
  backHref: (language: CatalogLanguage) => string;
  privacyHref: (language: CatalogLanguage) => string;
  phone?: string;
  storageKey?: string;
  cardPageSize?: number;
  defaultSort?: CatalogSort;
  availableOnlyDefault?: boolean;
  phaseLabel?: LocalizedCatalogCopy;
  allPhasesLabel?: LocalizedCatalogCopy;
  buildingLabel?: LocalizedCatalogCopy;
  allBuildingsLabel?: LocalizedCatalogCopy;
  disclaimer?: LocalizedCatalogCopy;
  theme?: CSSProperties & Record<`--catalog-${string}`, string | number>;
};

export type ApartmentCatalogProps = {
  project: CatalogProject;
  units: CatalogUnit[];
  capabilities: CatalogCapabilities;
  presentation: CatalogPresentation;
  initialLanguage?: CatalogLanguage;
  refreshedAt?: string;
  dataSource?: 'live' | 'cached' | 'embedded';
  visualFlow?: ReactNode | ((language: CatalogLanguage, actions: { openLead: (unitKey?: string) => void }) => ReactNode);
  visualFlowAvailable?: boolean;
};
