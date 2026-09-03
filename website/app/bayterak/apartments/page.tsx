import type { Metadata } from 'next';
import snapshot from '@/data/bayterak-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { BayterakCatalog } from './bayterak-catalog';
import './bayterak-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const publicOrigin = 'https://form.tencorp.uz';
const ogImage = `${appBasePath}/bayterak/images/hero-comfort.webp`;

const meta = {
  ru: {
    title: 'Квартиры Bayterak — актуальный каталог',
    description: 'Актуальный каталог квартир Bayterak классов Comfort+ и Business: цены и статусы обновляются автоматически.',
    listName: 'Квартиры Bayterak — актуальный каталог',
  },
  uz: {
    title: 'Bayterak xonadonlari — yangilanadigan katalog',
    description: 'Bayterak katalogidagi Comfort+ va Business xonadonlarining narx va holatlari avtomatik yangilanadi.',
    listName: 'Bayterak xonadonlari — yangilanadigan katalog',
  },
  en: {
    title: 'Bayterak apartments — live catalogue',
    description: 'The Bayterak catalogue contains Comfort+ and Business apartments with automatically updated prices and statuses.',
    listName: 'Bayterak apartments — live catalogue',
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
  const current = meta[language];
  const canonical = canonicalPath(language);
  const title = current.title;
  const description = current.description;

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
  const data = publicClientPayload(snapshot) as Parameters<typeof BayterakCatalog>[0]['snapshot'];
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
    description: current.description,
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
