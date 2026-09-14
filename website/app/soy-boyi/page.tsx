import type { Metadata } from "next";
import catalog from "@/data/soy-boyi-catalog.json";
import { soyBoyiPublicPreview } from "@/data/soy-boyi-public.mjs";
import { SoyBoyiPage } from "./soy-boyi-page";
import "./soy-boyi.css";

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
const canonical = (language: Language) => local(`/soy-boyi?lang=${language}`);
const copy = {
  ru: {
    title: "Soy Bo‘yi — жизнь у реки в Ташкенте",
    description:
      "Soy Bo‘yi в Учтепинском районе: бизнес-класс, собственная набережная, большой двор-парк и актуальный каталог квартир.",
    imageAlt: "Архитектурная визуализация Soy Bo‘yi у реки",
    home: "Главная",
  },
  uz: {
    title: "Soy Bo‘yi — Toshkentda daryo bo‘yidagi hayot",
    description:
      "Uchtepa tumanidagi Soy Bo‘yi: biznes-klass, xususiy sohilbo‘yi, katta hovli-bog‘ va yangilangan xonadonlar katalogi.",
    imageAlt: "Soy Bo‘yi daryo bo‘yidagi arxitektura vizualizatsiyasi",
    home: "Bosh sahifa",
  },
  en: {
    title: "Soy Bo‘yi — riverfront living in Tashkent",
    description:
      "Soy Bo‘yi in Uchtepa District: business class, a private promenade, a large garden courtyard and a current apartment catalogue.",
    imageAlt: "Architectural visualisation of Soy Bo‘yi beside the river",
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
      images: [
        { url: image, width: 2200, height: 1000, alt: current.imageAlt },
      ],
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
  const projectUrl = `${siteOrigin}${canonical(language)}`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ApartmentComplex",
        "@id": `${projectUrl}#project`,
        name: "Soy Bo‘yi",
        description: current.description,
        inLanguage: language,
        url: projectUrl,
        image: `${siteOrigin}${local("/soy-boyi/media/hero-ff90e01e163f.webp")}`,
        telephone: "+998781137712",
        address: {
          "@type": "PostalAddress",
          streetAddress:
            language === "ru"
              ? "проспект Юсуфа Саккаки, 3А"
              : language === "uz"
                ? "Yusuf Sakkaki shoh ko‘chasi, 3A"
                : "3A Yusuf Sakkaki Avenue",
          addressLocality: language === "uz" ? "Toshkent" : "Tashkent",
          addressRegion:
            language === "ru"
              ? "Учтепинский район"
              : language === "uz"
                ? "Uchtepa tumani"
                : "Uchtepa District",
          addressCountry: "UZ",
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: 41.29912,
          longitude: 69.176107,
        },
        numberOfAccommodationUnits: 1249,
        additionalProperty: [
          ["Class", "Business"],
          ["Blocks", "14"],
          ["Phases", "4"],
          ["Project area", "43,321 m²"],
          ["Floors", "13–16"],
        ].map(([name, value]) => ({ "@type": "PropertyValue", name, value })),
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
        ],
      },
    ],
  };
  const previewUnits = soyBoyiPublicPreview(catalog, 3);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <SoyBoyiPage
        initialLanguage={language}
        previewUnits={previewUnits}
        availableCount={catalog.availableResidentialTotal}
      />
    </>
  );
}
