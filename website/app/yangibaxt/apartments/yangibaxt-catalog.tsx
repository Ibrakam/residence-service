"use client";

/* eslint-disable @next/next/no-img-element */

import { usePathname, useRouter } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import catalogData from "@/data/yangibaxt-catalog.json";
import { LeadModal, rememberLastViewedApartment } from "@/app/lead-modal";
import { yangiBaxtLeadSubmitUrl } from "../yangibaxt-lead";
import {
  lockYangiBaxtBody,
  type YangiBaxtLanguage as Language,
  yangiBaxtLocale,
} from "../yangibaxt-ui";

type Mode = "cards" | "chess";
type Sort =
  | "source"
  | "priceAsc"
  | "priceDesc"
  | "areaAsc"
  | "areaDesc"
  | "floorAsc"
  | "floorDesc"
  | "roomsAsc"
  | "roomsDesc"
  | "ppmAsc"
  | "ppmDesc";
type SelectFilter = "all" | string;
type BooleanFilter = "all" | "yes" | "no";
type Promotion = {
  percent: number;
  name: string;
  deadlineUtc: string | null;
  discountSum: number;
  priceWithDiscount: number;
};
type Unit = {
  id: string;
  sourceOrder: number;
  number: string;
  rooms: number;
  area: number;
  price: number;
  priceSource: "campaign-snapshot" | "raw-total-price-fallback";
  oldPrice: number;
  totalPriceWithDiscountRaw: number;
  currentPricePerM2: number;
  sourcePricePerM2: number;
  currency: string;
  promotion: Promotion | null;
  floor: number;
  totalFloors: number;
  entrance: number;
  buildingId: string;
  building: string;
  buildingDisplay: string;
  propertyClass: string;
  completionDate: string;
  sourcePlacementCompletionDate: string;
  plan: string;
  floorPositionPlan: string;
  planSourceUrls: {
    primaryLayout: string;
    apartmentSheetURLPage1: string;
    apartmentSheetURLPage2: string;
  };
  statusOriginal: string;
  statusId: string;
  isSale: boolean;
  repairIncluded: boolean;
  repairPrice: number | null;
  repairSum: number;
  studio: boolean;
  balconyArea: number | null;
  ceilingHeight: string;
  provenance: {
    capturedAt: string;
    detailResponseBytes: number;
    detailResponseSha256: string;
  };
};
type Group = {
  id: string;
  rawName: string;
  displayName: string;
  count: number;
  normalizedDeadline: string;
  entrances: Array<{
    entrance: number;
    count: number;
    floorsWithListings: number[];
    maxFloor: number;
  }>;
};
type SummaryCount<T = string> = { value: T; count: number };
type Snapshot = {
  project: string;
  projectSlug: string;
  capturedAt: string;
  capturedAtUzt: string;
  officialTotalAtCapture: number;
  mixedPropertyPlacementCount: number;
  offerCount: number;
  source: string;
  filterSummary: {
    groups: Group[];
    rooms: Array<SummaryCount<number>>;
    statuses: SummaryCount[];
    deadlines: SummaryCount[];
    entrances: Array<SummaryCount<number>>;
    repairIncluded: { true: number; false: number };
    studio: { true: number; false: number };
    ranges: {
      area: { min: number; max: number };
      snapshotPrice: { min: number; max: number };
      floor: { min: number; max: number };
    };
  };
  units: Unit[];
};
type Filters = {
  rooms: SelectFilter;
  areaFrom: string;
  areaTo: string;
  priceFrom: string;
  priceTo: string;
  floor: SelectFilter;
  building: SelectFilter;
  entrance: SelectFilter;
  status: SelectFilter;
  completion: SelectFilter;
  repair: BooleanFilter;
  studio: BooleanFilter;
};
type Selection = { unit: Unit; opener: HTMLButtonElement };
type PlanState = Selection & { view: "apartment" | "position" };
type LeadRequest = { unit: Unit | null; surface: string };

const snapshot = catalogData as Snapshot;
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const appBasePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) =>
  `${appBasePath}${path}?lang=${language}`;
const privacyUrl = (language: Language) =>
  `${appBasePath}/privacy?project=yangibaxt&lang=${language}&from=catalog`;
const languages: Language[] = ["ru", "uz", "en"];
const modes: Mode[] = ["cards", "chess"];
const defaultFilters: Filters = {
  rooms: "all",
  areaFrom: "",
  areaTo: "",
  priceFrom: "",
  priceTo: "",
  floor: "all",
  building: "all",
  entrance: "all",
  status: "all",
  completion: "all",
  repair: "all",
  studio: "all",
};

const copy = {
  ru: {
    skip: "К результатам каталога",
    back: "О проекте",
    nav: "Навигация каталога",
    language: "Язык",
    consult: "Оставить заявку",
    call: "1360",
    eyebrow: "PARK LOOP · КАТАЛОГ 30.08.2026",
    title: "Квартиры",
    accent: "в контуре Baxt.",
    leadBefore: "В актуальном разделе официального каталога",
    leadAfter:
      "квартир. Статус «Свободно» имеют 63; остальные этапы оформления показаны честно и отдельно.",
    snapshot: "Дата каталога",
    captured: "Зафиксировано",
    records: "записей",
    offers: "Свободно + isSale",
    groups: "групп",
    plans: "индивидуальных планов",
    allApartments: "265 квартир · без паркингов, офисов и цоколей",
    modes: { cards: "Карточки", chess: "Шахматка" },
    modeLabel: "Режим каталога",
    filters: "Фильтры",
    reset: "Сбросить",
    rooms: "Комнаты",
    any: "Все",
    areaFrom: "Площадь от, м²",
    areaTo: "Площадь до, м²",
    priceFrom: "Цена от, млн UZS",
    priceTo: "Цена до, млн UZS",
    floor: "Этаж",
    group: "Группа",
    entrance: "Подъезд",
    status: "Статус",
    completion: "Срок",
    repair: "Ремонт",
    studio: "Studio · отметка каталога",
    yes: "Да",
    no: "Нет",
    results: "найдено",
    sort: "Сортировка",
    sorts: {
      source: "Исходный порядок",
      priceAsc: "Цена ↑",
      priceDesc: "Цена ↓",
      areaAsc: "Площадь ↑",
      areaDesc: "Площадь ↓",
      floorAsc: "Этаж ↑",
      floorDesc: "Этаж ↓",
      roomsAsc: "Комнаты ↑",
      roomsDesc: "Комнаты ↓",
      ppmAsc: "Цена/м² ↑",
      ppmDesc: "Цена/м² ↓",
    },
    apartment: "Квартира",
    roomsShort: "комн.",
    area: "Площадь",
    snapshotPrice: "Цена на дату каталога",
    rawPrice: "Исходная цена",
    pricePerM2: "за м²",
    campaignPrice: "Цена кампании на дату каталога",
    rawFallback: "Базовая цена · кампания не указана",
    campaignUntil: "В каталоге до",
    currentTerms: "Актуальные условия подтверждает отдел продаж.",
    floorOf: "Этаж",
    entranceShort: "Подъезд",
    groupShort: "Группа",
    completionShort: "Срок",
    finishing: "С ремонтом",
    noFinishing: "Без ремонта",
    studioTrue: "Studio: да",
    studioFalse: "Studio: нет",
    ceiling: "Высота потолка",
    balcony: "Балкон",
    statusNote: "Статус в официальном каталоге",
    statuses: {
      Свободно: "Свободно",
      "Снятие резерва": "Снятие резерва",
      Расторжение: "Расторжение",
      "Снятие брони": "Снятие брони",
      Бронирование: "Бронирование",
    },
    plan: "План квартиры",
    position: "Положение на этаже",
    openPlan: "Открыть план",
    choose: "Уточнить условия",
    details: "Подробнее",
    showMore: "Показать ещё",
    shown: "Показано",
    of: "из",
    empty: "По этим параметрам квартир нет.",
    resetFilters: "Сбросить фильтры",
    source: "Источник и UUID",
    rawGroup: "Raw API группа",
    rawStatus: "Raw API статус",
    rawHeight: "Raw API высота",
    unitUuid: "UUID",
    detailHash: "Detail response SHA-256",
    normalizedDeadline: "Согласованный срок filter/realEstateList",
    placementDeadline: "Raw placementList срок",
    matrix: "Шахматка по реальным группам",
    matrixHint:
      "Каждая группа и подъезд показаны отдельно. Прокручивайте пальцем, трекпадом, кнопками или клавишами ← → Home End.",
    entranceTitle: "Подъезд",
    floorTitle: "Этаж",
    maxFloorLabel: "макс. этаж",
    unitsOnFloor: "квартир на этаже",
    emptyFloor: "Нет квартир по фильтру",
    scrollLeft: "Прокрутить влево",
    scrollRight: "Прокрутить вправо",
    noMatrix: "В этой группе нет квартир по фильтру.",
    selected: "Выбранная квартира",
    closeDetails: "Закрыть детали",
    selectHint:
      "Выберите квартиру в шахматке, чтобы открыть компактную карточку и форму.",
    closePlan: "Закрыть планировку",
    planViews: "Виды официального листа",
    sourceTitle: "О каталоге и статусах",
    sourceText:
      "Все 265 квартир получены одной согласованной выгрузкой официальных API 30.08.2026 в 21:57 UZT. Общий placementCount 320 включает также паркинги, офисы и цоколи; они исключены. Этап оформления не гарантирует юридическую доступность.",
    disclaimer:
      "Каталог и цены зафиксированы на 30.08.2026, не являются публичной офертой. Наличие, стоимость и условия подтверждает отдел продаж.",
    privacy: "Обработка персональных данных",
    top: "Наверх",
    home: "Yangi Baxt",
    formTagline: "Вместе с природой.",
    formFacts: ["265 квартир", "5 групп", "63 свободно"] as const,
  },
  uz: {
    skip: "Katalog natijalariga o‘tish",
    back: "Loyiha haqida",
    nav: "Katalog navigatsiyasi",
    language: "Til",
    consult: "Ariza qoldirish",
    call: "1360",
    eyebrow: "PARK LOOP · 30.08.2026 KATALOGI",
    title: "Baxt konturidagi",
    accent: "xonadonlar.",
    leadBefore: "Rasmiy katalogning joriy bo‘limida",
    leadAfter:
      "ta xonadon bor. Faqat 63 tasi “Bo‘sh”; rasmiylashtirishning boshqa bosqichlari alohida va ochiq ko‘rsatilgan.",
    snapshot: "Katalog sanasi",
    captured: "Qayd etilgan vaqt",
    records: "yozuv",
    offers: "Bo‘sh + isSale",
    groups: "guruh",
    plans: "individual reja",
    allApartments: "265 xonadon · parking, ofis va sokolsiz",
    modes: {
      cards: "Kartalar",
      chess: "Shaxmatka",
    },
    modeLabel: "Katalog ko‘rinishi",
    filters: "Filtrlar",
    reset: "Tozalash",
    rooms: "Xonalar",
    any: "Barchasi",
    areaFrom: "Maydon, m² dan",
    areaTo: "Maydon, m² gacha",
    priceFrom: "Narx, mln UZS dan",
    priceTo: "Narx, mln UZS gacha",
    floor: "Qavat",
    group: "Guruh",
    entrance: "Kirish",
    status: "Holat",
    completion: "Muddat",
    repair: "Pardoz",
    studio: "Studio · katalog belgisi",
    yes: "Ha",
    no: "Yo‘q",
    results: "topildi",
    sort: "Saralash",
    sorts: {
      source: "Manbadagi tartib",
      priceAsc: "Narx ↑",
      priceDesc: "Narx ↓",
      areaAsc: "Maydon ↑",
      areaDesc: "Maydon ↓",
      floorAsc: "Qavat ↑",
      floorDesc: "Qavat ↓",
      roomsAsc: "Xonalar ↑",
      roomsDesc: "Xonalar ↓",
      ppmAsc: "m² narxi ↑",
      ppmDesc: "m² narxi ↓",
    },
    apartment: "Xonadon",
    roomsShort: "xonali",
    area: "Maydon",
    snapshotPrice: "Katalog sanasidagi narx",
    rawPrice: "Asl narx",
    pricePerM2: "m² uchun",
    campaignPrice: "Katalog sanasidagi kampaniya narxi",
    rawFallback: "Asosiy narx · kampaniya ko‘rsatilmagan",
    campaignUntil: "Katalogda shu sanagacha",
    currentTerms: "Amaldagi shartlarni savdo bo‘limi tasdiqlaydi.",
    floorOf: "Qavat",
    entranceShort: "Kirish",
    groupShort: "Guruh",
    completionShort: "Muddat",
    finishing: "Pardoz bilan",
    noFinishing: "Pardozsiz",
    studioTrue: "Studio: ha",
    studioFalse: "Studio: yo‘q",
    ceiling: "Shift balandligi",
    balcony: "Balkon",
    statusNote: "Rasmiy katalogdagi holat",
    statuses: {
      Свободно: "Bo‘sh",
      "Снятие резерва": "Rezervni olib tashlash",
      Расторжение: "Shartnomani bekor qilish",
      "Снятие брони": "Bronni olib tashlash",
      Бронирование: "Bron qilish",
    },
    plan: "Xonadon rejasi",
    position: "Qavatdagi o‘rni",
    openPlan: "Rejani ochish",
    choose: "Shartlarni aniqlash",
    details: "Batafsil",
    showMore: "Yana ko‘rsatish",
    shown: "Ko‘rsatildi",
    of: "dan",
    empty: "Bu parametrlar bo‘yicha xonadon yo‘q.",
    resetFilters: "Filtrlarni tozalash",
    source: "Manba va UUID",
    rawGroup: "Raw API guruhi",
    rawStatus: "Raw API holati",
    rawHeight: "Raw API balandligi",
    unitUuid: "UUID",
    detailHash: "Detail javobi SHA-256",
    normalizedDeadline: "filter/realEstateList kelishilgan muddati",
    placementDeadline: "Raw placementList muddati",
    matrix: "Haqiqiy guruhlar bo‘yicha Shaxmatka",
    matrixHint:
      "Har bir guruh va kirish alohida. Barmoq, trekpad, tugmalar yoki ← → Home End klavishlari bilan suring.",
    entranceTitle: "Kirish",
    floorTitle: "Qavat",
    maxFloorLabel: "eng yuqori qavat",
    unitsOnFloor: "qavatdagi xonadon",
    emptyFloor: "Filtrga mos xonadon yo‘q",
    scrollLeft: "Chapga surish",
    scrollRight: "O‘ngga surish",
    noMatrix: "Bu guruhda filtrga mos xonadon yo‘q.",
    selected: "Tanlangan xonadon",
    closeDetails: "Tafsilotlarni yopish",
    selectHint:
      "Ixcham karta va arizani ochish uchun shaxmatkadan xonadon tanlang.",
    closePlan: "Rejani yopish",
    planViews: "Rasmiy varaq ko‘rinishlari",
    sourceTitle: "Katalog va holatlar haqida",
    sourceText:
      "Barcha 265 xonadon rasmiy APIlarning 30.08.2026 soat 21:57 UZT dagi yagona kelishilgan nusxasidan olingan. Umumiy placementCount 320 tarkibiga parking, ofis va sokol obyektlari ham kiradi; ular chiqarib tashlangan. Rasmiylashtirish bosqichi huquqiy mavjudlikni kafolatlamaydi.",
    disclaimer:
      "Katalog va narxlar 30.08.2026 holatiga qayd etilgan va ommaviy oferta emas. Mavjudlik, narx va shartlarni savdo bo‘limi tasdiqlaydi.",
    privacy: "Shaxsiy ma’lumotlarni qayta ishlash",
    top: "Yuqoriga",
    home: "Yangi Baxt",
    formTagline: "Tabiat bilan birga.",
    formFacts: ["265 xonadon", "5 guruh", "63 bo‘sh"] as const,
  },
  en: {
    skip: "Skip to catalogue results",
    back: "About the project",
    nav: "Catalogue navigation",
    language: "Language",
    consult: "Send an enquiry",
    call: "1360",
    eyebrow: "PARK LOOP · CATALOGUE 30 AUG 2026",
    title: "Apartments",
    accent: "inside the Baxt loop.",
    leadBefore: "The current official catalogue contains",
    leadAfter:
      "apartments. Only 63 are marked “Available”; all other purchase stages are shown separately and accurately.",
    snapshot: "Catalogue date",
    captured: "Captured",
    records: "records",
    offers: "Available + isSale",
    groups: "groups",
    plans: "individual plans",
    allApartments: "265 apartments · parking, offices and basements excluded",
    modes: { cards: "Cards", chess: "Matrix" },
    modeLabel: "Catalogue view",
    filters: "Filters",
    reset: "Reset",
    rooms: "Rooms",
    any: "Any",
    areaFrom: "Area from, m²",
    areaTo: "Area to, m²",
    priceFrom: "Price from, m UZS",
    priceTo: "Price to, m UZS",
    floor: "Floor",
    group: "Group",
    entrance: "Entrance",
    status: "Status",
    completion: "Completion",
    repair: "Finishing",
    studio: "Studio · catalogue flag",
    yes: "Yes",
    no: "No",
    results: "found",
    sort: "Sort",
    sorts: {
      source: "Source order",
      priceAsc: "Price ↑",
      priceDesc: "Price ↓",
      areaAsc: "Area ↑",
      areaDesc: "Area ↓",
      floorAsc: "Floor ↑",
      floorDesc: "Floor ↓",
      roomsAsc: "Rooms ↑",
      roomsDesc: "Rooms ↓",
      ppmAsc: "Price/m² ↑",
      ppmDesc: "Price/m² ↓",
    },
    apartment: "Apartment",
    roomsShort: "room",
    area: "Area",
    snapshotPrice: "Price on catalogue date",
    rawPrice: "Original price",
    pricePerM2: "per m²",
    campaignPrice: "Campaign price on catalogue date",
    rawFallback: "Base price · no campaign listed",
    campaignUntil: "Listed until",
    currentTerms: "The sales team confirms current terms.",
    floorOf: "Floor",
    entranceShort: "Entrance",
    groupShort: "Group",
    completionShort: "Completion",
    finishing: "With finishing",
    noFinishing: "No finishing",
    studioTrue: "Studio: yes",
    studioFalse: "Studio: no",
    ceiling: "Ceiling height",
    balcony: "Balcony",
    statusNote: "Status in the official catalogue",
    statuses: {
      Свободно: "Available",
      "Снятие резерва": "Reservation release",
      Расторжение: "Termination",
      "Снятие брони": "Booking release",
      Бронирование: "Booking",
    },
    plan: "Apartment plan",
    position: "Position on floor",
    openPlan: "Open plan",
    choose: "Check terms",
    details: "Details",
    showMore: "Show more",
    shown: "Shown",
    of: "of",
    empty: "No apartments match these filters.",
    resetFilters: "Reset filters",
    source: "Source and UUID",
    rawGroup: "Raw API group",
    rawStatus: "Raw API status",
    rawHeight: "Raw API height",
    unitUuid: "UUID",
    detailHash: "Detail response SHA-256",
    normalizedDeadline: "Agreed filter/realEstateList completion",
    placementDeadline: "Raw placementList completion",
    matrix: "Matrix by real catalogue group",
    matrixHint:
      "Every group and entrance is separate. Swipe, use a trackpad, the buttons, or ← → Home End keys.",
    entranceTitle: "Entrance",
    floorTitle: "Floor",
    maxFloorLabel: "max floor",
    unitsOnFloor: "apartments on floor",
    emptyFloor: "No apartments match the filters",
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
    noMatrix: "No matching apartment in this group.",
    selected: "Selected apartment",
    closeDetails: "Close details",
    selectHint:
      "Select an apartment in the matrix to open its compact record and enquiry form.",
    closePlan: "Close plan",
    planViews: "Official sheet views",
    sourceTitle: "About the catalogue and statuses",
    sourceText:
      "All 265 apartments came from one aligned export of the official APIs on 30 Aug 2026 at 21:57 UZT. The total placementCount of 320 also contains parking, offices and basement units; these are excluded. A purchase stage does not guarantee legal availability.",
    disclaimer:
      "The catalogue and prices were captured on 30 Aug 2026 and are not a public offer. The sales team confirms availability, pricing and terms.",
    privacy: "Personal data processing",
    top: "Back to top",
    home: "Yangi Baxt",
    formTagline: "Together with nature.",
    formFacts: ["265 apartments", "5 groups", "63 available"] as const,
  },
} as const;

function locale(language: Language) {
  return yangiBaxtLocale(language);
}
function number(value: number, language: Language, digits = 0) {
  return new Intl.NumberFormat(locale(language), {
    maximumFractionDigits: digits,
  }).format(value);
}
function money(value: number, language: Language) {
  return `${number(value, language)} UZS`;
}
function shortMoney(value: number, language: Language) {
  return `${number(value / 1e6, language, 1)} ${language === "ru" ? "млн" : language === "uz" ? "mln" : "m"}`;
}
function date(value: string, language: Language) {
  return new Intl.DateTimeFormat(locale(language), {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(
    new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value),
  );
}
function captured(value: string, language: Language) {
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
function status(unit: Unit, language: Language) {
  return (
    (copy[language].statuses as Record<string, string>)[unit.statusOriginal] ??
    (language === "ru"
      ? unit.statusOriginal
      : language === "uz"
        ? "Boshqa holat"
        : "Other status")
  );
}
function statusTone(value: string) {
  return value === "Свободно"
    ? "available"
    : value === "Снятие резерва"
      ? "reserve-release"
      : value === "Расторжение"
        ? "termination"
        : value === "Снятие брони"
          ? "booking-release"
          : "booking";
}
function roomLabel(value: number, language: Language) {
  return language === "en"
    ? `${value} ${value === 1 ? "room" : "rooms"}`
    : `${value} ${copy[language].roomsShort}`;
}
function ceilingLabel(value: string, language: Language) {
  const matched = value.match(/\d+[,.]\d+/)?.[0]?.replace(",", ".");
  return matched ? `${number(Number(matched), language, 2)} m` : value;
}
function russianPlural(value: number, one: string, few: string, many: string) {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
function recordLabel(value: number, language: Language) {
  if (language === "ru")
    return russianPlural(value, "запись", "записи", "записей");
  if (language === "uz") return "ta yozuv";
  return value === 1 ? "record" : "records";
}
function unitsOnFloorLabel(value: number, language: Language) {
  if (language === "ru")
    return russianPlural(
      value,
      "квартира на этаже",
      "квартиры на этаже",
      "квартир на этаже",
    );
  if (language === "uz") return "ta xonadon qavatda";
  return value === 1 ? "apartment on this floor" : "apartments on this floor";
}
function compare(a: Unit, b: Unit, sort: Sort) {
  const tie = a.sourceOrder - b.sourceOrder;
  if (sort === "source") return tie;
  if (sort === "priceAsc") return a.price - b.price || tie;
  if (sort === "priceDesc") return b.price - a.price || tie;
  if (sort === "areaAsc") return a.area - b.area || tie;
  if (sort === "areaDesc") return b.area - a.area || tie;
  if (sort === "floorAsc") return a.floor - b.floor || tie;
  if (sort === "floorDesc") return b.floor - a.floor || tie;
  if (sort === "roomsAsc") return a.rooms - b.rooms || tie;
  if (sort === "roomsDesc") return b.rooms - a.rooms || tie;
  if (sort === "ppmAsc")
    return a.currentPricePerM2 - b.currentPricePerM2 || tie;
  return b.currentPricePerM2 - a.currentPricePerM2 || tie;
}

function remember(unit: Unit) {
  rememberLastViewedApartment(
    {
      uuid: unit.id,
      number: unit.number,
      rooms: unit.rooms,
      area: unit.area,
      floor: unit.floor,
      maxFloor: unit.totalFloors,
      entrance: unit.entrance,
      block: unit.building,
      blockName: unit.building,
      blockId: unit.buildingId,
      price: unit.price,
      normalizedDeadline: unit.completionDate,
      sourceStatus: unit.statusOriginal,
      studio: unit.studio,
    },
    "yangibaxt",
  );
}

function useLanguage(initialLanguage: Language) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("lang")) {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("yangibaxt-language");
      } catch {
        /* Optional fallback. */
      }
      const fallback =
        stored === "uz" || stored === "en" ? stored : initialLanguage;
      params.set("lang", fallback);
      router.replace(
        `${pathname}?${params.toString()}${window.location.hash}`,
        { scroll: false },
      );
    }
    document.documentElement.lang = initialLanguage;
    try {
      localStorage.setItem("yangibaxt-language", initialLanguage);
    } catch {
      /* URL remains authoritative. */
    }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (next: Language) => {
    try {
      localStorage.setItem("yangibaxt-language", next);
    } catch {
      /* URL remains authoritative. */
    }
    const params = new URLSearchParams(window.location.search);
    params.set("lang", next);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, {
      scroll: false,
    });
  };
  return [initialLanguage, setLanguage] as const;
}

function useMobileDrawer() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}

function StatusBadge({ unit, language }: { unit: Unit; language: Language }) {
  return (
    <span className="ybc-status" data-tone={statusTone(unit.statusOriginal)}>
      <i aria-hidden="true" />
      <span>{status(unit, language)}</span>
      <small>{copy[language].statusNote}</small>
    </span>
  );
}

function Price({
  unit,
  language,
  detailed = false,
}: {
  unit: Unit;
  language: Language;
  detailed?: boolean;
}) {
  const t = copy[language];
  return (
    <div className="ybc-price">
      <span>{t.snapshotPrice}</span>
      <strong>{money(unit.price, language)}</strong>
      <small>
        {money(unit.currentPricePerM2, language)} {t.pricePerM2}
      </small>
      {unit.promotion && unit.oldPrice > unit.price ? (
        <del>
          {t.rawPrice} · {money(unit.oldPrice, language)}
        </del>
      ) : null}
      {detailed ? (
        <em>
          {unit.promotion
            ? `${t.campaignPrice}${unit.promotion.deadlineUtc ? ` · ${t.campaignUntil} ${date(unit.promotion.deadlineUtc, language)}` : ""}`
            : t.rawFallback}{" "}
          · {t.currentTerms}
        </em>
      ) : null}
    </div>
  );
}

function SourceDetails({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return (
    <details className="ybc-unit-source">
      <summary>
        {t.source}
        <span>＋</span>
      </summary>
      <dl>
        <div>
          <dt>{t.unitUuid}</dt>
          <dd>{unit.id}</dd>
        </div>
        <div>
          <dt>{t.rawGroup}</dt>
          <dd lang="ru">{unit.building}</dd>
        </div>
        <div>
          <dt>{t.rawStatus}</dt>
          <dd lang="ru">
            {unit.statusOriginal} · isSale={String(unit.isSale)}
          </dd>
        </div>
        <div>
          <dt>{t.rawHeight}</dt>
          <dd lang="ru">{unit.ceilingHeight}</dd>
        </div>
        <div>
          <dt>{t.normalizedDeadline}</dt>
          <dd>{unit.completionDate}</dd>
        </div>
        <div>
          <dt>{t.placementDeadline}</dt>
          <dd>{unit.sourcePlacementCompletionDate}</dd>
        </div>
        <div>
          <dt>{t.detailHash}</dt>
          <dd>{unit.provenance.detailResponseSha256}</dd>
        </div>
      </dl>
    </details>
  );
}

function UnitFacts({
  unit,
  language,
  compact = false,
}: {
  unit: Unit;
  language: Language;
  compact?: boolean;
}) {
  const t = copy[language];
  return (
    <dl className={`ybc-unit-facts${compact ? " is-compact" : ""}`}>
      <div>
        <dt>{t.area}</dt>
        <dd>{number(unit.area, language, 2)} m²</dd>
      </div>
      <div>
        <dt>{t.floorOf}</dt>
        <dd>
          {unit.floor} / {unit.totalFloors}
        </dd>
      </div>
      <div>
        <dt>{t.entranceShort}</dt>
        <dd>{unit.entrance}</dd>
      </div>
      <div>
        <dt>{t.groupShort}</dt>
        <dd>{unit.buildingDisplay}</dd>
      </div>
      <div>
        <dt>{t.completionShort}</dt>
        <dd>{date(unit.completionDate, language)}</dd>
      </div>
      <div>
        <dt>{t.ceiling}</dt>
        <dd>{ceilingLabel(unit.ceilingHeight, language)}</dd>
      </div>
      {compact ? null : (
        <>
          <div>
            <dt>{t.repair}</dt>
            <dd>{unit.repairIncluded ? t.finishing : t.noFinishing}</dd>
          </div>
          <div>
            <dt>{t.studio}</dt>
            <dd>{unit.studio ? t.studioTrue : t.studioFalse}</dd>
          </div>
        </>
      )}
    </dl>
  );
}

function PlanLightbox({
  state,
  language,
  onClose,
}: {
  state: PlanState;
  language: Language;
  onClose: () => void;
}) {
  const [view, setView] = useState(state.view);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  const views: PlanState["view"][] = ["apartment", "position"];
  const panelId = `ybc-plan-panel-${state.unit.id}`;
  const close = useCallback(() => {
    onClose();
    window.requestAnimationFrame(
      () =>
        state.opener.isConnected && state.opener.focus({ preventScroll: true }),
    );
  }, [onClose, state.opener]);
  const selectView = (next: PlanState["view"], moveFocus = false) => {
    setView(next);
    if (moveFocus)
      window.requestAnimationFrame(() =>
        document
          .getElementById(`ybc-plan-tab-${next}-${state.unit.id}`)
          ?.focus(),
      );
  };
  const onTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowLeft")
      next = (index + views.length - 1) % views.length;
    else if (event.key === "ArrowRight") next = (index + 1) % views.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = views.length - 1;
    else return;
    event.preventDefault();
    selectView(views[next], true);
  };
  useEffect(() => {
    const release = lockYangiBaxtBody();
    closeRef.current?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      release();
    };
  }, [close]);
  return (
    <div
      className="ybc-plan-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ybc-plan-title"
    >
      <button
        className="ybc-plan-lightbox__backdrop"
        type="button"
        tabIndex={-1}
        onClick={close}
        aria-label={t.closePlan}
      />
      <div className="ybc-plan-lightbox__panel" ref={panelRef}>
        <header>
          <div>
            <small>{t.apartment}</small>
            <h2 id="ybc-plan-title">
              № {state.unit.number} · {roomLabel(state.unit.rooms, language)}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label={t.closePlan}
          >
            ×
          </button>
        </header>
        <div className="ybc-plan-tabs" role="tablist" aria-label={t.planViews}>
          {views.map((item, index) => (
            <button
              id={`ybc-plan-tab-${item}-${state.unit.id}`}
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              aria-controls={panelId}
              tabIndex={view === item ? 0 : -1}
              onClick={() => selectView(item)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item === "apartment" ? t.plan : t.position}
            </button>
          ))}
        </div>
        <div
          id={panelId}
          className="ybc-plan-stage"
          role="tabpanel"
          aria-labelledby={`ybc-plan-tab-${view}-${state.unit.id}`}
          tabIndex={0}
        >
          <img
            src={asset(
              view === "apartment"
                ? state.unit.plan
                : state.unit.floorPositionPlan,
            )}
            alt={`${view === "apartment" ? t.plan : t.position} № ${state.unit.number}`}
          />
        </div>
        <footer>
          <StatusBadge unit={state.unit} language={language} />
          <span>
            {t.groupShort} {state.unit.buildingDisplay} · {t.entranceShort}{" "}
            {state.unit.entrance} · {t.floorOf} {state.unit.floor}/
            {state.unit.totalFloors}
          </span>
        </footer>
      </div>
    </div>
  );
}

function UnitCard({
  unit,
  language,
  onPlan,
  onLead,
}: {
  unit: Unit;
  language: Language;
  onPlan: (unit: Unit, opener: HTMLButtonElement) => void;
  onLead: (unit: Unit) => void;
}) {
  const t = copy[language];
  return (
    <article className="ybc-unit-card">
      <header>
        <div>
          <small>{t.apartment}</small>
          <h2>№ {unit.number}</h2>
        </div>
        <StatusBadge unit={unit} language={language} />
      </header>
      <button
        className="ybc-plan-preview"
        type="button"
        onClick={(event) => onPlan(unit, event.currentTarget)}
        aria-label={`${t.openPlan}: № ${unit.number}`}
      >
        <img
          src={asset(unit.plan)}
          alt={`${t.plan} № ${unit.number}`}
          loading="lazy"
          decoding="async"
        />
        <span>{t.openPlan} ↗</span>
      </button>
      <div className="ybc-unit-card__summary">
        <strong>{roomLabel(unit.rooms, language)}</strong>
        <span>{number(unit.area, language, 2)} m²</span>
        <span>
          {t.groupShort} {unit.buildingDisplay}
        </span>
      </div>
      <UnitFacts unit={unit} language={language} />
      <Price unit={unit} language={language} detailed />
      <div className="ybc-unit-card__actions">
        <button type="button" data-lead-trigger onClick={() => onLead(unit)}>
          {t.choose}
          <span>↗</span>
        </button>
      </div>
      <SourceDetails unit={unit} language={language} />
    </article>
  );
}

function UnitDetail({
  selection,
  language,
  mobile,
  obscured,
  onClose,
  onPlan,
  onLead,
}: {
  selection: Selection;
  language: Language;
  mobile: boolean;
  obscured: boolean;
  onClose: () => void;
  onPlan: (unit: Unit, opener: HTMLButtonElement) => void;
  onLead: (unit: Unit) => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  const unit = selection.unit;
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    closeRef.current?.focus({ preventScroll: true });
  }, [selection.opener, unit.id]);
  useEffect(() => {
    const release = mobile ? lockYangiBaxtBody() : null;
    const key = (event: KeyboardEvent) => {
      if (document.querySelector(".lead-modal,.ybc-plan-lightbox")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!mobile || event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),summary,[href]",
        ),
      );
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      release?.();
    };
  }, [mobile, onClose]);
  return (
    <>
      <div
        className="ybc-detail-backdrop"
        aria-hidden="true"
        onMouseDown={onClose}
      />
      <aside
        ref={panelRef}
        id={`ybc-detail-${unit.id}`}
        className="ybc-unit-detail"
        role={mobile ? "dialog" : "region"}
        aria-modal={mobile || undefined}
        aria-labelledby={`ybc-detail-title-${unit.id}`}
        aria-hidden={obscured || undefined}
        inert={obscured ? true : undefined}
      >
        <header>
          <div>
            <small>{t.selected}</small>
            <h2 id={`ybc-detail-title-${unit.id}`}>№ {unit.number}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t.closeDetails}
          >
            ×
          </button>
        </header>
        <StatusBadge unit={unit} language={language} />
        <button
          className="ybc-detail-plan"
          type="button"
          onClick={(event) => onPlan(unit, event.currentTarget)}
        >
          <img
            src={asset(unit.plan)}
            alt={`${t.plan} № ${unit.number}`}
            loading="lazy"
          />
          <span>{t.openPlan} ↗</span>
        </button>
        <strong className="ybc-detail-rooms">
          {roomLabel(unit.rooms, language)}
        </strong>
        <UnitFacts unit={unit} language={language} compact />
        <Price unit={unit} language={language} detailed />
        <button
          className="ybc-detail-cta"
          type="button"
          data-lead-trigger
          onClick={() => onLead(unit)}
        >
          {t.choose}
          <span>↗</span>
        </button>
        <SourceDetails unit={unit} language={language} />
      </aside>
    </>
  );
}

function MatrixGroup({
  group,
  units,
  rank,
  sort,
  language,
  selected,
  onSelect,
}: {
  group: Group;
  units: Unit[];
  rank: ReadonlyMap<string, number>;
  sort: Sort;
  language: Language;
  selected: Selection | null;
  onSelect: (unit: Unit, opener: HTMLButtonElement) => void;
}) {
  const t = copy[language];
  const groupUnits = units.filter((unit) => unit.buildingId === group.id);
  return (
    <section
      className="ybc-matrix-group"
      aria-labelledby={`ybc-group-${group.id}`}
    >
      <header>
        <span className="ybc-route-chip">
          {t.groupShort} {group.displayName}
        </span>
        <h2 id={`ybc-group-${group.id}`}>
          {groupUnits.length} / {group.count}{" "}
          {recordLabel(group.count, language)}
        </h2>
        <span>{date(group.normalizedDeadline, language)}</span>
      </header>
      {groupUnits.length === 0 ? (
        <p className="ybc-matrix-group__empty">{t.noMatrix}</p>
      ) : null}
      {group.entrances.map((entrance) => {
        const entranceUnits = groupUnits.filter(
          (unit) => unit.entrance === entrance.entrance,
        );
        const sourceEntranceUnits = snapshot.units.filter(
          (unit) =>
            unit.buildingId === group.id && unit.entrance === entrance.entrance,
        );
        const maxColumns = Math.max(
          1,
          ...Array.from(
            { length: entrance.maxFloor },
            (_, index) =>
              sourceEntranceUnits.filter((unit) => unit.floor === index + 1)
                .length,
          ),
        );
        return (
          <MatrixEntrance
            key={`${group.id}-${entrance.entrance}`}
            group={group}
            entrance={entrance.entrance}
            maxFloor={entrance.maxFloor}
            units={entranceUnits}
            rank={rank}
            sort={sort}
            maxColumns={maxColumns}
            language={language}
            selected={selected}
            onSelect={onSelect}
          />
        );
      })}
    </section>
  );
}

function MatrixEntrance({
  group,
  entrance,
  maxFloor,
  units,
  rank,
  sort,
  maxColumns,
  language,
  selected,
  onSelect,
}: {
  group: Group;
  entrance: number;
  maxFloor: number;
  units: Unit[];
  rank: ReadonlyMap<string, number>;
  sort: Sort;
  maxColumns: number;
  language: Language;
  selected: Selection | null;
  onSelect: (unit: Unit, opener: HTMLButtonElement) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const floors = Array.from({ length: maxFloor }, (_, index) =>
    sort === "floorAsc" ? index + 1 : maxFloor - index,
  );
  const scroll = (amount: number) =>
    scrollRef.current?.scrollBy({
      left: amount,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const node = scrollRef.current;
    if (!node) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scroll(-260);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      scroll(260);
    } else if (event.key === "Home") {
      event.preventDefault();
      node.scrollTo({ left: 0 });
    } else if (event.key === "End") {
      event.preventDefault();
      node.scrollTo({ left: node.scrollWidth });
    }
  };
  return (
    <article
      className="ybc-matrix-entrance"
      data-group={group.displayName}
      data-entrance={entrance}
    >
      <div className="ybc-matrix-entrance__head">
        <div>
          <small>{t.entranceTitle}</small>
          <strong>{entrance}</strong>
          <span>
            {units.length} {recordLabel(units.length, language)} ·{" "}
            {t.maxFloorLabel} {maxFloor}
          </span>
        </div>
        <div>
          <button
            type="button"
            onClick={() => scroll(-320)}
            aria-label={t.scrollLeft}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => scroll(320)}
            aria-label={t.scrollRight}
          >
            →
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="ybc-matrix-scroll"
        role="region"
        aria-label={`${t.groupShort} ${group.displayName}, ${t.entranceTitle} ${entrance}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          className="ybc-matrix"
          style={{ "--ybc-columns": maxColumns } as CSSProperties}
        >
          {floors.map((floor) => {
            const floorUnits = units
              .filter((unit) => unit.floor === floor)
              .sort(
                (left, right) =>
                  (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                  (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER),
              );
            return (
              <div
                className={`ybc-floor-row${floorUnits.length === 0 ? " is-empty" : ""}`}
                key={floor}
                data-ybc-floor-row
                data-floor={floor}
              >
                <div className="ybc-floor-number">
                  <strong>{floor}</strong>
                  <span>{t.floorTitle}</span>
                  <small>
                    {floorUnits.length}{" "}
                    {unitsOnFloorLabel(floorUnits.length, language)}
                  </small>
                </div>
                <div className="ybc-floor-units">
                  {floorUnits.length === 0 ? (
                    <span className="ybc-floor-empty">{t.emptyFloor}</span>
                  ) : (
                    floorUnits.map((unit) => (
                      <button
                        type="button"
                        key={unit.id}
                        className={
                          selected?.unit.id === unit.id
                            ? "is-selected"
                            : undefined
                        }
                        data-ybc-unit-cell
                        data-unit-number={unit.number}
                        data-tone={statusTone(unit.statusOriginal)}
                        aria-pressed={selected?.unit.id === unit.id}
                        aria-expanded={selected?.unit.id === unit.id}
                        aria-controls={
                          selected?.unit.id === unit.id
                            ? `ybc-detail-${unit.id}`
                            : undefined
                        }
                        onClick={(event) => onSelect(unit, event.currentTarget)}
                        aria-label={`${t.apartment} № ${unit.number}, ${roomLabel(unit.rooms, language)}, ${number(unit.area, language, 2)} m², ${status(unit, language)}, ${money(unit.price, language)}`}
                      >
                        <span>№ {unit.number}</span>
                        <strong>{roomLabel(unit.rooms, language)}</strong>
                        <small>{number(unit.area, language, 2)} m²</small>
                        <em>{shortMoney(unit.price, language)}</em>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </article>
  );
}

function FiltersPanel({
  filters,
  language,
  onChange,
  onReset,
}: {
  filters: Filters;
  language: Language;
  onChange: (key: keyof Filters, value: string) => void;
  onReset: () => void;
}) {
  const t = copy[language];
  return (
    <section className="ybc-filters" aria-labelledby="ybc-filters-title">
      <header>
        <h2 id="ybc-filters-title">{t.filters}</h2>
        <button type="button" onClick={onReset}>
          {t.reset}
        </button>
      </header>
      <div className="ybc-filter-grid">
        <label>
          <span>{t.rooms}</span>
          <select
            value={filters.rooms}
            onChange={(event) => onChange("rooms", event.target.value)}
          >
            <option value="all">
              {t.any} · {snapshot.units.length}
            </option>
            {snapshot.filterSummary.rooms.map((item) => (
              <option key={item.value} value={item.value}>
                {item.value} · {item.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.areaFrom}</span>
          <input
            type="number"
            inputMode="decimal"
            min={snapshot.filterSummary.ranges.area.min}
            max={snapshot.filterSummary.ranges.area.max}
            value={filters.areaFrom}
            onChange={(event) => onChange("areaFrom", event.target.value)}
            placeholder={String(snapshot.filterSummary.ranges.area.min)}
          />
        </label>
        <label>
          <span>{t.areaTo}</span>
          <input
            type="number"
            inputMode="decimal"
            min={snapshot.filterSummary.ranges.area.min}
            max={snapshot.filterSummary.ranges.area.max}
            value={filters.areaTo}
            onChange={(event) => onChange("areaTo", event.target.value)}
            placeholder={String(snapshot.filterSummary.ranges.area.max)}
          />
        </label>
        <label>
          <span>{t.priceFrom}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={filters.priceFrom}
            onChange={(event) => onChange("priceFrom", event.target.value)}
            placeholder={number(
              snapshot.filterSummary.ranges.snapshotPrice.min / 1e6,
              language,
              1,
            )}
          />
        </label>
        <label>
          <span>{t.priceTo}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={filters.priceTo}
            onChange={(event) => onChange("priceTo", event.target.value)}
            placeholder={number(
              snapshot.filterSummary.ranges.snapshotPrice.max / 1e6,
              language,
              1,
            )}
          />
        </label>
        <label>
          <span>{t.floor}</span>
          <select
            value={filters.floor}
            onChange={(event) => onChange("floor", event.target.value)}
          >
            <option value="all">{t.any}</option>
            {Array.from(
              { length: snapshot.filterSummary.ranges.floor.max },
              (_, index) => index + 1,
            ).map((floor) => (
              <option key={floor} value={floor}>
                {floor} ·{" "}
                {snapshot.units.filter((unit) => unit.floor === floor).length}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.group}</span>
          <select
            value={filters.building}
            onChange={(event) => onChange("building", event.target.value)}
          >
            <option value="all">
              {t.any} · {snapshot.units.length}
            </option>
            {snapshot.filterSummary.groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.displayName} · {group.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.entrance}</span>
          <select
            value={filters.entrance}
            onChange={(event) => onChange("entrance", event.target.value)}
          >
            <option value="all">{t.any}</option>
            {snapshot.filterSummary.entrances.map((item) => (
              <option key={item.value} value={item.value}>
                {item.value} · {item.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.status}</span>
          <select
            value={filters.status}
            onChange={(event) => onChange("status", event.target.value)}
          >
            <option value="all">
              {t.any} · {snapshot.units.length}
            </option>
            {snapshot.filterSummary.statuses.map((item) => (
              <option key={item.value} value={item.value}>
                {(t.statuses as Record<string, string>)[item.value]} ·{" "}
                {item.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.completion}</span>
          <select
            value={filters.completion}
            onChange={(event) => onChange("completion", event.target.value)}
          >
            <option value="all">{t.any}</option>
            {snapshot.filterSummary.deadlines.map((item) => (
              <option key={item.value} value={item.value}>
                {date(item.value, language)} · {item.count}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t.repair}</span>
          <select
            value={filters.repair}
            onChange={(event) => onChange("repair", event.target.value)}
          >
            <option value="all">
              {t.any} · {snapshot.units.length}
            </option>
            <option value="yes">
              {t.yes} · {snapshot.filterSummary.repairIncluded.true}
            </option>
            <option value="no">
              {t.no} · {snapshot.filterSummary.repairIncluded.false}
            </option>
          </select>
        </label>
        <label>
          <span>{t.studio}</span>
          <select
            value={filters.studio}
            onChange={(event) => onChange("studio", event.target.value)}
          >
            <option value="all">
              {t.any} · {snapshot.units.length}
            </option>
            <option value="yes">
              {t.yes} · {snapshot.filterSummary.studio.true}
            </option>
            <option value="no">
              {t.no} · {snapshot.filterSummary.studio.false}
            </option>
          </select>
        </label>
      </div>
    </section>
  );
}

export function YangiBaxtCatalog({
  initialLanguage,
}: {
  initialLanguage: Language;
}) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sort, setSort] = useState<Sort>("source");
  const [mode, setMode] = useState<Mode>("cards");
  const [shown, setShown] = useState(24);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [planState, setPlanState] = useState<PlanState | null>(null);
  const [leadRequest, setLeadRequest] = useState<LeadRequest | null>(null);
  const mobile = useMobileDrawer();
  const t = copy[language];
  const closePlan = useCallback(() => setPlanState(null), []);
  const closeDetail = useCallback(() => {
    const opener = selection?.opener;
    setSelection(null);
    if (opener)
      window.requestAnimationFrame(
        () => opener.isConnected && opener.focus({ preventScroll: true }),
      );
  }, [selection]);
  const closeLead = useCallback(() => setLeadRequest(null), []);
  useEffect(() => {
    document.body.classList.add("yb-catalog-active");
    return () => document.body.classList.remove("yb-catalog-active");
  }, []);
  useEffect(
    () => (leadRequest ? lockYangiBaxtBody() : undefined),
    [leadRequest],
  );
  const filtered = useMemo(
    () =>
      snapshot.units
        .filter((unit) => {
          const areaFrom = Number(filters.areaFrom),
            areaTo = Number(filters.areaTo),
            priceFrom = Number(filters.priceFrom) * 1e6,
            priceTo = Number(filters.priceTo) * 1e6;
          return (
            (filters.rooms === "all" || unit.rooms === Number(filters.rooms)) &&
            (!areaFrom || unit.area >= areaFrom) &&
            (!areaTo || unit.area <= areaTo) &&
            (!priceFrom || unit.price >= priceFrom) &&
            (!priceTo || unit.price <= priceTo) &&
            (filters.floor === "all" || unit.floor === Number(filters.floor)) &&
            (filters.building === "all" ||
              unit.buildingId === filters.building) &&
            (filters.entrance === "all" ||
              unit.entrance === Number(filters.entrance)) &&
            (filters.status === "all" ||
              unit.statusOriginal === filters.status) &&
            (filters.completion === "all" ||
              unit.completionDate === filters.completion) &&
            (filters.repair === "all" ||
              unit.repairIncluded === (filters.repair === "yes")) &&
            (filters.studio === "all" ||
              unit.studio === (filters.studio === "yes"))
          );
        })
        .sort((a, b) => compare(a, b, sort)),
    [filters, sort],
  );
  const matrixRank = useMemo(
    () => new Map(filtered.map((unit, index) => [unit.id, index])),
    [filtered],
  );
  const setFilter = (key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setShown(24);
    setSelection(null);
  };
  const resetFilters = () => {
    setFilters(defaultFilters);
    setShown(24);
    setSelection(null);
  };
  const openPlan = (unit: Unit, opener: HTMLButtonElement) => {
    remember(unit);
    setPlanState({ unit, opener, view: "apartment" });
  };
  const openLead = (unit: Unit | null, surface: string) => {
    if (unit) remember(unit);
    setLeadRequest({ unit, surface });
  };
  const selectUnit = (unit: Unit, opener: HTMLButtonElement) => {
    remember(unit);
    setSelection({ unit, opener });
  };
  const unitContext = leadRequest?.unit
    ? [
        "projectSlug=yangibaxt",
        `lang=${language}`,
        `surface=catalog:${leadRequest.surface}`,
        `unitUuid=${leadRequest.unit.id}`,
        `number=${leadRequest.unit.number}`,
        `buildingId=${leadRequest.unit.buildingId}`,
        `building=${leadRequest.unit.building}`,
        `entrance=${leadRequest.unit.entrance}`,
        `floor=${leadRequest.unit.floor}/${leadRequest.unit.totalFloors}`,
        `rooms=${leadRequest.unit.rooms}`,
        `area=${leadRequest.unit.area}`,
        `completion=${leadRequest.unit.completionDate}`,
        `workflowStatus=${leadRequest.unit.statusOriginal}`,
        `isSale=${leadRequest.unit.isSale}`,
        `repairIncluded=${leadRequest.unit.repairIncluded}`,
        `studio=${leadRequest.unit.studio}`,
        `price=${leadRequest.unit.price}`,
      ].join(";")
    : `projectSlug=yangibaxt;lang=${language};surface=catalog:${leadRequest?.surface ?? "general"};unit=general`;
  const modeKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next = index;
    if (event.key === "ArrowLeft")
      next = (index + modes.length - 1) % modes.length;
    else if (event.key === "ArrowRight") next = (index + 1) % modes.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = modes.length - 1;
    else return;
    event.preventDefault();
    setMode(modes[next]);
    document.getElementById(`ybc-mode-${modes[next]}`)?.focus();
  };
  return (
    <div id="top" className="yangibaxt-catalog-site" lang={language}>
      <a className="ybc-skip" href="#results">
        {t.skip}
      </a>
      <header className="ybc-header">
        <a href={withLanguage("/yangibaxt", language)}>
          {t.back}
          <span>←</span>
        </a>
        <strong>YANGI BAXT</strong>
        <nav aria-label={t.nav}>
          <div aria-label={t.language}>
            {languages.map((item) => (
              <button
                type="button"
                key={item}
                aria-current={item === language ? "true" : undefined}
                onClick={() => setLanguage(item)}
              >
                {item.toUpperCase()}
              </button>
            ))}
          </div>
          <a href="tel:1360">{t.call}</a>
          <button
            type="button"
            data-lead-trigger
            onClick={() => openLead(null, "header")}
          >
            {t.consult}
          </button>
        </nav>
      </header>
      <main>
        <section className="ybc-hero">
          <div>
            <span>{t.eyebrow}</span>
            <h1>
              {t.title}
              <br />
              <em>{t.accent}</em>
            </h1>
            <p>
              {t.leadBefore} <strong>{snapshot.officialTotalAtCapture}</strong>{" "}
              {t.leadAfter}
            </p>
            <button
              type="button"
              data-lead-trigger
              onClick={() => openLead(null, "hero")}
            >
              {t.consult}
              <span>↗</span>
            </button>
          </div>
          <figure>
            <img
              src={asset("/yangibaxt/images/hero-real.webp")}
              alt={t.allApartments}
            />
            <figcaption>{t.allApartments}</figcaption>
          </figure>
          <dl>
            <div>
              <dt>30.08.2026</dt>
              <dd>{t.snapshot}</dd>
            </div>
            <div>
              <dt>{captured(snapshot.capturedAt, language)}</dt>
              <dd>{t.captured}</dd>
            </div>
            <div>
              <dt>{snapshot.officialTotalAtCapture}</dt>
              <dd>{recordLabel(snapshot.officialTotalAtCapture, language)}</dd>
            </div>
            <div>
              <dt>{snapshot.offerCount}</dt>
              <dd>{t.offers}</dd>
            </div>
            <div>
              <dt>5</dt>
              <dd>{t.groups}</dd>
            </div>
            <div>
              <dt>265 × 2</dt>
              <dd>{t.plans}</dd>
            </div>
          </dl>
        </section>
        <section className="ybc-workspace">
          <FiltersPanel
            filters={filters}
            language={language}
            onChange={setFilter}
            onReset={resetFilters}
          />
          <details className="ybc-snapshot-note">
            <summary>
              <span>i</span>
              <strong>{t.sourceTitle}</strong>
              <em>＋</em>
            </summary>
            <div><p>{t.sourceText}</p></div>
          </details>
          <div className="ybc-toolbar">
            <div className="ybc-modes" role="tablist" aria-label={t.modeLabel}>
              {modes.map((item, index) => (
                <button
                  id={`ybc-mode-${item}`}
                  type="button"
                  role="tab"
                  key={item}
                  aria-selected={mode === item}
                  tabIndex={mode === item ? 0 : -1}
                  onClick={() => setMode(item)}
                  onKeyDown={(event) => modeKey(event, index)}
                >
                  {t.modes[item]}
                </button>
              ))}
            </div>
            <p>
              <strong>{filtered.length}</strong> {t.results}
            </p>
            <label>
              <span>{t.sort}</span>
              <select
                value={sort}
                onChange={(event) => {
                  setSort(event.target.value as Sort);
                  setShown(24);
                }}
              >
                {(Object.keys(t.sorts) as Sort[]).map((value) => (
                  <option key={value} value={value}>
                    {t.sorts[value]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            id="results"
            className="ybc-results"
            role="tabpanel"
            aria-labelledby={`ybc-mode-${mode}`}
          >
            {mode === "cards" ? (
              filtered.length === 0 ? (
                <div className="ybc-empty">
                  <span>○</span>
                  <h2>{t.empty}</h2>
                  <button type="button" onClick={resetFilters}>
                    {t.resetFilters}
                  </button>
                </div>
              ) : (
                <>
                  <div className="ybc-card-grid">
                    {filtered.slice(0, shown).map((unit) => (
                      <UnitCard
                        key={unit.id}
                        unit={unit}
                        language={language}
                        onPlan={openPlan}
                        onLead={(value) => openLead(value, "card-cta")}
                      />
                    ))}
                  </div>
                  <div className="ybc-show-more">
                    <p>
                      {t.shown} {Math.min(shown, filtered.length)} {t.of}{" "}
                      {filtered.length}
                    </p>
                    {shown < filtered.length ? (
                      <button
                        type="button"
                        onClick={() => setShown((value) => value + 24)}
                      >
                        {t.showMore}
                        <span>＋</span>
                      </button>
                    ) : null}
                  </div>
                </>
              )
            ) : (
              <>
                <div className="ybc-matrix-intro">
                  <h2>{t.matrix}</h2>
                  <p>{t.matrixHint}</p>
                </div>
                <div className="ybc-matrix-layout has-detail">
                  <div>
                    {snapshot.filterSummary.groups.map((group) => (
                      <MatrixGroup
                        key={group.id}
                        group={group}
                        units={filtered}
                        rank={matrixRank}
                        sort={sort}
                        language={language}
                        selected={selection}
                        onSelect={selectUnit}
                      />
                    ))}
                  </div>
                  {selection ? (
                      <UnitDetail
                        selection={selection}
                        language={language}
                        mobile={mobile}
                        obscured={Boolean(planState || leadRequest)}
                        onClose={closeDetail}
                        onPlan={openPlan}
                        onLead={(unit) => openLead(unit, "matrix-detail")}
                      />
                    ) : (
                      <aside className="ybc-detail-empty">
                        <span>↖</span>
                        <p>{t.selectHint}</p>
                      </aside>
                    )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <footer className="ybc-footer">
        <div>
          <strong>{t.home}</strong>
          <a href={withLanguage("/yangibaxt", language)}>{t.back} ↗</a>
        </div>
        <p>{t.disclaimer}</p>
        <nav>
          <a href={privacyUrl(language)}>{t.privacy}</a>
          <a href="tel:1360">1360</a>
          <a href="#top">{t.top} ↑</a>
        </nav>
      </footer>
      {planState ? (
        <PlanLightbox
          state={planState}
          language={language}
          onClose={closePlan}
        />
      ) : null}
      <LeadModal
        open={Boolean(leadRequest)}
        language={language}
        context={unitContext}
        brandName="NRG-BI"
        projectName="YANGI BAXT"
        tagline={t.formTagline}
        facts={t.formFacts}
        submitUrl={yangiBaxtLeadSubmitUrl()}
        projectSlug="yangibaxt"
        unitId={leadRequest?.unit?.id}
        privacyUrl={privacyUrl(language)}
        requireConsent
        onClose={closeLead}
      />
    </div>
  );
}
