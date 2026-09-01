import type { Metadata } from 'next';
import snapshot from '@/data/bayterak-catalog.json';
import { BayterakCatalog } from './bayterak-catalog';
import './bayterak-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const publicOrigin = 'https://form.tencorp.uz';
const ogImage = `${appBasePath}/bayterak/images/hero-comfort.webp`;

const meta = {
  ru: {
    title: (count: number) => `Квартиры Bayterak — ${count} предложений в официальной подборке`,
    description: (count: number) => `Датированный snapshot Bayterak: ${count} квартир Comfort+ и Business с официальными планировками, ценами, этажами, сроками и исходными workflow-статусами.`,
    listName: 'Квартиры Bayterak — официальный snapshot',
  },
  uz: {
    title: (count: number) => `Bayterak xonadonlari — rasmiy tanlovdagi ${count} ta taklif`,
    description: (count: number) => `Bayterak katalogining sanasi ko‘rsatilgan snapshoti: Comfort+ va Business toifalaridagi ${count} ta xonadon, rasmiy rejalar, narxlar, qavatlar, muddatlar va asl workflow holatlari bilan.`,
    listName: 'Bayterak xonadonlari — rasmiy snapshot',
  },
  en: {
    title: (count: number) => `Bayterak apartments — ${count} listings in the official selection`,
    description: (count: number) => `A dated Bayterak snapshot with ${count} Comfort+ and Business apartments, official floor plans, prices, floors, completion dates and source workflow states.`,
    listName: 'Bayterak apartments — official snapshot',
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

function languageTag(language: Language) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
}

function canonicalPath(language: Language) {
  return `${appBasePath}/bayterak/apartments?lang=${language}`;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const data = snapshot as Parameters<typeof BayterakCatalog>[0]['snapshot'];
  const count = data.officialTotalAtCapture || data.units.length;
  const current = meta[language];
  const canonical = canonicalPath(language);
  const title = current.title(count);
  const description = current.description(count);

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
      siteName: 'Bayterak',
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      images: [{ url: ogImage, alt: language === 'ru' ? 'Официальная визуализация Bayterak' : language === 'uz' ? 'Bayterak rasmiy vizualizatsiyasi' : 'Official Bayterak visualization' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const data = snapshot as Parameters<typeof BayterakCatalog>[0]['snapshot'];
  const count = data.officialTotalAtCapture || data.units.length;
  const current = meta[language];
  const canonical = canonicalPath(language);
  const roomName = (rooms: number) => language === 'ru'
    ? `${rooms}-комнатная квартира`
    : language === 'uz'
      ? `${rooms} xonali xonadon`
      : `${rooms}-room apartment`;

  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: current.listName,
    description: current.description(count),
    inLanguage: languageTag(language),
    url: `${publicOrigin}${canonical}`,
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
        image: `${publicOrigin}${appBasePath}${unit.plan}`,
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
      <BayterakCatalog snapshot={data} initialLanguage={language} />
    </>
  );
}
