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
import { LeadModal, rememberLastViewedApartment } from "@/app/lead-modal";
import { jomiyLeadSubmitUrl } from "../jomiy-lead";
import {
  lockJomiyBody,
  type JomiyLanguage as Language,
  jomiyLocale,
} from "../jomiy-ui";

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
  thumbnail: string;
  sheetPage1: string;
  sheetPage2: string;
  planSourceUrls: {
    primaryLayout: string;
    apartmentSheetURLPage1: string;
    apartmentSheetURLPage2: string;
  };
  statusOriginal: string;
  statusId: string;
  isSale: boolean;
  canBuy: boolean;
  strictOfferEligible: boolean;
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
type PlanState = Selection & { view: "page1" | "page2" };
type LeadRequest = { unit: Unit | null; surface: string };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const appBasePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) =>
  `${appBasePath}${path}?lang=${language}`;
const privacyUrl = (language: Language) =>
  `${appBasePath}/privacy?project=jomiy&lang=${language}&from=catalog`;
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
    consult: "Уточнить доступность",
    call: "1360",
    eyebrow: "POETIC LATTICE · СРЕЗ 30.08.2026",
    title: "Каталог",
    accent: "без домыслов.",
    leadBefore: "В официальном квартирном каталоге",
    leadAfter:
      "предложение / позиция. Явного статуса «Свободно» нет: показываем точный этап каждой записи.",
    snapshot: "Дата среза",
    captured: "Зафиксировано",
    records: "позиций",
    offers: "Offers · строгая политика",
    groups: "группы",
    plans: "официальных листов",
    allApartments: "121 позиция · только квартиры · без смешанного инвентаря",
    heroPhoto: "Реальная фотография готовой части Jomiy",
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
    group: "Очередь / группа",
    entrance: "Подъезд",
    status: "Raw-статус",
    completion: "Нормализованный срок",
    repair: "Отделка",
    studio: "Studio · отметка API",
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
    apartment: "Позиция",
    roomsShort: "комн.",
    area: "Площадь",
    snapshotPrice: "Цена среза",
    rawPrice: "Обычная цена",
    pricePerM2: "за м²",
    campaignPrice: "Цена кампании в срезе",
    expiredSnapshot: "Завершённая цена кампании в срезе",
    rawFallback: "Обычная цена · кампания не указана",
    campaignUntil: "Срок кампании",
    campaignActive: "Срок кампании ещё не истёк",
    campaignExpired:
      "Кампания завершена — скидка не представляется действующей",
    currentTerms: "Текущие условия и доступность подтверждает отдел продаж.",
    floorOf: "Этаж",
    entranceShort: "Подъезд",
    groupShort: "Группа",
    completionShort: "Срок",
    finishing: "С отделкой",
    noFinishing: "Без отделки",
    studioTrue: "Studio: да",
    studioFalse: "Studio: нет",
    propertyClass: "Класс",
    businessClass: "Бизнес",
    ceiling: "Высота потолка",
    balcony: "Балкон",
    statusNote: "Точный статус официального каталога",
    statuses: {
      Свободно: "Свободно",
      "Снятие резерва": "Снятие резерва",
      Расторжение: "Расторжение",
      "Снятие брони": "Снятие брони",
      Бронирование: "Бронирование",
    },
    plan: "Лист 1 · положение на этаже",
    position: "Лист 2 · план квартиры",
    compactPlan: "Компактная официальная планировка",
    openPlan: "Открыть два листа",
    choose: "Уточнить доступность",
    details: "Подробнее",
    showMore: "Показать ещё",
    shown: "Показано",
    of: "из",
    empty: "По этим параметрам позиций нет.",
    resetFilters: "Сбросить фильтры",
    emptyLead: "Попросить индивидуальный подбор",
    source: "Источник и UUID",
    rawGroup: "Raw API группа",
    rawStatus: "Raw API статус / eligibility",
    rawHeight: "Raw API высота",
    unitUuid: "UUID",
    detailHash: "Detail response SHA-256",
    normalizedDeadline: "Срок filter/realEstateList",
    placementDeadline: "Raw placementList срок",
    matrix: "84 стабильные строки шахматки",
    matrixHint:
      "Две группы образуют семь реальных комбинаций «группа × подъезд»; в каждой — 12 этажей, итого 84 стабильные строки. Пустые этажи остаются на месте после фильтрации. Прокрутка: палец, трекпад, кнопки, ← → Home End.",
    entranceTitle: "Подъезд",
    floorTitle: "Этаж",
    maxFloorLabel: "макс. этаж",
    unitsOnFloor: "позиций на этаже",
    emptyFloor: "Нет позиций по фильтру",
    scrollLeft: "Прокрутить влево",
    scrollRight: "Прокрутить вправо",
    noMatrix: "В этой группе нет позиций по фильтру.",
    selected: "Выбранная позиция",
    closeDetails: "Закрыть детали",
    selectHint:
      "Выберите позицию в шахматке: справа откроется полная карточка с двумя листами и CTA.",
    closePlan: "Закрыть планировку",
    planViews: "Две официальные страницы планировки",
    sourceTitle: "Что означает этот каталог",
    sourceText:
      "Все 121 позиции получены одной согласованной выгрузкой API 30.08.2026 в 23:47 UZT. Повтор page 1 побайтно совпал, page 2 пуста, захвачены все 121 detail. placementCount 251 — смешанный инвентарь и не используется как счётчик квартир. Статус процесса не гарантирует доступность.",
    disclaimer:
      "Срез, цены и статусы зафиксированы 30.08.2026 и не являются публичной офертой. Кампании после дедлайна помечаются завершёнными. Наличие, стоимость и условия подтверждает отдел продаж.",
    privacy: "Обработка персональных данных",
    top: "Наверх",
    home: "Jomiy",
    formTagline: "Вдохновлённый поэзией.",
    formFacts: ["121 позиция", "2 группы", "0 статусов «Свободно»"] as const,
  },
  uz: {
    skip: "Katalog natijalariga o‘tish",
    back: "Loyiha haqida",
    nav: "Katalog navigatsiyasi",
    language: "Til",
    consult: "Mavjudligini aniqlash",
    call: "1360",
    eyebrow: "POETIC LATTICE · 30.08.2026 NUSXASI",
    title: "Taxminsiz",
    accent: "katalog.",
    leadBefore: "Rasmiy xonadon katalogida",
    leadAfter:
      "ta taklif / pozitsiya bor. “Bo‘sh” holati yo‘q: har bir yozuvning aniq bosqichi ko‘rsatiladi.",
    snapshot: "Nusxa sanasi",
    captured: "Qayd etilgan vaqt",
    records: "pozitsiya",
    offers: "Offers · qat’iy siyosat",
    groups: "guruh",
    plans: "rasmiy varaq",
    allApartments: "121 pozitsiya · faqat xonadonlar · aralash inventarsiz",
    heroPhoto: "Jomiy tayyor qismining haqiqiy fotosurati",
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
    group: "Bosqich / guruh",
    entrance: "Kirish",
    status: "Raw-holat",
    completion: "Me’yorlashtirilgan muddat",
    repair: "Pardoz",
    studio: "Studio · API belgisi",
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
    apartment: "Pozitsiya",
    roomsShort: "xonali",
    area: "Maydon",
    snapshotPrice: "Nusxadagi narx",
    rawPrice: "Oddiy narx",
    pricePerM2: "m² uchun",
    campaignPrice: "Nusxadagi kampaniya narxi",
    expiredSnapshot: "Nusxadagi tugagan kampaniya narxi",
    rawFallback: "Oddiy narx · kampaniya ko‘rsatilmagan",
    campaignUntil: "Kampaniya muddati",
    campaignActive: "Kampaniya muddati hali tugamagan",
    campaignExpired: "Kampaniya tugagan — chegirma amaldagi deb ko‘rsatilmaydi",
    currentTerms: "Joriy shartlar va mavjudlikni savdo bo‘limi tasdiqlaydi.",
    floorOf: "Qavat",
    entranceShort: "Kirish",
    groupShort: "Guruh",
    completionShort: "Muddat",
    finishing: "Pardoz bilan",
    noFinishing: "Pardozsiz",
    studioTrue: "Studio: ha",
    studioFalse: "Studio: yo‘q",
    propertyClass: "Klass",
    businessClass: "Biznes",
    ceiling: "Shift balandligi",
    balcony: "Balkon",
    statusNote: "Rasmiy katalogdagi aniq holat",
    statuses: {
      Свободно: "Bo‘sh",
      "Снятие резерва": "Rezervdan chiqarish",
      Расторжение: "Bekor qilish",
      "Снятие брони": "Brondan chiqarish",
      Бронирование: "Bron qilish",
    },
    plan: "1-varaq · qavatdagi joylashuv",
    position: "2-varaq · xonadon rejasi",
    compactPlan: "Ixcham rasmiy reja",
    openPlan: "Ikki varaqni ochish",
    choose: "Mavjudligini aniqlash",
    details: "Batafsil",
    showMore: "Yana ko‘rsatish",
    shown: "Ko‘rsatildi",
    of: "dan",
    empty: "Bu parametrlar bo‘yicha pozitsiya yo‘q.",
    resetFilters: "Filtrlarni tozalash",
    emptyLead: "Shaxsiy tanlov so‘rash",
    source: "Manba va UUID",
    rawGroup: "Raw API guruhi",
    rawStatus: "Raw API holati / eligibility",
    rawHeight: "Raw API balandligi",
    unitUuid: "UUID",
    detailHash: "Detail javobi SHA-256",
    normalizedDeadline: "filter/realEstateList muddati",
    placementDeadline: "Raw placementList muddati",
    matrix: "Shaxmatkaning 84 barqaror qatori",
    matrixHint:
      "Ikki guruh “guruh × kirish”ning yettita haqiqiy kombinatsiyasini hosil qiladi; har birida 12 qavat, jami 84 ta barqaror qator. Filtrdan keyin bo‘sh qavatlar o‘z joyida qoladi. Barmoq, trekpad, tugmalar yoki ← → Home End bilan suring.",
    entranceTitle: "Kirish",
    floorTitle: "Qavat",
    maxFloorLabel: "eng yuqori qavat",
    unitsOnFloor: "qavatdagi pozitsiya",
    emptyFloor: "Filtrga mos pozitsiya yo‘q",
    scrollLeft: "Chapga surish",
    scrollRight: "O‘ngga surish",
    noMatrix: "Bu guruhda filtrga mos pozitsiya yo‘q.",
    selected: "Tanlangan pozitsiya",
    closeDetails: "Tafsilotlarni yopish",
    selectHint:
      "Shaxmatkadan pozitsiya tanlang: o‘ngda ikki varaq va CTA bilan to‘liq karta ochiladi.",
    closePlan: "Rejani yopish",
    planViews: "Rejaning ikki rasmiy sahifasi",
    sourceTitle: "Bu katalog nimani anglatadi",
    sourceText:
      "121 pozitsiyaning barchasi 30.08.2026 soat 23:47 UZT dagi yagona kelishilgan API nusxasidan olingan. Takroriy page 1 baytma-bayt mos, page 2 bo‘sh va barcha 121 detail saqlangan. placementCount 251 — aralash inventar, xonadonlar soni emas. Jarayon holati mavjudlikni kafolatlamaydi.",
    disclaimer:
      "Nusxa, narxlar va holatlar 30.08.2026 da qayd etilgan va ommaviy oferta emas. Muddatidan keyin kampaniya tugagan deb belgilanadi. Mavjudlik, narx va shartlarni savdo bo‘limi tasdiqlaydi.",
    privacy: "Shaxsiy ma’lumotlarni qayta ishlash",
    top: "Yuqoriga",
    home: "Jomiy",
    formTagline: "She’riyatdan ilhomlangan.",
    formFacts: ["121 pozitsiya", "2 guruh", "0 ta “Bo‘sh” holati"] as const,
  },
  en: {
    skip: "Skip to catalogue results",
    back: "About the project",
    nav: "Catalogue navigation",
    language: "Language",
    consult: "Check availability",
    call: "1360",
    eyebrow: "POETIC LATTICE · SNAPSHOT 30 AUG 2026",
    title: "A catalogue",
    accent: "without assumptions.",
    leadBefore: "The official apartment catalogue contains",
    leadAfter:
      "listings / entries. None has an explicit “Available” status; every workflow stage is shown exactly.",
    snapshot: "Snapshot date",
    captured: "Captured",
    records: "entries",
    offers: "Offers · strict policy",
    groups: "groups",
    plans: "official sheets",
    allApartments: "121 entries · apartments only · mixed inventory excluded",
    heroPhoto: "Real photograph of the completed part of Jomiy",
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
    group: "Phase / group",
    entrance: "Entrance",
    status: "Raw status",
    completion: "Normalised completion",
    repair: "Finishing",
    studio: "Studio · API flag",
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
    apartment: "Entry",
    roomsShort: "room",
    area: "Area",
    snapshotPrice: "Snapshot price",
    rawPrice: "Regular price",
    pricePerM2: "per m²",
    campaignPrice: "Campaign price in snapshot",
    expiredSnapshot: "Ended campaign price in the snapshot",
    rawFallback: "Regular price · no campaign listed",
    campaignUntil: "Campaign deadline",
    campaignActive: "The campaign deadline has not yet passed",
    campaignExpired: "Campaign ended — the discount is not presented as active",
    currentTerms: "The sales team confirms current terms and availability.",
    floorOf: "Floor",
    entranceShort: "Entrance",
    groupShort: "Group",
    completionShort: "Completion",
    finishing: "With finishing",
    noFinishing: "No finishing",
    studioTrue: "Studio: yes",
    studioFalse: "Studio: no",
    propertyClass: "Class",
    businessClass: "Business",
    ceiling: "Ceiling height",
    balcony: "Balcony",
    statusNote: "Exact status in the official catalogue",
    statuses: {
      Свободно: "Available",
      "Снятие резерва": "Reservation release",
      Расторжение: "Termination",
      "Снятие брони": "Booking release",
      Бронирование: "Booking",
    },
    plan: "Sheet 1 · floor position",
    position: "Sheet 2 · apartment plan",
    compactPlan: "Compact official layout",
    openPlan: "Open both sheets",
    choose: "Check availability",
    details: "Details",
    showMore: "Show more",
    shown: "Shown",
    of: "of",
    empty: "No entries match these filters.",
    resetFilters: "Reset filters",
    emptyLead: "Request a tailored selection",
    source: "Source and UUID",
    rawGroup: "Raw API group",
    rawStatus: "Raw API status / eligibility",
    rawHeight: "Raw API height",
    unitUuid: "UUID",
    detailHash: "Detail response SHA-256",
    normalizedDeadline: "filter/realEstateList completion",
    placementDeadline: "Raw placementList completion",
    matrix: "84 stable matrix rows",
    matrixHint:
      "Two groups form seven real “group × entrance” combinations; each has 12 floors, for 84 stable rows in total. Empty floors remain in place after filtering. Scroll by touch, trackpad, buttons, or ← → Home End.",
    entranceTitle: "Entrance",
    floorTitle: "Floor",
    maxFloorLabel: "max floor",
    unitsOnFloor: "entries on floor",
    emptyFloor: "No matching entries",
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
    noMatrix: "No matching entry in this group.",
    selected: "Selected entry",
    closeDetails: "Close details",
    selectHint:
      "Choose an entry in the matrix to open a full record with two sheets and an enquiry CTA.",
    closePlan: "Close plans",
    planViews: "Two official plan pages",
    sourceTitle: "What this catalogue means",
    sourceText:
      "All 121 entries came from one aligned API capture on 30 Aug 2026 at 23:47 UZT. The repeated page 1 was byte-identical, page 2 was empty and all 121 details were captured. placementCount 251 is mixed inventory, not an apartment count. A workflow status does not guarantee availability.",
    disclaimer:
      "The snapshot, prices and statuses were captured on 30 Aug 2026 and are not a public offer. Campaigns are marked ended after their deadline. The sales team confirms availability, price and terms.",
    privacy: "Personal data processing",
    top: "Back to top",
    home: "Jomiy",
    formTagline: "Inspired by poetry.",
    formFacts: ["121 entries", "2 groups", "0 “Available” statuses"] as const,
  },
} as const;

function locale(language: Language) {
  return jomiyLocale(language);
}
const uzShortMonths = [
  "yan",
  "fev",
  "mar",
  "apr",
  "may",
  "iyn",
  "iyl",
  "avg",
  "sen",
  "okt",
  "noy",
  "dek",
] as const;

function uzDateParts(value: string, timeZone: "UTC" | "Asia/Tashkent") {
  const source = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value,
  );
  const date =
    timeZone === "Asia/Tashkent"
      ? new Date(source.getTime() + 5 * 60 * 60 * 1000)
      : source;
  return {
    day: date.getUTCDate(),
    month: uzShortMonths[date.getUTCMonth()],
    year: date.getUTCFullYear(),
    hour: String(date.getUTCHours()).padStart(2, "0"),
    minute: String(date.getUTCMinutes()).padStart(2, "0"),
    second: String(date.getUTCSeconds()).padStart(2, "0"),
  };
}

function uzDate(value: string, timeZone: "UTC" | "Asia/Tashkent") {
  const { day, month, year } = uzDateParts(value, timeZone);
  return `${day}-${month}, ${year}`;
}

function uzNumber(
  value: number,
  maximumFractionDigits = 0,
  minimumFractionDigits = 0,
) {
  const fixed = Math.abs(value).toFixed(maximumFractionDigits);
  const [rawInteger, rawFraction = ""] = fixed.split(".");
  const integer = rawInteger.replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  const trimmedFraction = rawFraction.replace(/0+$/, "");
  const fraction = trimmedFraction.padEnd(minimumFractionDigits, "0");
  return `${value < 0 ? "−" : ""}${integer}${fraction ? `,${fraction}` : ""}`;
}
function number(value: number, language: Language, digits = 0) {
  if (language === "uz") return uzNumber(value, digits);
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
  if (language === "uz") return uzDate(value, "UTC");
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
  if (language === "uz") {
    const parts = uzDateParts(value, "Asia/Tashkent");
    return `${parts.day}-${parts.month}, ${parts.year}, ${parts.hour}:${parts.minute}`;
  }
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
function campaignDeadline(value: string, language: Language) {
  if (language === "uz") {
    const parts = uzDateParts(value, "Asia/Tashkent");
    return `${parts.day}-${parts.month}, ${parts.year}, ${parts.hour}:${parts.minute}:${parts.second} UZT`;
  }
  const formatted = new Intl.DateTimeFormat(locale(language), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
  return `${formatted} UZT`;
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
  if (!matched) return value;
  const height =
    language === "uz"
      ? uzNumber(Number(matched), 1, 1)
      : new Intl.NumberFormat(locale(language), {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }).format(Number(matched));
  const qualifier =
    language === "ru" ? "Не менее" : language === "uz" ? "Kamida" : "At least";
  return `${qualifier} ${height} ${language === "ru" ? "м" : "m"}`;
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
function compare(a: Unit, b: Unit, sort: Sort, evaluationTime: number) {
  const tie = a.sourceOrder - b.sourceOrder;
  const aPrice = displayPriceAt(a, evaluationTime);
  const bPrice = displayPriceAt(b, evaluationTime);
  if (sort === "source") return tie;
  if (sort === "priceAsc") return aPrice - bPrice || tie;
  if (sort === "priceDesc") return bPrice - aPrice || tie;
  if (sort === "areaAsc") return a.area - b.area || tie;
  if (sort === "areaDesc") return b.area - a.area || tie;
  if (sort === "floorAsc") return a.floor - b.floor || tie;
  if (sort === "floorDesc") return b.floor - a.floor || tie;
  if (sort === "roomsAsc") return a.rooms - b.rooms || tie;
  if (sort === "roomsDesc") return b.rooms - a.rooms || tie;
  const aPricePerM2 = Math.round(aPrice / a.area);
  const bPricePerM2 = Math.round(bPrice / b.area);
  if (sort === "ppmAsc") return aPricePerM2 - bPricePerM2 || tie;
  return bPricePerM2 - aPricePerM2 || tie;
}

function usePromotionClock(initialEvaluationTime: number, promotionDeadlines: number[]) {
  const [evaluationTime, setEvaluationTime] = useState(initialEvaluationTime);
  useEffect(() => {
    const timer = window.setInterval(
      () => setEvaluationTime(Date.now()),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const now = Date.now();
    const nearest = promotionDeadlines
      .filter((deadline) => deadline >= now)
      .sort((left, right) => left - right)[0];
    if (nearest === undefined) return;
    const delay = nearest - now + 1;
    if (delay > 2_147_000_000) return;
    const deadlineTimer = window.setTimeout(
      () => setEvaluationTime(Date.now()),
      Math.max(0, delay),
    );
    return () => window.clearTimeout(deadlineTimer);
  }, [evaluationTime, promotionDeadlines]);
  return evaluationTime;
}

function promotionIsActive(unit: Unit, evaluationTime: number) {
  const deadline = unit.promotion?.deadlineUtc;
  const deadlineTime = deadline ? Date.parse(deadline) : Number.NaN;
  return (
    Boolean(unit.promotion) &&
    unit.oldPrice > unit.price &&
    Number.isFinite(deadlineTime) &&
    evaluationTime < deadlineTime
  );
}

function displayPriceAt(unit: Unit, evaluationTime: number) {
  return unit.promotion &&
    unit.oldPrice > unit.price &&
    !promotionIsActive(unit, evaluationTime)
    ? unit.oldPrice
    : unit.price;
}

function leadPriceSnapshotAt(unit: Unit, evaluationTime: number) {
  const campaignActive = promotionIsActive(unit, evaluationTime);
  const effectivePrice = displayPriceAt(unit, evaluationTime);
  return {
    price: effectivePrice,
    effectivePrice,
    displayPrice: effectivePrice,
    regularPrice: unit.oldPrice,
    snapshotCampaignPrice: unit.price,
    campaignActive,
    campaignDeadline: unit.promotion?.deadlineUtc ?? null,
  };
}

function remember(unit: Unit, evaluationTime: number) {
  const pricing = leadPriceSnapshotAt(unit, evaluationTime);
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
      ...pricing,
      normalizedDeadline: unit.completionDate,
      sourceStatus: unit.statusOriginal,
      studio: unit.studio,
    },
    "jomiy",
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
        stored = localStorage.getItem("jomiy-language");
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
      localStorage.setItem("jomiy-language", initialLanguage);
    } catch {
      /* URL remains authoritative. */
    }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (next: Language) => {
    try {
      localStorage.setItem("jomiy-language", next);
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
    <span className="jmc-status" data-tone={statusTone(unit.statusOriginal)}>
      <i aria-hidden="true" />
      <span>{status(unit, language)}</span>
      <small>{copy[language].statusNote}</small>
    </span>
  );
}

function Price({
  unit,
  language,
  evaluationTime,
  detailed = false,
}: {
  unit: Unit;
  language: Language;
  evaluationTime: number;
  detailed?: boolean;
}) {
  const t = copy[language];
  const campaignActive = promotionIsActive(unit, evaluationTime);
  const hasCampaignPrice = Boolean(
    unit.promotion && unit.oldPrice > unit.price,
  );
  const displayPrice =
    hasCampaignPrice && !campaignActive ? unit.oldPrice : unit.price;
  const displayPricePerM2 = Math.round(displayPrice / unit.area);
  return (
    <div
      className="jmc-price"
      data-campaign-active={campaignActive || undefined}
    >
      <span>
        {hasCampaignPrice && !campaignActive ? t.rawPrice : t.snapshotPrice}
      </span>
      <strong>{money(displayPrice, language)}</strong>
      <small>
        {money(displayPricePerM2, language)} {t.pricePerM2}
      </small>
      {hasCampaignPrice && campaignActive ? (
        <del>
          {t.rawPrice} · {money(unit.oldPrice, language)}
        </del>
      ) : null}
      {hasCampaignPrice && !campaignActive ? (
        <s>
          {t.expiredSnapshot} · {money(unit.price, language)}
        </s>
      ) : null}
      {detailed ? (
        <>
          <em>
            {unit.promotion
              ? `${t.campaignPrice} · ${unit.promotion.percent}%${unit.promotion.deadlineUtc ? ` · ${t.campaignUntil} ${campaignDeadline(unit.promotion.deadlineUtc, language)}` : ""}`
              : t.rawFallback}{" "}
            · {t.currentTerms}
          </em>
          {unit.promotion?.deadlineUtc ? (
            <b className="jmc-campaign-state" data-active={campaignActive}>
              {campaignActive ? t.campaignActive : t.campaignExpired}
            </b>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function SourceDetails({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return (
    <details className="jmc-unit-source">
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
          <dd>
            <span lang="ru">{unit.statusOriginal}</span> · isSale=
            {String(unit.isSale)} · canBuy={String(unit.canBuy)} · Offer=
            {String(unit.strictOfferEligible)}
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
    <dl className={`jmc-unit-facts${compact ? " is-compact" : ""}`}>
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
      <div>
        <dt>{t.propertyClass}</dt>
        <dd>{unit.propertyClass === "Бизнес" ? t.businessClass : unit.propertyClass}</dd>
      </div>
      <div>
        <dt>{t.repair}</dt>
        <dd>{unit.repairIncluded ? t.finishing : t.noFinishing}</dd>
      </div>
      {compact ? null : (
        <div>
          <dt>{t.studio}</dt>
          <dd>{unit.studio ? t.studioTrue : t.studioFalse}</dd>
        </div>
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
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const views: PlanState["view"][] = ["page1", "page2"];
  const panelId = `jmc-plan-panel-${state.unit.id}`;
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
          .getElementById(`jmc-plan-tab-${next}-${state.unit.id}`)
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
    const release = lockJomiyBody();
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
      className="jmc-plan-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby="jmc-plan-title"
    >
      <button
        className="jmc-plan-lightbox__backdrop"
        type="button"
        tabIndex={-1}
        onClick={close}
        aria-label={t.closePlan}
      />
      <div className="jmc-plan-lightbox__panel" ref={panelRef}>
        <div className="jmc-plan-head">
          <div>
            <small>{t.apartment}</small>
            <h2 id="jmc-plan-title">
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
        </div>
        <div className="jmc-plan-tabs" role="tablist" aria-label={t.planViews}>
          {views.map((item, index) => (
            <button
              id={`jmc-plan-tab-${item}-${state.unit.id}`}
              key={item}
              type="button"
              role="tab"
              aria-selected={view === item}
              aria-controls={panelId}
              tabIndex={view === item ? 0 : -1}
              onClick={() => selectView(item)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
            >
              {item === "page1" ? t.plan : t.position}
            </button>
          ))}
        </div>
        <div
          id={panelId}
          className="jmc-plan-stage"
          role="tabpanel"
          aria-labelledby={`jmc-plan-tab-${view}-${state.unit.id}`}
          tabIndex={0}
          onTouchStart={(event) => {
            const touch = event.touches[0];
            touchStart.current = touch
              ? { x: touch.clientX, y: touch.clientY }
              : null;
          }}
          onTouchEnd={(event) => {
            const start = touchStart.current;
            const touch = event.changedTouches[0];
            touchStart.current = null;
            if (!start || !touch) return;
            const dx = touch.clientX - start.x;
            const dy = touch.clientY - start.y;
            if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy)) return;
            selectView(dx < 0 ? "page2" : "page1");
          }}
        >
          <img
            src={asset(
              view === "page1" ? state.unit.sheetPage1 : state.unit.sheetPage2,
            )}
            alt={`${view === "page1" ? t.plan : t.position} № ${state.unit.number}`}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        </div>
        <div className="jmc-plan-foot">
          <StatusBadge unit={state.unit} language={language} />
          <span>
            {t.groupShort} {state.unit.buildingDisplay} · {t.entranceShort}{" "}
            {state.unit.entrance} · {t.floorOf} {state.unit.floor}/
            {state.unit.totalFloors}
          </span>
        </div>
      </div>
    </div>
  );
}

function UnitCard({
  unit,
  language,
  evaluationTime,
  onPlan,
  onLead,
}: {
  unit: Unit;
  language: Language;
  evaluationTime: number;
  onPlan: (unit: Unit, opener: HTMLButtonElement) => void;
  onLead: (unit: Unit) => void;
}) {
  const t = copy[language];
  return (
    <article className="jmc-unit-card">
      <header>
        <div>
          <small>{t.apartment}</small>
          <h2>№ {unit.number}</h2>
        </div>
        <StatusBadge unit={unit} language={language} />
      </header>
      <button
        className="jmc-plan-preview"
        type="button"
        onClick={(event) => onPlan(unit, event.currentTarget)}
        aria-label={`${t.openPlan}: № ${unit.number}`}
      >
        <img
          src={asset(unit.thumbnail)}
          alt={`${t.compactPlan}: ${t.apartment} № ${unit.number}`}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <span>{t.openPlan} ↗</span>
      </button>
      <div className="jmc-unit-card__summary">
        <strong>{roomLabel(unit.rooms, language)}</strong>
        <span>{number(unit.area, language, 2)} m²</span>
        <span>
          {t.groupShort} {unit.buildingDisplay}
        </span>
      </div>
      <UnitFacts unit={unit} language={language} />
      <Price
        unit={unit}
        language={language}
        evaluationTime={evaluationTime}
        detailed
      />
      <div className="jmc-unit-card__actions">
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
  evaluationTime,
  mobile,
  obscured,
  onClose,
  onPlan,
  onLead,
}: {
  selection: Selection;
  language: Language;
  evaluationTime: number;
  mobile: boolean;
  obscured: boolean;
  onClose: () => void;
  onPlan: (unit: Unit, opener: HTMLButtonElement) => void;
  onLead: (unit: Unit) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  const unit = selection.unit;
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 });
    closeRef.current?.focus({ preventScroll: true });
  }, [selection.opener, unit.id]);
  useEffect(() => {
    const release = mobile ? lockJomiyBody() : null;
    const key = (event: KeyboardEvent) => {
      if (document.querySelector(".lead-modal,.jmc-plan-lightbox")) return;
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
        className="jmc-detail-backdrop"
        aria-hidden="true"
        onMouseDown={onClose}
      />
      <div
        ref={panelRef}
        id={`jmc-detail-${unit.id}`}
        className="jmc-unit-detail"
        role={mobile ? "dialog" : "region"}
        aria-modal={mobile || undefined}
        aria-labelledby={`jmc-detail-title-${unit.id}`}
        aria-hidden={obscured || undefined}
        inert={obscured ? true : undefined}
      >
        <header>
          <div>
            <small>{t.selected}</small>
            <h2 id={`jmc-detail-title-${unit.id}`}>№ {unit.number}</h2>
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
          className="jmc-detail-plan"
          type="button"
          onClick={(event) => onPlan(unit, event.currentTarget)}
        >
          <img
            src={asset(unit.thumbnail)}
          alt={`${t.compactPlan}: ${t.apartment} № ${unit.number}`}
            loading="lazy"
            decoding="async"
            draggable={false}
          />
          <span>{t.openPlan} ↗</span>
        </button>
        <strong className="jmc-detail-rooms">
          {roomLabel(unit.rooms, language)}
        </strong>
        <UnitFacts unit={unit} language={language} compact />
        <Price
          unit={unit}
          language={language}
          evaluationTime={evaluationTime}
          detailed
        />
        <button
          className="jmc-detail-cta"
          type="button"
          data-lead-trigger
          onClick={() => onLead(unit)}
        >
          {t.choose}
          <span>↗</span>
        </button>
        <SourceDetails unit={unit} language={language} />
      </div>
    </>
  );
}

function MatrixGroup({
  snapshot,
  group,
  units,
  rank,
  sort,
  language,
  evaluationTime,
  selected,
  onSelect,
}: {
  snapshot: Snapshot;
  group: Group;
  units: Unit[];
  rank: ReadonlyMap<string, number>;
  sort: Sort;
  language: Language;
  evaluationTime: number;
  selected: Selection | null;
  onSelect: (unit: Unit, opener: HTMLButtonElement) => void;
}) {
  const t = copy[language];
  const groupUnits = units.filter((unit) => unit.buildingId === group.id);
  return (
    <section
      className="jmc-matrix-group"
      aria-labelledby={`jmc-group-${group.id}`}
    >
      <header>
        <span className="jmc-route-chip">
          {t.groupShort} {group.displayName}
        </span>
        <h2 id={`jmc-group-${group.id}`}>
          {groupUnits.length} / {group.count}{" "}
          {recordLabel(group.count, language)}
        </h2>
        <span>{date(group.normalizedDeadline, language)}</span>
      </header>
      {groupUnits.length === 0 ? (
        <p className="jmc-matrix-group__empty">{t.noMatrix}</p>
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
            evaluationTime={evaluationTime}
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
  evaluationTime,
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
  evaluationTime: number;
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
      className="jmc-matrix-entrance"
      data-group={group.displayName}
      data-entrance={entrance}
    >
      <div className="jmc-matrix-entrance__head">
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
        className="jmc-matrix-scroll"
        role="region"
        aria-label={`${t.groupShort} ${group.displayName}, ${t.entranceTitle} ${entrance}`}
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <div
          className="jmc-matrix"
          style={{ "--jmc-columns": maxColumns } as CSSProperties}
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
                className={`jmc-floor-row${floorUnits.length === 0 ? " is-empty" : ""}`}
                key={floor}
                data-jmc-floor-row
                data-floor={floor}
              >
                <div className="jmc-floor-number">
                  <strong>{floor}</strong>
                  <span>{t.floorTitle}</span>
                  <small>
                    {floorUnits.length}{" "}
                    {unitsOnFloorLabel(floorUnits.length, language)}
                  </small>
                </div>
                <div className="jmc-floor-units">
                  {floorUnits.length === 0 ? (
                    <span className="jmc-floor-empty">{t.emptyFloor}</span>
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
                        data-jmc-unit-cell
                        data-unit-number={unit.number}
                        data-tone={statusTone(unit.statusOriginal)}
                        aria-pressed={selected?.unit.id === unit.id}
                        aria-expanded={selected?.unit.id === unit.id}
                        aria-controls={
                          selected?.unit.id === unit.id
                            ? `jmc-detail-${unit.id}`
                            : undefined
                        }
                        onClick={(event) => onSelect(unit, event.currentTarget)}
                        aria-label={`${t.apartment} № ${unit.number}, ${roomLabel(unit.rooms, language)}, ${number(unit.area, language, 2)} m², ${status(unit, language)}, ${money(displayPriceAt(unit, evaluationTime), language)}`}
                      >
                        <span>№ {unit.number}</span>
                        <strong>{roomLabel(unit.rooms, language)}</strong>
                        <small>{number(unit.area, language, 2)} m²</small>
                        <em>
                          {shortMoney(
                            displayPriceAt(unit, evaluationTime),
                            language,
                          )}
                        </em>
                        <b>{status(unit, language)}</b>
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
  snapshot,
  filters,
  language,
  priceRange,
  onChange,
  onReset,
}: {
  snapshot: Snapshot;
  filters: Filters;
  language: Language;
  priceRange: { min: number; max: number };
  onChange: (key: keyof Filters, value: string) => void;
  onReset: () => void;
}) {
  const t = copy[language];
  return (
    <section className="jmc-filters" aria-labelledby="jmc-filters-title">
      <header>
        <h2 id="jmc-filters-title">{t.filters}</h2>
        <button type="button" onClick={onReset}>
          {t.reset}
        </button>
      </header>
      <div className="jmc-filter-grid">
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
            step="0.01"
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
            step="0.01"
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
            step="0.1"
            min="0"
            value={filters.priceFrom}
            onChange={(event) => onChange("priceFrom", event.target.value)}
          placeholder={number(priceRange.min / 1e6, language, 1)}
          />
        </label>
        <label>
          <span>{t.priceTo}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={filters.priceTo}
            onChange={(event) => onChange("priceTo", event.target.value)}
          placeholder={number(priceRange.max / 1e6, language, 1)}
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

export function JomiyCatalog({
  snapshot,
  initialLanguage,
  initialEvaluationTime,
}: {
  snapshot: Snapshot;
  initialLanguage: Language;
  initialEvaluationTime: number;
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
  const promotionDeadlines = useMemo(() => [
    ...new Set(
      snapshot.units
        .map((unit) => unit.promotion?.deadlineUtc)
        .filter((value): value is string => Boolean(value)),
    ),
  ].map(Date.parse).filter(Number.isFinite), [snapshot.units]);
  const evaluationTime = usePromotionClock(initialEvaluationTime, promotionDeadlines);
  const currentPriceRange = useMemo(() => {
    const prices = snapshot.units.map((unit) =>
      displayPriceAt(unit, evaluationTime),
    );
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [evaluationTime, snapshot.units]);
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
    document.body.classList.add("jm-catalog-active");
    return () => document.body.classList.remove("jm-catalog-active");
  }, []);
  useEffect(() => (leadRequest ? lockJomiyBody() : undefined), [leadRequest]);
  const filtered = useMemo(
    () =>
      snapshot.units
        .filter((unit) => {
          const areaFrom = Number(filters.areaFrom),
            areaTo = Number(filters.areaTo),
            priceFrom = Number(filters.priceFrom) * 1e6,
            priceTo = Number(filters.priceTo) * 1e6;
          const currentPrice = displayPriceAt(unit, evaluationTime);
          return (
            (filters.rooms === "all" || unit.rooms === Number(filters.rooms)) &&
            (!areaFrom || unit.area >= areaFrom) &&
            (!areaTo || unit.area <= areaTo) &&
            (!priceFrom || currentPrice >= priceFrom) &&
            (!priceTo || currentPrice <= priceTo) &&
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
        .sort((a, b) => compare(a, b, sort, evaluationTime)),
    [evaluationTime, filters, snapshot.units, sort],
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
    remember(unit, evaluationTime);
    setPlanState({ unit, opener, view: "page1" });
  };
  const openLead = (unit: Unit | null, surface: string) => {
    if (unit) remember(unit, evaluationTime);
    setLeadRequest({ unit, surface });
  };
  const selectUnit = (unit: Unit, opener: HTMLButtonElement) => {
    remember(unit, evaluationTime);
    setSelection({ unit, opener });
  };
  useEffect(() => {
    if (leadRequest?.unit) remember(leadRequest.unit, evaluationTime);
  }, [evaluationTime, leadRequest]);
  const leadPricing = leadRequest?.unit
    ? leadPriceSnapshotAt(leadRequest.unit, evaluationTime)
    : null;
  const unitContext = leadRequest?.unit
    ? [
        "projectSlug=jomiy",
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
        `canBuy=${leadRequest.unit.canBuy}`,
        `strictOfferEligible=${leadRequest.unit.strictOfferEligible}`,
        `campaignDeadline=${leadPricing?.campaignDeadline ?? "none"}`,
        `campaignActive=${leadPricing?.campaignActive ?? false}`,
        `repairIncluded=${leadRequest.unit.repairIncluded}`,
        `studio=${leadRequest.unit.studio}`,
        `price=${leadPricing?.price}`,
        `effectivePrice=${leadPricing?.effectivePrice}`,
        `displayPrice=${leadPricing?.displayPrice}`,
        `regularPrice=${leadPricing?.regularPrice}`,
        `snapshotCampaignPrice=${leadPricing?.snapshotCampaignPrice}`,
      ].join(";")
    : `projectSlug=jomiy;lang=${language};surface=catalog:${leadRequest?.surface ?? "general"};unit=general`;
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
    document.getElementById(`jmc-mode-${modes[next]}`)?.focus();
  };
  return (
    <div
      id="top"
      className="jomiy-catalog-site"
      lang={language}
      data-lead-unit={leadRequest?.unit?.id}
      data-lead-effective-price={leadPricing?.effectivePrice}
      data-lead-regular-price={leadPricing?.regularPrice}
      data-lead-snapshot-campaign-price={leadPricing?.snapshotCampaignPrice}
      data-lead-campaign-active={leadPricing ? String(leadPricing.campaignActive) : undefined}
      data-lead-campaign-deadline={leadPricing?.campaignDeadline ?? undefined}
    >
      <a className="jmc-skip" href="#results">
        {t.skip}
      </a>
      <header className="jmc-header">
        <a href={withLanguage("/jomiy", language)}>
          {t.back}
          <span>←</span>
        </a>
        <strong>JOMIY</strong>
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
        <section className="jmc-hero">
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
              src={asset("/jomiy/images/hero-real.webp")}
              alt={t.heroPhoto}
              draggable={false}
            />
            <figcaption>
              <span>{t.heroPhoto}</span>
              <strong>{t.allApartments}</strong>
            </figcaption>
          </figure>
          <dl>
            <div>
              <dt>
                {language === "uz"
                  ? uzDate(snapshot.capturedAt, "Asia/Tashkent")
                  : new Intl.DateTimeFormat(locale(language), {
                      dateStyle: "medium",
                      timeZone: "Asia/Tashkent",
                    }).format(new Date(snapshot.capturedAt))}
              </dt>
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
              <dt>{snapshot.filterSummary.groups.length}</dt>
              <dd>{t.groups}</dd>
            </div>
            <div>
              <dt>{snapshot.officialTotalAtCapture} × 2</dt>
              <dd>{t.plans}</dd>
            </div>
          </dl>
        </section>
        <section className="jmc-workspace">
          <FiltersPanel
            snapshot={snapshot}
            filters={filters}
            language={language}
            priceRange={currentPriceRange}
            onChange={setFilter}
            onReset={resetFilters}
          />
          <details className="jmc-snapshot-note">
            <summary>
              <span>i</span>
              <strong>{t.sourceTitle}</strong>
              <em>＋</em>
            </summary>
            <div><p>{t.sourceText}</p></div>
          </details>
          <div className="jmc-toolbar">
            <div className="jmc-modes" role="tablist" aria-label={t.modeLabel}>
              {modes.map((item, index) => (
                <button
                  id={`jmc-mode-${item}`}
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
            className="jmc-results"
            role="tabpanel"
            aria-labelledby={`jmc-mode-${mode}`}
          >
            {mode === "cards" ? (
              filtered.length === 0 ? (
                <div className="jmc-empty">
                  <span>○</span>
                  <h2>{t.empty}</h2>
                  <div>
                    <button type="button" onClick={resetFilters}>
                      {t.resetFilters}
                    </button>
                    <button
                      type="button"
                      data-lead-trigger
                      onClick={() => openLead(null, "empty-state")}
                    >
                      {t.emptyLead}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="jmc-card-grid">
                    {filtered.slice(0, shown).map((unit) => (
                      <UnitCard
                        key={unit.id}
                        unit={unit}
                        language={language}
                        evaluationTime={evaluationTime}
                        onPlan={openPlan}
                        onLead={(value) => openLead(value, "card-cta")}
                      />
                    ))}
                  </div>
                  <div className="jmc-show-more">
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
                <div className="jmc-matrix-intro">
                  <h2>{t.matrix}</h2>
                  <p>{t.matrixHint}</p>
                </div>
                {filtered.length === 0 ? (
                  <div className="jmc-matrix-empty-cta">
                    <p>{t.empty}</p>
                    <button
                      type="button"
                      data-lead-trigger
                      onClick={() => openLead(null, "matrix-empty")}
                    >
                      {t.emptyLead}
                    </button>
                  </div>
                ) : null}
                <div className="jmc-matrix-layout has-detail">
                  <div>
                    {snapshot.filterSummary.groups.map((group) => (
                      <MatrixGroup
                        key={group.id}
                        snapshot={snapshot}
                        group={group}
                        units={filtered}
                        rank={matrixRank}
                        sort={sort}
                        language={language}
                        evaluationTime={evaluationTime}
                        selected={selection}
                        onSelect={selectUnit}
                      />
                    ))}
                  </div>
                  {selection ? (
                      <UnitDetail
                        selection={selection}
                        language={language}
                        evaluationTime={evaluationTime}
                        mobile={mobile}
                        obscured={Boolean(planState || leadRequest)}
                        onClose={closeDetail}
                        onPlan={openPlan}
                        onLead={(unit) => openLead(unit, "matrix-detail")}
                      />
                    ) : (
                      <aside className="jmc-detail-empty">
                        <span>↖</span>
                        <p>{t.selectHint}</p>
                        <button
                          type="button"
                          data-lead-trigger
                          onClick={() => openLead(null, "matrix-empty-detail")}
                        >
                          {t.consult}
                        </button>
                      </aside>
                    )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      <footer className="jmc-footer">
        <div>
          <strong>{t.home}</strong>
          <a href={withLanguage("/jomiy", language)}>{t.back} ↗</a>
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
        projectName="JOMIY"
        tagline={t.formTagline}
        facts={t.formFacts}
        submitUrl={jomiyLeadSubmitUrl()}
        projectSlug="jomiy"
        unitId={leadRequest?.unit?.id}
        privacyUrl={privacyUrl(language)}
        requireConsent
        onClose={closeLead}
      />
    </div>
  );
}
