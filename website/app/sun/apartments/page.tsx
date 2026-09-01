import type { Metadata } from 'next';
import { SunCatalog } from './sun-catalog';
import '../sun-shared.css';
import './sun-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const publicOrigin = 'https://form.tencorp.uz';
const sitePath = (path: string) => `${appBasePath}${path}`;

const copy = {
  ru: {
    title: 'Квартиры SUN — 51 актуальное предложение в четырёх корпусах',
    description: 'Каталог SUN: 51 доступная квартира, реальные цены в UZS, фильтры, карточки и шахматка по официальному срезу Human2Human.',
    imageAlt: 'Официальная архитектурная визуализация SUN',
    home: 'Главная',
    project: 'SUN',
    catalog: 'Квартиры',
  },
  uz: {
    title: 'SUN xonadonlari — to‘rt binoda 51 ta dolzarb taklif',
    description: 'SUN katalogi: Human2Human rasmiy kesimi asosida 51 ta mavjud xonadon, UZS narxlari, filtrlar, kartochkalar va shaxmatka.',
    imageAlt: 'SUN loyihasining rasmiy arxitektura vizualizatsiyasi',
    home: 'Bosh sahifa',
    project: 'SUN',
    catalog: 'Xonadonlar',
  },
  en: {
    title: 'SUN apartments — 51 current listings across four buildings',
    description: 'The SUN catalogue presents 51 available apartments with numeric UZS prices, filters, cards and Matrix from the official Human2Human snapshot.',
    imageAlt: 'Official architectural visualisation of SUN',
    home: 'Home',
    project: 'SUN',
    catalog: 'Apartments',
  },
} as const;

function languageOf(value?: string): Language { return value === 'uz' || value === 'en' ? value : 'ru'; }
function languageTag(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en'; }
function locale(language: Language) { return language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US'; }
function canonicalPath(language: Language) { return sitePath(`/sun/apartments?lang=${language}`); }

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = canonicalPath(language);
  const image = sitePath('/sun/images/overview.webp');
  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical,
      languages: { 'ru-RU': canonicalPath('ru'), 'uz-UZ': canonicalPath('uz'), en: canonicalPath('en'), 'x-default': canonicalPath('ru') },
    },
    openGraph: {
      title: current.title,
      description: current.description,
      type: 'website',
      url: canonical,
      siteName: 'SUN by Human2Human',
      locale: locale(language),
      images: [{ url: image, width: 1920, height: 1080, alt: current.imageAlt }],
    },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const projectUrl = `${publicOrigin}${sitePath(`/sun?lang=${language}`)}`;
  const catalogUrl = `${publicOrigin}${canonicalPath(language)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': `${catalogUrl}#catalog`,
        name: current.title,
        description: current.description,
        inLanguage: languageTag(language),
        url: catalogUrl,
        isPartOf: { '@type': 'ApartmentComplex', name: 'SUN', url: projectUrl },
        mainEntity: { '@type': 'ItemList', numberOfItems: 51, itemListOrder: 'https://schema.org/ItemListUnordered' },
      },
      {
        '@type': 'BreadcrumbList',
        inLanguage: languageTag(language),
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: current.home, item: `${publicOrigin}${sitePath('/')}` },
          { '@type': 'ListItem', position: 2, name: current.project, item: projectUrl },
          { '@type': 'ListItem', position: 3, name: current.catalog, item: catalogUrl },
        ],
      },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
    <SunCatalog initialLanguage={language} />
  </>;
}
