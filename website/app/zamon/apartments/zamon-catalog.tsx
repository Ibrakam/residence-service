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
import { zamonLeadSubmitUrl } from '../zamon-lead';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess' | 'chess-plus';
type Sort = 'source' | 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc' | 'roomsAsc' | 'roomsDesc' | 'numberAsc' | 'numberDesc';
type BooleanFilter = '' | 'yes' | 'no';

type Unit = {
  id: string;
  sourceOrder: number;
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
  balconyArea: number;
  ceilingHeight: string;
  addressRaw: string;
  provenance: {
    endpoint: string;
    capturedAt: string;
    sourceUuid: string;
  };
};

export type ZamonSnapshot = {
  project: string;
  source: string;
  sourceLanding: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  currency: 'UZS';
  blocks: Array<{
    id: string;
    sourceName: string;
    displayName: string;
    count: number;
    normalizedDeadline: string;
    sourcePlacementDeadline: string[];
    totalFloors: number[];
    entrances: number[];
  }>;
  statusSummary: Array<{ id: string; status: string; count: number; isSaleCount: number }>;
  filters: {
    area: { min: number; max: number };
    campaignPrice: { min: number; max: number };
  };
  metrics: {
    areaMin: number;
    areaMax: number;
    campaignPriceMin: number;
    campaignPriceMax: number;
  };
  units: Unit[];
};

type Filters = {
  rooms: string;
  areaFrom: string;
  areaTo: string;
  priceFrom: string;
  priceTo: string;
  floor: string;
  building: string;
  entrance: string;
  completion: string;
  status: string;
  studio: BooleanFilter;
};

type LeadRequest = { unit: Unit | null; context: string };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const languages: Language[] = ['ru', 'uz', 'en'];
const modes: Mode[] = ['cards', 'chess', 'chess-plus'];
const languageStorageKey = 'zamon-language';
const mobileDrawerQuery = '(max-width: 820px)';
const pageSize = 12;
const emptyFilters: Filters = {
  rooms: '', areaFrom: '', areaTo: '', priceFrom: '', priceTo: '', floor: '', building: '', entrance: '', completion: '', status: '', studio: '',
};

const copy = {
  ru: {
    skip: 'К результатам каталога', back: 'О проекте', home: 'Главная Zamon', language: 'Язык', sales: 'Отдел продаж', nav: 'Навигация каталога',
    eyebrow: 'Хронология света · каталог на 30.08.2026', title: 'Реестр', accent: 'света.', actualPhoto: 'Реальная фотография сданной I очереди',
    leadBefore: 'В официальной подборке на дату каталога —', leadAfter: 'позиций. Для каждой указаны планировка, цена, срок и статус из официального источника.',
    snapshot: 'Каталог на', captured: 'Зафиксировано', proposals: 'позиций', saleRows: 'Статус «Свободно»', localPlans: 'Официальные планировки', classesSummary: 'Комфорт', blocksLabel: 'Блоки в каталоге',
    consult: 'Получить консультацию', officialSource: 'Официальный источник', sourceTitle: 'О данных каталога',
    sourceNoteBefore: 'Все', sourceNoteAfter: 'записей получены из одной официальной выгрузки 30.08.2026 в 20:15 по времени Ташкента. Технические статусы не подтверждают юридическую доступность; цена со скидкой и акция относятся к моменту фиксации.',
    modes: { cards: 'Карточки', chess: 'Шахматка', 'chess-plus': 'Шахматка+' }, modeLabel: 'Режим каталога',
    filters: 'Фильтры', filterIndex: 'ПАРАМЕТРЫ КАТАЛОГА', filterGroupOne: 'Квартира и цена', filterGroupTwo: 'Дом и срок', rooms: 'Комнаты', allRooms: 'Все', areaFrom: 'Площадь от, м²', areaTo: 'Площадь до, м²', priceFrom: 'Цена по акции от, млн UZS', priceTo: 'Цена по акции до, млн UZS', floor: 'Этаж', allFloors: 'Все этажи', building: 'Блок', allBuildings: 'Все блоки', entrance: 'Подъезд', allEntrances: 'Все подъезды', completion: 'Срок сдачи', allCompletions: 'Все сроки', statusFilter: 'Статус в каталоге', allStatuses: 'Все статусы', studio: 'Студия', any: 'Любой вариант', yes: 'Да', no: 'Нет', reset: 'Сбросить',
    sort: 'Сортировка', sorts: { source: 'Порядок официального каталога', priceAsc: 'Цена ↑', priceDesc: 'Цена ↓', areaAsc: 'Площадь ↑', areaDesc: 'Площадь ↓', floorAsc: 'Этаж ↑', floorDesc: 'Этаж ↓', roomsAsc: 'Комнаты ↑', roomsDesc: 'Комнаты ↓', numberAsc: 'Номер ↑', numberDesc: 'Номер ↓' }, results: 'найдено', folio: 'КВАРТИРА',
    apartment: 'Квартира', roomsShort: 'комн.', area: 'Площадь', areaUnit: 'м²', currentPrice: 'Цена по акции на 30.08.2026', originalPrice: 'Цена до скидки', perM2: 'Цена за м² · рассчитана от цены по акции', campaign: 'Скидка на дату каталога', campaignUntil: 'до', status: 'Статус', statusNote: 'Статус в официальном каталоге на 30.08.2026', class: 'Класс', floorOf: 'Этаж', entranceShort: 'Подъезд', block: 'Блок', completionShort: 'Срок сдачи', normalized: 'filter/realEstateList · срок', rawPlacement: 'placementList · исходная дата', finishing: 'Ремонт', noFinishing: 'Без ремонта', studioFlag: 'Студия', ceiling: 'Высота потолка', balcony: 'Балкон', datedCampaign: 'Условия относятся к 30.08.2026 и требуют подтверждения',
    unitData: 'Источник и идентификатор', rawStatus: 'Исходный статус / isSale', rawCeiling: 'heightOfWall · исходное значение', pricingSource: 'Источник цены', statusLedger: 'Статусы официального каталога · не гарантия юридической доступности',
    plan: 'Открыть планировку', planAlt: 'Официальная планировка квартиры', choose: 'Уточнить условия', showMore: 'Показать ещё', shown: 'Показано', of: 'из',
    noResults: 'По этим параметрам предложений нет.', resetFilters: 'Сбросить фильтры', matrix: 'Блок × подъезд × этаж × квартира', matrixHint: 'Прокручивайте пальцем или трекпадом, заметными кнопками либо клавишами ← → Home End. Полоса прокрутки остаётся видимой.', scrollLeft: 'Прокрутить матрицу влево', scrollRight: 'Прокрутить матрицу вправо', floorColumn: 'Этаж', unitsColumn: 'Квартиры', emptyFloor: 'Нет предложений по фильтру', height: 'этажей', selected: 'Выбранная квартира', close: 'Закрыть детали', closePlan: 'Закрыть планировку', selectHint: 'Выберите квартиру в матрице, чтобы открыть её паспорт.',
    disclaimer: 'Каталог датирован 30.08.2026 и не является публичной офертой. Наличие и актуальные условия подтверждает отдел продаж.', privacy: 'Политика конфиденциальности', up: 'Наверх',
    statuses: { 'Снятие резерва': 'Снятие резерва', 'Свободно': 'Свободно', 'Расторжение': 'Расторжение', 'Снятие брони': 'Снятие брони', 'Бронирование': 'Бронирование' },
  },
  uz: {
    skip: 'Katalog natijalariga o‘tish', back: 'Loyiha haqida', home: 'Zamon bosh sahifasi', language: 'Til', sales: 'Savdo bo‘limi', nav: 'Katalog navigatsiyasi',
    eyebrow: 'Yorug‘lik xronologiyasi · 30.08.2026 katalogi', title: 'Yorug‘lik', accent: 'reyestri.', actualPhoto: 'Topshirilgan I bosqichning haqiqiy fotosurati',
    leadBefore: 'Katalog sanasidagi rasmiy tanlovda', leadAfter: 'ta pozitsiya bor. Har birida reja, narx, muddat va rasmiy manbadagi holat ko‘rsatilgan.',
    snapshot: 'Katalog sanasi', captured: 'Qayd etilgan vaqt', proposals: 'pozitsiya', saleRows: '«Bo‘sh» holati', localPlans: 'Rasmiy rejalar', classesSummary: 'Komfort', blocksLabel: 'Katalogdagi bloklar',
    consult: 'Maslahat olish', officialSource: 'Rasmiy manba', sourceTitle: 'Katalog ma’lumotlari haqida',
    sourceNoteBefore: 'Barcha', sourceNoteAfter: 'ta yozuv bitta rasmiy yuklamadan 30.08.2026 soat 20:15 da Toshkent vaqti bilan olingan. Texnik holatlar huquqiy mavjudlikni tasdiqlamaydi; chegirmali narx va aksiya qayd etilgan paytga tegishli.',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka', 'chess-plus': 'Shaxmatka+' }, modeLabel: 'Katalog ko‘rinishi',
    filters: 'Filtrlar', filterIndex: 'KATALOG PARAMETRLARI', filterGroupOne: 'Xonadon va narx', filterGroupTwo: 'Uy va muddat', rooms: 'Xonalar', allRooms: 'Barchasi', areaFrom: 'Maydon, m² dan', areaTo: 'Maydon, m² gacha', priceFrom: 'Aksiya narxi, mln UZS dan', priceTo: 'Aksiya narxi, mln UZS gacha', floor: 'Qavat', allFloors: 'Barcha qavatlar', building: 'Blok', allBuildings: 'Barcha bloklar', entrance: 'Kirish', allEntrances: 'Barcha kirishlar', completion: 'Topshirish muddati', allCompletions: 'Barcha muddatlar', statusFilter: 'Katalogdagi holat', allStatuses: 'Barcha holatlar', studio: 'Studiya', any: 'Istalgan variant', yes: 'Ha', no: 'Yo‘q', reset: 'Tozalash',
    sort: 'Saralash', sorts: { source: 'Rasmiy katalog tartibi', priceAsc: 'Narx ↑', priceDesc: 'Narx ↓', areaAsc: 'Maydon ↑', areaDesc: 'Maydon ↓', floorAsc: 'Qavat ↑', floorDesc: 'Qavat ↓', roomsAsc: 'Xonalar ↑', roomsDesc: 'Xonalar ↓', numberAsc: 'Raqam ↑', numberDesc: 'Raqam ↓' }, results: 'topildi', folio: 'XONADON',
    apartment: 'Xonadon', roomsShort: 'xonali', area: 'Maydon', areaUnit: 'm²', currentPrice: '30.08.2026 dagi aksiya narxi', originalPrice: 'Chegirmagacha narx', perM2: 'm² narxi · aksiya narxi asosida', campaign: 'Katalog sanasidagi chegirma', campaignUntil: 'gacha', status: 'Holat', statusNote: '30.08.2026 rasmiy katalogidagi holat', class: 'Toifa', floorOf: 'Qavat', entranceShort: 'Kirish', block: 'Blok', completionShort: 'Topshirish muddati', normalized: 'filter/realEstateList · muddat', rawPlacement: 'placementList · asl sana', finishing: 'Pardoz', noFinishing: 'Pardozsiz', studioFlag: 'Studiya', ceiling: 'Shift balandligi', balcony: 'Balkon', datedCampaign: 'Shartlar 30.08.2026 sanasiga tegishli va tasdiqlanishi kerak',
    unitData: 'Manba va identifikator', rawStatus: 'Asl holat / isSale', rawCeiling: 'heightOfWall · asl qiymat', pricingSource: 'Narx manbasi', statusLedger: 'Rasmiy katalog holatlari · huquqiy mavjudlik kafolati emas',
    plan: 'Rejani ochish', planAlt: 'Xonadonning rasmiy rejasi', choose: 'Shartlarni aniqlash', showMore: 'Yana ko‘rsatish', shown: 'Ko‘rsatildi', of: 'dan',
    noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', resetFilters: 'Filtrlarni tozalash', matrix: 'Blok × kirish × qavat × xonadon', matrixHint: 'Barmoq yoki trekpad, ko‘rinadigan tugmalar yoxud ← → Home End klavishlari bilan suring. Surish chizig‘i ko‘rinib turadi.', scrollLeft: 'Matritsani chapga surish', scrollRight: 'Matritsani o‘ngga surish', floorColumn: 'Qavat', unitsColumn: 'Xonadonlar', emptyFloor: 'Filtr bo‘yicha taklif yo‘q', height: 'qavat', selected: 'Tanlangan xonadon', close: 'Tafsilotlarni yopish', closePlan: 'Rejani yopish', selectHint: 'Pasportini ochish uchun matritsadan xonadon tanlang.',
    disclaimer: 'Katalog 30.08.2026 sanasiga tegishli va ommaviy oferta emas. Mavjudlik hamda amaldagi shartlarni savdo bo‘limi tasdiqlaydi.', privacy: 'Maxfiylik siyosati', up: 'Yuqoriga',
    statuses: { 'Снятие резерва': 'Rezervni olib tashlash', 'Свободно': 'Bo‘sh', 'Расторжение': 'Shartnomani bekor qilish', 'Снятие брони': 'Bronni olib tashlash', 'Бронирование': 'Bron qilish' },
  },
  en: {
    skip: 'Skip to catalogue results', back: 'About the project', home: 'Zamon home', language: 'Language', sales: 'Sales office', nav: 'Catalogue navigation',
    eyebrow: 'Chronology of light · catalogue as of 30 Aug 2026', title: 'Light', accent: 'register.', actualPhoto: 'Actual photograph of completed phase I',
    leadBefore: 'The official selection on the catalogue date contains', leadAfter: 'entries. Each shows a plan, price, completion date and status from the official source.',
    snapshot: 'Catalogue as of', captured: 'Captured', proposals: 'entries', saleRows: '“Available” status', localPlans: 'Official plans', classesSummary: 'Comfort', blocksLabel: 'Blocks in catalogue',
    consult: 'Request a consultation', officialSource: 'Official source', sourceTitle: 'About the catalogue data',
    sourceNoteBefore: 'All', sourceNoteAfter: 'records came from one official export captured on 30 Aug 2026 at 20:15 Tashkent time. Technical statuses do not confirm legal availability; promotional pricing and the campaign reflect the capture time.',
    modes: { cards: 'Cards', chess: 'Matrix', 'chess-plus': 'Matrix+' }, modeLabel: 'Catalogue view',
    filters: 'Filters', filterIndex: 'CATALOGUE PARAMETERS', filterGroupOne: 'Apartment and price', filterGroupTwo: 'Building and completion', rooms: 'Rooms', allRooms: 'Any', areaFrom: 'Area from, m²', areaTo: 'Area to, m²', priceFrom: 'Promotional price from, million UZS', priceTo: 'Promotional price to, million UZS', floor: 'Floor', allFloors: 'Any floor', building: 'Block', allBuildings: 'All blocks', entrance: 'Entrance', allEntrances: 'All entrances', completion: 'Completion date', allCompletions: 'All dates', statusFilter: 'Catalogue status', allStatuses: 'All statuses', studio: 'Studio', any: 'Any option', yes: 'Yes', no: 'No', reset: 'Reset',
    sort: 'Sort', sorts: { source: 'Official catalogue order', priceAsc: 'Price ↑', priceDesc: 'Price ↓', areaAsc: 'Area ↑', areaDesc: 'Area ↓', floorAsc: 'Floor ↑', floorDesc: 'Floor ↓', roomsAsc: 'Rooms ↑', roomsDesc: 'Rooms ↓', numberAsc: 'Number ↑', numberDesc: 'Number ↓' }, results: 'found', folio: 'APARTMENT',
    apartment: 'Apartment', roomsShort: 'room', area: 'Area', areaUnit: 'm²', currentPrice: 'Promotional price on 30 Aug 2026', originalPrice: 'Price before discount', perM2: 'Price per m² · derived from promotional price', campaign: 'Discount on catalogue date', campaignUntil: 'until', status: 'Status', statusNote: 'Status in the official catalogue on 30 Aug 2026', class: 'Class', floorOf: 'Floor', entranceShort: 'Entrance', block: 'Block', completionShort: 'Completion date', normalized: 'filter/realEstateList · completion', rawPlacement: 'placementList · original date', finishing: 'Finishing', noFinishing: 'No finishing', studioFlag: 'Studio', ceiling: 'Ceiling height', balcony: 'Balcony', datedCampaign: 'Terms reflect 30 Aug 2026 and require confirmation',
    unitData: 'Source and identifier', rawStatus: 'Original status / isSale', rawCeiling: 'heightOfWall · original value', pricingSource: 'Price source', statusLedger: 'Official catalogue statuses · not a guarantee of legal availability',
    plan: 'Open floor plan', planAlt: 'Official apartment floor plan', choose: 'Check terms', showMore: 'Show more', shown: 'Shown', of: 'of',
    noResults: 'No listings match these filters.', resetFilters: 'Reset filters', matrix: 'Block × entrance × floor × apartment', matrixHint: 'Swipe or use a trackpad, the visible controls, or the ← → Home End keys. The scrollbar remains visible.', scrollLeft: 'Scroll matrix left', scrollRight: 'Scroll matrix right', floorColumn: 'Floor', unitsColumn: 'Apartments', emptyFloor: 'No filtered listings', height: 'floors', selected: 'Selected apartment', close: 'Close details', closePlan: 'Close floor plan', selectHint: 'Select an apartment in the matrix to open its register entry.',
    disclaimer: 'The catalogue is dated 30 Aug 2026 and is not a public offer. The sales team confirms availability and current terms.', privacy: 'Privacy policy', up: 'Back to top',
    statuses: { 'Снятие резерва': 'Reservation release', 'Свободно': 'Available', 'Расторжение': 'Termination', 'Снятие брони': 'Booking release', 'Бронирование': 'Booking' },
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function isLanguage(value: string | null): value is Language { return value === 'ru' || value === 'uz' || value === 'en'; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${withLanguage('/privacy', language)}&project=zamon`; }
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
  if (/комфорт|comfort/i.test(value)) return 'Comfort';
  return language === 'ru' ? 'Класс проекта' : language === 'uz' ? 'Loyiha toifasi' : 'Project class';
}
function buildingLabel(value: string) {
  if (value === 'NRG Zamon 2-2') return 'Zamon 2-2';
  if (value === 'NRG Zamon 3 - 1') return 'Zamon 3-1';
  return value;
}
function statusLabel(unit: Unit, language: Language) {
  const statuses = copy[language].statuses as Record<string, string>;
  return statuses[unit.statusOriginal] ?? (language === 'ru' ? unit.statusOriginal : language === 'uz' ? 'Boshqa katalog holati' : 'Other catalogue status');
}
function ceilingDisplay(language: Language) {
  if (language === 'uz') return 'Kamida 2,85 m';
  if (language === 'en') return 'At least 2.85 m';
  return 'Не менее 2,85 м';
}
function phaseIndex(unit: Unit) {
  return unit.building === 'NRG Zamon 2-2' ? '02' : '03';
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
  if (sort === 'source') return a.sourceOrder - b.sourceOrder;
  if (sort === 'priceAsc') return a.price - b.price || numberTie(a, b);
  if (sort === 'priceDesc') return b.price - a.price || numberTie(a, b);
  if (sort === 'areaAsc') return a.area - b.area || numberTie(a, b);
  if (sort === 'areaDesc') return b.area - a.area || numberTie(a, b);
  if (sort === 'floorAsc') return a.floor - b.floor || numberTie(a, b);
  if (sort === 'floorDesc') return b.floor - a.floor || numberTie(a, b);
  if (sort === 'roomsAsc') return a.rooms - b.rooms || numberTie(a, b);
  if (sort === 'roomsDesc') return b.rooms - a.rooms || numberTie(a, b);
  if (sort === 'numberDesc') return -numberTie(a, b);
  return numberTie(a, b);
}
function officialLanding(language: Language) {
  return language === 'ru' ? 'https://nrg-bi.uz/uz-ru/landing/zamon' : 'https://nrg-bi.uz/uz/landing/zamon';
}
function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
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
    block: unit.building,
    blockName: unit.building,
    blockId: unit.buildingId,
    price: unit.price,
    normalizedDeadline: unit.completionDate,
    sourceStatus: unit.statusOriginal,
    studio: unit.studio,
  }, 'zamon');
}

function unitContext(unit: Unit, surface: string, language: Language) {
  return [
    'projectSlug=zamon', `surface=catalog:${surface}`, `lang=${language}`, `unitUuid=${unit.id}`, `number=${unit.number}`,
    `buildingId=${unit.buildingId}`, `building=${unit.building}`, `entrance=${unit.entrance}`, `floor=${unit.floor}/${unit.totalFloors}`,
    `rooms=${unit.rooms}`, `area=${unit.area}`, `class=${unit.propertyClass}`, `completion=${unit.completionDate}`,
    `workflowStatusId=${unit.statusId}`, `workflowStatus=${unit.statusOriginal}`, `isSale=${unit.isSale}`,
    `repairIncluded=${unit.repairIncluded}`, `studio=${unit.studio}`, `currentPrice=${unit.price}`, `originalPrice=${unit.oldPrice}`,
  ].join(';');
}

function StatusTag({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return <span className="zamon-status" data-tone={statusTone(unit.statusOriginal)}><i aria-hidden="true" /><span>{statusLabel(unit, language)}</span><small>{t.statusNote}</small></span>;
}

function PlanPreview({ unit, language, onOpen, compact = false }: { unit: Unit; language: Language; onOpen: (opener: HTMLButtonElement) => void; compact?: boolean }) {
  const t = copy[language];
  return (
    <button className={`zamon-plan-preview${compact ? ' is-compact' : ''}`} type="button" onClick={(event) => onOpen(event.currentTarget)} aria-haspopup="dialog" aria-label={`${t.plan}: № ${unit.number}`}>
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
    const releaseBody = lockBody();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),a[href]'));
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
    };
  }, [onClose]);

  return (
    <div ref={dialogRef} className="zamon-plan-lightbox" role="dialog" aria-modal="true" aria-labelledby={`zamon-plan-title-${unit.id}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button className="zamon-plan-lightbox__backdrop" type="button" tabIndex={-1} aria-hidden="true" onClick={onClose} />
      <button ref={closeRef} className="zamon-plan-lightbox__close" type="button" onClick={onClose} aria-label={t.closePlan}>×</button>
      <figure>
        <img src={asset(unit.plan)} alt={`${t.planAlt} № ${unit.number}`} />
        <figcaption id={`zamon-plan-title-${unit.id}`}><strong>№ {unit.number} · {roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</strong><span>{buildingLabel(unit.building)} · {unit.floor}/{unit.totalFloors}</span></figcaption>
      </figure>
    </div>
  );
}

function CampaignPrice({ unit, language, detailed = false }: { unit: Unit; language: Language; detailed?: boolean }) {
  const t = copy[language];
  const campaign = hasCampaign(unit);
  return (
    <div className={`zamon-price${detailed ? ' is-detailed' : ''}`}>
      <small>{t.currentPrice}</small>
      <strong>{money(unit.price, language)}</strong>
      <span>{t.perM2}: {money(unit.currentPricePerM2, language)}</span>
      {campaign ? <del>{t.originalPrice}: {money(unit.oldPrice, language)}</del> : null}
      {campaign ? <b>−{unit.promotion?.percent}% · {t.campaign}{unit.promotion?.deadlineUtc ? ` ${t.campaignUntil} ${dateLabel(unit.promotion.deadlineUtc, language)}` : ''}</b> : null}
      {campaign && detailed ? <em>{t.datedCampaign}</em> : null}
    </div>
  );
}

function UnitProvenance({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return (
    <details className="zamon-unit-provenance">
      <summary>{t.unitData}<span aria-hidden="true">＋</span></summary>
      <dl>
        <div><dt>UUID</dt><dd>{unit.id}</dd></div>
        <div><dt>{t.rawStatus}</dt><dd><span lang="ru">{unit.statusOriginal}</span> · {unit.statusId} · isSale={String(unit.isSale)}</dd></div>
        <div><dt>{t.normalized}</dt><dd>{unit.completionDate}</dd></div>
        <div><dt>{t.rawPlacement}</dt><dd>{unit.sourcePlacementCompletionDate}</dd></div>
        <div><dt>{t.rawCeiling}</dt><dd lang="ru">{unit.ceilingHeight}</dd></div>
        <div><dt>{t.pricingSource}</dt><dd>discount.stock.data[0].priceWithDiscount · totalPrice</dd></div>
      </dl>
    </details>
  );
}

function UnitCard({ unit, language, onPlan, onLead }: { unit: Unit; language: Language; onPlan: (opener: HTMLButtonElement) => void; onLead: () => void }) {
  const t = copy[language];
  return (
    <article className="zamon-unit-card" data-unit-id={unit.id} data-phase={phaseIndex(unit)}>
      <header><small>{phaseIndex(unit)} · {buildingLabel(unit.building)}</small><span>№ {unit.number}</span></header>
      <PlanPreview unit={unit} language={language} onOpen={onPlan} />
      <div className="zamon-unit-card__body">
        <StatusTag unit={unit} language={language} />
        <div className="zamon-unit-card__name"><small>{buildingLabel(unit.building)} · {t.apartment} № {unit.number}</small><h3>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h3></div>
        <dl>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
          <div><dt>{t.finishing}</dt><dd>{unit.repairIncluded ? t.yes : t.noFinishing}</dd></div>
          <div><dt>{t.studioFlag}</dt><dd>{unit.studio ? t.yes : t.no}</dd></div>
          <div><dt>{t.balcony}</dt><dd>{areaWithUnit(unit.balconyArea, language)}</dd></div>
          <div><dt>{t.ceiling}</dt><dd>{ceilingDisplay(language)}</dd></div>
        </dl>
        <CampaignPrice unit={unit} language={language} detailed />
        <UnitProvenance unit={unit} language={language} />
        <button className="zamon-unit-card__cta" type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
      </div>
    </article>
  );
}

function UnitDetail({ unit, language, onClose, onPlan, onLead, obscured }: { unit: Unit; language: Language; onClose: () => void; onPlan: (opener: HTMLButtonElement) => void; onLead: () => void; obscured: boolean }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useSyncExternalStore(subscribeMobileDrawer, mobileDrawerSnapshot, mobileDrawerServerSnapshot);
  const t = copy[language];

  useEffect(() => {
    const releaseBody = mobileDrawer ? lockBody() : undefined;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.zamon-plan-lightbox, .lead-modal')) return;
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
      <div className="zamon-unit-detail-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <aside ref={panelRef} id={`zamon-detail-${unit.id}`} className="zamon-unit-detail" role={mobileDrawer ? 'dialog' : 'region'} aria-modal={mobileDrawer || undefined} aria-hidden={obscured || undefined} inert={obscured ? true : undefined} aria-labelledby={`zamon-detail-title-${unit.id}`} aria-describedby={`zamon-detail-status-${unit.id}`}>
        <header>
          <div><small>{t.selected}</small><strong id={`zamon-detail-title-${unit.id}`}>№ {unit.number}</strong></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <PlanPreview unit={unit} language={language} compact onOpen={onPlan} />
        <div id={`zamon-detail-status-${unit.id}`} className="zamon-unit-detail__status"><StatusTag unit={unit} language={language} /></div>
        <h3>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h3>
        <dl>
          <div><dt>{t.block}</dt><dd>{buildingLabel(unit.building)}</dd></div>
          <div><dt>{t.class}</dt><dd>{classLabel(unit.propertyClass, language)}</dd></div>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
          <div><dt>{t.finishing}</dt><dd>{unit.repairIncluded ? t.yes : t.noFinishing}</dd></div>
          <div><dt>{t.studioFlag}</dt><dd>{unit.studio ? t.yes : t.no}</dd></div>
          <div><dt>{t.balcony}</dt><dd>{areaWithUnit(unit.balconyArea, language)}</dd></div>
          <div><dt>{t.ceiling}</dt><dd>{ceilingDisplay(language)}</dd></div>
        </dl>
        <CampaignPrice unit={unit} language={language} detailed />
        <UnitProvenance unit={unit} language={language} />
        <button className="zamon-unit-detail__cta" type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
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
    <section className="zamon-matrix-group">
      <header>
        <div><small>{phaseIndex(units[0])} · {buildingLabel(building)} · {dateLabel(units[0].completionDate, language)}</small><h3>{t.entranceShort} {entrance} · {totalFloors} {t.height}</h3></div>
        <div className="zamon-matrix-group__controls" role="group" aria-label={`${t.matrix}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>
          <button type="button" disabled={edges.start} onClick={() => move(-1)} aria-label={`${t.scrollLeft}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>←</button>
          <button type="button" disabled={edges.end} onClick={() => move(1)} aria-label={`${t.scrollRight}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`}>→</button>
        </div>
      </header>
      <div ref={viewportRef} className="zamon-matrix-viewport" tabIndex={0} onKeyDown={onKeyDown} onScroll={updateEdges} aria-label={`${t.matrix}: ${buildingLabel(building)}, ${t.entranceShort} ${entrance}`} aria-describedby="zamon-matrix-help">
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
                    <button type="button" key={unit.id} className={selected ? 'is-selected' : undefined} aria-pressed={plus ? selected : undefined} aria-expanded={plus ? selected : undefined} aria-controls={plus && selected ? `zamon-detail-${unit.id}` : undefined} onClick={(event) => onSelect(unit, event.currentTarget)} aria-label={`${t.apartment} № ${unit.number}, ${classLabel(unit.propertyClass, language)}, ${roomPhrase(unit.rooms, language)}, ${areaWithUnit(unit.area, language)}, ${t.floorOf} ${unit.floor}/${unit.totalFloors}, ${statusLabel(unit, language)}, ${money(unit.price, language)}`}>
                      <small><span>№ {unit.number}</span><i data-tone={statusTone(unit.statusOriginal)} aria-hidden="true" /></small>
                      <strong>{areaWithUnit(unit.area, language)}</strong>
                      <span>{roomPhrase(unit.rooms, language)} · {shortMoney(unit.price, language)}</span>
                      {plus ? <em>{classLabel(unit.propertyClass, language)} · {unit.repairIncluded ? t.finishing : t.studioFlag}: {unit.repairIncluded || unit.studio ? t.yes : t.no}</em> : null}
                    </button>
                  );
                })}</div> : <span className="zamon-matrix-empty">— <span className="zamon-visually-hidden">{t.emptyFloor}</span></span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

export function ZamonCatalog({ snapshot, initialLanguage }: { snapshot: ZamonSnapshot; initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [mode, setMode] = useState<Mode>('cards');
  const [sort, setSort] = useState<Sort>('source');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [visible, setVisible] = useState(pageSize);
  const [selected, setSelected] = useState<Unit | null>(null);
  const [planUnit, setPlanUnit] = useState<Unit | null>(null);
  const [leadRequest, setLeadRequest] = useState<LeadRequest | null>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionOpener = useRef<HTMLButtonElement | null>(null);
  const planOpener = useRef<HTMLButtonElement | null>(null);
  const t = copy[language];

  useEffect(() => {
    if (!leadRequest) return;
    return lockBody();
  }, [leadRequest]);

  const rooms = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.rooms))).sort((a, b) => a - b), [snapshot.units]);
  const floors = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.floor))).sort((a, b) => a - b), [snapshot.units]);
  const entrances = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.entrance))).sort((a, b) => a - b), [snapshot.units]);
  const completions = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.completionDate))).sort(), [snapshot.units]);
  const statuses = useMemo(() => snapshot.statusSummary.map((item) => item.status), [snapshot.statusSummary]);

  const filtered = useMemo(() => {
    const priceFrom = filters.priceFrom ? Number(filters.priceFrom) * 1e6 : -Infinity;
    const priceTo = filters.priceTo ? Number(filters.priceTo) * 1e6 : Infinity;
    const areaFrom = filters.areaFrom ? Number(filters.areaFrom) : -Infinity;
    const areaTo = filters.areaTo ? Number(filters.areaTo) : Infinity;
    return snapshot.units.filter((unit) => (
      (!filters.rooms || unit.rooms === Number(filters.rooms))
      && unit.area >= areaFrom && unit.area <= areaTo
      && unit.price >= priceFrom && unit.price <= priceTo
      && (!filters.floor || unit.floor === Number(filters.floor))
      && (!filters.building || unit.buildingId === filters.building)
      && (!filters.entrance || unit.entrance === Number(filters.entrance))
      && (!filters.completion || unit.completionDate === filters.completion)
      && (!filters.status || unit.statusOriginal === filters.status)
      && (!filters.studio || unit.studio === (filters.studio === 'yes'))
    )).sort((a, b) => compareUnits(a, b, sort));
  }, [filters, snapshot.units, sort]);

  const matrixGroups = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    filtered.forEach((unit) => {
      const key = `${unit.buildingId}|${unit.entrance}`;
      groups.set(key, [...(groups.get(key) ?? []), unit]);
    });
    const blockOrder = new Map(snapshot.blocks.map((block, index) => [block.id, index]));
    return Array.from(groups.values()).sort((a, b) => (blockOrder.get(a[0].buildingId) ?? 999) - (blockOrder.get(b[0].buildingId) ?? 999) || a[0].entrance - b[0].entrance);
  }, [filtered, snapshot.blocks]);

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
  const openPlan = (unit: Unit, opener: HTMLButtonElement) => {
    rememberUnit(unit);
    planOpener.current = opener;
    setPlanUnit(unit);
  };
  const closePlan = useCallback(() => {
    const opener = planOpener.current;
    setPlanUnit(null);
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      planOpener.current = null;
    });
  }, []);
  const openLead = (unit: Unit | null, surface: string) => {
    measuredScrollbarWidth = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    if (unit) rememberUnit(unit);
    setLeadRequest({ unit, context: unit ? unitContext(unit, surface, language) : `projectSlug=zamon;surface=catalog:${surface};lang=${language};unit=general` });
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
    else {
      planOpener.current = opener;
      setPlanUnit(unit);
    }
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
  return (
    <main className="zamon-catalog-site" lang={language}>
      <a className="zamon-catalog-skip" href="#zamon-results">{t.skip}</a>
      <header className="zamon-catalog-header">
        <nav aria-label={t.nav}>
          <a className="zamon-catalog-wordmark" href={withLanguage('/zamon', language)} aria-label={t.home}><strong>Zamon</strong><span>NRG-BI</span></a>
          <a className="zamon-catalog-back" href={withLanguage('/zamon', language)}><span aria-hidden="true">←</span>{t.back}</a>
          <a className="zamon-catalog-phone" href="tel:1360"><small>{t.sales}</small><strong>1360</strong></a>
          <div className="zamon-catalog-languages" role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : undefined} aria-pressed={language === item} lang={item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
        </nav>
      </header>

      <section className="zamon-catalog-hero" aria-labelledby="zamon-catalog-title">
        <div className="zamon-catalog-hero__axis" aria-hidden="true" />
        <div className="zamon-catalog-hero__copy">
          <span>{t.eyebrow}</span>
          <h1 id="zamon-catalog-title">{t.title}<em>{t.accent}</em></h1>
          <p>{t.leadBefore} <strong>{snapshot.officialTotalAtCapture}</strong> {t.leadAfter}</p>
          <button type="button" data-lead-trigger onClick={() => openLead(null, 'hero-consultation')}>{t.consult}<span aria-hidden="true">↗</span></button>
        </div>
        <figure className="zamon-catalog-hero__photo"><img src={asset('/zamon/images/hero-phase-one.webp')} alt={t.actualPhoto} fetchPriority="high" decoding="async" /><figcaption><span>01</span>{t.actualPhoto}</figcaption></figure>
        <aside aria-label={t.snapshot}>
          <small>{t.snapshot} · 30.08.2026</small>
          <strong>{snapshot.officialTotalAtCapture}</strong><span>{t.proposals}</span>
          <dl>
            <div><dt>{t.captured}</dt><dd>{capturedLabel(snapshot.capturedAt, language)}</dd></div>
            <div><dt>{t.blocksLabel}</dt><dd>{snapshot.blocks.map((block) => block.displayName).join(' · ')}</dd></div>
            <div><dt>{t.saleRows}</dt><dd>{snapshot.statusSummary.find((item) => item.status === 'Свободно')?.count ?? 0}/{snapshot.officialTotalAtCapture}</dd></div>
            <div><dt>{t.localPlans}</dt><dd>{snapshot.units.length}/{snapshot.units.length}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="zamon-catalog-controls" aria-labelledby="zamon-filters-title">
        <div className="zamon-catalog-modes" role="tablist" aria-label={t.modeLabel}>{modes.map((item, index) => (
          <button ref={(element) => { modeRefs.current[index] = element; }} type="button" role="tab" id={`zamon-tab-${item}`} aria-selected={mode === item} aria-controls={`zamon-panel-${item}`} tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : undefined} onClick={() => changeMode(item)} onKeyDown={(event) => onModeKeyDown(event, index)} key={item}><small>0{index + 1}</small><span>{t.modes[item]}</span></button>
        ))}</div>
        <div className="zamon-catalog-filter-heading"><div><small>{t.filterIndex}</small><h2 id="zamon-filters-title">{t.filters}</h2></div><button type="button" onClick={resetFilters}>{t.reset}<span aria-hidden="true">↺</span></button></div>
        <div className="zamon-catalog-filters">
          <fieldset><legend><span>01</span>{t.filterGroupOne}</legend><div>
            <label><span>{t.rooms}</span><select value={filters.rooms} onChange={(event) => updateFilter('rooms', event.target.value)}><option value="">{t.allRooms}</option>{rooms.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label><span>{t.areaFrom}</span><input type="number" min={snapshot.filters.area.min} max={snapshot.filters.area.max} step="0.01" inputMode="decimal" placeholder={area(snapshot.filters.area.min, language)} value={filters.areaFrom} onChange={(event) => updateFilter('areaFrom', event.target.value)} /></label>
            <label><span>{t.areaTo}</span><input type="number" min={snapshot.filters.area.min} max={snapshot.filters.area.max} step="0.01" inputMode="decimal" placeholder={area(snapshot.filters.area.max, language)} value={filters.areaTo} onChange={(event) => updateFilter('areaTo', event.target.value)} /></label>
            <label><span>{t.priceFrom}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={formatNumber(Math.floor(snapshot.filters.campaignPrice.min / 1e6), language)} value={filters.priceFrom} onChange={(event) => updateFilter('priceFrom', event.target.value)} /></label>
            <label><span>{t.priceTo}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={formatNumber(Math.ceil(snapshot.filters.campaignPrice.max / 1e6), language)} value={filters.priceTo} onChange={(event) => updateFilter('priceTo', event.target.value)} /></label>
          </div></fieldset>
          <fieldset><legend><span>02</span>{t.filterGroupTwo}</legend><div>
            <label><span>{t.floor}</span><select value={filters.floor} onChange={(event) => updateFilter('floor', event.target.value)}><option value="">{t.allFloors}</option>{floors.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label><span>{t.building}</span><select value={filters.building} onChange={(event) => updateFilter('building', event.target.value)}><option value="">{t.allBuildings}</option>{snapshot.blocks.map((value) => <option value={value.id} key={value.id}>{value.displayName} · {value.count}</option>)}</select></label>
            <label><span>{t.entrance}</span><select value={filters.entrance} onChange={(event) => updateFilter('entrance', event.target.value)}><option value="">{t.allEntrances}</option>{entrances.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
            <label><span>{t.completion}</span><select value={filters.completion} onChange={(event) => updateFilter('completion', event.target.value)}><option value="">{t.allCompletions}</option>{completions.map((value) => <option value={value} key={value}>{dateLabel(value, language)}</option>)}</select></label>
            <label><span>{t.statusFilter}</span><select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}><option value="">{t.allStatuses}</option>{statuses.map((value) => <option value={value} key={value}>{statusLabel(snapshot.units.find((unit) => unit.statusOriginal === value)!, language)}</option>)}</select></label>
            <label><span>{t.studio}</span><select value={filters.studio} onChange={(event) => updateFilter('studio', event.target.value)}><option value="">{t.any}</option><option value="yes">{t.yes}</option><option value="no">{t.no}</option></select></label>
          </div></fieldset>
        </div>
      </section>

      <section id="zamon-results" className="zamon-catalog-results" aria-labelledby="zamon-results-title">
        <header>
          <div aria-live="polite"><small>{t.folio} · {mode === 'cards' ? '01' : mode === 'chess' ? '02' : '03'}</small><h2 id="zamon-results-title"><strong>{filtered.length}</strong> {t.results}</h2></div>
          <label><span>{t.sort}</span><select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setVisible(pageSize); }}>{(Object.entries(t.sorts) as Array<[Sort, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </header>
        <section className="zamon-status-ledger" aria-label={t.statusLedger}><p>{t.statusLedger}</p><div>{snapshot.statusSummary.map((item) => <article key={item.id}><strong>{item.count}</strong><span>{statusLabel(snapshot.units.find((unit) => unit.statusOriginal === item.status)!, language)}</span></article>)}</div></section>
        <details className="zamon-catalog-source"><summary><span aria-hidden="true">i</span><strong>{t.sourceTitle}</strong><em aria-hidden="true">＋</em></summary><div><p>{t.sourceNoteBefore} {snapshot.officialTotalAtCapture} {t.sourceNoteAfter}</p><a href={officialLanding(language)} target="_blank" rel="noreferrer">{t.officialSource}<span aria-hidden="true">↗</span></a></div></details>

        {modes.filter((item) => item !== mode).map((item) => <div id={`zamon-panel-${item}`} role="tabpanel" aria-labelledby={`zamon-tab-${item}`} hidden key={item} />)}

        {filtered.length === 0 ? (
          <div id={`zamon-panel-${mode}`} className="zamon-catalog-empty" role="tabpanel" aria-labelledby={`zamon-tab-${mode}`}><span aria-hidden="true">∅</span><h2 role="status">{t.noResults}</h2><button type="button" onClick={resetFilters}>{t.resetFilters}</button></div>
        ) : mode === 'cards' ? (
          <div id="zamon-panel-cards" role="tabpanel" aria-labelledby="zamon-tab-cards">
            <div className="zamon-unit-grid">{filtered.slice(0, visible).map((unit) => <UnitCard unit={unit} language={language} onPlan={(opener) => openPlan(unit, opener)} onLead={() => openLead(unit, 'card-cta')} key={unit.id} />)}</div>
            {visible < filtered.length ? <button className="zamon-catalog-show-more" type="button" onClick={() => setVisible((value) => value + pageSize)}><span>{t.showMore}</span><strong>{t.shown} {Math.min(visible, filtered.length)} {t.of} {filtered.length}</strong><i aria-hidden="true">↓</i></button> : null}
          </div>
        ) : (
          <div id={`zamon-panel-${mode}`} className="zamon-matrix" role="tabpanel" aria-labelledby={`zamon-tab-${mode}`}>
            <header><div><small>{t.modes[mode]}</small><h2>{t.matrix}</h2><p id="zamon-matrix-help">{t.matrixHint}</p></div></header>
            <div className={`zamon-matrix-layout${mode === 'chess-plus' ? ' has-detail' : ''}`}>
              <div className="zamon-matrix-groups">{matrixGroups.map((units) => { const publishedGroupUnits = snapshot.units.filter((unit) => unit.buildingId === units[0].buildingId && unit.entrance === units[0].entrance); const floorMin = Math.min(...publishedGroupUnits.map((unit) => unit.floor)); return <MatrixGroup key={`${units[0].buildingId}-${units[0].entrance}`} units={units} language={language} plus={mode === 'chess-plus'} sort={sort} floorMin={floorMin} selectedId={activeSelected?.id} onSelect={selectUnit} />; })}</div>
              {mode === 'chess-plus' ? activeSelected ? <UnitDetail key={activeSelected.id} unit={activeSelected} language={language} onClose={closeDetail} onPlan={(opener) => openPlan(activeSelected, opener)} onLead={() => openLead(activeSelected, 'matrix-plus-detail')} obscured={Boolean(planUnit)} /> : <aside className="zamon-unit-detail zamon-unit-detail--empty" aria-label={t.selected}><span aria-hidden="true">↖</span><p>{t.selectHint}</p></aside> : null}
            </div>
          </div>
        )}
      </section>

      <footer className="zamon-catalog-footer"><a className="zamon-catalog-wordmark" href={withLanguage('/zamon', language)}><strong>Zamon</strong><span>NRG-BI</span></a><p>{t.disclaimer}</p><a href={privacyUrl(language)}>{t.privacy}</a><a href="#zamon-catalog-title" aria-label={t.up}>↑</a></footer>

      {planUnit ? <PlanLightbox unit={planUnit} language={language} onClose={closePlan} /> : null}
      {leadRequest ? <div className="zamon-catalog-lead-host" data-project-slug="zamon" data-context={leadRequest.context} data-unit-uuid={leadRequest.unit?.id}><LeadModal open language={language} context={leadRequest.context} brandName="NRG-BI" projectName="ZAMON" tagline={leadRequest.unit ? `${roomPhrase(leadRequest.unit.rooms, language)} · ${areaWithUnit(leadRequest.unit.area, language)} · № ${leadRequest.unit.number}` : `${snapshot.officialTotalAtCapture} · ${t.proposals}`} facts={leadRequest.unit ? [classLabel(leadRequest.unit.propertyClass, language), `${leadRequest.unit.floor}/${leadRequest.unit.totalFloors} · ${t.floorOf}`, money(leadRequest.unit.price, language)] : [t.classesSummary, `${areaWithUnit(snapshot.filters.area.min, language)}—${areaWithUnit(snapshot.filters.area.max, language)}`, capturedLabel(snapshot.capturedAt, language)]} submitUrl={zamonLeadSubmitUrl()} projectSlug="zamon" unitId={leadRequest.unit?.id} privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadRequest(null)} /></div> : null}
    </main>
  );
}

export default ZamonCatalog;
