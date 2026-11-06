import type { Metadata } from 'next';
import { PushkinCatalog } from './pushkin-catalog';
import type { PushkinLanguage } from '../pushkin-data';

type Props = { searchParams?: Promise<{ lang?: string }> };
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const lang = (await searchParams)?.lang; const language: PushkinLanguage = lang === 'uz' || lang === 'en' ? lang : 'ru';
  const title = { ru: 'Квартиры Pushkin — каталог и планировки', uz: 'Pushkin xonadonlari — katalog va rejalar', en: 'Pushkin apartments — catalogue and floor plans' }[language];
  const base = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  return { title, description: title, alternates: { canonical: `${base}/pushkin/apartments?lang=${language}`, languages: { 'ru-RU': `${base}/pushkin/apartments?lang=ru`, 'uz-UZ': `${base}/pushkin/apartments?lang=uz`, en: `${base}/pushkin/apartments?lang=en` } }, openGraph: { title, images: [`${base}/pushkin/images/hero.webp`] } };
}
export default async function Page({ searchParams }: Props) {
  const lang = (await searchParams)?.lang;
  return <PushkinCatalog initialLanguage={lang === 'uz' || lang === 'en' ? lang : 'ru'} />;
}
