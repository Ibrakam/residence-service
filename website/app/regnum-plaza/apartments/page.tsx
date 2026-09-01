import type { Metadata } from 'next';
import catalog from '@/data/regnum-plaza-client.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { RegnumCatalog } from './regnum-catalog';
import './regnum-catalog.css';
import '../regnum-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: { title: 'Квартиры Regnum Plaza — 12 текущих предложений', description: 'Официальный квартирный срез Regnum Plaza на 31 августа 2026: 12 доступных предложений, 1–4 комнаты, 38,48–249,27 м². Публичная цена — по запросу.', list: 'Regnum Plaza — текущие квартиры', home: 'Главная', apartments: 'Квартиры', unit: (rooms: number, number: string) => `${rooms}-комнатная квартира №${number}`, queue: (value: number) => `${value}-я очередь`, queueName: 'Очередь', sectionName: 'Секция', completionName: 'Срок', completion: (value: string) => `${value} год`, statusName: 'Статус', available: 'Доступна', price: 'Публичная цена', priceValue: 'По запросу' },
  uz: { title: 'Regnum Plaza xonadonlari — 12 ta joriy taklif', description: 'Regnum Plazaning 2026-yil 31-avgustdagi rasmiy kesimi: 12 ta mavjud taklif, 1–4 xona, 38,48–249,27 m². Ommaviy narx — so‘rov bo‘yicha.', list: 'Regnum Plaza — joriy xonadonlar', home: 'Bosh sahifa', apartments: 'Xonadonlar', unit: (rooms: number, number: string) => `№${number}, ${rooms} xonali xonadon`, queue: (value: number) => `${value}-bosqich`, queueName: 'Bosqich', sectionName: 'Seksiya', completionName: 'Muddat', completion: (value: string) => `${value}-yil`, statusName: 'Holat', available: 'Mavjud', price: 'Ommaviy narx', priceValue: 'So‘rov bo‘yicha' },
  en: { title: 'Regnum Plaza apartments — 12 current listings', description: 'Official Regnum Plaza snapshot captured 31 August 2026: 12 available listings, 1–4 rooms and 38.48–249.27 m². Public price is on request.', list: 'Regnum Plaza — current apartments', home: 'Home', apartments: 'Apartments', unit: (rooms: number, number: string) => `${rooms}-room apartment no. ${number}`, queue: (value: number) => `Phase ${value}`, queueName: 'Phase', sectionName: 'Section', completionName: 'Completion', completion: (value: string) => value, statusName: 'Status', available: 'Available', price: 'Public price', priceValue: 'Price on request' },
} as const;

function languageOf(value?: string): Language { return value === 'uz' || value === 'en' ? value : 'ru'; }
function languageTag(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en'; }
function locale(language: Language) { return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US'; }
function canonicalPath(language: Language) { return sitePath(`/regnum-plaza/apartments?lang=${language}`); }
function projectPath(language: Language) { return sitePath(`/regnum-plaza?lang=${language}`); }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/regnum-plaza/images/hero.webp');
  return {
    title: current.title, description: current.description,
    alternates: { canonical, languages: { 'ru-RU': canonicalPath('ru'), 'uz-UZ': canonicalPath('uz'), en: canonicalPath('en'), 'x-default': canonicalPath('ru') } },
    openGraph: { title: current.title, description: current.description, type: 'website', url: canonical, siteName: 'Regnum Plaza', locale: locale(language), images: [{ url: image, width: 1920, height: 873, alt: 'Regnum Plaza' }] },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const inLanguage = languageTag(language);
  const catalogUrl = `${publicOrigin}${canonicalPath(language)}`;
  const projectUrl = `${publicOrigin}${projectPath(language)}`;
  const itemList = {
    '@type': 'ItemList', '@id': `${catalogUrl}#catalogue`, name: current.list, description: current.description, inLanguage, url: catalogUrl,
    numberOfItems: catalog.units.length, itemListOrder: 'https://schema.org/ItemListOrderAscending', dateModified: catalog.capturedAt,
    itemListElement: catalog.units.map((unit, index) => ({
      '@type': 'ListItem', position: index + 1,
      item: {
        '@type': 'Apartment', '@id': `${catalogUrl}#apartment-${unit.id}`, identifier: unit.id, name: current.unit(unit.rooms, unit.number), inLanguage,
        ...(unit.planPublicPath ? { image: absoluteUrl(unit.planPublicPath) } : {}),
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, numberOfRooms: unit.rooms, floorLevel: unit.floor,
        containedInPlace: { '@id': `${projectUrl}#project` },
        additionalProperty: [
          [current.queueName, current.queue(unit.queue)], [current.sectionName, String(unit.section)], [current.completionName, current.completion(unit.completion)], [current.statusName, current.available], [current.price, current.priceValue],
        ].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
      },
    })),
  };
  const structuredData = {
    '@context': 'https://schema.org', '@graph': [
      itemList,
      { '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'Regnum Plaza', url: projectUrl, image: absoluteUrl('/regnum-plaza/images/hero.webp'), inLanguage },
      { '@type': 'BreadcrumbList', inLanguage, itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` }, { '@type': 'ListItem', position: 2, name: 'Regnum Plaza', item: projectUrl }, { '@type': 'ListItem', position: 3, name: current.apartments, item: catalogUrl }] },
    ],
  };
  if (catalog.offerCount !== 0 || catalog.publicPrice || catalog.units.some((unit) => unit.publicPrice)) throw new Error('Regnum Plaza public-price / JSON-LD Offer policy changed');
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <RegnumCatalog snapshot={publicClientPayload(catalog)} initialLanguage={language} />
  </>;
}
