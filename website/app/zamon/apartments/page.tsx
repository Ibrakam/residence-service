import type { Metadata } from 'next';
import snapshot from '@/data/zamon-catalog.json';
import { ZamonCatalog, type ZamonSnapshot } from './zamon-catalog';
import './zamon-catalog.css';
import '../zamon-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const normalizedBasePath = appBasePath ? `/${appBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const ogImage = `${normalizedBasePath}/zamon/images/hero-phase-one.webp`;

const meta = {
  ru: {
    title: (count: number) => `Квартиры Zamon — каталог на 30 августа 2026 · ${count} позиций`,
    description: (count: number) => `Каталог Zamon на 30 августа 2026: ${count} позиций в блоках 2-2 и 3-1 с официальными планировками, ценами по акции, этажами, сроками и статусами источника.`,
    listName: 'Квартиры Zamon — каталог на 30 августа 2026',
    apartment: (rooms: number, number: string) => `${rooms}-комнатная квартира №${number}`,
    imageAlt: 'Реальная фотография сданной I очереди Zamon',
  },
  uz: {
    title: (count: number) => `Zamon xonadonlari — 2026-yil 30-avgust katalogi · ${count} pozitsiya`,
    description: (count: number) => `Zamon katalogi 2026-yil 30-avgust holatiga: 2-2 va 3-1 bloklaridagi ${count} pozitsiya, rasmiy rejalar, aksiya narxlari, qavatlar, muddatlar va manbadagi holatlar bilan.`,
    listName: 'Zamon xonadonlari — 2026-yil 30-avgust katalogi',
    apartment: (rooms: number, number: string) => `${rooms} xonali №${number} xonadon`,
    imageAlt: 'Zamon topshirilgan I bosqichining haqiqiy fotosurati',
  },
  en: {
    title: (count: number) => `Zamon apartments — 30 August 2026 catalogue · ${count} entries`,
    description: (count: number) => `Zamon catalogue as of 30 August 2026: ${count} entries in blocks 2-2 and 3-1 with official plans, promotional prices, floors, completion dates and source statuses.`,
    listName: 'Zamon apartments — catalogue as of 30 August 2026',
    apartment: (rooms: number, number: string) => `${rooms}-room apartment no. ${number}`,
    imageAlt: 'Actual photograph of Zamon completed phase I',
  },
} as const;

function languageOf(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

function canonical(language: Language) {
  return `${normalizedBasePath}/zamon/apartments?lang=${language}`;
}

function languageTag(language: Language) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
}

const address = {
  ru: { streetAddress: 'ул. Таларык', addressLocality: 'Ташкент' },
  uz: { streetAddress: 'Talaryk ko‘chasi', addressLocality: 'Toshkent' },
  en: { streetAddress: 'Talaryk Street', addressLocality: 'Tashkent' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const data = snapshot as unknown as ZamonSnapshot;
  const current = meta[language];
  const title = current.title(data.officialTotalAtCapture);
  const description = current.description(data.officialTotalAtCapture);
  const url = canonical(language);
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        'ru-RU': canonical('ru'),
        'uz-UZ': canonical('uz'),
        en: canonical('en'),
        'x-default': canonical('ru'),
      },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url,
      siteName: 'Zamon',
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      images: [{ url: ogImage, alt: current.imageAlt }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  };
}

export default async function ZamonApartmentsPage({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const data = snapshot as unknown as ZamonSnapshot;
  const current = meta[language];
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: current.listName,
    description: current.description(data.officialTotalAtCapture),
    inLanguage: languageTag(language),
    url: `${publicOrigin}${canonical(language)}`,
    numberOfItems: data.units.length,
    dateModified: data.capturedAt,
    itemListElement: data.units.map((unit, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Apartment',
        inLanguage: languageTag(language),
        identifier: unit.id,
        name: current.apartment(unit.rooms, unit.number),
        image: `${publicOrigin}${normalizedBasePath}${unit.plan}`,
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' },
        numberOfRooms: unit.rooms,
        floorLevel: unit.floor,
        containedInPlace: {
          '@type': 'ApartmentComplex',
          name: 'Zamon',
          inLanguage: languageTag(language),
          address: { '@type': 'PostalAddress', ...address[language], addressCountry: 'UZ' },
        },
        ...(unit.statusOriginal === 'Свободно' && unit.isSale ? {
          offers: { '@type': 'Offer', price: unit.price, priceCurrency: unit.currency, priceValidUntil: '2026-12-31T17:59:59Z' },
        } : {}),
      },
    })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(list).replace(/</g, '\\u003c') }} />
      <ZamonCatalog snapshot={data} initialLanguage={language} />
    </>
  );
}
