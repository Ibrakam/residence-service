import type { Metadata } from 'next';
import catalog from '@/data/c1-catalog.json';
import { C1Catalog } from './c1-catalog';
import './c1-catalog.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const origin = 'https://form.tencorp.uz';
const languageOf = (value?: string): Language => value === 'uz' || value === 'en' ? value : 'ru';
const canonical = (language: Language) => `${basePath}/c1/apartments?lang=${language}`;
const projectCanonical = (language: Language) => `${basePath}/c1?lang=${language}`;
const languageTag = (language: Language) => language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
const copy = {
  ru: { title: 'Квартиры C1 — актуальные предложения', description: 'Автоматически обновляемый каталог доступных квартир C1. Цены и актуальные условия — по запросу.', home: 'Главная', list: 'Доступные квартиры C1' },
  uz: { title: 'C1 xonadonlari — dolzarb takliflar', description: 'C1 mavjud xonadonlarining avtomatik yangilanadigan katalogi. Narxlar va amaldagi shartlar — so‘rov bo‘yicha.', home: 'Bosh sahifa', list: 'C1 mavjud xonadonlari' },
  en: { title: 'C1 apartments — current availability', description: 'An automatically updated catalogue of available C1 apartments. Prices and current terms are available on request.', home: 'Home', list: 'Available C1 apartments' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = `${basePath}/c1/images/hero.webp`;
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, siteName: 'C1', locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', images: [{ url: image, alt: 'C1 CGI visualisation' }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = `${origin}${canonical(language)}`;
  const projectUrl = `${origin}${projectCanonical(language)}`;
  if (catalog.units.some((unit) => unit.status !== 'AVAILABLE' || unit.priceVisible || !unit.plan.startsWith('/c1/plans/'))) throw new Error('C1 catalogue failed the AVAILABLE/local-media/hidden-price contract.');
  const clientSnapshot = { capturedAt: catalog.capturedAt, serverDate: catalog.serverDate, availableTotal: catalog.availableTotal, interactiveBuildingTotal: catalog.interactiveBuildingTotal, reconciliation: catalog.reconciliation, counts: catalog.counts, filters: catalog.filters, units: catalog.units.map((unit) => ({ id: unit.id, sourceOrder: unit.sourceOrder, number: unit.number, rooms: unit.rooms, area: unit.area, floor: unit.floor, section: unit.section, phase: unit.phase, completionYear: unit.completionYear, status: unit.status, priceVisible: unit.priceVisible, plan: unit.plan, hasOfficialFloorPolygon: unit.hasOfficialFloorPolygon })) };
  // Availability is hydrated from the live catalogue API. Keep server-rendered
  // structured data limited to stable project/page facts so crawlers never see
  // the embedded fallback inventory presented as the current live inventory.
  const structuredData = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'CollectionPage', '@id': `${url}#catalogue`, name: current.list, description: current.description, inLanguage: languageTag(language), url, about: { '@id': `${projectUrl}#project` } },
    { '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'C1', url: projectUrl },
    { '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${origin}${basePath}/` }, { '@type': 'ListItem', position: 2, name: 'C1', item: projectUrl }, { '@type': 'ListItem', position: 3, name: current.list, item: url }] },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><C1Catalog snapshot={clientSnapshot} initialLanguage={language} /></>;
}
