import type { Metadata } from 'next';
import catalog from '@/data/pushkin-catalog.json';
import { PushkinPage } from './pushkin-page';
import { pushkinLocation, type PushkinLanguage } from './pushkin-data';
import './pushkin.css';

type Props = { searchParams?: Promise<{ lang?: string }> };
const base = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const titles = { ru: 'Pushkin — клубный дом на улице Олмачи', uz: 'Pushkin — Olmachi ko‘chasidagi klub uyi', en: 'Pushkin — a club residence on Olmachi Street' };
const descriptions = { ru: 'Pushkin от Tower Up: 16 этажей, квартиры с 2–4 комнатами, планировки и актуальные предложения Taqsim. Ташкент, ул. Олмачи, 21. Консультация TENCORP.', uz: 'Tower Up kompaniyasining Pushkin loyihasi: 16 qavat, 2–4 xonali xonadonlar, rejalar va Taqsim takliflari. Toshkent, Olmachi ko‘chasi, 21. TENCORP maslahati.', en: 'Pushkin by Tower Up: 16 floors, two to four room apartments, floor plans and current Taqsim listings. 21 Olmachi Street, Tashkent. TENCORP consultation.' };
function pushkinLanguage(value?: string): PushkinLanguage { return value === 'uz' || value === 'en' ? value : 'ru'; }
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const language = pushkinLanguage((await searchParams)?.lang);
  return { title: titles[language], description: descriptions[language], alternates: { canonical: `${base}/pushkin?lang=${language}`, languages: { 'ru-RU': `${base}/pushkin?lang=ru`, 'uz-UZ': `${base}/pushkin?lang=uz`, en: `${base}/pushkin?lang=en` } }, openGraph: { title: titles[language], description: descriptions[language], images: [`${base}/pushkin/images/hero.webp`], type: 'website' }, twitter: { card: 'summary_large_image', title: titles[language], images: [`${base}/pushkin/images/hero.webp`] } };
}
export default async function Page({ searchParams }: Props) {
  const language = pushkinLanguage((await searchParams)?.lang);
  const examples = [2, 3, 4].map(rooms => catalog.units.find(unit => unit.rooms === rooms)!).map(({ id, rooms, area, plan }) => ({ id, rooms, area, plan }));
  const schema = { '@context': 'https://schema.org', '@type': 'ApartmentComplex', name: 'Pushkin', url: `https://form.tencorp.uz${base}/pushkin`, description: descriptions[language], image: `https://form.tencorp.uz${base}/pushkin/images/hero.webp`, telephone: '+998781137712', address: { '@type': 'PostalAddress', streetAddress: 'Олмачи, 21', addressLocality: 'Ташкент', addressCountry: 'UZ' }, geo: { '@type': 'GeoCoordinates', ...pushkinLocation } };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} /><PushkinPage initialLanguage={language} examples={examples} /></>;
}
