import type { Metadata } from 'next';
import snapshot from '@/data/4u-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { FourUCatalog } from './four-u-catalog';
import '../four-u.css';
import './four-u-catalog.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: 'Квартиры в 4U Tashkent — официальный snapshot', description: '33 актуальных предложения из официального каталога 4U Tashkent, snapshot от 30 августа 2026 года.', ogTitle: 'Выбор квартир — 4U Tashkent' },
  uz: { title: '4U Tashkent xonadonlari — rasmiy snapshot', description: '4U Tashkent rasmiy katalogidan 2026-yil 30-avgust holatidagi 33 ta dolzarb taklif.', ogTitle: 'Xonadon tanlash — 4U Tashkent' },
  en: { title: '4U Tashkent apartments — official snapshot', description: '33 current listings from the official 4U Tashkent catalogue, captured on 30 August 2026.', ogTitle: 'Choose an apartment — 4U Tashkent' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/4u/apartments`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.description, images: [`${appBasePath}/4u/images/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.description, images: [`${appBasePath}/4u/images/hero.webp`] } };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Квартиры 4U Tashkent',
    numberOfItems: snapshot.units.length,
    dateModified: snapshot.capturedAt,
    itemListElement: snapshot.units.slice(0, 12).map((unit, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Apartment', name: `Квартира №${unit.number}, ${unit.rooms} комн.`, floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, numberOfRooms: unit.rooms } })),
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} /><FourUCatalog snapshot={publicClientPayload(snapshot)} initialLanguage={language} /></>;
}
