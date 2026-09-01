'use client';

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Lenis from 'lenis';
import { LeadModal, rememberLastViewedApartment } from '@/app/lead-modal';
import { catalogUnitAriaLabel } from './catalog-accessibility';
import { selectCatalogTimestamp } from './catalog-timestamp';
import { catalogUnitQuery, resolveCompositeCatalogUnit } from './catalog-url-state';
import type { MiradorExplorerSelection } from './mirador-block-explorer';
import { MIRADOR_BLOCK_PROVENANCE, type MiradorBlockNumber } from './mirador-block-data';
import type { OfiyatExplorerSelection, OfiyatExplorerUnit } from './ofiyat-block-explorer';
import { OfiyatGalleryLightbox } from './ofiyat-gallery-lightbox';
import { projectConfigs, type KayanLanguage, type KayanProjectSlug } from './project-data';

const MiradorBlockExplorer = dynamic(
  () => import('./mirador-block-explorer').then((module) => module.MiradorBlockExplorer),
  { ssr: false, loading: () => null },
);

const OfiyatBlockExplorer = dynamic(
  () => import('./ofiyat-block-explorer').then((module) => module.OfiyatBlockExplorer),
  { ssr: false, loading: () => null },
);

type UnitStatus = 'available' | 'reserved' | 'sold' | 'unavailable';
type CatalogMode = 'cards' | 'chess';
type RoomFilter = 'all' | number;
type FloorFilter = 'all' | number;
type EntranceFilter = 'all' | string;
type SortMode = 'status' | 'price-asc' | 'area-asc' | 'floor-desc';
type RouteSelectionContext = Partial<Record<'block' | 'phase' | 'entrance' | 'floor' | 'unit', string>>;

const CATALOG_CARD_PAGE_SIZE = 18;

type Phase = {
  id: number;
  slug: string;
  name: string;
  sourceId: string;
  propertyType: string;
  sortOrder: number;
  floorsTotal: number;
  totalUnits: number;
  availableUnits: number;
};

export type Project = {
  id: number;
  developerSlug: string;
  slug: KayanProjectSlug;
  name: string;
  totalUnits: number;
  availableUnits: number;
  updatedAt?: string;
  phases: Phase[];
};

type Unit = {
  id: number;
  sourceKey: string;
  projectSlug: KayanProjectSlug;
  phaseSlug: string;
  phaseName: string;
  propertyType: string;
  rawPropertyType: string;
  status: UnitStatus;
  rawStatus: string;
  number: string;
  entrance?: string;
  floor: number;
  area: number;
  rooms?: number;
  price?: number;
  pricePerM2?: number;
  currency: string;
  planImageUrl?: string;
  isActive: boolean;
  sourceUpdatedAt: string;
  updatedAt: string;
};

type Layout = {
  id: number;
  sourceId: string;
  projectSlug: KayanProjectSlug;
  phaseSlug: string;
  rooms?: number;
  availableCount: number;
  title: string;
  imageUrl: string;
  thumbnailUrl?: string;
};

export type CatalogBundle = { project: Project; units: Unit[]; layouts: Layout[] };

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const liveAPI = process.env.NEXT_PUBLIC_CATALOG_API_URL?.replace(/\/$/, '') ?? '';
const languages: KayanLanguage[] = ['ru', 'uz', 'en'];

const ui = {
  ru: {
    about: 'О проекте', details: 'Преимущества', contact: 'Контакты', choose: 'Выбрать квартиру', menu: 'Меню', close: 'Закрыть', skip: 'Перейти к содержанию',
    available: 'свободно', availableLong: 'свободных объектов', from: 'из', openProject: 'Перейти к выбору', scroll: 'Листайте',
    storyKicker: '01 · О ПРОЕКТЕ', detailsKicker: '02 · ДЕТАЛИ ПРОЕКТА', detailsTitle: 'Продумано вокруг', detailsAccent: 'повседневной жизни.',
    selectionKicker: '03 · ВЫБОР КВАРТИРЫ', selectionTitle: 'Найдите пространство,', selectionAccent: 'которое станет вашим.',
    consultationKicker: '04 · ПЕРСОНАЛЬНАЯ КОНСУЛЬТАЦИЯ', request: 'Оставить заявку', phone: 'Позвонить', backTop: 'Наверх ↑',
    newLife: 'Новый уровень жизни начинается здесь.', selectorBack: 'Вернуться к проекту', selectorKicker: 'ИНТЕРАКТИВНЫЙ КАТАЛОГ',
    selectorTitle: 'Выберите свою', selectorAccent: 'квартиру.', selectorLead: 'Актуальные площади, цены и статусы объектов проекта.',
    phase: 'Очередь или тип недвижимости', view: 'Режим каталога', plan: 'Планировка квартиры', cards: 'Карточки', chess: 'Шахматка', rooms: 'Комнаты', all: 'Все',
    onlyAvailable: 'Только свободные', onlyAvailableHint: 'скрыть проданные и забронированные', objects: 'объектов', floor: 'Этаж', level: 'Уровень',
    empty: 'По выбранным параметрам объектов нет.', corridor: 'холл · лифты · лестница', driveway: 'проезд', apartment: 'Квартира', parking: 'Машиноместо',
    area: 'Площадь', entrance: 'Подъезд', status: 'Статус', cost: 'Стоимость', askTerms: 'Уточнить условия', pickSimilar: 'Подобрать похожую', noPlan: 'Планировка для этого объекта пока не опубликована.',
    sourceLive: 'данные API обновлены сейчас', sourceSnapshot: 'проверенный снимок каталога', selectObject: 'Выберите объект', layoutExample: 'Типовая планировка', layoutDisclaimer: 'Пример планировки проекта. Фактическая схема выбранной квартиры уточняется у менеджера.', expandPlan: 'Увеличить', closePlan: 'Закрыть планировку', swipe: 'Листайте вбок', scrollBack: 'Прокрутить шахматку влево', scrollForward: 'Прокрутить шахматку вправо',
    entranceFilter: 'Подъезд', floorFilter: 'Этаж', sort: 'Сортировка', allEntrances: 'Все подъезды', allFloors: 'Все этажи', sortStatus: 'Сначала свободные', sortPrice: 'Сначала дешевле', sortArea: 'По площади', sortFloor: 'С верхних этажей', showMore: 'Показать ещё', showing: 'Показано', ofObjects: 'из', filters: 'Фильтры каталога', blockContext: 'Блок', phaseContext: 'Очередь', catalogContext: 'Каталог',
    statusLabels: { available: 'Свободно', reserved: 'Бронь', sold: 'Продано', unavailable: 'Не продаётся' },
  },
  uz: {
    about: 'Loyiha haqida', details: 'Afzalliklar', contact: 'Aloqa', choose: 'Xonadon tanlash', menu: 'Menyu', close: 'Yopish', skip: 'Asosiy mazmunga o‘tish',
    available: 'mavjud', availableLong: 'mavjud obyekt', from: 'jami', openProject: 'Tanlashga o‘tish', scroll: 'Pastga',
    storyKicker: '01 · LOYIHA HAQIDA', detailsKicker: '02 · LOYIHA TAFSILOTLARI', detailsTitle: 'Har bir detal', detailsAccent: 'kundalik hayot uchun.',
    selectionKicker: '03 · XONADON TANLASH', selectionTitle: 'O‘zingizniki bo‘ladigan', selectionAccent: 'makonni toping.',
    consultationKicker: '04 · SHAXSIY MASLAHAT', request: 'Ariza qoldirish', phone: 'Qo‘ng‘iroq qilish', backTop: 'Yuqoriga ↑',
    newLife: 'Hayotning yangi darajasi shu yerdan boshlanadi.', selectorBack: 'Loyihaga qaytish', selectorKicker: 'INTERAKTIV KATALOG',
    selectorTitle: 'O‘z xonadoningizni', selectorAccent: 'tanlang.', selectorLead: 'Loyihadagi obyektlarning dolzarb maydoni, narxi va holati.',
    phase: 'Bosqich yoki ko‘chmas mulk turi', view: 'Katalog ko‘rinishi', plan: 'Xonadon rejasi', cards: 'Kartalar', chess: 'Shaxmatka', rooms: 'Xonalar', all: 'Barchasi',
    onlyAvailable: 'Faqat mavjud', onlyAvailableHint: 'sotilgan va band obyektlarni yashirish', objects: 'obyekt', floor: 'Qavat', level: 'Daraja',
    empty: 'Tanlangan parametrlarga mos obyekt yo‘q.', corridor: 'xoll · liftlar · zina', driveway: 'yo‘lak', apartment: 'Xonadon', parking: 'Parking o‘rni',
    area: 'Maydon', entrance: 'Kirish', status: 'Holat', cost: 'Narxi', askTerms: 'Shartlarni aniqlash', pickSimilar: 'O‘xshashini tanlash', noPlan: 'Bu obyektning rejasi hozircha e’lon qilinmagan.',
    sourceLive: 'API ma’lumotlari hozir yangilandi', sourceSnapshot: 'tekshirilgan katalog nusxasi', selectObject: 'Obyektni tanlang', layoutExample: 'Namunaviy reja', layoutDisclaimer: 'Bu loyiha rejasining namunasi. Tanlangan xonadonning aniq rejasi menejer bilan aniqlashtiriladi.', expandPlan: 'Kattalashtirish', closePlan: 'Rejani yopish', swipe: 'Yon tomonga suring', scrollBack: 'Jadvalni chapga surish', scrollForward: 'Jadvalni o‘ngga surish',
    entranceFilter: 'Kirish', floorFilter: 'Qavat', sort: 'Saralash', allEntrances: 'Barcha kirishlar', allFloors: 'Barcha qavatlar', sortStatus: 'Avval mavjudlar', sortPrice: 'Avval arzonlari', sortArea: 'Maydon bo‘yicha', sortFloor: 'Yuqori qavatlardan', showMore: 'Yana ko‘rsatish', showing: 'Ko‘rsatildi', ofObjects: 'jami', filters: 'Katalog filtrlari', blockContext: 'Blok', phaseContext: 'Bosqich', catalogContext: 'Katalog',
    statusLabels: { available: 'Mavjud', reserved: 'Band', sold: 'Sotilgan', unavailable: 'Sotuvda emas' },
  },
  en: {
    about: 'About', details: 'Features', contact: 'Contact', choose: 'Choose an apartment', menu: 'Menu', close: 'Close', skip: 'Skip to content',
    available: 'available', availableLong: 'available properties', from: 'of', openProject: 'Start choosing', scroll: 'Scroll',
    storyKicker: '01 · ABOUT THE PROJECT', detailsKicker: '02 · PROJECT DETAILS', detailsTitle: 'Designed around', detailsAccent: 'everyday life.',
    selectionKicker: '03 · APARTMENT SELECTION', selectionTitle: 'Find a space', selectionAccent: 'to make your own.',
    consultationKicker: '04 · PERSONAL CONSULTATION', request: 'Submit a request', phone: 'Call us', backTop: 'Back to top ↑',
    newLife: 'A new level of life starts here.', selectorBack: 'Back to the project', selectorKicker: 'INTERACTIVE SHOWROOM',
    selectorTitle: 'Choose your', selectorAccent: 'apartment.', selectorLead: 'Current areas, prices and availability across the project.',
    phase: 'Phase or property type', view: 'Catalogue view', plan: 'Apartment plan', cards: 'Cards', chess: 'Availability grid', rooms: 'Rooms', all: 'All',
    onlyAvailable: 'Available only', onlyAvailableHint: 'hide sold and reserved properties', objects: 'properties', floor: 'Floor', level: 'Level',
    empty: 'No properties match the selected filters.', corridor: 'lobby · lifts · stairs', driveway: 'driveway', apartment: 'Apartment', parking: 'Parking space',
    area: 'Area', entrance: 'Entrance', status: 'Status', cost: 'Price', askTerms: 'Ask about terms', pickSimilar: 'Find a similar home', noPlan: 'A plan for this property has not been published yet.',
    sourceLive: 'live API data', sourceSnapshot: 'verified catalogue snapshot', selectObject: 'Select a property', layoutExample: 'Representative layout', layoutDisclaimer: 'Project layout example. Confirm the selected apartment’s exact plan with the project manager.', expandPlan: 'Enlarge', closePlan: 'Close layout', swipe: 'Swipe sideways', scrollBack: 'Scroll the grid left', scrollForward: 'Scroll the grid right',
    entranceFilter: 'Entrance', floorFilter: 'Floor', sort: 'Sort', allEntrances: 'All entrances', allFloors: 'All floors', sortStatus: 'Available first', sortPrice: 'Lowest price', sortArea: 'By area', sortFloor: 'Highest floors', showMore: 'Show more', showing: 'Showing', ofObjects: 'of', filters: 'Catalogue filters', blockContext: 'Block', phaseContext: 'Phase', catalogContext: 'Catalogue',
    statusLabels: { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Not for sale' },
  },
} as const;

async function fetchJSON<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function fetchLiveBundle(slug: KayanProjectSlug, signal: AbortSignal): Promise<CatalogBundle> {
  const project = await fetchJSON<Project>(`${liveAPI}/v1/projects/${slug}`, signal);
  const layouts = await fetchJSON<{ items: Layout[] }>(`${liveAPI}/v1/projects/${slug}/layouts`, signal);
  const units: Unit[] = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await fetchJSON<{ items: Unit[]; total: number }>(`${liveAPI}/v1/projects/${slug}/units?limit=${limit}&offset=${offset}`, signal);
    units.push(...page.items);
    if (units.length >= page.total) break;
  }
  return { project, units, layouts: layouts.items };
}

function useCatalogBundle(slug: KayanProjectSlug, initialBundle: CatalogBundle) {
  const [bundle, setBundle] = useState(initialBundle);
  const [dataSource, setDataSource] = useState<'snapshot' | 'live'>('snapshot');

  useEffect(() => {
    if (!liveAPI) return;
    const controller = new AbortController();
    fetchLiveBundle(slug, controller.signal)
      .then((next) => { setBundle(next); setDataSource('live'); })
      .catch(() => setDataSource('snapshot'));
    return () => controller.abort();
  }, [slug]);

  return { bundle, dataSource };
}

function useProjectSummary(slug: KayanProjectSlug, initialProject: Project) {
  const [project, setProject] = useState(initialProject);
  const [dataSource, setDataSource] = useState<'snapshot' | 'live'>('snapshot');

  useEffect(() => {
    if (!liveAPI) return;
    const controller = new AbortController();
    fetchJSON<Project>(`${liveAPI}/v1/projects/${slug}`, controller.signal)
      .then((next) => { setProject(next); setDataSource('live'); })
      .catch(() => setDataSource('snapshot'));
    return () => controller.abort();
  }, [slug]);

  return { project, dataSource };
}

function useProjectLanguage(initialLanguage: KayanLanguage = 'ru') {
  const [language, setLanguageState] = useState<KayanLanguage>(initialLanguage);
  useEffect(() => {
    const queryLanguage = new URLSearchParams(window.location.search).get('lang');
    const savedLanguage = window.localStorage.getItem('kayan-language');
    const next = languages.includes(queryLanguage as KayanLanguage) ? queryLanguage : savedLanguage;
    const frame = window.requestAnimationFrame(() => {
      if (languages.includes(next as KayanLanguage)) {
        setLanguageState(next as KayanLanguage);
        document.documentElement.lang = next as KayanLanguage;
      } else {
        document.documentElement.lang = 'ru';
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const setLanguage = (next: KayanLanguage) => {
    setLanguageState(next);
    document.documentElement.lang = next;
    window.localStorage.setItem('kayan-language', next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  };
  return [language, setLanguage] as const;
}

function useOverlayState(withLoader = true, loaderDuration = 950, loaderKey = 'kayan-loader-seen') {
  const [loading, setLoading] = useState(withLoader);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!withLoader) return;
    const loaderSeen = window.sessionStorage.getItem(loaderKey) === '1';
    if (loaderSeen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const frame = window.requestAnimationFrame(() => setLoading(false));
      return () => window.cancelAnimationFrame(frame);
    }
    document.body.classList.add('is-kayan-loading');
    const timer = window.setTimeout(() => {
      setLoading(false);
      window.sessionStorage.setItem(loaderKey, '1');
      document.body.classList.remove('is-kayan-loading');
    }, loaderDuration);
    return () => {
      window.clearTimeout(timer);
      document.body.classList.remove('is-kayan-loading');
    };
  }, [loaderDuration, loaderKey, withLoader]);
  useEffect(() => {
    document.body.classList.toggle('is-kayan-menu-open', menuOpen);
    return () => document.body.classList.remove('is-kayan-menu-open');
  }, [menuOpen]);
  return { loading, menuOpen, setMenuOpen };
}

function useSmoothMotion(dependency: string) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const lenis = new Lenis({
      autoRaf: true,
      autoToggle: true,
      anchors: { offset: -76 },
      lerp: 0.075,
      smoothWheel: true,
      wheelMultiplier: 0.88,
      stopInertiaOnNavigate: true,
    });
    return () => lenis.destroy();
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.13 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [dependency]);
}

function projectStyle(slug: KayanProjectSlug) {
  const palette = projectConfigs[slug].palette;
  return {
    '--kayan-ink': palette.ink,
    '--kayan-paper': palette.paper,
    '--kayan-paper-2': palette.paperAlt,
    '--kayan-accent': palette.accent,
    '--kayan-secondary': palette.secondary,
    '--kayan-menu': palette.menu,
  } as CSSProperties;
}

function routeTo(slug: KayanProjectSlug, suffix = '', language: KayanLanguage = 'ru', selection?: string | RouteSelectionContext) {
  const query = new URLSearchParams({ lang: language });
  if (typeof selection === 'string') query.set('phase', selection);
  else if (selection) Object.entries(selection).forEach(([key, value]) => { if (value) query.set(key, value); });
  return `${appBasePath}/${slug}${suffix}?${query}`;
}

function privacyRoute(slug: KayanProjectSlug, language: KayanLanguage, selection?: RouteSelectionContext) {
  const query = new URLSearchParams({ project: slug, lang: language });
  if (selection) Object.entries(selection).forEach(([key, value]) => { if (value) query.set(key, value); });
  return `${appBasePath}/privacy?${query}`;
}

function mediaURL(value: string | undefined) {
  if (!value) return undefined;
  return value.startsWith('/') ? `${appBasePath}${value}` : value;
}

function phaseLabel(phase: Phase, language: KayanLanguage) {
  if (phase.slug === 'business') return language === 'ru' ? 'Бизнес' : language === 'uz' ? 'Biznes' : 'Business';
  if (phase.slug === 'comfort-1') return language === 'ru' ? 'Комфорт I' : language === 'uz' ? 'Komfort I' : 'Comfort I';
  if (phase.slug === 'comfort-2') return language === 'ru' ? 'Комфорт II' : language === 'uz' ? 'Komfort II' : 'Comfort II';
  if (phase.slug === 'phase-1') return language === 'ru' ? 'I очередь' : language === 'uz' ? 'I bosqich' : 'Phase I';
  if (phase.slug === 'phase-2') return language === 'ru' ? 'II очередь' : language === 'uz' ? 'II bosqich' : 'Phase II';
  if (phase.slug === 'parking') return language === 'ru' ? 'Паркинг' : language === 'uz' ? 'Parking' : 'Parking';
  return phase.name;
}

function money(value: number | undefined, language: KayanLanguage) {
  if (!value) return language === 'ru' ? 'Цена по запросу' : language === 'uz' ? 'Narx so‘rov bo‘yicha' : 'Price on request';
  const locale = language === 'en' ? 'en-US' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const currency = language === 'en' ? 'UZS' : language === 'uz' ? 'so‘m' : 'сум';
  return `${new Intl.NumberFormat(locale).format(value)} ${currency}`;
}

function areaUnit(language: KayanLanguage) {
  return language === 'ru' ? 'м²' : 'm²';
}

function floorLabel(value: number) {
  return value < 0 ? `P${Math.abs(value)}` : `${value}`;
}

function representativeLayout(unit: Unit | undefined, layouts: Layout[]) {
  if (!unit || unit.propertyType === 'parking' || typeof unit.rooms !== 'number') return undefined;
  return layouts
    .filter((layout) => layout.phaseSlug === unit.phaseSlug && layout.rooms === unit.rooms && layout.imageUrl)
    .sort((a, b) => b.availableCount - a.availableCount || a.sourceId.localeCompare(b.sourceId, 'ru', { numeric: true }))[0];
}

function objectCountLabel(count: number, language: KayanLanguage) {
  if (language === 'en') return `${count} ${count === 1 ? 'property' : 'properties'}`;
  if (language === 'uz') return `${count} obyekt`;
  const mod10 = count % 10;
  const mod100 = count % 100;
  const noun = mod10 === 1 && mod100 !== 11 ? 'объект' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'объекта' : 'объектов';
  return `${count} ${noun}`;
}

function totalObjectCountLabel(count: number, language: KayanLanguage) {
  if (language === 'en') return `${count} total`;
  if (language === 'uz') return `jami ${count}`;
  return `${count} всего`;
}

function phaseAvailabilityLabel(count: number, language: KayanLanguage) {
  if (language === 'en') return `${count} available`;
  if (language === 'uz') return `${count} mavjud`;
  return `${count} свободно`;
}

function updateTimestamp(value: string | undefined, language: KayanLanguage) {
  if (!value) return '';
  const locale = language === 'en' ? 'en-GB' : language === 'uz' ? 'uz-UZ' : 'ru-RU';
  const formatted = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }).format(new Date(value));
  return language === 'ru' ? `Обновлено ${formatted}` : language === 'uz' ? `${formatted} da yangilangan` : `Updated ${formatted}`;
}

function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}

function firstCatalogUnit(units: Unit[], phaseSlug: string) {
  return [...units]
    .filter((unit) => unit.phaseSlug === phaseSlug)
    .sort((a, b) => Number(b.status === 'available') - Number(a.status === 'available') || b.floor - a.floor || a.number.localeCompare(b.number, 'ru', { numeric: true }))[0];
}

function ProjectImage({ src, mobileSrc, alt, className, loading = 'lazy' }: { src: string; mobileSrc?: string; alt: string; className?: string; loading?: 'eager' | 'lazy' }) {
  return <picture className={className ? `${className}-picture` : undefined}>
    {mobileSrc ? <source media="(max-width: 767px)" srcSet={`${appBasePath}${mobileSrc}`} /> : null}
    <img className={className} src={`${appBasePath}${src}`} alt={alt} loading={loading} decoding="async" />
  </picture>;
}

function KayanLoader({ visible, name, image, mobileImage }: { visible: boolean; name: string; image?: string | null; mobileImage?: string | null }) {
  return <div className={`kayan-loader ${visible ? 'is-visible' : ''}`} aria-hidden={!visible}>
    {image ? <ProjectImage className="kayan-loader__image" src={image} mobileSrc={mobileImage || undefined} alt="" loading="eager" /> : null}
    <div className="kayan-loader__shade" />
    <div className="kayan-loader__wordmark"><small className="kayan-loader__intro">Private residence · Tashkent</small><span>{name}</span><i /></div>
    <small className="kayan-loader__side kayan-loader__side--left">TASHKENT</small>
    <small className="kayan-loader__side kayan-loader__side--right">RESIDENCE</small>
    <div className="kayan-loader__count"><i />01</div>
  </div>;
}

function LanguageSwitcher({ language, onChange }: { language: KayanLanguage; onChange: (language: KayanLanguage) => void }) {
  const label = language === 'ru' ? 'Язык' : language === 'uz' ? 'Til' : 'Language';
  return <div className="kayan-languages" role="group" aria-label={label}>{languages.map((item) => <button type="button" key={item} aria-pressed={language === item} className={language === item ? 'is-active' : ''} onClick={() => onChange(item)}>{item.toUpperCase()}</button>)}</div>;
}

function ProjectBrand({ name }: { name: string }) {
  return <span className="kayan-brand"><i>{name.slice(0, 1)}</i><strong>{name}</strong><small>RESIDENCE</small></span>;
}

function ProjectMenu({ open, slug, language, onClose, onLead, routeContext }: { open: boolean; slug: KayanProjectSlug; language: KayanLanguage; onClose: () => void; onLead: () => void; routeContext?: RouteSelectionContext }) {
  const config = projectConfigs[slug];
  const t = ui[language];
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const openedNow = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (!open) return;
    const currentMenu = menuRef.current;
    if (openedNow) openerRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      window.requestAnimationFrame(() => {
        if (currentMenu?.getAttribute('aria-modal') === 'true') return;
        const anotherModalIsOpen = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
          .some((dialog) => dialog !== currentMenu);
        if (anotherModalIsOpen) return;
        const isLiveFocusTarget = (candidate: HTMLElement | null): candidate is HTMLElement => Boolean(
          candidate
          && candidate.isConnected
          && candidate.getClientRects().length
          && !candidate.closest('[inert],[aria-hidden="true"]')
          && candidate.matches('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'),
        );
        const liveMenuButton = Array.from(document.querySelectorAll<HTMLElement>('.kayan-menu-button')).find(isLiveFocusTarget) ?? null;
        const target = isLiveFocusTarget(openerRef.current) ? openerRef.current : liveMenuButton;
        target?.focus();
      });
    };
  }, [open]);
  return <div
    ref={menuRef}
    className={`kayan-menu ${open ? 'is-open' : ''}`}
    role={open ? 'dialog' : undefined}
    aria-modal={open || undefined}
    aria-label={t.menu}
    aria-hidden={!open}
    inert={!open ? true : undefined}
  >
    <button ref={closeRef} className="kayan-menu__close" type="button" onClick={onClose} aria-label={t.close}><i /><i /><span>{t.close}</span></button>
    <div className={`kayan-menu__visual ${config.heroImage ? '' : 'is-placeholder'}`}>
      {config.heroImage ? <ProjectImage src={config.heroImage} mobileSrc={config.heroMobileImage || undefined} alt="" /> : <span>{config.name}</span>}
      <small>{config.name} · RESIDENCE</small>
    </div>
    <nav aria-label={t.menu}>
      <a href={`${routeTo(slug, '', language, routeContext)}#about`} onClick={onClose}>{t.about}</a>
      <a href={`${routeTo(slug, '', language, routeContext)}#details`} onClick={onClose}>{t.details}</a>
      <a href={routeTo(slug, '/apartments', language, routeContext)} onClick={onClose}>{t.choose}</a>
      <button type="button" onClick={onLead}>{t.contact}</button>
    </nav>
    <a className="kayan-menu__phone" href="tel:+998781137712">+998 78 113 77 12</a>
  </div>;
}

function ProjectHeader({ slug, language, onLanguage, onMenu, onLead, selector = false, routeContext }: { slug: KayanProjectSlug; language: KayanLanguage; onLanguage: (language: KayanLanguage) => void; onMenu: () => void; onLead: () => void; selector?: boolean; routeContext?: RouteSelectionContext }) {
  const config = projectConfigs[slug];
  const t = ui[language];
  return <header className={`kayan-header ${selector ? 'is-selector' : ''}`}>
    <a href={routeTo(slug, '', language, routeContext)} aria-label={config.name}><ProjectBrand name={config.name} /></a>
    {!selector ? <nav aria-label={t.menu}><a href="#about">{t.about}</a><a href="#details">{t.details}</a><a href={routeTo(slug, '/apartments', language)}>{t.choose}</a></nav> : <a className="kayan-selector-back" href={routeTo(slug, '', language, routeContext)}>← {t.selectorBack}</a>}
    <div className="kayan-header__actions">
      <LanguageSwitcher language={language} onChange={onLanguage} />
      <button className="kayan-header__lead" type="button" onClick={onLead}>{t.request} ↗</button>
      <button className="kayan-menu-button" type="button" onClick={onMenu} aria-label={t.menu}><i /><i /><span>{t.menu}</span></button>
    </div>
  </header>;
}

function ProjectFooter({ slug, language, routeContext }: { slug: KayanProjectSlug; language: KayanLanguage; routeContext?: RouteSelectionContext }) {
  const config = projectConfigs[slug];
  const copy = config.copy[language];
  const t = ui[language];
  return <footer className="kayan-footer">
    <ProjectBrand name={config.name} />
    <p>{t.newLife}</p>
    <a href="tel:+998781137712">+998 78 113 77 12</a>
    <address>{copy.address.replaceAll(' · ', ', ')}</address>
    <a href={privacyRoute(slug, language, routeContext)}>{language === 'ru' ? 'Обработка данных' : language === 'uz' ? 'Ma’lumotlarni qayta ishlash' : 'Data processing'}</a>
    <a href="#top">{t.backTop}</a>
  </footer>;
}

const ofiyatLandingUi = {
  ru: {
    heroKicker: 'OFIYAT · ГОТОВАЯ СРЕДА', heroCta: 'Выбрать квартиру', heroNote: 'Дом для спокойной повседневной жизни',
    storyKicker: 'ДОМ, КОТОРЫЙ УЖЕ ЖИВЁТ', storyTitle: 'Не просто квадратные метры.', storyAccent: 'Среда для каждого дня.',
    galleryKicker: 'СЦЕНАРИИ СВЕТА', galleryTitle: 'Один дом.', galleryAccent: 'Разное настроение дня.', galleryLead: 'Архитектура меняется вместе со светом, а ощущение дома остаётся.', galleryOpen: 'Открыть рендер на весь экран', galleryClose: 'Закрыть галерею', galleryPrevious: 'Предыдущий рендер', galleryNext: 'Следующий рендер', renderLabel: 'Архитектурный рендер',
    scenes: [
      { label: 'Утро', title: 'Свет и новый ритм', description: 'Тёплое утро раскрывает светлую архитектуру и зелёное окружение комплекса.' },
      { label: 'День', title: 'Жизнь во дворе', description: 'Дневной сценарий — прогулки, зелень и пространство для повседневных дел.' },
      { label: 'Вечер', title: 'Дом, который встречает', description: 'Вечерний свет подчёркивает спокойный силуэт Ofiyat и возвращение домой.' },
    ],
    familyKicker: 'ДЛЯ СЕМЬИ', familyTitle: 'Двор, где детство', familyAccent: 'остаётся рядом.',
    whiteKicker: 'WHITE BOX', whiteTitle: 'Основа готова.', whiteAccent: 'Характер — ваш.', whiteLead: 'Основная подготовка уже выполнена — индивидуальный интерьер можно начать создавать быстрее.',
    whiteNotes: ['Готовая основа', 'Быстрее к интерьеру', 'Свобода решений'],
    parkingKicker: '200 МЕСТ', parkingTitle: 'Двор — людям.', parkingAccent: 'Автомобили — под землёй.', parkingLead: 'Подземный паркинг эффективно использует пространство и сохраняет внутреннюю территорию для жителей.',
    phasesKicker: 'ВЫБОР ОЧЕРЕДИ', phasesTitle: 'Две очереди.', phasesAccent: 'Один ритм жизни.', phasesLead: 'Сравните актуальное наличие в каждой очереди и отдельно выберите парковочное место.',
    available: 'свободно', openPhase: 'Смотреть объекты',
    catalogKicker: 'КАТАЛОГ КВАРТИР', catalogTitle: 'Пространство, которое', catalogAccent: 'подходит вашему дню.', catalogLead: 'Карточки с крупными планировками и шахматка — всё для удобного выбора на одной странице.', catalogCta: 'Открыть каталог',
    dataLive: 'Актуальные данные API', dataSnapshot: 'Проверенный снимок каталога', plansMarked: 'Типовые планы честно отмечены как примеры',
    mapKicker: 'РАСПОЛОЖЕНИЕ', mapTitle: 'Город рядом —', mapAccent: 'без суеты.', route: 'Построить маршрут',
  },
  uz: {
    heroKicker: 'OFIYAT · TAYYOR MUHIT', heroCta: 'Xonadon tanlash', heroNote: 'Sokin kundalik hayot uchun uy',
    storyKicker: 'HAYOT BOSHLANGAN UY', storyTitle: 'Faqat kvadrat metr emas.', storyAccent: 'Har kun uchun muhit.',
    galleryKicker: 'YORUG‘LIK SSENARIYLARI', galleryTitle: 'Bitta uy.', galleryAccent: 'Kunning turli kayfiyati.', galleryLead: 'Arxitektura yorug‘lik bilan o‘zgaradi, uy hissi esa saqlanib qoladi.', galleryOpen: 'Renderni to‘liq ekranda ochish', galleryClose: 'Galereyani yopish', galleryPrevious: 'Oldingi render', galleryNext: 'Keyingi render', renderLabel: 'Arxitektura renderi',
    scenes: [
      { label: 'Ertalab', title: 'Yorug‘lik va yangi ritm', description: 'Iliq tong majmuaning och rangli arxitekturasi va yashil muhitini ochib beradi.' },
      { label: 'Kunduz', title: 'Hovlidagi hayot', description: 'Kunduzgi ssenariy — sayr, yashillik va kundalik ishlar uchun makon.' },
      { label: 'Kechqurun', title: 'Kutib oladigan uy', description: 'Kechki yorug‘lik Ofiyatning sokin qiyofasi va uyga qaytish hissini ta’kidlaydi.' },
    ],
    familyKicker: 'OILA UCHUN', familyTitle: 'Bolalik doim', familyAccent: 'yaqin bo‘lgan hovli.',
    whiteKicker: 'WHITE BOX', whiteTitle: 'Asos tayyor.', whiteAccent: 'Xarakter — sizniki.', whiteLead: 'Asosiy tayyorgarlik bajarilgan — individual interyerni tezroq yaratishni boshlash mumkin.',
    whiteNotes: ['Tayyor asos', 'Interyerga tezroq', 'Yechimlar erkinligi'],
    parkingKicker: '200 O‘RIN', parkingTitle: 'Hovli — odamlar uchun.', parkingAccent: 'Avtomobillar — yer ostida.', parkingLead: 'Yer osti parkingi makondan samarali foydalanadi va ichki hududni yashovchilar uchun saqlaydi.',
    phasesKicker: 'BOSQICHNI TANLASH', phasesTitle: 'Ikki bosqich.', phasesAccent: 'Bitta hayot ritmi.', phasesLead: 'Har bir bosqichdagi dolzarb takliflarni solishtiring va parking o‘rnini alohida tanlang.',
    available: 'mavjud', openPhase: 'Obyektlarni ko‘rish',
    catalogKicker: 'XONADONLAR KATALOGI', catalogTitle: 'Kuningizga mos', catalogAccent: 'makonni toping.', catalogLead: 'Yirik rejali kartalar va shaxmatka — qulay tanlov uchun bitta sahifada.', catalogCta: 'Katalogni ochish',
    dataLive: 'Dolzarb API ma’lumotlari', dataSnapshot: 'Tekshirilgan katalog nusxasi', plansMarked: 'Namunaviy rejalar misol sifatida aniq belgilangan',
    mapKicker: 'JOYLASHUV', mapTitle: 'Shahar yaqin —', mapAccent: 'ortiqcha shovqinsiz.', route: 'Yo‘nalish qurish',
  },
  en: {
    heroKicker: 'OFIYAT · A READY ENVIRONMENT', heroCta: 'Choose an apartment', heroNote: 'A home for calm everyday life',
    storyKicker: 'A HOME ALREADY ALIVE', storyTitle: 'More than square metres.', storyAccent: 'A setting for every day.',
    galleryKicker: 'SCENARIOS OF LIGHT', galleryTitle: 'One home.', galleryAccent: 'A different mood through the day.', galleryLead: 'The architecture changes with the light while the feeling of home stays constant.', galleryOpen: 'Open render full screen', galleryClose: 'Close gallery', galleryPrevious: 'Previous render', galleryNext: 'Next render', renderLabel: 'Architectural render',
    scenes: [
      { label: 'Morning', title: 'Light and a new rhythm', description: 'Warm morning light reveals the residence’s pale architecture and green setting.' },
      { label: 'Day', title: 'Life in the courtyard', description: 'Daytime is for walking, greenery and the ordinary moments that make up a life.' },
      { label: 'Evening', title: 'A home that welcomes you', description: 'Evening light brings out Ofiyat’s calm silhouette and the feeling of coming home.' },
    ],
    familyKicker: 'FOR THE FAMILY', familyTitle: 'A courtyard where childhood', familyAccent: 'always stays close.',
    whiteKicker: 'WHITE BOX', whiteTitle: 'The base is ready.', whiteAccent: 'The character is yours.', whiteLead: 'The essential preparation is complete, so a personal interior can take shape sooner.',
    whiteNotes: ['A prepared base', 'A faster route to the interior', 'Freedom to make it yours'],
    parkingKicker: '200 SPACES', parkingTitle: 'The courtyard for people.', parkingAccent: 'Cars underground.', parkingLead: 'Underground parking uses space efficiently and keeps the inner territory for residents.',
    phasesKicker: 'CHOOSE A PHASE', phasesTitle: 'Two phases.', phasesAccent: 'One rhythm of life.', phasesLead: 'Compare current availability in both phases and choose a parking space separately.',
    available: 'available', openPhase: 'View properties',
    catalogKicker: 'APARTMENT CATALOGUE', catalogTitle: 'A space that fits', catalogAccent: 'the way you live.', catalogLead: 'Large-layout cards and an availability grid make choosing simple on one page.', catalogCta: 'Open the catalogue',
    dataLive: 'Current API data', dataSnapshot: 'Verified catalogue snapshot', plansMarked: 'Representative plans are clearly labelled as examples',
    mapKicker: 'LOCATION', mapTitle: 'The city close —', mapAccent: 'without the rush.', route: 'Build a route',
  },
} as const;

function OfiyatLoader({ visible, image }: { visible: boolean; image: string }) {
  return <div className={`ofiyat-loader ${visible ? 'is-visible' : ''}`} aria-hidden="true">
    <div className="ofiyat-loader__panels">{Array.from({ length: 5 }, (_, index) => <i key={index} style={{ '--ofiyat-panel': index, backgroundImage: `url(${appBasePath}${image})` } as CSSProperties} />)}</div>
    <div className="ofiyat-loader__mark"><small>RESIDENCE · TASHKENT</small><strong>OFIYAT</strong><span>LIGHT · HOME · HARMONY</span></div>
    <div className="ofiyat-loader__progress"><i /><span>01 / 01</span></div>
  </div>;
}

function OfiyatProjectPage({ initialProject, initialLanguage }: { initialProject: Project; initialLanguage: KayanLanguage }) {
  const slug: KayanProjectSlug = 'ofiyat';
  const config = projectConfigs.ofiyat;
  const { project, dataSource } = useProjectSummary(slug, initialProject);
  const [language, setLanguage] = useProjectLanguage(initialLanguage);
  const { loading, menuOpen, setMenuOpen } = useOverlayState(true, 2100, 'kayan-loader-seen-ofiyat');
  const [leadOpen, setLeadOpen] = useState(false);
  const [scene, setScene] = useState(0);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [shouldMountExplorer, setShouldMountExplorer] = useState(false);
  const [explorerUnits, setExplorerUnits] = useState<OfiyatExplorerUnit[]>([]);
  const [explorerInventoryState, setExplorerInventoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [explorerSelection, setExplorerSelection] = useState<OfiyatExplorerSelection | null>(null);
  const copy = config.copy[language];
  const t = ui[language];
  const o = ofiyatLandingUi[language];
  const galleryImages = ['/kayan/ofiyat/hero.webp', '/kayan/ofiyat/courtyard.webp', '/kayan/ofiyat/frame-4-desktop.webp'];

  useSmoothMotion(`ofiyat-${language}-${scene}`);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => setShouldMountExplorer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!shouldMountExplorer) return;

    const controller = new AbortController();
    fetchJSON<{ items: OfiyatExplorerUnit[] }>(`${appBasePath}/api/kayan/ofiyat-explorer`, controller.signal)
      .then((payload) => {
        if (!Array.isArray(payload.items)) throw new Error('Invalid Ofiyat explorer payload');
        setExplorerUnits(payload.items);
        setExplorerInventoryState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExplorerUnits([]);
          setExplorerInventoryState('error');
        }
      });
    return () => controller.abort();
  }, [shouldMountExplorer]);

  const explorerLeadContext = explorerSelection ? [
    `${language === 'ru' ? 'Блок' : language === 'uz' ? 'Blok' : 'Block'} ${explorerSelection.block}`,
    explorerSelection.phaseSlug ? `${language === 'ru' ? 'Очередь' : language === 'uz' ? 'Bosqich' : 'Phase'} ${explorerSelection.phaseSlug === 'phase-1' ? 'I' : 'II'}` : null,
    explorerSelection.entrance ? `${language === 'ru' ? 'Подъезд' : language === 'uz' ? 'Kirish' : 'Entrance'} ${explorerSelection.entrance}` : null,
    typeof explorerSelection.floor === 'number' ? `${language === 'ru' ? 'Этаж' : language === 'uz' ? 'Qavat' : 'Floor'} ${explorerSelection.floor}` : null,
    explorerSelection.unitNumber ? `${language === 'ru' ? 'Квартира' : language === 'uz' ? 'Xonadon' : 'Apartment'} ${explorerSelection.unitNumber}` : null,
  ].filter(Boolean).join(' · ') : '';

  return <main id="top" lang={language} className={`kayan-site kayan-site--ofiyat ${loading ? 'is-loading' : 'is-ready'}`} style={projectStyle(slug)}>
    <a className="kayan-skip-link" href="#main-content">{t.skip}</a>
    <OfiyatLoader visible={loading} image={(config.heroMobileImage || config.heroImage) as string} />
    <ProjectHeader slug={slug} language={language} onLanguage={setLanguage} onMenu={() => setMenuOpen(true)} onLead={() => setLeadOpen(true)} />
    <ProjectMenu open={menuOpen} slug={slug} language={language} onClose={() => setMenuOpen(false)} onLead={() => { setMenuOpen(false); setLeadOpen(true); }} />

    <div id="main-content" className="ofiyat-first-view">
      {shouldMountExplorer ? <section className="ofiyat-hero--explorer" aria-label={o.heroKicker}>
        <OfiyatBlockExplorer
          language={language}
          catalogHref={routeTo(slug, '/apartments', language)}
          units={explorerUnits}
          inventoryState={explorerInventoryState}
          onSelectionChange={(selection) => {
            setExplorerSelection(selection);
            if (selection?.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);
          }}
          onLead={(selection) => {
            setExplorerSelection(selection);
            if (selection.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);
            setLeadOpen(true);
          }}
        />
      </section> : null}
      <section className="ofiyat-mobile-hero" aria-label={o.heroKicker}>
        <picture>
          <source media="(max-width: 767px)" srcSet={`${appBasePath}${config.heroMobileImage ?? '/kayan/ofiyat/frame-4-mobile.webp'}`} />
          <img className="ofiyat-mobile-hero__image" src={`${appBasePath}${config.heroImage as string}`} alt={`${config.name} · ${o.renderLabel}`} width="4096" height="2359" fetchPriority="high" />
        </picture>
        <div className="ofiyat-mobile-hero__shade" aria-hidden="true" />
        <div className="ofiyat-mobile-hero__copy"><small>{o.heroKicker}</small><h1>{copy.headline}<br /><em>{copy.headlineAccent}</em></h1><p>{copy.description}</p></div>
        <div className="ofiyat-mobile-hero__cta"><small>{copy.address}</small><a href={routeTo(slug, '/apartments', language)}>{o.heroCta}<span>↗</span></a></div>
      </section>
    </div>

    <section id="about" className="ofiyat-story">
      <header data-reveal><p>{o.storyKicker}</p><h2>{o.storyTitle}<br /><em>{o.storyAccent}</em></h2><span>{copy.storyCopy}</span></header>
      <figure data-reveal><ProjectImage src="/kayan/ofiyat/courtyard.webp" alt={`${config.name} · ${o.renderLabel}`} /><figcaption><small>{o.renderLabel} · {o.scenes[1].label}</small><span>{copy.description}</span></figcaption></figure>
      <div className="ofiyat-facts" data-reveal>{copy.facts.map((fact, index) => <article key={fact.label}><small>0{index + 1}</small><strong>{fact.value}</strong><span>{fact.label}</span></article>)}</div>
    </section>

    <section id="gallery" className="ofiyat-day-gallery">
      <header data-reveal><p>{o.galleryKicker}</p><h2>{o.galleryTitle}<br /><em>{o.galleryAccent}</em></h2><span>{o.galleryLead}</span></header>
      <div className="ofiyat-day-gallery__stage" data-reveal role="tabpanel" id={`ofiyat-gallery-panel-${scene}`} aria-labelledby={`ofiyat-gallery-tab-${scene}`}>
        <ProjectImage key={galleryImages[scene]} src={galleryImages[scene]} alt={`${config.name} · ${o.renderLabel} · ${o.scenes[scene].label}`} />
        <div className="ofiyat-day-gallery__shade" />
        <div className="ofiyat-day-gallery__copy"><small>{o.renderLabel} · 0{scene + 1} / 03</small><h3>{o.scenes[scene].title}</h3><p>{o.scenes[scene].description}</p></div>
        <button className="ofiyat-day-gallery__open" type="button" onClick={() => setGalleryOpen(true)} aria-label={o.galleryOpen}>↗</button>
        <div className="ofiyat-day-gallery__tabs" role="tablist" aria-label={o.galleryKicker}>{o.scenes.map((item, index) => <button
          type="button"
          role="tab"
          id={`ofiyat-gallery-tab-${index}`}
          aria-controls={`ofiyat-gallery-panel-${index}`}
          aria-selected={scene === index}
          tabIndex={scene === index ? 0 : -1}
          className={scene === index ? 'is-active' : ''}
          key={item.label}
          onClick={() => setScene(index)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? o.scenes.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + o.scenes.length) % o.scenes.length;
            setScene(next);
            window.requestAnimationFrame(() => document.getElementById(`ofiyat-gallery-tab-${next}`)?.focus());
          }}
        ><small>0{index + 1}</small><span>{item.label}</span><i /></button>)}</div>
      </div>
    </section>

    <section id="details" className="ofiyat-family">
      <div className="ofiyat-family__image" data-reveal><ProjectImage src="/kayan/ofiyat/courtyard.webp" alt={`${config.name} · ${o.renderLabel}`} /><small>{o.renderLabel} · 01</small></div>
      <div className="ofiyat-family__copy" data-reveal><p>{o.familyKicker}</p><h2>{o.familyTitle}<br /><em>{o.familyAccent}</em></h2><span>{copy.features[0].description}</span><i>01</i></div>
    </section>

    <section id="white-box" className="ofiyat-whitebox">
      <div className="ofiyat-whitebox__copy" data-reveal><p>{o.whiteKicker}</p><h2>{o.whiteTitle}<br /><em>{o.whiteAccent}</em></h2><span>{o.whiteLead}</span><ul>{o.whiteNotes.map((item, index) => <li key={item}><small>0{index + 1}</small>{item}</li>)}</ul></div>
      <figure data-reveal><ProjectImage src="/kayan/ofiyat/lifestyle.webp" alt={`${config.name} · ${o.renderLabel}`} /><figcaption>{o.renderLabel} · {copy.features[1].title}</figcaption></figure>
    </section>

    <section id="parking" className="ofiyat-parking" data-reveal>
      <div className="ofiyat-parking__number"><small>{o.parkingKicker}</small><strong>200</strong><span>{copy.facts[3].label}</span></div>
      <div className="ofiyat-parking__copy"><p>03 · {copy.features[2].title}</p><h2>{o.parkingTitle}<br /><em>{o.parkingAccent}</em></h2><span>{o.parkingLead}</span></div>
      <div className="ofiyat-parking__lines" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>
    </section>

    <section id="phases" className="ofiyat-phases">
      <header data-reveal><p>{o.phasesKicker}</p><h2>{o.phasesTitle}<br /><em>{o.phasesAccent}</em></h2><span>{o.phasesLead}</span></header>
      <div>{project.phases.map((phase, index) => <a data-reveal key={phase.slug} href={routeTo(slug, '/apartments', language, phase.slug)}><small>0{index + 1}</small><h3>{phaseLabel(phase, language)}</h3><p><strong>{phase.availableUnits}</strong> {o.available}</p><span>{o.openPhase}<b>↗</b></span></a>)}</div>
    </section>

    <section id="catalogue" className="ofiyat-catalog-teaser">
      <div className="ofiyat-catalog-teaser__visual" data-reveal><ProjectImage src="/kayan/ofiyat/hero.webp" alt={`${o.renderLabel} · ${copy.chapters[1].title}`} /><span>OFIYAT<br />CATALOGUE</span></div>
      <div className="ofiyat-catalog-teaser__copy" data-reveal><p>{o.catalogKicker}</p><h2>{o.catalogTitle}<br /><em>{o.catalogAccent}</em></h2><span>{o.catalogLead}</span><ul><li>{dataSource === 'live' ? o.dataLive : o.dataSnapshot}</li><li>{o.plansMarked}</li></ul><a href={routeTo(slug, '/apartments', language)}>{o.catalogCta}<b>↗</b></a></div>
    </section>

    <section id="location" className="ofiyat-location">
      <div className="ofiyat-location__copy" data-reveal><p>{o.mapKicker}</p><h2>{o.mapTitle}<br /><em>{o.mapAccent}</em></h2><span>{copy.address}</span><a href="https://yandex.uz/navi/10335/tashkent/?from=navi&lang=ru&ll=69.307171%2C41.332023&mode=whatshere&whatshere%5Bpoint%5D=69.307171%2C41.332023&whatshere%5Bzoom%5D=18&z=15" target="_blank" rel="noreferrer">{o.route}<b>↗</b></a></div>
      <figure data-reveal><ProjectImage src="/kayan/ofiyat/aerial.webp" alt={`${o.renderLabel} · ${copy.chapters[0].title}`} /><i aria-hidden="true"><span>OFIYAT</span></i></figure>
    </section>

    <section id="contact" className="ofiyat-contact" data-reveal>
      <p>{t.consultationKicker}</p><h2>{copy.consultationTitle}<br /><em>{copy.consultationAccent}</em></h2><span>{copy.consultationCopy}</span>
      <div><button type="button" onClick={() => setLeadOpen(true)}>{t.request}<b>↗</b></button><a href="tel:+998781137712">{t.phone}<b>+998 78 113 77 12</b></a></div>
    </section>

    <ProjectFooter slug={slug} language={language} />
    {galleryOpen ? <OfiyatGalleryLightbox src={galleryImages[scene]} alt={`${config.name} · ${o.renderLabel} · ${o.scenes[scene].label}`} title={`${o.renderLabel} · ${o.scenes[scene].title}`} description={o.scenes[scene].description} closeLabel={o.galleryClose} previousLabel={o.galleryPrevious} nextLabel={o.galleryNext} onClose={() => setGalleryOpen(false)} onPrevious={() => setScene((current) => (current + galleryImages.length - 1) % galleryImages.length)} onNext={() => setScene((current) => (current + 1) % galleryImages.length)} /> : null}
    {leadOpen ? <LeadModal open language={language} context={`OFIYAT · landing${explorerLeadContext ? ` · ${explorerLeadContext}` : ''}`} onClose={() => setLeadOpen(false)} projectName={config.name} hideBrand tagline={copy.tagline} facts={copy.facts.slice(0, 3).map((fact) => `${fact.value} · ${fact.label}`)} submitUrl={leadSubmitUrl()} projectSlug={slug} unitKey={explorerSelection?.unitKey} privacyUrl={privacyRoute(slug, language, explorerSelection ? { block: String(explorerSelection.block), phase: explorerSelection.phaseSlug, entrance: explorerSelection.entrance, floor: explorerSelection.floor === undefined ? undefined : String(explorerSelection.floor), unit: explorerSelection.unitNumber } : undefined)} requireConsent /> : null}
  </main>;
}

function DefaultKayanProjectPage({ slug, initialProject, initialLanguage }: { slug: KayanProjectSlug; initialProject: Project; initialLanguage: KayanLanguage }) {
  const config = projectConfigs[slug];
  const { project, dataSource } = useProjectSummary(slug, initialProject);
  const [language, setLanguage] = useProjectLanguage(initialLanguage);
  const { loading, menuOpen, setMenuOpen } = useOverlayState(true, slug === 'mirador' ? 2650 : 950, `kayan-loader-seen-${slug}`);
  const [leadOpen, setLeadOpen] = useState(false);
  const [selectedVisualBlock, setSelectedVisualBlock] = useState<MiradorBlockNumber | null>(null);
  const [miradorSelection, setMiradorSelection] = useState<MiradorExplorerSelection | null>(null);
  const [shouldMountMiradorExplorer, setShouldMountMiradorExplorer] = useState(false);
  const [miradorExplorerReady, setMiradorExplorerReady] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const copy = config.copy[language];
  const t = ui[language];
  const heroImageAlt = language === 'ru'
    ? `Жилой комплекс ${config.name}`
    : language === 'uz'
      ? `${config.name} turar joy majmuasi`
      : `${config.name} residential complex`;
  const miradorLeadContext = miradorSelection ? [
    `${language === 'ru' ? 'Блок' : language === 'uz' ? 'Blok' : 'Block'} ${miradorSelection.block}`,
    miradorSelection.entrance ? `${language === 'ru' ? 'Подъезд' : language === 'uz' ? 'Kirish' : 'Entrance'} ${miradorSelection.entrance}` : null,
    typeof miradorSelection.floor === 'number' ? `${language === 'ru' ? 'Этаж' : language === 'uz' ? 'Qavat' : 'Floor'} ${miradorSelection.floor}` : null,
    miradorSelection.unitNumber ? `${language === 'ru' ? 'Квартира' : language === 'uz' ? 'Xonadon' : 'Apartment'} ${miradorSelection.unitNumber}` : null,
  ].filter(Boolean).join(' · ') : '';

  useSmoothMotion(`${slug}-${language}`);

  useEffect(() => {
    if (slug !== 'mirador') return;
    const media = window.matchMedia('(min-width: 768px)');
    let focusFrame = 0;
    const update = () => {
      const explorer = heroRef.current?.querySelector('.mirador-block-explorer');
      const moveFocusToMobileCTA = !media.matches && explorer?.contains(document.activeElement);
      setShouldMountMiradorExplorer(media.matches);
      if (!media.matches) {
        setMiradorExplorerReady(false);
        setSelectedVisualBlock(null);
        setMiradorSelection(null);
        if (moveFocusToMobileCTA) {
          window.cancelAnimationFrame(focusFrame);
          focusFrame = window.requestAnimationFrame(() => {
            if (media.matches) return;
            const mobileCTA = heroRef.current?.querySelector<HTMLAnchorElement>('.kayan-hero__card > a');
            if (mobileCTA?.isConnected && mobileCTA.getClientRects().length) mobileCTA.focus({ preventScroll: true });
          });
        }
      }
    };
    update();
    media.addEventListener('change', update);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      media.removeEventListener('change', update);
    };
  }, [slug]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      if (!heroRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const x = (event.clientX / window.innerWidth - 0.5) * 13;
      const y = (event.clientY / window.innerHeight - 0.5) * 9;
      heroRef.current.style.setProperty('--kayan-hero-x', `${x}px`);
      heroRef.current.style.setProperty('--kayan-hero-y', `${y}px`);
      heroRef.current.style.setProperty('--kayan-pointer-x', `${event.clientX}px`);
      heroRef.current.style.setProperty('--kayan-pointer-y', `${event.clientY}px`);
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, []);

  return <main id="top" lang={language} className={`kayan-site kayan-site--${slug} ${loading ? 'is-loading' : 'is-ready'}`} style={projectStyle(slug)}>
    <a className="kayan-skip-link" href="#main-content">{t.skip}</a>
    {slug === 'mirador' ? <noscript><style>{'.kayan-site--mirador .kayan-loader{display:none!important}.kayan-site--mirador.is-loading .kayan-header,.kayan-site--mirador.is-loading .kayan-hero__copy,.kayan-site--mirador.is-loading .kayan-hero__card{opacity:1!important}'}</style></noscript> : null}
    <KayanLoader visible={loading} name={config.name} image={slug === 'mirador' ? undefined : config.heroImage} mobileImage={slug === 'mirador' ? undefined : config.heroMobileImage} />
    <ProjectHeader slug={slug} language={language} onLanguage={setLanguage} onMenu={() => setMenuOpen(true)} onLead={() => setLeadOpen(true)} />
    <ProjectMenu open={menuOpen} slug={slug} language={language} onClose={() => setMenuOpen(false)} onLead={() => { setMenuOpen(false); setLeadOpen(true); }} />

    <section id="main-content" ref={heroRef} className={`kayan-hero ${config.heroImage ? '' : 'is-placeholder'}`}>
      {config.heroImage ? (slug !== 'mirador' || !miradorExplorerReady ? <ProjectImage className="kayan-hero__image" src={slug === 'mirador' ? MIRADOR_BLOCK_PROVENANCE.render.publicPath : config.heroImage} mobileSrc={config.heroMobileImage || undefined} alt={heroImageAlt} loading="eager" /> : null) : <div className="kayan-hero__placeholder" aria-label="Project render placeholder"><span>{config.name}</span><small>PROJECT VISUAL / COMING SOON</small></div>}
      {slug === 'mirador' && shouldMountMiradorExplorer ? <MiradorBlockExplorer
        variant="hero"
        language={language}
        catalogHref={routeTo(slug, '/apartments', language)}
        onReady={() => setMiradorExplorerReady(true)}
        onBlockSelect={(block) => {
          setSelectedVisualBlock(block);
        }}
        onSelectionChange={(selection) => {
          setMiradorSelection(selection);
          if (selection?.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);
        }}
        onLead={(selection) => {
          setSelectedVisualBlock(selection.block);
          setMiradorSelection(selection);
          if (selection.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);
          setLeadOpen(true);
        }}
      /> : null}
      <div className="kayan-hero__shade" />
      {slug === 'mirador' ? <><div className="kayan-hero__light" aria-hidden="true" /><div className="kayan-hero__frame" aria-hidden="true"><span>01 / PRIVATE RESIDENCE</span><span>MIRADOR / TASHKENT</span></div><div className="kayan-hero__edition" aria-hidden="true"><strong>01</strong><i /><span>URBAN<br />RESIDENCE</span></div></> : null}
      <div className="kayan-hero__copy"><p>{copy.address}</p><h1>{copy.headline}<br /><em>{copy.headlineAccent}</em></h1><span>{copy.description}</span></div>
      {slug !== 'mirador' ? <div className="kayan-hero__interactive" aria-label={t.choose}>
        {project.phases.map((phase) => <a key={phase.slug} className="kayan-pin" style={config.phasePins[phase.slug] ?? { left: '50%', top: '50%' }} href={routeTo(slug, '/apartments', language, phase.slug)}><small>{phase.availableUnits} {t.available}</small><strong>{phaseLabel(phase, language)}</strong><b>↘</b></a>)}
      </div> : null}
      <aside className="kayan-hero__card"><small>{copy.eyebrow}</small><h2>{config.name}</h2><p>{objectCountLabel(project.availableUnits, language)} {t.from} {project.totalUnits}</p><a href={routeTo(slug, '/apartments', language)}>{t.openProject}<span>↘</span></a></aside>
      <a href="#about" className="kayan-scroll-cue"><span>{t.scroll}</span><i /></a>
    </section>

    {slug === 'mirador' ? <div className="kayan-signature-rail" aria-hidden="true"><div>{[...copy.features, ...copy.features].map((feature, index) => <span key={`${feature.number}-${index}`}>{feature.title}<i /></span>)}</div></div> : null}

    <section id="about" className="kayan-story">
      <div className="kayan-story__heading" data-reveal><p>{t.storyKicker}</p><h2>{copy.storyTitle}<br /><em>{copy.storyAccent}</em></h2><span>{copy.storyCopy}</span></div>
      <div className="kayan-facts" data-reveal>{copy.facts.map((fact) => <article key={fact.label}><strong>{fact.value}</strong><span>{fact.label}</span></article>)}</div>
      <div className={`kayan-story__media ${config.storyImages?.length ? 'has-gallery' : ''}`} data-reveal>
        {config.storyImages?.length ? config.storyImages.map((image, index) => <ProjectImage key={image} src={image} mobileSrc={config.storyMobileImages?.[index]} alt={`${config.name} · ${index + 1}`} />) : config.heroImage ? <ProjectImage src={config.heroImage} mobileSrc={config.heroMobileImage || undefined} alt={`${config.name} architecture`} /> : <div className="kayan-media-placeholder"><span>PROJECT IMAGE / 02</span><strong>{config.name}</strong><small>16:9 · COMING SOON</small></div>}
        <div className="kayan-story__quote"><span>“</span><p>{copy.description}</p></div>
      </div>
      <div className="kayan-features">{copy.features.map((feature) => <article key={feature.number} data-reveal><span>{feature.number}</span><h3>{feature.title}</h3><p>{feature.description}</p></article>)}</div>
    </section>

    <section id="details" className="kayan-chapters">
      <header data-reveal><p>{t.detailsKicker}</p><h2>{t.detailsTitle}<br /><em>{t.detailsAccent}</em></h2></header>
      <div>{copy.chapters.map((chapter, index) => <article key={chapter.number} data-reveal><small>{chapter.number}</small>{config.chapterImages?.[index] ? <figure><ProjectImage src={config.chapterImages[index]} mobileSrc={config.chapterMobileImages?.[index]} alt={chapter.title} /></figure> : null}<h3>{chapter.title}</h3><p>{chapter.description}</p></article>)}</div>
    </section>

    <section className="kayan-proofbar" aria-label={language === 'ru' ? 'Актуальность данных' : language === 'uz' ? 'Ma’lumotlar dolzarbligi' : 'Data confidence'}>
      <article><small>01</small><strong>{objectCountLabel(project.availableUnits, language)}</strong><span>{language === 'ru' ? 'доступно сейчас' : language === 'uz' ? 'hozir mavjud' : 'available now'}</span></article>
      <article><small>02</small><strong>{dataSource === 'live' ? t.sourceLive : t.sourceSnapshot}</strong><span>{language === 'ru' ? 'цены и статусы' : language === 'uz' ? 'narxlar va holatlar' : 'prices and statuses'}</span></article>
      <article><small>03</small><strong>{language === 'ru' ? 'Прозрачная маркировка' : language === 'uz' ? 'Aniq belgilash' : 'Clear disclosure'}</strong><span>{language === 'ru' ? 'типовые планы отмечены как примеры' : language === 'uz' ? 'namunaviy rejalar alohida ko‘rsatiladi' : 'representative layouts are clearly labelled'}</span></article>
    </section>

    <section className="kayan-selection-banner" data-reveal>
      <div className="kayan-selection-banner__visual">{config.storyImages?.[0] || config.heroImage ? <ProjectImage src={(config.storyImages?.[0] || config.heroImage) as string} mobileSrc={config.storyMobileImages?.[0] || config.heroMobileImage || undefined} alt="" /> : <span>{config.name}</span>}</div>
      <div className="kayan-selection-banner__copy"><p>{t.selectionKicker}</p><h2>{t.selectionTitle}<br /><em>{t.selectionAccent}</em></h2><span>{objectCountLabel(project.availableUnits, language)}</span><a href={routeTo(slug, '/apartments', language)}>{t.choose}<b>↗</b></a></div>
    </section>

    <section id="contact" className="kayan-contact" data-reveal>
      <p>{t.consultationKicker}</p><h2>{copy.consultationTitle}<br /><em>{copy.consultationAccent}</em></h2><span>{copy.consultationCopy}</span>
      <div><button type="button" onClick={() => setLeadOpen(true)}>{t.request}<b>↗</b></button><a href="tel:+998781137712">{t.phone}<b>+998 78 113 77 12</b></a></div>
    </section>

    <ProjectFooter slug={slug} language={language} />
    {leadOpen ? <LeadModal open language={language} context={`${config.name} · landing${miradorLeadContext ? ` · ${miradorLeadContext}` : selectedVisualBlock ? ` · ${language === 'ru' ? 'Блок' : language === 'uz' ? 'Blok' : 'Block'} ${selectedVisualBlock}` : ''}`} onClose={() => setLeadOpen(false)} projectName={config.name} hideBrand tagline={copy.tagline} facts={copy.facts.slice(0, 3).map((fact) => `${fact.value} · ${fact.label}`)} submitUrl={leadSubmitUrl()} projectSlug={slug} unitKey={slug === 'mirador' ? miradorSelection?.unitKey : undefined} privacyUrl={privacyRoute(slug, language)} requireConsent /> : null}
  </main>;
}

export function KayanProjectPage({ slug, initialProject, initialLanguage = 'ru' }: { slug: KayanProjectSlug; initialProject: Project; initialLanguage?: KayanLanguage }) {
  return slug === 'ofiyat' ? <OfiyatProjectPage initialProject={initialProject} initialLanguage={initialLanguage} /> : <DefaultKayanProjectPage slug={slug} initialProject={initialProject} initialLanguage={initialLanguage} />;
}

export function KayanCatalogPage({ slug, initialBundle, snapshotGeneratedAt, initialLanguage = 'ru' }: { slug: KayanProjectSlug; initialBundle: CatalogBundle; snapshotGeneratedAt?: string; initialLanguage?: KayanLanguage }) {
  const config = projectConfigs[slug];
  const isMirador = slug === 'mirador';
  const isOfiyat = slug === 'ofiyat';
  const { bundle, dataSource } = useCatalogBundle(slug, initialBundle);
  const initialPhase = bundle.project.phases[0]?.slug ?? '';
  const initialUnit = firstCatalogUnit(bundle.units, initialPhase);
  const [language, setLanguage] = useProjectLanguage(initialLanguage);
  const { menuOpen, setMenuOpen } = useOverlayState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [visualBlockContext, setVisualBlockContext] = useState<string>();
  const [selectedPhase, setSelectedPhase] = useState(initialPhase);
  const [selectedUnitID, setSelectedUnitID] = useState<number | null>(isOfiyat ? null : initialUnit?.id ?? null);
  const [expandedCardUnitID, setExpandedCardUnitID] = useState<number | null>(null);
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [entranceFilter, setEntranceFilter] = useState<EntranceFilter>('all');
  const [floorFilter, setFloorFilter] = useState<FloorFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('status');
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [mode, setMode] = useState<CatalogMode>('cards');
  const [visibleCardCount, setVisibleCardCount] = useState(CATALOG_CARD_PAGE_SIZE);
  const chessScrollRef = useRef<HTMLDivElement>(null);
  const [chessPan, setChessPan] = useState({ overflow: false, canLeft: false, canRight: false, visible: false });
  const t = ui[language];
  const copy = config.copy[language];
  const displayCatalogTimestamp = selectCatalogTimestamp(bundle.project.updatedAt, snapshotGeneratedAt);

  const updateCatalogQuery = (changes: Record<string, string | undefined>) => {
    const url = new URL(window.location.href);
    url.searchParams.set('lang', language);
    Object.entries(changes).forEach(([key, value]) => {
      if (!value) url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    });
    window.history.replaceState({}, '', url);
  };

  useSmoothMotion(`${slug}-catalog-${language}`);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const phaseFromURL = params.get('phase');
    const modeFromURL = params.get('mode');
    const legacyMode = modeFromURL === 'chess-plus' || modeFromURL === 'matrix-plus';
    const normalizedMode = legacyMode ? 'chess' : modeFromURL;
    if (legacyMode) {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', 'chess');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    const entranceFromURL = params.get('entrance');
    const floorParam = params.get('floor');
    const roomsParam = params.get('rooms');
    const floorFromURL = Number(floorParam);
    const roomsFromURL = Number(roomsParam);
    const sortFromURL = params.get('sort');
    const unitFromURL = params.get('unit');
    const phaseIsValid = Boolean(phaseFromURL && bundle.project.phases.some((phase) => phase.slug === phaseFromURL));
    const filterPhaseSlug = phaseIsValid ? phaseFromURL as string : initialPhase;
    const filterPhaseUnits = bundle.units.filter((unit) => unit.phaseSlug === filterPhaseSlug);
    const entranceIsValid = Boolean(entranceFromURL && filterPhaseUnits.some((unit) => unit.entrance === entranceFromURL));
    const floorScope = entranceIsValid ? filterPhaseUnits.filter((unit) => unit.entrance === entranceFromURL) : filterPhaseUnits;
    const floorIsValid = Boolean(floorParam?.trim()) && Number.isSafeInteger(floorFromURL) && floorScope.some((unit) => unit.floor === floorFromURL);
    const roomsIsValid = Boolean(roomsParam?.trim()) && Number.isSafeInteger(roomsFromURL) && filterPhaseUnits.some((unit) => unit.rooms === roomsFromURL);
    const frame = window.requestAnimationFrame(() => {
      if (phaseIsValid && phaseFromURL) setSelectedPhase(phaseFromURL);
      if (normalizedMode === 'cards' || normalizedMode === 'chess') setMode(normalizedMode);
      if (entranceIsValid && entranceFromURL) setEntranceFilter(entranceFromURL);
      if (floorIsValid) setFloorFilter(floorFromURL);
      if (roomsIsValid) setRoomFilter(roomsFromURL);
      if (sortFromURL === 'status' || sortFromURL === 'price-asc' || sortFromURL === 'area-asc' || sortFromURL === 'floor-desc') setSortMode(sortFromURL);
      if (params.get('available') === '1') setOnlyAvailable(true);
      if (isOfiyat) {
        const block = params.get('block');
        setVisualBlockContext(block && /^[1-7]$/.test(block) ? block : undefined);
      }
      if (isOfiyat && params.has('unit')) {
        const unit = resolveCompositeCatalogUnit(bundle.units, {
          phase: phaseFromURL,
          entrance: entranceFromURL,
          floor: floorParam,
          unit: unitFromURL,
          availableOnly: params.get('available') === '1',
        });
        if (unit) {
          setSelectedPhase(unit.phaseSlug);
          setSelectedUnitID(unit.id);
        } else {
          setSelectedUnitID(null);
        }
      } else if (isMirador && params.has('unit')) {
        const hasEntranceConstraint = params.has('entrance');
        const hasFloorConstraint = params.has('floor');
        const hasRoomsConstraint = params.has('rooms');
        const hasPhaseConstraint = params.has('phase');
        const matchingUnits = unitFromURL ? bundle.units.filter((candidate) => (
          candidate.number === unitFromURL
          && (!hasPhaseConstraint || (phaseIsValid && candidate.phaseSlug === phaseFromURL))
          && (!hasEntranceConstraint || (entranceIsValid && candidate.entrance === entranceFromURL))
          && (!hasFloorConstraint || (floorIsValid && candidate.floor === floorFromURL))
          && (!hasRoomsConstraint || (roomsIsValid && candidate.rooms === roomsFromURL))
          && (params.get('available') !== '1' || candidate.status === 'available')
        )) : [];
        const unit = matchingUnits.length === 1 ? matchingUnits[0] : undefined;
        if (unit) { setSelectedPhase(unit.phaseSlug); setSelectedUnitID(unit.id); }
        else setSelectedUnitID(null);
      } else if (unitFromURL) {
        const unit = bundle.units.find((candidate) => candidate.number === unitFromURL);
        if (unit) { setSelectedPhase(unit.phaseSlug); setSelectedUnitID(unit.id); }
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [bundle.project.phases, bundle.units, initialPhase, isMirador, isOfiyat]);

  const phase = bundle.project.phases.find((item) => item.slug === selectedPhase) ?? bundle.project.phases[0];
  const phaseUnits = useMemo(() => bundle.units.filter((unit) => unit.phaseSlug === phase?.slug), [bundle.units, phase?.slug]);
  const rooms = useMemo(() => [...new Set(phaseUnits.map((unit) => unit.rooms).filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b), [phaseUnits]);
  const entrances = useMemo(() => [...new Set(phaseUnits.map((unit) => unit.entrance).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'ru', { numeric: true })), [phaseUnits]);
  const floors = useMemo(() => [...new Set(phaseUnits
    .filter((unit) => !isOfiyat || entranceFilter === 'all' || unit.entrance === entranceFilter)
    .map((unit) => unit.floor))].sort((a, b) => b - a), [entranceFilter, isOfiyat, phaseUnits]);
  const filteredUnits = useMemo(() => phaseUnits.filter((unit) => (
    (roomFilter === 'all' || unit.rooms === roomFilter)
    && (entranceFilter === 'all' || unit.entrance === entranceFilter)
    && (floorFilter === 'all' || unit.floor === floorFilter)
    && (!onlyAvailable || unit.status === 'available')
  )), [entranceFilter, floorFilter, onlyAvailable, phaseUnits, roomFilter]);
  const cardUnits = useMemo(() => {
    const statusOrder: Record<UnitStatus, number> = { available: 0, reserved: 1, sold: 2, unavailable: 3 };
    return [...filteredUnits].sort((a, b) => {
      const byNumber = a.number.localeCompare(b.number, 'ru', { numeric: true });
      if (sortMode === 'price-asc') return (a.price ?? Number.MAX_SAFE_INTEGER) - (b.price ?? Number.MAX_SAFE_INTEGER) || byNumber;
      if (sortMode === 'area-asc') return a.area - b.area || byNumber;
      if (sortMode === 'floor-desc') return b.floor - a.floor || byNumber;
      return statusOrder[a.status] - statusOrder[b.status] || b.floor - a.floor || byNumber;
    });
  }, [filteredUnits, sortMode]);
  const selectedUnit = selectedUnitID === null
    ? undefined
    : bundle.units.find((unit) => unit.id === selectedUnitID && filteredUnits.some((candidate) => candidate.id === unit.id)) ?? cardUnits[0];
  const visibleCardUnits = useMemo(() => {
    const firstPage = cardUnits.slice(0, visibleCardCount);
    if (!selectedUnit || firstPage.some((unit) => unit.id === selectedUnit.id)) return firstPage;
    return [selectedUnit, ...firstPage.filter((unit) => unit.id !== selectedUnit.id).slice(0, Math.max(0, visibleCardCount - 1))];
  }, [cardUnits, selectedUnit, visibleCardCount]);
  const selectedLayout = useMemo(() => representativeLayout(selectedUnit, bundle.layouts), [selectedUnit, bundle.layouts]);
  const expandedCardUnit = bundle.units.find((unit) => unit.id === expandedCardUnitID);
  const expandedCardLayout = useMemo(() => representativeLayout(expandedCardUnit, bundle.layouts), [expandedCardUnit, bundle.layouts]);
  const catalogRouteContext: RouteSelectionContext | undefined = isOfiyat ? {
    block: visualBlockContext,
    phase: selectedUnit?.phaseSlug ?? phase?.slug,
    entrance: selectedUnit?.entrance ?? (entranceFilter === 'all' ? undefined : entranceFilter),
    floor: selectedUnit ? String(selectedUnit.floor) : floorFilter === 'all' ? undefined : String(floorFilter),
    unit: selectedUnit?.number,
  } : undefined;
  const chessRows = useMemo(() => [...new Set(filteredUnits.map((unit) => unit.floor))]
    .sort((a, b) => b - a)
    .map((floor) => ({
      floor,
      items: filteredUnits
        .filter((unit) => unit.floor === floor)
        .sort((a, b) => a.number.localeCompare(b.number, 'ru', { numeric: true })),
    }))
    .filter((row) => row.items.length), [filteredUnits]);
  const chessContentWidth = 79 + Math.max(1, ...chessRows.map((row) => row.items.length)) * 130;

  useEffect(() => {
    const scroll = chessScrollRef.current;
    if (!scroll || mode === 'cards') {
      setChessPan({ overflow: false, canLeft: false, canRight: false, visible: false });
      return;
    }
    const update = () => {
      const max = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
      const overflow = max > 2;
      const next = { overflow, canLeft: overflow && scroll.scrollLeft > 2, canRight: overflow && scroll.scrollLeft < max - 2 };
      setChessPan((current) => current.overflow === next.overflow && current.canLeft === next.canLeft && current.canRight === next.canRight
        ? current
        : { ...current, ...next });
    };
    const frame = window.requestAnimationFrame(update);
    const resizeObserver = new ResizeObserver(update);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      setChessPan((current) => current.visible === entry.isIntersecting ? current : { ...current, visible: entry.isIntersecting });
    }, { threshold: 0.05, rootMargin: '-190px 0px 0px' });
    resizeObserver.observe(scroll);
    visibilityObserver.observe(scroll);
    scroll.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      scroll.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [chessContentWidth, entranceFilter, floorFilter, mode, onlyAvailable, roomFilter, selectedPhase]);

  const choosePhase = (phaseSlug: string) => {
    const units = bundle.units.filter((unit) => unit.phaseSlug === phaseSlug);
    const first = firstCatalogUnit(units, phaseSlug);
    setSelectedPhase(phaseSlug); setSelectedUnitID(isOfiyat ? null : first?.id ?? null); setExpandedCardUnitID(null); setRoomFilter('all'); setEntranceFilter('all'); setFloorFilter('all'); setOnlyAvailable(false); setVisibleCardCount(CATALOG_CARD_PAGE_SIZE);
    updateCatalogQuery({ phase: phaseSlug, rooms: undefined, entrance: undefined, floor: undefined, available: undefined, unit: undefined });
  };

  const chooseUnit = (unit: Unit, scrollToDetail = true) => {
    setSelectedPhase(unit.phaseSlug);
    if (isOfiyat) {
      if (!unit.entrance) {
        setSelectedUnitID(null);
        updateCatalogQuery({ phase: unit.phaseSlug, entrance: undefined, floor: undefined, unit: undefined });
        return;
      }
      setSelectedUnitID(unit.id);
      updateCatalogQuery(catalogUnitQuery({ ...unit, entrance: unit.entrance }, language, visualBlockContext));
    } else {
      setSelectedUnitID(unit.id);
      updateCatalogQuery({ phase: unit.phaseSlug, unit: unit.number });
    }
    rememberLastViewedApartment({ unitKey: unit.sourceKey }, slug);
    if (scrollToDetail && window.innerWidth < 768) window.setTimeout(() => document.querySelector('.kayan-unit-detail')?.scrollIntoView({ behavior: chessScrollBehavior(), block: 'start' }), 80);
  };
  const chooseMode = (nextMode: CatalogMode) => {
    setMode(nextMode);
    updateCatalogQuery({ mode: nextMode === 'cards' ? undefined : nextMode });
  };
  const chessScrollBehavior = () => (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' as const : 'smooth' as const
  );
  const panChess = (direction: -1 | 1) => {
    const scroll = chessScrollRef.current;
    if (!scroll) return;
    scroll.scrollBy({ left: direction * Math.max(220, scroll.clientWidth * 0.72), behavior: chessScrollBehavior() });
  };
  const onChessKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scroll = chessScrollRef.current;
    if (!scroll) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      panChess(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      scroll.scrollTo({ left: event.key === 'Home' ? 0 : scroll.scrollWidth, behavior: chessScrollBehavior() });
    }
  };
  const modeLabels: Record<CatalogMode, string> = { cards: t.cards, chess: t.chess };
  const modes: CatalogMode[] = ['cards', 'chess'];
  const chessStatusLegend = (['available', 'reserved', 'sold', 'unavailable'] as UnitStatus[]).map((status) => <span key={status}><i data-status={status} />{t.statusLabels[status]}</span>);
  const leadPhase = selectedUnit ? bundle.project.phases.find((item) => item.slug === selectedUnit.phaseSlug) : phase;
  const leadContext = [
    config.name,
    visualBlockContext ? `${t.blockContext} ${visualBlockContext}` : undefined,
    leadPhase ? `${t.phaseContext} ${phaseLabel(leadPhase, language)}` : undefined,
    selectedUnit ? `${selectedUnit.propertyType === 'parking' ? t.parking : t.apartment} ${selectedUnit.number}` : t.catalogContext,
    selectedUnit ? `${t.entrance} ${selectedUnit.entrance || '—'}` : undefined,
    selectedUnit ? `${t.floor} ${floorLabel(selectedUnit.floor)}` : undefined,
  ].filter(Boolean).join(' · ');
  const currentPhaseLabel = phase ? phaseLabel(phase, language) : '';

  return <main id="top" lang={language} className={`kayan-site kayan-selector kayan-site--${slug}`} style={projectStyle(slug)}>
    <a className="kayan-skip-link" href="#catalog">{t.skip}</a>
    <ProjectHeader selector slug={slug} language={language} routeContext={catalogRouteContext} onLanguage={setLanguage} onMenu={() => setMenuOpen(true)} onLead={() => setLeadOpen(true)} />
    <ProjectMenu open={menuOpen} slug={slug} language={language} routeContext={catalogRouteContext} onClose={() => setMenuOpen(false)} onLead={() => { setMenuOpen(false); setLeadOpen(true); }} />

    <section className="kayan-selector-hero">
      <div><p>{t.selectorKicker}</p><h1>{t.selectorTitle}<br /><em>{t.selectorAccent}</em></h1></div>
      <span>{t.selectorLead}<small>{dataSource === 'live' ? t.sourceLive : t.sourceSnapshot}. {updateTimestamp(displayCatalogTimestamp, language)}</small></span>
      <strong>{bundle.project.availableUnits}<small>{t.availableLong}</small></strong>
    </section>

    <section id="catalog" className="kayan-catalog">
      <div className="kayan-catalog-controls">
        <div className="kayan-catalog__toolbar">
          <div className="kayan-phase-tabs" role="group" aria-label={t.phase}>{bundle.project.phases.map((item) => <button type="button" key={item.slug} aria-pressed={item.slug === phase?.slug} className={item.slug === phase?.slug ? 'is-active' : ''} onClick={() => choosePhase(item.slug)}><span>{phaseLabel(item, language)}</span><small>{slug === 'ofiyat' || slug === 'meros' ? phaseAvailabilityLabel(item.availableUnits, language) : item.availableUnits}</small></button>)}</div>
          <div className="kayan-mode-tabs" role="group" aria-label={t.view}>{modes.map((item) => <button type="button" key={item} aria-pressed={mode === item} className={mode === item ? 'is-active' : ''} onClick={() => chooseMode(item)}>{modeLabels[item]}</button>)}</div>
        </div>
        <div className={`kayan-filterbar ${phase?.propertyType === 'parking' ? 'is-parking' : ''}`}>
          {phase?.propertyType !== 'parking' ? <div role="group" aria-label={t.rooms}><span>{t.rooms}</span><button type="button" aria-pressed={roomFilter === 'all'} className={roomFilter === 'all' ? 'is-active' : ''} onClick={() => { setRoomFilter('all'); if (isOfiyat) { setSelectedUnitID(null); setExpandedCardUnitID(null); } setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery({ rooms: undefined, unit: undefined }); }}>{t.all}</button>{rooms.map((room) => <button type="button" key={room} aria-pressed={roomFilter === room} className={roomFilter === room ? 'is-active' : ''} onClick={() => { setRoomFilter(room); if (isOfiyat) { setSelectedUnitID(null); setExpandedCardUnitID(null); } setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery({ rooms: String(room), unit: undefined }); }}>{room}</button>)}</div> : null}
          <button className={`kayan-availability-toggle ${onlyAvailable ? 'is-active' : ''}`} type="button" aria-pressed={onlyAvailable} onClick={() => { const next = !onlyAvailable; setOnlyAvailable(next); if (isOfiyat) { setSelectedUnitID(null); setExpandedCardUnitID(null); } setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery({ available: next ? '1' : undefined, unit: undefined }); }}><i>{onlyAvailable ? '✓' : '○'}</i><span><strong>{t.onlyAvailable}</strong><small>{t.onlyAvailableHint}</small></span></button>
          <div className="kayan-filterbar__meta"><p>{totalObjectCountLabel(filteredUnits.length, language)}</p>{!isMirador && mode !== 'cards' && chessPan.overflow && chessPan.visible ? <div className="kayan-chess__buttons" role="group" aria-label={t.swipe}><button type="button" aria-label={t.scrollBack} disabled={!chessPan.canLeft} onClick={() => panChess(-1)}>←</button><button type="button" aria-label={t.scrollForward} disabled={!chessPan.canRight} onClick={() => panChess(1)}>→</button></div> : null}</div>
        </div>
        {isMirador || isOfiyat ? <div className={isMirador ? 'mirador-catalog-filters' : 'ofiyat-catalog-filters'} role="group" aria-label={t.filters}>
          <label><span>{t.entranceFilter}</span><select value={entranceFilter} onChange={(event) => { const next = event.target.value as EntranceFilter; setEntranceFilter(next); if (isOfiyat) { setFloorFilter('all'); setSelectedUnitID(null); setExpandedCardUnitID(null); } setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery(isOfiyat ? { entrance: next === 'all' ? undefined : next, floor: undefined, unit: undefined } : { entrance: next === 'all' ? undefined : next, unit: undefined }); }}><option value="all">{t.allEntrances}</option>{entrances.map((entrance) => <option key={entrance} value={entrance}>{t.entrance} {entrance}</option>)}</select></label>
          <label><span>{t.floorFilter}</span><select value={floorFilter} onChange={(event) => { const next = event.target.value === 'all' ? 'all' : Number(event.target.value); setFloorFilter(next); if (isOfiyat) { setSelectedUnitID(null); setExpandedCardUnitID(null); } setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery({ floor: next === 'all' ? undefined : String(next), unit: undefined }); }}><option value="all">{t.allFloors}</option>{floors.map((floor) => <option key={floor} value={floor}>{t.floor} {floorLabel(floor)}</option>)}</select></label>
          <label><span>{t.sort}</span><select value={sortMode} onChange={(event) => { const next = event.target.value as SortMode; setSortMode(next); setVisibleCardCount(CATALOG_CARD_PAGE_SIZE); updateCatalogQuery({ sort: next === 'status' ? undefined : next }); }}><option value="status">{t.sortStatus}</option><option value="price-asc">{t.sortPrice}</option><option value="area-asc">{t.sortArea}</option><option value="floor-desc">{t.sortFloor}</option></select></label>
        </div> : null}
      </div>

      {mode === 'cards' ? <><div className="kayan-card-catalog" aria-live="polite">
        {visibleCardUnits.length ? visibleCardUnits.map((unit) => {
          const layout = representativeLayout(unit, bundle.layouts);
          const planImage = unit.planImageUrl || layout?.imageUrl;
          const hasExactPlan = Boolean(unit.planImageUrl);
          return <article key={unit.id} className={unit.id === selectedUnit?.id ? 'is-selected' : ''}>
            <button type="button" className="kayan-card-catalog__select" aria-pressed={unit.id === selectedUnit?.id} onClick={() => chooseUnit(unit)}>
              <span><small>{unit.propertyType === 'parking' ? t.parking : `${t.apartment} №${unit.number}`}</small><i data-status={unit.status}>{t.statusLabels[unit.status]}</i></span>
              <figure>{planImage ? <img src={mediaURL(planImage)} alt={hasExactPlan ? `${t.plan} ${t.apartment} №${unit.number}` : t.layoutDisclaimer} loading="lazy" decoding="async" /> : <b>{t.noPlan}</b>}<figcaption>{planImage ? (hasExactPlan ? t.plan : t.layoutExample) : ''}</figcaption></figure>
              <dl className={unit.propertyType === 'parking' ? 'is-parking' : undefined}><div><dt>{t.area}</dt><dd>{unit.area} {areaUnit(language)}</dd></div><div><dt>{t.floor}</dt><dd>{floorLabel(unit.floor)}</dd></div>{unit.propertyType !== 'parking' ? <div><dt>{t.rooms}</dt><dd>{unit.rooms ?? '—'}</dd></div> : null}</dl>
              <div className="kayan-card-catalog__price"><small>{t.cost}</small><strong>{money(unit.price, language)}</strong>{unit.pricePerM2 ? <span>{money(Math.round(unit.pricePerM2), language)} / {areaUnit(language)}</span> : null}</div>
            </button>
            {planImage ? <button type="button" className="kayan-card-catalog__expand" onClick={() => { chooseUnit(unit, false); setExpandedCardUnitID(unit.id); }} aria-label={`${t.expandPlan}: ${unit.propertyType === 'parking' ? t.parking : `${t.apartment} №${unit.number}`}`}><span>{t.expandPlan}</span>↗</button> : null}
            <button type="button" className="kayan-card-catalog__lead" onClick={() => { chooseUnit(unit, false); setLeadOpen(true); }}>{unit.status === 'available' || unit.status === 'reserved' ? t.askTerms : t.pickSimilar}<span>↗</span></button>
          </article>;
        }) : <div className="kayan-empty">{t.empty}</div>}
      </div>{cardUnits.length ? <div className={`kayan-card-pagination${isMirador ? ' mirador-card-pagination' : ''}`} aria-live="polite"><p>{t.showing} {visibleCardUnits.length} {t.ofObjects} {cardUnits.length}</p>{visibleCardUnits.length < cardUnits.length ? <button type="button" onClick={() => setVisibleCardCount((count) => Math.min(cardUnits.length, count + CATALOG_CARD_PAGE_SIZE))}>{t.showMore}<span>+{Math.min(CATALOG_CARD_PAGE_SIZE, cardUnits.length - visibleCardUnits.length)}</span></button> : null}</div> : null}</> : <div className="kayan-chess">
        <div className="kayan-chess__legend">
          {isMirador ? <div className="mirador-chess__statuses">{chessStatusLegend}</div> : chessStatusLegend}
          {isMirador && chessPan.overflow ? <div className="kayan-chess__buttons mirador-chess__buttons" role="group" aria-label={t.swipe}><button type="button" aria-label={t.scrollBack} disabled={!chessPan.canLeft} onClick={() => panChess(-1)}>←</button><button type="button" aria-label={t.scrollForward} disabled={!chessPan.canRight} onClick={() => panChess(1)}>→</button></div> : null}
        </div>
        <div ref={chessScrollRef} className="kayan-chess__scroll" data-lenis-prevent tabIndex={0} aria-label={`${t.chess}: ${t.floor}`} onKeyDown={onChessKeyDown} style={{ '--kayan-chess-content-width': `${chessContentWidth}px` } as CSSProperties}>{chessRows.length ? chessRows.map(({ floor, items }) => <div className="kayan-chess__row" key={floor}><div className="kayan-chess__floor"><strong>{floorLabel(floor)}</strong><span>{t.floor}</span></div><div className="kayan-chess__units">{items.map((unit) => <button type="button" key={unit.id} aria-label={catalogUnitAriaLabel({ projectName: config.name, phaseLabel: currentPhaseLabel, language, unit })} aria-pressed={unit.id === selectedUnit?.id} aria-controls="kayan-unit-detail" data-status={unit.status} className={unit.id === selectedUnit?.id ? 'is-selected' : ''} onClick={() => chooseUnit(unit)}><strong>№{unit.number}</strong><span>{unit.rooms ? `${unit.rooms} · ${unit.area} ${areaUnit(language)}` : `${t.parking} · ${unit.area} ${areaUnit(language)}`}</span><small>{money(unit.price, language)}</small></button>)}</div></div>) : <div className="kayan-empty kayan-chess__empty">{t.empty}</div>}</div>
        <UnitDetail unit={selectedUnit} layout={selectedLayout} language={language} onLead={() => setLeadOpen(true)} compact />
      </div>}
    </section>

    {expandedCardUnit ? <CatalogPlanLightbox unit={expandedCardUnit} layout={expandedCardLayout} language={language} onClose={() => setExpandedCardUnitID(null)} /> : null}
    <ProjectFooter slug={slug} language={language} routeContext={catalogRouteContext} />
    {leadOpen ? <LeadModal open language={language} context={leadContext} onClose={() => setLeadOpen(false)} projectName={config.name} hideBrand tagline={copy.tagline} facts={copy.facts.slice(0, 3).map((fact) => `${fact.value} · ${fact.label}`)} submitUrl={leadSubmitUrl()} projectSlug={slug} unitKey={selectedUnit?.sourceKey} privacyUrl={privacyRoute(slug, language, catalogRouteContext)} requireConsent /> : null}
  </main>;
}

function CatalogPlanLightbox({ unit, layout, language, onClose }: { unit: Unit; layout?: Layout; language: KayanLanguage; onClose: () => void }) {
  const t = ui[language];
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const planImage = unit.planImageUrl || layout?.imageUrl;
  const hasExactPlan = Boolean(unit.planImageUrl);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.body.classList.add('is-kayan-plan-open');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('is-kayan-plan-open');
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  if (!planImage) return null;
  return <div ref={dialogRef} className="kayan-plan-lightbox" role="dialog" aria-modal="true" aria-label={hasExactPlan ? `${t.plan} №${unit.number}` : t.layoutExample} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <button ref={closeRef} type="button" onClick={onClose} aria-label={t.closePlan}>×</button>
    <img src={mediaURL(planImage)} alt={hasExactPlan ? `${t.plan} №${unit.number}` : t.layoutDisclaimer} />
    <p>{hasExactPlan ? `${t.apartment} №${unit.number}` : t.layoutExample}<span>{hasExactPlan ? `${unit.rooms ? `${unit.rooms} · ` : ''}${unit.area} ${areaUnit(language)}` : t.layoutDisclaimer}</span></p>
  </div>;
}

function UnitDetail({ unit, layout, language, onLead, compact = false }: { unit?: Unit; layout?: Layout; language: KayanLanguage; onLead: () => void; compact?: boolean }) {
  const t = ui[language];
  const [planOpen, setPlanOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!planOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setPlanOpen(false); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.body.classList.add('is-kayan-plan-open');
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('is-kayan-plan-open');
      window.removeEventListener('keydown', closeOnEscape);
      previous?.focus();
    };
  }, [planOpen]);
  if (!unit) return <aside id="kayan-unit-detail" className="kayan-unit-detail" aria-live="polite"><div className="kayan-empty">{t.selectObject}</div></aside>;
  const planImage = unit.planImageUrl || layout?.imageUrl;
  const hasExactPlan = Boolean(unit.planImageUrl);
  const unitTitle = unit.rooms
    ? language === 'ru'
      ? `${unit.rooms}-комнатная квартира`
      : language === 'uz'
        ? `${unit.rooms} xonali xonadon`
        : `${unit.rooms}-bedroom apartment`
    : t.parking;
  return <>
    <aside id="kayan-unit-detail" className={`kayan-unit-detail ${compact ? 'is-compact' : ''}`} data-lenis-prevent aria-live="polite">
      <header><span>{unit.propertyType === 'parking' ? t.parking : t.apartment} №{unit.number}</span><i data-status={unit.status}>{t.statusLabels[unit.status]}</i></header>
      {planImage ? <div className="kayan-unit-detail__plan"><small>{hasExactPlan ? t.plan : t.layoutExample}</small><button type="button" onClick={() => setPlanOpen(true)} aria-label={hasExactPlan ? `${t.expandPlan}: ${t.apartment} №${unit.number}` : `${t.expandPlan}: ${t.layoutExample}`}><span>{t.expandPlan}</span>↗</button><img key={`${hasExactPlan ? unit.id : 'example'}-${layout?.id ?? 'exact'}`} src={mediaURL(planImage)} alt={hasExactPlan ? `${t.plan} ${t.apartment} №${unit.number}` : t.layoutDisclaimer} loading="eager" decoding="async" />{!hasExactPlan ? <p className="kayan-unit-detail__plan-note">{t.layoutDisclaimer}</p> : null}</div> : null}
      <h3>{unitTitle}</h3>
      <dl><div><dt>{t.area}</dt><dd>{unit.area} {areaUnit(language)}</dd></div><div><dt>{t.floor}</dt><dd>{floorLabel(unit.floor)}</dd></div><div><dt>{t.entrance}</dt><dd>{unit.entrance || '—'}</dd></div><div><dt>{t.status}</dt><dd>{t.statusLabels[unit.status]}</dd></div></dl>
      <div className="kayan-unit-detail__price"><span>{t.cost}</span><strong>{money(unit.price, language)}</strong>{unit.pricePerM2 ? <small>{money(Math.round(unit.pricePerM2), language)} / {areaUnit(language)}</small> : null}</div>
      <button type="button" onClick={onLead}>{unit.status === 'available' || unit.status === 'reserved' ? t.askTerms : t.pickSimilar}<span>↗</span></button>
    </aside>
    {planOpen && planImage ? <div ref={dialogRef} className="kayan-plan-lightbox" role="dialog" aria-modal="true" aria-label={hasExactPlan ? `${t.plan} №${unit.number}` : t.layoutExample} onClick={(event) => { if (event.target === event.currentTarget) setPlanOpen(false); }}><button ref={closeRef} type="button" onClick={() => setPlanOpen(false)} aria-label={t.closePlan}>×</button><img src={mediaURL(planImage)} alt={hasExactPlan ? `${t.plan} №${unit.number}` : t.layoutDisclaimer} /><p>{hasExactPlan ? `${t.apartment} №${unit.number}` : t.layoutExample}<span>{hasExactPlan ? `${unit.rooms ? `${unit.rooms} · ` : ''}${unit.area} ${areaUnit(language)}` : t.layoutDisclaimer}</span></p></div> : null}
  </>;
}
