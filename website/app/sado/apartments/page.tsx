import type { Metadata } from 'next';
import catalog from '@/data/sado-catalog.json';
import { SadoCatalogPage, type SadoUnit } from './sado-catalog-page';
import '../sado.css';
import './sado-catalog.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: "Квартиры в Sad'O", description: `${catalog.units.length} актуальных предложений Sad'O из официального каталога: реальные планировки, площади, этажи и цены.` },
  uz: { title: "Sad'O majmuasida xonadon tanlash", description: `Sad'O rasmiy katalogidan ${catalog.units.length} ta taklif: haqiqiy rejalar, maydonlar, qavatlar va narxlar.` },
  en: { title: "Choose an apartment at Sad'O", description: `${catalog.units.length} current official Sad'O listings with real plans, areas, floors and prices.` },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const page = localized[language];
  const route = `${appBasePath}/sado/apartments`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: page.title, description: page.description, images: [`${appBasePath}/sado/courtyard-wide.webp`] },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [`${appBasePath}/sado/courtyard-wide.webp`] },
  };
}

export default function SadoApartmentsRoute() {
  return <SadoCatalogPage initialUnits={catalog.units as SadoUnit[]} snapshotGeneratedAt={catalog.generatedAt} sourceCount={catalog.sourceCount} />;
}
