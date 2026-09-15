import type { Metadata } from "next";
import catalog from "@/data/sarbon-catalog.json";
import mediaManifest from "@/data/sarbon-media-manifest.json";
import { sarbonPublicSnapshot } from "@/data/sarbon-public.mjs";
import { SarbonPage } from "./sarbon-page";
import "./sarbon.css";

type Language = "ru" | "uz" | "en";
type Search = { lang?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_term?: string; utm_content?: string; fbclid?: string; tcid?: string };
type PageProps = { searchParams?: Promise<Search> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}` : "";
const siteOrigin = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://form.tencorp.uz").replace(/\/+$/, "");
const languageOf = (value?: string): Language => value === "uz" || value === "en" ? value : "ru";
const local = (value: string) => `${basePath}${value}`;
const canonical = (language: Language) => local(`/sarbon?lang=${language}`);
const copy = {
  ru: { title: "SARBON — новый городской ориентир в Новом Ташкенте", description: "Жилой квартал бизнес-класса SARBON: архитектура, благоустройство и актуальные квартиры первой очереди. Идет бронирование." },
  uz: { title: "SARBON — Yangi Toshkentdagi yangi shahar mo‘ljali", description: "SARBON biznes-klass turar joy mavzesi: arxitektura, obodonlashtirish va birinchi navbatdagi mavjud xonadonlar. Bron qilish jarayoni ketmoqda." },
  en: { title: "SARBON — a new urban landmark in New Tashkent", description: "SARBON business-class residential quarter: architecture, landscaped spaces and currently available phase-one apartments. Booking in progress." },
} as const;

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const url = canonical(language);
  const hero = mediaManifest.assets.find((asset) => asset.name === "hero")?.derivatives.find((asset) => asset.variant === "wide" && asset.format === "webp")?.localPath;
  return {
    title: current.title, description: current.description,
    alternates: { canonical: url, languages: { "ru-RU": canonical("ru"), "uz-UZ": canonical("uz"), en: canonical("en"), "x-default": canonical("ru") } },
    openGraph: { title: current.title, description: current.description, type: "website", url, siteName: "SARBON", locale: language === "ru" ? "ru_RU" : language === "uz" ? "uz_UZ" : "en_US", ...(hero ? { images: [{ url: local(hero), width: 2200, height: 1000, alt: "SARBON — визуализация проекта" }] } : {}) },
    twitter: { card: "summary_large_image", title: current.title, description: current.description, ...(hero ? { images: [local(hero)] } : {}) },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const language = languageOf(params?.lang);
  const tracked = Object.fromEntries(Object.entries(params ?? {}).filter(([key, value]) => value && ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "tcid"].includes(key))) as Record<string, string>;
  const projectUrl = `${siteOrigin}${canonical(language)}`;
  const catalogueUrl = `${siteOrigin}${local(`/sarbon/apartments?lang=${language}`)}`;
  const publicSnapshot = sarbonPublicSnapshot(catalog) as Parameters<typeof SarbonPage>[0]["snapshot"];
  const snapshot = { ...publicSnapshot, units: publicSnapshot.units.map((unit) => ({ ...unit, plan: unit.plan ? local(unit.plan) : null })) };
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "ApartmentComplex", "@id": `${projectUrl}#project`, name: "SARBON", url: projectUrl, description: copy[language].description, numberOfAccommodationUnits: 1023, telephone: "+998781137712", address: { "@type": "PostalAddress", addressLocality: language === "ru" ? "Новый Ташкент" : language === "uz" ? "Yangi Toshkent" : "New Tashkent", addressCountry: "UZ" }, geo: { "@type": "GeoCoordinates", latitude: 41.283289, longitude: 69.498216 }, additionalProperty: [
        { "@type": "PropertyValue", name: "Maximum floors", value: 12 },
        { "@type": "PropertyValue", name: "Blocks", value: 21 },
        { "@type": "PropertyValue", name: "Phases", value: 5 },
        { "@type": "PropertyValue", name: "Project area", value: "39,600 m²" },
      ], amenityFeature: ["Landscaped walking routes", "Children's playgrounds", "Workout areas", "Shared lounges", "Children's rooms", "Library"].map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true })) },
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "SARBON", item: projectUrl },
        { "@type": "ListItem", position: 2, name: language === "ru" ? "Квартиры" : language === "uz" ? "Xonadonlar" : "Apartments", item: catalogueUrl },
      ] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <SarbonPage initialLanguage={language} initialTracking={tracked} basePath={basePath} media={Object.fromEntries(mediaManifest.assets.map((asset) => [asset.name, Object.fromEntries(asset.derivatives.map((item) => [`${item.variant}-${item.format}`, local(item.localPath)]))]))} snapshot={snapshot} />
  </>;
}
