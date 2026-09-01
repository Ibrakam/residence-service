import type { Metadata } from 'next';
import { ZamonPage as ZamonLanding } from './zamon-page';
import './zamon.css';
import './zamon-shared.css';

type Language = 'ru' | 'uz' | 'en';
type PageProps = { searchParams?: Promise<{ lang?: string }> };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const normalizedBasePath = appBasePath ? `/${appBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const sitePath = (path: string) => `${normalizedBasePath}${path}`;

const copy = {
  ru: {
    title: 'Zamon — жилой комплекс комфорт-класса в Ташкенте',
    description: 'Zamon от NRG-BI: сданная I очередь, собственный пруд, не менее 30% озеленения и официальный каталог квартир.',
    eyebrow: 'Хронология света · Ташкент',
    lead: 'Архитектурный журнал о доме, который уже живёт — и продолжает складываться во времени.',
    photo: 'Реальная фотография сданной I очереди',
    catalogue: 'Смотреть квартиры',
    phases: ['I очередь · сдана', 'II очередь · актуальный каталог', 'III очередь · актуальный каталог'],
  },
  uz: {
    title: 'Zamon — Toshkentdagi komfort-klass turar joy majmuasi',
    description: 'NRG-BI kompaniyasining Zamon loyihasi: topshirilgan I bosqich, o‘z hovuzi, kamida 30% ko‘kalamzorlashtirish va rasmiy xonadonlar katalogi.',
    eyebrow: 'Yorug‘lik xronologiyasi · Toshkent',
    lead: 'Allaqachon yashayotgan va vaqt davomida shakllanishda davom etayotgan uy haqidagi me’moriy jurnal.',
    photo: 'Topshirilgan I bosqichning haqiqiy fotosurati',
    catalogue: 'Xonadonlarni ko‘rish',
    phases: ['I bosqich · topshirilgan', 'II bosqich · dolzarb katalog', 'III bosqich · dolzarb katalog'],
  },
  en: {
    title: 'Zamon — a comfort-class residential project in Tashkent',
    description: 'Zamon by NRG-BI: completed phase I, its own pond, at least 30% landscaping and an official apartment catalogue.',
    eyebrow: 'A chronology of light · Tashkent',
    lead: 'An architectural journal about a home that is already lived in and continues to unfold through time.',
    photo: 'Actual photograph of the completed first phase',
    catalogue: 'View apartments',
    phases: ['Phase I · completed', 'Phase II · current catalogue', 'Phase III · current catalogue'],
  },
} as const;

function languageOf(value?: string): Language {
  return value === 'uz' || value === 'en' ? value : 'ru';
}

function languageTag(language: Language) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
}

const address = {
  ru: { streetAddress: 'ул. Таларык', addressLocality: 'Ташкент' },
  uz: { streetAddress: 'Talaryk ko‘chasi', addressLocality: 'Toshkent' },
  en: { streetAddress: 'Talaryk Street', addressLocality: 'Tashkent' },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const canonical = sitePath(`/zamon?lang=${language}`);
  const image = sitePath('/zamon/images/hero-phase-one.webp');
  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical,
      languages: { 'ru-RU': sitePath('/zamon?lang=ru'), 'uz-UZ': sitePath('/zamon?lang=uz'), en: sitePath('/zamon?lang=en'), 'x-default': sitePath('/zamon?lang=ru') },
    },
    openGraph: { title: current.title, description: current.description, type: 'website', url: canonical, images: [image] },
    twitter: { card: 'summary_large_image', title: current.title, description: current.description, images: [image] },
  };
}

export default async function ZamonPage({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const projectUrl = `https://form.tencorp.uz${sitePath(`/zamon?lang=${language}`)}`;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ApartmentComplex',
    name: 'Zamon',
    description: current.description,
    inLanguage: languageTag(language),
    url: projectUrl,
    image: `https://form.tencorp.uz${sitePath('/zamon/images/hero-phase-one.webp')}`,
    brand: { '@type': 'Brand', name: 'NRG-BI' },
    address: {
      '@type': 'PostalAddress',
      ...address[language],
      addressCountry: 'UZ',
    },
    additionalProperty: [
      { '@type': 'PropertyValue', name: language === 'uz' ? 'Klass' : language === 'en' ? 'Class' : 'Класс', value: language === 'ru' ? 'Комфорт' : 'Comfort' },
      { '@type': 'PropertyValue', name: language === 'uz' ? 'Bosqichlar' : language === 'en' ? 'Phases' : 'Очереди', value: 4 },
      { '@type': 'PropertyValue', name: language === 'uz' ? 'Qavatlar' : language === 'en' ? 'Storeys' : 'Этажность', value: '8 / 9 / 12' },
      { '@type': 'PropertyValue', name: language === 'uz' ? 'Ko‘kalamzorlashtirish' : language === 'en' ? 'Landscaping' : 'Озеленение', value: language === 'uz' ? 'kamida 30%' : language === 'en' ? 'at least 30%' : 'не менее 30%' },
      { '@type': 'PropertyValue', name: language === 'uz' ? 'Hovuz' : language === 'en' ? 'Pond' : 'Пруд', value: true },
    ],
    sameAs: ['https://uzbekistan360.uz/ru/location/nrg-zamon-vid-s-ptichego-poljotappC'],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <ZamonLanding initialLanguage={language} />
    </>
  );
}
