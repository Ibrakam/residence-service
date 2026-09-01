import type { Metadata } from 'next';
import catalogSnapshot from '@/data/flagman-catalog.json';
import { FlagmanCatalogPage, type FlagmanCatalogSnapshot } from './flagman-catalog-page';
import './flagman-catalog.css';

const snapshot = catalogSnapshot as FlagmanCatalogSnapshot;
const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: 'Квартиры Flagman Tashkent — официальный snapshot', description: 'Актуальные предложения Flagman Tashkent: реальные планировки, площади, этажи и цены из официального каталога.', ogTitle: 'Квартиры Flagman Tashkent' },
  uz: { title: 'Flagman Tashkent xonadonlari — rasmiy snapshot', description: 'Flagman Tashkent bo‘yicha rasmiy katalogdan dolzarb takliflar, rejalar, maydonlar, qavatlar va narxlar.', ogTitle: 'Flagman Tashkent xonadonlari' },
  en: { title: 'Flagman Tashkent apartments — official snapshot', description: 'Current Flagman Tashkent listings with official plans, areas, floors and prices.', ogTitle: 'Flagman Tashkent apartments' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/flagman/apartments`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.description, images: [`${appBasePath}/flagman/images/building-aerial.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.description, images: [`${appBasePath}/flagman/images/building-aerial.webp`] } };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Квартиры Flagman Tashkent',
    dateModified: snapshot.capturedAt,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: snapshot.units.length,
      itemListElement: snapshot.units.map((unit, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Apartment',
          name: `Квартира №${unit.number} в Flagman Tashkent`,
          numberOfRooms: unit.rooms,
          floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' },
          floorLevel: unit.floor,
          image: `https://form.tencorp.uz${appBasePath}${unit.plan}`,
          offers: { '@type': 'Offer', price: unit.price, priceCurrency: unit.currency, availability: 'https://schema.org/InStock' },
        },
      })),
    },
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><FlagmanCatalogPage snapshot={snapshot} initialLanguage={language} /></>;
}
