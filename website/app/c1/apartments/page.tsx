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
const copy = {
  ru: { title: 'Квартиры C1 — 42 доступные планировки', description: 'Свежий каталог 42 доступных квартир C1: 1–5 комнат, 30,41–242,32 м², этажи 5–30. Цены — по запросу.', apartment: 'Квартира', list: 'Доступные квартиры C1' },
  uz: { title: 'C1 xonadonlari — 42 ta mavjud reja', description: 'C1 ning 42 ta mavjud xonadoni: 1–5 xona, 30,41–242,32 m², 5–30-qavatlar. Narxlar — so‘rov bo‘yicha.', apartment: 'Xonadon', list: 'C1 mavjud xonadonlari' },
  en: { title: 'C1 apartments — 42 available layouts', description: 'Current catalogue of 42 available C1 apartments: 1–5 rooms, 30.41–242.32 m², floors 5–30. Prices on request.', apartment: 'Apartment', list: 'Available C1 apartments' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = `${basePath}/c1/images/hero.webp`;
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, siteName: 'C1', locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', images: [{ url: image, alt: 'C1 CGI visualisation' }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = `${origin}${canonical(language)}`;
  if (catalog.units.some((unit) => unit.status !== 'AVAILABLE' || unit.priceVisible || !unit.plan.startsWith('/c1/plans/'))) throw new Error('C1 snapshot failed the AVAILABLE/local-media/hidden-price contract.');
  const clientSnapshot = { capturedAt: catalog.capturedAt, serverDate: catalog.serverDate, availableTotal: catalog.availableTotal, interactiveBuildingTotal: catalog.interactiveBuildingTotal, reconciliation: catalog.reconciliation, counts: catalog.counts, filters: catalog.filters, units: catalog.units.map((unit) => ({ id: unit.id, crmId: unit.crmId, sourceOrder: unit.sourceOrder, number: unit.number, rooms: unit.rooms, area: unit.area, floor: unit.floor, section: unit.section, phase: unit.phase, completionYear: unit.completionYear, status: unit.status, priceVisible: unit.priceVisible, plan: unit.plan, hasOfficialFloorPolygon: unit.hasOfficialFloorPolygon })) };
  const structuredData = { '@context': 'https://schema.org', '@type': 'ItemList', name: current.list, url, numberOfItems: catalog.units.length, dateModified: catalog.capturedAt, itemListElement: catalog.units.map((unit, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Apartment', identifier: unit.id, name: `${current.apartment} №${unit.number}`, image: `${origin}${basePath}${unit.plan}`, numberOfRooms: unit.rooms, floorLevel: unit.floor, floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, containedInPlace: { '@type': 'ApartmentComplex', name: 'C1' }, additionalProperty: [{ '@type': 'PropertyValue', name: 'Section', value: unit.section }, { '@type': 'PropertyValue', name: 'Phase', value: unit.phase }, { '@type': 'PropertyValue', name: 'Status', value: unit.status }, { '@type': 'PropertyValue', name: 'Public price', value: 'On request' }] } })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><C1Catalog snapshot={clientSnapshot} initialLanguage={language} /></>;
}
