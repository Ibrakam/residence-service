import type { Metadata } from 'next';
import catalog from '@/data/c1-catalog.json';
import { C1Page } from './c1-page';
import './c1.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const origin = 'https://form.tencorp.uz';
const languageOf = (value?: string): Language => value === 'uz' || value === 'en' ? value : 'ru';
const canonical = (language: Language) => `${basePath}/c1?lang=${language}`;
const languageTag = (language: Language) => language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
const copy = {
  ru: { title: 'C1 — премиальная башня в центре Ташкента', description: 'C1 в Яшнабадском районе: 30 этажей, 252 квартиры, бассейн, фитнес и 42 доступные квартиры. Сдача — I квартал 2028.', imageAlt: 'Архитектурная CGI-визуализация башни C1', home: 'Главная' },
  uz: { title: 'C1 — Toshkent markazidagi premium minora', description: 'Yashnobod tumanidagi C1: 30 qavat, 252 xonadon, basseyn, fitness va 42 ta mavjud xonadon. Topshirish — 2028-yil I chorak.', imageAlt: 'C1 minorasining arxitektura CGI-vizualizatsiyasi', home: 'Bosh sahifa' },
  en: { title: 'C1 — a premium tower in central Tashkent', description: 'C1 in Yashnabad District: 30 floors, 252 apartments, pool, fitness and 42 available apartments. Completion — Q1 2028.', imageAlt: 'Architectural CGI visualisation of the C1 tower', home: 'Home' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = `${basePath}/c1/images/hero.webp`;
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, siteName: 'C1', locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', images: [{ url: image, width: 1920, height: 870, alt: current.imageAlt }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = `${origin}${canonical(language)}`;
  const previewUnits = catalog.units.slice(0, 4).map((unit) => ({ id: unit.id, crmId: unit.crmId, number: unit.number, rooms: unit.rooms, area: unit.area, floor: unit.floor, section: unit.section, phase: unit.phase, completionYear: unit.completionYear, plan: unit.plan }));
  const structuredData = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'ApartmentComplex', '@id': `${url}#project`, name: 'C1', description: current.description, inLanguage: languageTag(language), url, image: `${origin}${basePath}/c1/images/hero.webp`, telephone: '+998781137712', address: { '@type': 'PostalAddress', streetAddress: language === 'ru' ? 'ул. С. Азимова, 46А' : language === 'uz' ? 'S. Azimov ko‘chasi, 46A' : '46A S. Azimov Street', addressLocality: 'Tashkent', addressRegion: 'Yashnabad District', addressCountry: 'UZ' }, geo: { '@type': 'GeoCoordinates', latitude: 41.307046, longitude: 69.292214 }, numberOfAccommodationUnits: 252, additionalProperty: [['Class', 'Premium'], ['Floors', '30'], ['Blocks', '1'], ['Phases', '1'], ['Site area', '4,300 m²'], ['Completion', 'Q1 2028']].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${origin}${basePath}/` }, { '@type': 'ListItem', position: 2, name: 'C1', item: url }] },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><C1Page initialLanguage={language} previewUnits={previewUnits} /></>;
}
