import type { Metadata } from 'next';
import { KayanCatalogPage } from '@/app/kayan/project-page';
import { getCatalogBundle, merosCatalogGeneratedAt } from '@/app/kayan/catalog-snapshot';
import '@/app/kayan/kayan.css';
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
  return <KayanCatalogPage slug="meros" initialBundle={getCatalogBundle('meros')} snapshotGeneratedAt={merosCatalogGeneratedAt} initialLanguage={language} />;
}
