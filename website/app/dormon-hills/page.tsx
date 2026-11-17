import type { Metadata } from 'next';
import { dormonBase, dormonCopy, dormonLanguage } from './dormon-data';
import { DormonPage } from './dormon-page';
import { dormonPlansState } from '@/lib/dormon-plans-state';
import './dormon.css';

export const dynamic = 'force-dynamic';

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const language = dormonLanguage(params?.lang);
  const { title, description } = dormonCopy[language];
  const route = `${dormonBase}/dormon-hills`;
  const hero = `${route}/images/hero.webp`;
  return {
    title,
    description,
    alternates: {
      canonical: `${route}?lang=${language}`,
      languages: { ru: `${route}?lang=ru`, uz: `${route}?lang=uz`, en: `${route}?lang=en` },
    },
    openGraph: { title, description, images: [hero], type: 'website' },
    twitter: { title, description, images: [hero], card: 'summary_large_image' },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = dormonLanguage(params?.lang);
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first) query.set(key, first);
  }
  const state = await dormonPlansState();
  const featuredPlans = [1, 2, 3].flatMap(rooms => {
    const plan = state.plans.find(item => item.rooms === rooms);
    return plan ? [plan] : [];
  });
  return <DormonPage language={language} query={query.toString()} featuredPlans={featuredPlans} />;
}
