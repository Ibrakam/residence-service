import type { Metadata } from "next";
import catalog from "@/data/sarbon-catalog.json";
import { sarbonPublicSnapshot } from "@/data/sarbon-public.mjs";
import {
  SarbonUnifiedCatalog,
  type SarbonSafeSnapshot,
} from "./sarbon-unified-catalog";

type Language = "ru" | "uz" | "en";
type Search = { lang?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; fbclid?: string; tcid?: string; rooms?: string; floor?: string; section?: string; sort?: string; view?: string; unit?: string };
type PageProps = { searchParams?: Promise<Search> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://form.tencorp.uz").replace(/\/+$/, "");
const languageOf = (value?: string): Language => value === "uz" || value === "en" ? value : "ru";
const local = (value: string) => `${basePath}${value}`;
const canonical = (language: Language) => local(`/sarbon/apartments?lang=${language}`);
const copy = {
  ru: { title: "Квартиры SARBON — актуальный каталог", description: "Доступные квартиры первой очереди SARBON: 2–4 комнаты, планы и фильтры. Состав предложений обновляется автоматически, цены — по запросу.", crumb: "Квартиры SARBON" },
  uz: { title: "SARBON xonadonlari — dolzarb katalog", description: "SARBON birinchi navbatidagi mavjud xonadonlar: 2–4 xona, rejalar va filtrlar. Takliflar avtomatik yangilanadi, narxlar — so‘rov bo‘yicha.", crumb: "SARBON xonadonlari" },
  en: { title: "SARBON apartments — current catalogue", description: "Available phase-one SARBON apartments with plans and filters. Listings update automatically and all prices are on request.", crumb: "SARBON apartments" },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang); const current = copy[language]; const url = canonical(language);
  return { title: current.title, description: current.description, alternates: { canonical: url, languages: { "ru-RU": canonical("ru"), "uz-UZ": canonical("uz"), en: canonical("en"), "x-default": canonical("ru") } }, openGraph: { title: current.title, description: current.description, type: "website", url, siteName: "SARBON", locale: language === "ru" ? "ru_RU" : language === "uz" ? "uz_UZ" : "en_US" }, twitter: { card: "summary", title: current.title, description: current.description } };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams; const language = languageOf(params?.lang); const tracked = Object.fromEntries(Object.entries(params ?? {}).filter(([key, value]) => value && ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "tcid"].includes(key))) as Record<string, string>;
  const snapshot = sarbonPublicSnapshot(catalog) as unknown as SarbonSafeSnapshot;
  const url = `${siteOrigin}${canonical(language)}`; const projectUrl = `${siteOrigin}${local(`/sarbon?lang=${language}`)}`;
  const structuredData = { "@context": "https://schema.org", "@graph": [
    { "@type": "ApartmentComplex", "@id": `${projectUrl}#project`, name: "SARBON", url: projectUrl, numberOfAccommodationUnits: 1023, telephone: "+998781137712", address: { "@type": "PostalAddress", addressLocality: language === "ru" ? "Новый Ташкент" : language === "uz" ? "Yangi Toshkent" : "New Tashkent", addressCountry: "UZ" }, geo: { "@type": "GeoCoordinates", latitude: 41.283289, longitude: 69.498216 } },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "SARBON", item: projectUrl }, { "@type": "ListItem", position: 2, name: copy[language].crumb, item: url }] },
  ] };
  return <><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} /><SarbonUnifiedCatalog snapshot={snapshot} initialLanguage={language} initialTracking={tracked} basePath={basePath} initialUnitId={params?.unit} /></>;
}
