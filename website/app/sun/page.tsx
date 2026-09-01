import type { Metadata } from 'next';
import { SunPage } from './sun-page';
import './sun.css';
import './sun-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const meta = {
  ru: {
    title: 'SUN by Human2Human — клубный жилой проект в Мирабадском районе',
    description: 'SUN: 1 га, 5 корпусов, 361 квартира во всём проекте и честно размеченные CGI и фото стройки от 15.08.2026. Текущий каталог — 51 доступная квартира.',
    imageAlt: 'Официальная архитектурная визуализация жилого проекта SUN', home: 'Главная',
    properties: [['Формат', 'Клубный жилой проект'], ['Территория', '1 га'], ['Корпуса проекта', '5'], ['Квартиры во всём проекте', '361'], ['Этажность', '11–14 этажей'], ['Состояние строительства', 'Последнее сообщение девелопера от 15.08.2026']] as const,
  },
  uz: {
    title: 'Human2Human SUN — Miroboddagi klub formatidagi turar joy loyihasi',
    description: 'SUN: 1 ga, 5 bino, butun loyihada 361 xonadon hamda aniq belgilangan CGI va 15.08.2026 qurilish suratlari. Joriy katalogda 51 ta mavjud xonadon.',
    imageAlt: 'SUN turar joy loyihasining rasmiy arxitektura vizualizatsiyasi', home: 'Bosh sahifa',
    properties: [['Format', 'Klub formatidagi turar joy loyihasi'], ['Hudud', '1 ga'], ['Loyiha binolari', '5'], ['Butun loyihadagi xonadonlar', '361'], ['Qavatlar', '11–14 qavat'], ['Qurilish holati', 'Developerning 15.08.2026 sanasidagi so‘nggi xabari']] as const,
  },
  en: {
    title: 'SUN by Human2Human — a club-format residential project in Mirabad',
    description: 'SUN: a 1-hectare, five-building, 361-apartment project with clearly labelled CGI and construction photography dated 15 August 2026. 51 apartments are currently listed.',
    imageAlt: 'Official architectural visualisation of the SUN residential project', home: 'Home',
    properties: [['Format', 'Club-format residential project'], ['Site', '1 hectare'], ['Project buildings', '5'], ['Apartments in the full project', '361'], ['Height', '11–14 floors'], ['Construction state', 'Latest developer report dated 15 August 2026']] as const,
  },
} as const;

function languageOf(value?: string): Language { return value === 'uz' || value === 'en' ? value : 'ru'; }
function languageTag(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en'; }
function locale(language: Language) { return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US'; }
function canonicalPath(language: Language) { return sitePath(`/sun?lang=${language}`); }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = meta[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/sun/images/overview.webp');
  return {
    title: current.title,
    description: current.description,
    alternates: { canonical, languages: { 'ru-RU': canonicalPath('ru'), 'uz-UZ': canonicalPath('uz'), en: canonicalPath('en'), 'x-default': canonicalPath('ru') } },
    openGraph: { title: current.title, description: current.description, type: 'website', url: canonical, siteName: 'SUN by Human2Human', locale: locale(language), images: [{ url: image, width: 1920, height: 1080, alt: current.imageAlt }] },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = meta[language];
  const projectUrl = `${publicOrigin}${canonicalPath(language)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'SUN', description: current.description,
        inLanguage: languageTag(language), url: projectUrl, image: absoluteUrl('/sun/images/overview.webp'), telephone: '+998781505500', email: 'info@h2h.uz',
        address: { '@type': 'PostalAddress', streetAddress: language === 'ru' ? 'ул. Сайхун 56/2' : language === 'uz' ? 'Sayxun ko‘chasi 56/2' : '56/2 Saykhun Street', addressLocality: 'Tashkent', addressRegion: 'Mirabad', addressCountry: 'UZ' },
        numberOfAccommodationUnits: 361,
        additionalProperty: current.properties.map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
        sameAs: ['https://human2human.uz/'],
      },
      { '@type': 'BreadcrumbList', inLanguage: languageTag(language), itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` }, { '@type': 'ListItem', position: 2, name: 'SUN', item: projectUrl }] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <SunPage initialLanguage={language} />
  </>;
}
