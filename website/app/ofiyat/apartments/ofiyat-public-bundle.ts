import type { CatalogBundle } from '@/app/kayan/project-page';

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

function localPlanPath(value: string | undefined) {
  return value?.startsWith('/kayan/ofiyat/plans/') && !value.startsWith('//') ? value : '';
}

export function ofiyatPublicBundle(bundle: CatalogBundle): OfiyatPublicBundle {
  const representativePlans = new Map<string, CatalogBundle['layouts'][number]>();
  const layouts = bundle.layouts
    .filter((layout) => typeof layout.rooms === 'number' && localPlanPath(layout.imageUrl))
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
      totalUnits: bundle.project.totalUnits,
      availableUnits: bundle.project.availableUnits,
      updatedAt: bundle.project.updatedAt,
      phases: bundle.project.phases.map((phase) => ({
        slug: phase.slug,
        floorsTotal: phase.floorsTotal,
      })),
    },
    units: bundle.units.map((unit) => ({
      id: unit.id,
      sourceKey: unit.sourceKey,
      phaseSlug: unit.phaseSlug,
      propertyType: unit.propertyType,
      status: unit.status,
      number: unit.number,
      entrance: unit.entrance,
      floor: unit.floor,
      area: unit.area,
      rooms: unit.rooms,
      price: unit.status === 'available' && typeof unit.price === 'number' && unit.price > 0 ? unit.price : 0,
      pricePerM2: unit.status === 'available' && typeof unit.pricePerM2 === 'number' && unit.pricePerM2 > 0 ? unit.pricePerM2 : 0,
      currency: unit.currency,
      planImageUrl: localPlanPath(unit.planImageUrl),
    })),
    representativePlans: [...representativePlans.values()].map((layout) => ({
      phaseSlug: layout.phaseSlug,
      rooms: layout.rooms as number,
      imageUrl: layout.imageUrl,
    })),
  };
}
