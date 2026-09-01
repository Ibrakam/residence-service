import type { Metadata } from 'next';
import { VohaPage } from './voha-page';
import './voha.css';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const localized = {
  ru: { title: 'Voha — премиальная жизнь у воды в Ташкенте', description: 'Жилой комплекс Voha премиум-класса от NRG-BI: приватный двор, канал, более 45% озеленения и реальные фотографии проекта.', ogTitle: 'Voha — живите по соседству с природой' },
  uz: { title: 'Voha — Toshkentda suv bo‘yidagi premium hayot', description: 'NRG-BI premium-klass Voha majmuasi: xususiy hovli, kanal, hududning 45% dan ortig‘i ko‘kalamzor va haqiqiy loyiha fotosuratlari.', ogTitle: 'Voha — tabiat bilan yonma-yon yashang' },
  en: { title: 'Voha — premium waterside living in Tashkent', description: 'Voha by NRG-BI: a premium residential complex with a private courtyard, canal, over 45% landscaping and actual project photography.', ogTitle: 'Voha — live next to nature' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  const content = localized[language];
  const route = `${appBasePath}/voha`;
  return { title: content.title, description: content.description, alternates: { canonical: `${route}?lang=${language}`, languages: { 'ru-RU': `${route}?lang=ru`, 'uz-UZ': `${route}?lang=uz`, en: `${route}?lang=en`, 'x-default': `${route}?lang=ru` } }, openGraph: { title: content.ogTitle, description: content.description, images: [`${appBasePath}/voha/images/hero.webp`], locale: language === 'ru' ? 'ru_RU' : language === 'uz' ? 'uz_UZ' : 'en_US', type: 'website' }, twitter: { card: 'summary_large_image', title: content.ogTitle, description: content.description, images: [`${appBasePath}/voha/images/hero.webp`] } };
}

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'ApartmentComplex',
  name: 'Voha',
  description: 'Жилой комплекс премиум-класса NRG-BI с каналом вдоль двора и более чем 45% территории под озеленением.',
  url: `https://form.tencorp.uz${appBasePath}/voha`,
  image: `https://form.tencorp.uz${appBasePath}/voha/images/hero.webp`,
  address: { '@type': 'PostalAddress', streetAddress: 'улица Кайнарсой, 136А', addressLocality: 'Ташкент', addressCountry: 'UZ' },
  brand: { '@type': 'Organization', name: 'NRG-BI' },
  additionalProperty: [
    { '@type': 'PropertyValue', name: 'Класс жилья', value: 'Премиум' },
    { '@type': 'PropertyValue', name: 'Высота потолков', value: '3,3 м' },
    { '@type': 'PropertyValue', name: 'I очередь', value: 'Сдана' },
    { '@type': 'PropertyValue', name: 'Озеленение', value: 'Более 45% территории' },
  ],
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language: Language = params?.lang === 'uz' || params?.lang === 'en' ? params.lang : 'ru';
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} /><VohaPage initialLanguage={language} /></>;
}
