import type { Metadata } from 'next';
import { KayanProjectPage } from '@/app/kayan/project-page';
import { getCatalogBundle } from '@/app/kayan/catalog-snapshot';
import '@/app/kayan/kayan.css';
import '@/app/kayan/ofiyat.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: 'OFIYAT — квартиры White box в Ташкенте', description: 'Две жилые очереди, благоустроенный двор, квартиры White box и подземный паркинг Ofiyat.' },
  uz: { title: 'OFIYAT — Toshkentdagi White box xonadonlar', description: 'Ikki turar joy bosqichi, obodonlashtirilgan hovli, White box xonadonlar va yer osti parkingi.' },
  en: { title: 'OFIYAT — White box apartments in Tashkent', description: 'Two residential phases, a landscaped courtyard, White box apartments and underground parking at Ofiyat.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/ofiyat`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: content.title, description: content.description, images: [`${appBasePath}/kayan/ofiyat/frame-4-desktop.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' },
    twitter: { card: 'summary_large_image', title: content.title, description: content.description, images: [`${appBasePath}/kayan/ofiyat/frame-4-desktop.webp`] },
  };
}

export default async function OfiyatPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('ofiyat');
  const structuredData = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: 'OFIYAT',
    address: { '@type': 'PostalAddress', streetAddress: 'Фаргона йули, 33–35', addressLocality: 'Ташкент', addressCountry: 'UZ' },
    telephone: '+998785552020', image: `${appBasePath}/kayan/ofiyat/frame-4-desktop.webp`,
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><KayanProjectPage slug="ofiyat" initialProject={bundle.project} initialLanguage={language} /></>;
}
