import type { Metadata } from 'next';
import catalog from '@/data/saadiyat-catalog.json';
import { publicClientPayload } from '@/app/public-client-payload';
import { SaadiyatPage } from './saadiyat-page';
import './saadiyat.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const origin = 'https://form.tencorp.uz';
const path = (value: string) => `${appBasePath}${value}`;
const languageOf = (value?: string): Language => value === 'uz' || value === 'en' ? value : 'ru';
const canonical = (language: Language) => path(`/saadiyat?lang=${language}`);
const copy = {
  ru: { title: 'Saadiyat — бизнес-класс у тихой воды в Ташкенте', description: 'Saadiyat в Мирзо-Улугбекском районе: 14 блоков, двор без машин, водная гладь и 159 доступных квартир в актуальном каталоге.', imageAlt: 'Архитектурная визуализация Saadiyat', home: 'Главная' },
  uz: { title: 'Saadiyat — Toshkentdagi sokin suv bo‘yidagi biznes-klass', description: 'Mirzo Ulug‘bek tumanidagi Saadiyat: 14 blok, avtomobilsiz hovli, suv maydoni va yangilangan katalogdagi 159 ta mavjud xonadon.', imageAlt: 'Saadiyat arxitektura vizualizatsiyasi', home: 'Bosh sahifa' },
  en: { title: 'Saadiyat — business class beside quiet water in Tashkent', description: 'Saadiyat in Mirzo-Ulugbek District: 14 blocks, a car-free courtyard, a water feature and 159 available apartments in the current catalogue.', imageAlt: 'Saadiyat architectural visualisation', home: 'Home' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language); const image = path('/saadiyat/images/hero.webp');
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { 'ru-RU': canonical('ru'), 'uz-UZ': canonical('uz'), en: canonical('en'), 'x-default': canonical('ru') } }, openGraph: { title: current.title, description: current.description, type: 'website', url, siteName: 'Saadiyat', locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', images: [{ url: image, width: 1920, height: 870, alt: current.imageAlt }] }, twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] } };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const projectUrl = `${origin}${canonical(language)}`;
  const structuredData = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'ApartmentComplex', '@id': `${projectUrl}#project`, name: 'Saadiyat', description: current.description, inLanguage: language, url: projectUrl, image: `${origin}${path('/saadiyat/images/hero.webp')}`, telephone: '+998781137712', address: { '@type': 'PostalAddress', streetAddress: language === 'ru' ? 'пересечение улиц Катта Дархан и Аккурган' : language === 'uz' ? 'Katta Darxon va Oqqo‘rg‘on ko‘chalari chorrahasi' : 'intersection of Katta Darkhan and Akkurgan Streets', addressLocality: 'Tashkent', addressCountry: 'UZ' }, geo: { '@type': 'GeoCoordinates', latitude: 41.332023, longitude: 69.307171 }, numberOfAccommodationUnits: 710, additionalProperty: [['Class', 'Business'], ['Blocks', '14'], ['Phases', '3'], ['Site area', '20,500 m²'], ['First phase completion', 'Q4 2027']].map(([name, value]) => ({ '@type': 'PropertyValue', name, value })) },
    { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: current.home, item: `${origin}${path('/')}` }, { '@type': 'ListItem', position: 2, name: 'Saadiyat', item: projectUrl }] },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><SaadiyatPage initialLanguage={language} previewUnits={publicClientPayload(catalog.units.slice(0, 3))} /></>;
}
