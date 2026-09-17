import type { CatalogBundle } from '@/app/kayan/project-page';

export const OFIYAT_APARTMENT_PHASES = ['phase-1', 'phase-2'] as const;
export const OFIYAT_APARTMENT_ENTRANCES = ['А', 'Б1', 'Б2', 'В1', 'В2', 'Г1', 'Г2'] as const;

const apartmentPhases = new Set<string>(OFIYAT_APARTMENT_PHASES);
const apartmentEntrances = new Set<string>(OFIYAT_APARTMENT_ENTRANCES);

export type OfiyatPublicUnit = {
  id: number;
  sourceKey: string;
  phaseSlug: string;
  propertyType: string;
  status: 'available' | 'reserved' | 'sold' | 'unavailable';
  number: string;
  entrance?: string;
  floor: number;
  area: number;
  rooms?: number;
  price: number;
  pricePerM2: number;
  currency: string;
  planImageUrl: string;
};

export type OfiyatPublicBundle = {
  project: {
    slug: 'ofiyat';
    name: string;
    totalUnits: number;
    availableUnits: number;
    updatedAt?: string;
    phases: Array<{
      slug: string;
      floorsTotal: number;
    }>;
  };
  units: OfiyatPublicUnit[];
  representativePlans: Array<{
    phaseSlug: string;
    rooms: number;
    imageUrl: string;
  }>;
};

export function isOfiyatApartmentPhase(slug: string) {
  return apartmentPhases.has(slug);
}

export function canonicalOfiyatEntrance(value: string | undefined) {
  const normalized = String(value ?? '').trim().toLocaleUpperCase('ru');
  const canonical = normalized === 'A' ? 'А' : normalized;
  return apartmentEntrances.has(canonical) ? canonical : '';
}

export function isOfiyatApartmentUnit(unit: Pick<OfiyatPublicUnit, 'phaseSlug' | 'propertyType' | 'entrance'>) {
  return unit.propertyType.trim().toLocaleLowerCase('ru') === 'apartment'
    && isOfiyatApartmentPhase(unit.phaseSlug)
    && Boolean(canonicalOfiyatEntrance(unit.entrance));
}

export function selectOfiyatPublicApartments<T extends Pick<OfiyatPublicUnit, 'phaseSlug' | 'propertyType' | 'entrance' | 'status'>>(
  units: readonly T[],
) {
  return units.filter((unit) => isOfiyatApartmentUnit(unit) && unit.status === 'available');
}

export function ofiyatExactPlanPath(value: string | undefined) {
  return value?.startsWith('/kayan/ofiyat/plans/exact/')
    && !value.includes('..')
    && !/[?#]/.test(value)
    ? value
    : '';
}

export function ofiyatRepresentativePlanPath(value: string | undefined) {
  return value && /^\/kayan\/ofiyat\/plans\/representative\/(?:phase-1|phase-2)\/[^/?#]+\.(?:webp|png|jpe?g)$/i.test(value)
    ? value
    : '';
}

export function ofiyatPublicBundle(bundle: CatalogBundle): OfiyatPublicBundle {
  const apartmentUnits = bundle.units.filter(isOfiyatApartmentUnit);
  const publicUnits = selectOfiyatPublicApartments(apartmentUnits);
  const representativePlans = new Map<string, CatalogBundle['layouts'][number]>();
  const layouts = bundle.layouts
    .filter((layout) => isOfiyatApartmentPhase(layout.phaseSlug)
      && typeof layout.rooms === 'number'
      && ofiyatRepresentativePlanPath(layout.imageUrl))
    .sort((left, right) => right.availableCount - left.availableCount
      || left.sourceId.localeCompare(right.sourceId, 'ru', { numeric: true }));

  layouts.forEach((layout) => {
    const key = `${layout.phaseSlug}:${layout.rooms}`;
    if (!representativePlans.has(key)) representativePlans.set(key, layout);
  });

  return {
    project: {
      slug: 'ofiyat',
      name: bundle.project.name,
      totalUnits: apartmentUnits.length,
      availableUnits: publicUnits.length,
      updatedAt: bundle.project.updatedAt,
      phases: bundle.project.phases
        .filter((phase) => isOfiyatApartmentPhase(phase.slug))
        .map((phase) => ({
          slug: phase.slug,
          floorsTotal: phase.floorsTotal,
        })),
    },
    units: publicUnits.map((unit) => ({
      id: unit.id,
      sourceKey: unit.sourceKey,
      phaseSlug: unit.phaseSlug,
      propertyType: unit.propertyType,
      status: unit.status,
      number: unit.number,
      entrance: canonicalOfiyatEntrance(unit.entrance),
      floor: unit.floor,
      area: unit.area,
      rooms: unit.rooms,
      price: unit.status === 'available' && typeof unit.price === 'number' && unit.price > 0 ? unit.price : 0,
      pricePerM2: unit.status === 'available' && typeof unit.pricePerM2 === 'number' && unit.pricePerM2 > 0 ? unit.pricePerM2 : 0,
      currency: unit.currency,
      planImageUrl: ofiyatExactPlanPath(unit.planImageUrl),
    })),
    representativePlans: [...representativePlans.values()].map((layout) => ({
      phaseSlug: layout.phaseSlug,
      rooms: layout.rooms as number,
      imageUrl: layout.imageUrl,
    })),
  };
}
