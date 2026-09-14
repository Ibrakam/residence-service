import type { Metadata } from 'next';
import catalog from '@/data/saadiyat-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { SaadiyatCatalog } from './saadiyat-catalog';
import './saadiyat-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const origin = 'https://form.tencorp.uz';
const languageOf = (value?: string): Language => value === 'uz' || value === 'en' ? value : 'ru';
const canonical = (language: Language) => `${basePath}/saadiyat/apartments?lang=${language}`;
const projectCanonical = (language: Language) => `${basePath}/saadiyat?lang=${language}`;
const languageTag = (language: Language) => language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
const copy = {
  ru: { title: 'Квартиры Saadiyat — актуальный каталог', description: 'Актуальные доступные квартиры Saadiyat: комнаты, площадь, этаж, секция и очередь. Данные обновляются автоматически, цены — по запросу.', home: 'Главная', list: 'Доступные квартиры Saadiyat' },
  uz: { title: 'Saadiyat xonadonlari — dolzarb katalog', description: 'Saadiyatdagi mavjud xonadonlar: xonalar, maydon, qavat, seksiya va bosqich. Ma’lumotlar avtomatik yangilanadi, narxlar — so‘rov bo‘yicha.', home: 'Bosh sahifa', list: 'Saadiyat mavjud xonadonlari' },
  en: { title: 'Saadiyat apartments — current catalogue', description: 'Available Saadiyat apartments by rooms, area, floor, section and phase. Data updates automatically; prices are available on request.', home: 'Home', list: 'Available Saadiyat apartments' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = `${basePath}/saadiyat/images/hero.webp`;
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, images: [{ url: image, alt: 'Saadiyat CGI visualisation' }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = `${origin}${canonical(language)}`;
  const projectUrl = `${origin}${projectCanonical(language)}`;
  if (catalog.units.some((unit) => unit.status !== 'AVAILABLE' || unit.priceVisible || !unit.plan.startsWith('/saadiyat/plans/'))) throw new Error('Saadiyat catalogue failed the AVAILABLE/local-media/hidden-price contract.');
  // The client replaces this embedded fallback with the live API response. Do
  // not describe fallback units as current inventory in server-rendered JSON-LD.
  const structuredData = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': `${url}#catalogue`, name: current.list, description: current.description, inLanguage: languageTag(language), url, about: { '@id': `${projectUrl}#project` } },
    { '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'Saadiyat', url: projectUrl },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${origin}${basePath}/` }, { '@type': 'ListItem', position: 2, name: 'Saadiyat', item: projectUrl }, { '@type': 'ListItem', position: 3, name: current.list, item: url }] },
  ] };
  const safeCatalog = {
    capturedAt: catalog.capturedAt,
    serverDate: catalog.serverDate,
    officialUntypedTotal: catalog.officialUntypedTotal,
    excludedCommercial: catalog.excludedCommercial,
    availableResidentialTotal: catalog.availableResidentialTotal,
    filters: catalog.filters,
    units: catalog.units.map((unit) => ({
      id: unit.id,
      sourceOrder: unit.sourceOrder,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      section: unit.section,
      phase: unit.phase,
      completionYear: unit.completionYear,
      status: unit.status,
      priceVisible: unit.priceVisible,
      plan: unit.plan,
      sourceUpdatedAt: unit.sourceUpdatedAt,
    })),
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><SaadiyatCatalog snapshot={publicClientPayload(safeCatalog)} initialLanguage={language} /></>;
}
