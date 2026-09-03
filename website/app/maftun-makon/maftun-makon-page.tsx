'use client';

/* eslint-disable @next/next/no-img-element */

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LeadModal } from '@/app/lead-modal';
import { useLiveCatalogProject } from '@/app/live-catalog';
import { maftunScrollBehavior, useMaftunSmoothScroll } from './maftun-interactions';
import { maftunLeadSubmitUrl } from './maftun-lead';

type Language = 'ru' | 'uz' | 'en';
type MediaKind = 'render' | 'photo' | 'concept' | 'construction';
type Slide = {
  src: string;
  kind: MediaKind;
  title: Record<Language, string>;
};
type LightboxState = { slides: Slide[]; index: number } | null;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const storageKey = 'maftun-makon-language-v1';
const heroAlt: Record<Language, string> = {
  ru: 'Ночной фасад Maftun Makon · официальный рендер',
  uz: 'Maftun Makon tungi fasadi · rasmiy render',
  en: 'Maftun Makon night façade · official render',
};

const copy = {
  ru: {
    skip: 'К содержанию', menu: 'Меню', close: 'Закрыть', language: 'Язык',
    nav: { story: 'Город в городе', classes: 'Классы', architecture: 'Архитектура', garden: 'Сад', gallery: 'Галерея', location: 'Окружение' },
    heroCity: 'Ташкент · проспект Янги Узбекистон', heroTitle: 'Сад за', heroAccent: 'порталом.',
    heroFact: 'Город в городе · дома 4–7 этажей · ближайшая сдача — IV квартал 2026',
    choose: 'Выбрать квартиру', discover: 'Открыть историю', consultation: 'Получить консультацию',
    render: 'Рендер', photo: 'Фотография', concept: 'Концепт-рендер', construction: 'Ход строительства',
    facts: ['Актуальные предложения в каталоге', 'Не менее 44% территории — озеленение', 'Comfort · Comfort+ · Business', 'Закрытые дворы без машин'],
    storyTop: '01 · Большой маршрут', storyTitle: 'Город раскрывается как сад.',
    storyText: 'Maftun Makon — жилой квартал от NRG-BI и AL-BINA в новой развивающейся части Ташкента, вдоль проспекта Янги Узбекистон. Его принцип — «город в городе»: повседневные сценарии собраны внутри большого квартала.',
    masterplanCaption: 'Концептуальный мастерплан · официальный материал',
    chaptersTitle: 'Восемь частей — три уровня жизни',
    chapters: [
      ['Nur · Kaya · Sham', 'Comfort', 'Начало садового маршрута'],
      ['Safa · Tumar · Orin', 'Comfort', 'Продолжение квартала'],
      ['Samar', 'Comfort+', 'Отдельная глава'],
      ['Zar', 'Business', 'Камерный акцент'],
    ],
    classesTop: '02 · Три уровня', classesTitle: 'Разный характер. Общий сад.',
    classesText: 'Структура проекта объединяет Comfort, Comfort+ и Business. Названия частей и технические названия домов приводятся отдельно, без выдуманного соответствия.',
    classItems: [
      ['Comfort', 'Nur, Kaya, Sham, Safa, Tumar, Orin', 'Шесть частей квартала'],
      ['Comfort+', 'Samar', 'Повышенный уровень'],
      ['Business', 'Zar', 'Деловой класс'],
    ],
    architectureTop: '03 · Архитектура', architectureTitle: 'Низкий силуэт и большой горизонт.',
    architectureText: 'Дома высотой 4–7 этажей образуют спокойный масштаб квартала. В официальных материалах показаны разные фасадные решения для трёх классов.',
    gardenTop: '04 · Двор и ландшафт', gardenTitle: 'Внутри — пространство без машин.',
    gardenText: 'Закрытые дворы, прогулочные и workout-зоны, детские пространства, видеонаблюдение и охрана 24/7. Не менее 44% территории проекта отведено под озеленение.',
    landscapeCaption: 'Опубликованная фотография готового озеленения · класс и очередь источником не указаны',
    hallTop: '05 · Готовые пространства', hallTitle: 'Холл Business — уже фотография.',
    hallText: 'Эти опубликованные кадры показывают холлы класса Business. Они отделены от концептов и рендеров.',
    environmentTop: '06 · Окружение', environmentTitle: 'Новая часть Ташкента растёт рядом.',
    environmentText: 'Материалы проекта перечисляют пять крупных ориентиров без обещаний по времени в пути.',
    places: ['Парк Yangi O‘zbekiston', 'Олимпийская деревня', 'CAEx', 'Central Asian University', 'Новый аэропорт'],
    galleryTop: '07 · Маркированная галерея', galleryTitle: 'Рендеры, фотографии и стройка — отдельно.',
    galleryText: 'Каждый кадр подписан по типу и контексту. Используйте стрелки, клавиши или свайп; откройте изображение на весь экран.',
    previous: 'Предыдущий кадр', next: 'Следующий кадр', openImage: 'Открыть на весь экран', slide: 'Кадр',
    constructionNote: 'Последний опубликованный официальный отчёт — июль 2026. Исходный архив включает 17 месячных групп и 78 строительных фотографий.',
    contactTop: '08 · Следующий шаг', contactTitle: 'Выберите квартиру за порталом.',
    contactText: 'В каталоге автоматически обновляются состав предложений, цены и статусы квартир.',
    catalog: 'Открыть каталог', phone: 'Позвонить · +998 78 113 77 12', booklet: 'Официальный буклет', privacy: 'Конфиденциальность',
    formTitle: 'Запросить консультацию', formText: 'Менеджер проекта уточнит ваш сценарий покупки и подготовит актуальную подборку Maftun Makon.',
    footerNote: 'Информация и цены данные каталога не являются публичной офертой. Актуальные условия подтверждает отдел продаж.',
  },
  uz: {
    skip: 'Mazmunga o‘tish', menu: 'Menyu', close: 'Yopish', language: 'Til',
    nav: { story: 'Shahar ichida shahar', classes: 'Toifalar', architecture: 'Arxitektura', garden: 'Bog‘', gallery: 'Galereya', location: 'Atrof' },
    heroCity: 'Toshkent · Yangi O‘zbekiston shoh ko‘chasi', heroTitle: 'Portal ortidagi', heroAccent: 'bog‘.',
    heroFact: 'Shahar ichida shahar · 4–7 qavatli uylar · eng yaqin topshirish — 2026-yil IV choragi',
    choose: 'Xonadon tanlash', discover: 'Hikoyani ochish', consultation: 'Maslahat olish',
    render: 'Render', photo: 'Fotosurat', concept: 'Konsept-render', construction: 'Qurilish jarayoni',
    facts: ['Katalogdagi dolzarb takliflar', 'Hududning kamida 44 foizi ko‘kalamzor', 'Comfort · Comfort+ · Business', 'Avtomobilsiz yopiq hovlilar'],
    storyTop: '01 · Katta yo‘nalish', storyTitle: 'Shahar bog‘ kabi ochiladi.',
    storyText: 'Maftun Makon — NRG-BI va AL-BINA kompaniyalarining Toshkentning yangi rivojlanayotgan qismida, Yangi O‘zbekiston shoh ko‘chasi bo‘ylab joylashgan turar joy mavzesi. Uning tamoyili — «shahar ichida shahar».',
    masterplanCaption: 'Konseptual bosh reja · rasmiy material', chaptersTitle: 'Sakkiz qism — uch hayot darajasi',
    chapters: [['Nur · Kaya · Sham', 'Comfort', 'Bog‘ yo‘nalishining boshlanishi'], ['Safa · Tumar · Orin', 'Comfort', 'Mavzening davomi'], ['Samar', 'Comfort+', 'Alohida bob'], ['Zar', 'Business', 'Kamerali urg‘u']],
    classesTop: '02 · Uch daraja', classesTitle: 'Turli xarakter. Umumiy bog‘.',
    classesText: 'Loyiha tarkibi Comfort, Comfort+ va Business toifalarini birlashtiradi. Qismlar va uylarning texnik nomlari o‘ylab topilgan mosliksiz, alohida keltirilgan.',
    classItems: [['Comfort', 'Nur, Kaya, Sham, Safa, Tumar, Orin', 'Mavzening olti qismi'], ['Comfort+', 'Samar', 'Yuqori daraja'], ['Business', 'Zar', 'Biznes toifasi']],
    architectureTop: '03 · Arxitektura', architectureTitle: 'Past siluet va keng ufq.',
    architectureText: '4–7 qavatli uylar mavzening sokin miqyosini yaratadi. Rasmiy materiallarda uch toifa uchun turli fasad yechimlari ko‘rsatilgan.',
    gardenTop: '04 · Hovli va landshaft', gardenTitle: 'Ichkarida — avtomobilsiz makon.',
    gardenText: 'Yopiq hovlilar, sayr va workout zonalari, bolalar maydonlari, 24/7 videokuzatuv va qo‘riqlash. Hududning kamida 44 foizi ko‘kalamzorlashtiriladi.',
    landscapeCaption: 'Tayyor ko‘kalamzorning e’lon qilingan fotosurati · manbada toifa va navbat ko‘rsatilmagan',
    hallTop: '05 · Tayyor makonlar', hallTitle: 'Business xolli — bu allaqachon fotosurat.',
    hallText: 'Ushbu e’lon qilingan kadrlar Business toifasi xollarini ko‘rsatadi. Ular konsept va renderlardan alohida berilgan.',
    environmentTop: '06 · Atrof', environmentTitle: 'Toshkentning yangi qismi yonma-yon rivojlanmoqda.',
    environmentText: 'Loyiha materiallarida yo‘l vaqti bo‘yicha va’dalarsiz besh yirik mo‘ljal sanaladi.',
    places: ['Yangi O‘zbekiston bog‘i', 'Olimpiya shaharchasi', 'CAEx', 'Central Asian University', 'Yangi aeroport'],
    galleryTop: '07 · Belgilangan galereya', galleryTitle: 'Render, fotosurat va qurilish — alohida.',
    galleryText: 'Har bir kadr turi va kontekstiga ko‘ra belgilangan. Strelka, klaviatura yoki swipe ishlating; tasvirni to‘liq ekranda oching.',
    previous: 'Oldingi kadr', next: 'Keyingi kadr', openImage: 'To‘liq ekranda ochish', slide: 'Kadr',
    constructionNote: 'So‘nggi e’lon qilingan rasmiy hisobot — 2026-yil iyul. Asl arxivda 17 oylik guruh va 78 ta qurilish fotosurati bor.',
    contactTop: '08 · Keyingi qadam', contactTitle: 'Portal ortidagi xonadonni tanlang.',
    contactText: 'Takliflar, narxlar va xonadon holatlari rasmiy katalogdan avtomatik yangilanadi.',
    catalog: 'Katalogni ochish', phone: 'Qo‘ng‘iroq · +998 78 113 77 12', booklet: 'Rasmiy buklet', privacy: 'Maxfiylik',
    formTitle: 'Maslahat so‘rash', formText: 'Loyiha menejeri xarid maqsadingizni aniqlab, Maftun Makon bo‘yicha dolzarb variantlarni tayyorlaydi.',
    footerNote: 'Katalog ma’lumotlari ma’lumotlari va narxlari ommaviy oferta emas. Amaldagi shartlarni savdo bo‘limi tasdiqlaydi.',
  },
  en: {
    skip: 'Skip to content', menu: 'Menu', close: 'Close', language: 'Language',
    nav: { story: 'City within a city', classes: 'Classes', architecture: 'Architecture', garden: 'Garden', gallery: 'Gallery', location: 'Surroundings' },
    heroCity: 'Tashkent · Yangi O‘zbekiston Avenue', heroTitle: 'A garden beyond', heroAccent: 'the portal.',
    heroFact: 'A city within a city · 4–7-storey homes · nearest handover — Q4 2026',
    choose: 'Choose an apartment', discover: 'Discover the story', consultation: 'Request a consultation',
    render: 'Render', photo: 'Photograph', concept: 'Concept render', construction: 'Construction progress',
    facts: ['Current catalogue listings', 'At least 44% of the site is landscaped', 'Comfort · Comfort+ · Business', 'Enclosed car-free courtyards'],
    storyTop: '01 · The long route', storyTitle: 'The city unfolds like a garden.',
    storyText: 'Maftun Makon is a residential quarter by NRG-BI and AL-BINA, located along Yangi O‘zbekiston Avenue in a newly developing part of Tashkent. Its principle is “a city within a city”, bringing everyday settings into one large quarter.',
    masterplanCaption: 'Conceptual masterplan · official material', chaptersTitle: 'Eight parts — three levels of living',
    chapters: [['Nur · Kaya · Sham', 'Comfort', 'The garden route begins'], ['Safa · Tumar · Orin', 'Comfort', 'The quarter continues'], ['Samar', 'Comfort+', 'A distinct chapter'], ['Zar', 'Business', 'A more intimate accent']],
    classesTop: '02 · Three levels', classesTitle: 'Different characters. One garden.',
    classesText: 'The project structure brings together Comfort, Comfort+ and Business. Part names and technical building names remain separate, without an invented mapping.',
    classItems: [['Comfort', 'Nur, Kaya, Sham, Safa, Tumar, Orin', 'Six parts of the quarter'], ['Comfort+', 'Samar', 'An elevated level'], ['Business', 'Zar', 'Business class']],
    architectureTop: '03 · Architecture', architectureTitle: 'A low silhouette and a wide horizon.',
    architectureText: 'Buildings of 4–7 storeys set a calm scale. Official materials show different façade treatments for the three classes.',
    gardenTop: '04 · Courtyard and landscape', gardenTitle: 'Inside is a car-free space.',
    gardenText: 'Enclosed courtyards, walking and workout areas, children’s spaces, and 24/7 video surveillance and security. At least 44% of the site is landscaped.',
    landscapeCaption: 'Published photograph of completed landscaping · the source does not specify class or phase',
    hallTop: '05 · Completed spaces', hallTitle: 'The Business lobby is already a photograph.',
    hallText: 'These published images show Business-class lobbies. They are kept separate from concepts and renders.',
    environmentTop: '06 · Surroundings', environmentTitle: 'A new part of Tashkent is growing nearby.',
    environmentText: 'The project materials list five major landmarks without travel-time promises.',
    places: ['Yangi O‘zbekiston Park', 'Olympic Village', 'CAEx', 'Central Asian University', 'New airport'],
    galleryTop: '07 · Labelled gallery', galleryTitle: 'Renders, photographs and construction — separated.',
    galleryText: 'Every frame is labelled by type and context. Use arrows, keyboard or swipe, then open an image fullscreen.',
    previous: 'Previous frame', next: 'Next frame', openImage: 'Open fullscreen', slide: 'Frame',
    constructionNote: 'The latest published official report is July 2026. The source archive contains 17 monthly groups and 78 construction photographs.',
    contactTop: '08 · Next step', contactTitle: 'Choose an apartment beyond the portal.',
    contactText: 'Listings, prices and statuses update automatically from the official catalogue.',
    catalog: 'Open catalogue', phone: 'Call · +998 78 113 77 12', booklet: 'Official booklet', privacy: 'Privacy',
    formTitle: 'Request a consultation', formText: 'The project manager will clarify your purchase plans and prepare current Maftun Makon options.',
    footerNote: 'Live catalogue information and prices are not a public offer. Current terms are confirmed by the sales team.',
  },
} as const;

const architectureSlides: Slide[] = [
  { src: '/maftun-makon/images/architecture-day.webp', kind: 'render', title: { ru: 'Дневной фасад · официальный hero-render', uz: 'Kunduzgi fasad · rasmiy hero-render', en: 'Daytime façade · official hero render' } },
  { src: '/maftun-makon/images/architecture-cam5.webp', kind: 'render', title: { ru: 'Архитектура квартала · официальный рендер', uz: 'Mavze arxitekturasi · rasmiy render', en: 'Quarter architecture · official render' } },
  { src: '/maftun-makon/images/architecture-cam2.webp', kind: 'render', title: { ru: 'Фасад и двор · официальный рендер', uz: 'Fasad va hovli · rasmiy render', en: 'Façade and courtyard · official render' } },
  { src: '/maftun-makon/images/architecture-comfort.webp', kind: 'render', title: { ru: 'Архитектура Comfort · официальный рендер', uz: 'Comfort arxitekturasi · rasmiy render', en: 'Comfort architecture · official render' } },
];

const landscapeSlides: Slide[] = [
  { src: '/maftun-makon/images/landscape-1.webp', kind: 'photo', title: { ru: 'Готовый двор и фасады', uz: 'Tayyor hovli va fasadlar', en: 'Completed courtyard and façades' } },
  { src: '/maftun-makon/images/landscape-2.webp', kind: 'photo', title: { ru: 'Хвойные посадки во дворе', uz: 'Hovlidagi ignabargli ekinlar', en: 'Conifer planting in the courtyard' } },
  { src: '/maftun-makon/images/landscape-3.webp', kind: 'photo', title: { ru: 'Детское пространство и озеленение', uz: 'Bolalar makoni va ko‘kalamzor', en: 'Children’s space and landscaping' } },
  { src: '/maftun-makon/images/landscape-4.webp', kind: 'photo', title: { ru: 'Прогулочный маршрут и пергола', uz: 'Sayr yo‘li va pergola', en: 'Walking route and pergola' } },
];

const hallSlides: Slide[] = [
  { src: '/maftun-makon/images/hall-business-1.webp', kind: 'photo', title: { ru: 'Готовый холл · Business', uz: 'Tayyor xoll · Business', en: 'Completed lobby · Business' } },
  { src: '/maftun-makon/images/hall-business-2.webp', kind: 'photo', title: { ru: 'Зона ожидания · Business', uz: 'Kutish zonasi · Business', en: 'Waiting area · Business' } },
  { src: '/maftun-makon/images/hall-business-3.webp', kind: 'photo', title: { ru: 'Арочный проход · Business', uz: 'Ravoqli yo‘lak · Business', en: 'Arched passage · Business' } },
];

const constructionSlides: Slide[] = [
  { src: '/maftun-makon/images/construction-2026-07-1.webp', kind: 'construction', title: { ru: 'Июль 2026 · официальный отчёт', uz: '2026-yil iyul · rasmiy hisobot', en: 'July 2026 · official report' } },
  { src: '/maftun-makon/images/construction-2026-07-2.webp', kind: 'construction', title: { ru: 'Июль 2026 · официальный отчёт', uz: '2026-yil iyul · rasmiy hisobot', en: 'July 2026 · official report' } },
  { src: '/maftun-makon/images/construction-2026-07-3.webp', kind: 'construction', title: { ru: 'Июль 2026 · официальный отчёт', uz: '2026-yil iyul · rasmiy hisobot', en: 'July 2026 · official report' } },
];

const labelledGallery = [...architectureSlides.slice(0, 2), ...landscapeSlides.slice(0, 2), ...hallSlides.slice(0, 2)];

function asset(path: string) {
  return `${appBasePath}${path}`;
}

function withLanguage(path: string, language: Language) {
  return `${appBasePath}${path}?lang=${language}`;
}

function privacyUrl(language: Language) {
  return `${withLanguage('/privacy', language)}&project=maftun-makon`;
}

function useLanguage(initialLanguage: Language) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = window.localStorage.getItem(storageKey);
    const next = languages.includes(query as Language)
      ? query as Language
      : languages.includes(saved as Language)
        ? saved as Language
        : 'ru';
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

function useReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-maftun-reveal]'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        (entry.target as HTMLElement).classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

function kindLabel(kind: MediaKind, language: Language) {
  const t = copy[language];
  return kind === 'render' ? t.render : kind === 'photo' ? t.photo : kind === 'concept' ? t.concept : t.construction;
}

function MediaButton({ slide, language, index, slides, onOpen, className = '' }: {
  slide: Slide;
  language: Language;
  index: number;
  slides: Slide[];
  onOpen: (state: NonNullable<LightboxState>) => void;
  className?: string;
}) {
  const t = copy[language];
  return (
    <button className={`maftun-media ${className}`} type="button" onClick={() => onOpen({ slides, index })} aria-label={`${t.openImage}: ${slide.title[language]}`}>
      <img src={asset(slide.src)} alt={slide.title[language]} loading="lazy" decoding="async" />
      <span><b>{kindLabel(slide.kind, language)}</b>{slide.title[language]}</span>
      <i aria-hidden="true">↗</i>
    </button>
  );
}

function Lightbox({ state, language, onClose }: { state: NonNullable<LightboxState>; language: Language; onClose: () => void }) {
  const [index, setIndex] = useState(state.index);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const touchX = useRef(0);
  const t = copy[language];
  const move = useCallback((direction: number) => setIndex((value) => (value + direction + state.slides.length) % state.slides.length), [state.slides.length]);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    document.body.classList.add('maftun-overlay-locked');
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('maftun-overlay-locked');
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => previousFocus.current?.focus({ preventScroll: true }));
    };
  }, [move, onClose]);

  const current = state.slides[index];
  return (
    <div ref={panelRef} className="maftun-lightbox" role="dialog" aria-modal="true" aria-label={current.title[language]} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onTouchStart={(event) => { touchX.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touchX.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }}>
      <button ref={closeRef} className="maftun-lightbox__close" type="button" onClick={onClose} aria-label={t.close}>×</button>
      <button className="maftun-lightbox__prev" type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button>
      <figure>
        <img src={asset(current.src)} alt={current.title[language]} />
        <figcaption><span><b>{kindLabel(current.kind, language)}</b>{current.title[language]}</span><strong>{index + 1} / {state.slides.length}</strong></figcaption>
      </figure>
      <button className="maftun-lightbox__next" type="button" onClick={() => move(1)} aria-label={t.next}>→</button>
    </div>
  );
}

function GalleryRail({ slides, language, label, onOpen }: { slides: Slide[]; language: Language; label?: string; onOpen: (state: NonNullable<LightboxState>) => void }) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const t = copy[language];

  const go = (next: number) => {
    const value = Math.max(0, Math.min(slides.length - 1, next));
    setIndex(value);
    const viewport = scrollRef.current;
    const child = viewport?.children[value] as HTMLElement | undefined;
    if (viewport && child) viewport.scrollTo({ left: child.offsetLeft - viewport.offsetLeft, behavior: maftunScrollBehavior() });
  };

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
    if (event.key === 'Home') { event.preventDefault(); go(0); }
    if (event.key === 'End') { event.preventDefault(); go(slides.length - 1); }
  };

  const onScroll = () => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    if (viewport.scrollLeft <= 1) { setIndex(0); return; }
    if (viewport.scrollLeft >= max - 2) { setIndex(slides.length - 1); return; }
    const children = Array.from(viewport.children) as HTMLElement[];
    const closest = children.reduce((best, child, childIndex) => Math.abs(child.offsetLeft - viewport.offsetLeft - viewport.scrollLeft) < Math.abs(children[best].offsetLeft - viewport.offsetLeft - viewport.scrollLeft) ? childIndex : best, 0);
    setIndex(closest);
  };

  return (
    <div className="maftun-gallery-rail" data-maftun-reveal data-maftun-stagger>
      <header>
        <span aria-live="polite">{t.slide} {index + 1} / {slides.length}</span>
        <div>
          <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t.previous}>←</button>
          <button type="button" onClick={() => go(index + 1)} disabled={index === slides.length - 1} aria-label={t.next}>→</button>
        </div>
      </header>
      <div ref={scrollRef} className="maftun-gallery-rail__viewport" tabIndex={0} onKeyDown={onKey} onScroll={onScroll} aria-label={label ?? t.galleryTitle}>
        {slides.map((slide, slideIndex) => <MediaButton key={slide.src} slide={slide} language={language} index={slideIndex} slides={slides} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

export function MaftunMakonPage({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const { data: catalogProject, dataSource } = useLiveCatalogProject('maftun-makon', { slug: 'maftun-makon', name: 'Maftun Makon', totalUnits: 0, availableUnits: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const [leadContext, setLeadContext] = useState<string>();
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuNavigationTargetRef = useRef<string | undefined>(undefined);
  const t = copy[language];
  const catalogCount = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US').format(catalogProject.availableUnits);
  const projectFacts = dataSource === 'embedded' ? t.facts : [
    language === 'ru' ? `${catalogCount} актуальных предложений` : language === 'uz' ? `${catalogCount} ta dolzarb taklif` : `${catalogCount} current listings`,
    ...t.facts.slice(1),
  ];
  useReveal();
  useMaftunSmoothScroll();

  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const dismissMenu = useCallback(() => setMenuOpen(false), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const closeLead = useCallback(() => setLeadContext(undefined), []);

  useEffect(() => {
    if (!menuOpen) return;
    const menuButton = menuButtonRef.current;
    document.body.classList.add('maftun-menu-locked');
    menuPanelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); dismissMenu(); return; }
      if (event.key !== 'Tab' || !menuPanelRef.current) return;
      const focusable = Array.from(menuPanelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!menuPanelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('maftun-menu-locked');
      window.removeEventListener('keydown', onKey);
      const navigationTarget = menuNavigationTargetRef.current;
      menuNavigationTargetRef.current = undefined;
      window.requestAnimationFrame(() => {
        if (navigationTarget) {
          document.getElementById(navigationTarget)?.focus({ preventScroll: true });
          return;
        }
        menuButton?.focus({ preventScroll: true });
      });
    };
  }, [dismissMenu, menuOpen]);

  return (
    <main className="maftun-site" id="top" lang={language}>
      <a className="maftun-skip" href="#maftun-content" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>{t.skip}</a>
      <header className="maftun-header">
        <a className="maftun-wordmark" href={withLanguage('/maftun-makon', language)} aria-label="Maftun Makon" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>MAFTUN <span>MAKON</span></a>
        <nav className="maftun-header__nav" aria-label="Primary" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>{Object.entries(t.nav).map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <a className="maftun-header__phone" href="tel:+998781137712" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>+998 78 113 77 12</a>
        <div className="maftun-languages" aria-label={t.language} aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>{languages.map((item) => <button type="button" key={item} aria-pressed={language === item} className={language === item ? 'is-active' : ''} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
        <button ref={menuButtonRef} className="maftun-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen} aria-haspopup="dialog" aria-controls="maftun-menu"><span>{t.menu}</span><i aria-hidden="true" /></button>
      </header>

      <div id="maftun-menu" className={`maftun-menu ${menuOpen ? 'is-open' : ''}`} role={menuOpen ? 'dialog' : undefined} aria-modal={menuOpen ? true : undefined} aria-label={t.menu} aria-hidden={!menuOpen} inert={!menuOpen ? true : undefined}>
        <button className="maftun-menu__backdrop" type="button" onClick={dismissMenu} tabIndex={-1} aria-label={t.close} />
        <div ref={menuPanelRef} className="maftun-menu__panel">
          <button className="maftun-menu__close" type="button" onClick={dismissMenu}>{t.close}<span>×</span></button>
          <nav aria-label="Menu">{Object.entries(t.nav).map(([id, label], index) => <a key={id} href={`#${id}`} onClick={() => { menuNavigationTargetRef.current = id; closeMenu(); }}><span>0{index + 1}</span>{label}</a>)}</nav>
          <footer><div aria-label={t.language}>{languages.map((item) => <button type="button" key={item} aria-pressed={language === item} className={language === item ? 'is-active' : ''} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><a href={withLanguage('/maftun-makon/apartments', language)}>{t.choose} ↗</a></footer>
        </div>
      </div>

      <section className="maftun-hero" aria-labelledby="maftun-title" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>
        <picture><source media="(max-width:700px)" srcSet={asset('/maftun-makon/images/hero-mobile.webp')} /><img src={asset('/maftun-makon/images/hero-night.webp')} alt={heroAlt[language]} /></picture>
        <div className="maftun-hero__veil" />
        <div className="maftun-hero__portal" aria-hidden="true" />
        <div className="maftun-hero__content">
          <p>{t.heroCity}</p>
          <h1 id="maftun-title">{t.heroTitle}<em>{t.heroAccent}</em></h1>
          <span>{t.heroFact}</span>
          <div><a className="maftun-button maftun-button--gold" href={withLanguage('/maftun-makon/apartments', language)}>{t.choose}<b>↗</b></a><a className="maftun-hero__link" href="#story">{t.discover} ↓</a></div>
        </div>
        <small><b>{t.render}</b> · NRG-BI / AL-BINA</small>
      </section>

      <div id="maftun-content" tabIndex={-1} aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>
        <section className="maftun-facts" aria-label="Project facts">{projectFacts.map((fact, index) => <div key={fact}><span>0{index + 1}</span><strong>{fact}</strong></div>)}</section>

        <section className="maftun-story" id="story" tabIndex={-1}>
          <header data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.storyTop}</p><h2>{t.storyTitle}</h2><p>{t.storyText}</p></header>
          <figure className="maftun-masterplan" data-maftun-reveal><img src={asset('/maftun-makon/images/masterplan.webp')} alt={t.masterplanCaption} loading="lazy" /><figcaption><b>{t.concept}</b>{t.masterplanCaption}</figcaption></figure>
          <div className="maftun-chapters" data-maftun-reveal data-maftun-stagger><h3>{t.chaptersTitle}</h3><ol>{t.chapters.map(([name, level, note], index) => <li key={name}><span>0{index + 1}</span><div><strong>{name}</strong><small>{note}</small></div><b>{level}</b></li>)}</ol></div>
        </section>

        <section className="maftun-classes" id="classes" tabIndex={-1}>
          <header data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.classesTop}</p><h2>{t.classesTitle}</h2><p>{t.classesText}</p></header>
          <div className="maftun-class-list" data-maftun-reveal data-maftun-stagger>{t.classItems.map(([level, names, note], index) => <article key={level}><span>0{index + 1}</span><h3>{level}</h3><p>{names}</p><small>{note}</small></article>)}</div>
        </section>

        <section className="maftun-architecture" id="architecture" tabIndex={-1}>
          <header data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.architectureTop}</p><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p></header>
          <div className="maftun-architecture__gallery" data-maftun-reveal data-maftun-stagger>{architectureSlides.map((slide, index) => <MediaButton key={slide.src} slide={slide} language={language} index={index} slides={architectureSlides} onOpen={setLightbox} className={index === 0 ? 'is-main' : ''} />)}</div>
        </section>

        <section className="maftun-garden" id="garden" tabIndex={-1}>
          <div className="maftun-garden__concept" data-maftun-reveal><img src={asset('/maftun-makon/images/courtyard-orin.webp')} alt={`${t.concept} · Orin`} loading="lazy" /><span><b>{t.concept}</b> · Orin</span></div>
          <div className="maftun-garden__copy" data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.gardenTop}</p><h2>{t.gardenTitle}</h2><p>{t.gardenText}</p><strong>44<small>%</small></strong></div>
          <div className="maftun-landscape-gallery" data-maftun-reveal data-maftun-stagger>{landscapeSlides.map((slide, index) => <MediaButton key={slide.src} slide={slide} language={language} index={index} slides={landscapeSlides} onOpen={setLightbox} className={index === 0 || index === 3 ? 'is-wide' : ''} />)}</div>
          <p className="maftun-provenance">{t.landscapeCaption}</p>
        </section>

        <section className="maftun-halls">
          <header data-maftun-reveal data-maftun-stagger><div><p className="maftun-overline">{t.hallTop}</p><h2>{t.hallTitle}</h2></div><p>{t.hallText}</p></header>
          <div className="maftun-halls__gallery" data-maftun-reveal data-maftun-stagger>{hallSlides.map((slide, index) => <MediaButton key={slide.src} slide={slide} language={language} index={index} slides={hallSlides} onOpen={setLightbox} className={index === 0 ? 'is-main' : ''} />)}</div>
        </section>

        <section className="maftun-environment" id="location" tabIndex={-1}>
          <div className="maftun-environment__image" data-maftun-reveal><img src={asset('/maftun-makon/images/territory-aerial.webp')} alt={`${t.render} · Maftun Makon`} loading="lazy" /><span><b>{t.render}</b> · Maftun Makon</span></div>
          <div className="maftun-environment__copy" data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.environmentTop}</p><h2>{t.environmentTitle}</h2><p>{t.environmentText}</p><ol>{t.places.map((place, index) => <li key={place}><span>0{index + 1}</span><strong>{place}</strong></li>)}</ol></div>
        </section>

        <section className="maftun-gallery" id="gallery" tabIndex={-1}>
          <header data-maftun-reveal data-maftun-stagger><div><p className="maftun-overline">{t.galleryTop}</p><h2>{t.galleryTitle}</h2></div><p>{t.galleryText}</p></header>
          <GalleryRail slides={labelledGallery} language={language} onOpen={setLightbox} />
          <div className="maftun-construction-gallery">
            <div className="maftun-construction-note"><h3>{t.construction}</h3><p>{t.constructionNote}</p></div>
            <GalleryRail slides={constructionSlides} language={language} label={t.construction} onOpen={setLightbox} />
          </div>
        </section>

        <section className="maftun-contact">
          <div className="maftun-contact__copy" data-maftun-reveal data-maftun-stagger><p className="maftun-overline">{t.contactTop}</p><h2>{t.contactTitle}</h2><p>{t.contactText}</p><div><a className="maftun-button maftun-button--gold" href={withLanguage('/maftun-makon/apartments', language)}>{t.catalog}<b>↗</b></a><a className="maftun-text-link" href="tel:+998781137712">{t.phone}</a></div></div>
          <div className="maftun-contact__form" data-maftun-reveal data-maftun-stagger><small>MAFTUN MAKON · NRG-BI × AL-BINA</small><h3>{t.formTitle}</h3><p>{t.formText}</p><button className="maftun-contact__lead-button" type="button" data-lead-trigger onClick={() => setLeadContext('maftun-makon:landing:contact-panel:consultation-cta')}>{t.consultation}<span>↗</span></button></div>
        </section>
      </div>

      <footer className="maftun-footer" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>
        <a className="maftun-wordmark" href={withLanguage('/maftun-makon', language)}>MAFTUN <span>MAKON</span></a>
        <nav><a href={privacyUrl(language)}>{t.privacy}</a></nav>
        <p>{t.footerNote}</p><a href="#top" aria-label="Back to top">↑</a>
      </footer>

      {leadContext ? <div className="maftun-lead-host" data-project-slug="maftun-makon" data-context={leadContext}><LeadModal open language={language} context={leadContext} hideBrand projectName="MAFTUN MAKON" tagline={`${t.heroTitle} ${t.heroAccent}`} facts={projectFacts.slice(0, 3)} submitUrl={maftunLeadSubmitUrl()} projectSlug="maftun-makon" privacyUrl={privacyUrl(language)} requireConsent onClose={closeLead} /></div> : null}
      {lightbox ? <Lightbox state={lightbox} language={language} onClose={closeLightbox} /> : null}
    </main>
  );
}
