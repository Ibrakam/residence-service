import type { Metadata } from 'next';
import { headers } from 'next/headers';
import snapshot from '@/data/jomiy-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { JomiyCatalog } from './jomiy-catalog';
import './jomiy-catalog.css';
import '../jomiy-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: {
    title: 'Квартиры Jomiy — актуальный каталог',
    description: 'Актуальный каталог Jomiy: цены, статусы и состав предложений обновляются автоматически.',
    listName: 'Jomiy — актуальный квартирный каталог', imageAlt: 'Реальная фотография готовой части Jomiy', home: 'Главная', apartments: 'Квартиры',
    apartment: (rooms: number, number: string) => `${rooms}-комнатная позиция №${number}`, group: 'Группа / очередь', entrance: 'Подъезд', completion: 'Срок', status: 'Статус', sale: 'В продаже', canBuy: 'Доступно для заявки', campaignDeadline: 'Срок кампании', finishing: 'Отделка', withoutFinishing: 'Без отделки',
  },
  uz: {
    title: 'Jomiy xonadonlari — yangilanadigan katalog',
    description: 'Jomiy xonadonlarining narxlari, holatlari va takliflari avtomatik yangilanadi.',
    listName: 'Jomiy — yangilanadigan xonadon katalogi', imageAlt: 'Jomiyning tayyor qismi haqiqiy fotosurati', home: 'Bosh sahifa', apartments: 'Xonadonlar',
    apartment: (rooms: number, number: string) => `№${number}, ${rooms} xonali pozitsiya`, group: 'Guruh / bosqich', entrance: 'Kirish', completion: 'Muddat', status: 'Holat', sale: 'Sotuvda', canBuy: 'Ariza uchun mavjud', campaignDeadline: 'Kampaniya muddati', finishing: 'Pardoz', withoutFinishing: 'Pardozsiz',
  },
  en: {
    title: 'Jomiy apartments — live catalogue',
    description: 'Jomiy listings, prices and statuses update automatically.',
    listName: 'Jomiy — live apartment catalogue', imageAlt: 'Actual photograph of the completed part of Jomiy', home: 'Home', apartments: 'Apartments',
    apartment: (rooms: number, number: string) => `${rooms}-room entry no. ${number}`, group: 'Group / phase', entrance: 'Entrance', completion: 'Completion', status: 'Status', sale: 'For sale', canBuy: 'Available to enquire', campaignDeadline: 'Campaign deadline', finishing: 'Finishing', withoutFinishing: 'No finishing',
  },
} as const;

function languageOf(value?: string): Language { return value === 'uz' || value === 'en' ? value : 'ru'; }
function languageTag(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en'; }
function locale(language: Language) { return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US'; }
function canonicalPath(language: Language) { return sitePath(`/jomiy/apartments?lang=${language}`); }
function projectPath(language: Language) { return sitePath(`/jomiy?lang=${language}`); }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/jomiy/images/hero-real.webp');
  return {
    title: current.title,
    description: current.description,
    alternates: { canonical, languages: { 'ru-RU': canonicalPath('ru'), 'uz-UZ': canonicalPath('uz'), en: canonicalPath('en'), 'x-default': canonicalPath('ru') } },
    openGraph: { title: current.title, description: current.description, type: 'website', url: canonical, siteName: 'Jomiy', locale: locale(language), images: [{ url: image, alt: current.imageAlt }] },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const evaluationHeader = (await headers()).get('x-jomiy-evaluation-time');
  const parsedEvaluationTime = Number(evaluationHeader);
  const initialEvaluationTime = Number.isFinite(parsedEvaluationTime) && parsedEvaluationTime > 0 ? parsedEvaluationTime : Number.MAX_SAFE_INTEGER;
  const current = copy[language];
  const inLanguage = languageTag(language);
  const catalogUrl = `${publicOrigin}${canonicalPath(language)}`;
  const projectUrl = `${publicOrigin}${projectPath(language)}`;
  const projectId = `${projectUrl}#project`;
  const itemList = {
    '@type': 'ItemList', '@id': `${catalogUrl}#catalogue`, name: current.listName, description: current.description, inLanguage, url: catalogUrl,
    numberOfItems: snapshot.units.length, itemListOrder: 'https://schema.org/ItemListOrderAscending', dateModified: snapshot.capturedAt,
    itemListElement: snapshot.units.map((unit, index) => ({
      '@type': 'ListItem', position: index + 1,
      item: {
        '@type': 'Apartment', '@id': `${catalogUrl}#apartment-${unit.id}`, inLanguage, identifier: unit.id, name: current.apartment(unit.rooms, unit.number), image: absoluteUrl(unit.thumbnail),
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, numberOfRooms: unit.rooms, floorLevel: unit.floor, containedInPlace: { '@id': projectId },
        additionalProperty: [
          { '@type': 'PropertyValue', name: current.group, value: unit.buildingDisplay },
          { '@type': 'PropertyValue', name: current.entrance, value: unit.entrance },
          { '@type': 'PropertyValue', name: current.completion, value: unit.completionDate },
          { '@type': 'PropertyValue', name: current.status, value: unit.statusOriginal },
          { '@type': 'PropertyValue', name: current.sale, value: unit.isSale },
          { '@type': 'PropertyValue', name: current.canBuy, value: unit.canBuy },
          { '@type': 'PropertyValue', name: current.campaignDeadline, value: unit.promotion?.deadlineUtc ?? 'none' },
          { '@type': 'PropertyValue', name: current.finishing, value: current.withoutFinishing },
        ],
      },
    })),
  };
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      itemList,
      { '@type': 'ApartmentComplex', '@id': projectId, name: 'Jomiy', description: current.description, inLanguage, url: projectUrl, image: absoluteUrl('/jomiy/images/hero-real.webp'), additionalProperty: [{ '@type': 'PropertyValue', name: 'Developer', value: 'NRG-BI' }, { '@type': 'PropertyValue', name: 'Class', value: 'Business' }] },
      { '@type': 'BreadcrumbList', inLanguage, itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` }, { '@type': 'ListItem', position: 2, name: 'Jomiy', item: projectUrl }, { '@type': 'ListItem', position: 3, name: current.apartments, item: catalogUrl }] },
    ],
  };
  if (snapshot.offerCount !== 0 || snapshot.units.some((unit) => unit.strictOfferEligible)) throw new Error('Jomiy strict Offer policy changed; review JSON-LD eligibility before publishing');

  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <JomiyCatalog snapshot={publicClientPayload(snapshot) as unknown as Parameters<typeof JomiyCatalog>[0]['snapshot']} initialLanguage={language} initialEvaluationTime={initialEvaluationTime} />
  </>;
}
