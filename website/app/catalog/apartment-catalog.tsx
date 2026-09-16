'use client';

/* eslint-disable @next/next/no-img-element */

import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LeadModal, rememberLiveCatalogUnit } from '@/app/lead-modal';
import type {
  ApartmentCatalogProps,
  CatalogLanguage,
  CatalogPlan,
  CatalogQueue,
  CatalogSort,
  CatalogStatus,
  CatalogUnit,
  LocalizedCatalogCopy,
} from './types';
import './apartment-catalog.css';

type CatalogMode = 'cards' | 'chess';
type FilterValue = 'all' | string;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: CatalogLanguage[] = ['ru', 'uz', 'en'];

const ui = {
  ru: {
    skip: 'Перейти к каталогу', language: 'Язык', request: 'Оставить заявку', available: 'доступно', of: 'из',
    visual: 'Визуальный выбор', visualHint: 'Доступен на большом экране', catalog: 'Каталог квартир',
    cards: 'Карточки', chess: 'Шахматка', view: 'Режим каталога', filters: 'Фильтры', reset: 'Сбросить',
    rooms: 'Комнаты', allRooms: 'Все', building: 'Корпус', allBuildings: 'Все корпуса', queue: 'Очередь', allQueues: 'Все очереди', phase: 'Этап', allPhases: 'Все этапы',
    entrance: 'Подъезд', allEntrances: 'Все подъезды', floor: 'Этаж', allFloors: 'Все этажи', status: 'Статус', allStatuses: 'Все статусы',
    areaFrom: 'Площадь от', areaTo: 'Площадь до', sort: 'Сортировка', found: 'Найдено', offers: 'предложений',
    sorts: { status: 'Сначала свободные', 'price-asc': 'Сначала дешевле', 'price-desc': 'Сначала дороже', 'area-asc': 'Площадь по возрастанию', 'area-desc': 'Площадь по убыванию', 'floor-asc': 'С нижних этажей', 'floor-desc': 'С верхних этажей' },
    statuses: { available: 'Свободна', reserved: 'Бронь', sold: 'Продана', unavailable: 'Недоступна' },
    apartment: 'Квартира', parking: 'Машиноместо', commercial: 'Помещение', area: 'Площадь', price: 'Стоимость', priceOnRequest: 'По запросу', perM2: 'за м²',
    exactPlan: 'Планировка квартиры', floorPosition: 'Расположение на этаже', representative: 'Типовая планировка', noPlan: 'Планировка не опубликована',
    enlarge: 'Увеличить', choose: 'Уточнить условия', selected: 'Выбранный объект', details: 'Детали квартиры', close: 'Закрыть',
    previousPlan: 'Предыдущий лист', nextPlan: 'Следующий лист', scrollLeft: 'Прокрутить влево', scrollRight: 'Прокрутить вправо',
    scrollHint: 'Шахматка прокручивается пальцем, трекпадом, стрелками, Home и End.', floorShort: 'эт.',
    showMore: 'Показать ещё', showing: 'Показано', empty: 'По выбранным параметрам квартир нет.', clearFilters: 'Сбросить фильтры',
    sourceLive: 'Наличие обновляется автоматически', sourceCached: 'Показаны последние сохранённые данные', sourceEmbedded: 'Показан проверенный каталог',
  },
  uz: {
    skip: 'Katalogga o‘tish', language: 'Til', request: 'Ariza qoldirish', available: 'mavjud', of: 'jami',
    visual: 'Vizual tanlov', visualHint: 'Katta ekranda mavjud', catalog: 'Xonadonlar katalogi',
    cards: 'Kartalar', chess: 'Shaxmatka', view: 'Katalog ko‘rinishi', filters: 'Filtrlar', reset: 'Tozalash',
    rooms: 'Xonalar', allRooms: 'Barchasi', building: 'Korpus', allBuildings: 'Barcha korpuslar', queue: 'Navbat', allQueues: 'Barcha navbatlar', phase: 'Bosqich', allPhases: 'Barcha bosqichlar',
    entrance: 'Kirish', allEntrances: 'Barcha kirishlar', floor: 'Qavat', allFloors: 'Barcha qavatlar', status: 'Holat', allStatuses: 'Barcha holatlar',
    areaFrom: 'Maydon, dan', areaTo: 'Maydon, gacha', sort: 'Saralash', found: 'Topildi', offers: 'ta taklif',
    sorts: { status: 'Avval mavjudlari', 'price-asc': 'Avval arzonlari', 'price-desc': 'Avval qimmatlari', 'area-asc': 'Maydon o‘sishi bo‘yicha', 'area-desc': 'Maydon kamayishi bo‘yicha', 'floor-asc': 'Quyi qavatlardan', 'floor-desc': 'Yuqori qavatlardan' },
    statuses: { available: 'Mavjud', reserved: 'Band', sold: 'Sotilgan', unavailable: 'Mavjud emas' },
    apartment: 'Xonadon', parking: 'Parking o‘rni', commercial: 'Tijorat joyi', area: 'Maydon', price: 'Narx', priceOnRequest: 'So‘rov bo‘yicha', perM2: 'm² uchun',
    exactPlan: 'Xonadon rejasi', floorPosition: 'Qavatdagi joylashuv', representative: 'Namunaviy reja', noPlan: 'Reja e’lon qilinmagan',
    enlarge: 'Kattalashtirish', choose: 'Shartlarni aniqlash', selected: 'Tanlangan obyekt', details: 'Xonadon tafsilotlari', close: 'Yopish',
    previousPlan: 'Oldingi varaq', nextPlan: 'Keyingi varaq', scrollLeft: 'Chapga surish', scrollRight: 'O‘ngga surish',
    scrollHint: 'Shaxmatkani barmoq, trekpad, strelkalar, Home va End bilan surish mumkin.', floorShort: 'qav.',
    showMore: 'Yana ko‘rsatish', showing: 'Ko‘rsatildi', empty: 'Tanlangan parametrlar bo‘yicha xonadon yo‘q.', clearFilters: 'Filtrlarni tozalash',
    sourceLive: 'Mavjudlik avtomatik yangilanadi', sourceCached: 'So‘nggi saqlangan ma’lumotlar ko‘rsatilmoqda', sourceEmbedded: 'Tekshirilgan katalog ko‘rsatilmoqda',
  },
  en: {
    skip: 'Skip to catalogue', language: 'Language', request: 'Submit a request', available: 'available', of: 'of',
    visual: 'Visual selection', visualHint: 'Available on larger screens', catalog: 'Apartment catalogue',
    cards: 'Cards', chess: 'Availability grid', view: 'Catalogue view', filters: 'Filters', reset: 'Reset',
    rooms: 'Rooms', allRooms: 'All', building: 'Building', allBuildings: 'All buildings', queue: 'Construction phase', allQueues: 'All construction phases', phase: 'Stage', allPhases: 'All stages',
    entrance: 'Entrance', allEntrances: 'All entrances', floor: 'Floor', allFloors: 'All floors', status: 'Status', allStatuses: 'All statuses',
    areaFrom: 'Area from', areaTo: 'Area to', sort: 'Sort', found: 'Found', offers: 'listings',
    sorts: { status: 'Available first', 'price-asc': 'Lowest price first', 'price-desc': 'Highest price first', 'area-asc': 'Area ascending', 'area-desc': 'Area descending', 'floor-asc': 'Lower floors first', 'floor-desc': 'Higher floors first' },
    statuses: { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Unavailable' },
    apartment: 'Apartment', parking: 'Parking space', commercial: 'Commercial unit', area: 'Area', price: 'Price', priceOnRequest: 'On request', perM2: 'per m²',
    exactPlan: 'Apartment plan', floorPosition: 'Position on floor', representative: 'Representative plan', noPlan: 'Plan not published',
    enlarge: 'Enlarge', choose: 'Ask about terms', selected: 'Selected property', details: 'Apartment details', close: 'Close',
    previousPlan: 'Previous sheet', nextPlan: 'Next sheet', scrollLeft: 'Scroll left', scrollRight: 'Scroll right',
    scrollHint: 'Pan the grid with touch, a trackpad, arrow keys, Home or End.', floorShort: 'fl.',
    showMore: 'Show more', showing: 'Showing', empty: 'No apartments match the selected filters.', clearFilters: 'Reset filters',
    sourceLive: 'Availability updates automatically', sourceCached: 'Showing the latest saved data', sourceEmbedded: 'Showing the verified catalogue',
  },
} as const;

function localized(copy: LocalizedCatalogCopy | undefined, language: CatalogLanguage, fallback = '') {
  return copy?.[language] ?? copy?.ru ?? copy?.uz ?? copy?.en ?? fallback;
}

function asset(path: string) {
  if (!path || /^(?:https?:)?\/\//i.test(path) || path.startsWith('data:')) return path;
  return `${appBasePath}${path.startsWith('/') ? path : `/${path}`}`;
}

function localeFor(language: CatalogLanguage) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US';
}

function number(value: number, language: CatalogLanguage, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(localeFor(language), { maximumFractionDigits }).format(value);
}

function money(value: number | undefined, currency: string | undefined, language: CatalogLanguage, fallback: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  const code = currency || 'UZS';
  try {
    return new Intl.NumberFormat(localeFor(language), { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${number(value, language, 0)} ${code}`;
  }
}

function dateLabel(value: string | undefined, language: CatalogLanguage) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat(localeFor(language), { dateStyle: 'medium', timeZone: 'Asia/Tashkent' }).format(date);
}

function propertyLabel(unit: CatalogUnit, language: CatalogLanguage) {
  const t = ui[language];
  if (unit.propertyType === 'parking') return t.parking;
  if (unit.propertyType === 'commercial') return t.commercial;
  return t.apartment;
}

function planLabel(plan: CatalogPlan, language: CatalogLanguage) {
  const t = ui[language];
  return localized(plan.label, language, plan.kind === 'unit' ? t.exactPlan : plan.kind === 'floor-position' ? t.floorPosition : t.representative);
}

function unitPlan(unit: CatalogUnit) {
  return unit.plans.find((plan) => plan.kind === 'unit') ?? unit.plans[0];
}

function queueLabel(queue: Pick<CatalogQueue, 'label' | 'displayCode'>, language: CatalogLanguage) {
  const code = queue.displayCode?.trim();
  if (!code) return queue.label;
  if (language === 'uz') return `${code} navbat`;
  if (language === 'en') return `Phase ${code}`;
  return `${code} очередь`;
}

function unitQueueLabel(unit: CatalogUnit, language: CatalogLanguage) {
  return queueLabel({ label: unit.queueLabel ?? unit.queueKey ?? '', displayCode: unit.queueDisplayCode }, language);
}

function PlanImage({ plan, preview = false, alt, loading }: { plan: CatalogPlan; preview?: boolean; alt: string; loading?: 'eager' | 'lazy' }) {
  const primary = preview ? plan.previewSrc ?? plan.src : plan.src;
  const fallback = preview
    ? (plan.fallbackSrc && plan.fallbackSrc !== primary ? plan.fallbackSrc : undefined) ?? (plan.src !== primary ? plan.src : undefined)
    : plan.fallbackSrc ?? (plan.previewSrc !== primary ? plan.previewSrc : undefined);
  return <img
    src={asset(primary)}
    alt={alt}
    loading={loading}
    decoding="async"
    onError={(event) => {
      if (!fallback || event.currentTarget.dataset.fallbackApplied === 'true') return;
      event.currentTarget.dataset.fallbackApplied = 'true';
      event.currentTarget.src = asset(fallback);
    }}
  />;
}

function statusRank(status: CatalogStatus) {
  return { available: 0, reserved: 1, sold: 2, unavailable: 3 }[status];
}

function natural(left: string | undefined, right: string | undefined) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'ru', { numeric: true });
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort(natural);
}

function chooseByIdentity(units: CatalogUnit[], stableKey: string | null, numberValue: string | null, entranceValue: string | null, floorValue: string | null) {
  if (stableKey) {
    const stableMatch = units.find((unit) => unit.unitKey === stableKey || unit.id === stableKey);
    if (stableMatch) return stableMatch;
  }
  if (!numberValue) return undefined;
  const floor = Number(floorValue);
  const matches = units.filter((unit) => unit.number === numberValue
    && (!entranceValue || unit.entrance === entranceValue)
    && (!floorValue || (Number.isFinite(floor) && unit.floor === floor)));
  return matches.length === 1 ? matches[0] : units.find((unit) => unit.id === numberValue || unit.unitKey === numberValue);
}

function useCatalogueLanguage(initialLanguage: CatalogLanguage, storageKey: string) {
  const [language, setLanguageState] = useState<CatalogLanguage>(initialLanguage);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromURL = params.get('lang');
    const saved = window.localStorage.getItem(storageKey);
    const next = languages.includes(fromURL as CatalogLanguage) ? fromURL : saved;
    const frame = window.requestAnimationFrame(() => {
      if (languages.includes(next as CatalogLanguage)) setLanguageState(next as CatalogLanguage);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: CatalogLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem(storageKey, next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };
  return [language, setLanguage] as const;
}

function PlanPreview({ unit, language, onOpen, compact = false }: { unit: CatalogUnit; language: CatalogLanguage; onOpen: () => void; compact?: boolean }) {
  const plan = unitPlan(unit);
  const t = ui[language];
  if (!plan) return <div className={`apartment-catalog__plan-placeholder${compact ? ' is-compact' : ''}`}><span aria-hidden="true">⌑</span><p>{t.noPlan}</p></div>;
  return <button className={`apartment-catalog__plan-preview${compact ? ' is-compact' : ''}`} type="button" onClick={onOpen} aria-label={`${t.enlarge}: ${propertyLabel(unit, language)} №${unit.number}`}>
    <PlanImage plan={plan} preview alt={`${planLabel(plan, language)} · ${propertyLabel(unit, language)} №${unit.number}`} loading={compact ? 'eager' : 'lazy'} />
    <span>{planLabel(plan, language)}<b aria-hidden="true">↗</b></span>
  </button>;
}

function PlanLightbox({ unit, language, initialIndex, onClose }: { unit: CatalogUnit; language: CatalogLanguage; initialIndex: number; onClose: () => void }) {
  const t = ui[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(Math.min(initialIndex, Math.max(0, unit.plans.length - 1)));
  const plan = unit.plans[index];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft' && unit.plans.length > 1) { event.preventDefault(); setIndex((current) => (current - 1 + unit.plans.length) % unit.plans.length); return; }
      if (event.key === 'ArrowRight' && unit.plans.length > 1) { event.preventDefault(); setIndex((current) => (current + 1) % unit.plans.length); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],select,input,textarea')).filter((element) => element.tabIndex !== -1);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.body.classList.add('is-apartment-catalog-overlay');
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('is-apartment-catalog-overlay');
      window.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [onClose, unit.plans.length]);

  if (!plan) return null;
  return <div ref={dialogRef} className="apartment-catalog-lightbox" role="dialog" aria-modal="true" aria-label={`${planLabel(plan, language)} №${unit.number}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="apartment-catalog-lightbox__panel">
      <header><div><small>{planLabel(plan, language)}</small><strong>{propertyLabel(unit, language)} №{unit.number}</strong></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button></header>
      <figure aria-live="polite"><PlanImage key={plan.src} plan={plan} alt={`${planLabel(plan, language)} · №${unit.number}`} /><figcaption>{unit.rooms ? `${unit.rooms} · ` : ''}{number(unit.area, language)} м² · {unit.floor} {t.floorShort}</figcaption></figure>
      {unit.plans.length > 1 ? <div className="apartment-catalog-lightbox__controls"><button type="button" onClick={() => setIndex((current) => (current - 1 + unit.plans.length) % unit.plans.length)} aria-label={t.previousPlan}>←</button><span>{index + 1} / {unit.plans.length}</span><button type="button" onClick={() => setIndex((current) => (current + 1) % unit.plans.length)} aria-label={t.nextPlan}>→</button></div> : null}
    </div>
  </div>;
}

function UnitDetail({ unit, language, phaseLabel, buildingLabel, onPlan, onLead }: { unit?: CatalogUnit; language: CatalogLanguage; phaseLabel: string; buildingLabel: string; onPlan: () => void; onLead: () => void }) {
  const t = ui[language];
  if (!unit) return <aside id="apartment-catalog-detail" className="apartment-catalog-detail" aria-live="polite"><div className="apartment-catalog-detail__empty">{t.empty}</div></aside>;
  return <aside id="apartment-catalog-detail" className="apartment-catalog-detail" aria-label={t.details} aria-live="polite" data-lenis-prevent>
    <header><div><small>{t.selected}</small><strong>{propertyLabel(unit, language)} №{unit.number}</strong></div><span data-status={unit.status}>{t.statuses[unit.status]}</span></header>
    <PlanPreview unit={unit} language={language} onOpen={onPlan} compact />
    <h3>{unit.rooms ? `${unit.rooms} · ` : ''}{number(unit.area, language)} м²</h3>
    <dl>
      <div><dt>{t.floor}</dt><dd>{unit.floor}{unit.maxFloor ? ` / ${unit.maxFloor}` : ''}</dd></div>
      {unit.entrance ? <div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div> : null}
      {unit.building ? <div><dt>{buildingLabel}</dt><dd>{unit.building}</dd></div> : null}
      {unit.queueKey ? <div><dt>{t.queue}</dt><dd>{unitQueueLabel(unit, language)}</dd></div> : unit.phase ? <div><dt>{phaseLabel}</dt><dd>{unit.phase}</dd></div> : null}
      <div><dt>{t.status}</dt><dd>{t.statuses[unit.status]}</dd></div>
    </dl>
    <div className="apartment-catalog-detail__price"><span>{t.price}</span><strong>{money(unit.price, unit.currency, language, t.priceOnRequest)}</strong>{unit.pricePerM2 ? <small>{money(unit.pricePerM2, unit.currency, language, t.priceOnRequest)} {t.perM2}</small> : null}{unit.regularPrice && unit.price && unit.regularPrice > unit.price ? <del>{money(unit.regularPrice, unit.currency, language, t.priceOnRequest)}</del> : null}</div>
    <button className="apartment-catalog__primary" type="button" onClick={onLead}>{t.choose}<span aria-hidden="true">↗</span></button>
  </aside>;
}

function usePanState(scrollRef: RefObject<HTMLDivElement | null>, dependency: string) {
  const [state, setState] = useState({ overflow: false, canLeft: false, canRight: false });
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const update = () => {
      const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const next = { overflow: max > 2, canLeft: scroll.scrollLeft > 2, canRight: scroll.scrollLeft < max - 2 };
      setState((current) => current.overflow === next.overflow && current.canLeft === next.canLeft && current.canRight === next.canRight ? current : next);
    };
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(scroll);
    scroll.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      scroll.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [dependency, scrollRef]);
  return state;
}

function ChessGroup({ label, units, language, selectedId, detailId, onSelect }: { label: string; units: CatalogUnit[]; language: CatalogLanguage; selectedId?: string; detailId: string; onSelect: (unit: CatalogUnit) => void }) {
  const t = ui[language];
  const hintId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const floors = useMemo(() => [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a), [units]);
  const rows = useMemo(() => floors.map((floor) => ({ floor, units: units.filter((unit) => unit.floor === floor).sort((a, b) => natural(a.number, b.number)) })), [floors, units]);
  const contentWidth = 72 + Math.max(1, ...rows.map((row) => row.units.length)) * 142;
  const pan = usePanState(scrollRef, `${label}:${units.map((unit) => unit.id).join(',')}`);
  const behavior = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' as const : 'smooth' as const;
  const move = (direction: -1 | 1) => scrollRef.current?.scrollBy({ left: direction * Math.max(240, (scrollRef.current?.clientWidth ?? 300) * .72), behavior: behavior() });
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); scroll.scrollTo({ left: event.key === 'Home' ? 0 : scroll.scrollWidth, behavior: behavior() }); }
  };
  return <section className="apartment-catalog-chess__group">
    <header><div><small>{t.chess}</small><h3>{label}</h3></div><div role="group" aria-label={t.scrollHint}><button type="button" disabled={!pan.canLeft} onClick={() => move(-1)} aria-label={t.scrollLeft}>←</button><button type="button" disabled={!pan.canRight} onClick={() => move(1)} aria-label={t.scrollRight}>→</button></div></header>
    <div ref={scrollRef} className="apartment-catalog-chess__scroll" tabIndex={0} aria-label={`${t.chess}: ${label}`} aria-describedby={hintId} onKeyDown={onKey} data-lenis-prevent>
      <p id={hintId} className="apartment-catalog__sr-only">{t.scrollHint}</p>
      <div className="apartment-catalog-chess__table" style={{ minWidth: `${contentWidth}px` }}>
        {rows.map((row) => <div className="apartment-catalog-chess__row" key={row.floor}><div className="apartment-catalog-chess__floor"><strong>{row.floor}</strong><span>{t.floor}</span></div><div className="apartment-catalog-chess__units">{row.units.map((unit) => <button type="button" key={unit.id} data-status={unit.status} className={selectedId === unit.id ? 'is-selected' : ''} aria-pressed={selectedId === unit.id} aria-controls={detailId} onClick={() => onSelect(unit)}><small>№{unit.number}</small><strong>{unit.rooms ? `${unit.rooms} · ` : ''}{number(unit.area, language)} м²</strong><span>{money(unit.price, unit.currency, language, t.priceOnRequest)}</span><span className="apartment-catalog__sr-only">{t.status}: {t.statuses[unit.status]}</span></button>)}</div></div>)}
      </div>
    </div>
  </section>;
}

export function ApartmentCatalog({ project, units: sourceUnits, capabilities, presentation, initialLanguage = 'ru', refreshedAt, dataSource = 'embedded', visualFlow, visualFlowAvailable = false }: ApartmentCatalogProps) {
  const units = useMemo(() => capabilities.pricesVisible
    ? sourceUnits
    : sourceUnits.map((unit) => ({ ...unit, price: undefined, regularPrice: undefined, pricePerM2: undefined })), [capabilities.pricesVisible, sourceUnits]);
  const detailId = useId();
  const [language, setLanguage] = useCatalogueLanguage(initialLanguage, presentation.storageKey ?? `${project.slug}-catalog-language`);
  const t = ui[language];
  const [mode, setMode] = useState<CatalogMode>('cards');
  const [rooms, setRooms] = useState<FilterValue>('all');
  const [queue, setQueue] = useState<FilterValue>('all');
  const [building, setBuilding] = useState<FilterValue>('all');
  const [phase, setPhase] = useState<FilterValue>('all');
  const [entrance, setEntrance] = useState<FilterValue>('all');
  const [floor, setFloor] = useState<FilterValue>('all');
  const [status, setStatus] = useState<FilterValue>(presentation.availableOnlyDefault ? 'available' : 'all');
  const [areaFrom, setAreaFrom] = useState('');
  const [areaTo, setAreaTo] = useState('');
  const [sort, setSort] = useState<CatalogSort>(presentation.defaultSort ?? 'status');
  const [visibleCount, setVisibleCount] = useState(presentation.cardPageSize ?? 12);
  const [selectedId, setSelectedId] = useState<string | undefined>(units[0]?.id);
  const [lightbox, setLightbox] = useState<{ unit: CatalogUnit; index: number }>();
  const [leadUnit, setLeadUnit] = useState<CatalogUnit | null | undefined>();

  const roomOptions = useMemo(() => [...new Set(units.map((unit) => unit.rooms).filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b), [units]);
  const buildingOptions = useMemo(() => uniqueStrings(units.map((unit) => unit.building)), [units]);
  const phaseOptions = useMemo(() => uniqueStrings(units.map((unit) => unit.phase)), [units]);
  const queueOptions = useMemo(() => {
    const options = [...(project.queues ?? [])]
      .filter((item, index, values) => item.key && values.findIndex((candidate) => candidate.key === item.key) === index)
      .sort((left, right) => left.order - right.order);
    return options.length >= 2 ? options : [];
  }, [project.queues]);
  const entranceOptions = useMemo(() => uniqueStrings(units.map((unit) => unit.entrance)), [units]);
  const floorOptions = useMemo(() => [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a), [units]);
  const statusOptions = useMemo(() => [...new Set(units.map((unit) => unit.status))].sort((a, b) => statusRank(a) - statusRank(b)), [units]);
  const hasPrices = capabilities.pricesVisible && units.some((unit) => typeof unit.price === 'number' && unit.price > 0);

  const updateQuery = (changes: Record<string, string | undefined>) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    Object.entries(changes).forEach(([key, value]) => {
      if (!value) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    });
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeParam = params.get('mode');
    const legacyMode = modeParam === 'chess-plus' || modeParam === 'matrix-plus';
    const selected = chooseByIdentity(
      units,
      params.get('unitKey'),
      params.get('unit'),
      params.get('unitEntrance') ?? params.get('entrance'),
      params.get('unitFloor') ?? params.get('floor'),
    );
    const valid = (value: string | null, options: Array<string | number>) => value && options.some((option) => String(option) === value) ? value : 'all';
    const frame = window.requestAnimationFrame(() => {
      if (modeParam === 'chess' || legacyMode) setMode('chess');
      setRooms(valid(params.get('rooms'), roomOptions));
      setQueue(valid(params.get('queue'), queueOptions.map((item) => item.key)));
      setBuilding(valid(params.get('building'), buildingOptions));
      setPhase(valid(params.get('phase'), phaseOptions));
      setEntrance(valid(params.get('entrance'), entranceOptions));
      setFloor(valid(params.get('floor'), floorOptions));
      setStatus(params.has('status') ? valid(params.get('status'), statusOptions) : presentation.availableOnlyDefault ? 'available' : 'all');
      setAreaFrom(params.get('areaFrom') ?? '');
      setAreaTo(params.get('areaTo') ?? '');
      const sortParam = params.get('sort') as CatalogSort | null;
      if (sortParam && ['status', 'price-asc', 'price-desc', 'area-asc', 'area-desc', 'floor-asc', 'floor-desc'].includes(sortParam)) setSort(sortParam);
      if (selected) setSelectedId(selected.id);
    });
    if (legacyMode) {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'chess');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return () => window.cancelAnimationFrame(frame);
  }, [buildingOptions, entranceOptions, floorOptions, phaseOptions, presentation.availableOnlyDefault, queueOptions, roomOptions, statusOptions, units]);

  const filtered = useMemo(() => {
    const min = Number(areaFrom) || 0;
    const max = Number(areaTo) || Infinity;
    const result = units.filter((unit) => (
      (rooms === 'all' || unit.rooms === Number(rooms))
      && (queue === 'all' || unit.queueKey === queue)
      && (building === 'all' || unit.building === building)
      && (phase === 'all' || unit.phase === phase)
      && (entrance === 'all' || unit.entrance === entrance)
      && (floor === 'all' || unit.floor === Number(floor))
      && (status === 'all' || unit.status === status)
      && unit.area >= min
      && unit.area <= max
    ));
    return [...result].sort((left, right) => {
      const byNumber = natural(left.number, right.number);
      if (sort === 'price-asc') return (left.price ?? Infinity) - (right.price ?? Infinity) || byNumber;
      if (sort === 'price-desc') return (right.price ?? -Infinity) - (left.price ?? -Infinity) || byNumber;
      if (sort === 'area-asc') return left.area - right.area || byNumber;
      if (sort === 'area-desc') return right.area - left.area || byNumber;
      if (sort === 'floor-asc') return left.floor - right.floor || byNumber;
      if (sort === 'floor-desc') return right.floor - left.floor || byNumber;
      return statusRank(left.status) - statusRank(right.status) || right.floor - left.floor || byNumber;
    });
  }, [areaFrom, areaTo, building, entrance, floor, phase, queue, rooms, sort, status, units]);

  const selected = filtered.find((unit) => unit.id === selectedId) ?? filtered[0];
  const pageSize = presentation.cardPageSize ?? 12;
  const visibleUnits = filtered.slice(0, visibleCount);
  const chessGroups = useMemo(() => {
    const groups = new Map<string, CatalogUnit[]>();
    filtered.forEach((unit) => {
      const labels = [queueOptions.length && unit.queueKey ? unitQueueLabel(unit, language) : undefined, capabilities.phases ? unit.phase : undefined, capabilities.buildings ? unit.building : undefined, capabilities.entrances ? unit.entrance : undefined].filter(Boolean);
      const key = labels.length ? labels.join(' · ') : project.name;
      groups.set(key, [...(groups.get(key) ?? []), unit]);
    });
    return [...groups.entries()];
  }, [capabilities.buildings, capabilities.entrances, capabilities.phases, filtered, language, project.name, queueOptions.length]);

  useEffect(() => { if (leadUnit) rememberLiveCatalogUnit({ sourceKey: leadUnit.unitKey }, project.slug); }, [leadUnit, project.slug]);

  const setFilter = (key: 'rooms' | 'building' | 'phase' | 'entrance' | 'floor' | 'status', value: FilterValue) => {
    ({ rooms: setRooms, building: setBuilding, phase: setPhase, entrance: setEntrance, floor: setFloor, status: setStatus }[key])(value);
    setVisibleCount(pageSize);
    updateQuery({ [key]: value === 'all' ? undefined : value, unitKey: undefined, unit: undefined, unitEntrance: undefined, unitFloor: undefined });
  };
  const setQueueFilter = (value: FilterValue) => {
    setQueue(value);
    setVisibleCount(pageSize);
    updateQuery({ queue: value === 'all' ? undefined : value, unitKey: undefined, unit: undefined, unitEntrance: undefined, unitFloor: undefined });
  };
  const reset = () => {
    const defaultSort = presentation.defaultSort ?? 'status';
    setRooms('all'); setQueue('all'); setBuilding('all'); setPhase('all'); setEntrance('all'); setFloor('all'); setStatus(presentation.availableOnlyDefault ? 'available' : 'all'); setAreaFrom(''); setAreaTo(''); setSort(defaultSort); setVisibleCount(pageSize);
    updateQuery({ rooms: undefined, queue: undefined, building: undefined, phase: undefined, entrance: undefined, floor: undefined, status: presentation.availableOnlyDefault ? 'available' : undefined, areaFrom: undefined, areaTo: undefined, sort: defaultSort === 'status' ? undefined : defaultSort, unitKey: undefined, unit: undefined, unitEntrance: undefined, unitFloor: undefined });
  };
  const chooseUnit = (unit: CatalogUnit, scrollOnMobile = false) => {
    setSelectedId(unit.id);
    updateQuery({ unitKey: unit.unitKey ?? unit.id, unit: unit.number, unitEntrance: unit.entrance, unitFloor: String(unit.floor) });
    if (scrollOnMobile && window.matchMedia('(max-width: 767px)').matches) window.setTimeout(() => document.getElementById(detailId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const openPlan = (unit: CatalogUnit, index = 0) => { chooseUnit(unit); setLightbox({ unit, index }); };
  const title = localized(presentation.title, language, project.name);
  const accent = localized(presentation.accent, language);
  const phaseLabel = localized(presentation.phaseLabel, language, t.phase);
  const allPhasesLabel = localized(presentation.allPhasesLabel, language, t.allPhases);
  const buildingLabel = localized(presentation.buildingLabel, language, t.building);
  const allBuildingsLabel = localized(presentation.allBuildingsLabel, language, t.allBuildings);
  const renderedVisualFlow = capabilities.visualFlow && visualFlowAvailable
    ? typeof visualFlow === 'function'
      ? visualFlow(language, {
        openLead: (unitKey) => setLeadUnit(units.find((unit) => unit.unitKey && unit.unitKey === unitKey) ?? null),
      })
      : visualFlow
    : null;
  const sourceLabel = dataSource === 'live' ? t.sourceLive : dataSource === 'cached' ? t.sourceCached : t.sourceEmbedded;
  const availability = project.totalCount && project.totalCount !== project.availableCount ? `${project.availableCount} ${t.of} ${project.totalCount}` : String(project.availableCount);
  const refreshedLabel = dateLabel(refreshedAt, language);

  return <main className="apartment-catalog" lang={language} style={presentation.theme}>
    <a className="apartment-catalog__skip" href="#catalog">{t.skip}</a>
    <header className="apartment-catalog-header">
      <a className="apartment-catalog-header__brand" href={presentation.backHref(language)}>{presentation.brand}<small>{presentation.brandSubtitle}</small></a>
      <a className="apartment-catalog-header__back" href={presentation.backHref(language)}>← {localized(presentation.backLabel, language, project.name)}</a>
      <div className="apartment-catalog-header__actions">
        {presentation.phone ? <a href="tel:+998781137712">{presentation.phone}</a> : null}
        <div role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} aria-pressed={language === item} className={language === item ? 'is-active' : ''} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
        <button type="button" onClick={() => setLeadUnit(null)}>{t.request}</button>
      </div>
    </header>

    <section className="apartment-catalog-hero">
      <div><p>{localized(presentation.eyebrow, language, project.className ?? project.name)}</p><h1>{title}{accent ? <> <em>{accent}</em></> : null}</h1><span>{localized(presentation.lead, language, project.address ?? '')}</span></div>
      <aside><strong>{availability}</strong><span>{t.available}</span><small>{sourceLabel}{refreshedLabel ? <time dateTime={refreshedAt}>{refreshedLabel}</time> : null}</small></aside>
    </section>

    {capabilities.visualFlow && visualFlowAvailable && renderedVisualFlow ? <section className="apartment-catalog__visual" aria-label={t.visual}><header><p>{t.visual}</p><span>{t.visualHint}</span></header>{renderedVisualFlow}</section> : null}

    <section id="catalog" className="apartment-catalog-content">
      <header className="apartment-catalog-content__head"><div><p>{t.catalog}</p><h2>{project.name}</h2></div><div className="apartment-catalog-modes" role="radiogroup" aria-label={t.view}>{(['cards', 'chess'] as CatalogMode[]).map((item) => <button type="button" role="radio" aria-checked={mode === item} className={mode === item ? 'is-active' : ''} key={item} onClick={() => { setMode(item); setVisibleCount(pageSize); updateQuery({ mode: item === 'cards' ? undefined : item }); }}>{t[item]}</button>)}</div></header>

      <div className="apartment-catalog-filters" aria-label={t.filters}>
        <div className="apartment-catalog-filters__grid">
          {queueOptions.length ? <label><span>{t.queue}</span><select value={queue} onChange={(event) => setQueueFilter(event.target.value)}><option value="all">{t.allQueues}</option>{queueOptions.map((item) => <option key={item.key} value={item.key} disabled={item.availableCount === 0}>{queueLabel(item, language)} · {item.availableCount}</option>)}</select></label> : null}
          {capabilities.phases && phaseOptions.length > 1 ? <label><span>{phaseLabel}</span><select value={phase} onChange={(event) => setFilter('phase', event.target.value)}><option value="all">{allPhasesLabel}</option>{phaseOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
          {capabilities.buildings && buildingOptions.length > 1 ? <label><span>{buildingLabel}</span><select value={building} onChange={(event) => setFilter('building', event.target.value)}><option value="all">{allBuildingsLabel}</option>{buildingOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
          {capabilities.entrances && entranceOptions.length > 1 ? <label><span>{t.entrance}</span><select value={entrance} onChange={(event) => setFilter('entrance', event.target.value)}><option value="all">{t.allEntrances}</option>{entranceOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
          <label><span>{t.rooms}</span><select value={rooms} onChange={(event) => setFilter('rooms', event.target.value)}><option value="all">{t.allRooms}</option>{roomOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label><span>{t.floor}</span><select value={floor} onChange={(event) => setFilter('floor', event.target.value)}><option value="all">{t.allFloors}</option>{floorOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          {statusOptions.length > 1 ? <label><span>{t.status}</span><select value={status} onChange={(event) => setFilter('status', event.target.value)}><option value="all">{t.allStatuses}</option>{statusOptions.map((value) => <option key={value} value={value}>{t.statuses[value]}</option>)}</select></label> : null}
          <label><span>{t.areaFrom}</span><input type="number" min="0" inputMode="decimal" value={areaFrom} onChange={(event) => { setAreaFrom(event.target.value); setVisibleCount(pageSize); updateQuery({ areaFrom: event.target.value || undefined }); }} /></label>
          <label><span>{t.areaTo}</span><input type="number" min="0" inputMode="decimal" value={areaTo} onChange={(event) => { setAreaTo(event.target.value); setVisibleCount(pageSize); updateQuery({ areaTo: event.target.value || undefined }); }} /></label>
        </div>
        <button className="apartment-catalog-filters__reset" type="button" onClick={reset}>{t.reset}<span aria-hidden="true">↺</span></button>
      </div>

      <div className="apartment-catalog-resultsbar"><div><strong>{filtered.length}</strong><span>{t.found} · {t.offers}</span></div><label><span>{t.sort}</span><select value={sort} onChange={(event) => { const next = event.target.value as CatalogSort; setSort(next); setVisibleCount(pageSize); updateQuery({ sort: next === (presentation.defaultSort ?? 'status') ? undefined : next }); }}>{(Object.keys(t.sorts) as CatalogSort[]).filter((item) => hasPrices || !item.startsWith('price')).map((item) => <option key={item} value={item}>{t.sorts[item]}</option>)}</select></label></div>
      {presentation.disclaimer ? <p className="apartment-catalog-disclaimer">{localized(presentation.disclaimer, language)}</p> : null}

      {!filtered.length ? <div className="apartment-catalog-empty"><h3>{t.empty}</h3><button type="button" onClick={reset}>{t.clearFilters}</button></div> : <div className="apartment-catalog-layout">
        <div className="apartment-catalog-layout__main">
          {mode === 'cards' ? <><div className="apartment-catalog-cards">{visibleUnits.map((unit) => {
            const plan = unitPlan(unit);
            return <article key={unit.id} className={selected?.id === unit.id ? 'is-selected' : ''}>
              <button type="button" className="apartment-catalog-card__select" aria-pressed={selected?.id === unit.id} aria-controls={detailId} onClick={() => chooseUnit(unit)}>
                <span className="apartment-catalog-card__top"><small>{propertyLabel(unit, language)} №{unit.number}</small><i data-status={unit.status}>{t.statuses[unit.status]}</i></span>
                <figure>{plan ? <PlanImage plan={plan} preview alt={`${planLabel(plan, language)} · №${unit.number}`} loading="lazy" /> : <span className="apartment-catalog-card__no-plan" aria-label={t.noPlan}>⌑</span>}<figcaption>{plan ? planLabel(plan, language) : t.noPlan}</figcaption></figure>
                <span className="apartment-catalog-card__title"><strong>{unit.rooms ? `${unit.rooms} · ` : ''}{number(unit.area, language)} м²</strong><small>{unit.floor}{unit.maxFloor ? ` / ${unit.maxFloor}` : ''} {t.floorShort}{unit.entrance ? ` · ${t.entrance} ${unit.entrance}` : ''}</small></span>
                <span className="apartment-catalog-card__price"><small>{t.price}</small><strong>{money(unit.price, unit.currency, language, t.priceOnRequest)}</strong></span>
              </button>
              <div className="apartment-catalog-card__actions">{unit.plans.length ? <button type="button" onClick={() => openPlan(unit)}>{t.enlarge}<span aria-hidden="true">↗</span></button> : <span /> }<button type="button" onClick={() => { chooseUnit(unit); setLeadUnit(unit); }}>{t.choose}<span aria-hidden="true">↗</span></button></div>
            </article>;
          })}</div>{visibleUnits.length < filtered.length ? <button className="apartment-catalog-load-more" type="button" onClick={() => setVisibleCount((current) => Math.min(filtered.length, current + pageSize))}>{t.showMore}<span>{t.showing} {visibleUnits.length} / {filtered.length}</span></button> : null}</> : <div className="apartment-catalog-chess">{chessGroups.map(([label, groupUnits]) => <ChessGroup key={label} label={label} units={groupUnits} language={language} selectedId={selected?.id} detailId={detailId} onSelect={(unit) => chooseUnit(unit, true)} />)}</div>}
        </div>
        <div id={detailId} className="apartment-catalog-layout__detail"><UnitDetail unit={selected} language={language} phaseLabel={phaseLabel} buildingLabel={buildingLabel} onPlan={() => { if (selected) openPlan(selected); }} onLead={() => setLeadUnit(selected ?? null)} /></div>
      </div>}
    </section>

    {lightbox ? <PlanLightbox unit={lightbox.unit} language={language} initialIndex={lightbox.index} onClose={() => setLightbox(undefined)} /> : null}
    {leadUnit !== undefined ? <LeadModal open language={language} context={[project.name, leadUnit ? `${propertyLabel(leadUnit, language)} №${leadUnit.number}` : t.catalog, leadUnit?.queueKey ? `${t.queue} ${unitQueueLabel(leadUnit, language)}` : leadUnit?.phase ? `${phaseLabel} ${leadUnit.phase}` : undefined, leadUnit?.building ? `${buildingLabel} ${leadUnit.building}` : undefined, leadUnit?.entrance ? `${t.entrance} ${leadUnit.entrance}` : undefined, leadUnit ? `${t.floor} ${leadUnit.floor}` : undefined].filter(Boolean).join(' · ')} onClose={() => setLeadUnit(undefined)} projectName={project.name} hideBrand tagline={leadUnit ? `${leadUnit.rooms ? `${leadUnit.rooms} · ` : ''}${number(leadUnit.area, language)} м²` : localized(presentation.lead, language)} facts={leadUnit ? [project.className ?? project.name, leadUnit.queueKey ? `${t.queue} ${unitQueueLabel(leadUnit, language)}` : leadUnit.phase ? `${phaseLabel} ${leadUnit.phase}` : `${t.floor} ${leadUnit.floor}`, money(leadUnit.price, leadUnit.currency, language, t.priceOnRequest)] : undefined} submitUrl={`${appBasePath}/v1/leads`} projectSlug={project.slug} unitKey={leadUnit?.unitKey} privacyUrl={presentation.privacyHref(language)} requireConsent /> : null}
  </main>;
}
