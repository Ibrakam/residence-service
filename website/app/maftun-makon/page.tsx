import type { Metadata } from 'next';
import { MaftunMakonPage } from './maftun-makon-page';
import './maftun-makon.css';
import './maftun-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const meta = {
  ru: {
    title: 'Maftun Makon — город в городе в Ташкенте',
    description: 'Жилой квартал Maftun Makon от NRG-BI и AL-BINA вдоль проспекта Янги Узбекистон: Comfort, Comfort+ и Business, дома 4–7 этажей.',
  },
  uz: {
    title: 'Maftun Makon — Toshkentdagi shahar ichida shahar',
    description: 'NRG-BI va AL-BINA kompaniyalarining Yangi O‘zbekiston ko‘chasi bo‘ylab joylashgan Maftun Makon turar joy mavzesi: Comfort, Comfort+ va Business.',
  },
  en: {
    title: 'Maftun Makon — a city within a city in Tashkent',
    description: 'Maftun Makon by NRG-BI and AL-BINA along Yangi O‘zbekiston Street: Comfort, Comfort+ and Business homes in 4–7-storey buildings.',
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const route = `${appBasePath}/maftun-makon`;
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
      images: [`${appBasePath}/maftun-makon/images/hero-night.webp`],
      locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US',
      type: 'website',
      url: canonical,
    },
    twitter: {
      card: 'summary_large_image',
      title: current.title,
      description: current.description,
      images: [`${appBasePath}/maftun-makon/images/hero-night.webp`],
    },
  };
}

const structuredCopy = {
  ru: {
    street: 'проспект Янги Узбекистон',
    city: 'Ташкент',
    properties: [['Классы жилья', 'Comfort, Comfort+, Business'], ['Этажность', '4–7 этажей'], ['Ближайшая сдача', 'IV квартал 2026'], ['Озеленение', 'Не менее 44% территории']],
  },
  uz: {
    street: 'Yangi O‘zbekiston ko‘chasi',
    city: 'Toshkent',
    properties: [['Uy-joy sinflari', 'Comfort, Comfort+, Business'], ['Qavatlar soni', '4–7 qavat'], ['Eng yaqin topshirish muddati', '2026-yil IV choragi'], ['Ko‘kalamzorlashtirish', 'Hududning kamida 44%']],
  },
  en: {
    street: 'Yangi O‘zbekiston Street',
    city: 'Tashkent',
    properties: [['Housing classes', 'Comfort, Comfort+, Business'], ['Storeys', '4–7 storeys'], ['Nearest completion', 'Q4 2026'], ['Landscaping', 'At least 44% of the grounds']],
  },
} as const;

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const localized = structuredCopy[language];
  const route = `${appBasePath}/maftun-makon`;
  const canonical = language === 'ru' ? route : `${route}?lang=${language}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: 'Maftun Makon',
    description: current.description,
    inLanguage: language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en',
    url: `https://form.tencorp.uz${canonical}`,
    image: `https://form.tencorp.uz${appBasePath}/maftun-makon/images/hero-night.webp`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: localized.street,
      addressLocality: localized.city,
      addressCountry: 'UZ',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 41.32503, longitude: 69.413306 },
    brand: { '@type': 'Organization', name: 'NRG-BI + AL-BINA' },
    additionalProperty: localized.properties.map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <MaftunMakonPage initialLanguage={language} />
    </>
  );
}
