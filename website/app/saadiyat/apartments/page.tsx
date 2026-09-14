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
const copy = {
  ru: { title: 'Квартиры Saadiyat — 159 доступных планировок', description: 'Актуальный каталог 159 доступных жилых позиций Saadiyat: комнаты, площадь, этаж, секция и очередь. Цены — по запросу.', apartment: 'Квартира', list: 'Доступные квартиры Saadiyat' },
  uz: { title: 'Saadiyat xonadonlari — 159 ta mavjud reja', description: 'Saadiyatning 159 ta mavjud turar joy pozitsiyasi: xonalar, maydon, qavat, seksiya va bosqich. Narxlar — so‘rov bo‘yicha.', apartment: 'Xonadon', list: 'Saadiyat mavjud xonadonlari' },
  en: { title: 'Saadiyat apartments — 159 available layouts', description: 'Current catalogue of 159 available Saadiyat residential entries: rooms, area, floor, section and phase. Prices on request.', apartment: 'Apartment', list: 'Available Saadiyat apartments' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = `${basePath}/saadiyat/images/hero.webp`;
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, images: [{ url: image, alt: 'Saadiyat CGI visualisation' }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = `${origin}${canonical(language)}`;
  if (catalog.units.some((unit) => unit.status !== 'AVAILABLE' || unit.priceVisible || !unit.plan.startsWith('/saadiyat/plans/'))) throw new Error('Saadiyat public snapshot failed the AVAILABLE/local-media/hidden-price contract.');
  const structuredData = { '@context': 'https://schema.org', '@type': 'ItemList', name: current.list, url, numberOfItems: catalog.units.length, dateModified: catalog.capturedAt, itemListElement: catalog.units.map((unit, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Apartment', identifier: unit.id, name: `${current.apartment} №${unit.number}`, image: `${origin}${basePath}${unit.plan}`, ...(unit.rooms > 0 ? { numberOfRooms: unit.rooms } : {}), floorLevel: unit.floor, floorSize: { '@type': 'QuantitativeValue', value: unit.area, unitCode: 'MTK' }, containedInPlace: { '@type': 'ApartmentComplex', name: 'Saadiyat' }, additionalProperty: [{ '@type': 'PropertyValue', name: 'Section', value: unit.section }, { '@type': 'PropertyValue', name: 'Phase', value: unit.phase }, { '@type': 'PropertyValue', name: 'Status', value: unit.status }] } })) };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><SaadiyatCatalog snapshot={publicClientPayload(catalog)} initialLanguage={language} /></>;
}
