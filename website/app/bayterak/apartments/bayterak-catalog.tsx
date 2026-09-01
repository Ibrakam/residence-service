'use client';

/* eslint-disable @next/next/no-img-element */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LeadModal, rememberLastViewedApartment } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess' | 'chess-plus';
type Sort = 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc' | 'numberAsc' | 'numberDesc';
type BooleanFilter = '' | 'yes' | 'no';

type Unit = {
  id: string;
  number: string;
  rooms: number;
  area: number;
  price: number;
  oldPrice: number;
  totalPriceWithDiscountRaw?: number;
  currentPricePerM2: number;
  sourcePricePerM2: number;
  currency: 'UZS';
  promotion: {
    percent: number;
    name: string;
    deadlineUtc: string;
    discountSum: number;
    priceWithDiscount: number;
  } | null;
  floor: number;
  totalFloors: number;
  entrance: number;
  buildingId: string;
  building: string;
  propertyClass: string;
  completionDate: string;
  sourcePlacementCompletionDate: string;
  plan: string;
  statusOriginal: string;
  statusId: string;
  isSale: boolean;
  repairIncluded: boolean;
  studio: boolean;
  provenance: {
    catalogIndex?: number;
    api?: string;
    capturedAt?: string;
    sourceSha256?: string;
    localSha256?: string;
  };
};

export type BayterakSnapshot = {
  project: string;
  source: string;
  sourceLanding: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  currency: 'UZS';
  integrity: {
    uniqueUnitIds: number;
    uniquePrimaryPlanUrls: number;
    allIsSale: boolean;
  };
  filterSummary: {
    rooms: number[];
    classes: Array<{ value: string; count: number }>;
    ranges: {
      area: { min: number; max: number };
      currentCampaignPrice: { min: number; max: number };
      sourceTotalPrice: { min: number; max: number };
      sourcePricePerM2: { min: number; max: number };
      floor: { min: number; max: number };
    };
    entrances: number[];
    blocks: Array<{
      id: string;
      sourceName: string;
      displayName: string;
      count: number;
      normalizedDeadline: string;
      sourcePlacementDeadline: string[];
      classes: string[];
      totalFloors: number[];
      entrances: number[];
    }>;
  };
  units: Unit[];
};

type Filters = {
  propertyClass: string;
  rooms: string;
  areaFrom: string;
  areaTo: string;
  priceFrom: string;
  priceTo: string;
  floor: string;
  building: string;
  entrance: string;
  completion: string;
  repair: BooleanFilter;
  studio: BooleanFilter;
};

type LeadRequest = { unit: Unit | null; context: string };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const modes: Mode[] = ['cards', 'chess', 'chess-plus'];
const languageStorageKey = 'bayterak-language';
const mobileDrawerQuery = '(max-width: 820px)';
const pageSize = 12;
const emptyFilters: Filters = {
  propertyClass: '', rooms: '', areaFrom: '', areaTo: '', priceFrom: '', priceTo: '', floor: '', building: '', entrance: '', completion: '', repair: '', studio: '',
};

const copy = {
  ru: {
    skip: 'К результатам каталога', back: 'О проекте', home: 'Главная Bayterak', language: 'Язык', sales: 'Отдел продаж', nav: 'Навигация каталога',
    eyebrow: 'Архитектурный реестр · официальный snapshot', title: 'Архитектурный', accent: 'реестр.',
    leadBefore: 'В датированной официальной подборке —', leadAfter: 'предложений. Исходные workflow-статусы сохранены и не подменены словом «свободно».',
    snapshot: 'Snapshot', captured: 'Срез зафиксирован', proposals: 'предложений', saleRows: 'isSale=true', localPlans: 'локальных планировок', classesSummary: 'Comfort+ / Business',
    consult: 'Получить консультацию', officialSource: 'Официальный источник', sourceTitle: 'Происхождение данных',
    sourceNoteBefore: 'Все', sourceNoteAfter: 'строк квартир сохранены одной операцией из официальной подборки. Цены, акция и workflow-статусы относятся только к моменту snapshot.',
    modes: { cards: 'Карточки', chess: 'Шахматка', 'chess-plus': 'Шахматка+' }, modeLabel: 'Режим каталога',
    filters: 'Фильтры', propertyClass: 'Класс', allClasses: 'Все классы', rooms: 'Комнаты', allRooms: 'Все', areaFrom: 'Площадь от, м²', areaTo: 'Площадь до, м²', priceFrom: 'Цена от, млн UZS', priceTo: 'Цена до, млн UZS', floor: 'Этаж', allFloors: 'Все этажи', building: 'Блок', allBuildings: 'Все блоки', entrance: 'Подъезд', allEntrances: 'Все подъезды', completion: 'Нормализованный срок', allCompletions: 'Все сроки', repair: 'Ремонт включён', studio: 'Studio flag', any: 'Любой', yes: 'Да', no: 'Нет', reset: 'Сбросить',
    sort: 'Сортировка', sorts: { priceAsc: 'Цена ↑', priceDesc: 'Цена ↓', areaAsc: 'Площадь ↑', areaDesc: 'Площадь ↓', floorAsc: 'Этаж ↑', floorDesc: 'Этаж ↓', numberAsc: 'Номер ↑', numberDesc: 'Номер ↓' }, results: 'найдено',
    apartment: 'Квартира', roomsShort: 'комн.', area: 'Площадь', areaUnit: 'м²', currentPrice: 'Текущая цена кампании', originalPrice: 'Исходная цена', perM2: 'Цена за м² в источнике', campaign: 'Акция', campaignUntil: 'до', status: 'Исходный статус', statusNote: 'Workflow-статус официального snapshot', class: 'Класс', floorOf: 'Этаж', entranceShort: 'Подъезд', block: 'Блок', completionShort: 'Срок', normalized: 'Нормализован по официальному filter/realEstateList', rawPlacement: 'Дата в raw placementList', finishing: 'Ремонт', studioFlag: 'Studio flag',
    plan: 'Открыть планировку', planAlt: 'Официальная планировка квартиры', choose: 'Уточнить условия', showMore: 'Показать ещё', shown: 'Показано', of: 'из',
    noResults: 'По этим параметрам предложений нет.', resetFilters: 'Сбросить фильтры', matrix: 'Блок × подъезд × этаж × квартира', matrixHint: 'Прокручивайте пальцем или трекпадом, заметными кнопками либо клавишами ← → Home End. Полоса прокрутки остаётся видимой.', scrollLeft: 'Прокрутить матрицу влево', scrollRight: 'Прокрутить матрицу вправо', floorColumn: 'Этаж', unitsColumn: 'Квартиры', emptyFloor: 'Нет предложений по фильтру', height: 'этажей', selected: 'Выбранная квартира', close: 'Закрыть детали', closePlan: 'Закрыть планировку', selectHint: 'Выберите квартиру в матрице, чтобы открыть её паспорт.',
    disclaimer: 'Snapshot не является публичной офертой. Наличие и актуальные условия подтверждает отдел продаж.', privacy: 'Политика конфиденциальности', up: 'Наверх',
    statuses: { 'Снятие резерва': 'Снятие резерва', 'Свободно': 'Свободно', 'Расторжение': 'Расторжение', 'Снятие брони': 'Снятие брони', 'Бронирование': 'Бронирование' },
  },
  uz: {
    skip: 'Katalog natijalariga o‘tish', back: 'Loyiha haqida', home: 'Bayterak bosh sahifasi', language: 'Til', sales: 'Savdo bo‘limi', nav: 'Katalog navigatsiyasi',
    eyebrow: 'Arxitektura reyestri · rasmiy snapshot', title: 'Arxitektura', accent: 'reyestri.',
    leadBefore: 'Sanasi ko‘rsatilgan rasmiy tanlovda', leadAfter: 'ta taklif bor. Asl workflow holatlari saqlangan va ularning barchasi «bo‘sh» deb belgilanmagan.',
    snapshot: 'Snapshot', captured: 'Snapshot vaqti', proposals: 'taklif', saleRows: 'isSale=true', localPlans: 'mahalliy reja', classesSummary: 'Comfort+ / Business',
    consult: 'Maslahat olish', officialSource: 'Rasmiy manba', sourceTitle: 'Ma’lumotlar kelib chiqishi',
    sourceNoteBefore: 'Barcha', sourceNoteAfter: 'ta xonadon qatori rasmiy tanlovdan bitta operatsiyada saqlandi. Narx, aksiya va workflow holatlari faqat snapshot vaqtiga tegishli.',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka', 'chess-plus': 'Shaxmatka+' }, modeLabel: 'Katalog ko‘rinishi',
    filters: 'Filtrlar', propertyClass: 'Toifa', allClasses: 'Barcha toifalar', rooms: 'Xonalar', allRooms: 'Barchasi', areaFrom: 'Maydon, m² dan', areaTo: 'Maydon, m² gacha', priceFrom: 'Narx, mln UZS dan', priceTo: 'Narx, mln UZS gacha', floor: 'Qavat', allFloors: 'Barcha qavatlar', building: 'Blok', allBuildings: 'Barcha bloklar', entrance: 'Kirish', allEntrances: 'Barcha kirishlar', completion: 'Me’yorlashtirilgan muddat', allCompletions: 'Barcha muddatlar', repair: 'Pardoz kiritilgan', studio: 'Studio flag', any: 'Istalgan', yes: 'Ha', no: 'Yo‘q', reset: 'Tozalash',
    sort: 'Saralash', sorts: { priceAsc: 'Narx ↑', priceDesc: 'Narx ↓', areaAsc: 'Maydon ↑', areaDesc: 'Maydon ↓', floorAsc: 'Qavat ↑', floorDesc: 'Qavat ↓', numberAsc: 'Raqam ↑', numberDesc: 'Raqam ↓' }, results: 'topildi',
    apartment: 'Xonadon', roomsShort: 'xonali', area: 'Maydon', areaUnit: 'm²', currentPrice: 'Kampaniyadagi joriy narx', originalPrice: 'Boshlang‘ich narx', perM2: 'Manbadagi m² narxi', campaign: 'Aksiya', campaignUntil: 'gacha', status: 'Asl holat', statusNote: 'Rasmiy snapshotdagi workflow holati', class: 'Toifa', floorOf: 'Qavat', entranceShort: 'Kirish', block: 'Blok', completionShort: 'Muddat', normalized: 'Rasmiy filter/realEstateList bo‘yicha me’yorlashtirilgan', rawPlacement: 'Raw placementList sanasi', finishing: 'Pardoz', studioFlag: 'Studio flag',
    plan: 'Rejani ochish', planAlt: 'Xonadonning rasmiy rejasi', choose: 'Shartlarni aniqlash', showMore: 'Yana ko‘rsatish', shown: 'Ko‘rsatildi', of: 'dan',
    noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', resetFilters: 'Filtrlarni tozalash', matrix: 'Blok × kirish × qavat × xonadon', matrixHint: 'Barmoq yoki trekpad, ko‘rinadigan tugmalar yoxud ← → Home End klavishlari bilan suring. Surish chizig‘i ko‘rinib turadi.', scrollLeft: 'Matritsani chapga surish', scrollRight: 'Matritsani o‘ngga surish', floorColumn: 'Qavat', unitsColumn: 'Xonadonlar', emptyFloor: 'Filtr bo‘yicha taklif yo‘q', height: 'qavat', selected: 'Tanlangan xonadon', close: 'Tafsilotlarni yopish', closePlan: 'Rejani yopish', selectHint: 'Pasportini ochish uchun matritsadan xonadon tanlang.',
    disclaimer: 'Snapshot ommaviy oferta emas. Mavjudlik va amaldagi shartlarni savdo bo‘limi tasdiqlaydi.', privacy: 'Maxfiylik siyosati', up: 'Yuqoriga',
    statuses: { 'Снятие резерва': 'Rezervni olib tashlash', 'Свободно': 'Bo‘sh', 'Расторжение': 'Shartnomani bekor qilish', 'Снятие брони': 'Bronni olib tashlash', 'Бронирование': 'Bron qilish' },
  },
  en: {
    skip: 'Skip to catalogue results', back: 'About the project', home: 'Bayterak home', language: 'Language', sales: 'Sales office', nav: 'Catalogue navigation',
    eyebrow: 'Architectural register · official snapshot', title: 'Architectural', accent: 'register.',
    leadBefore: 'The dated official selection contains', leadAfter: 'listings. Source workflow states are preserved instead of relabelling every listing as “available”.',
    snapshot: 'Snapshot', captured: 'Captured', proposals: 'listings', saleRows: 'isSale=true', localPlans: 'local floor plans', classesSummary: 'Comfort+ / Business',
    consult: 'Request a consultation', officialSource: 'Official source', sourceTitle: 'Data provenance',
    sourceNoteBefore: 'All', sourceNoteAfter: 'apartment rows were saved from the official selection in one operation. Prices, the campaign and workflow states are fixed at snapshot time.',
    modes: { cards: 'Cards', chess: 'Matrix', 'chess-plus': 'Matrix+' }, modeLabel: 'Catalogue view',
    filters: 'Filters', propertyClass: 'Class', allClasses: 'All classes', rooms: 'Rooms', allRooms: 'Any', areaFrom: 'Area from, m²', areaTo: 'Area to, m²', priceFrom: 'Price from, million UZS', priceTo: 'Price to, million UZS', floor: 'Floor', allFloors: 'Any floor', building: 'Block', allBuildings: 'All blocks', entrance: 'Entrance', allEntrances: 'All entrances', completion: 'Normalized completion', allCompletions: 'All dates', repair: 'Finishing included', studio: 'Studio flag', any: 'Any', yes: 'Yes', no: 'No', reset: 'Reset',
    sort: 'Sort', sorts: { priceAsc: 'Price ↑', priceDesc: 'Price ↓', areaAsc: 'Area ↑', areaDesc: 'Area ↓', floorAsc: 'Floor ↑', floorDesc: 'Floor ↓', numberAsc: 'Number ↑', numberDesc: 'Number ↓' }, results: 'found',
    apartment: 'Apartment', roomsShort: 'room', area: 'Area', areaUnit: 'm²', currentPrice: 'Current campaign price', originalPrice: 'Original price', perM2: 'Source price per m²', campaign: 'Campaign', campaignUntil: 'until', status: 'Source status', statusNote: 'Workflow state in the official snapshot', class: 'Class', floorOf: 'Floor', entranceShort: 'Entrance', block: 'Block', completionShort: 'Completion', normalized: 'Normalized from the official filter/realEstateList', rawPlacement: 'Raw placementList date', finishing: 'Finishing', studioFlag: 'Studio flag',
    plan: 'Open floor plan', planAlt: 'Official apartment floor plan', choose: 'Check terms', showMore: 'Show more', shown: 'Shown', of: 'of',
    noResults: 'No listings match these filters.', resetFilters: 'Reset filters', matrix: 'Block × entrance × floor × apartment', matrixHint: 'Swipe or use a trackpad, the visible controls, or the ← → Home End keys. The scrollbar remains visible.', scrollLeft: 'Scroll matrix left', scrollRight: 'Scroll matrix right', floorColumn: 'Floor', unitsColumn: 'Apartments', emptyFloor: 'No filtered listings', height: 'floors', selected: 'Selected apartment', close: 'Close details', closePlan: 'Close floor plan', selectHint: 'Select an apartment in the matrix to open its register entry.',
    disclaimer: 'This snapshot is not a public offer. The sales team confirms availability and current terms.', privacy: 'Privacy policy', up: 'Back to top',
    statuses: { 'Снятие резерва': 'Reservation release', 'Свободно': 'Available', 'Расторжение': 'Termination', 'Снятие брони': 'Booking release', 'Бронирование': 'Booking' },
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function isLanguage(value: string | null): value is Language { return value === 'ru' || value === 'uz' || value === 'en'; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${withLanguage('/privacy', language)}&project=bayterak`; }
function locale(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US'; }
function formatNumber(value: number, language: Language, digits = 0) { return new Intl.NumberFormat(locale(language), { maximumFractionDigits: digits }).format(value); }
function money(value: number, language: Language) { return `${formatNumber(value, language)} UZS`; }
function shortMoney(value: number, language: Language) {
  const suffix = language === 'ru' ? 'млн' : language === 'uz' ? 'mln' : 'm';
  return `${formatNumber(value / 1e6, language, 1)} ${suffix}`;
}
function area(value: number, language: Language) { return formatNumber(value, language, 2); }
function areaWithUnit(value: number, language: Language) { return `${area(value, language)} ${copy[language].areaUnit}`; }
function roomPhrase(value: number, language: Language) {
  if (language === 'en') return `${value} ${value === 1 ? 'room' : 'rooms'}`;
  return `${value} ${copy[language].roomsShort}`;
}
function parseDate(value: string) {
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
}
function dateLabel(value: string, language: Language) {
  return new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parseDate(value));
}
function capturedLabel(value: string, language: Language) {
  return new Intl.DateTimeFormat(locale(language), { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Tashkent' }).format(new Date(value));
}
function classLabel(value: string, language: Language) {
  const normalized = value.toLocaleLowerCase('ru').replace(/\s/g, '');
  if (normalized.includes('бизнес') || normalized.includes('business')) return 'Business';
  if (normalized.includes('комфорт') || normalized.includes('comfort')) return 'Comfort+';
  return language === 'ru' ? 'Класс проекта' : language === 'uz' ? 'Loyiha toifasi' : 'Project class';
}
function buildingLabel(value: string) {
  if (/businees/i.test(value)) return 'Bayterak Business · 1';
  if (/comfort/i.test(value)) return 'Bayterak Comfort+ · 1';
  const phase = value.match(/bayterak\s*-?\s*(\d+)/i)?.[1];
  return phase ? `Bayterak · ${phase}` : value.replace(/Businees/gi, 'Business');
}
function statusLabel(unit: Unit, language: Language) {
  const statuses = copy[language].statuses as Record<string, string>;
  return statuses[unit.statusOriginal] ?? (language === 'ru' ? unit.statusOriginal : language === 'uz' ? 'Boshqa workflow holati' : 'Other workflow state');
}
function statusTone(value: string) {
  if (value === 'Свободно') return 'available';
  if (value === 'Снятие резерва') return 'release';
  if (value === 'Расторжение') return 'termination';
  if (value === 'Снятие брони') return 'booking-release';
  return 'other';
}
function hasCampaign(unit: Unit) {
  if (!unit.promotion || unit.oldPrice <= unit.price || unit.promotion.percent <= 0) return false;
  return !unit.promotion.priceWithDiscount || Math.abs(unit.promotion.priceWithDiscount - unit.price) < 2;
}
function numberTie(a: Unit, b: Unit) {
  return a.number.localeCompare(b.number, undefined, { numeric: true });
}
function compareUnits(a: Unit, b: Unit, sort: Sort) {
  if (sort === 'priceAsc') return a.price - b.price || numberTie(a, b);
  if (sort === 'priceDesc') return b.price - a.price || numberTie(a, b);
  if (sort === 'areaAsc') return a.area - b.area || numberTie(a, b);
  if (sort === 'areaDesc') return b.area - a.area || numberTie(a, b);
  if (sort === 'floorAsc') return a.floor - b.floor || numberTie(a, b);
  if (sort === 'floorDesc') return b.floor - a.floor || numberTie(a, b);
  if (sort === 'numberDesc') return -numberTie(a, b);
  return numberTie(a, b);
}
function officialLanding(language: Language) {
  return language === 'ru' ? 'https://nrg-bi.uz/uz-ru/landing/bayterak' : 'https://nrg-bi.uz/uz/landing/bayterak';
}
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}
function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}

let bodyLockDepth = 0;
let bodyOverflowBefore = '';
let bodyPaddingBefore = '';
let measuredScrollbarWidth = 0;
function lockBody() {
  if (bodyLockDepth === 0) {
    bodyOverflowBefore = document.body.style.overflow;
    bodyPaddingBefore = document.body.style.paddingRight;
    const scrollbar = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${currentPadding + scrollbar}px`;
  }
  bodyLockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockDepth = Math.max(0, bodyLockDepth - 1);
    if (bodyLockDepth === 0) {
      document.body.style.overflow = bodyOverflowBefore;
      document.body.style.paddingRight = bodyPaddingBefore;
    }
  };
}

function subscribeMobileDrawer(callback: () => void) {
  const media = window.matchMedia(mobileDrawerQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function mobileDrawerSnapshot() { return typeof window !== 'undefined' && window.matchMedia(mobileDrawerQuery).matches; }
function mobileDrawerServerSnapshot() { return false; }

function useLanguage(initialLanguage: Language) {
  const router = useRouter();
  const pathname = usePathname();
  const language = initialLanguage;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('lang')) {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(languageStorageKey); } catch { /* URL language remains authoritative when storage is unavailable. */ }
      const fallback = isLanguage(stored) ? stored : language;
      params.set('lang', fallback);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
      if (fallback !== language) return;
    }
    document.documentElement.lang = language;
    try { window.localStorage.setItem(languageStorageKey, language); } catch { /* Scoped fallback is optional. */ }
  }, [language, pathname, router]);

  const setLanguage = (next: Language) => {
    try { window.localStorage.setItem(languageStorageKey, next); } catch { /* Navigation must not depend on storage. */ }
    const params = new URLSearchParams(window.location.search);
    params.set('lang', next);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  return [language, setLanguage] as const;
}

function rememberUnit(unit: Unit) {
  rememberLastViewedApartment({
    uuid: unit.id,
    number: unit.number,
    rooms: unit.rooms,
    area: unit.area,
    floor: unit.floor,
    maxFloor: unit.totalFloors,
    entrance: unit.entrance,
    blockName: unit.building,
    blockId: unit.buildingId,
    price: unit.price,
  }, 'bayterak');
}

function unitContext(unit: Unit, surface: string, language: Language) {
  return [
    'projectSlug=bayterak', `surface=catalog:${surface}`, `lang=${language}`, `unitUuid=${unit.id}`, `number=${unit.number}`,
    `buildingId=${unit.buildingId}`, `building=${unit.building}`, `entrance=${unit.entrance}`, `floor=${unit.floor}/${unit.totalFloors}`,
    `rooms=${unit.rooms}`, `area=${unit.area}`, `class=${unit.propertyClass}`, `completion=${unit.completionDate}`,
    `workflowStatusId=${unit.statusId}`, `workflowStatus=${unit.statusOriginal}`, `isSale=${unit.isSale}`,
    `repairIncluded=${unit.repairIncluded}`, `studio=${unit.studio}`, `currentPrice=${unit.price}`, `originalPrice=${unit.oldPrice}`,
  ].join(';');
}

function StatusTag({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return <span className="bayterak-status" data-tone={statusTone(unit.statusOriginal)}><i aria-hidden="true" /><span>{statusLabel(unit, language)}</span><small>{t.statusNote}</small></span>;
}

function PlanPreview({ unit, language, onOpen, compact = false }: { unit: Unit; language: Language; onOpen: () => void; compact?: boolean }) {
  const t = copy[language];
  return (
    <button className={`bayterak-plan-preview${compact ? ' is-compact' : ''}`} type="button" onClick={onOpen} aria-haspopup="dialog" aria-label={`${t.plan}: № ${unit.number}`}>
      <img src={asset(unit.plan)} alt={`${t.planAlt} № ${unit.number}`} loading="lazy" decoding="async" />
      <span>{t.plan}</span><i aria-hidden="true">↗</i>
    </button>
  );
}

function PlanLightbox({ unit, language, onClose }: { unit: Unit; language: Language; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const releaseBody = lockBody();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      releaseBody();
      window.requestAnimationFrame(() => opener?.isConnected && opener.focus({ preventScroll: true }));
    };
  }, [onClose]);

  return (
    <div ref={dialogRef} className="bayterak-plan-lightbox" role="dialog" aria-modal="true" aria-labelledby={`bayterak-plan-title-${unit.id}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t.closePlan}>×</button>
      <figure>
        <img src={asset(unit.plan)} alt={`${t.planAlt} № ${unit.number}`} />
        <figcaption id={`bayterak-plan-title-${unit.id}`}><strong>№ {unit.number} · {roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</strong><span>{buildingLabel(unit.building)} · {unit.floor}/{unit.totalFloors}</span></figcaption>
      </figure>
    </div>
  );
}

function CampaignPrice({ unit, language, detailed = false }: { unit: Unit; language: Language; detailed?: boolean }) {
  const t = copy[language];
  const campaign = hasCampaign(unit);
  return (
    <div className={`bayterak-price${detailed ? ' is-detailed' : ''}`}>
      <small>{t.currentPrice}</small>
      <strong>{money(unit.price, language)}</strong>
      <span>{t.perM2}: {money(unit.sourcePricePerM2, language)}</span>
      {campaign ? <del>{t.originalPrice}: {money(unit.oldPrice, language)}</del> : null}
      {campaign ? <b>−{unit.promotion?.percent}% · {t.campaign}{unit.promotion?.deadlineUtc ? ` ${t.campaignUntil} ${dateLabel(unit.promotion.deadlineUtc, language)}` : ''}</b> : null}
    </div>
  );
}

function UnitCard({ unit, language, onPlan, onLead }: { unit: Unit; language: Language; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  return (
    <article className="bayterak-unit-card" data-unit-id={unit.id}>
      <header><small>REGISTER · № {unit.number}</small><span>{classLabel(unit.propertyClass, language)}</span></header>
      <PlanPreview unit={unit} language={language} onOpen={onPlan} />
      <div className="bayterak-unit-card__body">
        <StatusTag unit={unit} language={language} />
        <div className="bayterak-unit-card__name"><small>{buildingLabel(unit.building)} · {t.apartment} № {unit.number}</small><h3>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h3></div>
        <dl>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
          <div><dt>{t.finishing}</dt><dd>{unit.repairIncluded ? t.yes : t.no}</dd></div>
        </dl>
        <CampaignPrice unit={unit} language={language} />
        <button className="bayterak-unit-card__cta" type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
      </div>
    </article>
  );
}

function UnitDetail({ unit, language, onClose, onPlan, onLead }: { unit: Unit; language: Language; onClose: () => void; onPlan: () => void; onLead: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useSyncExternalStore(subscribeMobileDrawer, mobileDrawerSnapshot, mobileDrawerServerSnapshot);
  const t = copy[language];

  useEffect(() => {
    const releaseBody = mobileDrawer ? lockBody() : undefined;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.bayterak-plan-lightbox, .lead-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (!mobileDrawer || event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKey);
      releaseBody?.();
    };
  }, [mobileDrawer, onClose, unit.id]);

  return (
    <>
      <div className="bayterak-unit-detail-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside ref={panelRef} id={`bayterak-detail-${unit.id}`} className="bayterak-unit-detail" role={mobileDrawer ? 'dialog' : 'region'} aria-modal={mobileDrawer || undefined} aria-labelledby={`bayterak-detail-title-${unit.id}`} aria-describedby={`bayterak-detail-status-${unit.id}`}>
        <header>
          <div><small>{t.selected}</small><strong id={`bayterak-detail-title-${unit.id}`}>№ {unit.number}</strong></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <PlanPreview unit={unit} language={language} compact onOpen={onPlan} />
        <div id={`bayterak-detail-status-${unit.id}`} className="bayterak-unit-detail__status"><StatusTag unit={unit} language={language} /></div>
        <h3>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h3>
        <dl>
          <div><dt>{t.block}</dt><dd>{buildingLabel(unit.building)}</dd></div>
          <div><dt>{t.class}</dt><dd>{classLabel(unit.propertyClass, language)}</dd></div>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
          <div className="is-provenance"><dt>{t.normalized}</dt><dd>{unit.completionDate}</dd></div>
          <div className="is-provenance"><dt>{t.rawPlacement}</dt><dd>{unit.sourcePlacementCompletionDate}</dd></div>
          <div><dt>{t.finishing}</dt><dd>{unit.repairIncluded ? t.yes : t.no}</dd></div>
          <div><dt>{t.studioFlag}</dt><dd>{unit.studio ? t.yes : t.no}</dd></div>
        </dl>
        <CampaignPrice unit={unit} language={language} detailed />
        <button className="bayterak-unit-detail__cta" type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
      </aside>
    </>
  );
}

function MatrixGroup({ units, language, plus, sort, selectedId, floorMin, onSelect }: { units: Unit[]; language: Language; plus: boolean; sort: Sort; selectedId?: string; floorMin: number; onSelect: (unit: Unit, opener: HTMLButtonElement) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const t = copy[language];
  const building = units[0].building;
  const entrance = units[0].entrance;
  const totalFloors = Math.max(...units.map((unit) => unit.totalFloors));
  const floors = useMemo(() => {
    const values = Array.from({ length: Math.max(1, totalFloors - floorMin + 1) }, (_, index) => floorMin + index);
    return sort === 'floorAsc' ? values : values.reverse();
  }, [floorMin, sort, totalFloors]);

  const updateEdges = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    setEdges({ start: element.scrollLeft <= 2, end: maximum <= 2 || element.scrollLeft >= maximum - 2 });
  }, []);
  const move = useCallback((direction: number) => {
    const element = viewportRef.current;
    if (!element) return;
    element.scrollBy({ left: direction * Math.max(280, element.clientWidth * .72), behavior: scrollBehavior() });
  }, []);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === 'Home') { event.preventDefault(); viewportRef.current?.scrollTo({ left: 0, behavior: scrollBehavior() }); }
    else if (event.key === 'End') { event.preventDefault(); viewportRef.current?.scrollTo({ left: viewportRef.current.scrollWidth, behavior: scrollBehavior() }); }
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateEdges);
    const element = viewportRef.current;
    if (!element) return () => window.cancelAnimationFrame(frame);
    const observer = new ResizeObserver(updateEdges);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [plus, sort, units, updateEdges]);

  return (
    <section className="bayterak-matrix-group">
      <header>
        <div><small>{buildingLabel(building)} · {totalFloors} {t.height}</small><h3>{t.entranceShort} {entrance}</h3></div>
        <div className="bayterak-matrix-group__controls" role="group" aria-label={`${t.matrix}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>
          <button type="button" disabled={edges.start} onClick={() => move(-1)} aria-label={`${t.scrollLeft}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>←</button>
          <button type="button" disabled={edges.end} onClick={() => move(1)} aria-label={`${t.scrollRight}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>→</button>
        </div>
      </header>
      <div ref={viewportRef} className="bayterak-matrix-viewport" tabIndex={0} onKeyDown={onKeyDown} onScroll={updateEdges} aria-label={`${t.matrix}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`} aria-describedby="bayterak-matrix-help">
        <table className={plus ? 'is-plus' : undefined}>
          <thead><tr><th scope="col">{t.floorColumn}</th><th scope="col">{t.unitsColumn}</th></tr></thead>
          <tbody>{floors.map((floor) => {
            const floorUnits = units.filter((unit) => unit.floor === floor).sort((a, b) => compareUnits(a, b, sort));
            return (
              <tr key={floor}>
                <th scope="row"><strong>{floor}</strong><span>{t.floorOf}</span></th>
                <td>{floorUnits.length ? <div>{floorUnits.map((unit) => {
                  const selected = selectedId === unit.id;
                  return (
                    <button type="button" key={unit.id} className={selected ? 'is-selected' : undefined} aria-pressed={plus ? selected : undefined} aria-expanded={plus ? selected : undefined} aria-controls={plus && selected ? `bayterak-detail-${unit.id}` : undefined} onClick={(event) => onSelect(unit, event.currentTarget)} aria-label={`${t.apartment} № ${unit.number}, ${classLabel(unit.propertyClass, language)}, ${roomPhrase(unit.rooms, language)}, ${areaWithUnit(unit.area, language)}, ${t.floorOf} ${unit.floor}/${unit.totalFloors}, ${statusLabel(unit, language)}, ${money(unit.price, language)}`}>
                      <small><span>№ {unit.number}</span><i data-tone={statusTone(unit.statusOriginal)} aria-hidden="true" /></small>
                      <strong>{areaWithUnit(unit.area, language)}</strong>
                      <span>{roomPhrase(unit.rooms, language)} · {shortMoney(unit.price, language)}</span>
                      {plus ? <em>{classLabel(unit.propertyClass, language)} · {unit.repairIncluded ? t.finishing : t.studioFlag}: {unit.repairIncluded || unit.studio ? t.yes : t.no}</em> : null}
                    </button>
                  );
                })}</div> : <span className="bayterak-matrix-empty">— <span className="bayterak-visually-hidden">{t.emptyFloor}</span></span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

export function BayterakCatalog({ snapshot, initialLanguage }: { snapshot: BayterakSnapshot; initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [mode, setMode] = useState<Mode>('cards');
  const [sort, setSort] = useState<Sort>('priceAsc');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [visible, setVisible] = useState(pageSize);
  const [selected, setSelected] = useState<Unit | null>(null);
  const [planUnit, setPlanUnit] = useState<Unit | null>(null);
  const [leadRequest, setLeadRequest] = useState<LeadRequest | null>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionOpener = useRef<HTMLButtonElement | null>(null);
  const t = copy[language];

  useEffect(() => {
    if (!leadRequest) return;
    return lockBody();
  }, [leadRequest]);

  const classes = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.propertyClass))), [snapshot.units]);
  const rooms = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.rooms))).sort((a, b) => a - b), [snapshot.units]);
  const floors = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.floor))).sort((a, b) => a - b), [snapshot.units]);
  const entrances = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.entrance))).sort((a, b) => a - b), [snapshot.units]);
  const completions = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.completionDate))).sort(), [snapshot.units]);

  const filtered = useMemo(() => {
    const priceFrom = filters.priceFrom ? Number(filters.priceFrom) * 1e6 : -Infinity;
    const priceTo = filters.priceTo ? Number(filters.priceTo) * 1e6 : Infinity;
    const areaFrom = filters.areaFrom ? Number(filters.areaFrom) : -Infinity;
    const areaTo = filters.areaTo ? Number(filters.areaTo) : Infinity;
    return snapshot.units.filter((unit) => (
      (!filters.propertyClass || unit.propertyClass === filters.propertyClass)
      && (!filters.rooms || unit.rooms === Number(filters.rooms))
      && unit.area >= areaFrom && unit.area <= areaTo
      && unit.price >= priceFrom && unit.price <= priceTo
      && (!filters.floor || unit.floor === Number(filters.floor))
      && (!filters.building || unit.buildingId === filters.building)
      && (!filters.entrance || unit.entrance === Number(filters.entrance))
      && (!filters.completion || unit.completionDate === filters.completion)
      && (!filters.repair || unit.repairIncluded === (filters.repair === 'yes'))
      && (!filters.studio || unit.studio === (filters.studio === 'yes'))
    )).sort((a, b) => compareUnits(a, b, sort));
  }, [filters, snapshot.units, sort]);

  const matrixGroups = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    filtered.forEach((unit) => {
      const key = `${unit.buildingId}|${unit.entrance}`;
      groups.set(key, [...(groups.get(key) ?? []), unit]);
    });
    const blockOrder = new Map(snapshot.filterSummary.blocks.map((block, index) => [block.id, index]));
    return Array.from(groups.values()).sort((a, b) => (blockOrder.get(a[0].buildingId) ?? 999) - (blockOrder.get(b[0].buildingId) ?? 999) || a[0].entrance - b[0].entrance);
  }, [filtered, snapshot.filterSummary.blocks]);

  const activeSelected = selected && filtered.some((unit) => unit.id === selected.id) ? selected : null;
  const updateFilter = (name: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setVisible(pageSize);
    setSelected(null);
  };
  const resetFilters = () => {
    setFilters({ ...emptyFilters });
    setVisible(pageSize);
    setSelected(null);
  };
  const openPlan = (unit: Unit) => { rememberUnit(unit); setPlanUnit(unit); };
  const openLead = (unit: Unit | null, surface: string) => {
    measuredScrollbarWidth = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    if (unit) rememberUnit(unit);
    setLeadRequest({ unit, context: unit ? unitContext(unit, surface, language) : `projectSlug=bayterak;surface=catalog:${surface};lang=${language};unit=general` });
  };
  const closeDetail = useCallback(() => {
    setSelected(null);
    window.requestAnimationFrame(() => {
      if (selectionOpener.current?.isConnected) selectionOpener.current.focus({ preventScroll: true });
    });
  }, []);
  const selectUnit = (unit: Unit, opener: HTMLButtonElement) => {
    rememberUnit(unit);
    selectionOpener.current = opener;
    if (mode === 'chess-plus') setSelected(unit);
    else setPlanUnit(unit);
  };
  const changeMode = (next: Mode) => {
    setMode(next);
    setSelected(null);
  };
  const onModeKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = modes.length - 1;
    else return;
    event.preventDefault();
    changeMode(modes[next]);
    modeRefs.current[next]?.focus();
  };
  const floorMin = snapshot.filterSummary.ranges.floor.min || Math.min(...snapshot.units.map((unit) => unit.floor));

  return (
    <main className="bayterak-catalog-site" lang={language}>
      <a className="bayterak-catalog-skip" href="#bayterak-results">{t.skip}</a>
      <header className="bayterak-catalog-header">
        <nav aria-label={t.nav}>
          <a className="bayterak-catalog-wordmark" href={withLanguage('/bayterak', language)} aria-label={t.home}><strong>BAY</strong><span>TERAK</span></a>
          <a className="bayterak-catalog-back" href={withLanguage('/bayterak', language)}><span aria-hidden="true">←</span>{t.back}</a>
          <a className="bayterak-catalog-phone" href="tel:1360"><small>{t.sales}</small><strong>1360</strong></a>
          <div className="bayterak-catalog-languages" role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : undefined} aria-pressed={language === item} lang={item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
        </nav>
      </header>

      <section className="bayterak-catalog-hero" aria-labelledby="bayterak-catalog-title">
        <div className="bayterak-catalog-hero__axis" aria-hidden="true" />
        <div className="bayterak-catalog-hero__copy">
          <span>{t.eyebrow}</span>
          <h1 id="bayterak-catalog-title">{t.title}<em>{t.accent}</em></h1>
          <p>{t.leadBefore} <strong>{snapshot.officialTotalAtCapture}</strong> {t.leadAfter}</p>
          <button type="button" data-lead-trigger onClick={() => openLead(null, 'hero-consultation')}>{t.consult}<span aria-hidden="true">↗</span></button>
        </div>
        <aside aria-label={t.snapshot}>
          <small>{t.snapshot} · 30.08.2026</small>
          <strong>{snapshot.officialTotalAtCapture}</strong><span>{t.proposals}</span>
          <dl>
            <div><dt>{t.captured}</dt><dd>{capturedLabel(snapshot.capturedAt, language)} · UZT</dd></div>
            <div><dt>{t.saleRows}</dt><dd>{snapshot.integrity.allIsSale ? snapshot.officialTotalAtCapture : snapshot.units.filter((unit) => unit.isSale).length}/{snapshot.officialTotalAtCapture}</dd></div>
            <div><dt>{t.localPlans}</dt><dd>{snapshot.integrity.uniquePrimaryPlanUrls}/{snapshot.integrity.uniqueUnitIds}</dd></div>
            <div><dt>{t.propertyClass}</dt><dd>{t.classesSummary}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="bayterak-catalog-controls" aria-labelledby="bayterak-filters-title">
        <div className="bayterak-catalog-modes" role="tablist" aria-label={t.modeLabel}>{modes.map((item, index) => (
          <button ref={(element) => { modeRefs.current[index] = element; }} type="button" role="tab" id={`bayterak-tab-${item}`} aria-selected={mode === item} aria-controls={`bayterak-panel-${item}`} tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : undefined} onClick={() => changeMode(item)} onKeyDown={(event) => onModeKeyDown(event, index)} key={item}><small>0{index + 1}</small><span>{t.modes[item]}</span></button>
        ))}</div>
        <div className="bayterak-catalog-filter-heading"><div><small>FILTER INDEX</small><h2 id="bayterak-filters-title">{t.filters}</h2></div><button type="button" onClick={resetFilters}>{t.reset}<span aria-hidden="true">↺</span></button></div>
        <div className="bayterak-catalog-filters">
          <label><span>{t.propertyClass}</span><select value={filters.propertyClass} onChange={(event) => updateFilter('propertyClass', event.target.value)}><option value="">{t.allClasses}</option>{classes.map((value) => <option value={value} key={value}>{classLabel(value, language)}</option>)}</select></label>
          <label><span>{t.rooms}</span><select value={filters.rooms} onChange={(event) => updateFilter('rooms', event.target.value)}><option value="">{t.allRooms}</option>{rooms.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>{t.areaFrom}</span><input type="number" min={snapshot.filterSummary.ranges.area.min} max={snapshot.filterSummary.ranges.area.max} step="0.01" inputMode="decimal" placeholder={area(snapshot.filterSummary.ranges.area.min, language)} value={filters.areaFrom} onChange={(event) => updateFilter('areaFrom', event.target.value)} /></label>
          <label><span>{t.areaTo}</span><input type="number" min={snapshot.filterSummary.ranges.area.min} max={snapshot.filterSummary.ranges.area.max} step="0.01" inputMode="decimal" placeholder={area(snapshot.filterSummary.ranges.area.max, language)} value={filters.areaTo} onChange={(event) => updateFilter('areaTo', event.target.value)} /></label>
          <label><span>{t.priceFrom}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={formatNumber(Math.floor(snapshot.filterSummary.ranges.currentCampaignPrice.min / 1e6), language)} value={filters.priceFrom} onChange={(event) => updateFilter('priceFrom', event.target.value)} /></label>
          <label><span>{t.priceTo}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={formatNumber(Math.ceil(snapshot.filterSummary.ranges.currentCampaignPrice.max / 1e6), language)} value={filters.priceTo} onChange={(event) => updateFilter('priceTo', event.target.value)} /></label>
          <label><span>{t.floor}</span><select value={filters.floor} onChange={(event) => updateFilter('floor', event.target.value)}><option value="">{t.allFloors}</option>{floors.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label className="is-wide"><span>{t.building}</span><select value={filters.building} onChange={(event) => updateFilter('building', event.target.value)}><option value="">{t.allBuildings}</option>{snapshot.filterSummary.blocks.map((value) => <option value={value.id} key={value.id}>{value.displayName} · {value.count}</option>)}</select></label>
          <label><span>{t.entrance}</span><select value={filters.entrance} onChange={(event) => updateFilter('entrance', event.target.value)}><option value="">{t.allEntrances}</option>{entrances.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label className="is-wide"><span>{t.completion}</span><select value={filters.completion} onChange={(event) => updateFilter('completion', event.target.value)}><option value="">{t.allCompletions}</option>{completions.map((value) => <option value={value} key={value}>{dateLabel(value, language)}</option>)}</select></label>
          <label><span>{t.repair}</span><select value={filters.repair} onChange={(event) => updateFilter('repair', event.target.value)}><option value="">{t.any}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select></label>
          <label><span>{t.studio}</span><select value={filters.studio} onChange={(event) => updateFilter('studio', event.target.value)}><option value="">{t.any}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select></label>
        </div>
      </section>

      <section id="bayterak-results" className="bayterak-catalog-results" aria-labelledby="bayterak-results-title">
        <header>
          <div aria-live="polite"><small>REGISTER · {mode === 'cards' ? '01' : mode === 'chess' ? '02' : '03'}</small><h2 id="bayterak-results-title"><strong>{filtered.length}</strong> {t.results}</h2></div>
          <label><span>{t.sort}</span><select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setVisible(pageSize); }}>{(Object.entries(t.sorts) as Array<[Sort, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </header>
        <aside className="bayterak-catalog-source"><span aria-hidden="true">i</span><div><strong>{t.sourceTitle}</strong><p>{t.sourceNoteBefore} {snapshot.officialTotalAtCapture} {t.sourceNoteAfter}</p></div><a href={officialLanding(language)} target="_blank" rel="noreferrer">{t.officialSource}<span aria-hidden="true">↗</span></a></aside>

        {modes.filter((item) => item !== mode).map((item) => <div id={`bayterak-panel-${item}`} role="tabpanel" aria-labelledby={`bayterak-tab-${item}`} hidden key={item} />)}

        {filtered.length === 0 ? (
          <div id={`bayterak-panel-${mode}`} className="bayterak-catalog-empty" role="tabpanel" aria-labelledby={`bayterak-tab-${mode}`}><span aria-hidden="true">∅</span><h2 role="status">{t.noResults}</h2><button type="button" onClick={resetFilters}>{t.resetFilters}</button></div>
        ) : mode === 'cards' ? (
          <div id="bayterak-panel-cards" role="tabpanel" aria-labelledby="bayterak-tab-cards">
            <div className="bayterak-unit-grid">{filtered.slice(0, visible).map((unit) => <UnitCard unit={unit} language={language} onPlan={() => openPlan(unit)} onLead={() => openLead(unit, 'card-cta')} key={unit.id} />)}</div>
            {visible < filtered.length ? <button className="bayterak-catalog-show-more" type="button" onClick={() => setVisible((value) => value + pageSize)}><span>{t.showMore}</span><strong>{t.shown} {Math.min(visible, filtered.length)} {t.of} {filtered.length}</strong><i aria-hidden="true">↓</i></button> : null}
          </div>
        ) : (
          <div id={`bayterak-panel-${mode}`} className="bayterak-matrix" role="tabpanel" aria-labelledby={`bayterak-tab-${mode}`}>
            <header><div><small>{t.modes[mode]}</small><h2>{t.matrix}</h2><p id="bayterak-matrix-help">{t.matrixHint}</p></div></header>
            <div className={`bayterak-matrix-layout${mode === 'chess-plus' ? ' has-detail' : ''}`}>
              <div className="bayterak-matrix-groups">{matrixGroups.map((units) => <MatrixGroup key={`${units[0].buildingId}-${units[0].entrance}`} units={units} language={language} plus={mode === 'chess-plus'} sort={sort} floorMin={floorMin} selectedId={activeSelected?.id} onSelect={selectUnit} />)}</div>
              {mode === 'chess-plus' ? activeSelected ? <UnitDetail key={activeSelected.id} unit={activeSelected} language={language} onClose={closeDetail} onPlan={() => openPlan(activeSelected)} onLead={() => openLead(activeSelected, 'matrix-plus-detail')} /> : <aside className="bayterak-unit-detail bayterak-unit-detail--empty" aria-label={t.selected}><span aria-hidden="true">↖</span><p>{t.selectHint}</p></aside> : null}
            </div>
          </div>
        )}
      </section>

      <footer className="bayterak-catalog-footer"><a className="bayterak-catalog-wordmark" href={withLanguage('/bayterak', language)}><strong>BAY</strong><span>TERAK</span></a><p>{t.disclaimer}</p><a href={privacyUrl(language)}>{t.privacy}</a><a href="#bayterak-catalog-title" aria-label={t.up}>↑</a></footer>

      {planUnit ? <PlanLightbox unit={planUnit} language={language} onClose={() => setPlanUnit(null)} /> : null}
      {leadRequest ? <div className="bayterak-catalog-lead-host" data-project-slug="bayterak" data-context={leadRequest.context} data-unit-uuid={leadRequest.unit?.id}><LeadModal open language={language} context={leadRequest.context} brandName="NRG-BI" projectName="BAYTERAK" tagline={leadRequest.unit ? `${roomPhrase(leadRequest.unit.rooms, language)} · ${areaWithUnit(leadRequest.unit.area, language)} · № ${leadRequest.unit.number}` : `${snapshot.officialTotalAtCapture} · ${t.proposals}`} facts={leadRequest.unit ? [classLabel(leadRequest.unit.propertyClass, language), `${leadRequest.unit.floor}/${leadRequest.unit.totalFloors} · ${t.floorOf}`, money(leadRequest.unit.price, language)] : [t.classesSummary, `${areaWithUnit(snapshot.filterSummary.ranges.area.min, language)}—${areaWithUnit(snapshot.filterSummary.ranges.area.max, language)}`, capturedLabel(snapshot.capturedAt, language)]} submitUrl={leadSubmitUrl()} projectSlug="bayterak" unitId={leadRequest.unit?.id} privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadRequest(null)} /></div> : null}
    </main>
  );
}

export default BayterakCatalog;
