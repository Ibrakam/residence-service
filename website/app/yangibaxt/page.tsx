import type { Metadata } from 'next';
import { YangiBaxtPage } from './yangibaxt-page';
import './yangibaxt.css';
import './yangibaxt-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: {
    title: 'Yangi Baxt — жилой комплекс у озера в Ташкенте',
    description: 'Yangi Baxt на Ахангаранском проспекте: территория 58 га, озеро Baxt, 7,3 га парка, более 30% озеленения и официальный каталог квартир.',
    imageAlt: 'Реальная официальная фотография благоустройства Yangi Baxt',
    home: 'Главная',
    properties: [
      ['Класс', 'Comfort / Comfort+'],
      ['Территория проекта', '58 га'],
      ['Озеро', 'Baxt'],
      ['Парковая зона', '7,3 га'],
      ['Озеленение', 'Более 30%'],
      ['II очередь', 'Сдана 27 января 2026 года'],
    ],
    address: { streetAddress: 'Ахангаранский проспект', addressLocality: 'Ташкент' },
  },
  uz: {
    title: 'Yangi Baxt — Toshkentdagi ko‘l bo‘yidagi turar joy majmuasi',
    description: 'Ohangaron prospektidagi Yangi Baxt: 58 ga loyiha hududi, Baxt ko‘li, 7,3 ga park, 30% dan ortiq ko‘kalamzor va rasmiy xonadonlar katalogi.',
    imageAlt: 'Yangi Baxt obodonlashtirilishining haqiqiy rasmiy fotosurati',
    home: 'Bosh sahifa',
    properties: [
      ['Klass', 'Comfort / Comfort+'],
      ['Loyiha hududi', '58 ga'],
      ['Ko‘l', 'Baxt'],
      ['Park hududi', '7,3 ga'],
      ['Ko‘kalamzorlashtirish', '30% dan ortiq'],
      ['II bosqich', '2026-yil 27-yanvarda topshirilgan'],
    ],
    address: { streetAddress: 'Ohangaron prospekti', addressLocality: 'Toshkent' },
  },
  en: {
    title: 'Yangi Baxt — a lakeside residential project in Tashkent',
    description: 'Yangi Baxt on Akhangaran Avenue: a 58 ha project with Lake Baxt, 7.3 ha of parkland, more than 30% landscaping and an official apartment catalogue.',
    imageAlt: 'Actual official photograph of landscaping at Yangi Baxt',
    home: 'Home',
    properties: [
      ['Class', 'Comfort / Comfort+'],
      ['Project area', '58 ha'],
      ['Lake', 'Baxt'],
      ['Park area', '7.3 ha'],
      ['Landscaping', 'More than 30%'],
      ['Phase II', 'Completed on 27 January 2026'],
    ],
    address: { streetAddress: 'Akhangaran Avenue', addressLocality: 'Tashkent' },
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
  return sitePath(`/yangibaxt?lang=${language}`);
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/yangibaxt/images/hero-real.webp');

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
      siteName: 'Yangi Baxt',
      locale: locale(language),
      images: [{ url: image, alt: current.imageAlt }],
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
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const inLanguage = languageTag(language);
  const projectUrl = `${publicOrigin}${canonicalPath(language)}`;
  const projectId = `${projectUrl}#project`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ApartmentComplex',
        '@id': projectId,
        name: 'Yangi Baxt',
        description: current.description,
        inLanguage,
        url: projectUrl,
        image: absoluteUrl('/yangibaxt/images/hero-real.webp'),
        telephone: '+998781137712',
        brand: { '@type': 'Organization', name: 'NRG-BI' },
        address: {
          '@type': 'PostalAddress',
          ...current.address,
          addressCountry: 'UZ',
        },
        additionalProperty: current.properties.map(([name, value]) => ({
          '@type': 'PropertyValue',
          name,
          value,
        })),
      },
      {
        '@type': 'BreadcrumbList',
        inLanguage,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: current.home,
            item: `${publicOrigin}${sitePath('/')}`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Yangi Baxt',
            item: projectUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <YangiBaxtPage initialLanguage={language} />
    </>
  );
}
