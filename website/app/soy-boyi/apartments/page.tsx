import type { Metadata } from "next";
import catalog from "@/data/soy-boyi-catalog.json";
import { soyBoyiPublicSnapshot } from "@/data/soy-boyi-public.mjs";
import { SoyBoyiUnifiedCatalog, type SoyBoyiSafeSnapshot } from "./soy-boyi-unified-catalog";

type Language = "ru" | "uz" | "en";
type PageProps = { searchParams?: Promise<{ lang?: string }> };
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const siteOrigin = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://form.tencorp.uz"
).replace(/\/+$/, "");
const local = (value: string) => `${basePath}${value}`;
const languageOf = (value?: string): Language =>
  value === "uz" || value === "en" ? value : "ru";
const canonical = (language: Language) =>
  local(`/soy-boyi/apartments?lang=${language}`);
const copy = {
  ru: {
    title: "Квартиры Soy Bo‘yi — актуальный каталог",
    description:
      "Актуальные доступные квартиры Soy Bo‘yi: площади, этажи, секции, очереди и планировки. Цены — по запросу.",
    list: "Квартиры Soy Bo‘yi",
    home: "Главная",
  },
  uz: {
    title: "Soy Bo‘yi xonadonlari — yangilangan katalog",
    description:
      "Soy Bo‘yi mavjud xonadonlari: maydon, qavat, seksiya, navbat va rejalar. Narxlar — so‘rov bo‘yicha.",
    list: "Soy Bo‘yi xonadonlari",
    home: "Bosh sahifa",
  },
  en: {
    title: "Soy Bo‘yi apartments — current catalogue",
    description:
      "Currently available Soy Bo‘yi apartments: areas, floors, sections, phases and plans. Prices are on request.",
    list: "Soy Bo‘yi apartments",
    home: "Home",
  },
} as const;

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const url = canonical(language);
  const image = local("/soy-boyi/media/hero-ff90e01e163f.webp");
  return {
    title: current.title,
    description: current.description,
    alternates: {
      canonical: url,
      languages: {
        "ru-RU": canonical("ru"),
        "uz-UZ": canonical("uz"),
        en: canonical("en"),
        "x-default": canonical("ru"),
      },
    },
    openGraph: {
      title: current.title,
      description: current.description,
      type: "website",
      url,
      siteName: "Soy Bo‘yi",
      locale:
        language === "ru" ? "ru_RU" : language === "uz" ? "uz_UZ" : "en_US",
      images: [{ url: image, width: 2200, height: 1000, alt: current.list }],
    },
    twitter: {
      card: "summary_large_image",
      title: current.title,
      description: current.description,
      images: [image],
    },
  };
}

export default async function Page({ searchParams }: PageProps) {
  const language = languageOf((await searchParams)?.lang);
  const current = copy[language];
  const url = `${siteOrigin}${canonical(language)}`;
  const projectUrl = `${siteOrigin}${local(`/soy-boyi?lang=${language}`)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": `${url}#catalogue`,
        name: current.list,
        description: current.description,
        inLanguage: language,
        url,
        about: { "@id": `${projectUrl}#project` },
      },
      {
        "@type": "ApartmentComplex",
        "@id": `${projectUrl}#project`,
        name: "Soy Bo‘yi",
        url: projectUrl,
        address: {
          "@type": "PostalAddress",
          streetAddress: "3A Yusuf Sakkaki Avenue",
          addressLocality: "Tashkent",
          addressRegion: "Uchtepa District",
          addressCountry: "UZ",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: current.home,
            item: `${siteOrigin}${local("/")}`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Soy Bo‘yi",
            item: projectUrl,
          },
          { "@type": "ListItem", position: 3, name: current.list, item: url },
        ],
      },
    ],
  };
  const publicSnapshot = soyBoyiPublicSnapshot(catalog);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SoyBoyiUnifiedCatalog
        snapshot={publicSnapshot as unknown as SoyBoyiSafeSnapshot}
        initialLanguage={language}
      />
    </>
  );
}
