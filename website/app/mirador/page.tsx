import type { Metadata } from 'next';
import { KayanProjectPage } from '@/app/kayan/project-page';
import { getCatalogBundle } from '@/app/kayan/catalog-snapshot';
import '@/app/kayan/kayan.css';
import '@/app/kayan/mirador.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const localized = {
  ru: { title: 'MIRADOR — квартиры бизнес-класса в Ташкенте', description: 'Квартиры с террасами, приватный двор и интерактивный выбор квартир Mirador в Ташкенте.' },
  uz: { title: 'MIRADOR — Toshkentdagi biznes-klass xonadonlar', description: 'Terrasali xonadonlar, yopiq hovli va Mirador majmuasidagi interaktiv tanlov.' },
  en: { title: 'MIRADOR — business-class apartments in Tashkent', description: 'Terrace apartments, a private courtyard and an interactive apartment catalogue at Mirador.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/mirador`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, 'en': `${route}?lang=en` } },
    openGraph: { title: content.title, description: content.description, images: [`${appBasePath}/kayan/mirador/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' },
    twitter: { card: 'summary_large_image', title: content.title, description: content.description, images: [`${appBasePath}/kayan/mirador/hero.webp`] },
  };
}

export default async function MiradorPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('mirador');
  const structuredData = {
    '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: 'MIRADOR',
    address: { '@type': 'PostalAddress', streetAddress: 'Фаргона йули, 52', addressLocality: 'Ташкент', addressCountry: 'UZ' },
    telephone: '+998781137712', image: `${appBasePath}/kayan/mirador/hero.webp`,
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><KayanProjectPage slug="mirador" initialProject={bundle.project} initialLanguage={language} /></>;
}
