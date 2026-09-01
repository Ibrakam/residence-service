import type { Metadata } from 'next';
import { JomiyPage } from './jomiy-page';
import './jomiy.css';
import './jomiy-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: {
    title: 'Jomiy — жилой комплекс бизнес-класса в Ташкенте',
    description: 'Jomiy от NRG-BI: сданная очередь 2.1, строящаяся финальная очередь 2.2, двор без машин и официальный каталог из 121 позиции на 30 августа 2026 года.',
    imageAlt: 'Реальная официальная фотография готовой части Jomiy',
    home: 'Главная',
    properties: [['Класс', 'Бизнес'], ['Потолки', 'Не менее 3,0 м'], ['Очередь 2.1', 'Сдана 28 января 2026'], ['Очередь 2.2', 'Строится · финальная очередь'], ['Паркинг', 'Подземный'], ['Двор', 'Без машин']] as const,
    addressProperties: [['Адрес · источник «Экосистема»', 'ул. Шимолий Олмазор, 7, Ташкент'], ['Адрес · карточки очередей 2.1 / 2.2', 'ул. Уста Ширин, 21, Ташкент']] as const,
  },
  uz: {
    title: 'Jomiy — Toshkentdagi biznes-klass turar joy majmuasi',
    description: 'NRG-BI kompaniyasining Jomiy loyihasi: topshirilgan 2.1 bosqichi, qurilayotgan yakuniy 2.2 bosqichi, avtomobillarsiz hovli va 2026-yil 30-avgustdagi 121 pozitsiyali rasmiy katalog.',
    imageAlt: 'Jomiy tayyor qismining haqiqiy rasmiy fotosurati',
    home: 'Bosh sahifa',
    properties: [['Klass', 'Biznes'], ['Shift', 'Kamida 3,0 m'], ['2.1 bosqichi', '2026-yil 28-yanvarda topshirilgan'], ['2.2 bosqichi', 'Qurilmoqda · yakuniy bosqich'], ['Parking', 'Yerosti'], ['Hovli', 'Avtomobillarsiz']] as const,
    addressProperties: [['Manzil · “Ekotizim” manbasi', 'Shimoliy Olmazor ko‘chasi, 7, Toshkent'], ['Manzil · 2.1 / 2.2 bosqich kartalari', 'Usta Shirin ko‘chasi, 21, Toshkent']] as const,
  },
  en: {
    title: 'Jomiy — a business-class residential project in Tashkent',
    description: 'Jomiy by NRG-BI: completed phase 2.1, the final phase 2.2 under construction, a car-free courtyard and an official catalogue of 121 entries as of 30 August 2026.',
    imageAlt: 'Actual official photograph of a completed part of Jomiy',
    home: 'Home',
    properties: [['Class', 'Business'], ['Ceilings', 'At least 3.0 m'], ['Phase 2.1', 'Completed 28 January 2026'], ['Phase 2.2', 'Under construction · final phase'], ['Parking', 'Underground'], ['Courtyard', 'Car-free']] as const,
    addressProperties: [['Address · Ecosystem source', '7 Shimoliy Olmazor Street, Tashkent'], ['Address · phase 2.1 / 2.2 cards', '21 Usta Shirin Street, Tashkent']] as const,
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
  return sitePath(`/jomiy?lang=${language}`);
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/jomiy/images/hero-real.webp');
  return {
    title: current.title,
    description: current.description,
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
      title: current.title,
      description: current.description,
      type: 'website',
      url: canonical,
      siteName: 'Jomiy',
      locale: locale(language),
      images: [{ url: image, alt: current.imageAlt }],
    },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const projectUrl = `${publicOrigin}${canonicalPath(language)}`;
  const inLanguage = languageTag(language);
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ApartmentComplex',
        '@id': `${projectUrl}#project`,
        name: 'Jomiy',
        description: current.description,
        inLanguage,
        url: projectUrl,
        image: absoluteUrl('/jomiy/images/hero-real.webp'),
        telephone: '1360',
        brand: { '@type': 'Organization', name: 'NRG-BI' },
        additionalProperty: [...current.properties, ...current.addressProperties].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
        sameAs: [
          'https://nrg-bi.uz/uz-ru/landing/jomiy',
          'https://nrg-bi.uz/uz/landing/jomiy',
          'https://nrg-bi.uz/uz-ru/news/jomiy-2.1-uspeshno-sdana!',
          'https://uzbekistan360.uz/ru/location/nrg-jomiy-vid-so-dvoraOWb',
        ],
      },
      {
        '@type': 'BreadcrumbList',
        inLanguage,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` },
          { '@type': 'ListItem', position: 2, name: 'Jomiy', item: projectUrl },
        ],
      },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <JomiyPage initialLanguage={language} />
    </>
  );
}
