'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Mode = 'cards' | 'chess';
export type SadoUnit = {
  id: string; number: string; rooms: number; area: number; class: 'business' | 'comfort'; price: number | null; listPrice: number | null;
  block: string; floor: number; maxFloor: number; entrance: number; completion: string; status: 'available'; planUrl: string;
};
type Unit = SadoUnit;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];

const copy = {
  ru: {
    back: 'О проекте', title: 'Выберите пространство,', accent: 'которое услышит вас.', lead: 'Реальные предложения из официального каталога Sad’O — с точными планировками, этажами, площадями и ценами на дату snapshot.',
    modes: { cards: 'Карточки', chess: 'Шахматка' }, modeLabel: 'Режим каталога', filters: 'Фильтры', queue: 'Очередь', allQueues: 'Все очереди', class: 'Класс', allClasses: 'Business и Comfort', business: 'Business', comfort: 'Comfort', rooms: 'Комнаты', area: 'Площадь, м²', areaFrom: 'От', areaTo: 'До', status: 'Статус', allActive: 'В продаже', priceRequestOnly: 'Цена по запросу', reset: 'Сбросить', result: 'предложений',
    sort: 'Сортировка', sorts: { priceAsc: 'Сначала дешевле', priceDesc: 'Сначала дороже', areaAsc: 'Площадь по возрастанию', areaDesc: 'Площадь по убыванию', floorAsc: 'Сначала нижние этажи' }, snapshot: 'Официальный snapshot', sourceNote: 'Официальный каталог показывает выставленные предложения. Проданные и снятые с публикации объекты в snapshot не входят.',
    active: 'В продаже', requestPrice: 'Цена по запросу', apartment: 'квартира', floor: 'этаж', entrance: 'подъезд', due: 'Срок', pricePer: 'за м²', openPlan: 'Увеличить планировку', choose: 'Выбрать', detail: 'Детали квартиры', consult: 'Получить консультацию', close: 'Закрыть', showMore: 'Показать ещё', noResults: 'По этим параметрам предложений нет.', tryReset: 'Сбросить фильтры', previous: 'Прокрутить влево', next: 'Прокрутить вправо', level: 'Этаж', units: 'Квартиры', selected: 'Выбранная квартира', promoSnapshot: 'Стоимость на дату snapshot', project: "Sad'O · Яшнабад", language: 'Язык',
  },
  uz: {
    back: 'Loyiha haqida', title: 'Sizni tinglaydigan', accent: 'makonni tanlang.', lead: 'Sad’O rasmiy katalogidagi haqiqiy takliflar — aniq rejalar, qavatlar, maydonlar va snapshot sanasidagi narxlar bilan.',
    modes: { cards: 'Kartalar', chess: 'Shaxmatka' }, modeLabel: 'Katalog ko‘rinishi', filters: 'Filtrlar', queue: 'Navbat', allQueues: 'Barcha navbatlar', class: 'Klass', allClasses: 'Business va Comfort', business: 'Business', comfort: 'Comfort', rooms: 'Xonalar', area: 'Maydon, m²', areaFrom: 'Dan', areaTo: 'Gacha', status: 'Holat', allActive: 'Sotuvda', priceRequestOnly: 'Narx so‘rov bo‘yicha', reset: 'Tozalash', result: 'ta taklif',
    sort: 'Saralash', sorts: { priceAsc: 'Arzonidan boshlab', priceDesc: 'Qimmatidan boshlab', areaAsc: 'Maydon o‘sishi bo‘yicha', areaDesc: 'Maydon kamayishi bo‘yicha', floorAsc: 'Quyi qavatlar avval' }, snapshot: 'Rasmiy snapshot', sourceNote: 'Rasmiy katalog faqat e’lon qilingan takliflarni ko‘rsatadi. Sotilgan va e’londan olingan obyektlar snapshotga kirmaydi.',
    active: 'Sotuvda', requestPrice: 'Narx so‘rov bo‘yicha', apartment: 'xonadon', floor: 'qavat', entrance: 'kirish', due: 'Muddat', pricePer: 'm² uchun', openPlan: 'Rejani kattalashtirish', choose: 'Tanlash', detail: 'Xonadon tafsilotlari', consult: 'Maslahat olish', close: 'Yopish', showMore: 'Yana ko‘rsatish', noResults: 'Bu parametrlar bo‘yicha taklif yo‘q.', tryReset: 'Filtrlarni tozalash', previous: 'Chapga surish', next: 'O‘ngga surish', level: 'Qavat', units: 'Xonadonlar', selected: 'Tanlangan xonadon', promoSnapshot: 'Snapshot sanasidagi narx', project: "Sad'O · Yashnobod", language: 'Til',
  },
  en: {
    back: 'About the project', title: 'Choose a space', accent: 'that listens to you.', lead: 'Real Sad’O listings from the official catalogue, with exact plans, floors, areas and prices at the snapshot date.',
    modes: { cards: 'Cards', chess: 'Chess' }, modeLabel: 'Catalogue view', filters: 'Filters', queue: 'Phase', allQueues: 'All phases', class: 'Class', allClasses: 'Business and Comfort', business: 'Business', comfort: 'Comfort', rooms: 'Rooms', area: 'Area, m²', areaFrom: 'From', areaTo: 'To', status: 'Status', allActive: 'For sale', priceRequestOnly: 'Price on request', reset: 'Reset', result: 'listings',
    sort: 'Sort', sorts: { priceAsc: 'Lowest price first', priceDesc: 'Highest price first', areaAsc: 'Area ascending', areaDesc: 'Area descending', floorAsc: 'Lower floors first' }, snapshot: 'Official snapshot', sourceNote: 'The official catalogue shows published listings. Sold and withdrawn properties are not included in the snapshot.',
    active: 'For sale', requestPrice: 'Price on request', apartment: 'apartment', floor: 'floor', entrance: 'entrance', due: 'Due', pricePer: 'per m²', openPlan: 'Enlarge plan', choose: 'Select', detail: 'Apartment details', consult: 'Request a consultation', close: 'Close', showMore: 'Show more', noResults: 'No listings match these parameters.', tryReset: 'Reset filters', previous: 'Scroll left', next: 'Scroll right', level: 'Floor', units: 'Apartments', selected: 'Selected apartment', promoSnapshot: 'Price at snapshot date', project: "Sad'O · Yashnabad", language: 'Language',
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function formatMoney(value: number, language: Language) { return `${new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US', { maximumFractionDigits: 0 }).format(value)} UZS`; }
function leadSubmitUrl() { return `${appBasePath}/v1/leads`; }
function classLabel(unit: Unit) { return unit.class === 'business' ? 'Business' : 'Comfort'; }

function UnitPlan({ unit, label, onOpen }: { unit: Unit; label: string; onOpen: () => void }) {
  return <button className="sado-unit-plan" type="button" onClick={onOpen} aria-label={`${label} № ${unit.number}`}><img src={asset(`/sado/plans/${unit.id}.webp`)} alt={`Sad'O · № ${unit.number}`} loading="lazy" /><span>⌕</span></button>;
}

function UnitDetail({ unit, language, onPlan, onLead }: { unit: Unit; language: Language; onPlan: () => void; onLead: () => void }) {
  const t = copy[language];
  const perM2 = unit.price ? Math.round(unit.price / unit.area) : null;
  return <aside className="sado-unit-detail" aria-label={t.detail}>
    <div className="sado-unit-detail__head"><small>{t.selected}</small><strong>№ {unit.number}</strong></div>
    <UnitPlan unit={unit} label={t.openPlan} onOpen={onPlan} />
    <div className="sado-unit-detail__tags"><span>{classLabel(unit)}</span><span>{t.active}</span></div>
    <h3>{unit.rooms}-{language === 'ru' ? 'комн.' : language === 'uz' ? 'xonali' : 'room'} · {unit.area.toFixed(2)} м²</h3>
    <dl><div><dt>{t.floor}</dt><dd>{unit.floor} / {unit.maxFloor}</dd></div><div><dt>{t.entrance}</dt><dd>{unit.entrance}</dd></div><div><dt>{t.due}</dt><dd>{unit.completion}</dd></div></dl>
    <div className="sado-unit-detail__price"><small>{t.promoSnapshot}</small><strong>{unit.price ? formatMoney(unit.price, language) : t.requestPrice}</strong>{perM2 ? <span>{formatMoney(perM2, language)} {t.pricePer}</span> : null}</div>
    <button className="sado-catalog-primary" type="button" onClick={onLead}>{t.consult}<span>↗</span></button>
  </aside>;
}

function MatrixGroup({ units, language, selectedId, onSelect, onPlan, onLead, index }: { units: Unit[]; language: Language; selectedId?: string; onSelect: (unit: Unit) => void; onPlan: (unit: Unit) => void; onLead: (unit: Unit) => void; index: number }) {
  const t = copy[language];
  const floors = [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a);
  const selected = units.find((unit) => unit.id === selectedId) ?? units[0];
  const scroll = (direction: number) => document.getElementById(`sado-matrix-${index}`)?.scrollBy({ left: direction * 520, behavior: 'smooth' });
  return <section className="sado-matrix-group">
    <div className="sado-matrix-group__head"><div><small>{classLabel(units[0])}</small><h2>{units[0].block}</h2></div><div className="sado-matrix-arrows"><button type="button" aria-label={t.previous} onClick={() => scroll(-1)}>←</button><button type="button" aria-label={t.next} onClick={() => scroll(1)}>→</button></div></div>
    <div className="sado-matrix-detail-layout">
      <div id={`sado-matrix-${index}`} className="sado-matrix-scroll" tabIndex={0} aria-label={`${t.units}: ${units[0].block}`}>
        <div className="sado-matrix-table">
          {floors.map((floor) => <div className="sado-matrix-row" key={floor}><div className="sado-matrix-floor"><strong>{floor}</strong><span>{t.level}</span></div><div className="sado-matrix-cells">{units.filter((unit) => unit.floor === floor).sort((a, b) => a.entrance - b.entrance || Number(a.number) - Number(b.number)).map((unit) => <button key={unit.id} type="button" className={selected?.id === unit.id ? 'is-selected' : ''} onClick={() => onSelect(unit)}><small>№ {unit.number} · {unit.entrance} {t.entrance}</small><strong>{unit.rooms} · {unit.area.toFixed(1)} м²</strong><span>{unit.price ? formatMoney(unit.price, language).replace(' UZS', '') : t.requestPrice}</span></button>)}</div></div>)}
        </div>
      </div>
      {selected ? <UnitDetail unit={selected} language={language} onPlan={() => onPlan(selected)} onLead={() => onLead(selected)} /> : null}
    </div>
  </section>;
}

export function SadoCatalogPage({ initialUnits, snapshotGeneratedAt, sourceCount }: { initialUnits: Unit[]; snapshotGeneratedAt: string; sourceCount: number }) {
  const [language, setLanguageState] = useState<Language>('ru');
  const [mode, setMode] = useState<Mode>('cards');
  const [queue, setQueue] = useState('all');
  const [propertyClass, setPropertyClass] = useState('all');
  const [rooms, setRooms] = useState<number[]>([]);
  const [areaMin, setAreaMin] = useState('');
  const [areaMax, setAreaMax] = useState('');
  const [status, setStatus] = useState<'available' | 'price-request'>('available');
  const [sort, setSort] = useState('priceAsc');
  const [visibleCount, setVisibleCount] = useState(24);
  const [selectedId, setSelectedId] = useState<string>();
  const [planUnit, setPlanUnit] = useState<Unit>();
  const [leadUnit, setLeadUnit] = useState<Unit>();
  const t = copy[language];
  const blocks = useMemo(() => [...new Set(initialUnits.map((unit) => unit.block))], [initialUnits]);

  useEffect(() => { const query = new URLSearchParams(window.location.search).get('lang'); const stored = window.localStorage.getItem('sado-language'); const next = languages.includes(query as Language) ? query : stored; const frame = window.requestAnimationFrame(() => { if (languages.includes(next as Language)) setLanguageState(next as Language); }); return () => window.cancelAnimationFrame(frame); }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPlanUnit(undefined); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  const filtered = useMemo(() => {
    const min = Number(areaMin) || 0; const max = Number(areaMax) || Infinity;
    const result = initialUnits.filter((unit) => (queue === 'all' || unit.block === queue) && (propertyClass === 'all' || unit.class === propertyClass) && (!rooms.length || rooms.includes(unit.rooms)) && unit.area >= min && unit.area <= max && (status === 'available' || unit.price == null));
    return [...result].sort((a, b) => {
      if (sort === 'priceAsc') return (a.price ?? Infinity) - (b.price ?? Infinity);
      if (sort === 'priceDesc') return (b.price ?? -1) - (a.price ?? -1);
      if (sort === 'areaAsc') return a.area - b.area;
      if (sort === 'areaDesc') return b.area - a.area;
      return a.floor - b.floor;
    });
  }, [initialUnits, queue, propertyClass, rooms, areaMin, areaMax, status, sort]);
  const groups = useMemo(() => blocks.map((block) => filtered.filter((unit) => unit.block === block)).filter((units) => units.length), [blocks, filtered]);
  const reset = () => { setQueue('all'); setPropertyClass('all'); setRooms([]); setAreaMin(''); setAreaMax(''); setStatus('available'); setVisibleCount(24); };
  const setLanguage = (next: Language) => { setLanguageState(next); window.localStorage.setItem('sado-language', next); const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState({}, '', url); };
  const snapshot = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-GB', { dateStyle: 'long', timeZone: 'Asia/Tashkent' }).format(new Date(snapshotGeneratedAt));

  return <main className="sado-catalog">
    <header className="sado-catalog-header"><a className="sado-logo" href={withLanguage('/sado', language)}><span>SAD</span><i>’</i><span>O</span></a><a href={withLanguage('/sado', language)}>← {t.back}</a><div className="sado-catalog-language" aria-label={t.language}>{languages.map((item) => <button key={item} type="button" className={item === language ? 'is-active' : ''} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div></header>
    <section className="sado-catalog-hero"><div><p>{t.project}</p><h1>{t.title}<em>{t.accent}</em></h1><span>{t.lead}</span></div><div className="sado-catalog-snapshot"><small>{t.snapshot}</small><strong>{snapshot}</strong><span>{sourceCount} / {sourceCount}</span></div></section>

    <section className="sado-catalog-toolbar" aria-label={t.filters}>
      <div className="sado-mode-switch" role="radiogroup" aria-label={t.modeLabel}>{(['cards', 'chess'] as Mode[]).map((item) => <button key={item} data-testid={`mode-${item}`} type="button" role="radio" aria-checked={mode === item} className={mode === item ? 'is-active' : ''} onClick={() => setMode(item)}>{t.modes[item]}</button>)}</div>
      <div className="sado-catalog-filters">
        <label><span>{t.queue}</span><select value={queue} onChange={(event) => { setQueue(event.target.value); setVisibleCount(24); }}><option value="all">{t.allQueues}</option>{blocks.map((block) => <option value={block} key={block}>{block}</option>)}</select></label>
        <label><span>{t.class}</span><select value={propertyClass} onChange={(event) => setPropertyClass(event.target.value)}><option value="all">{t.allClasses}</option><option value="business">{t.business}</option><option value="comfort">{t.comfort}</option></select></label>
        <fieldset><legend>{t.rooms}</legend><div>{[1, 2, 3, 4].map((value) => <button type="button" key={value} className={rooms.includes(value) ? 'is-active' : ''} aria-pressed={rooms.includes(value)} onClick={() => setRooms((current) => current.includes(value) ? current.filter((room) => room !== value) : [...current, value])}>{value}</button>)}</div></fieldset>
        <fieldset className="sado-area-filter"><legend>{t.area}</legend><div><input value={areaMin} onChange={(event) => setAreaMin(event.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={t.areaFrom} aria-label={t.areaFrom} /><input value={areaMax} onChange={(event) => setAreaMax(event.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder={t.areaTo} aria-label={t.areaTo} /></div></fieldset>
        <label><span>{t.status}</span><select value={status} onChange={(event) => setStatus(event.target.value as 'available' | 'price-request')}><option value="available">{t.allActive}</option><option value="price-request">{t.priceRequestOnly}</option></select></label>
        <button className="sado-filter-reset" type="button" onClick={reset}>{t.reset} ↺</button>
      </div>
    </section>

    <section className="sado-catalog-results">
      <div className="sado-catalog-results__head"><div><strong>{filtered.length}</strong><span>{t.result}</span></div><label><span>{t.sort}</span><select value={sort} onChange={(event) => setSort(event.target.value)}>{Object.entries(t.sorts).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
      <p className="sado-catalog-source-note"><span>i</span>{t.sourceNote}</p>
      {filtered.length === 0 ? <div className="sado-catalog-empty"><h2>{t.noResults}</h2><button type="button" onClick={reset}>{t.tryReset}</button></div> : null}
      {mode === 'cards' && filtered.length ? <><div className="sado-unit-grid">{filtered.slice(0, visibleCount).map((unit) => { const perM2 = unit.price ? Math.round(unit.price / unit.area) : null; return <article className="sado-unit-card" key={unit.id}><div className="sado-unit-card__top"><span>{classLabel(unit)}</span><span>{t.active}</span></div><UnitPlan unit={unit} label={t.openPlan} onOpen={() => setPlanUnit(unit)} /><div className="sado-unit-card__body"><small>{unit.block}</small><h2>{unit.rooms}-{language === 'ru' ? 'комн.' : language === 'uz' ? 'xonali' : 'room'} · {unit.area.toFixed(2)} м²</h2><p>№ {unit.number} · {unit.floor}/{unit.maxFloor} {t.floor} · {unit.entrance} {t.entrance}</p><div className="sado-unit-card__price"><strong>{unit.price ? formatMoney(unit.price, language) : t.requestPrice}</strong>{perM2 ? <span>{formatMoney(perM2, language)} {t.pricePer}</span> : null}</div><button type="button" onClick={() => setLeadUnit(unit)}>{t.choose}<span>↗</span></button></div></article>; })}</div>{visibleCount < filtered.length ? <button className="sado-load-more" type="button" onClick={() => setVisibleCount((count) => count + 24)}>{t.showMore}<span>{Math.min(visibleCount, filtered.length)} / {filtered.length}</span></button> : null}</> : null}
      {mode === 'chess' && filtered.length ? <div className="sado-matrices">{groups.map((units, index) => <MatrixGroup key={units[0].block} units={units} language={language} selectedId={selectedId} onSelect={(unit) => setSelectedId(unit.id)} onPlan={setPlanUnit} onLead={setLeadUnit} index={index} />)}</div> : null}
    </section>

    <footer className="sado-catalog-footer"><a className="sado-logo is-footer" href={withLanguage('/sado', language)}><span>SAD</span><i>’</i><span>O</span></a><p>{t.sourceNote}</p><a href="tel:1360">1360</a></footer>
    {planUnit ? <div className="sado-plan-lightbox" role="dialog" aria-modal="true" aria-label={`${t.openPlan} № ${planUnit.number}`} onClick={() => setPlanUnit(undefined)}><button type="button" aria-label={t.close} onClick={() => setPlanUnit(undefined)} autoFocus>×</button><figure onClick={(event) => event.stopPropagation()}><img src={asset(`/sado/plans/${planUnit.id}.webp`)} alt={`Sad'O · № ${planUnit.number}`} /><figcaption><strong>№ {planUnit.number} · {planUnit.rooms} · {planUnit.area.toFixed(2)} м²</strong><span>{planUnit.block} · {planUnit.floor}/{planUnit.maxFloor} {t.floor}</span></figcaption></figure></div> : null}
    <LeadModal open={Boolean(leadUnit)} language={language} context={leadUnit ? `sado:unit:${leadUnit.id}` : 'sado:catalog'} brandName="NRG-BI" projectName="Sad'O" tagline={leadUnit ? `№ ${leadUnit.number} · ${leadUnit.rooms} · ${leadUnit.area.toFixed(2)} м²` : t.accent} facts={leadUnit ? [classLabel(leadUnit), `${leadUnit.floor}/${leadUnit.maxFloor} ${t.floor}`, leadUnit.price ? formatMoney(leadUnit.price, language) : t.requestPrice] : undefined} submitUrl={leadSubmitUrl()} projectSlug="sado" unitId={leadUnit?.id} privacyUrl={`${appBasePath}/privacy?project=sado&lang=${language}&from=catalog`} requireConsent onClose={() => setLeadUnit(undefined)} />
  </main>;
}
