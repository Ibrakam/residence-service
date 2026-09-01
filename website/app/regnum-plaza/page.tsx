import type { Metadata } from 'next';
import { RegnumPlazaPage } from './regnum-page';
import './regnum.css';
import './regnum-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;
const absoluteUrl = (path: string) => `${publicOrigin}${sitePath(path)}`;

const copy = {
  ru: {
    title: 'Regnum Plaza — последние квартиры бизнес-класса в Ташкенте',
    description: 'Regnum Plaza на улице Сайрам: открытая первая очередь, 11 блоков, 776 квартир, приватный двор, богатая внутренняя среда и 12 текущих предложений по официальному срезу.',
    imageAlt: 'Реальная фотография открытой первой очереди Regnum Plaza', home: 'Главная',
    status: 'Последние квартиры', class: 'Бизнес', completion: 'IV квартал 2026', address: 'Ташкент, Мирзо-Улугбекский район, ул. Сайрам', insurance: 'Страхование квартир на 10 лет',
    properties: [['Класс', 'Бизнес'], ['Статус', 'Последние квартиры'], ['Срок проекта', 'IV квартал 2026'], ['Блоки', '11 блоков'], ['Очереди', '3 очереди'], ['Площадь территории', '30 000 м²'], ['Страхование', 'Квартиры застрахованы на 10 лет']] as const,
  },
  uz: {
    title: 'Regnum Plaza — Toshkentdagi biznes-klassning eng so‘nggi xonadonlari',
    description: 'Sayram ko‘chasidagi Regnum Plaza: ochilgan birinchi bosqich, 11 blok, 776 xonadon, yopiq hovli, boy ichki muhit va rasmiy kesimdagi 12 ta joriy taklif.',
    imageAlt: 'Regnum Plaza ochilgan birinchi bosqichining haqiqiy fotosurati', home: 'Bosh sahifa',
    status: 'Eng so‘nggi kvartiralar', class: 'Biznes', completion: '2026-yil IV chorak', address: 'Toshkent, Mirzo Ulug‘bek tumani, Sayram ko‘chasi', insurance: 'Xonadonlar 10 yilga sug‘urtalangan',
    properties: [['Sinf', 'Biznes'], ['Holat', 'Eng so‘nggi kvartiralar'], ['Loyiha muddati', '2026-yil IV chorak'], ['Bloklar', '11 ta blok'], ['Bosqichlar', '3 ta bosqich'], ['Hudud maydoni', '30 000 m²'], ['Sug‘urta', 'Xonadonlar 10 yilga sug‘urtalangan']] as const,
  },
  en: {
    title: 'Regnum Plaza — last remaining business-class apartments in Tashkent',
    description: 'Regnum Plaza on Sayram Street: an opened first phase, 11 blocks, 776 apartments, a private courtyard, extensive resident amenities and 12 current official listings.',
    imageAlt: 'Actual photograph of the opened first phase at Regnum Plaza', home: 'Home',
    status: 'Last Remaining Apartments', class: 'Business', completion: 'Q4 2026', address: 'Sayram Street, Mirzo-Ulugbek District, Tashkent', insurance: 'Apartments insured for 10 years',
    properties: [['Class', 'Business'], ['Status', 'Last Remaining Apartments'], ['Completion', 'Q4 2026'], ['Blocks', '11 blocks'], ['Phases', '3 phases'], ['Site area', '30,000 m²'], ['Insurance', 'Apartments insured for 10 years']] as const,
  },
} as const;

function languageOf(value?: string): Language { return value === 'uz' || value === 'en' ? value : 'ru'; }
function languageTag(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en'; }
function locale(language: Language) { return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US'; }
function canonicalPath(language: Language) { return sitePath(`/regnum-plaza?lang=${language}`); }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/regnum-plaza/images/hero.webp');
  return {
    title: current.title,
    description: current.description,
    alternates: { canonical, languages: { 'ru-RU': canonicalPath('ru'), 'uz-UZ': canonicalPath('uz'), en: canonicalPath('en'), 'x-default': canonicalPath('ru') } },
    openGraph: { title: current.title, description: current.description, type: 'website', url: canonical, siteName: 'Regnum Plaza', locale: locale(language), images: [{ url: image, width: 1920, height: 873, alt: current.imageAlt }] },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const projectUrl = `${publicOrigin}${canonicalPath(language)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'Regnum Plaza', description: current.description,
        inLanguage: languageTag(language), url: projectUrl, image: absoluteUrl('/regnum-plaza/images/hero.webp'), telephone: '+998781228822',
        address: { '@type': 'PostalAddress', streetAddress: current.address, addressLocality: 'Tashkent', addressCountry: 'UZ' },
        geo: { '@type': 'GeoCoordinates', latitude: 41.331564, longitude: 69.324328 },
        numberOfAccommodationUnits: 776,
        additionalProperty: current.properties.map(([name, value]) => ({ '@type': 'PropertyValue', name, value })),
        sameAs: ['https://mbc.uz/project/regnum-plaza', 'https://mbc.uz/genplan/regnum-plaza', 'https://cloud.chaos.com/collaboration/n/VELR7kWdz9hqfoHWYRwfai/present?t=vrt'],
      },
      { '@type': 'BreadcrumbList', inLanguage: languageTag(language), itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` }, { '@type': 'ListItem', position: 2, name: 'Regnum Plaza', item: projectUrl }] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <RegnumPlazaPage initialLanguage={language} />
  </>;
}
