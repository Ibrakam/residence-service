import type { Metadata } from 'next';
import { getCatalogBundle, merosCatalogGeneratedAt } from '@/app/kayan/catalog-snapshot';
import { MerosUnifiedCatalog, type MerosSafeSnapshot } from './meros-unified-catalog';
import '../meros.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: 'Выбор квартиры в MEROS', description: 'Актуальные предложения MEROS: планировки, площади, этажи, цены и статусы обновляются автоматически.' },
  uz: { title: 'MEROS majmuasida xonadon tanlash', description: 'MEROS takliflari, rejalari, maydonlari, qavatlari, narxlari va holatlari avtomatik yangilanadi.' },
  en: { title: 'Choose an apartment at MEROS', description: 'MEROS listings, plans, areas, floors, prices and statuses update automatically.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const page = localized[language];
  const route = `${appBasePath}/meros/apartments`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: page.title, description: page.description, images: [`${appBasePath}/meros/architecture-aerial.webp`] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [`${appBasePath}/meros/architecture-aerial.webp`] },
  };
}

export default async function MerosApartmentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('meros');
  const snapshot: MerosSafeSnapshot = {
    capturedAt: merosCatalogGeneratedAt,
    totalCount: bundle.project.totalUnits,
    project: { name: bundle.project.name, totalUnits: bundle.project.totalUnits, availableUnits: bundle.project.availableUnits },
    units: bundle.units.map((unit) => ({
      id: `meros:${unit.phaseSlug}:${unit.number}:${unit.floor}:${unit.entrance}:${unit.area}`,
      sourceKey: unit.sourceKey,
      number: unit.number,
      rooms: unit.rooms ?? 0,
      area: unit.area,
      floor: unit.floor,
      maxFloor: bundle.project.phases.find((phase) => phase.slug === unit.phaseSlug)?.floorsTotal ?? unit.floor,
      entrance: unit.entrance ?? '',
      phase: unit.phaseName,
      phaseSlug: unit.phaseSlug,
      propertyType: unit.propertyType,
      status: unit.status,
      price: unit.price ?? 0,
      pricePerM2: unit.pricePerM2 ?? 0,
      currency: unit.currency,
      plan: unit.planImageUrl ?? '',
    })),
  };
  return <MerosUnifiedCatalog snapshot={snapshot} initialLanguage={language} />;
}
