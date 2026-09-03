import type { Metadata } from 'next';
import snapshot from '@/data/zamon-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
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
    title: 'Квартиры Zamon — актуальный каталог',
    description: 'Актуальный каталог Zamon с планировками, ценами, этажами, сроками и автоматически обновляемыми статусами.',
    listName: 'Квартиры Zamon — актуальный каталог',
    apartment: (rooms: number, number: string) => `${rooms}-комнатная квартира №${number}`,
    imageAlt: 'Реальная фотография сданной I очереди Zamon',
  },
  uz: {
    title: 'Zamon xonadonlari — yangilanadigan katalog',
    description: 'Zamon katalogidagi rejalar, narxlar, qavatlar, muddatlar va holatlar avtomatik yangilanadi.',
    listName: 'Zamon xonadonlari — yangilanadigan katalog',
    apartment: (rooms: number, number: string) => `${rooms} xonali №${number} xonadon`,
    imageAlt: 'Zamon topshirilgan I bosqichining haqiqiy fotosurati',
  },
  en: {
    title: 'Zamon apartments — live catalogue',
    description: 'The Zamon catalogue has automatically updated plans, prices, floors, completion dates and statuses.',
    listName: 'Zamon apartments — live catalogue',
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
  const current = meta[language];
  const title = current.title;
  const description = current.description;
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
  const data = publicClientPayload(snapshot) as unknown as ZamonSnapshot;
  const current = meta[language];
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: current.listName,
    description: current.description,
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
