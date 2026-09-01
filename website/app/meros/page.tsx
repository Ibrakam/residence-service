import type { Metadata } from 'next';
import { getCatalogBundle } from '@/app/kayan/catalog-snapshot';
import { MerosPage } from './meros-page';
import './meros.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: 'MEROS — современное наследие в Мирабаде', description: 'Квартиры Business и Comfort+ в Мирабадском районе: архитектура из природных материалов, семейный двор и точный каталог.' },
  uz: { title: 'MEROS — Miroboddagi zamonaviy meros', description: 'Mirobod tumanidagi Business va Komfort+ xonadonlar: tabiiy materiallar, oilaviy hovli va aniq katalog.' },
  en: { title: 'MEROS — contemporary heritage in Mirobod', description: 'Business and Comfort+ apartments in Mirobod with natural materials, a family courtyard and an exact catalogue.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const page = localized[language];
  const route = `${appBasePath}/meros`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: page.title, description: page.description, images: [`${appBasePath}/meros/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [`${appBasePath}/meros/hero.webp`] },
  };
}

export default async function MerosRoute({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('meros');
  const structuredData = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: 'MEROS',
    address: { '@type': 'PostalAddress', streetAddress: 'ул. 8 Марта', addressLocality: 'Ташкент', addressRegion: 'Мирабадский район', addressCountry: 'UZ' },
    geo: { '@type': 'GeoCoordinates', latitude: 41.280449, longitude: 69.296886 },
    telephone: '+998785552020', image: `${appBasePath}/meros/hero.webp`, numberOfAccommodationUnits: bundle.project.totalUnits,
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><MerosPage initialAvailable={bundle.project.availableUnits} initialLanguage={language} /></>;
}
