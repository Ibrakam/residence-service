'use client';

/* eslint-disable @next/next/no-img-element */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import snapshotJson from '@/data/sun-client.json';
import { LeadModal } from '@/app/lead-modal';
import { rememberSunUnit, sunLeadContext, sunLeadSubmitUrl, type SunUnit } from '../sun-lead';
import {
  formatSunNumber,
  formatSunPrice,
  lockSunBody,
  sunAsset,
  sunLanguages,
  sunPath,
  type SunLanguage as Language,
  useSunLanguage,
  useSunMobile,
} from '../sun-ui';

type Mode = 'cards' | 'chess';
type Sort = 'recommended' | 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'roomsAsc' | 'roomsDesc' | 'floorAsc' | 'floorDesc' | 'ppmAsc' | 'ppmDesc';
type Filters = { rooms: string[]; blocks: string[]; floorFrom: string; floorTo: string; areaFrom: string; areaTo: string; priceFrom: string; priceTo: string };
type Selection = { unit: SunUnit; opener: HTMLButtonElement };
type PlanSelection = Selection & { index: number };
type LeadRequest = { surface: string; unit: SunUnit | null; opener: HTMLElement | null };
type RawGroup = { id?: string | number; block?: string; blockName?: string; name?: string; maxFloor?: number };
type RawMatrixRow = { id?: string; groupId?: string | number; block?: string; blockName?: string; entrance?: number; floor: number; unitIds?: Array<number | string> };
type MatrixRow = { id: string; block: string; entrance: number; floor: number; unitIds: string[] };
type Snapshot = { capturedAt: string; groups?: RawGroup[]; matrixRows?: RawMatrixRow[]; units: SunUnit[] };

const snapshot = snapshotJson as Snapshot;
const modes: readonly Mode[] = ['cards', 'chess'];
const sorts: readonly Sort[] = ['recommended', 'priceAsc', 'priceDesc', 'areaAsc', 'areaDesc', 'roomsAsc', 'roomsDesc', 'floorAsc', 'floorDesc', 'ppmAsc', 'ppmDesc'];
const defaultFilters: Filters = { rooms: [], blocks: [], floorFrom: '', floorTo: '', areaFrom: '', areaTo: '', priceFrom: '', priceTo: '' };

function blockOf(unit: SunUnit) {
  return String(unit.block ?? unit.blockName ?? '');
}

function normalizedBlock(value: string) {
  const key = value.trim().toUpperCase();
  if (key === 'G' || key === 'Г') return 'Г';
  if (key === 'D' || key === 'Д') return 'Д';
  if (key === 'V' || key === 'В') return 'В';
  if (key === 'B' || key === 'Б') return 'Б';
  return 'A';
}

function priceOf(unit: SunUnit) { return Number(unit.effectivePrice ?? unit.price); }
function ppmOf(unit: SunUnit) { return Number(unit.pricePerM2 || priceOf(unit) / Number(unit.area)); }
function unitKeyOf(unit: SunUnit) { return String(unit.unitKey ?? unit.id); }

function normalizeRows(data: Snapshot): MatrixRow[] {
  const groupById = new Map<string, string>();
  for (const group of data.groups ?? []) {
    const id = String(group.id ?? '');
    groupById.set(id, normalizedBlock(String(group.block ?? group.blockName ?? group.name ?? '')));
  }
  const rows = (data.matrixRows ?? []).map((row) => {
    const ids = (row.unitIds ?? []).map(String).filter(Boolean);
    const inferredUnit = ids.length ? data.units.find((unit) => unitKeyOf(unit) === ids[0]) : undefined;
    const rawBlock = row.block ?? row.blockName ?? groupById.get(String(row.groupId ?? '')) ?? (inferredUnit ? blockOf(inferredUnit) : '');
    const block = normalizedBlock(String(rawBlock));
    return { id: row.id ?? `${block}-${row.entrance ?? 1}-${row.floor}`, block, entrance: Number(row.entrance ?? 1), floor: Number(row.floor), unitIds: ids };
  });
  if (rows.length === 47) return rows;
  const topology = [['A', 11], ['Г', 13], ['Д', 14], ['В', 13]] as const;
  return topology.flatMap(([block, maxFloor]) => Array.from({ length: maxFloor - 1 }, (_, index) => {
    const floor = maxFloor - index;
    return {
      id: `${block}-1-${floor}`, block, entrance: 1, floor,
      unitIds: data.units.filter((unit) => normalizedBlock(blockOf(unit)) === block && Number(unit.floor) === floor).map(unitKeyOf),
    };
  }));
}

const copy = {
  ru: {
    skip: 'К результатам каталога', back: 'О проекте', nav: 'Навигация каталога SUN', language: 'Язык', menu: 'Меню', close: 'Закрыть', consult: 'Получить консультацию', call: 'Позвонить',
    eyebrow: 'СОЛНЕЧНЫЙ ИНСТРУМЕНТ · ЗАФИКСИРОВАННЫЙ СРЕЗ', title: '51 квартира. Четыре корпуса.', lead: 'Актуальные цены в UZS и 51 доступная позиция из официального публичного среза. Корпус Б в текущем каталоге отсутствует.', heroLead: 'Помочь с выбором',
    facts: [['51', 'доступная'], ['1–3', 'комнаты'], ['34,61–83,90 м²', 'площадь'], ['867,7 млн–1,966 млрд UZS', 'цена']] as const,
    snapshot: 'Срез', liveWarning: 'Это snapshot, а не обещание наличия в момент обращения.',
    modes: { cards: 'Карточки', chess: 'Шахматка' }, modeLabel: 'Режим каталога', filters: 'Фильтры', reset: 'Сбросить', all: 'Все', selected: 'выбрано', rooms: 'Комнаты', blocks: 'Корпуса', floorRange: 'Этаж', areaRange: 'Площадь, м²', priceRange: 'Цена, UZS', from: 'от', to: 'до', results: 'найдено', filtersAnnouncement: 'Результатов после фильтрации',
    sort: 'Сортировка', sorts: { recommended: 'По умолчанию / рекомендуемые', priceAsc: 'Цена: сначала ниже', priceDesc: 'Цена: сначала выше', areaAsc: 'Площадь: сначала меньше', areaDesc: 'Площадь: сначала больше', roomsAsc: 'Комнаты: по возрастанию', roomsDesc: 'Комнаты: по убыванию', floorAsc: 'Этаж: сначала ниже', floorDesc: 'Этаж: сначала выше', ppmAsc: 'Цена за м²: сначала ниже', ppmDesc: 'Цена за м²: сначала выше' },
    unit: 'Квартира №', roomsShort: 'комн.', area: 'Площадь', floor: 'Этаж', entrance: 'Подъезд', block: 'Корпус', available: 'Доступна', price: 'Текущая цена', ppm: 'Цена за м²', openPlan: 'Открыть два официальных плана', ask: 'Оставить заявку', showMore: 'Показать ещё', showing: 'Показано', of: 'из',
    emptyTitle: 'По этим параметрам квартир нет.', emptyText: 'Сбросьте фильтры или оставьте заявку — менеджер сверит текущую доступность.', emptyLead: 'Запросить подборку',
    matrixTitle: '47 реальных строк · один подъезд в каждом корпусе.', matrixText: 'Строки 2–11 / 2–13 / 2–14 / 2–13 сохранены даже без доступной квартиры. Фильтры приглушают позиции, не перестраивая физическую топологию.', matched: 'совпадений', row: 'Этаж', noUnits: 'Нет доступной позиции в срезе', scrollLeft: 'Сдвинуть шахматку влево', scrollRight: 'Сдвинуть шахматку вправо', matrixHelp: 'Свайп, трекпад, кнопки, стрелки, Home и End.', openUnit: 'Открыть квартиру',
    detail: 'Детали квартиры', closeDetail: 'Закрыть детали', plans: 'Официальные планы', planOne: 'Официальный план · поверхность 1', planTwo: 'Официальный план · поверхность 2', planOneText: 'Первая опубликованная поверхность плана.', planTwoText: 'Вторая опубликованная поверхность плана.', characteristics: 'Характеристики', matrixLead: 'Уточнить эту квартиру',
    planDialog: 'Два официальных плана квартиры', closePlan: 'Закрыть планы', previousPlan: 'Предыдущий план', nextPlan: 'Следующий план', swipeHint: 'Переключайте стрелками или свайпом.', planLead: 'Уточнить квартиру по плану',
    noCampaign: 'Активной snapshot-акции нет', priceContract: 'regularPrice совпадает с effectivePrice; скидка и таймер не применяются.',
    footerTitle: 'Нужен точный ответ по конкретной квартире?', footerText: 'Менеджер сверит выбранную позицию с зафиксированным источником и текущей доступностью. Заявка не является бронированием.', privacy: 'Обработка персональных данных', top: 'Наверх',
    formTagline: 'День начинается дома.', formFacts: ['51 доступная квартира', '4 корпуса в каталоге', 'Текущие цены UZS'] as const,
  },
  uz: {
    skip: 'Katalog natijalariga o‘tish', back: 'Loyiha haqida', nav: 'SUN katalogi navigatsiyasi', language: 'Til', menu: 'Menyu', close: 'Yopish', consult: 'Maslahat olish', call: 'Qo‘ng‘iroq qilish',
    eyebrow: 'QUYOSHLI VOSITA · QAYD ETILGAN KESIM', title: '51 xonadon. To‘rt bino.', lead: 'Rasmiy ommaviy kesimdagi dolzarb UZS narxlari va 51 ta mavjud pozitsiya. B binosi joriy katalogda yo‘q.', heroLead: 'Tanlashda yordam olish',
    facts: [['51', 'mavjud'], ['1–3', 'xona'], ['34,61–83,90 m²', 'maydon'], ['867,7 mln–1,966 mlrd UZS', 'narx']] as const,
    snapshot: 'Kesim', liveWarning: 'Bu snapshot, murojaat vaqtida mavjudlik va’dasi emas.',
    modes: { cards: 'Kartochkalar', chess: 'Shaxmatka' }, modeLabel: 'Katalog rejimi', filters: 'Filtrlar', reset: 'Tozalash', all: 'Barchasi', selected: 'tanlandi', rooms: 'Xonalar', blocks: 'Binolar', floorRange: 'Qavat', areaRange: 'Maydon, m²', priceRange: 'Narx, UZS', from: 'dan', to: 'gacha', results: 'topildi', filtersAnnouncement: 'Filtrlashdan keyingi natijalar',
    sort: 'Saralash', sorts: { recommended: 'Standart / tavsiya etilgan', priceAsc: 'Narx: arzonidan', priceDesc: 'Narx: qimmatidan', areaAsc: 'Maydon: kichigidan', areaDesc: 'Maydon: kattasidan', roomsAsc: 'Xonalar: o‘sish tartibida', roomsDesc: 'Xonalar: kamayish tartibida', floorAsc: 'Qavat: pastidan', floorDesc: 'Qavat: yuqorisidan', ppmAsc: 'm² narxi: arzonidan', ppmDesc: 'm² narxi: qimmatidan' },
    unit: 'Xonadon №', roomsShort: 'xona', area: 'Maydon', floor: 'Qavat', entrance: 'Kirish', block: 'Bino', available: 'Mavjud', price: 'Joriy narx', ppm: 'm² narxi', openPlan: 'Ikki rasmiy planni ochish', ask: 'Ariza qoldirish', showMore: 'Yana ko‘rsatish', showing: 'Ko‘rsatildi', of: '/',
    emptyTitle: 'Bu parametrlar bo‘yicha xonadon yo‘q.', emptyText: 'Filtrlarni tozalang yoki ariza qoldiring — menejer joriy mavjudlikni tekshiradi.', emptyLead: 'Variantlarni so‘rash',
    matrixTitle: '47 haqiqiy qator · har binoda bitta kirish.', matrixText: '2–11 / 2–13 / 2–14 / 2–13 qatorlari mavjud xonadon bo‘lmasa ham saqlanadi. Filtrlar fizik tuzilmani o‘zgartirmasdan pozitsiyalarni xiralashtiradi.', matched: 'mos', row: 'Qavat', noUnits: 'Kesimda mavjud pozitsiya yo‘q', scrollLeft: 'Shaxmatkani chapga siljitish', scrollRight: 'Shaxmatkani o‘ngga siljitish', matrixHelp: 'Svip, trekpad, tugmalar, strelkalar, Home va End.', openUnit: 'Xonadonni ochish',
    detail: 'Xonadon tafsilotlari', closeDetail: 'Tafsilotlarni yopish', plans: 'Rasmiy planlar', planOne: 'Rasmiy plan · 1-yuza', planTwo: 'Rasmiy plan · 2-yuza', planOneText: 'E’lon qilingan planning birinchi yuzasi.', planTwoText: 'E’lon qilingan planning ikkinchi yuzasi.', characteristics: 'Xususiyatlar', matrixLead: 'Bu xonadonni aniqlashtirish',
    planDialog: 'Xonadonning ikki rasmiy plani', closePlan: 'Planlarni yopish', previousPlan: 'Oldingi plan', nextPlan: 'Keyingi plan', swipeHint: 'Strelka yoki svip bilan almashtiring.', planLead: 'Plan bo‘yicha aniqlashtirish',
    noCampaign: 'Snapshotda faol aksiya yo‘q', priceContract: 'regularPrice effectivePrice bilan teng; chegirma va taymer qo‘llanmaydi.',
    footerTitle: 'Muayyan xonadon bo‘yicha aniq javob kerakmi?', footerText: 'Menejer tanlangan pozitsiyani qayd etilgan manba va joriy mavjudlik bilan solishtiradi. Ariza bron hisoblanmaydi.', privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga',
    formTagline: 'Kun uydan boshlanadi.', formFacts: ['51 ta mavjud xonadon', 'Katalogda 4 bino', 'Joriy UZS narxlari'] as const,
  },
  en: {
    skip: 'Skip to catalogue results', back: 'About the project', nav: 'SUN catalogue navigation', language: 'Language', menu: 'Menu', close: 'Close', consult: 'Request a consultation', call: 'Call',
    eyebrow: 'SUNLIT TOOL · FROZEN SNAPSHOT', title: '51 apartments. Four buildings.', lead: 'Current UZS prices and 51 available listings from the official public snapshot. Building B is absent from the current catalogue.', heroLead: 'Help me choose',
    facts: [['51', 'available'], ['1–3', 'rooms'], ['34.61–83.90 m²', 'area'], ['UZS 867.7m–1.966bn', 'price']] as const,
    snapshot: 'Snapshot', liveWarning: 'This is a snapshot, not a promise of availability when you enquire.',
    modes: { cards: 'Cards', chess: 'Matrix' }, modeLabel: 'Catalogue mode', filters: 'Filters', reset: 'Reset', all: 'All', selected: 'selected', rooms: 'Rooms', blocks: 'Buildings', floorRange: 'Floor', areaRange: 'Area, m²', priceRange: 'Price, UZS', from: 'from', to: 'to', results: 'found', filtersAnnouncement: 'Results after filtering',
    sort: 'Sort', sorts: { recommended: 'Default / recommended', priceAsc: 'Price: low to high', priceDesc: 'Price: high to low', areaAsc: 'Area: small to large', areaDesc: 'Area: large to small', roomsAsc: 'Rooms: low to high', roomsDesc: 'Rooms: high to low', floorAsc: 'Floor: low to high', floorDesc: 'Floor: high to low', ppmAsc: 'Price/m²: low to high', ppmDesc: 'Price/m²: high to low' },
    unit: 'Apartment no. ', roomsShort: 'rooms', area: 'Area', floor: 'Floor', entrance: 'Entrance', block: 'Building', available: 'Available', price: 'Current price', ppm: 'Price per m²', openPlan: 'Open both official plans', ask: 'Send a request', showMore: 'Show more', showing: 'Showing', of: 'of',
    emptyTitle: 'No apartments match these parameters.', emptyText: 'Reset the filters or send a request and a manager will check current availability.', emptyLead: 'Request a selection',
    matrixTitle: '47 real rows · one entrance in each building.', matrixText: 'Rows 2–11 / 2–13 / 2–14 / 2–13 remain stable even where no available apartment exists. Filters dim listings without rebuilding the physical topology.', matched: 'matches', row: 'Floor', noUnits: 'No available listing in the snapshot', scrollLeft: 'Move matrix left', scrollRight: 'Move matrix right', matrixHelp: 'Swipe, trackpad, buttons, arrows, Home and End.', openUnit: 'Open apartment',
    detail: 'Apartment details', closeDetail: 'Close details', plans: 'Official plans', planOne: 'Official plan · surface 1', planTwo: 'Official plan · surface 2', planOneText: 'The first published plan surface.', planTwoText: 'The second published plan surface.', characteristics: 'Characteristics', matrixLead: 'Ask about this apartment',
    planDialog: 'Two official apartment plans', closePlan: 'Close plans', previousPlan: 'Previous plan', nextPlan: 'Next plan', swipeHint: 'Use the arrows or swipe to switch.', planLead: 'Ask about this plan',
    noCampaign: 'No active campaign in the snapshot', priceContract: 'regularPrice equals effectivePrice; no discount or countdown applies.',
    footerTitle: 'Need a precise answer about one apartment?', footerText: 'A manager will check the selected listing against the frozen source and current availability. A request is not a reservation.', privacy: 'Personal data processing', top: 'Back to top',
    formTagline: 'The day begins at home.', formFacts: ['51 available apartments', '4 catalogue buildings', 'Current UZS prices'] as const,
  },
} as const;

function filterFromUrl(): Filters {
  const params = new URLSearchParams(window.location.search);
  return {
    rooms: (params.get('rooms') ?? '').split(',').filter(Boolean), blocks: (params.get('blocks') ?? '').split(',').filter(Boolean).map(normalizedBlock),
    floorFrom: params.get('floorFrom') ?? '', floorTo: params.get('floorTo') ?? '', areaFrom: params.get('areaFrom') ?? '', areaTo: params.get('areaTo') ?? '',
    priceFrom: params.get('priceFrom') ?? '', priceTo: params.get('priceTo') ?? '',
  };
}

function readMode(): Mode {
  const url = new URL(window.location.href); const value = url.searchParams.get('mode');
  if (value === 'chess-plus' || value === 'matrix-plus') {
    url.searchParams.set('mode', 'chess');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return 'chess';
  }
  return value === 'chess' ? 'chess' : 'cards';
}
function readSort(): Sort { const value = new URLSearchParams(window.location.search).get('sort') as Sort | null; return value && sorts.includes(value) ? value : 'recommended'; }
function readVisible() { const value = Number(new URLSearchParams(window.location.search).get('shown')); return Number.isFinite(value) && value >= 9 ? value : 9; }

function writeUrl(mode: Mode, sort: Sort, filters: Filters, visible: number, replace = false) {
  const url = new URL(window.location.href);
  const set = (key: string, value: string) => value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
  set('mode', mode === 'cards' ? '' : mode); set('sort', sort === 'recommended' ? '' : sort);
  set('rooms', filters.rooms.join(',')); set('blocks', filters.blocks.join(','));
  set('floorFrom', filters.floorFrom); set('floorTo', filters.floorTo); set('areaFrom', filters.areaFrom); set('areaTo', filters.areaTo); set('priceFrom', filters.priceFrom); set('priceTo', filters.priceTo);
  set('shown', visible > 9 ? String(visible) : '');
  window.history[replace ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function matchesNumeric(unit: SunUnit, filters: Filters) {
  const floorFrom = Number(filters.floorFrom); const floorTo = Number(filters.floorTo); const areaFrom = Number(filters.areaFrom); const areaTo = Number(filters.areaTo); const priceFrom = Number(filters.priceFrom); const priceTo = Number(filters.priceTo); const price = priceOf(unit);
  return (!filters.floorFrom || Number(unit.floor) >= floorFrom) && (!filters.floorTo || Number(unit.floor) <= floorTo)
    && (!filters.areaFrom || Number(unit.area) >= areaFrom) && (!filters.areaTo || Number(unit.area) <= areaTo)
    && (!filters.priceFrom || price >= priceFrom) && (!filters.priceTo || price <= priceTo);
}

function planSurfaces(unit: SunUnit) {
  return [
    { src: unit.primaryPlanPath, key: 'one' as const },
    { src: unit.secondPlanPath, key: 'two' as const },
  ].filter((surface) => Boolean(surface.src));
}

function useDialogFocus(open: boolean, dialogRef: React.RefObject<HTMLElement | null>, initialRef: React.RefObject<HTMLElement | null>, onClose: () => void, opener: HTMLElement, covered: boolean) {
  useEffect(() => {
    if (!open) return;
    const unlock = lockSunBody();
    const frame = window.requestAnimationFrame(() => initialRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (covered || document.querySelector('.lead-modal') || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); unlock(); window.requestAnimationFrame(() => opener.isConnected && opener.focus({ preventScroll: true })); };
  }, [covered, dialogRef, initialRef, onClose, open, opener]);
}

function UnitFacts({ unit, language }: { unit: SunUnit; language: Language }) {
  const t = copy[language];
  return <dl className="sunc-unit-facts"><div><dt>{t.block}</dt><dd>{normalizedBlock(blockOf(unit))}</dd></div><div><dt>{t.floor}</dt><dd>{unit.floor} / {unit.maxFloor}</dd></div><div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div><div><dt>{t.rooms}</dt><dd>{unit.rooms}</dd></div><div><dt>{t.area}</dt><dd>{formatSunNumber(Number(unit.area), language)} m²</dd></div><div><dt>{t.ppm}</dt><dd>{formatSunPrice(ppmOf(unit), language)}</dd></div></dl>;
}

function PlanDialog({ selection, language, covered, onClose, onChange, onLead }: { selection: PlanSelection; language: Language; covered: boolean; onClose: () => void; onChange: (index: number) => void; onLead: (unit: SunUnit, opener: HTMLButtonElement) => void }) {
  const dialogRef = useRef<HTMLElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const t = copy[language]; const surfaces = planSurfaces(selection.unit); const surfaceCount = surfaces.length; const index = Math.min(selection.index, surfaceCount - 1); const surface = surfaces[index];
  const go = useCallback((direction: number) => onChange((index + direction + surfaceCount) % surfaceCount), [index, onChange, surfaceCount]);
  useDialogFocus(true, dialogRef, closeRef, onClose, selection.opener, covered);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (covered || document.querySelector('.lead-modal')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [covered, go]);
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => { const start = pointer.current; pointer.current = null; if (!start || start.id !== event.pointerId) return; const dx = event.clientX - start.x; const dy = event.clientY - start.y; if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); };
  return <div className="sunc-plan-dialog" role="dialog" aria-modal="true" aria-labelledby="sunc-plan-title" aria-hidden={covered || undefined} inert={covered ? true : undefined}>
    <button className="sunc-plan-dialog__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.closePlan} />
    <section ref={dialogRef}>
      <header><div><span>{t.plans}</span><h2 id="sunc-plan-title">{t.unit}{selection.unit.number}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closePlan}>×</button></header>
      <div className="sunc-plan-dialog__body">
        <div className="sunc-plan-dialog__stage" onPointerDown={(event) => { pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }} onPointerUp={pointerUp} onPointerCancel={() => { pointer.current = null; }}>
          <img src={sunAsset(surface.src)} width={selection.unit.planWidth || 1772} height={selection.unit.planHeight || 1772} alt={surface.key === 'one' ? t.planOne : t.planTwo} draggable={false} />
          <span>{index + 1} / {surfaces.length}</span>
          {surfaces.length > 1 ? <nav aria-label={t.planDialog}><button type="button" onClick={() => go(-1)} aria-label={t.previousPlan}>←</button><button type="button" onClick={() => go(1)} aria-label={t.nextPlan}>→</button></nav> : null}
        </div>
        <aside><span>{surface.key === 'one' ? t.planOne : t.planTwo}</span><p>{surface.key === 'one' ? t.planOneText : t.planTwoText} {t.swipeHint}</p><UnitFacts unit={selection.unit} language={language} /><div className="sunc-price"><small>{t.price}</small><strong>{formatSunPrice(priceOf(selection.unit), language)}</strong><span>{t.noCampaign}</span><p>{t.priceContract}</p></div><button type="button" data-lead-trigger onClick={(event) => onLead(selection.unit, event.currentTarget)}>{t.planLead}<b>↗</b></button></aside>
      </div>
    </section>
  </div>;
}

function UnitDetail({ selection, language, mobile, covered, onClose, onPlan, onLead }: { selection: Selection; language: Language; mobile: boolean; covered: boolean; onClose: () => void; onPlan: (selection: PlanSelection) => void; onLead: (unit: SunUnit, opener: HTMLButtonElement) => void }) {
  const panelRef = useRef<HTMLElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const t = copy[language]; const surfaces = planSurfaces(selection.unit);
  useDialogFocus(mobile, panelRef, closeRef, onClose, selection.opener, covered);
  const content = <>
    <header><div><span>{t.detail}</span><h2>{t.unit}{selection.unit.number}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closeDetail}>×</button></header>
    <div className="sunc-detail__scroll"><div className="sunc-detail__plans">{surfaces.map((surface, index) => <button type="button" key={surface.key} onClick={(event) => onPlan({ unit: selection.unit, opener: event.currentTarget, index })}><img src={sunAsset(surface.src)} width={selection.unit.planWidth || 1772} height={selection.unit.planHeight || 1772} loading="lazy" alt={surface.key === 'one' ? t.planOne : t.planTwo} /><span>{surface.key === 'one' ? '01' : '02'}</span></button>)}</div><h3>{t.characteristics}</h3><UnitFacts unit={selection.unit} language={language} /><div className="sunc-price"><small>{t.price}</small><strong>{formatSunPrice(priceOf(selection.unit), language)}</strong><span>{t.noCampaign}</span><p>{t.priceContract}</p></div><button className="sunc-detail__lead" type="button" data-lead-trigger onClick={(event) => onLead(selection.unit, event.currentTarget)}>{t.matrixLead}<b>↗</b></button></div>
  </>;
  if (!mobile) return <aside ref={panelRef} className="sunc-detail sunc-detail--desktop" aria-label={t.detail} aria-hidden={covered || undefined} inert={covered ? true : undefined}>{content}</aside>;
  return <div className="sunc-detail-layer" role="dialog" aria-modal="true" aria-label={t.detail} aria-hidden={covered || undefined} inert={covered ? true : undefined}><button className="sunc-detail-layer__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.closeDetail} /><aside ref={panelRef} className="sunc-detail sunc-detail--mobile">{content}</aside></div>;
}

function Matrix({ rows, units, sorted, matchedIds, language, selection, onSelection }: { rows: MatrixRow[]; units: SunUnit[]; sorted: SunUnit[]; matchedIds: Set<string>; language: Language; selection: Selection | null; onSelection: (selection: Selection) => void }) {
  const t = copy[language]; const scrollRef = useRef<HTMLDivElement>(null); const [edges, setEdges] = useState({ left: true, right: false });
  const byId = useMemo(() => new Map(units.map((unit) => [unitKeyOf(unit), unit])), [units]); const rank = useMemo(() => new Map(sorted.map((unit, index) => [unitKeyOf(unit), index])), [sorted]);
  const updateEdges = useCallback(() => { const node = scrollRef.current; if (!node) return; setEdges({ left: node.scrollLeft <= 2, right: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 }); }, []);
  useEffect(() => { const node = scrollRef.current; if (!node) return; updateEdges(); const observer = new ResizeObserver(updateEdges); observer.observe(node); node.addEventListener('scroll', updateEdges, { passive: true }); return () => { observer.disconnect(); node.removeEventListener('scroll', updateEdges); }; }, [updateEdges]);
  const move = (direction: number) => { const node = scrollRef.current; if (!node) return; node.scrollBy({ left: direction * Math.max(320, node.clientWidth * .72), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
  const keyScroll = (event: ReactKeyboardEvent<HTMLDivElement>) => { const node = scrollRef.current; if (!node) return; if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); } else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); } else if (event.key === 'Home') { event.preventDefault(); node.scrollTo({ left: 0 }); } else if (event.key === 'End') { event.preventDefault(); node.scrollTo({ left: node.scrollWidth }); } };
  const activate = (unit: SunUnit, opener: HTMLButtonElement) => { rememberSunUnit(unit); onSelection({ unit, opener }); };
  const blocks = ['A', 'Г', 'Д', 'В'];
  return <section className="sunc-matrix" aria-labelledby="sunc-matrix-title">
    <header><div><h2 id="sunc-matrix-title">{t.matrixTitle}</h2><p>{t.matrixText}</p></div><nav><button type="button" onClick={() => move(-1)} disabled={edges.left} aria-label={t.scrollLeft}>←</button><button type="button" onClick={() => move(1)} disabled={edges.right} aria-label={t.scrollRight}>→</button></nav></header>
    <p className="sunc-matrix__help">{t.matrixHelp}</p>
    <div ref={scrollRef} className="sunc-matrix__scroll" tabIndex={0} onKeyDown={keyScroll} aria-label={t.matrixHelp}>{blocks.map((block) => {
      const blockRows = rows.filter((row) => row.block === block).sort((left, right) => right.floor - left.floor); const blockIds = blockRows.flatMap((row) => row.unitIds); const matches = blockIds.filter((id) => matchedIds.has(id)).length;
      return <section key={block} className="sunc-matrix-panel" aria-labelledby={`sunc-block-${block}`}><header><div><span>{t.block}</span><h3 id={`sunc-block-${block}`}>{block}</h3></div><strong>{matches} {t.matched}</strong></header><div>{blockRows.map((row) => {
        const ids = [...row.unitIds].filter((id) => byId.has(id)).sort((left, right) => (rank.get(left) ?? 999) - (rank.get(right) ?? 999));
        return <div className="sunc-matrix-row" key={row.id} data-row-id={row.id}><span><small>{t.row}</small>{row.floor}</span><div>{ids.length ? ids.map((id) => { const unit = byId.get(id)!; const matchesFilter = matchedIds.has(id); return <button key={id} type="button" className={`${matchesFilter ? '' : 'is-filtered'} ${selection?.unit.id === unit.id ? 'is-selected' : ''}`} disabled={!matchesFilter} onClick={(event) => activate(unit, event.currentTarget)} aria-label={`${t.openUnit}: ${t.unit}${unit.number}, ${unit.rooms} ${t.roomsShort}, ${formatSunNumber(Number(unit.area), language)} m²`}><strong>№{unit.number}</strong><small>{unit.rooms} {t.roomsShort} · {formatSunNumber(Number(unit.area), language)} m²</small><em>{formatSunPrice(priceOf(unit), language)}</em><i>{formatSunPrice(ppmOf(unit), language)} / m²</i></button>; }) : <span className="sunc-matrix-row__empty">— <small>{t.noUnits}</small></span>}</div></div>;
      })}</div></section>;
    })}</div>
  </section>;
}

export function SunCatalog({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useSunLanguage(initialLanguage); const mobile = useSunMobile(); const t = copy[language];
  const [mode, setMode] = useState<Mode>('cards'); const [sort, setSort] = useState<Sort>('recommended'); const [filters, setFilters] = useState<Filters>(defaultFilters); const [visible, setVisible] = useState(9);
  const [selection, setSelection] = useState<Selection | null>(null); const [plan, setPlan] = useState<PlanSelection | null>(null); const [lead, setLead] = useState<LeadRequest | null>(null); const [menuOpen, setMenuOpen] = useState(false);
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]); const menuRef = useRef<HTMLElement>(null); const menuButtonRef = useRef<HTMLButtonElement>(null);
  const units = snapshot.units; const rows = useMemo(() => normalizeRows(snapshot), []);
  const sourceRank = useMemo(() => new Map(units.map((unit, index) => [unitKeyOf(unit), index])), [units]);
  const rooms = useMemo(() => [...new Set(units.map((unit) => String(unit.rooms)))].sort((a, b) => Number(a) - Number(b)), [units]);
  const blocks = useMemo(() => ['A', 'Г', 'Д', 'В'].filter((block) => units.some((unit) => normalizedBlock(blockOf(unit)) === block)), [units]);
  const limits = useMemo(() => ({ floorMin: Math.min(...units.map((unit) => Number(unit.floor))), floorMax: Math.max(...units.map((unit) => Number(unit.floor))), areaMin: Math.min(...units.map((unit) => Number(unit.area))), areaMax: Math.max(...units.map((unit) => Number(unit.area))), priceMin: Math.min(...units.map(priceOf)), priceMax: Math.max(...units.map(priceOf)) }), [units]);
  const closeLead = useCallback(() => setLead(null), []); const closePlan = useCallback(() => setPlan(null), []); const closeSelection = useCallback(() => setSelection(null), []);

  useEffect(() => {
    document.body.classList.add('sunc-active');
    const load = () => { setMode(readMode()); setSort(readSort()); setFilters(filterFromUrl()); setVisible(readVisible()); setSelection(null); };
    load(); window.addEventListener('popstate', load);
    return () => { document.body.classList.remove('sunc-active'); window.removeEventListener('popstate', load); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const unlock = lockSunBody(); const opener = menuButtonRef.current;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => { if (document.querySelector('.lead-modal')) return; if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; } if (event.key !== 'Tab' || !menuRef.current) return; const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')); const first = focusable[0]; const last = focusable.at(-1); if (!first || !last) return; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } };
    window.addEventListener('keydown', onKey); return () => { window.removeEventListener('keydown', onKey); unlock(); if (!document.querySelector('.lead-modal')) window.requestAnimationFrame(() => opener?.focus({ preventScroll: true })); };
  }, [menuOpen]);

  const filtered = useMemo(() => units.filter((unit) => matchesNumeric(unit, filters)
    && (!filters.rooms.length || filters.rooms.includes(String(unit.rooms)))
    && (!filters.blocks.length || filters.blocks.includes(normalizedBlock(blockOf(unit))))), [filters, units]);
  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    const compare: Record<Sort, number> = {
      recommended: (sourceRank.get(unitKeyOf(left)) ?? 0) - (sourceRank.get(unitKeyOf(right)) ?? 0), priceAsc: priceOf(left) - priceOf(right), priceDesc: priceOf(right) - priceOf(left), areaAsc: Number(left.area) - Number(right.area), areaDesc: Number(right.area) - Number(left.area), roomsAsc: Number(left.rooms) - Number(right.rooms), roomsDesc: Number(right.rooms) - Number(left.rooms), floorAsc: Number(left.floor) - Number(right.floor), floorDesc: Number(right.floor) - Number(left.floor), ppmAsc: ppmOf(left) - ppmOf(right), ppmDesc: ppmOf(right) - ppmOf(left),
    };
    return compare[sort] || unitKeyOf(left).localeCompare(unitKeyOf(right));
  }), [filtered, sort, sourceRank]);
  const stableSorted = useMemo(() => [...sorted].sort((left, right) => {
    const primary = (() => { switch (sort) { case 'recommended': return (sourceRank.get(unitKeyOf(left)) ?? 0) - (sourceRank.get(unitKeyOf(right)) ?? 0); case 'priceAsc': return priceOf(left) - priceOf(right); case 'priceDesc': return priceOf(right) - priceOf(left); case 'areaAsc': return Number(left.area) - Number(right.area); case 'areaDesc': return Number(right.area) - Number(left.area); case 'roomsAsc': return Number(left.rooms) - Number(right.rooms); case 'roomsDesc': return Number(right.rooms) - Number(left.rooms); case 'floorAsc': return Number(left.floor) - Number(right.floor); case 'floorDesc': return Number(right.floor) - Number(left.floor); case 'ppmAsc': return ppmOf(left) - ppmOf(right); case 'ppmDesc': return ppmOf(right) - ppmOf(left); } })(); return primary || unitKeyOf(left).localeCompare(unitKeyOf(right));
  }), [sort, sorted, sourceRank]);
  const matchedIds = useMemo(() => new Set(filtered.map(unitKeyOf)), [filtered]);
  const facetRoomCounts = useMemo(() => Object.fromEntries(rooms.map((room) => [room, units.filter((unit) => matchesNumeric(unit, filters) && (!filters.blocks.length || filters.blocks.includes(normalizedBlock(blockOf(unit)))) && String(unit.rooms) === room).length])), [filters, rooms, units]);
  const facetBlockCounts = useMemo(() => Object.fromEntries(blocks.map((block) => [block, units.filter((unit) => matchesNumeric(unit, filters) && (!filters.rooms.length || filters.rooms.includes(String(unit.rooms))) && normalizedBlock(blockOf(unit)) === block).length])), [blocks, filters, units]);

  const updateFilters = (next: Filters, replace = false) => { setFilters(next); setVisible(9); setSelection(null); writeUrl(mode, sort, next, 9, replace); };
  const toggleFilter = (key: 'rooms' | 'blocks', value: string) => { const current = filters[key]; updateFilters({ ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] }); };
  const setRange = (key: Exclude<keyof Filters, 'rooms' | 'blocks'>, value: string) => updateFilters({ ...filters, [key]: value }, true);
  const reset = () => updateFilters(defaultFilters);
  const selectMode = (next: Mode) => { setMode(next); setVisible(9); setSelection(null); writeUrl(next, sort, filters, 9); };
  const selectSort = (next: Sort) => { setSort(next); setVisible(9); setSelection(null); writeUrl(mode, next, filters, 9); };
  const showMore = () => { const next = Math.min(stableSorted.length, visible + 9); setVisible(next); writeUrl(mode, sort, filters, next); };
  const openLead = useCallback((surface: string, unit: SunUnit | null = null, opener: HTMLElement | null = document.activeElement as HTMLElement | null) => { if (unit) rememberSunUnit(unit); setLead({ surface, unit, opener }); }, []);
  const openPlan = useCallback((next: PlanSelection) => { rememberSunUnit(next.unit); setPlan(next); }, []);
  const changePlan = useCallback((index: number) => setPlan((current) => current ? { ...current, index } : current), []);
  const modeKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => { let next = index; if (event.key === 'ArrowRight') next = (index + 1) % modes.length; else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = modes.length - 1; else return; event.preventDefault(); selectMode(modes[next]); modeRefs.current[next]?.focus(); };
  const mobileDetailOpen = mode === 'chess' && Boolean(selection) && mobile;
  const rootCovered = menuOpen || mobileDetailOpen;

  return <div className="sunc-site" lang={language}>
    <a className="sunc-skip" href="#sunc-results" aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}>{t.skip}</a>
    <header id="top" className="sunc-header" aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}><a href={sunPath('/sun', language)}><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /></a><nav aria-label={t.nav}><a href={sunPath('/sun', language)}>← {t.back}</a><a href="tel:+998781505500">+998 78 150 55 00</a></nav><div aria-label={t.language}>{sunLanguages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button className="sunc-header__lead" type="button" data-lead-trigger onClick={(event) => openLead('catalog:header', null, event.currentTarget)}>{t.consult}<span>↗</span></button><button ref={menuButtonRef} className="sunc-menu-button" type="button" aria-expanded={menuOpen} aria-controls="sunc-menu" onClick={() => setMenuOpen(true)}><span>{t.menu}</span><i /><i /></button></header>

    <div className={`sunc-menu ${menuOpen ? 'is-open' : ''}`} role="dialog" aria-modal={menuOpen && !lead ? true : undefined} aria-label={t.nav} aria-hidden={!menuOpen || Boolean(lead)} inert={!menuOpen || Boolean(lead) ? true : undefined}><button className="sunc-menu__backdrop" type="button" tabIndex={-1} onClick={() => setMenuOpen(false)} aria-label={t.close} /><nav ref={menuRef} id="sunc-menu"><header><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /><button type="button" onClick={() => setMenuOpen(false)} aria-label={t.close}>×</button></header><a href={sunPath('/sun', language)} onClick={() => setMenuOpen(false)}>← {t.back}</a><a href="#sunc-results" onClick={() => setMenuOpen(false)}>{t.modes.cards}</a><a href="tel:+998781505500">+998 78 150 55 00</a><div aria-label={t.language}>{sunLanguages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button type="button" data-lead-trigger onClick={(event) => openLead('catalog:header', null, event.currentTarget)}>{t.consult}<span>↗</span></button></nav></div>

    <main aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}>
      <section className="sunc-hero"><div className="sunc-hero__sun" aria-hidden="true" /><div className="sunc-hero__line" aria-hidden="true"><span>06:00</span><i /><span>12:00</span><i /><span>18:00</span></div><div className="sunc-hero__copy"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.lead}</p><button type="button" data-lead-trigger onClick={(event) => openLead('catalog:hero', null, event.currentTarget)}>{t.heroLead}<b>↗</b></button></div><dl>{t.facts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl><p className="sunc-hero__snapshot"><span>{t.snapshot}</span>{snapshot.capturedAt}<b>{t.liveWarning}</b></p></section>

      <section className="sunc-catalog" aria-labelledby="sunc-catalog-title">
        <div className="sunc-toolbar"><div className="sunc-modes" role="tablist" aria-label={t.modeLabel}>{modes.map((item, index) => <button key={item} ref={(node) => { modeRefs.current[index] = node; }} id={`sunc-tab-${item}`} type="button" role="tab" aria-selected={mode === item} aria-controls="sunc-results" tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : ''} onClick={() => selectMode(item)} onKeyDown={(event) => modeKey(event, index)}>{t.modes[item]}</button>)}</div><div className="sunc-result-count" aria-live="polite"><strong>{stableSorted.length}</strong> {t.results}</div></div>

        <form className="sunc-filters" onSubmit={(event) => event.preventDefault()}><header><h2 id="sunc-catalog-title">{t.filters}</h2><button type="button" onClick={reset}>{t.reset}</button></header><div className="sunc-filter-facets">
          <fieldset><legend>{t.rooms}</legend><div>{rooms.map((room) => <label key={room} className={filters.rooms.includes(room) ? 'is-active' : ''}><input type="checkbox" checked={filters.rooms.includes(room)} onChange={() => toggleFilter('rooms', room)} /><span>{room}</span><b>{facetRoomCounts[room]}</b></label>)}</div></fieldset>
          <fieldset><legend>{t.blocks}</legend><div>{blocks.map((block) => <label key={block} className={filters.blocks.includes(block) ? 'is-active' : ''}><input type="checkbox" checked={filters.blocks.includes(block)} onChange={() => toggleFilter('blocks', block)} /><span>{block}</span><b>{facetBlockCounts[block]}</b></label>)}</div></fieldset>
        </div><div className="sunc-filter-ranges">
          <fieldset><legend>{t.floorRange}</legend><label><span>{t.from}</span><input aria-label={`${t.floorRange} ${t.from}`} type="number" min={limits.floorMin} max={limits.floorMax} placeholder={String(limits.floorMin)} value={filters.floorFrom} onChange={(event) => setRange('floorFrom', event.target.value)} /></label><label><span>{t.to}</span><input aria-label={`${t.floorRange} ${t.to}`} type="number" min={limits.floorMin} max={limits.floorMax} placeholder={String(limits.floorMax)} value={filters.floorTo} onChange={(event) => setRange('floorTo', event.target.value)} /></label></fieldset>
          <fieldset><legend>{t.areaRange}</legend><label><span>{t.from}</span><input aria-label={`${t.areaRange} ${t.from}`} type="number" min={limits.areaMin} max={limits.areaMax} step="0.01" inputMode="decimal" placeholder={formatSunNumber(limits.areaMin, language)} value={filters.areaFrom} onChange={(event) => setRange('areaFrom', event.target.value)} /></label><label><span>{t.to}</span><input aria-label={`${t.areaRange} ${t.to}`} type="number" min={limits.areaMin} max={limits.areaMax} step="0.01" inputMode="decimal" placeholder={formatSunNumber(limits.areaMax, language)} value={filters.areaTo} onChange={(event) => setRange('areaTo', event.target.value)} /></label></fieldset>
          <fieldset><legend>{t.priceRange}</legend><label><span>{t.from}</span><input aria-label={`${t.priceRange} ${t.from}`} type="number" min={limits.priceMin} max={limits.priceMax} step="1000000" inputMode="numeric" placeholder={String(limits.priceMin)} value={filters.priceFrom} onChange={(event) => setRange('priceFrom', event.target.value)} /></label><label><span>{t.to}</span><input aria-label={`${t.priceRange} ${t.to}`} type="number" min={limits.priceMin} max={limits.priceMax} step="1000000" inputMode="numeric" placeholder={String(limits.priceMax)} value={filters.priceTo} onChange={(event) => setRange('priceTo', event.target.value)} /></label></fieldset>
          <label className="sunc-sort"><span>{t.sort}</span><select value={sort} onChange={(event) => selectSort(event.target.value as Sort)}>{sorts.map((value) => <option key={value} value={value}>{t.sorts[value]}</option>)}</select></label>
        </div><p className="sunc-filter-announcement" aria-live="polite">{t.filtersAnnouncement}: {stableSorted.length}. {filters.rooms.length + filters.blocks.length ? `${filters.rooms.length + filters.blocks.length} ${t.selected}.` : ''}</p></form>

        <div id="sunc-results" role="tabpanel" aria-labelledby={`sunc-tab-${mode}`} tabIndex={0}>{!stableSorted.length ? <section className="sunc-empty"><span>00</span><h2>{t.emptyTitle}</h2><p>{t.emptyText}</p><div><button type="button" onClick={reset}>{t.reset}</button><button type="button" data-lead-trigger onClick={(event) => openLead('catalog:empty', null, event.currentTarget)}>{t.emptyLead}<span>↗</span></button></div></section> : mode === 'cards' ? <>
          <div className="sunc-cards">{stableSorted.slice(0, visible).map((unit) => <article key={unit.id}><button className="sunc-card__plan" type="button" onClick={(event) => openPlan({ unit, opener: event.currentTarget, index: 0 })} aria-label={`${t.openPlan}: ${t.unit}${unit.number}`}><img src={sunAsset(unit.secondPlanPath || unit.primaryPlanPath)} width={unit.planWidth || 1772} height={unit.planHeight || 1772} loading="lazy" alt={`${t.planDialog} · ${t.unit}${unit.number}`} /><span>{t.openPlan}<b>↗</b></span></button><header><div><span>{t.block} {normalizedBlock(blockOf(unit))}</span><h2>{t.unit}{unit.number}</h2></div><em>{t.available}</em></header><UnitFacts unit={unit} language={language} /><div className="sunc-card__price"><small>{t.price}</small><strong>{formatSunPrice(priceOf(unit), language)}</strong><span>{formatSunPrice(ppmOf(unit), language)} / m²</span></div><button className="sunc-card__lead" type="button" data-lead-trigger onClick={(event) => openLead('catalog:card', unit, event.currentTarget)}>{t.ask}<span>↗</span></button></article>)}</div><div className="sunc-showing"><span>{t.showing} {Math.min(visible, stableSorted.length)} {t.of} {stableSorted.length}</span>{visible < stableSorted.length ? <button type="button" onClick={showMore}>{t.showMore}<b>↓</b></button> : null}</div>
        </> : <div className={`sunc-matrix-shell ${selection ? 'has-detail' : ''}`}><Matrix rows={rows} units={units} sorted={stableSorted} matchedIds={matchedIds} language={language} selection={selection} onSelection={setSelection} />{selection && !mobile ? <UnitDetail selection={selection} language={language} mobile={false} covered={Boolean(plan || lead)} onClose={closeSelection} onPlan={openPlan} onLead={(unit, opener) => openLead('catalog:matrix', unit, opener)} /> : null}</div>}</div>
      </section>

      <section className="sunc-footer"><div><span>SUN · HUMAN2HUMAN</span><h2>{t.footerTitle}</h2><p>{t.footerText}</p><button type="button" data-lead-trigger onClick={(event) => openLead('catalog:footer', null, event.currentTarget)}>{t.consult}<b>↗</b></button></div><a href="tel:+998781505500">+998 78 150 55 00 <span>↗</span></a><footer><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /><nav><a href={`${sunAsset('/privacy')}?project=sun&lang=${language}&from=catalog`}>{t.privacy}</a><a href="#top">{t.top}</a></nav></footer></section>
    </main>

    {mode === 'chess' && selection && mobile ? <UnitDetail selection={selection} language={language} mobile covered={Boolean(plan || lead)} onClose={closeSelection} onPlan={openPlan} onLead={(unit, opener) => openLead('catalog:matrix', unit, opener)} /> : null}
    {plan ? <PlanDialog selection={plan} language={language} covered={Boolean(lead)} onClose={closePlan} onChange={changePlan} onLead={(unit, opener) => openLead('catalog:plan', unit, opener)} /> : null}
    {lead ? <LeadModal open language={language} context={sunLeadContext(lead.surface, language, lead.unit)} hideBrand projectName="SUN" tagline={t.formTagline} facts={t.formFacts} submitUrl={sunLeadSubmitUrl()} projectSlug="sun" unitKey={lead.unit?.unitKey} privacyUrl={`${sunAsset('/privacy')}?project=sun&lang=${language}&from=catalog`} requireConsent returnFocusTo={lead.opener} onClose={closeLead} /> : null}
  </div>;
}
