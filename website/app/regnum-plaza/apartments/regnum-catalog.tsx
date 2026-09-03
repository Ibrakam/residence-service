'use client';

/* eslint-disable @next/next/no-img-element */

import { usePathname, useRouter } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type catalogData from '@/data/regnum-plaza-client.json';
import { LeadModal } from '@/app/lead-modal';
import { catalogLeadIdentity, useLiveCatalogSnapshot } from '@/app/live-catalog';
import { regnumLeadContext, regnumLeadSubmitUrl, rememberRegnumUnit, type RegnumUnit } from '../regnum-lead';
import { lockRegnumBody, priceOnRequest, regnumLocale, type RegnumLanguage as Language } from '../regnum-ui';

type Mode = 'cards' | 'chess';
type Sort = 'source' | 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc' | 'floorDesc' | 'roomsAsc' | 'roomsDesc' | 'ppmAsc' | 'ppmDesc';
type Filters = { rooms: string; areaFrom: string; areaTo: string; floor: string; queue: string; section: string; completion: string; status: string };
type Selection = { unit: RegnumUnit; opener: HTMLButtonElement };
type LeadRequest = { surface: string; unit: RegnumUnit | null; opener: HTMLElement | null };

type Snapshot = typeof catalogData;
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) => `${appBasePath}${path}?lang=${language}`;
const languages: Language[] = ['ru', 'uz', 'en'];
const modes: Mode[] = ['cards', 'chess'];
const storageKey = 'regnum-plaza-language';
const defaultFilters: Filters = { rooms: 'all', areaFrom: '', areaTo: '', floor: 'all', queue: 'all', section: 'all', completion: 'all', status: 'all' };

const copy = {
  ru: {
    skip: 'К результатам каталога', back: 'О проекте', nav: 'Навигация каталога Regnum Plaza', language: 'Язык', consult: 'Получить консультацию', call: 'Позвонить',
    eyebrow: 'COPPER APERTURES · ДАННЫЕ ОБНОВЛЯЮТСЯ', title: 'Актуальные квартиры.', lead: 'Состав предложений и статусы обновляются автоматически. Публичная цена показывается как «По запросу».', heroLead: 'Уточнить текущую доступность', heroAlt: 'Реальная первая очередь Regnum Plaza',
    facts: [['Онлайн', 'предложений'], ['Актуально', 'комнаты'], ['Актуально', 'площадь'], ['По запросу', 'публичная цена']] as const,
    modes: { cards: 'Карточки', chess: 'Шахматка' }, modeLabel: 'Режим каталога', filters: 'Фильтры', reset: 'Сбросить', any: 'Все', rooms: 'Комнаты', areaFrom: 'Площадь от, м²', areaTo: 'Площадь до, м²', floor: 'Этаж', queue: 'Очередь', section: 'Секция', completion: 'Срок / год', status: 'Статус', results: 'найдено',
    sort: 'Сортировка', sorts: { source: 'Исходный порядок', priceAsc: 'Цена ↑', priceDesc: 'Цена ↓', areaAsc: 'Площадь ↑', areaDesc: 'Площадь ↓', floorAsc: 'Этаж ↑', floorDesc: 'Этаж ↓', roomsAsc: 'Комнаты ↑', roomsDesc: 'Комнаты ↓', ppmAsc: 'Цена/м² ↑', ppmDesc: 'Цена/м² ↓' },
    sortNote: 'Сортировки используют актуальные внутренние значения, но числовые цены не публикуются.', number: 'Квартира №', roomsShort: 'комн.', area: 'Площадь', floorShort: 'Этаж', queueShort: 'Очередь', sectionShort: 'Секция', completionShort: 'Срок', available: 'Доступна', price: 'По запросу', openPlan: 'Открыть официальную планировку', missingPlan: 'Официальная планировка не опубликована', ask: 'Оставить заявку', showMore: 'Показать ещё 6', showing: 'Показано', of: 'из',
    emptyTitle: 'По этим фильтрам ничего не найдено.', emptyText: 'Сбросьте параметры или оставьте заявку — менеджер перепроверит текущую доступность.', emptyLead: 'Запросить подборку',
    matrixTitle: 'Четыре группы актуальных предложений.', matrixText: 'Очередь × секция сохранены точно. Пустые физические этажи не дорисованы; фильтры только приглушают квартиры в существующих строках.', matched: 'совпадений', row: 'Этаж', scrollLeft: 'Прокрутить шахматку влево', scrollRight: 'Прокрутить шахматку вправо', matrixHelp: 'Прокрутка: свайп, трекпад, кнопки, ← →, Home и End.', openUnit: 'Открыть квартиру',
    detail: 'Детали квартиры', closeDetail: 'Закрыть детали', plan: 'Планировка', noPlan: 'Планировка отсутствует', unitFacts: 'Характеристики', matrixLead: 'Уточнить эту квартиру',
    planDialog: 'Официальная планировка квартиры', closePlan: 'Закрыть планировку', zoomHint: 'Можно масштабировать жестом браузера', planLead: 'Уточнить квартиру по планировке',
    footerTitle: 'Нужен точный ответ по конкретной квартире?', footerText: 'Менеджер сверит квартиру с текущим источником. Заявка не является бронированием.', privacy: 'Обработка персональных данных', top: 'Наверх',
    formTagline: 'Свет входит через медь.', formFacts: ['Бизнес-класс', 'Актуальные предложения', 'IV квартал 2026'] as const,
  },
  uz: {
    skip: 'Katalog natijalariga o‘tish', back: 'Loyiha haqida', nav: 'Regnum Plaza katalogi navigatsiyasi', language: 'Til', consult: 'Maslahat olish', call: 'Qo‘ng‘iroq qilish',
    eyebrow: 'COPPER APERTURES · MA’LUMOTLAR YANGILANADI', title: 'Dolzarb xonadonlar.', lead: 'Takliflar tarkibi va holatlar avtomatik yangilanadi. Ommaviy narx “So‘rov bo‘yicha” ko‘rsatiladi.', heroLead: 'Joriy mavjudlikni aniqlash', heroAlt: 'Regnum Plaza haqiqiy birinchi bosqichi', facts: [['Onlayn', 'taklif'], ['Dolzarb', 'xona'], ['Dolzarb', 'maydon'], ['So‘rov bo‘yicha', 'ommaviy narx']] as const,
    modes: { cards: 'Kartochkalar', chess: 'Shaxmatka' }, modeLabel: 'Katalog rejimi', filters: 'Filtrlar', reset: 'Tozalash', any: 'Barchasi', rooms: 'Xonalar', areaFrom: 'Maydon, dan m²', areaTo: 'Maydon, gacha m²', floor: 'Qavat', queue: 'Bosqich', section: 'Seksiya', completion: 'Muddat / yil', status: 'Holat', results: 'topildi',
    sort: 'Saralash', sorts: { source: 'Manba tartibi', priceAsc: 'Narx ↑', priceDesc: 'Narx ↓', areaAsc: 'Maydon ↑', areaDesc: 'Maydon ↓', floorAsc: 'Qavat ↑', floorDesc: 'Qavat ↓', roomsAsc: 'Xonalar ↑', roomsDesc: 'Xonalar ↓', ppmAsc: 'Narx/m² ↑', ppmDesc: 'Narx/m² ↓' }, sortNote: 'Saralash dolzarb ichki qiymatlardan foydalanadi. Raqamli narxlar ommaga e’lon qilinmaydi.',
    number: 'Xonadon №', roomsShort: 'xona', area: 'Maydon', floorShort: 'Qavat', queueShort: 'Bosqich', sectionShort: 'Seksiya', completionShort: 'Muddat', available: 'Mavjud', price: 'So‘rov bo‘yicha', openPlan: 'Rasmiy rejani ochish', missingPlan: 'Rasmiy reja e’lon qilinmagan', ask: 'Ariza qoldirish', showMore: 'Yana 6 tasini ko‘rsatish', showing: 'Ko‘rsatildi', of: 'dan',
    emptyTitle: 'Bu filtrlarga mos xonadon topilmadi.', emptyText: 'Parametrlarni tozalang yoki ariza qoldiring — menejer joriy mavjudlikni qayta tekshiradi.', emptyLead: 'Tanlov so‘rash', matrixTitle: 'Dolzarb takliflar guruhlari.', matrixText: 'Bosqich × seksiya aniq saqlangan. Bo‘sh jismoniy qavatlar chizilmagan; filtrlar faqat mavjud qatorlardagi xonadonlarni xira qiladi.', matched: 'mos', row: 'Qavat', scrollLeft: 'Shaxmatkani chapga aylantirish', scrollRight: 'Shaxmatkani o‘ngga aylantirish', matrixHelp: 'Aylantirish: svayp, trekpad, tugmalar, ← →, Home va End.', openUnit: 'Xonadonni ochish',
    detail: 'Xonadon tafsilotlari', closeDetail: 'Tafsilotlarni yopish', plan: 'Reja', noPlan: 'Reja yo‘q', unitFacts: 'Xususiyatlar', matrixLead: 'Bu xonadonni aniqlash', planDialog: 'Xonadonning rasmiy rejasi', closePlan: 'Rejani yopish', zoomHint: 'Brauzer ishorasi bilan kattalashtirish mumkin', planLead: 'Reja bo‘yicha xonadonni aniqlash',
    footerTitle: 'Muayyan xonadon bo‘yicha aniq javob kerakmi?', footerText: 'Menejer xonadonni joriy manba bilan qayta tekshiradi. Ariza bron hisoblanmaydi.', privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga', formTagline: 'Yorug‘lik mis orqali kiradi.', formFacts: ['Biznes-klass', 'Dolzarb takliflar', '2026-yil IV chorak'] as const,
  },
  en: {
    skip: 'Skip to catalogue results', back: 'About the project', nav: 'Regnum Plaza catalogue navigation', language: 'Language', consult: 'Get a consultation', call: 'Call',
    eyebrow: 'COPPER APERTURES · AUTOMATICALLY UPDATED', title: 'Current apartments.', lead: 'Listings and statuses update automatically. Public pricing is shown as “Price on request”.', heroLead: 'Check current availability', heroAlt: 'Actual first phase of Regnum Plaza', facts: [['Online', 'listings'], ['Current', 'rooms'], ['Current', 'area'], ['On request', 'public price']] as const,
    modes: { cards: 'Cards', chess: 'Matrix' }, modeLabel: 'Catalogue mode', filters: 'Filters', reset: 'Reset', any: 'All', rooms: 'Rooms', areaFrom: 'Area from, m²', areaTo: 'Area to, m²', floor: 'Floor', queue: 'Phase', section: 'Section', completion: 'Completion / year', status: 'Status', results: 'found',
    sort: 'Sort', sorts: { source: 'Source order', priceAsc: 'Price ↑', priceDesc: 'Price ↓', areaAsc: 'Area ↑', areaDesc: 'Area ↓', floorAsc: 'Floor ↑', floorDesc: 'Floor ↓', roomsAsc: 'Rooms ↑', roomsDesc: 'Rooms ↓', ppmAsc: 'Price/m² ↑', ppmDesc: 'Price/m² ↓' }, sortNote: 'Price and price/m² sorting uses internal live catalogue values. Numbers are not published: publicPrice=false.',
    number: 'Apartment no.', roomsShort: 'rooms', area: 'Area', floorShort: 'Floor', queueShort: 'Phase', sectionShort: 'Section', completionShort: 'Completion', available: 'Available', price: 'Price on request', openPlan: 'Open official plan', missingPlan: 'Official plan has not been published', ask: 'Request details', showMore: 'Show 6 more', showing: 'Showing', of: 'of',
    emptyTitle: 'Nothing matches these filters.', emptyText: 'Reset the filters or request a selection and a manager will re-check current availability.', emptyLead: 'Request a selection', matrixTitle: 'Four real groups. Eleven live catalogue rows.', matrixText: 'Phase × section is preserved exactly. Empty physical floors are not invented; filters only dim apartments in existing rows.', matched: 'matches', row: 'Floor', scrollLeft: 'Scroll matrix left', scrollRight: 'Scroll matrix right', matrixHelp: 'Scroll with swipe, trackpad, buttons, ← →, Home and End.', openUnit: 'Open apartment',
    detail: 'Apartment details', closeDetail: 'Close details', plan: 'Plan', noPlan: 'No plan', unitFacts: 'Specifications', matrixLead: 'Ask about this apartment', planDialog: 'Official apartment plan', closePlan: 'Close plan', zoomHint: 'Use your browser gesture to zoom', planLead: 'Ask about this floor plan',
    footerTitle: 'Need an exact answer about a specific apartment?', footerText: 'A manager will check the apartment against the current source. A request is not a reservation.', privacy: 'Personal data processing', top: 'Back to top', formTagline: 'Light enters through copper.', formFacts: ['Business class', 'Current listings', 'Q4 2026'] as const,
  },
} as const;

function useLanguage(initialLanguage: Language) {
  const router = useRouter(); const pathname = usePathname();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('lang')) {
      let stored: string | null = null; try { stored = localStorage.getItem(storageKey); } catch { /* URL remains authoritative. */ }
      params.set('lang', stored === 'uz' || stored === 'en' ? stored : initialLanguage);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    }
    document.documentElement.lang = initialLanguage;
    try { localStorage.setItem(storageKey, initialLanguage); } catch { /* Optional fallback. */ }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (language: Language) => {
    try { localStorage.setItem(storageKey, language); } catch { /* URL remains authoritative. */ }
    const params = new URLSearchParams(window.location.search); params.set('lang', language);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  return [initialLanguage, setLanguage] as const;
}

function useMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => { const query = window.matchMedia('(max-width: 900px)'); const update = () => setMobile(query.matches); update(); query.addEventListener('change', update); return () => query.removeEventListener('change', update); }, []);
  return mobile;
}

function PlanPlaceholder({ text }: { text: string }) {
  return <div className="rpc-plan-placeholder"><i /><span>{text}</span></div>;
}

function PlanLightbox({ selection, language, covered, onClose, onLead }: { selection: Selection; language: Language; covered: boolean; onClose: () => void; onLead: (unit: RegnumUnit, opener: HTMLButtonElement) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const t = copy[language]; const unit = selection.unit;
  useEffect(() => {
    const unlock = lockRegnumBody(); closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')); const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlock(); window.requestAnimationFrame(() => selection.opener.isConnected && selection.opener.focus({ preventScroll: true })); };
  }, [onClose, selection.opener]);
  return <div className="rpc-plan" role="dialog" aria-modal={covered ? undefined : true} aria-hidden={covered || undefined} inert={covered ? true : undefined} aria-labelledby="rpc-plan-title">
    <button className="rpc-plan__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.closePlan} />
    <div ref={dialogRef} className="rpc-plan__dialog">
      <header><div><span>{t.planDialog}</span><h2 id="rpc-plan-title">{t.number}{unit.number}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closePlan}>×</button></header>
      <div className="rpc-plan__stage"><img src={asset(unit.planPublicPath!)} width={unit.planWidth!} height={unit.planHeight!} alt={`${t.planDialog} · ${t.number}${unit.number}`} /><span>{t.zoomHint}</span></div>
      <footer><dl><div><dt>{unit.rooms}</dt><dd>{t.roomsShort}</dd></div><div><dt>{unit.area.toLocaleString(regnumLocale(language))} м²</dt><dd>{t.area}</dd></div><div><dt>{unit.floor}</dt><dd>{t.floorShort}</dd></div><div><dt>Q{unit.queue} · S{unit.section}</dt><dd>{unit.completion}</dd></div></dl><div><strong>{priceOnRequest(language)}</strong><button type="button" data-lead-trigger onClick={(event) => onLead(unit, event.currentTarget)}>{t.planLead}<span>↗</span></button></div></footer>
    </div>
  </div>;
}

function UnitDetail({ selection, language, mobile, covered, onClose, onPlan, onLead }: { selection: Selection; language: Language; mobile: boolean; covered: boolean; onClose: () => void; onPlan: (selection: Selection) => void; onLead: (unit: RegnumUnit, opener: HTMLButtonElement) => void }) {
  const panelRef = useRef<HTMLElement>(null); const closeRef = useRef<HTMLButtonElement>(null); const openerRef = useRef(selection.opener); const t = copy[language]; const unit = selection.unit;
  useEffect(() => { openerRef.current = selection.opener; }, [selection.opener]);
  useEffect(() => {
    const unlock = mobile ? lockRegnumBody() : null;
    if (mobile) closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal,.rpc-plan')) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (!mobile || event.key !== 'Tab' || !panelRef.current) return;
      const panel = panelRef.current; const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]')); const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!panel.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlock?.(); window.requestAnimationFrame(() => openerRef.current.isConnected && openerRef.current.focus({ preventScroll: true })); };
  }, [mobile, onClose]);
  const content = <aside ref={panelRef} className="rpc-detail" role={mobile ? 'dialog' : 'region'} aria-modal={mobile && !covered ? true : undefined} aria-hidden={!mobile && covered ? true : undefined} inert={!mobile && covered ? true : undefined} aria-labelledby="rpc-detail-title">
    <header><div><span>{t.detail}</span><h2 id="rpc-detail-title">{t.number}{unit.number}</h2></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closeDetail}>×</button></header>
    {unit.planPublicPath ? <button className="rpc-detail__plan" type="button" onClick={(event) => onPlan({ unit, opener: event.currentTarget })} aria-label={`${t.openPlan}: ${t.number}${unit.number}`}><img src={asset(unit.planPublicPath)} width={unit.planWidth!} height={unit.planHeight!} loading="lazy" alt={`${t.planDialog} · ${t.number}${unit.number}`} /><span>{t.openPlan} ↗</span></button> : <PlanPlaceholder text={t.missingPlan} />}
    <dl><div><dt>{t.area}</dt><dd>{unit.area.toLocaleString(regnumLocale(language))} м²</dd></div><div><dt>{t.rooms}</dt><dd>{unit.rooms}</dd></div><div><dt>{t.floorShort}</dt><dd>{unit.floor}</dd></div><div><dt>{t.queueShort} / {t.sectionShort}</dt><dd>{unit.queue} / {unit.section}</dd></div><div><dt>{t.completionShort}</dt><dd>{unit.completion}</dd></div><div><dt>{t.status}</dt><dd>{t.available}</dd></div></dl>
    <strong>{priceOnRequest(language)}</strong><button className="rpc-detail__lead" type="button" data-lead-trigger onClick={(event) => onLead(unit, event.currentTarget)}>{t.matrixLead}<span>↗</span></button>
  </aside>;
  return mobile ? <div className="rpc-detail-layer" aria-hidden={covered || undefined} inert={covered ? true : undefined}><button type="button" className="rpc-detail-layer__backdrop" tabIndex={-1} onClick={onClose} aria-label={t.closeDetail} />{content}</div> : content;
}

function Matrix({ snapshot, units, matchedIds, rankById, language, selection, onSelection }: { snapshot: Snapshot; units: RegnumUnit[]; matchedIds: Set<string>; rankById: ReadonlyMap<string, number>; language: Language; selection: Selection | null; onSelection: (selection: Selection | null) => void }) {
  const t = copy[language]; const scrollRef = useRef<HTMLDivElement>(null); const [edges, setEdges] = useState({ left: true, right: false }); const byId = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const updateEdges = useCallback(() => { const node = scrollRef.current; if (!node) return; setEdges({ left: node.scrollLeft <= 2, right: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2 }); }, []);
  useEffect(() => { const node = scrollRef.current; if (!node) return; updateEdges(); const observer = new ResizeObserver(updateEdges); observer.observe(node); node.addEventListener('scroll', updateEdges, { passive: true }); return () => { observer.disconnect(); node.removeEventListener('scroll', updateEdges); }; }, [updateEdges]);
  const move = (direction: number) => scrollRef.current?.scrollBy({ left: direction * Math.max(290, scrollRef.current.clientWidth * .72), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const keyScroll = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const node = scrollRef.current; if (!node) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'Home') { event.preventDefault(); node.scrollTo({ left: 0 }); }
    if (event.key === 'End') { event.preventDefault(); node.scrollTo({ left: node.scrollWidth }); }
  };
  const activate = (unit: RegnumUnit, button: HTMLButtonElement) => {
    rememberRegnumUnit(unit);
    onSelection({ unit, opener: button });
  };
  return <div className="rpc-matrix-layout">
    <section className="rpc-matrix" aria-labelledby="rpc-matrix-title">
      <header><div><h2 id="rpc-matrix-title">{t.matrixTitle}</h2><p>{t.matrixText}</p></div><div><button type="button" onClick={() => move(-1)} disabled={edges.left} aria-label={t.scrollLeft}>←</button><button type="button" onClick={() => move(1)} disabled={edges.right} aria-label={t.scrollRight}>→</button></div></header>
      <p className="rpc-matrix__help">{t.matrixHelp}</p>
      <div ref={scrollRef} className="rpc-matrix__scroll" tabIndex={0} onKeyDown={keyScroll} aria-label={t.matrixHelp}>
        {snapshot.matrix.groups.map((group) => {
          const rows = snapshot.matrix.rows.filter((row) => row.groupId === group.id); const groupMatchCount = group.unitIds.filter((id) => matchedIds.has(id)).length;
          return <section key={group.id} className="rpc-matrix-panel" aria-labelledby={`rpc-group-${group.id}`}>
            <header><div><span>Q{group.queue}</span><h3 id={`rpc-group-${group.id}`}>{t.queueShort} {group.queue} · {t.sectionShort} {group.section}</h3></div><strong>{groupMatchCount} {t.matched}</strong></header>
            <div className="rpc-matrix-panel__rows">{rows.map((row) => {
              const orderedIds = [...row.unitIds].sort((leftId, rightId) => {
                const leftRank = rankById.get(leftId); const rightRank = rankById.get(rightId);
                if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
                if (leftRank !== undefined) return -1;
                if (rightRank !== undefined) return 1;
                return byId.get(leftId)!.sourceOrder - byId.get(rightId)!.sourceOrder;
              });
              return <div className="rpc-matrix-row" key={row.id} data-row-id={row.id}><span>{t.row} {row.floor}</span><div>{orderedIds.map((id) => { const unit = byId.get(id)!; const matches = matchedIds.has(id); return <button key={id} data-unit-id={id} type="button" className={`${matches ? '' : 'is-filtered'} ${selection?.unit.id === id ? 'is-selected' : ''}`} disabled={!matches} onClick={(event) => activate(unit, event.currentTarget)} aria-label={`${t.openUnit}: ${t.number}${unit.number}, ${unit.rooms} ${t.roomsShort}, ${unit.area} m²`}><strong>№{unit.number}</strong><small>{unit.rooms} {t.roomsShort} · {unit.area} м²</small><em>{priceOnRequest(language)}</em></button>; })}</div></div>;
            })}</div>
          </section>;
        })}
      </div>
    </section>
  </div>;
}

export function RegnumCatalog({ snapshot: embeddedSnapshot, initialLanguage }: { snapshot: Snapshot; initialLanguage: Language }) {
  const { data: snapshot } = useLiveCatalogSnapshot('regnum-plaza', embeddedSnapshot);
  const [language, setLanguage] = useLanguage(initialLanguage); const mobile = useMobile(); const t = copy[language];
  const heroFacts = useMemo(() => {
    const rooms = snapshot.units.map((unit) => unit.rooms).filter(Number.isFinite);
    const areas = snapshot.units.map((unit) => unit.area).filter(Number.isFinite);
    const roomRange = rooms.length ? `${Math.min(...rooms)}–${Math.max(...rooms)}` : '—';
    const areaRange = areas.length
      ? `${Math.min(...areas).toLocaleString(regnumLocale(language), { maximumFractionDigits: 2 })}–${Math.max(...areas).toLocaleString(regnumLocale(language), { maximumFractionDigits: 2 })} m²`
      : '—';
    return [[String(snapshot.units.length), t.facts[0][1]], [roomRange, t.facts[1][1]], [areaRange, t.facts[2][1]], t.facts[3]];
  }, [language, snapshot.units, t.facts]);
  const [mode, setMode] = useState<Mode>('cards'); const [sort, setSort] = useState<Sort>('source'); const [filters, setFilters] = useState<Filters>(defaultFilters); const [visible, setVisible] = useState(6); const [selection, setSelection] = useState<Selection | null>(null); const [plan, setPlan] = useState<Selection | null>(null); const [lead, setLead] = useState<LeadRequest | null>(null); const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const closeLead = useCallback(() => setLead(null), []); const closePlan = useCallback(() => setPlan(null), []); const closeSelection = useCallback(() => setSelection(null), []);
  useEffect(() => { document.body.classList.add('rpc-active'); return () => document.body.classList.remove('rpc-active'); }, []);

  const unique = useCallback((field: 'rooms' | 'floor' | 'queue' | 'section' | 'completion' | 'status') => [...new Set(snapshot.units.map((unit) => String(unit[field])))].sort((left, right) => Number(left) - Number(right)), [snapshot.units]);
  const filtered = useMemo(() => snapshot.units.filter((unit) => {
    const from = Number(filters.areaFrom); const to = Number(filters.areaTo);
    return (filters.rooms === 'all' || String(unit.rooms) === filters.rooms)
      && (!filters.areaFrom || unit.area >= from) && (!filters.areaTo || unit.area <= to)
      && (filters.floor === 'all' || String(unit.floor) === filters.floor)
      && (filters.queue === 'all' || String(unit.queue) === filters.queue)
      && (filters.section === 'all' || String(unit.section) === filters.section)
      && (filters.completion === 'all' || unit.completion === filters.completion)
      && (filters.status === 'all' || unit.status === filters.status);
  }), [filters, snapshot.units]);
  const sorted = useMemo(() => [...filtered].sort((left, right) => {
    const comparators: Record<Sort, number> = {
      source: left.sourceOrder - right.sourceOrder, priceAsc: left.priceRank - right.priceRank, priceDesc: right.priceRank - left.priceRank,
      areaAsc: left.area - right.area, areaDesc: right.area - left.area, floorAsc: left.floor - right.floor, floorDesc: right.floor - left.floor,
      roomsAsc: left.rooms - right.rooms, roomsDesc: right.rooms - left.rooms, ppmAsc: left.ppmRank - right.ppmRank, ppmDesc: right.ppmRank - left.ppmRank,
    }; return comparators[sort] || left.sourceOrder - right.sourceOrder;
  }), [filtered, sort]);
  const matchedIds = useMemo(() => new Set(filtered.map((unit) => unit.id)), [filtered]);
  const rankById = useMemo(() => new Map(sorted.map((unit, index) => [unit.id, index])), [sorted]);
  const resetResults = () => { setVisible(6); setSelection(null); };
  const setFilter = (key: keyof Filters, value: string) => { setFilters((current) => ({ ...current, [key]: value })); resetResults(); };
  const reset = () => { setFilters(defaultFilters); resetResults(); };
  const selectMode = (next: Mode) => { setMode(next); resetResults(); };
  const selectSort = (next: Sort) => { setSort(next); resetResults(); };
  const openLead = useCallback((surface: string, unit: RegnumUnit | null = null, opener: HTMLElement | null = document.activeElement as HTMLElement | null) => { if (unit) rememberRegnumUnit(unit); setLead({ surface, unit, opener }); }, []);
  const openPlan = useCallback((next: Selection) => { rememberRegnumUnit(next.unit); setPlan(next); }, []);
  const modeKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % modes.length; else if (event.key === 'ArrowLeft') next = (index - 1 + modes.length) % modes.length; else if (event.key === 'Home') next = 0; else if (event.key === 'End') next = modes.length - 1; else return;
    event.preventDefault(); selectMode(modes[next]); modeRefs.current[next]?.focus();
  };
  const mobileDetailOpen = mode === 'chess' && Boolean(selection) && mobile;

  return <div className="rpc-site" lang={language}>
    <a className="rpc-skip" href="#rpc-results" aria-hidden={mobileDetailOpen || undefined} inert={mobileDetailOpen ? true : undefined}>{t.skip}</a>
    <header id="top" className="rpc-header" aria-hidden={mobileDetailOpen || undefined} inert={mobileDetailOpen ? true : undefined}><a className="rpc-header__brand" href={withLanguage('/regnum-plaza', language)}><img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" /></a><nav aria-label={t.nav}><a href={withLanguage('/regnum-plaza', language)}>← {t.back}</a><a href="tel:+998781137712">+998 78 113 77 12</a></nav><div aria-label={t.language}>{languages.map((item) => <button key={item} type="button" className={item === language ? 'is-active' : ''} onClick={() => setLanguage(item)} aria-pressed={item === language}>{item.toUpperCase()}</button>)}</div><button type="button" data-lead-trigger onClick={() => openLead('catalog:header')}>{t.consult}<span>↗</span></button></header>

    <main aria-hidden={mobileDetailOpen || undefined} inert={mobileDetailOpen ? true : undefined}>
      <section className="rpc-hero"><picture><source media="(max-width: 700px)" srcSet={asset('/regnum-plaza/images/hero-mobile.webp')} /><img src={asset('/regnum-plaza/images/hero.webp')} width="1920" height="873" alt={t.heroAlt} /></picture><div className="rpc-hero__shade" /><div className="rpc-mobile-languages" aria-label={t.language}>{languages.map((item) => <button key={item} type="button" className={item === language ? 'is-active' : ''} onClick={() => setLanguage(item)} aria-pressed={item === language}>{item.toUpperCase()}</button>)}</div><div className="rpc-hero__copy"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.lead}</p><button type="button" data-lead-trigger onClick={() => openLead('catalog:hero')}>{t.heroLead}<b>↗</b></button></div><dl>{heroFacts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl></section>

      <section className="rpc-catalog" aria-labelledby="rpc-catalog-title">
        <div className="rpc-toolbar">
          <div className="rpc-modes" role="tablist" aria-label={t.modeLabel}>{modes.map((item, index) => <button key={item} ref={(node) => { modeRefs.current[index] = node; }} id={`rpc-tab-${item}`} type="button" role="tab" aria-selected={mode === item} aria-controls="rpc-results" tabIndex={mode === item ? 0 : -1} className={mode === item ? 'is-active' : ''} onClick={() => selectMode(item)} onKeyDown={(event) => modeKey(event, index)}>{t.modes[item]}</button>)}</div>
          <div className="rpc-result-count" aria-live="polite"><strong>{sorted.length}</strong> {t.results}</div>
        </div>

        <form className="rpc-filters" onSubmit={(event) => event.preventDefault()}>
          <header><h2 id="rpc-catalog-title">{t.filters}</h2><button type="button" onClick={reset}>{t.reset}</button></header>
          <div className="rpc-filters__grid">
            <label><span>{t.rooms}</span><select value={filters.rooms} onChange={(event) => setFilter('rooms', event.target.value)}><option value="all">{t.any}</option>{unique('rooms').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{t.areaFrom}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={filters.areaFrom} onChange={(event) => setFilter('areaFrom', event.target.value)} /></label>
            <label><span>{t.areaTo}</span><input type="number" min="0" step="0.01" inputMode="decimal" value={filters.areaTo} onChange={(event) => setFilter('areaTo', event.target.value)} /></label>
            <label><span>{t.floor}</span><select value={filters.floor} onChange={(event) => setFilter('floor', event.target.value)}><option value="all">{t.any}</option>{unique('floor').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{t.queue}</span><select value={filters.queue} onChange={(event) => setFilter('queue', event.target.value)}><option value="all">{t.any}</option>{unique('queue').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{t.section}</span><select value={filters.section} onChange={(event) => setFilter('section', event.target.value)}><option value="all">{t.any}</option>{unique('section').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{t.completion}</span><select value={filters.completion} onChange={(event) => setFilter('completion', event.target.value)}><option value="all">{t.any}</option>{unique('completion').map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label><span>{t.status}</span><select value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="all">{t.any}</option>{unique('status').map((value) => <option key={value} value={value}>{t.available}</option>)}</select></label>
            <label className="rpc-sort"><span>{t.sort}</span><select value={sort} onChange={(event) => selectSort(event.target.value as Sort)}>{(Object.keys(t.sorts) as Sort[]).map((value) => <option key={value} value={value}>{t.sorts[value]}</option>)}</select></label>
          </div>
          <p className="rpc-sort-note">{t.sortNote}</p>
        </form>

        <div id="rpc-results" role="tabpanel" aria-labelledby={`rpc-tab-${mode}`} tabIndex={0}>
          {!sorted.length ? <section className="rpc-empty"><span>00</span><h2>{t.emptyTitle}</h2><p>{t.emptyText}</p><div><button type="button" onClick={reset}>{t.reset}</button><button type="button" data-lead-trigger onClick={() => openLead('catalog:empty')}>{t.emptyLead}<span>↗</span></button></div></section> : mode === 'cards' ? <>
            <div className="rpc-cards">{sorted.slice(0, visible).map((unit) => <article key={unit.id}>
              {unit.planPublicPath ? <button className="rpc-card__plan" type="button" onClick={(event) => openPlan({ unit, opener: event.currentTarget })} aria-label={`${t.openPlan}: ${t.number}${unit.number}`}><img src={asset(unit.planPublicPath)} width={unit.planWidth!} height={unit.planHeight!} loading="lazy" alt={`${t.planDialog} · ${t.number}${unit.number}`} /><span>{t.openPlan} ↗</span></button> : <PlanPlaceholder text={t.missingPlan} />}
              <header><div><span>{t.number}{unit.number}</span><strong>{unit.rooms} {t.roomsShort}</strong></div><em>{t.available}</em></header>
              <dl><div><dt>{t.area}</dt><dd>{unit.area.toLocaleString(regnumLocale(language))} м²</dd></div><div><dt>{t.floorShort}</dt><dd>{unit.floor}</dd></div><div><dt>{t.queueShort} / {t.sectionShort}</dt><dd>{unit.queue} / {unit.section}</dd></div><div><dt>{t.completionShort}</dt><dd>{unit.completion}</dd></div></dl>
              <p>{priceOnRequest(language)}</p><button className="rpc-card__lead" type="button" data-lead-trigger onClick={(event) => openLead('catalog:card', unit, event.currentTarget)}>{t.ask}<span>↗</span></button>
            </article>)}</div>
            <div className="rpc-showing"><span>{t.showing} {Math.min(visible, sorted.length)} {t.of} {sorted.length}</span>{visible < sorted.length ? <button type="button" onClick={() => setVisible(12)}>{t.showMore}<b>↓</b></button> : null}</div>
          </> : <div className={`rpc-matrix-shell ${selection ? 'has-detail' : ''}`}>
            <Matrix snapshot={snapshot} units={snapshot.units as RegnumUnit[]} matchedIds={matchedIds} rankById={rankById} language={language} selection={selection} onSelection={setSelection} />
            {selection && !mobile ? <UnitDetail selection={selection} language={language} mobile={false} covered={Boolean(plan || lead)} onClose={closeSelection} onPlan={openPlan} onLead={(unit, opener) => openLead('catalog:matrix', unit, opener)} /> : null}
          </div>}
        </div>
      </section>

      <section className="rpc-footer-cta"><div><span>REGNUM PLAZA · SAYRAM</span><h2>{t.footerTitle}</h2><p>{t.footerText}</p><button type="button" data-lead-trigger onClick={() => openLead('catalog:footer')}>{t.consult}<b>↗</b></button></div><a href="tel:+998781137712">+998 78 113 77 12 <span>↗</span></a><footer><img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" /><nav><a href={`${appBasePath}/privacy?project=regnum-plaza&lang=${language}&from=catalog`}>{t.privacy}</a><a href="#top">{t.top}</a></nav></footer></section>
    </main>

    {mode === 'chess' && selection && mobile ? <UnitDetail selection={selection} language={language} mobile covered={Boolean(plan || lead)} onClose={closeSelection} onPlan={openPlan} onLead={(unit, opener) => openLead('catalog:matrix', unit, opener)} /> : null}
    {plan ? <PlanLightbox selection={plan} language={language} covered={Boolean(lead)} onClose={closePlan} onLead={(unit, opener) => openLead('catalog:plan', unit, opener)} /> : null}
    {lead ? <LeadModal open language={language} context={regnumLeadContext(lead.surface, language, lead.unit)} brandName="MURAD BUILDINGS" projectName="REGNUM PLAZA" tagline={t.formTagline} facts={t.formFacts} submitUrl={regnumLeadSubmitUrl()} projectSlug="regnum-plaza" {...catalogLeadIdentity(lead.unit)} privacyUrl={`${appBasePath}/privacy?project=regnum-plaza&lang=${language}&from=catalog`} requireConsent returnFocusTo={lead.opener} onClose={closeLead} /> : null}
  </div>;
}
