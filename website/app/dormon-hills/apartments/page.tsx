import type { Metadata } from 'next';
import { dormonPlansState } from '../../../lib/dormon-plans-state';
import { DormonPlanCatalog } from './plan-catalog';
import { attributionQuery, basePath, catalogHref, catalogLanguage, catalogPath, copy, initialPlanFilters, type CatalogQuery } from './plan-catalog-data';

type Props = { searchParams?: Promise<CatalogQuery> };

export const dynamic = 'force-dynamic';

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const language = catalogLanguage((await searchParams) ?? {});
  return {
    title: `${copy[language].title} | Do’rmon Hills`,
    description: copy[language].description,
    alternates: {
      canonical: catalogHref(catalogPath, language),
      languages: {
        ru: catalogHref(catalogPath, 'ru'),
        uz: catalogHref(catalogPath, 'uz'),
        en: catalogHref(catalogPath, 'en'),
      },
    },
    openGraph: { images: [`${basePath}/dormon-hills/images/hero.webp`] },
  };
}

export default async function DormonPlansPage({ searchParams }: Props) {
  const query = (await searchParams) ?? {};
  const snapshot = await dormonPlansState();
  return <DormonPlanCatalog
    language={catalogLanguage(query)}
    attribution={attributionQuery(query)}
    initialFilters={initialPlanFilters(query, snapshot.plans)}
    plans={snapshot.plans}
    source={snapshot.source}
  />;
}
