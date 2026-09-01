import type { Metadata } from 'next';
import catalog from '@/data/sado-catalog.json';
import { SadoPage } from './sado-page';
import './sado.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: "Sad'O — слушайте сердцем", description: "Жилой комплекс Business и Comfort в Яшнабадском районе Ташкента: закрытый двор без машин, дизайнерские холлы и не менее 40% озеленения." },
  uz: { title: "Sad'O — qalbingiz bilan tinglang", description: "Toshkentning Yashnobod tumanidagi Business va Comfort turar joy majmuasi: avtomobilsiz yopiq hovli, dizaynerlik xollari va kamida 40% ko‘kalamzor." },
  en: { title: "Sad'O — listen with your heart", description: "Business and Comfort homes in Tashkent's Yashnabad district, with a private car-free courtyard, designed lobbies and at least 40% landscaping." },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const page = localized[language];
  const route = `${appBasePath}/sado`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: page.title, description: page.description, images: [`${appBasePath}/sado/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' },
    twitter: { card: 'summary_large_image', title: page.title, description: page.description, images: [`${appBasePath}/sado/hero.webp`] },
  };
}

export default function SadoRoute() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: "Sad'O",
    description: 'Жилой комплекс классов Business и Comfort в Яшнабадском районе Ташкента.',
    address: { '@type': 'PostalAddress', streetAddress: 'ул. Паркентская', addressLocality: 'Ташкент', addressRegion: 'Яшнабадский район', addressCountry: 'UZ' },
    image: `${appBasePath}/sado/hero.webp`,
    telephone: '1360',
    amenityFeature: [
      { '@type': 'LocationFeatureSpecification', name: 'Закрытый двор без машин', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Подземная и наземная парковка', value: true },
      { '@type': 'LocationFeatureSpecification', name: 'Зарядные станции для электромобилей', value: true },
    ],
  };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><SadoPage initialAvailable={catalog.units.length} snapshotGeneratedAt={catalog.generatedAt} /></>;
}
