'use client';

/* eslint-disable @next/next/no-img-element */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { LeadModal, rememberLiveCatalogUnit } from '@/app/lead-modal';
import { catalogLeadIdentity, useLiveCatalogSnapshot } from '@/app/live-catalog';
import { maftunScrollBehavior, useMaftunSmoothScroll } from '../maftun-interactions';
import { maftunLeadSubmitUrl } from '../maftun-lead';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess';
type Sort = 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc';
type Promotion = { percent: number; name: string; deadlineUtc: string; discountSum: number } | null;
type Unit = {
  id: string;
  number: string;
  rooms: number;
  area: number;
  price: number;
  oldPrice: number | null;
  pricePerM2: number;
  sourcePricePerM2: number;
  currency: 'UZS';
  promotion: Promotion;
  floor: number;
  totalFloors: number;
  entrance: number;
  buildingId: string;
  building: string;
  propertyClass: string;
  completion: string;
  completionDate: string;
  sourcePlacementCompletionDate: string;
  planAvailable: boolean;
  plan: string | null;
  planSource: string | null;
  planSourceUrls: Record<string, string>;
  planSourceStatus: number;
  planNote: string | null;
  status: 'available';
  isSale: boolean;
  repairIncluded: boolean;
  studio: boolean;
  balconyArea: number;
  ceilingHeight: string;
  provenance: { catalogIndex: number; api: string; officialDetail: string; capturedAt: string };
};
type LeadRequest = { unit: Unit; context: string };

export type MaftunMakonSnapshot = {
  project: string;
  companyId: string;
  realEstateUUID: string;
  propertyTypeUUID: string;
  source: string;
  sourceLanding: string;
  capturedAt: string;
  officialTotalAtCapture: number;
  visibleFirstRender: number;
  integrity: { uniqueUnitIds: number; advertisedFloorplanUrls: number; reachableFloorplans: number; brokenOfficialFloorplanIds: string[] };
  filterSummary: { rooms: number[]; classes: string[]; areaMin: number; areaMax: number; sourcePriceMin: number; sourcePriceMax: number; floorMin: number; floorMax: number; blockCount: number; blocks: Array<{ id: string; name: string; deadline: string; count: number }> };
  normalizationNotes: string[];
  units: Unit[];
};

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const modeOptions: Mode[] = ['cards', 'chess'];
const storageKey = 'maftun-makon-language-v1';

const copy = {
  ru: {
    skip: 'К каталогу', back: 'О проекте', project: 'MAFTUN MAKON · NRG-BI × AL-BINA', language: 'Язык',
    title: 'Найдите свой', accent: 'сад за порталом.', lead: 'Актуальный официальный каталог — без переименования скрытых или проданных квартир в свободные.',
    snapshot: 'Актуальные данные', captured: 'Обновлено', offers: 'свободных предложений', firstRender: 'Доступно сейчас', plans: 'планировок',
    modes: { cards: 'Карточки', chess: 'Шахматка' },
    filters: 'Фильтры', rooms: 'Комнаты', allRooms: 'Все', areaFrom: 'Площадь от, м²', areaTo: 'Площадь до, м²', priceFrom: 'Цена от, млрд', priceTo: 'Цена до, млрд', floor: 'Этаж', allFloors: 'Все этажи', building: 'Очередь / дом', allBuildings: 'Все дома', propertyClass: 'Класс', allClasses: 'Все классы', reset: 'Сбросить',
    sort: 'Сортировка', sorts: { priceAsc: 'Цена ↑', priceDesc: 'Цена ↓', areaAsc: 'Площадь ↑', areaDesc: 'Площадь ↓', floorAsc: 'Этаж ↑', floorDesc: 'Этаж ↓' }, results: 'найдено',
    sourceNote: 'Состав предложений, цены, акции и статусы обновляются автоматически и могут измениться.',
    active: 'В продаже', apartment: 'комн.', entrance: 'Подъезд', completion: 'Срок в каталоге', class: 'Класс', house: 'Дом', plan: 'Открыть планировку', unavailablePlan: 'Планировка временно недоступна', choose: 'Выбрать квартиру', showMore: 'Показать ещё', price: 'Актуальная цена', oldPrice: 'Цена до акции', perM2: 'за м²', promotion: 'Акция',
    noResults: 'По этим параметрам предложений нет.', resetFilters: 'Сбросить фильтры', matrix: 'Этаж × квартиры', matrixHint: 'Прокручивайте пальцем или трекпадом, кнопками 44 px либо клавишами ← → Home End.', scrollLeft: 'Прокрутить влево', scrollRight: 'Прокрутить вправо', selected: 'Выбранная квартира', close: 'Закрыть', details: 'Подробности', balcony: 'Балкон', ceiling: 'Высота потолка', studio: 'Студия', yes: 'Да', no: 'Нет', finishing: 'Отделка включена', consult: 'Получить консультацию',
    disclaimer: 'Информация не является публичной офертой. Актуальные условия подтверждает отдел продаж.',
  },
  uz: {
    skip: 'Katalogga o‘tish', back: 'Loyiha haqida', project: 'MAFTUN MAKON · NRG-BI × AL-BINA', language: 'Til',
    title: 'Portal ortidagi', accent: 'bog‘ingizni toping.', lead: 'Rasmiy katalog avtomatik yangilanadi; yashirilgan yoki sotilgan xonadonlar qayta yaratilmaydi.',
    snapshot: 'Ma’lumotlar yangilanadi', captured: 'So‘nggi yangilanish', offers: 'mavjud taklif', firstRender: 'Hozir mavjud', plans: 'reja',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka' },
    filters: 'Filtrlar', rooms: 'Xonalar', allRooms: 'Barchasi', areaFrom: 'Maydon, m² dan', areaTo: 'Maydon, m² gacha', priceFrom: 'Narx, mlrd dan', priceTo: 'Narx, mlrd gacha', floor: 'Qavat', allFloors: 'Barcha qavatlar', building: 'Navbat / uy', allBuildings: 'Barcha uylar', propertyClass: 'Toifa', allClasses: 'Barcha toifalar', reset: 'Tozalash',
    sort: 'Saralash', sorts: { priceAsc: 'Narx ↑', priceDesc: 'Narx ↓', areaAsc: 'Maydon ↑', areaDesc: 'Maydon ↓', floorAsc: 'Qavat ↑', floorDesc: 'Qavat ↓' }, results: 'topildi',
    sourceNote: 'Takliflar, narxlar, aksiyalar va holatlar avtomatik yangilanadi va o‘zgarishi mumkin.',
    active: 'Sotuvda', apartment: 'xonali', entrance: 'Kirish', completion: 'Katalogdagi muddat', class: 'Toifa', house: 'Uy', plan: 'Rejani ochish', unavailablePlan: 'Rasmiy manbada reja vaqtincha mavjud emas', choose: 'Xonadon tanlash', showMore: 'Yana ko‘rsatish', price: 'Katalog ma’lumotlari narxi', oldPrice: 'Aksiyagacha narx', perM2: 'm² uchun', promotion: 'Aksiya',
    noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', resetFilters: 'Filtrlarni tozalash', matrix: 'Qavat × xonadonlar', matrixHint: 'Barmoq yoki trekpad, 44 px tugmalar yoxud ← → Home End klavishlaridan foydalaning.', scrollLeft: 'Chapga surish', scrollRight: 'O‘ngga surish', selected: 'Tanlangan xonadon', close: 'Yopish', details: 'Tafsilotlar', balcony: 'Balkon', ceiling: 'Shift balandligi', studio: 'Studiya', yes: 'Ha', no: 'Yo‘q', finishing: 'Pardoz kiritilgan', consult: 'Maslahat olish',
    disclaimer: 'Live catalogue ommaviy oferta emas. Amaldagi shartlarni savdo bo‘limi tasdiqlaydi.',
  },
  en: {
    skip: 'Skip to catalogue', back: 'About the project', project: 'MAFTUN MAKON · NRG-BI × AL-BINA', language: 'Language',
    title: 'Find your', accent: 'garden beyond the portal.', lead: 'The official catalogue updates automatically, without presenting hidden or sold apartments as available.',
    snapshot: 'Automatically updated', captured: 'Last updated', offers: 'available listings', firstRender: 'Available now', plans: 'floor plans',
    modes: { cards: 'Cards', chess: 'Matrix' },
    filters: 'Filters', rooms: 'Rooms', allRooms: 'All', areaFrom: 'Area from, m²', areaTo: 'Area to, m²', priceFrom: 'Price from, bn', priceTo: 'Price to, bn', floor: 'Floor', allFloors: 'All floors', building: 'Phase / building', allBuildings: 'All buildings', propertyClass: 'Class', allClasses: 'All classes', reset: 'Reset',
    sort: 'Sort', sorts: { priceAsc: 'Price ↑', priceDesc: 'Price ↓', areaAsc: 'Area ↑', areaDesc: 'Area ↓', floorAsc: 'Floor ↑', floorDesc: 'Floor ↓' }, results: 'found',
    sourceNote: 'Listings, prices, promotions and statuses update automatically and may change.',
    active: 'For sale', apartment: 'room', entrance: 'Entrance', completion: 'Catalogue completion', class: 'Class', house: 'Building', plan: 'Open floor plan', unavailablePlan: 'The official floor plan is temporarily unavailable', choose: 'Choose apartment', showMore: 'Show more', price: 'Current price', oldPrice: 'Pre-offer price', perM2: 'per m²', promotion: 'Offer',
    noResults: 'No listings match these filters.', resetFilters: 'Reset filters', matrix: 'Floor × apartments', matrixHint: 'Use touch or trackpad, the 44 px controls, or ← → Home End keys.', scrollLeft: 'Scroll left', scrollRight: 'Scroll right', selected: 'Selected apartment', close: 'Close', details: 'Details', balcony: 'Balcony', ceiling: 'Ceiling height', studio: 'Studio', yes: 'Yes', no: 'No', finishing: 'Finishing included', consult: 'Request a consultation',
    disclaimer: 'The live catalogue is not a public offer. Current terms are confirmed by the sales team.',
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${withLanguage('/privacy', language)}&project=maftun-makon`; }
function locale(language: Language) { return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US'; }
function money(value: number, language: Language) { return `${new Intl.NumberFormat(locale(language), { maximumFractionDigits: 0 }).format(value)} UZS`; }
function area(value: number, language: Language) { return new Intl.NumberFormat(locale(language), { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value); }
function ceilingLabel(value: string, language: Language) {
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match) return value;
  const decimals = match[0].split(/[.,]/)[1]?.length ?? 0;
  const height = new Intl.NumberFormat(locale(language), { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(match[0].replace(',', '.')));
  return language === 'ru' ? `Не менее ${height} м` : language === 'uz' ? `Kamida ${height} m` : `At least ${height} m`;
}
function shortBuilding(value: string) { return value.replace(/^NRG Maftun Makon\s*/i, '').replace(/\s+-\s+/g, ' '); }
function classLabel(value: string, language: Language) {
  const values: Record<string, Record<Language, string>> = {
    'Комфорт': { ru: 'Comfort', uz: 'Comfort', en: 'Comfort' },
    'Комфорт+': { ru: 'Comfort+', uz: 'Comfort+', en: 'Comfort+' },
    'Бизнес': { ru: 'Business', uz: 'Business', en: 'Business' },
  };
  return values[value]?.[language] ?? value;
}
function completionLabel(unit: Unit, language: Language) {
  const [year, month] = unit.completionDate.split('-').map(Number);
  const quarter = Math.ceil(month / 3);
  if (language === 'ru') return `${quarter} кв. ${year}`;
  if (language === 'uz') return `${year}-yil ${quarter}-chorak`;
  return `Q${quarter} ${year}`;
}

function rememberUnit(unit: Unit) {
  rememberLiveCatalogUnit(unit, 'maftun-makon');
}

function unitLeadContext(unit: Unit, surface: string) {
  return [
    'maftun-makon',
    'catalog',
    surface,
    `unitUuid=${unit.id}`,
    `number=${unit.number}`,
    `buildingId=${unit.buildingId}`,
    `building=${unit.building}`,
    `rooms=${unit.rooms}`,
    `area=${unit.area}`,
    `floor=${unit.floor}/${unit.totalFloors}`,
    `entrance=${unit.entrance}`,
    `class=${unit.propertyClass}`,
    `completion=${unit.completionDate}`,
    `price=${unit.price}`,
  ].join(':');
}

function useLanguage(initialLanguage: Language) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = window.localStorage.getItem(storageKey);
    const next = languages.includes(query as Language) ? query as Language : languages.includes(saved as Language) ? saved as Language : 'ru';
    const frame = window.requestAnimationFrame(() => setLanguageState(next));
    window.localStorage.setItem(storageKey, next);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => { document.documentElement.lang = language; }, [language]);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem(storageKey, next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  };

  return [language, setLanguage] as const;
}

function PlanPreview({ unit, language, onOpen }: { unit: Unit; language: Language; onOpen: () => void }) {
  const t = copy[language];
  if (!unit.planAvailable || !unit.plan) {
    return <div className="maftun-catalog-plan-placeholder" role="img" aria-label={`${t.unavailablePlan}: № ${unit.number}`}><span aria-hidden="true">⌁</span><strong>{t.unavailablePlan}</strong><small>HTTP 404 · {unit.id.slice(0, 8)}</small></div>;
  }
  return (
    <button className="maftun-catalog-plan" type="button" onClick={onOpen} aria-label={`${t.plan}: № ${unit.number}`}>
      <img src={asset(unit.plan)} alt={`${t.plan} · № ${unit.number}`} loading="lazy" decoding="async" />
      <span aria-hidden="true">↗</span>
    </button>
  );
}

function useDialog(onClose: () => void, panelRef: React.RefObject<HTMLElement | null>, closeRef: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add('maftun-catalog-overlay-locked');
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('maftun-catalog-overlay-locked');
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => previous?.isConnected && previous.focus());
    };
  }, [closeRef, onClose, panelRef]);
}

function PlanLightbox({ unit, language, onClose }: { unit: Unit; language: Language; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  useDialog(onClose, panelRef, closeRef);
  if (!unit.plan) return null;
  return (
    <div ref={panelRef} className="maftun-catalog-lightbox" role="dialog" aria-modal="true" aria-label={`${t.plan}: № ${unit.number}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button>
      <figure>
        <img src={asset(unit.plan)} alt={`${t.plan} · № ${unit.number}`} />
        <figcaption><strong>№ {unit.number} · {unit.rooms} {t.apartment} · {area(unit.area, language)} м²</strong><span>{shortBuilding(unit.building)} · {unit.floor}/{unit.totalFloors}</span></figcaption>
      </figure>
    </div>
  );
}

function UnitCard({ unit, language, onPlan, onLead }: { unit: Unit; language: Language; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  return (
    <article className="maftun-unit-card" data-unit-id={unit.id}>
      <header><span>{classLabel(unit.propertyClass, language)}</span><strong><i aria-hidden="true" />{t.active}</strong></header>
      <PlanPreview unit={unit} language={language} onOpen={onPlan} />
      <div className="maftun-unit-card__body">
        <small>{shortBuilding(unit.building)} · № {unit.number}</small>
        <h2>{unit.rooms} {t.apartment} · {area(unit.area, language)} м²</h2>
        <dl><div><dt>{t.floor}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div><div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div><div><dt>{t.completion}</dt><dd>{completionLabel(unit, language)}</dd></div></dl>
        <div className="maftun-unit-card__price"><small>{t.price}</small><strong>{money(unit.price, language)}</strong><span>{money(unit.pricePerM2, language)} {t.perM2}</span>{unit.oldPrice ? <del>{t.oldPrice}: {money(unit.oldPrice, language)}</del> : null}{unit.promotion ? <b>{t.promotion} −{unit.promotion.percent}%</b> : null}</div>
        <button type="button" data-lead-trigger onClick={onLead}>{t.consult}<span>↗</span></button>
      </div>
    </article>
  );
}

function UnitDetail({ unit, language, onClose, onPlan, onLead }: { unit: Unit; language: Language; onClose: () => void; onPlan: () => void; onLead: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [isDrawer, setIsDrawer] = useState(false);
  const t = copy[language];

  useEffect(() => {
    const query = window.matchMedia('(max-width: 850px)');
    const update = () => setIsDrawer(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
    if (isDrawer) document.body.classList.add('maftun-catalog-detail-locked');
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.maftun-catalog-lightbox, .lead-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !isDrawer || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('maftun-catalog-detail-locked');
      window.removeEventListener('keydown', onKey);
    };
  }, [isDrawer, onClose, unit.id]);

  return (
    <>
      {isDrawer ? <button className="maftun-unit-detail-backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.close} /> : null}
      <aside ref={panelRef} className="maftun-unit-detail" role={isDrawer ? 'dialog' : 'region'} aria-modal={isDrawer || undefined} aria-labelledby={`maftun-detail-title-${unit.id}`} data-testid="maftun-unit-detail">
      <header><div><small>{t.selected}</small><strong>№ {unit.number}</strong></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button></header>
      <PlanPreview unit={unit} language={language} onOpen={onPlan} />
      <h3 id={`maftun-detail-title-${unit.id}`}>{unit.rooms} {t.apartment} · {area(unit.area, language)} м²</h3>
      <dl>
        <div><dt>{t.house}</dt><dd title={unit.building}>{shortBuilding(unit.building)}</dd></div>
        <div><dt>{t.class}</dt><dd>{classLabel(unit.propertyClass, language)}</dd></div>
        <div><dt>{t.floor}</dt><dd>{unit.floor}/{unit.totalFloors}</dd></div>
        <div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div>
        <div><dt>{t.completion}</dt><dd>{completionLabel(unit, language)}</dd></div>
        <div><dt>{t.balcony}</dt><dd>{area(unit.balconyArea, language)} м²</dd></div>
        <div><dt>{t.ceiling}</dt><dd>{ceilingLabel(unit.ceilingHeight, language)}</dd></div>
        <div><dt>{t.studio}</dt><dd>{unit.studio ? t.yes : t.no}</dd></div>
        <div><dt>{t.finishing}</dt><dd>{unit.repairIncluded ? t.yes : t.no}</dd></div>
      </dl>
      <div className="maftun-unit-detail__price"><small>{t.price}</small><strong>{money(unit.price, language)}</strong><span>{money(unit.pricePerM2, language)} {t.perM2}</span>{unit.oldPrice ? <del>{money(unit.oldPrice, language)}</del> : null}{unit.promotion ? <b>{t.promotion} −{unit.promotion.percent}%</b> : null}</div>
      <button className="maftun-unit-detail__cta" type="button" data-lead-trigger onClick={onLead}>{t.consult}<span>↗</span></button>
      </aside>
    </>
  );
}

function MatrixBuilding({ units, language, selectedId, onSelect }: { units: Unit[]; language: Language; selectedId?: string; onSelect: (unit: Unit, trigger: HTMLButtonElement) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const t = copy[language];
  const floors = useMemo(() => [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a), [units]);
  const building = units[0]?.building ?? '';
  const updateEdges = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setEdges({ start: viewport.scrollLeft <= 1, end: max <= 1 || viewport.scrollLeft >= max - 1 });
  }, []);
  const scroll = useCallback((direction: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({ left: direction * Math.min(680, viewport.clientWidth * .84), behavior: maftunScrollBehavior() });
  }, []);
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); scroll(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); scroll(1); }
    if (event.key === 'Home') { event.preventDefault(); viewportRef.current?.scrollTo({ left: 0, behavior: maftunScrollBehavior() }); }
    if (event.key === 'End') { event.preventDefault(); viewportRef.current?.scrollTo({ left: viewportRef.current.scrollWidth, behavior: maftunScrollBehavior() }); }
  };
  useEffect(() => {
    updateEdges();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    return () => observer.disconnect();
  }, [units, updateEdges]);

  return (
    <section className="maftun-matrix-building" data-building={building}>
      <header>
        <div><small>{classLabel(units[0].propertyClass, language)} · {units.length} {t.offers}</small><h3 title={building}>{shortBuilding(building)}</h3></div>
        <div className="maftun-matrix-building__controls">
          <button data-testid={`maftun-scroll-left-${units[0].buildingId}`} type="button" onClick={() => scroll(-1)} disabled={edges.start} aria-label={`${t.scrollLeft}: ${shortBuilding(building)}`}>←</button>
          <button data-testid={`maftun-scroll-right-${units[0].buildingId}`} type="button" onClick={() => scroll(1)} disabled={edges.end} aria-label={`${t.scrollRight}: ${shortBuilding(building)}`}>→</button>
        </div>
      </header>
      <div ref={viewportRef} className="maftun-matrix-viewport" tabIndex={0} onKeyDown={onKey} onScroll={updateEdges} aria-label={`${t.matrix}: ${shortBuilding(building)}`}>
        <div className="maftun-matrix-table">
          <div className="maftun-matrix-caption"><span>{t.floor}</span><strong>{t.offers}</strong></div>
          {floors.map((floor) => (
            <div className="maftun-matrix-row" key={floor}>
              <div className="maftun-matrix-floor"><strong>{floor}</strong><span>{t.floor}</span></div>
              <div className="maftun-matrix-cells">
                {units.filter((unit) => unit.floor === floor).sort((a, b) => a.entrance - b.entrance || a.number.localeCompare(b.number, undefined, { numeric: true })).map((unit) => (
                  <button key={unit.id} type="button" className={selectedId === unit.id ? 'is-selected' : ''} aria-pressed={selectedId === unit.id} aria-label={`${shortBuilding(unit.building)}, № ${unit.number}, ${unit.rooms} ${t.apartment}, ${area(unit.area, language)} м², ${t.floor} ${unit.floor}/${unit.totalFloors}, ${t.entrance} ${unit.entrance}, ${money(unit.price, language)}`} onClick={(event) => onSelect(unit, event.currentTarget)}>
                    <small>№ {unit.number}<i aria-hidden="true" /></small>
                    <strong>{unit.rooms} · {area(unit.area, language)} м²</strong>
                    <span>{money(unit.price, language)}</span>
                    <em>{t.entrance} {unit.entrance} · {completionLabel(unit, language)}</em>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MaftunMakonCatalog({ snapshot: embeddedSnapshot, initialLanguage }: { snapshot: MaftunMakonSnapshot; initialLanguage: Language }) {
  const { data: snapshot } = useLiveCatalogSnapshot('maftun-makon', embeddedSnapshot);
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [mode, setMode] = useState<Mode>('cards');
  const [rooms, setRooms] = useState('all');
  const [areaFrom, setAreaFrom] = useState('');
  const [areaTo, setAreaTo] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [floor, setFloor] = useState('all');
  const [building, setBuilding] = useState('all');
  const [propertyClass, setPropertyClass] = useState('all');
  const [sort, setSort] = useState<Sort>('priceAsc');
  const [visible, setVisible] = useState(12);
  const [selectedId, setSelectedId] = useState<string>();
  const [plan, setPlan] = useState<Unit>();
  const [lead, setLead] = useState<LeadRequest>();
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const t = copy[language];
  useMaftunSmoothScroll();

  const roomOptions = useMemo(() => [...new Set(snapshot.units.map((unit) => unit.rooms))].sort((a, b) => a - b), [snapshot.units]);
  const floorOptions = useMemo(() => [...new Set(snapshot.units.map((unit) => unit.floor))].sort((a, b) => a - b), [snapshot.units]);
  const buildings = useMemo(() => [...new Map(snapshot.units.map((unit) => [unit.buildingId, { id: unit.buildingId, name: unit.building }])).values()], [snapshot.units]);
  const classes = useMemo(() => [...new Set(snapshot.units.map((unit) => unit.propertyClass))], [snapshot.units]);

  const filtered = useMemo(() => {
    const minArea = Number(areaFrom) || 0;
    const maxArea = Number(areaTo) || Infinity;
    const minPrice = (Number(priceFrom) || 0) * 1e9;
    const maxPrice = (Number(priceTo) || Infinity) * 1e9;
    return snapshot.units
      .filter((unit) => (rooms === 'all' || unit.rooms === Number(rooms)) && (floor === 'all' || unit.floor === Number(floor)) && (building === 'all' || unit.buildingId === building) && (propertyClass === 'all' || unit.propertyClass === propertyClass) && unit.area >= minArea && unit.area <= maxArea && unit.price >= minPrice && unit.price <= maxPrice)
      .sort((a, b) => sort === 'priceAsc' ? a.price - b.price : sort === 'priceDesc' ? b.price - a.price : sort === 'areaAsc' ? a.area - b.area : sort === 'areaDesc' ? b.area - a.area : sort === 'floorAsc' ? a.floor - b.floor || a.price - b.price : b.floor - a.floor || a.price - b.price);
  }, [areaFrom, areaTo, building, floor, priceFrom, priceTo, propertyClass, rooms, snapshot.units, sort]);

  const matrixGroups = useMemo(() => {
    const groups = new Map<string, Unit[]>();
    filtered.forEach((unit) => groups.set(unit.buildingId, [...(groups.get(unit.buildingId) ?? []), unit]));
    return [...groups.values()];
  }, [filtered]);
  const selected = selectedId ? filtered.find((unit) => unit.id === selectedId) : undefined;

  const reset = () => {
    setRooms('all'); setAreaFrom(''); setAreaTo(''); setPriceFrom(''); setPriceTo(''); setFloor('all'); setBuilding('all'); setPropertyClass('all'); setSort('priceAsc'); setVisible(12); setSelectedId(undefined);
  };
  const resetPresentation = () => { setVisible(12); setSelectedId(undefined); };
  const selectUnit = (unit: Unit, trigger: HTMLButtonElement) => {
    rememberUnit(unit);
    detailTriggerRef.current = trigger;
    setSelectedId(unit.id);
  };
  const closeDetail = useCallback(() => {
    setSelectedId(undefined);
    window.requestAnimationFrame(() => detailTriggerRef.current?.focus());
  }, []);
  const closeLead = useCallback(() => setLead(undefined), []);
  const openPlan = (unit: Unit) => { rememberUnit(unit); setPlan(unit); };
  const openUnitLead = (unit: Unit, surface: string) => {
    rememberUnit(unit);
    setLead({ unit, context: unitLeadContext(unit, surface) });
  };
  const selectMode = (next: Mode) => {
    setMode(next);
    setSelectedId(undefined);
    window.requestAnimationFrame(() => document.getElementById('maftun-catalog-results')?.scrollIntoView({ behavior: maftunScrollBehavior(), block: 'start' }));
  };
  const onModeKey = (event: ReactKeyboardEvent<HTMLButtonElement>, current: Mode) => {
    const currentIndex = modeOptions.indexOf(current);
    const nextIndex = event.key === 'ArrowRight' ? (currentIndex + 1) % modeOptions.length : event.key === 'ArrowLeft' ? (currentIndex - 1 + modeOptions.length) % modeOptions.length : event.key === 'Home' ? 0 : event.key === 'End' ? modeOptions.length - 1 : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const next = modeOptions[nextIndex];
    selectMode(next);
    window.requestAnimationFrame(() => document.getElementById(`maftun-tab-${next}`)?.focus());
  };
  const captured = new Intl.DateTimeFormat(locale(language), { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Tashkent' }).format(new Date(snapshot.capturedAt));
  const plansAvailable = snapshot.units.filter((unit) => unit.planAvailable && unit.plan).length;

  return (
    <main className="maftun-catalog-site" id="maftun-catalog-top" lang={language}>
      <a className="maftun-catalog-skip" href="#maftun-catalog-results">{t.skip}</a>
      <header className="maftun-catalog-header">
        <a className="maftun-catalog-wordmark" href={withLanguage('/maftun-makon', language)}>MAFTUN <span>MAKON</span></a>
        <a className="maftun-catalog-back" href={withLanguage('/maftun-makon', language)}>← {t.back}</a>
        <a className="maftun-catalog-phone" href="tel:+998781137712">+998 78 113 77 12</a>
        <div className="maftun-catalog-languages" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
      </header>

      <section className="maftun-catalog-hero">
        <div><p>{t.project}</p><h1>{t.title}<em>{t.accent}</em></h1><span>{t.lead}</span></div>
        <aside><small>{t.snapshot}</small><strong>{snapshot.units.length}</strong><span>{t.offers}</span><dl><div><dt>{t.captured}</dt><dd>{captured} · UZT</dd></div><div><dt>{t.firstRender}</dt><dd>{snapshot.units.length}</dd></div><div><dt>{t.plans}</dt><dd>{plansAvailable} / {snapshot.units.length}</dd></div></dl></aside>
      </section>

      <section className="maftun-catalog-controls" aria-label={t.filters}>
        <div className="maftun-catalog-modes" role="tablist" aria-label={t.filters}>
          {modeOptions.map((item) => <button data-testid={`maftun-mode-${item}`} id={`maftun-tab-${item}`} key={item} type="button" role="tab" aria-selected={mode === item} aria-controls="maftun-panel" tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : ''} onClick={() => selectMode(item)} onKeyDown={(event) => onModeKey(event, item)}>{t.modes[item]}</button>)}
        </div>
        <div className="maftun-catalog-filters">
          <label><span>{t.rooms}</span><select data-testid="maftun-filter-rooms" value={rooms} onChange={(event) => { setRooms(event.target.value); resetPresentation(); }}><option value="all">{t.allRooms}</option>{roomOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>{t.areaFrom}</span><input data-testid="maftun-filter-area-from" type="number" min="0" step="1" inputMode="decimal" placeholder={String(Math.floor(snapshot.filterSummary.areaMin))} value={areaFrom} onChange={(event) => { setAreaFrom(event.target.value); resetPresentation(); }} /></label>
          <label><span>{t.areaTo}</span><input data-testid="maftun-filter-area-to" type="number" min="0" step="1" inputMode="decimal" placeholder={String(Math.ceil(snapshot.filterSummary.areaMax))} value={areaTo} onChange={(event) => { setAreaTo(event.target.value); resetPresentation(); }} /></label>
          <label><span>{t.priceFrom}</span><input data-testid="maftun-filter-price-from" type="number" min="0" step=".1" inputMode="decimal" placeholder="0.5" value={priceFrom} onChange={(event) => { setPriceFrom(event.target.value); resetPresentation(); }} /></label>
          <label><span>{t.priceTo}</span><input data-testid="maftun-filter-price-to" type="number" min="0" step=".1" inputMode="decimal" placeholder="3.3" value={priceTo} onChange={(event) => { setPriceTo(event.target.value); resetPresentation(); }} /></label>
          <label><span>{t.floor}</span><select data-testid="maftun-filter-floor" value={floor} onChange={(event) => { setFloor(event.target.value); resetPresentation(); }}><option value="all">{t.allFloors}</option>{floorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="is-wide"><span>{t.building}</span><select data-testid="maftun-filter-building" value={building} onChange={(event) => { setBuilding(event.target.value); resetPresentation(); }}><option value="all">{t.allBuildings}</option>{buildings.map((value) => <option key={value.id} value={value.id}>{shortBuilding(value.name)}</option>)}</select></label>
          <label><span>{t.propertyClass}</span><select data-testid="maftun-filter-class" value={propertyClass} onChange={(event) => { setPropertyClass(event.target.value); resetPresentation(); }}><option value="all">{t.allClasses}</option>{classes.map((value) => <option key={value} value={value}>{classLabel(value, language)}</option>)}</select></label>
          <button data-testid="maftun-filter-reset" type="button" onClick={reset}>{t.reset}<span>↺</span></button>
        </div>
      </section>

      <section className="maftun-catalog-results" id="maftun-catalog-results" tabIndex={-1}>
        <header><div aria-live="polite"><strong data-testid="maftun-result-count">{filtered.length}</strong><span>{t.results}</span></div><label><span>{t.sort}</span><select data-testid="maftun-sort" value={sort} onChange={(event) => { setSort(event.target.value as Sort); resetPresentation(); }}>{Object.entries(t.sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
        <div className="maftun-catalog-source"><span aria-hidden="true">i</span><p>{t.sourceNote}</p></div>

        {!filtered.length ? <div id="maftun-panel" className="maftun-catalog-empty" role="tabpanel" aria-labelledby={`maftun-tab-${mode}`}><span aria-hidden="true">⌁</span><h2>{t.noResults}</h2><button type="button" onClick={reset}>{t.resetFilters}</button></div> : null}

        {mode === 'cards' && filtered.length ? (
          <div id="maftun-panel" role="tabpanel" aria-labelledby="maftun-tab-cards">
            <div className="maftun-unit-grid">{filtered.slice(0, visible).map((unit) => <UnitCard key={unit.id} unit={unit} language={language} onPlan={() => openPlan(unit)} onLead={() => openUnitLead(unit, 'cards:consultation-cta')} />)}</div>
            {visible < filtered.length ? <button data-testid="maftun-show-more" className="maftun-catalog-show-more" type="button" onClick={() => setVisible((value) => value + 12)}><span>{t.showMore}</span><strong>{Math.min(visible, filtered.length)} / {filtered.length}</strong></button> : null}
          </div>
        ) : null}

        {mode !== 'cards' && filtered.length ? (
          <section id="maftun-panel" className="maftun-matrix" role="tabpanel" aria-labelledby={`maftun-tab-${mode}`}>
            <header><div><small>{t.modes.chess}</small><h2>{t.matrix}</h2><p>{t.matrixHint}</p></div></header>
            <div className={`maftun-matrix-layout ${selected ? 'has-detail' : ''}`}>
              <div className="maftun-matrix-groups">{matrixGroups.map((units) => <MatrixBuilding key={units[0].buildingId} units={units} language={language} selectedId={selected?.id} onSelect={selectUnit} />)}</div>
              {selected ? <UnitDetail unit={selected} language={language} onClose={closeDetail} onPlan={() => openPlan(selected)} onLead={() => openUnitLead(selected, `${mode}:detail-consultation-cta`)} /> : null}
            </div>
          </section>
        ) : null}
      </section>

      <footer className="maftun-catalog-footer"><a className="maftun-catalog-wordmark" href={withLanguage('/maftun-makon', language)}>MAFTUN <span>MAKON</span></a><p>{t.disclaimer}</p><a href="tel:+998781137712">+998 78 113 77 12</a><a href="#maftun-catalog-top" aria-label="Back to top">↑</a></footer>
      {plan ? <PlanLightbox unit={plan} language={language} onClose={() => setPlan(undefined)} /> : null}
      {lead ? (
        <div
          className="maftun-lead-host"
          data-project-slug="maftun-makon"
          data-context={lead.context}
          data-unit-uuid={lead.unit.id}
          data-unit-number={lead.unit.number}
          data-building-id={lead.unit.buildingId}
        >
          <LeadModal
            open
            language={language}
            context={lead.context}
            hideBrand
            projectName="MAFTUN MAKON"
            tagline={`№ ${lead.unit.number} · ${lead.unit.rooms} ${t.apartment} · ${area(lead.unit.area, language)} м²`}
            facts={[classLabel(lead.unit.propertyClass, language), `${lead.unit.floor}/${lead.unit.totalFloors} ${t.floor}`, money(lead.unit.price, language)]}
            submitUrl={maftunLeadSubmitUrl()}
            projectSlug="maftun-makon"
            {...catalogLeadIdentity(lead.unit)}
            privacyUrl={privacyUrl(language)}
            requireConsent
            onClose={closeLead}
          />
        </div>
      ) : null}
    </main>
  );
}
