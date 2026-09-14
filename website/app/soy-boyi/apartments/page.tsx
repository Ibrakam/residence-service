import type { Metadata } from "next";
import catalog from "@/data/soy-boyi-catalog.json";
import { soyBoyiPublicSnapshot } from "@/data/soy-boyi-public.mjs";
import { SoyBoyiCatalog } from "./soy-boyi-catalog";
import "./soy-boyi-catalog.css";

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
      "Актуальный официальный снимок доступных квартир Soy Bo‘yi: площади, этажи, секции, очереди и планировки. Цены — по запросу.",
    list: "Квартиры Soy Bo‘yi",
    room: (n: number) =>
      n === 0 ? "Квартира, число комнат не указано" : `${n}-комнатная квартира`,
  },
  uz: {
    title: "Soy Bo‘yi xonadonlari — yangilangan katalog",
    description:
      "Soy Bo‘yi mavjud xonadonlarining rasmiy snapshoti: maydon, qavat, seksiya, navbat va rejalar. Narxlar — so‘rov bo‘yicha.",
    list: "Soy Bo‘yi xonadonlari",
    room: (n: number) =>
      n === 0 ? "Xonalar soni ko‘rsatilmagan xonadon" : `${n} xonali xonadon`,
  },
  en: {
    title: "Soy Bo‘yi apartments — current catalogue",
    description:
      "The current official snapshot of available Soy Bo‘yi apartments: areas, floors, sections, phases and plans. Prices are on request.",
    list: "Soy Bo‘yi apartments",
    room: (n: number) =>
      n === 0 ? "Apartment with rooms not specified" : `${n}-room apartment`,
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
  const itemList = {
    "@type": "ItemList",
    "@id": `${url}#catalogue`,
    name: current.list,
    inLanguage: language,
    url,
    numberOfItems: catalog.units.length,
    dateModified: catalog.capturedAt,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: catalog.units.map((unit, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Apartment",
        identifier: unit.unitKey,
        name: `${current.room(unit.rooms)} №${unit.number}`,
        ...(unit.plan ? { image: `${siteOrigin}${local(unit.plan)}` } : {}),
        floorSize: {
          "@type": "QuantitativeValue",
          value: unit.area,
          unitCode: "MTK",
        },
        ...(unit.rooms > 0 ? { numberOfRooms: unit.rooms } : {}),
        floorLevel: unit.floor,
        containedInPlace: { "@id": `${projectUrl}#project` },
        additionalProperty: [
          { "@type": "PropertyValue", name: "Section", value: unit.section },
          { "@type": "PropertyValue", name: "Phase", value: unit.phase },
          {
            "@type": "PropertyValue",
            name: "Completion",
            value: unit.completion ?? "not specified",
          },
          {
            "@type": "PropertyValue",
            name: "Availability",
            value: "AVAILABLE",
          },
          {
            "@type": "PropertyValue",
            name: "Price visibility",
            value: "on request",
          },
        ],
      },
    })),
  };
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      itemList,
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
            name: "Soy Bo‘yi",
            item: projectUrl,
          },
          { "@type": "ListItem", position: 2, name: current.list, item: url },
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
      <SoyBoyiCatalog
        snapshot={
          publicSnapshot as Parameters<typeof SoyBoyiCatalog>[0]["snapshot"]
        }
        initialLanguage={language}
      />
    </>
  );
}
