import type { Metadata } from 'next';
import snapshot from '@/data/voha-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { VohaCatalog } from './voha-catalog';
import '../voha.css';
import './voha-catalog.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: 'Квартиры в Voha — 104 предложения в официальном snapshot', description: 'Полный датированный snapshot официального каталога Voha: 104 предложения с реальными планировками, площадями, этажами и ценами на 30 августа 2026 года.', ogTitle: 'Выбор квартир — Voha' },
  uz: { title: 'Voha xonadonlari — rasmiy snapshotdagi 104 taklif', description: 'Voha rasmiy katalogining to‘liq saqlangan kesimi: 2026-yil 30-avgustdagi 104 taklif, rejalar, maydonlar, qavatlar va narxlar.', ogTitle: 'Xonadon tanlash — Voha' },
  en: { title: 'Voha apartments — 104 listings in the official snapshot', description: 'A complete dated snapshot of the official Voha catalogue with 104 listings, plans, areas, floors and prices captured on 30 August 2026.', ogTitle: 'Choose an apartment — Voha' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/voha/apartments`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.description, images: [`${appBasePath}/voha/images/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.description, images: [`${appBasePath}/voha/images/hero.webp`] } };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const data = publicClientPayload(snapshot) as Parameters<typeof VohaCatalog>[0]['snapshot'];
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Квартиры Voha', numberOfItems: data.units.length, dateModified: data.capturedAt,
    itemListElement: data.units.slice(0, 12).map((unit, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Apartment', name: `Квартира №${unit.number}, ${unit.rooms} комн.`, floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, numberOfRooms: unit.rooms } })),
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} /><VohaCatalog snapshot={data} initialLanguage={language} /></>;
}
