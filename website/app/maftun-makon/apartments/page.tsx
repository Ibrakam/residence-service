import type { Metadata } from 'next';
import snapshot from '@/data/maftun-makon-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { MaftunMakonCatalog } from './maftun-makon-catalog';
import './maftun-makon-catalog.css';
import '../maftun-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const meta = {
  ru: {
    title: 'Квартиры в Maftun Makon — актуальный каталог',
    description: 'Квартиры Maftun Makon: площади, этажи, цены, планировки и статусы обновляются автоматически.',
  },
  uz: {
    title: 'Maftun Makon xonadonlari — yangilanadigan katalog',
    description: 'Maftun Makon xonadonlarining maydoni, qavati, narxi, rejasi va holati avtomatik yangilanadi.',
  },
  en: {
    title: 'Maftun Makon apartments — live catalogue',
    description: 'Maftun Makon apartment areas, floors, prices, plans and statuses update automatically.',
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const route = `${appBasePath}/maftun-makon/apartments`;
  const canonical = language === 'ru' ? route : `${route}?lang=${language}`;
  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical,
      languages: {
        'ru-RU': `${route}?lang=ru`,
        'uz-UZ': `${route}?lang=uz`,
        en: `${route}?lang=en`,
      },
    },
    openGraph: {
      title: current.title,
      description: current.description,
      images: [`${appBasePath}/maftun-makon/images/architecture-day.webp`],
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      url: canonical,
    },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [`${appBasePath}/maftun-makon/images/architecture-day.webp`] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const data = publicClientPayload(snapshot) as Parameters<typeof MaftunMakonCatalog>[0]['snapshot'];
  const route = `${appBasePath}/maftun-makon/apartments`;
  const canonical = language === 'ru' ? route : `${route}?lang=${language}`;
  const listName = language === 'ru' ? 'Квартиры Maftun Makon' : language === 'uz' ? 'Maftun Makon xonadonlari' : 'Maftun Makon apartments';
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: listName,
    inLanguage: language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en',
    url: `https://form.tencorp.uz${canonical}`,
    numberOfItems: data.units.length,
    dateModified: data.capturedAt,
    itemListElement: data.units.slice(0, 12).map((unit, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Apartment',
        name: language === 'ru'
          ? `Квартира №${unit.number}, ${unit.rooms} комн.`
          : language === 'uz'
            ? `№${unit.number} xonadon, ${unit.rooms} xonali`
            : `Apartment No. ${unit.number}, ${unit.rooms} ${unit.rooms === 1 ? 'room' : 'rooms'}`,
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' },
        numberOfRooms: unit.rooms,
        floorLevel: unit.floor,
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <MaftunMakonCatalog snapshot={data} initialLanguage={language} />
    </>
  );
}
