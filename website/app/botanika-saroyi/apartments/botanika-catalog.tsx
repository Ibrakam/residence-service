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
import { botanikaLeadSubmitUrl } from '../botanika-lead';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess';
type Sort = 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc';

type Unit = {
  id: string;
  number: string;
  rooms: number;
  area: number;
  price: number;
  oldPrice: number;
  totalPriceWithDiscountRaw: number;
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
  repairPrice?: number | null;
  repairSum?: number | null;
  studio: boolean;
  balconyArea: number | null;
  ceilingHeight: string;
  provenance: {
    catalogIndex: number;
    api: string;
    capturedAt: string;
    sourceSha256: string;
    localSha256: string;
  };
};

export type BotanikaSnapshot = {
  project: string;
  source: string;
  sourceLanding: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  currency: 'UZS';
  integrity: {
    uniqueUnitIds: number;
    uniqueFloorplanUrls: number;
    reachableFloorplans: number;
    apartmentSheetUrlsPreserved: number;
    isSaleTrue: number;
    includedNonSaleBooking: number;
  };
  filterSummary: {
    rooms: number[];
    areaMin: number;
    areaMax: number;
    currentPriceMin: number;
    currentPriceMax: number;
    originalPriceMin: number;
    originalPriceMax: number;
    sourcePricePerM2Min: number;
    sourcePricePerM2Max: number;
    floorMin: number;
    floorMax: number;
    entrances: number[];
    blocks: Array<{
      id: string;
      name: string;
      count: number;
      deadline: string;
      rawPlacementDeadline: string;
    }>;
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
};

type LeadRequest = { unit: Unit | null; context: string };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const modes: Mode[] = ['cards', 'chess'];
const languageStorageKey = 'botanika-saroyi-language';
const emptyFilters: Filters = {
  rooms: '', areaFrom: '', areaTo: '', priceFrom: '', priceTo: '', floor: '', building: '', entrance: '', completion: '',
};

const copy = {
  ru: {
    skip: 'К результатам каталога', back: 'О проекте', wordmark: 'BOTANIKA SAROYI', index: 'Индекс резиденций', language: 'Язык', phone: 'Отдел продаж',
    eyebrow: 'Каталог · официальный snapshot 30.08.2026', title: 'Индекс', accent: 'резиденций.', lead: '224 планировки и официальных предложения в датированном snapshot — без подмены внутренних статусов словом «свободно».',
    snapshot: 'Snapshot', proposals: 'предложения', saleRows: 'строки isSale=true', plans: 'локальные планировки', range: 'Диапазон квартир', rangeValue: '36,95–82,25 м² · 1–3 комнаты', plate: 'ЛИСТ', specimen: 'ЭКЗЕМПЛЯР', specimenIndex: 'ИНДЕКС ЭКЗЕМПЛЯРОВ',
    modes: { cards: 'Карточки', chess: 'Шахматка' }, modeLabel: 'Режим каталога',
    filters: 'Фильтры', rooms: 'Комнаты', allRooms: 'Все', areaFrom: 'Площадь от, м²', areaTo: 'Площадь до, м²', priceFrom: 'Цена от, млн UZS', priceTo: 'Цена до, млн UZS', floor: 'Этаж', allFloors: 'Все этажи', building: 'Блок / корпус', allBuildings: 'Все блоки', entrance: 'Подъезд', allEntrances: 'Все подъезды', completion: 'Срок', allCompletions: 'Все сроки', reset: 'Сбросить',
    sort: 'Сортировка', sorts: { priceAsc: 'Цена ↑', priceDesc: 'Цена ↓', areaAsc: 'Площадь ↑', areaDesc: 'Площадь ↓', floorAsc: 'Этаж ↑', floorDesc: 'Этаж ↓' }, results: 'найдено',
    sourceTitle: 'Происхождение snapshot', sourceNote: 'Все 224 строки квартир сохранены из официального live-каталога 30 августа 2026 года. 223 имеют isSale=true; одна строка бронирования включена официальным интерфейсом в итог 224. Цены, акции и статусы относятся к моменту snapshot.',
    apartment: 'Квартира', roomsShort: 'комн.', area: 'Площадь', areaUnit: 'м²', currentPrice: 'Текущая цена по акции', originalPrice: 'Исходная цена', sourcePerM2: 'Цена за м² в источнике', discount: 'Сумма акции', promotion: 'Акция', status: 'Исходный статус', statusNote: 'Workflow-статус в официальном snapshot', floorOf: 'Этаж', entranceShort: 'Подъезд', block: 'Блок', completionShort: 'Сдача', completionSource: 'Срок нормализован по realEstateList', placementDate: 'Исходный placementList', class: 'Класс', business: 'Бизнес', balcony: 'Балкон', ceiling: 'Потолки', studio: 'Студия', finishing: 'Отделка включена', yes: 'Да', no: 'Нет',
    plan: 'Открыть официальную планировку', planAlt: 'Официальная планировка квартиры', choose: 'Уточнить условия', details: 'Открыть детали', showMore: 'Показать ещё', shown: 'Показано', of: 'из',
    noResults: 'По этим параметрам предложений нет.', resetFilters: 'Сбросить фильтры', matrix: 'Блок × подъезд × этаж × квартира', matrixHint: 'Прокручивайте матрицу пальцем или трекпадом, кнопками 44 px либо клавишами ← → Home End.', scrollLeft: 'Прокрутить матрицу влево', scrollRight: 'Прокрутить матрицу вправо', floorColumn: 'Этаж', unitsColumn: 'Квартиры', emptyFloor: 'Нет предложений по фильтру', selected: 'Выбранная квартира', close: 'Закрыть детали', closePlan: 'Закрыть планировку', selectHint: 'Выберите квартиру в матрице, чтобы открыть её паспорт.',
    generalConsult: 'Получить консультацию', disclaimer: 'Snapshot не является публичной офертой. Наличие и актуальные условия подтверждает отдел продаж.', privacy: 'Политика конфиденциальности', home: 'Главная Botanika', up: 'Наверх',
    statuses: { 'Свободно': 'Свободно', 'Бронирование': 'Бронирование', 'Расторжение': 'Расторжение', 'Снятие брони': 'Снятие брони', 'Снятие резерва': 'Снятие резерва' },
  },
  uz: {
    skip: 'Katalog natijalariga o‘tish', back: 'Loyiha haqida', wordmark: 'BOTANIKA SAROYI', index: 'Rezidensiyalar indeksi', language: 'Til', phone: 'Savdo bo‘limi',
    eyebrow: 'Katalog · 30.08.2026 rasmiy snapshot', title: 'Rezidensiyalar', accent: 'indeksi.', lead: 'Sanasi ko‘rsatilgan snapshotdagi 224 ta reja va rasmiy taklif — ichki holatlarni «bo‘sh» deb almashtirmasdan.',
    snapshot: 'Snapshot', proposals: 'taklif', saleRows: 'isSale=true qatorlari', plans: 'mahalliy rejalar', range: 'Xonadonlar oralig‘i', rangeValue: '36,95–82,25 m² · 1–3 xona', plate: 'VARAQ', specimen: 'NAMUNA', specimenIndex: 'NAMUNALAR INDEKSI',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka' }, modeLabel: 'Katalog ko‘rinishi',
    filters: 'Filtrlar', rooms: 'Xonalar', allRooms: 'Barchasi', areaFrom: 'Maydon, m² dan', areaTo: 'Maydon, m² gacha', priceFrom: 'Narx, mln UZS dan', priceTo: 'Narx, mln UZS gacha', floor: 'Qavat', allFloors: 'Barcha qavatlar', building: 'Blok / korpus', allBuildings: 'Barcha bloklar', entrance: 'Kirish', allEntrances: 'Barcha kirishlar', completion: 'Topshirish muddati', allCompletions: 'Barcha muddatlar', reset: 'Tozalash',
    sort: 'Saralash', sorts: { priceAsc: 'Narx ↑', priceDesc: 'Narx ↓', areaAsc: 'Maydon ↑', areaDesc: 'Maydon ↓', floorAsc: 'Qavat ↑', floorDesc: 'Qavat ↓' }, results: 'topildi',
    sourceTitle: 'Snapshot kelib chiqishi', sourceNote: '224 ta xonadon qatorining barchasi 2026-yil 30-avgustdagi rasmiy live katalogdan saqlangan. 223 tasida isSale=true; bron qilingan bitta qator rasmiy interfeysdagi 224 ta yakuniy natijaga kiritilgan. Narx, aksiya va holatlar snapshot vaqtiga tegishli.',
    apartment: 'Xonadon', roomsShort: 'xonali', area: 'Maydon', areaUnit: 'm²', currentPrice: 'Aksiya bo‘yicha joriy narx', originalPrice: 'Boshlang‘ich narx', sourcePerM2: 'Manbadagi m² narxi', discount: 'Aksiya summasi', promotion: 'Aksiya', status: 'Asl holat', statusNote: 'Rasmiy snapshotdagi workflow holati', floorOf: 'Qavat', entranceShort: 'Kirish', block: 'Blok', completionShort: 'Topshirish', completionSource: 'Muddat realEstateList bo‘yicha normallashtirilgan', placementDate: 'Asl placementList', class: 'Toifa', business: 'Biznes', balcony: 'Balkon', ceiling: 'Shift', studio: 'Studiya', finishing: 'Pardoz kiritilgan', yes: 'Ha', no: 'Yo‘q',
    plan: 'Rasmiy rejani ochish', planAlt: 'Xonadonning rasmiy rejasi', choose: 'Shartlarni aniqlash', details: 'Tafsilotlarni ochish', showMore: 'Yana ko‘rsatish', shown: 'Ko‘rsatildi', of: 'dan',
    noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', resetFilters: 'Filtrlarni tozalash', matrix: 'Blok × kirish × qavat × xonadon', matrixHint: 'Matritsani barmoq yoki trekpad, 44 px tugmalar yoxud ← → Home End klavishlari bilan suring.', scrollLeft: 'Matritsani chapga surish', scrollRight: 'Matritsani o‘ngga surish', floorColumn: 'Qavat', unitsColumn: 'Xonadonlar', emptyFloor: 'Filtr bo‘yicha taklif yo‘q', selected: 'Tanlangan xonadon', close: 'Tafsilotlarni yopish', closePlan: 'Rejani yopish', selectHint: 'Pasportini ochish uchun matritsadan xonadon tanlang.',
    generalConsult: 'Maslahat olish', disclaimer: 'Snapshot ommaviy oferta emas. Mavjudlik va amaldagi shartlarni savdo bo‘limi tasdiqlaydi.', privacy: 'Maxfiylik siyosati', home: 'Botanika bosh sahifasi', up: 'Yuqoriga',
    statuses: { 'Свободно': 'Bo‘sh', 'Бронирование': 'Bron qilish', 'Расторжение': 'Shartnomani bekor qilish', 'Снятие брони': 'Bronni olib tashlash', 'Снятие резерва': 'Rezervni olib tashlash' },
  },
  en: {
    skip: 'Skip to catalogue results', back: 'About the project', wordmark: 'BOTANIKA SAROYI', index: 'Residence index', language: 'Language', phone: 'Sales office',
    eyebrow: 'Catalogue · official snapshot 30 Aug 2026', title: 'Residence', accent: 'index.', lead: '224 floor plans and official listings in a dated snapshot, without relabelling every internal workflow state as “available”.',
    snapshot: 'Snapshot', proposals: 'listings', saleRows: 'rows with isSale=true', plans: 'local floor plans', range: 'Apartment range', rangeValue: '36.95–82.25 m² · 1–3 rooms', plate: 'PLATE', specimen: 'SPECIMEN', specimenIndex: 'SPECIMEN INDEX',
    modes: { cards: 'Cards', chess: 'Matrix' }, modeLabel: 'Catalogue view',
    filters: 'Filters', rooms: 'Rooms', allRooms: 'Any', areaFrom: 'Area from, m²', areaTo: 'Area to, m²', priceFrom: 'Price from, million UZS', priceTo: 'Price to, million UZS', floor: 'Floor', allFloors: 'Any floor', building: 'Block / building', allBuildings: 'All blocks', entrance: 'Entrance', allEntrances: 'All entrances', completion: 'Completion', allCompletions: 'All dates', reset: 'Reset',
    sort: 'Sort', sorts: { priceAsc: 'Price ↑', priceDesc: 'Price ↓', areaAsc: 'Area ↑', areaDesc: 'Area ↓', floorAsc: 'Floor ↑', floorDesc: 'Floor ↓' }, results: 'found',
    sourceTitle: 'Snapshot provenance', sourceNote: 'All 224 apartment rows were saved from the official live catalogue on 30 August 2026. 223 have isSale=true; one booking row is included in the official interface total of 224. Prices, promotions and statuses are fixed at snapshot time.',
    apartment: 'Apartment', roomsShort: 'room', area: 'Area', areaUnit: 'm²', currentPrice: 'Current campaign price', originalPrice: 'Original price', sourcePerM2: 'Source price per m²', discount: 'Campaign reduction', promotion: 'Campaign', status: 'Source status', statusNote: 'Workflow status in the official snapshot', floorOf: 'Floor', entranceShort: 'Entrance', block: 'Block', completionShort: 'Completion', completionSource: 'Date normalized from realEstateList', placementDate: 'Raw placementList', class: 'Class', business: 'Business', balcony: 'Balcony', ceiling: 'Ceiling', studio: 'Studio', finishing: 'Finishing included', yes: 'Yes', no: 'No',
    plan: 'Open official floor plan', planAlt: 'Official apartment floor plan', choose: 'Check terms', details: 'Open details', showMore: 'Show more', shown: 'Shown', of: 'of',
    noResults: 'No listings match these filters.', resetFilters: 'Reset filters', matrix: 'Block × entrance × floor × apartment', matrixHint: 'Swipe or use a trackpad, the 44 px controls, or the ← → Home End keys to move through the matrix.', scrollLeft: 'Scroll matrix left', scrollRight: 'Scroll matrix right', floorColumn: 'Floor', unitsColumn: 'Apartments', emptyFloor: 'No filtered listings', selected: 'Selected apartment', close: 'Close details', closePlan: 'Close floor plan', selectHint: 'Select an apartment in the matrix to open its specimen passport.',
    generalConsult: 'Request a consultation', disclaimer: 'This snapshot is not a public offer. The sales team confirms availability and current terms.', privacy: 'Privacy policy', home: 'Botanika home', up: 'Back to top',
    statuses: { 'Свободно': 'Available', 'Бронирование': 'Booking', 'Расторжение': 'Termination', 'Снятие брони': 'Booking release', 'Снятие резерва': 'Reservation release' },
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function isLanguage(value: string | null): value is Language { return value === 'ru' || value === 'uz' || value === 'en'; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${withLanguage('/privacy', language)}&project=botanika-saroyi`; }
function locale(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US'; }
function number(value: number, language: Language, digits = 0) { return new Intl.NumberFormat(locale(language), { maximumFractionDigits: digits }).format(value); }
function money(value: number, language: Language) { return `${number(value, language)} UZS`; }
function shortMoney(value: number, language: Language) {
  const suffix = language === 'ru' ? 'млн' : language === 'uz' ? 'mln' : 'm';
  return `${number(value / 1e6, language, 1)} ${suffix}`;
}
function area(value: number, language: Language) { return number(value, language, 2); }
function areaWithUnit(value: number, language: Language) { return `${area(value, language)} ${copy[language].areaUnit}`; }
function roomPhrase(value: number, language: Language) {
  const label = language === 'en' && value !== 1 ? 'rooms' : copy[language].roomsShort;
  return `${value} ${label}`;
}
function compareUnits(a: Unit, b: Unit, sort: Sort) {
  const numberTie = Number(a.number) - Number(b.number) || a.number.localeCompare(b.number, undefined, { numeric: true });
  if (sort === 'priceAsc') return a.price - b.price || numberTie;
  if (sort === 'priceDesc') return b.price - a.price || numberTie;
  if (sort === 'areaAsc') return a.area - b.area || numberTie;
  if (sort === 'areaDesc') return b.area - a.area || numberTie;
  if (sort === 'floorAsc') return a.floor - b.floor || numberTie;
  return b.floor - a.floor || numberTie;
}
function dateLabel(value: string, language: Language) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date);
}
function capturedLabel(value: string, language: Language) {
  return new Intl.DateTimeFormat(locale(language), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(value));
}
function blockLabel(value: string, language: Language) {
  const suffix = value.match(/2\s*-\s*([12])$/)?.[1];
  if (!suffix) return value;
  return language === 'ru' ? `Блок 2-${suffix}` : language === 'uz' ? `2-${suffix} blok` : `Block 2-${suffix}`;
}
function ceilingLabel(value: string, language: Language) {
  const height = value.match(/\d+(?:[.,]\d+)?/)?.[0]?.replace(',', '.') ?? '3';
  const localized = number(Number(height), language, 1);
  return language === 'ru' ? `Не менее ${localized} м` : language === 'uz' ? `Kamida ${localized} m` : `At least ${localized} m`;
}
function statusLabel(unit: Unit, language: Language) {
  const statuses = copy[language].statuses as Record<string, string>;
  return statuses[unit.statusOriginal] ?? unit.statusOriginal;
}

const mobileDrawerQuery = '(max-width: 900px)';
function subscribeMobileDrawer(callback: () => void) {
  const media = window.matchMedia(mobileDrawerQuery);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}
function getMobileDrawerSnapshot() {
  return typeof window !== 'undefined' && window.matchMedia(mobileDrawerQuery).matches;
}
function getMobileDrawerServerSnapshot() { return false; }

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
  }, 'botanika-saroyi');
}

function unitContext(unit: Unit, surface: string, language: Language) {
  return [
    'botanika-saroyi', 'catalog', surface, `lang=${language}`, `unitUuid=${unit.id}`, `number=${unit.number}`,
    `buildingId=${unit.buildingId}`, `building=${unit.building}`, `rooms=${unit.rooms}`,
    `area=${unit.area}`, `floor=${unit.floor}/${unit.totalFloors}`, `entrance=${unit.entrance}`,
    `completion=${unit.completionDate}`, `statusOriginal=${unit.statusOriginal}`, `isSale=${unit.isSale}`,
    `currentPrice=${unit.price}`, `originalPrice=${unit.oldPrice}`, `promotionPercent=${unit.promotion?.percent ?? 0}`,
  ].join(':');
}

function useLanguage(initialLanguage: Language) {
  const router = useRouter();
  const pathname = usePathname();
  const language = initialLanguage;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('lang')) {
      const stored = window.localStorage.getItem(languageStorageKey);
      const fallback = isLanguage(stored) ? stored : language;
      params.set('lang', fallback);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
      if (fallback !== language) return;
    }
    document.documentElement.lang = language;
    window.localStorage.setItem(languageStorageKey, language);
  }, [language, pathname, router]);

  const setLanguage = (next: Language) => {
    window.localStorage.setItem(languageStorageKey, next);
    const params = new URLSearchParams(window.location.search);
    params.set('lang', next);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };

  return [language, setLanguage] as const;
}

function PlanButton({ unit, language, onOpen, compact = false }: { unit: Unit; language: Language; onOpen: () => void; compact?: boolean }) {
  const t = copy[language];
  return (
    <button className={`botanika-catalog-plan${compact ? ' is-compact' : ''}`} type="button" onClick={onOpen} aria-label={`${t.plan}: № ${unit.number}`}>
      <img src={asset(unit.plan)} alt={`${t.planAlt} № ${unit.number}`} loading="lazy" decoding="async" />
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function PlanLightbox({ unit, language, onClose }: { unit: Unit; language: Language; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => previous?.isConnected && previous.focus({ preventScroll: true }));
    };
  }, [onClose]);

  return (
    <div ref={panelRef} className="botanika-plan-lightbox" role="dialog" aria-modal="true" aria-label={`${t.plan}: № ${unit.number}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t.closePlan}>×</button>
      <figure>
        <img src={asset(unit.plan)} alt={`${t.planAlt} № ${unit.number}`} />
        <figcaption><strong>№ {unit.number} · {roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</strong><span>{blockLabel(unit.building, language)} · {unit.floor}/{unit.totalFloors}</span></figcaption>
      </figure>
    </div>
  );
}

function StatusTag({ unit, language }: { unit: Unit; language: Language }) {
  const t = copy[language];
  return <span className="botanika-status" data-status={unit.statusOriginal} title={`${t.statusNote}: ${unit.statusOriginal}`}><i aria-hidden="true" />{statusLabel(unit, language)}</span>;
}

function UnitCard({ unit, language, onPlan, onLead }: { unit: Unit; language: Language; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  return (
    <article className="botanika-unit-card" data-unit-id={unit.id}>
      <header><small>{t.specimen} · {String(unit.provenance.catalogIndex).padStart(3, '0')}</small><StatusTag unit={unit} language={language} /></header>
      <PlanButton unit={unit} language={language} onOpen={onPlan} />
      <div className="botanika-unit-card__body">
        <div className="botanika-unit-card__name"><small>{blockLabel(unit.building, language)} · {t.apartment} № {unit.number}</small><h2>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h2></div>
        <dl>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
        </dl>
        <div className="botanika-unit-card__price">
          <small>{t.currentPrice}</small><strong>{money(unit.price, language)}</strong>
          <span>{money(unit.sourcePricePerM2, language)} · {t.sourcePerM2.toLowerCase()}</span>
          <del>{t.originalPrice}: {money(unit.oldPrice, language)}</del>
          {unit.promotion ? <b>{t.promotion} −{unit.promotion.percent}% · {money(unit.promotion.discountSum, language)}</b> : null}
        </div>
        <button type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
      </div>
    </article>
  );
}

function UnitDetail({ unit, language, onClose, onPlan, onLead }: { unit: Unit; language: Language; onClose: () => void; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const mobileDrawer = useSyncExternalStore(subscribeMobileDrawer, getMobileDrawerSnapshot, getMobileDrawerServerSnapshot);

  useEffect(() => {
    if (mobileDrawer) document.body.classList.add('botanika-catalog-detail-locked');
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.botanika-plan-lightbox, .lead-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (!mobileDrawer || event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.classList.remove('botanika-catalog-detail-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileDrawer, onClose, unit.id]);

  return (
    <>
      <div className="botanika-unit-detail-backdrop" aria-hidden="true" onClick={onClose} />
      <aside ref={panelRef} className="botanika-unit-detail" role="dialog" aria-modal={mobileDrawer || undefined} aria-labelledby={`botanika-detail-${unit.id}`}>
        <header>
          <div><small>{t.selected} · {t.specimen} {String(unit.provenance.catalogIndex).padStart(3, '0')}</small><strong id={`botanika-detail-${unit.id}`}>№ {unit.number}</strong></div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button>
        </header>
        <PlanButton unit={unit} language={language} compact onOpen={onPlan} />
        <div className="botanika-unit-detail__status"><StatusTag unit={unit} language={language} /><small>{t.statusNote}</small></div>
        <h3>{roomPhrase(unit.rooms, language)} · {areaWithUnit(unit.area, language)}</h3>
        <dl>
          <div><dt>{t.floorOf}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
          <div><dt>{t.entranceShort}</dt><dd>{unit.entrance}</dd></div>
          <div><dt>{t.block}</dt><dd>{blockLabel(unit.building, language)}</dd></div>
          <div><dt>{t.completionShort}</dt><dd>{dateLabel(unit.completionDate, language)}</dd></div>
          <div className="is-provenance"><dt>{t.completionSource}</dt><dd>{unit.completionDate}</dd></div>
          <div className="is-provenance"><dt>{t.placementDate}</dt><dd>{unit.sourcePlacementCompletionDate}</dd></div>
          <div><dt>{t.class}</dt><dd>{t.business}</dd></div>
          <div><dt>{t.ceiling}</dt><dd>{ceilingLabel(unit.ceilingHeight, language)}</dd></div>
          {unit.balconyArea !== null ? <div><dt>{t.balcony}</dt><dd>{areaWithUnit(unit.balconyArea, language)}</dd></div> : null}
          {unit.studio ? <div><dt>{t.studio}</dt><dd>{t.yes}</dd></div> : null}
          {unit.repairIncluded ? <div><dt>{t.finishing}</dt><dd>{t.yes}</dd></div> : null}
        </dl>
        <div className="botanika-unit-detail__price">
          <small>{t.currentPrice}</small><strong>{money(unit.price, language)}</strong>
          <span>{t.sourcePerM2}: {money(unit.sourcePricePerM2, language)}</span>
          <del>{t.originalPrice}: {money(unit.oldPrice, language)}</del>
          {unit.promotion ? <b>{t.promotion} −{unit.promotion.percent}%<span>{t.discount}: {money(unit.promotion.discountSum, language)}</span></b> : null}
        </div>
        <button className="botanika-unit-detail__cta" type="button" data-lead-trigger onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
      </aside>
    </>
  );
}

function MatrixGroup({ units, language, sort, selectedId, onSelect }: { units: Unit[]; language: Language; sort: Sort; selectedId?: string; onSelect: (unit: Unit, opener: HTMLButtonElement) => void }) {
  const t = copy[language];
  const viewportRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const building = units[0].building;
  const entrance = units[0].entrance;
  const floors = Array.from({ length: 16 }, (_, index) => sort === 'floorAsc' ? index + 1 : 16 - index);

  const updateEdges = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    setEdges({ start: element.scrollLeft <= 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateEdges);
    window.addEventListener('resize', updateEdges);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', updateEdges); };
  }, [updateEdges, units]);

  const move = (direction: number) => viewportRef.current?.scrollBy({ left: direction * Math.max(280, viewportRef.current.clientWidth * .72), behavior: 'smooth' });
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'Home') { event.preventDefault(); viewportRef.current?.scrollTo({ left: 0, behavior: 'smooth' }); }
    if (event.key === 'End') { event.preventDefault(); viewportRef.current?.scrollTo({ left: viewportRef.current.scrollWidth, behavior: 'smooth' }); }
  };

  return (
    <section className="botanika-matrix-group">
      <header>
        <div><small>{blockLabel(building, language)}</small><h3>{t.entranceShort} {entrance}</h3></div>
        <div className="botanika-matrix-group__controls">
          <button type="button" disabled={edges.start} onClick={() => move(-1)} aria-label={`${t.scrollLeft}: ${blockLabel(building, language)}, ${t.entranceShort} ${entrance}`}>←</button>
          <button type="button" disabled={edges.end} onClick={() => move(1)} aria-label={`${t.scrollRight}: ${blockLabel(building, language)}, ${t.entranceShort} ${entrance}`}>→</button>
        </div>
      </header>
      <div ref={viewportRef} className="botanika-matrix-viewport" tabIndex={0} onKeyDown={onKeyDown} onScroll={updateEdges} aria-label={`${t.matrix}: ${blockLabel(building, language)}, ${t.entranceShort} ${entrance}`} aria-describedby="botanika-matrix-help">
        <table>
          <thead><tr><th scope="col">{t.floorColumn}</th><th scope="col">{t.unitsColumn}</th></tr></thead>
          <tbody>{floors.map((floor) => {
            const floorUnits = units.filter((unit) => unit.floor === floor).sort((a, b) => compareUnits(a, b, sort));
            return (
              <tr key={floor}>
                <th scope="row"><strong>{floor}</strong><span>{t.floorOf}</span></th>
                <td>{floorUnits.length ? <div>{floorUnits.map((unit) => (
                  <button type="button" key={unit.id} className={selectedId === unit.id ? 'is-selected' : undefined} onClick={(event) => onSelect(unit, event.currentTarget)} aria-label={`${t.apartment} № ${unit.number}, ${roomPhrase(unit.rooms, language)}, ${areaWithUnit(unit.area, language)}, ${t.floorOf} ${unit.floor}, ${statusLabel(unit, language)}`}>
                    <small><span>№ {unit.number}</span><i data-status={unit.statusOriginal} aria-hidden="true" /></small>
                    <strong>{areaWithUnit(unit.area, language)}</strong>
                    <span>{roomPhrase(unit.rooms, language)} · {shortMoney(unit.price, language)}</span>
                    <em>{dateLabel(unit.completionDate, language)}</em>
                  </button>
                ))}</div> : <span className="botanika-matrix-empty">— <span className="botanika-visually-hidden">{t.emptyFloor}</span></span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}

export function BotanikaCatalog({ snapshot, initialLanguage }: { snapshot: BotanikaSnapshot; initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [mode, setMode] = useState<Mode>('cards');
  const [sort, setSort] = useState<Sort>('priceAsc');
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [visible, setVisible] = useState(12);
  const [selected, setSelected] = useState<Unit | null>(null);
  const [planUnit, setPlanUnit] = useState<Unit | null>(null);
  const [leadRequest, setLeadRequest] = useState<LeadRequest | null>(null);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectionOpener = useRef<HTMLButtonElement | null>(null);
  const t = copy[language];

  const blocks = snapshot.filterSummary.blocks;
  const completions = useMemo(() => Array.from(new Set(snapshot.units.map((unit) => unit.completionDate))).sort(), [snapshot.units]);

  const filtered = useMemo(() => {
    const priceFrom = filters.priceFrom ? Number(filters.priceFrom) * 1e6 : -Infinity;
    const priceTo = filters.priceTo ? Number(filters.priceTo) * 1e6 : Infinity;
    const areaFrom = filters.areaFrom ? Number(filters.areaFrom) : -Infinity;
    const areaTo = filters.areaTo ? Number(filters.areaTo) : Infinity;
    const result = snapshot.units.filter((unit) => (
      (!filters.rooms || unit.rooms === Number(filters.rooms))
      && unit.area >= areaFrom && unit.area <= areaTo
      && unit.price >= priceFrom && unit.price <= priceTo
      && (!filters.floor || unit.floor === Number(filters.floor))
      && (!filters.building || unit.buildingId === filters.building)
      && (!filters.entrance || unit.entrance === Number(filters.entrance))
      && (!filters.completion || unit.completionDate === filters.completion)
    ));
    return result.sort((a, b) => compareUnits(a, b, sort));
  }, [filters, snapshot.units, sort]);

  const matrixGroups = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    filtered.forEach((unit) => {
      const key = `${unit.buildingId}|${unit.entrance}`;
      groups.set(key, [...(groups.get(key) ?? []), unit]);
    });
    return Array.from(groups.values()).sort((a, b) => a[0].completionDate.localeCompare(b[0].completionDate) || a[0].entrance - b[0].entrance);
  }, [filtered]);

  const activeSelected = selected && filtered.some((unit) => unit.id === selected.id) ? selected : null;
  const updateFilter = (name: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setVisible(12);
    setSelected(null);
  };
  const resetFilters = () => {
    setFilters({ ...emptyFilters });
    setVisible(12);
    setSelected(null);
  };
  const openPlan = (unit: Unit) => { rememberUnit(unit); setPlanUnit(unit); };
  const openLead = (unit: Unit | null, surface: string) => {
    if (unit) rememberUnit(unit);
    setLeadRequest({ unit, context: unit ? unitContext(unit, surface, language) : `botanika-saroyi:catalog:${surface}:general:lang=${language}` });
  };
  const closeDetail = useCallback(() => {
    setSelected(null);
    window.requestAnimationFrame(() => {
      if (!selectionOpener.current?.isConnected) return;
      selectionOpener.current.focus({ preventScroll: true });
    });
  }, []);
  const selectUnit = (unit: Unit, opener: HTMLButtonElement) => {
    rememberUnit(unit);
    selectionOpener.current = opener;
    setSelected(unit);
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
    <main className="botanika-catalog-site" lang={language}>
      <a className="botanika-catalog-skip" href="#botanika-results">{t.skip}</a>
      <header className="botanika-catalog-header">
        <a className="botanika-catalog-back" href={withLanguage('/botanika-saroyi', language)}><span aria-hidden="true">←</span>{t.back}</a>
        <a className="botanika-catalog-wordmark" href={withLanguage('/botanika-saroyi', language)} aria-label={t.home}>{t.wordmark}<small>{t.index}</small></a>
        <a className="botanika-catalog-phone" href="tel:+998781137712"><small>{t.phone}</small><span>+998 78 113 77 12</span></a>
        <div className="botanika-catalog-languages" role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : undefined} aria-pressed={language === item} lang={item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
      </header>

      <section className="botanika-catalog-hero" aria-labelledby="botanika-catalog-title">
        <div>
          <span>{t.eyebrow}</span>
          <h1 id="botanika-catalog-title">{t.title}<em>{t.accent}</em></h1>
          <p>{t.lead}</p>
          <button type="button" data-lead-trigger onClick={() => openLead(null, 'hero-consultation')}>{t.generalConsult}<span aria-hidden="true">↗</span></button>
        </div>
        <aside aria-label={t.snapshot}>
          <small>{t.plate} · 00</small>
          <strong>{snapshot.officialTotalAtCapture}</strong><span>{t.proposals}</span>
          <dl>
            <div><dt>{t.snapshot}</dt><dd>{capturedLabel(snapshot.capturedAt, language)}</dd></div>
            <div><dt>{t.saleRows}</dt><dd>{snapshot.integrity.isSaleTrue}/{snapshot.officialTotalAtCapture}</dd></div>
            <div><dt>{t.plans}</dt><dd>{snapshot.integrity.reachableFloorplans}/{snapshot.integrity.uniqueFloorplanUrls}</dd></div>
            <div><dt>{t.range}</dt><dd>{t.rangeValue}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="botanika-catalog-controls" aria-labelledby="botanika-filters-title">
        <div className="botanika-catalog-modes" role="tablist" aria-label={t.modeLabel}>{modes.map((item, index) => (
          <button ref={(element) => { modeRefs.current[index] = element; }} type="button" role="tab" id={`botanika-tab-${item}`} aria-selected={mode === item} aria-controls="botanika-panel" tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : undefined} onClick={() => changeMode(item)} onKeyDown={(event) => onModeKeyDown(event, index)} key={item}><small>0{index + 1}</small>{t.modes[item]}</button>
        ))}</div>
        <div className="botanika-catalog-filter-heading"><div><small>{t.specimenIndex}</small><h2 id="botanika-filters-title">{t.filters}</h2></div><button type="button" onClick={resetFilters}>{t.reset}<span aria-hidden="true">↺</span></button></div>
        <div className="botanika-catalog-filters">
          <label><span>{t.rooms}</span><select value={filters.rooms} onChange={(event) => updateFilter('rooms', event.target.value)}><option value="">{t.allRooms}</option>{snapshot.filterSummary.rooms.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label><span>{t.areaFrom}</span><input type="number" min={snapshot.filterSummary.areaMin} max={snapshot.filterSummary.areaMax} step="0.01" inputMode="decimal" placeholder={area(snapshot.filterSummary.areaMin, language)} value={filters.areaFrom} onChange={(event) => updateFilter('areaFrom', event.target.value)} /></label>
          <label><span>{t.areaTo}</span><input type="number" min={snapshot.filterSummary.areaMin} max={snapshot.filterSummary.areaMax} step="0.01" inputMode="decimal" placeholder={area(snapshot.filterSummary.areaMax, language)} value={filters.areaTo} onChange={(event) => updateFilter('areaTo', event.target.value)} /></label>
          <label><span>{t.priceFrom}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={number(Math.floor(snapshot.filterSummary.currentPriceMin / 1e6), language)} value={filters.priceFrom} onChange={(event) => updateFilter('priceFrom', event.target.value)} /></label>
          <label><span>{t.priceTo}</span><input type="number" min="0" step="1" inputMode="numeric" placeholder={number(Math.ceil(snapshot.filterSummary.currentPriceMax / 1e6), language)} value={filters.priceTo} onChange={(event) => updateFilter('priceTo', event.target.value)} /></label>
          <label><span>{t.floor}</span><select value={filters.floor} onChange={(event) => updateFilter('floor', event.target.value)}><option value="">{t.allFloors}</option>{Array.from({ length: 16 }, (_, index) => index + 1).map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label className="is-wide"><span>{t.building}</span><select value={filters.building} onChange={(event) => updateFilter('building', event.target.value)}><option value="">{t.allBuildings}</option>{blocks.map((value) => <option value={value.id} key={value.id}>{blockLabel(value.name, language)} · {value.count}</option>)}</select></label>
          <label><span>{t.entrance}</span><select value={filters.entrance} onChange={(event) => updateFilter('entrance', event.target.value)}><option value="">{t.allEntrances}</option>{snapshot.filterSummary.entrances.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label className="is-wide"><span>{t.completion}</span><select value={filters.completion} onChange={(event) => updateFilter('completion', event.target.value)}><option value="">{t.allCompletions}</option>{completions.map((value) => <option value={value} key={value}>{dateLabel(value, language)}</option>)}</select></label>
        </div>
      </section>

      <section id="botanika-results" className="botanika-catalog-results" aria-labelledby="botanika-results-title">
        <header>
          <div><small>{t.plate} · {mode === 'cards' ? '01' : '02'}</small><h2 id="botanika-results-title"><strong>{filtered.length}</strong> {t.results}</h2></div>
          <label><span>{t.sort}</span><select value={sort} onChange={(event) => { setSort(event.target.value as Sort); setVisible(12); }}>{(Object.entries(t.sorts) as Array<[Sort, string]>).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        </header>
        <aside className="botanika-catalog-source"><span aria-hidden="true">i</span><div><strong>{t.sourceTitle}</strong><p>{t.sourceNote}</p></div></aside>

        {filtered.length === 0 ? (
          <div className="botanika-catalog-empty" role="status"><span aria-hidden="true">∅</span><h2>{t.noResults}</h2><button type="button" onClick={resetFilters}>{t.resetFilters}</button></div>
        ) : mode === 'cards' ? (
          <div id="botanika-panel" role="tabpanel" aria-labelledby="botanika-tab-cards">
            <div className="botanika-unit-grid">{filtered.slice(0, visible).map((unit) => <UnitCard unit={unit} language={language} onPlan={() => openPlan(unit)} onLead={() => openLead(unit, 'card-cta')} key={unit.id} />)}</div>
            {visible < filtered.length ? <button className="botanika-catalog-show-more" type="button" onClick={() => setVisible((value) => value + 12)}><span>{t.showMore}</span><strong>{t.shown} {Math.min(visible, filtered.length)} {t.of} {filtered.length}</strong><i aria-hidden="true">↓</i></button> : null}
          </div>
        ) : (
          <div id="botanika-panel" className="botanika-matrix" role="tabpanel" aria-labelledby={`botanika-tab-${mode}`}>
            <header><div><small>{t.modes[mode]}</small><h2>{t.matrix}</h2><p id="botanika-matrix-help">{t.matrixHint}</p></div></header>
            <div className="botanika-matrix-layout has-detail">
              <div className="botanika-matrix-groups">{matrixGroups.map((units) => <MatrixGroup key={`${units[0].buildingId}-${units[0].entrance}`} units={units} language={language} sort={sort} selectedId={activeSelected?.id} onSelect={selectUnit} />)}</div>
              {activeSelected ? <UnitDetail key={activeSelected.id} unit={activeSelected} language={language} onClose={closeDetail} onPlan={() => openPlan(activeSelected)} onLead={() => openLead(activeSelected, 'matrix-detail')} /> : <aside className="botanika-unit-detail botanika-unit-detail--empty"><span aria-hidden="true">↖</span><p>{t.selectHint}</p></aside>}
            </div>
          </div>
        )}
      </section>

      <footer className="botanika-catalog-footer"><a href={withLanguage('/botanika-saroyi', language)}>{t.wordmark}<small>{t.home}</small></a><p>{t.disclaimer}</p><a href={privacyUrl(language)}>{t.privacy}</a><a href="#botanika-catalog-title" aria-label={t.up}>↑</a></footer>

      {planUnit ? <PlanLightbox unit={planUnit} language={language} onClose={() => setPlanUnit(null)} /> : null}
      {leadRequest ? <div className="botanika-catalog-lead-host" data-project-slug="botanika-saroyi" data-context={leadRequest.context}><LeadModal open language={language} context={leadRequest.context} brandName="NRG-BI" projectName="BOTANIKA SAROYI" tagline={leadRequest.unit ? `${roomPhrase(leadRequest.unit.rooms, language)} · ${areaWithUnit(leadRequest.unit.area, language)} · № ${leadRequest.unit.number}` : t.lead} facts={leadRequest.unit ? [blockLabel(leadRequest.unit.building, language), `${leadRequest.unit.floor}/${leadRequest.unit.totalFloors} · ${t.floorOf}`, money(leadRequest.unit.price, language)] : [`${snapshot.officialTotalAtCapture} · ${t.proposals}`, t.rangeValue, t.business]} submitUrl={botanikaLeadSubmitUrl()} projectSlug="botanika-saroyi" unitId={leadRequest.unit?.id} privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadRequest(null)} /></div> : null}
    </main>
  );
}

export default BotanikaCatalog;
