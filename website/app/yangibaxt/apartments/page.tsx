import type { Metadata } from 'next';
import snapshot from '@/data/yangibaxt-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { YangiBaxtCatalog } from './yangibaxt-catalog';
import './yangibaxt-catalog.css';
import '../yangibaxt-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: {
    title: (count: number) => `Квартиры Yangi Baxt — каталог на 30 августа 2026 · ${count} записей`,
    description: (count: number, offers: number) => `Каталог квартир Yangi Baxt на 30 августа 2026: ${count} записей с официальными планами, зафиксированными ценами, этажами и сроками; ${offers} отмечены свободными и выставленными на продажу.`,
    listName: 'Квартиры Yangi Baxt — каталог на 30 августа 2026',
    imageAlt: 'Реальная официальная фотография благоустройства Yangi Baxt',
    home: 'Главная',
    apartments: 'Квартиры',
    apartment: (rooms: number, number: string) => `${rooms}-комнатная квартира №${number}`,
    group: 'Группа каталога',
    entrance: 'Подъезд',
    completion: 'Срок',
    finishing: 'Отделка',
    withFinishing: 'С ремонтом',
    withoutFinishing: 'Без ремонта',
    offerNote: 'Цена и доступность зафиксированы в API 30 августа 2026 года; актуальные условия подтверждает отдел продаж.',
    address: { streetAddress: 'Ахангаранский проспект', addressLocality: 'Ташкент' },
  },
  uz: {
    title: (count: number) => `Yangi Baxt xonadonlari — 2026-yil 30-avgust katalogi · ${count} ta yozuv`,
    description: (count: number, offers: number) => `Yangi Baxtning 2026-yil 30-avgustdagi xonadonlar katalogi: rasmiy rejalar, qayd etilgan narxlar, qavatlar va muddatlar bilan ${count} ta yozuv; ${offers} tasi bo‘sh va sotuvda deb belgilangan.`,
    listName: 'Yangi Baxt xonadonlari — 2026-yil 30-avgust katalogi',
    imageAlt: 'Yangi Baxt obodonlashtirilishining haqiqiy rasmiy fotosurati',
    home: 'Bosh sahifa',
    apartments: 'Xonadonlar',
    apartment: (rooms: number, number: string) => `№${number}, ${rooms} xonali xonadon`,
    group: 'Katalog guruhi',
    entrance: 'Kirish',
    completion: 'Muddat',
    finishing: 'Pardoz',
    withFinishing: 'Pardoz bilan',
    withoutFinishing: 'Pardozsiz',
    offerNote: 'Narx va mavjudlik 2026-yil 30-avgustdagi API snapshotida qayd etilgan; amaldagi shartlarni savdo bo‘limi tasdiqlaydi.',
    address: { streetAddress: 'Ohangaron prospekti', addressLocality: 'Toshkent' },
  },
  en: {
    title: (count: number) => `Yangi Baxt apartments — catalogue as of 30 August 2026 · ${count} entries`,
    description: (count: number, offers: number) => `The Yangi Baxt apartment catalogue as of 30 August 2026: ${count} entries with official plans, recorded prices, floors and completion dates; ${offers} are marked available and for sale.`,
    listName: 'Yangi Baxt apartments — catalogue as of 30 August 2026',
    imageAlt: 'Actual official photograph of landscaping at Yangi Baxt',
    home: 'Home',
    apartments: 'Apartments',
    apartment: (rooms: number, number: string) => `${rooms}-room apartment no. ${number}`,
    group: 'Catalogue group',
    entrance: 'Entrance',
    completion: 'Completion',
    finishing: 'Finishing',
    withFinishing: 'With finishing',
    withoutFinishing: 'Without finishing',
    offerNote: 'Price and availability are an API snapshot dated 30 August 2026; the sales team confirms current terms.',
    address: { streetAddress: 'Akhangaran Avenue', addressLocality: 'Tashkent' },
  },
} as const;

function languageOf(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

function languageTag(language: Language) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
}

function locale(language: Language) {
  return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US';
}

function canonicalPath(language: Language) {
  return sitePath(`/yangibaxt/apartments?lang=${language}`);
}

function projectPath(language: Language) {
  return sitePath(`/yangibaxt?lang=${language}`);
}

const offerCount = snapshot.units.filter((unit) => unit.statusOriginal === 'Свободно' && unit.isSale).length;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const count = snapshot.units.length;
  const title = current.title(count);
  const description = current.description(count, offerCount);
  const canonical = canonicalPath(language);
  const image = sitePath('/yangibaxt/images/hero-real.webp');

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        'ru-RU': canonicalPath('ru'),
        'uz-UZ': canonicalPath('uz'),
        en: canonicalPath('en'),
        'x-default': canonicalPath('ru'),
      },
    },
    openGraph: {
      title,
      description,
      type: 'website',
      url: canonical,
      siteName: 'Yangi Baxt',
      locale: locale(language),
      images: [{ url: image, alt: current.imageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const inLanguage = languageTag(language);
  const catalogUrl = `${publicOrigin}${canonicalPath(language)}`;
  const projectUrl = `${publicOrigin}${projectPath(language)}`;
  const projectId = `${projectUrl}#project`;
  const itemList = {
    '@type': 'ItemList',
    '@id': `${catalogUrl}#catalogue`,
    name: current.listName,
    description: current.description(snapshot.units.length, offerCount),
    inLanguage,
    url: catalogUrl,
    numberOfItems: snapshot.units.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    dateModified: snapshot.capturedAt,
    itemListElement: snapshot.units.map((unit, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Apartment',
        '@id': `${catalogUrl}#apartment-${unit.id}`,
        inLanguage,
        identifier: unit.id,
        name: current.apartment(unit.rooms, unit.number),
        image: `${publicOrigin}${sitePath(unit.plan)}`,
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' },
        numberOfRooms: unit.rooms,
        floorLevel: unit.floor,
        containedInPlace: { '@id': projectId },
        additionalProperty: [
          { '@type': 'PropertyValue', name: current.group, value: unit.buildingDisplay },
          { '@type': 'PropertyValue', name: current.entrance, value: unit.entrance },
          { '@type': 'PropertyValue', name: current.completion, value: unit.completionDate },
          { '@type': 'PropertyValue', name: current.finishing, value: unit.repairIncluded ? current.withFinishing : current.withoutFinishing },
        ],
        ...(unit.statusOriginal === 'Свободно' && unit.isSale ? {
          offers: {
            '@type': 'Offer',
            price: unit.price,
            priceCurrency: unit.currency,
            priceValidUntil: unit.promotion?.deadlineUtc,
            availability: 'https://schema.org/InStock',
            description: current.offerNote,
            seller: { '@type': 'Organization', name: 'NRG-BI' },
          },
        } : {}),
      },
    })),
  };
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      itemList,
      {
        '@type': 'ApartmentComplex',
        '@id': projectId,
        name: 'Yangi Baxt',
        inLanguage,
        url: projectUrl,
        image: absoluteUrl('/yangibaxt/images/hero-real.webp'),
        address: {
          '@type': 'PostalAddress',
          ...current.address,
          addressCountry: 'UZ',
        },
      },
      {
        '@type': 'BreadcrumbList',
        inLanguage,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: current.home,
            item: `${publicOrigin}${sitePath('/')}`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Yangi Baxt',
            item: projectUrl,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: current.apartments,
            item: catalogUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <YangiBaxtCatalog snapshot={publicClientPayload(snapshot) as unknown as Parameters<typeof YangiBaxtCatalog>[0]['snapshot']} initialLanguage={language} />
    </>
  );
}
