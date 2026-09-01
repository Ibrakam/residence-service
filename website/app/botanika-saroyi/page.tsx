import type { Metadata } from 'next';
import { BotanikaSaroyiPage } from './botanika-saroyi-page';
import './botanika-saroyi.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const meta = {
  ru: {
    title: 'Botanika Saroyi — живой атлас дома в Ташкенте',
    description: 'Жилой комплекс бизнес-класса рядом с Ботаническим садом: реальные фотографии, архитектура, двор, озеленение и официальный каталог квартир.',
  },
  uz: {
    title: 'Botanika Saroyi — Toshkentdagi uyning jonli atlasi',
    description: 'Botanika bog‘i yonidagi biznes-klass turar joy majmuasi: haqiqiy suratlar, arxitektura, hovli, ko‘kalamzor va rasmiy xonadonlar katalogi.',
  },
  en: {
    title: 'Botanika Saroyi — a living atlas of home in Tashkent',
    description: 'A business-class residential project by the Botanical Garden: actual photography, architecture, courtyard, landscaping and the official apartment catalogue.',
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const route = `${appBasePath}/botanika-saroyi`;
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
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [`${appBasePath}/botanika-saroyi/images/hero.webp`] },
  };
}

const structuredCopy = {
  ru: {
    address: 'Мирзо-Улугбекский район, рядом с Ботаническим садом',
    city: 'Ташкент',
    properties: [
      ['Класс', 'Бизнес'],
      ['Этажность', '16 этажей'],
      ['Высота потолков', 'Не менее 3 м'],
      ['Озеленение', 'Более 45% территории'],
      ['Ближайшая сдача', 'IV квартал 2026'],
    ],
  },
  uz: {
    address: 'Mirzo Ulug‘bek tumani, Botanika bog‘i yonida',
    city: 'Toshkent',
    properties: [
      ['Toifa', 'Biznes'],
      ['Qavatlar soni', '16 qavat'],
      ['Shift balandligi', 'Kamida 3 m'],
      ['Ko‘kalamzorlashtirish', 'Hududning 45% dan ortig‘i'],
      ['Eng yaqin topshirish muddati', '2026-yil IV choragi'],
    ],
  },
  en: {
    address: 'Mirzo Ulugbek District, by the Botanical Garden',
    city: 'Tashkent',
    properties: [
      ['Class', 'Business'],
      ['Storeys', '16 storeys'],
      ['Ceiling height', 'At least 3 m'],
      ['Landscaping', 'More than 45% of the grounds'],
      ['Nearest completion', 'Q4 2026'],
    ],
  },
} as const;

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const localized = structuredCopy[language];
  const canonical = `${appBasePath}/botanika-saroyi?lang=${language}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: 'Botanika Saroyi',
    description: current.description,
    inLanguage: language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en',
    url: `https://form.tencorp.uz${canonical}`,
    image: `https://form.tencorp.uz${appBasePath}/botanika-saroyi/images/hero.webp`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: localized.address,
      addressLocality: localized.city,
      addressCountry: 'UZ',
    },
    geo: { '@type': 'GeoCoordinates', latitude: 41.349876, longitude: 69.330564 },
    brand: { '@type': 'Organization', name: 'NRG-BI' },
    additionalProperty: localized.properties.map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <BotanikaSaroyiPage initialLanguage={language} />
    </>
  );
}
