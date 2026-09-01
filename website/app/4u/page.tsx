import type { Metadata } from 'next';
import { FourUPage } from './four-u-page';
import './four-u.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: '4U Tashkent — жилой комплекс бизнес-класса', description: '4U Tashkent в Мирзо-Улугбекском районе: четыре двора, mix-used архитектура, потолки 3 м и квартиры площадью 30–131 м².', ogTitle: '4U Tashkent — Manhattan energy × California ease' },
  uz: { title: '4U Tashkent — biznes-klass turar joy majmuasi', description: 'Mirzo Ulug‘bek tumanidagi 4U Tashkent: to‘rtta hovli, mixed-use arxitektura, 3 m shiftlar va 30–131 m² xonadonlar.', ogTitle: '4U Tashkent — Manhattan energiyasi × California yengilligi' },
  en: { title: '4U Tashkent — business-class residential complex', description: '4U Tashkent in Mirzo Ulugbek district: four courtyards, mixed-use architecture, 3 m ceilings and apartments from 30 to 131 m².', ogTitle: '4U Tashkent — Manhattan energy × California ease' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/4u`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.description, images: [`${appBasePath}/4u/images/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.description, images: [`${appBasePath}/4u/images/hero.webp`] } };
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'ApartmentComplex',
  name: '4U Tashkent',
  description: 'Жилой комплекс бизнес-класса в Мирзо-Улугбекском районе Ташкента, вдоль улицы Сайрам.',
  address: { '@type': 'PostalAddress', addressLocality: 'Ташкент', addressRegion: 'Мирзо-Улугбекский район', streetAddress: 'вдоль улицы Сайрам', addressCountry: 'UZ' },
  url: `https://form.tencorp.uz${appBasePath}/4u`,
  image: `https://form.tencorp.uz${appBasePath}/4u/images/hero.webp`,
  numberOfAccommodationUnits: 183,
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
    <FourUPage initialLanguage={language} />
  </>;
}
