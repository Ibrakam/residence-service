import type { Metadata } from 'next';
import { BayterakPage } from './bayterak-page';
import './bayterak.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const meta = {
  ru: {
    title: 'Bayterak — Comfort+ и Business в Новом Ташкенте',
    description: 'Bayterak от NRG-BI в Новом Ташкенте: классы Comfort+ и Business, дома 9, 12 и 16 этажей, потолки 3 м, закрытые дворы и официальный каталог квартир.',
    location: 'Новый Ташкент',
    properties: [
      ['Классы', 'Comfort+ и Business'],
      ['Этажность', '9, 12 и 16 этажей'],
      ['Высота потолков', '3 м'],
      ['Коммерческие помещения', 'Потолки 4 м'],
      ['Срок всего комплекса по генплану', '2030'],
    ],
  },
  uz: {
    title: 'Bayterak — Yangi Toshkentdagi Comfort+ va Business',
    description: 'NRG-BI kompaniyasining Yangi Toshkentdagi Bayterak loyihasi: Comfort+ va Business klasslari, 9, 12 va 16 qavatli uylar, 3 m shiftlar, yopiq hovlilar va rasmiy xonadonlar katalogi.',
    location: 'Yangi Toshkent',
    properties: [
      ['Klasslar', 'Comfort+ va Business'],
      ['Qavatlar soni', '9, 12 va 16 qavat'],
      ['Shift balandligi', '3 m'],
      ['Tijorat xonalari', '4 m shift'],
      ['Bosh reja bo‘yicha butun majmua muddati', '2030'],
    ],
  },
  en: {
    title: 'Bayterak — Comfort+ and Business in New Tashkent',
    description: 'Bayterak by NRG-BI in New Tashkent: Comfort+ and Business homes in 9, 12 and 16-storey buildings, 3 m ceilings, private courtyards and the official apartment catalogue.',
    location: 'New Tashkent',
    properties: [
      ['Classes', 'Comfort+ and Business'],
      ['Storeys', '9, 12 and 16'],
      ['Ceiling height', '3 m'],
      ['Commercial premises', '4 m ceilings'],
      ['Whole-complex date shown on the masterplan', '2030'],
    ],
  },
} as const;

function getLanguage(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

function locale(language: Language) {
  return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US';
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const route = `${appBasePath}/bayterak`;
  const canonical = `${route}?lang=${language}`;
  const image = `${appBasePath}/bayterak/images/hero-comfort.webp`;

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
      url: canonical,
      type: 'website',
      locale: locale(language),
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title: current.title,
      description: current.description,
      images: [image],
    },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = getLanguage((await searchParams)?.lang);
  const current = meta[language];
  const canonical = `${appBasePath}/bayterak?lang=${language}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: 'Bayterak',
    description: current.description,
    inLanguage: language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en',
    url: `https://form.tencorp.uz${canonical}`,
    image: `https://form.tencorp.uz${appBasePath}/bayterak/images/hero-comfort.webp`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: current.location,
      addressCountry: 'UZ',
    },
    brand: { '@type': 'Organization', name: 'NRG-BI' },
    additionalProperty: current.properties.map(([name, value]) => ({
      '@type': 'PropertyValue',
      name,
      value,
    })),
    sameAs: ['https://uzbekistan360.uz/ru/location/nrg-bi-bayterakHcY'],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <BayterakPage initialLanguage={language} />
    </>
  );
}
