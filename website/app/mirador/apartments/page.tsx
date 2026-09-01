import type { Metadata } from 'next';
import { KayanCatalogPage } from '@/app/kayan/project-page';
import { getCatalogBundle, getCatalogBundleTimestamp } from '@/app/kayan/catalog-snapshot';
import '@/app/kayan/kayan.css';
import '@/app/kayan/mirador.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: 'Выбор квартиры в MIRADOR', description: 'Интерактивный каталог MIRADOR: наличие, площади и актуальные цены.' },
  uz: { title: 'MIRADOR majmuasida xonadon tanlash', description: 'MIRADOR interaktiv katalogi: mavjudlik, maydon va dolzarb narxlar.' },
  en: { title: 'Choose an apartment at MIRADOR', description: 'MIRADOR interactive catalogue with availability, areas and current prices.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/mirador/apartments`;
  return {
    title: content.title, description: content.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: content.title, description: content.description, images: [`${appBasePath}/kayan/mirador/hero.webp`] },
    twitter: { card: 'summary_large_image', title: content.title, description: content.description, images: [`${appBasePath}/kayan/mirador/hero.webp`] },
  };
}

export default async function MiradorApartmentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('mirador');
  return <KayanCatalogPage slug="mirador" initialBundle={bundle} snapshotGeneratedAt={getCatalogBundleTimestamp(bundle)} initialLanguage={language} />;
}
