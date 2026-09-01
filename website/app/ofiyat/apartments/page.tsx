import type { Metadata } from 'next';
import { KayanCatalogPage } from '@/app/kayan/project-page';
import { getCatalogBundle, getCatalogBundleTimestamp } from '@/app/kayan/catalog-snapshot';
import '@/app/kayan/kayan.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const localized = {
  ru: { title: 'Выбор квартиры в OFIYAT', description: 'Каталог OFIYAT: крупные карточки планировок и шахматка, фильтры по очереди, подъезду и этажу, наличие и актуальные цены.' },
  uz: { title: 'OFIYAT majmuasida xonadon tanlash', description: 'OFIYAT katalogi: yirik reja kartalari va shaxmatka, bosqich, kirish va qavat filtrlari, mavjudlik va dolzarb narxlar.' },
  en: { title: 'Choose an apartment at OFIYAT', description: 'OFIYAT catalogue with large layout cards and an availability grid, phase, entrance and floor filters, availability and current prices.' },
} as const;

type PageProps = { searchParams?: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/ofiyat/apartments`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical: route, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en` } },
    openGraph: { title: content.title, description: content.description, images: [`${appBasePath}/kayan/ofiyat/hero.webp`] },
    twitter: { card: 'summary_large_image', title: content.title, description: content.description, images: [`${appBasePath}/kayan/ofiyat/hero.webp`] },
  };
}

export default async function OfiyatApartmentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const bundle = getCatalogBundle('ofiyat');
  return <KayanCatalogPage slug="ofiyat" initialBundle={bundle} snapshotGeneratedAt={getCatalogBundleTimestamp(bundle)} initialLanguage={language} />;
}
