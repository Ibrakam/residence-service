import type { Metadata } from 'next';
import { FlagmanPage } from './flagman-page';
import './flagman.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: 'Flagman Tashkent — готовый клубный дом Business+', description: 'Flagman Tashkent — клубный дом Business+ в Мирзо-Улугбекском районе. Роскошный минимализм, натуральный Limestone и готовый дом.', ogTitle: 'Flagman Tashkent — роскошный минимализм', ogDescription: 'Готовый клубный дом Business+ на улице Мухаммада Юсуфа.' },
  uz: { title: 'Flagman Tashkent — tayyor Business+ klub uyi', description: 'Mirzo Ulug‘bek tumanidagi tayyor Business+ klub uyi: hashamatli minimalizm va tabiiy Limestone.', ogTitle: 'Flagman Tashkent — hashamatli minimalizm', ogDescription: 'Muhammad Yusuf ko‘chasidagi tayyor Business+ klub uyi.' },
  en: { title: 'Flagman Tashkent — completed Business+ club residence', description: 'A completed Business+ club residence in Mirzo Ulugbek district, shaped by luxury minimalism and natural Limestone.', ogTitle: 'Flagman Tashkent — luxury minimalism', ogDescription: 'A completed Business+ club residence on Muhammad Yusuf Street.' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/flagman`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.ogDescription, images: [`${appBasePath}/flagman/images/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.ogDescription, images: [`${appBasePath}/flagman/images/hero.webp`] } };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: 'Flagman Tashkent',
    description: 'Готовый клубный дом Business+ в концепции роскошного минимализма.',
    url: `https://form.tencorp.uz${appBasePath}/flagman`,
    image: `https://form.tencorp.uz${appBasePath}/flagman/images/hero.webp`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'улица Мухаммада Юсуфа, 54',
      addressLocality: 'Ташкент',
      addressRegion: 'Мирзо-Улугбекский район',
      addressCountry: 'UZ',
    },
    numberOfAccommodationUnits: 80,
    numberOfFloors: 16,
    brand: { '@type': 'Organization', name: 'NRG-BI' },
    contributor: { '@type': 'Organization', name: 'AL-BINA' },
    additionalProperty: [
      { '@type': 'PropertyValue', name: 'Класс жилья', value: 'Business+' },
      { '@type': 'PropertyValue', name: 'Высота потолков', value: '3 м' },
      { '@type': 'PropertyValue', name: 'Статус', value: 'Дом сдан' },
    ],
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><FlagmanPage initialLanguage={language} /></>;
}
