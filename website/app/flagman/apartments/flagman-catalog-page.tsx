'use client';

/* eslint-disable @next/next/no-img-element */

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess';
type Sort = 'priceAsc' | 'priceDesc' | 'areaAsc' | 'areaDesc' | 'floorAsc';
type UnitStatus = 'available';

export type FlagmanUnit = {
  id: string;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  maxFloor: number;
  entrance: number;
  status: UnitStatus;
  price: number;
  regularPrice: number;
  pricePerM2: number;
  currency: string;
  plan: string;
  sourcePlan: string;
};

export type FlagmanCatalogSnapshot = {
  project: { slug: string; name: string; realEstateUUID: string; companyId: string; propertyType: string; address: string; class: string; buildingFloors: number; catalogMaxFloor: number; status: string };
  capturedAt: string;
  source: { landing: string; catalog: string; visibleListingCount: number; note: string };
  units: FlagmanUnit[];
};

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];

const copy = {
  ru: {
    back: 'О проекте', project: 'FLAGMAN · ГОТОВЫЙ ДОМ', title: 'Выберите квартиру', accent: 'в частной галерее.', lead: 'Реальные предложения официального каталога — с точными планировками, площадями, этажами и ценами на дату snapshot.',
    modes: { cards: 'Карточки', chess: 'Шахматка' }, modeLabel: 'Режим каталога', language: 'Язык', filters: 'Фильтры', phase: 'Очередь / тип', allTypes: 'Все предложения', apartmentType: 'Готовый дом · квартиры', rooms: 'Комнаты', allRooms: 'Все', areaFrom: 'Площадь от', areaTo: 'Площадь до', status: 'Статус', allPublished: 'Все опубликованные', available: 'В продаже', floor: 'Этаж', allFloors: 'Все этажи', sort: 'Сортировка', reset: 'Сбросить', result: 'предложений',
    sorts: { priceAsc: 'Сначала дешевле', priceDesc: 'Сначала дороже', areaAsc: 'Площадь по возрастанию', areaDesc: 'Площадь по убыванию', floorAsc: 'Сначала нижние этажи' }, snapshot: 'Официальный snapshot', captured: 'Срез каталога', sourceNote: 'В snapshot входят только 8 предложений, которые официальный каталог показывал на дату проверки. Снятые, проданные и забронированные квартиры не реконструируются.',
    active: 'В продаже', currentPrice: 'Цена каталога на дату snapshot', regularPrice: 'Цена до акции', perM2: 'за м²', apartment: '3-комн.', entrance: 'подъезд', plan: 'Увеличить планировку', choose: 'Выбрать квартиру', showMore: 'Показать ещё', noResults: 'По этим параметрам предложений нет.', resetFilters: 'Сбросить фильтры', previous: 'Прокрутить влево', next: 'Прокрутить вправо', offers: 'Опубликованные предложения', selected: 'Выбранная квартира', details: 'Детали квартиры', close: 'Закрыть', consult: 'Получить консультацию', sourceCaveat: 'Пустые позиции и недоступные статусы не выдумываются.',
  },
  uz: {
    back: 'Loyiha haqida', project: 'FLAGMAN · TAYYOR UY', title: 'Xususiy galereyadagi', accent: 'xonadonni tanlang.', lead: 'Rasmiy katalogdagi haqiqiy takliflar — snapshot sanasidagi aniq rejalar, maydonlar, qavatlar va narxlar bilan.',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka' }, modeLabel: 'Katalog ko‘rinishi', language: 'Til', filters: 'Filtrlar', phase: 'Navbat / tur', allTypes: 'Barcha takliflar', apartmentType: 'Tayyor uy · xonadonlar', rooms: 'Xonalar', allRooms: 'Barchasi', areaFrom: 'Maydon, dan', areaTo: 'Maydon, gacha', status: 'Holat', allPublished: 'Barcha e’lonlar', available: 'Sotuvda', floor: 'Qavat', allFloors: 'Barcha qavatlar', sort: 'Saralash', reset: 'Tozalash', result: 'ta taklif',
    sorts: { priceAsc: 'Arzonidan boshlab', priceDesc: 'Qimmatidan boshlab', areaAsc: 'Maydon o‘sishi bo‘yicha', areaDesc: 'Maydon kamayishi bo‘yicha', floorAsc: 'Quyi qavatlar avval' }, snapshot: 'Rasmiy snapshot', captured: 'Katalog snapshoti', sourceNote: 'Snapshotga tekshiruv sanasida rasmiy katalog ko‘rsatgan 8 ta taklif kiritilgan. E’londan olingan, sotilgan va band xonadonlar qayta yaratilmaydi.',
    active: 'Sotuvda', currentPrice: 'Snapshot sanasidagi katalog narxi', regularPrice: 'Aksiyagacha narx', perM2: 'm² uchun', apartment: '3-xonali', entrance: 'kirish', plan: 'Rejani kattalashtirish', choose: 'Xonadonni tanlash', showMore: 'Yana ko‘rsatish', noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', resetFilters: 'Filtrlarni tozalash', previous: 'Chapga surish', next: 'O‘ngga surish', offers: 'E’lon qilingan takliflar', selected: 'Tanlangan xonadon', details: 'Xonadon tafsilotlari', close: 'Yopish', consult: 'Maslahat olish', sourceCaveat: 'Bo‘sh joylar va mavjud bo‘lmagan holatlar to‘qib chiqarilmaydi.',
  },
  en: {
    back: 'About the project', project: 'FLAGMAN · COMPLETED', title: 'Choose an apartment', accent: 'in a private gallery.', lead: 'Real official-catalogue listings with exact plans, areas, floors and prices at the snapshot date.',
    modes: { cards: 'Cards', chess: 'Matrix' }, modeLabel: 'Catalogue view', language: 'Language', filters: 'Filters', phase: 'Phase / type', allTypes: 'All listings', apartmentType: 'Completed · apartments', rooms: 'Rooms', allRooms: 'All', areaFrom: 'Area from', areaTo: 'Area to', status: 'Status', allPublished: 'All published', available: 'For sale', floor: 'Floor', allFloors: 'All floors', sort: 'Sort', reset: 'Reset', result: 'listings',
    sorts: { priceAsc: 'Lowest price first', priceDesc: 'Highest price first', areaAsc: 'Area ascending', areaDesc: 'Area descending', floorAsc: 'Lower floors first' }, snapshot: 'Official snapshot', captured: 'Catalogue snapshot', sourceNote: 'The snapshot contains only the 8 listings shown by the official catalogue on the verification date. Withdrawn, sold and reserved inventory is not reconstructed.',
    active: 'For sale', currentPrice: 'Catalogue price at snapshot date', regularPrice: 'Pre-offer price', perM2: 'per m²', apartment: '3-room', entrance: 'entrance', plan: 'Enlarge plan', choose: 'Choose apartment', showMore: 'Show more', noResults: 'No listings match these parameters.', resetFilters: 'Reset filters', previous: 'Scroll left', next: 'Scroll right', offers: 'Published listings', selected: 'Selected apartment', details: 'Apartment details', close: 'Close', consult: 'Request a consultation', sourceCaveat: 'Missing positions and unavailable statuses are not invented.',
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${appBasePath}/privacy?project=flagman&lang=${language}&from=catalog`; }
function money(value: number, language: Language) {
  const locale = language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US';
  return `${new Intl.NumberFormat(locale).format(value)} UZS`;
}
function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}

function useLanguage(initialLanguage: Language = 'ru') {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = window.localStorage.getItem('flagman-language');
    const next = languages.includes(query as Language) ? query : saved;
    const frame = window.requestAnimationFrame(() => { if (languages.includes(next as Language)) setLanguageState(next as Language); });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem('flagman-language', next);
    const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState({}, '', url);
  };
  return [language, setLanguage] as const;
}

function PlanButton({ unit, label, onOpen }: { unit: FlagmanUnit; label: string; onOpen: () => void }) {
  return <button className="flagman-unit-plan" type="button" onClick={onOpen} aria-label={`${label} № ${unit.number}`}><img src={asset(unit.plan)} alt={`Flagman · № ${unit.number}`} loading="lazy" decoding="async" /><span aria-hidden="true">↗</span></button>;
}

function UnitDetail({ unit, language, onPlan, onLead }: { unit: FlagmanUnit; language: Language; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  return <aside className="flagman-unit-detail" aria-label={t.details}>
    <header><small>{t.selected}</small><strong>№ {unit.number}</strong><span>{t.active}</span></header>
    <PlanButton unit={unit} label={t.plan} onOpen={onPlan} />
    <h3>{t.apartment} · {unit.area.toFixed(2)} м²</h3>
    <dl><div><dt>{t.floor}</dt><dd>{unit.floor} / {unit.maxFloor}</dd></div><div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div><div><dt>{t.status}</dt><dd>{t.active}</dd></div></dl>
    <div className="flagman-unit-detail__price"><small>{t.currentPrice}</small><strong>{money(unit.price, language)}</strong><span>{money(unit.pricePerM2, language)} {t.perM2}</span><del>{money(unit.regularPrice, language)}</del></div>
    <button className="flagman-catalog-primary" type="button" onClick={onLead}>{t.consult}<span>↗</span></button>
  </aside>;
}

function PlanLightbox({ unit, language, onClose }: { unit: FlagmanUnit; language: Language; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  useEffect(() => {
    closeRef.current?.focus(); document.body.classList.add('is-flagman-overlay');
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('is-flagman-overlay'); window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return <div className="flagman-plan-lightbox" role="dialog" aria-modal="true" aria-label={`${t.plan} № ${unit.number}`} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><button ref={closeRef} type="button" aria-label={t.close} onClick={onClose}>×</button><figure><img src={asset(unit.plan)} alt={`Flagman · № ${unit.number}`} /><figcaption><strong>№ {unit.number} · {unit.rooms} · {unit.area.toFixed(2)} м²</strong><span>{unit.floor}/{unit.maxFloor} {t.floor} · {unit.entrance} {t.entrance}</span></figcaption></figure></div>;
}

export function FlagmanCatalogPage({ snapshot, initialLanguage = 'ru' }: { snapshot: FlagmanCatalogSnapshot; initialLanguage?: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [mode, setMode] = useState<Mode>('cards');
  const [propertyType, setPropertyType] = useState<'all' | 'apartment'>('all');
  const [rooms, setRooms] = useState<'all' | 3>('all');
  const [areaFrom, setAreaFrom] = useState('');
  const [areaTo, setAreaTo] = useState('');
  const [status, setStatus] = useState<'all' | 'available'>('all');
  const [floor, setFloor] = useState<'all' | number>('all');
  const [sort, setSort] = useState<Sort>('priceAsc');
  const [visibleCount, setVisibleCount] = useState(6);
  const [selectedId, setSelectedId] = useState(snapshot.units[0]?.id);
  const [planUnit, setPlanUnit] = useState<FlagmanUnit>();
  const [leadUnit, setLeadUnit] = useState<FlagmanUnit>();
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const floors = useMemo(() => [...new Set(snapshot.units.map((unit) => unit.floor))].sort((a, b) => a - b), [snapshot.units]);

  const filtered = useMemo(() => {
    const min = Number(areaFrom) || 0;
    const max = Number(areaTo) || Infinity;
    const units = snapshot.units.filter((unit) => (propertyType === 'all' || snapshot.project.propertyType === propertyType) && (rooms === 'all' || unit.rooms === rooms) && unit.area >= min && unit.area <= max && (status === 'all' || unit.status === status) && (floor === 'all' || unit.floor === floor));
    return [...units].sort((a, b) => {
      if (sort === 'priceAsc') return a.price - b.price;
      if (sort === 'priceDesc') return b.price - a.price;
      if (sort === 'areaAsc') return a.area - b.area;
      if (sort === 'areaDesc') return b.area - a.area;
      return a.floor - b.floor || Number(a.number) - Number(b.number);
    });
  }, [snapshot, propertyType, rooms, areaFrom, areaTo, status, floor, sort]);
  const matrixFloors = useMemo(() => [...new Set(filtered.map((unit) => unit.floor))].sort((a, b) => b - a), [filtered]);
  const selected = filtered.find((unit) => unit.id === selectedId) ?? filtered[0];

  const reset = () => { setPropertyType('all'); setRooms('all'); setAreaFrom(''); setAreaTo(''); setStatus('all'); setFloor('all'); setSort('priceAsc'); setVisibleCount(6); };
  const scrollMatrix = (direction: number) => scrollRef.current?.scrollBy({ left: direction * Math.min(scrollRef.current.clientWidth * .8, 560), behavior: 'smooth' });
  const onMatrixKey = (event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === 'ArrowLeft') scrollMatrix(-1); if (event.key === 'ArrowRight') scrollMatrix(1); };
  const captured = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Tashkent' }).format(new Date(snapshot.capturedAt));

  return <main className="flagman-catalog" lang={language}>
    <header className="flagman-catalog-header">
      <a className="flagman-catalog-wordmark" href={withLanguage('/flagman', language)}>FLAGMAN<small>TASHKENT</small></a>
      <a className="flagman-catalog-back" href={withLanguage('/flagman', language)}>← {t.back}</a>
      <div className="flagman-catalog-language" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} onClick={() => setLanguage(item)} aria-pressed={item === language}>{item.toUpperCase()}</button>)}</div>
    </header>

    <section className="flagman-catalog-hero"><div><p>{t.project}</p><h1>{t.title}<em>{t.accent}</em></h1><span>{t.lead}</span></div><aside><small>{t.snapshot}</small><strong>{captured}</strong><span>{snapshot.units.length} / {snapshot.source.visibleListingCount}</span></aside></section>

    <section className="flagman-catalog-toolbar" aria-label={t.filters}>
      <div className="flagman-mode-switch" role="radiogroup" aria-label={t.modeLabel}>{(['cards', 'chess'] as Mode[]).map((item) => <button data-testid={`flagman-mode-${item}`} type="button" role="radio" aria-checked={mode === item} className={mode === item ? 'is-active' : ''} key={item} onClick={() => setMode(item)}>{t.modes[item]}</button>)}</div>
      <div className="flagman-filters">
        <label><span>{t.phase}</span><select value={propertyType} onChange={(event) => setPropertyType(event.target.value as 'all' | 'apartment')}><option value="all">{t.allTypes}</option><option value="apartment">{t.apartmentType}</option></select></label>
        <label><span>{t.rooms}</span><select value={rooms} onChange={(event) => setRooms(event.target.value === 'all' ? 'all' : 3)}><option value="all">{t.allRooms}</option><option value="3">3</option></select></label>
        <label><span>{t.areaFrom}</span><input type="number" min="0" inputMode="decimal" value={areaFrom} onChange={(event) => setAreaFrom(event.target.value)} placeholder="77" /></label>
        <label><span>{t.areaTo}</span><input type="number" min="0" inputMode="decimal" value={areaTo} onChange={(event) => setAreaTo(event.target.value)} placeholder="111" /></label>
        <label><span>{t.status}</span><select value={status} onChange={(event) => setStatus(event.target.value as 'all' | 'available')}><option value="all">{t.allPublished}</option><option value="available">{t.available}</option></select></label>
        <label><span>{t.floor}</span><select value={floor} onChange={(event) => setFloor(event.target.value === 'all' ? 'all' : Number(event.target.value))}><option value="all">{t.allFloors}</option>{floors.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
        <button className="flagman-filter-reset" type="button" onClick={reset}>{t.reset} ↺</button>
      </div>
    </section>

    <section className="flagman-results">
      <header><div><strong>{filtered.length}</strong><span>{t.result}</span></div><label><span>{t.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}>{Object.entries(t.sorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
      <div className="flagman-source-note"><span>i</span><p>{t.sourceNote} <b>{t.sourceCaveat}</b></p></div>

      {!filtered.length ? <div className="flagman-catalog-empty"><h2>{t.noResults}</h2><button type="button" onClick={reset}>{t.resetFilters}</button></div> : null}

      {mode === 'cards' && filtered.length ? <><div className="flagman-unit-grid">{filtered.slice(0, visibleCount).map((unit) => <article className="flagman-unit-card" key={unit.id}><div className="flagman-unit-card__top"><span>{snapshot.project.class}</span><span>{t.active}</span></div><PlanButton unit={unit} label={t.plan} onOpen={() => setPlanUnit(unit)} /><div className="flagman-unit-card__body"><small>FLAGMAN TASHKENT · № {unit.number}</small><h2>{t.apartment} · {unit.area.toFixed(2)} м²</h2><p>{unit.floor}/{unit.maxFloor} {t.floor} · {unit.entrance} {t.entrance}</p><div className="flagman-unit-card__price"><small>{t.currentPrice}</small><strong>{money(unit.price, language)}</strong><span>{money(unit.pricePerM2, language)} {t.perM2}</span><del>{t.regularPrice}: {money(unit.regularPrice, language)}</del></div><button type="button" onClick={() => setLeadUnit(unit)}>{t.choose}<span>↗</span></button></div></article>)}</div>{visibleCount < filtered.length ? <button className="flagman-load-more" type="button" onClick={() => setVisibleCount((count) => count + 6)}>{t.showMore}<span>{visibleCount} / {filtered.length}</span></button> : null}</> : null}

      {mode === 'chess' && filtered.length ? <section className="flagman-matrix"><header><div><small>{snapshot.project.class}</small><h2>{t.offers}</h2></div><div><button data-testid="flagman-scroll-left" type="button" aria-label={t.previous} onClick={() => scrollMatrix(-1)}>←</button><button data-testid="flagman-scroll-right" type="button" aria-label={t.next} onClick={() => scrollMatrix(1)}>→</button></div></header><div className="flagman-matrix-detail"><div ref={scrollRef} className="flagman-matrix-scroll" tabIndex={0} aria-label={t.offers} onKeyDown={onMatrixKey}><div className="flagman-matrix-table"><div className="flagman-matrix-caption"><span>{t.floor}</span><strong>{t.offers}</strong></div>{matrixFloors.map((value) => <div className="flagman-matrix-row" key={value}><div className="flagman-matrix-floor"><strong>{value}</strong><span>{t.floor}</span></div><div className="flagman-matrix-cells">{filtered.filter((unit) => unit.floor === value).sort((a, b) => Number(a.number) - Number(b.number)).map((unit) => <button type="button" key={unit.id} className={selected?.id === unit.id ? 'is-selected' : ''} aria-pressed={selected?.id === unit.id} onClick={() => setSelectedId(unit.id)}><small>№ {unit.number}</small><strong>{unit.rooms} · {unit.area.toFixed(2)} м²</strong><span>{money(unit.price, language)}</span></button>)}</div></div>)}</div></div>{selected ? <UnitDetail unit={selected} language={language} onPlan={() => setPlanUnit(selected)} onLead={() => setLeadUnit(selected)} /> : null}</div></section> : null}
    </section>

    <footer className="flagman-catalog-footer"><a className="flagman-catalog-wordmark" href={withLanguage('/flagman', language)}>FLAGMAN<small>TASHKENT</small></a><p>{t.sourceNote}</p><a href="tel:1360">1360</a></footer>
    {planUnit ? <PlanLightbox unit={planUnit} language={language} onClose={() => setPlanUnit(undefined)} /> : null}
    <LeadModal open={Boolean(leadUnit)} language={language} context={leadUnit ? `flagman:catalog:unit:${leadUnit.number}:source:${leadUnit.id}` : 'flagman:catalog'} projectName="FLAGMAN" hideBrand tagline={leadUnit ? `№ ${leadUnit.number} · ${leadUnit.rooms} · ${leadUnit.area.toFixed(2)} м²` : t.accent} facts={leadUnit ? [snapshot.project.class, `${leadUnit.floor}/${leadUnit.maxFloor} ${t.floor}`, money(leadUnit.price, language)] : undefined} submitUrl={leadSubmitUrl()} projectSlug="flagman" unitId={leadUnit?.id} privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadUnit(undefined)} />
  </main>;
}
