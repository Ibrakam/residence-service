import type { Metadata } from 'next';
import snapshot from '@/data/botanika-saroyi-catalog.json';
import { BotanikaCatalog } from './botanika-catalog';
import './botanika-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const meta = {
  ru: {
    title: 'Квартиры Botanika Saroyi — 224 официальных предложения',
    description: 'Официальный snapshot Botanika Saroyi от 30.08.2026: 224 планировки и предложения квартир с площадями, этажами, сроками и ценами.',
    listName: 'Квартиры Botanika Saroyi — официальный snapshot',
  },
  uz: {
    title: 'Botanika Saroyi xonadonlari — 224 ta rasmiy taklif',
    description: 'Botanika Saroyi rasmiy katalogining 2026-yil 30-avgustdagi snapshoti: maydonlari, qavatlari, topshirish muddatlari va narxlari ko‘rsatilgan 224 ta xonadon rejasi va taklifi.',
    listName: 'Botanika Saroyi xonadonlari — rasmiy snapshot',
  },
  en: {
    title: 'Botanika Saroyi apartments — 224 official listings',
    description: 'The official Botanika Saroyi snapshot captured on 30 August 2026: 224 apartment plans and listings with areas, floors, completion dates and prices.',
    listName: 'Botanika Saroyi apartments — official snapshot',
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const route = `${appBasePath}/botanika-saroyi/apartments`;
  const canonical = `${route}?lang=${language}`;

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
      images: [`${appBasePath}/botanika-saroyi/images/hero.webp`],
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title: current.title,
      description: current.description,
      images: [`${appBasePath}/botanika-saroyi/images/hero.webp`],
    },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const data = snapshot as Parameters<typeof BotanikaCatalog>[0]['snapshot'];
  const current = meta[language];
  const canonical = `${appBasePath}/botanika-saroyi/apartments?lang=${language}`;
  const roomName = (rooms: number) => language === 'ru'
    ? `${rooms}-комнатная квартира`
    : language === 'uz'
      ? `${rooms} xonali xonadon`
      : `${rooms}-room apartment`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: current.listName,
    description: current.description,
    inLanguage: language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en',
    url: `https://form.tencorp.uz${canonical}`,
    numberOfItems: data.units.length,
    dateModified: data.capturedAt,
    itemListElement: data.units.slice(0, 12).map((unit, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      item: {
        '@type': 'Apartment',
        identifier: unit.id,
        name: language === 'uz'
          ? `№${unit.number} ${roomName(unit.rooms)}`
          : `${roomName(unit.rooms)} №${unit.number}`,
        image: `https://form.tencorp.uz${appBasePath}${unit.plan}`,
        floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' },
        numberOfRooms: unit.rooms,
        floorLevel: unit.floor,
        offers: {
          '@type': 'Offer',
          price: unit.price,
          priceCurrency: unit.currency,
        },
      },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }} />
      <BotanikaCatalog snapshot={data} initialLanguage={language} />
    </>
  );
}
