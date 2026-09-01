'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';
import type { KayanLanguage } from '@/app/kayan/project-data';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: KayanLanguage[] = ['ru', 'uz', 'en'];

const content = {
  ru: {
    nav: ['О проекте', 'Архитектура', 'Двор', 'Локация', 'Строительство'],
    choose: 'Выбрать квартиру', menu: 'Меню', close: 'Закрыть', contact: 'Получить консультацию', scroll: 'Исследовать проект',
    eyebrow: 'MEROS · МИРАБАД · ТАШКЕНТ', title: 'Создано сегодня.', titleAccent: 'Останется на поколения.',
    heroCopy: 'Современная архитектура, природный камень и тёплая семейная среда в одном из самых живых районов Ташкента.',
    heroMeta: ['Бизнес & Комфорт+', '11 · 13 · 16 этажей', 'Сроки: Комфорт — II кв. 2026 · Бизнес — IV кв. 2027'],
    storyKicker: '01 · ИДЕЯ', storyTitle: 'Наследие — это не прошлое.', storyAccent: 'Это то, что останется после нас.',
    storyCopy: 'Meros переосмысливает знакомые ценности через современную архитектуру: основательные материалы, приватный семейный двор и пространства, которые красиво проживают время.',
    storyAside: 'Архитектура соединяет ритм города и спокойствие дома. Без буквальных стилизаций — только честные материалы, точные пропорции и уважение к месту.',
    facts: [['Business & Comfort+', 'два сценария жизни'], ['Мирабад', 'ул. 8 Марта'], ['11 · 13 · 16', 'этажей в силуэте'], ['1-я линия', 'коммерческие помещения']],
    architectureKicker: '02 · АРХИТЕКТУРА', architectureTitle: 'Современная форма.', architectureAccent: 'Характер надолго.',
    architectureCopy: 'Выберите маркер, чтобы увидеть, как конструкция, свет и материалы работают вместе.',
    architectureFeatures: [
      ['Натуральный камень', 'Вентилируемые фасады с природной фактурой рассчитаны на долгий срок службы.'],
      ['Сейсмостойкий каркас', 'Монолитная конструкция и стены из газоблока отвечают требованиям современной городской архитектуры.'],
      ['Увеличенные окна', 'Больше естественного света и открытые виды на город и внутренний двор.'],
      ['Выразительный силуэт', 'Объёмы высотой 11, 13 и 16 этажей создают узнаваемую композицию квартала.'],
    ],
    courtyardKicker: '03 · СЕМЕЙНЫЙ ДВОР', courtyardTitle: 'Место, где традиции', courtyardAccent: 'становятся частью дня.',
    courtyardCopy: 'Закрытый двор продолжает дом: фруктовый сад, тихие места для отдыха и активные зоны собраны в цельный семейный сценарий.',
    courtyardItems: ['Фруктовый сад и ландшафт', 'Детские площадки по возрастам', 'Спортивная зона', 'Чайхана с тандыром и казаном'],
    lifeKicker: '04 · СЦЕНАРИИ ЖИЗНИ', lifeTitle: 'Один двор.', lifeAccent: 'Разный ритм дня.',
    lifeTabs: ['Утро', 'Семейный день', 'Вечер'],
    lifeCopy: [
      ['Тишина до начала дня', 'Свет проходит сквозь кроны, а прогулочные дорожки становятся местом для спокойного старта.'],
      ['Пространство для семьи', 'Игровые, спортивные и тихие зоны позволяют каждому выбрать свой темп и оставаться рядом.'],
      ['Тёплый свет дома', 'Двор замедляет городской ритм и собирает соседей и близких в камерной атмосфере.'],
    ],
    hallsKicker: '05 · ХОЛЛЫ', hallsTitle: 'Возвращение домой', hallsAccent: 'начинается у входа.',
    hallsCopy: 'Авторская отделка, мягкие зоны ожидания и сквозные входы создают спокойное первое впечатление.',
    hallItems: ['Face ID и видеонаблюдение', 'Бесшумные лифты', 'Колясочные помещения', 'Сквозные входные группы'],
    locationKicker: '06 · ЛОКАЦИЯ', locationTitle: 'Мирабад.', locationAccent: 'Город в естественной близости.',
    locationCopy: 'Meros расположен на улице 8 Марта — в районе, где деловой ритм, образование, парки и повседневные маршруты уже сложились.',
    places: ['Alfraganus Mall', 'Парк Фурката', 'Tashkent International School', 'Мирабадский базар'], map: 'Открыть карту', route: 'Построить маршрут',
    constructionKicker: '07 · ХОД СТРОИТЕЛЬСТВА', constructionTitle: 'Реальный прогресс.', constructionAccent: 'Июль 2026.',
    constructionCopy: 'Актуальный отчёт по Business-очереди: в блоке 1 завершён монолит, на 9-м этаже идёт кладка, на 6-м — сантехнические работы, на 8-м — электромонтаж. Начаты кровельные работы.',
    constructionStatus: ['Блок 1', 'монолит завершён'], panorama: 'Панорама 360°',
    selectionKicker: '08 · ВЫБОР КВАРТИРЫ', selectionTitle: 'Найдите пространство,', selectionAccent: 'которое станет вашим.',
    selectionCopy: '256 активных предложений из официального каталога: точные площади, цены, этажи и планировки.', selectionButton: 'Открыть каталог',
    footerNote: 'Информация на сайте не является публичной офертой. Наличие, стоимость и условия покупки уточняйте у менеджера.',
  },
  uz: {
    nav: ['Loyiha', 'Arxitektura', 'Hovli', 'Joylashuv', 'Qurilish'],
    choose: 'Xonadon tanlash', menu: 'Menyu', close: 'Yopish', contact: 'Maslahat olish', scroll: 'Loyihani ko‘rish',
    eyebrow: 'MEROS · MIROBOD · TOSHKENT', title: 'Bugun yaratilgan.', titleAccent: 'Avlodlarga qoladi.',
    heroCopy: 'Toshkentning serharakat tumanlaridan birida zamonaviy arxitektura, tabiiy tosh va iliq oilaviy muhit.',
    heroMeta: ['Biznes & Komfort+', '11 · 13 · 16 qavat', 'Muddat: Komfort — 2026 II chorak · Biznes — 2027 IV chorak'],
    storyKicker: '01 · G‘OYA', storyTitle: 'Meros — faqat o‘tmish emas.', storyAccent: 'U bizdan keyin qoladigan qadriyat.',
    storyCopy: 'Meros tanish qadriyatlarni zamonaviy arxitektura orqali qayta talqin qiladi: mustahkam materiallar, yopiq oilaviy hovli va vaqt o‘tishi bilan yanada go‘zal bo‘ladigan makonlar.',
    storyAside: 'Arxitektura shahar sur’ati va uy sokinligini birlashtiradi. Soxta bezaklarsiz — tabiiy materiallar, aniq nisbatlar va joyga hurmat.',
    facts: [['Biznes & Komfort+', 'ikki hayot ssenariysi'], ['Mirobod', '8 Mart ko‘chasi'], ['11 · 13 · 16', 'qavatli siluet'], ['1-qator', 'tijorat binolari']],
    architectureKicker: '02 · ARXITEKTURA', architectureTitle: 'Zamonaviy shakl.', architectureAccent: 'Uzoq yillik xarakter.',
    architectureCopy: 'Konstruksiya, yorug‘lik va materiallar uyg‘unligini ko‘rish uchun belgini tanlang.',
    architectureFeatures: [
      ['Tabiiy tosh', 'Tabiiy fakturali shamollatiladigan fasad uzoq xizmat qilish uchun yaratilgan.'],
      ['Zilzilabardosh karkas', 'Monolit konstruksiya va gazoblok devorlar zamonaviy shahar talablari asosida ishlangan.'],
      ['Kengaytirilgan derazalar', 'Ko‘proq tabiiy yorug‘lik, shahar va ichki hovliga ochiq manzaralar.'],
      ['Ifodali siluet', '11, 13 va 16 qavatli hajmlar kvartalning taniqli kompozitsiyasini yaratadi.'],
    ],
    courtyardKicker: '03 · OILAVIY HOVLI', courtyardTitle: 'An’analar kunning', courtyardAccent: 'bir qismiga aylanadi.',
    courtyardCopy: 'Yopiq hovli uyning davomi: mevali bog‘, sokin dam olish va faol zonalar yagona oilaviy ssenariyga birlashgan.',
    courtyardItems: ['Mevali bog‘ va landshaft', 'Yoshga mos bolalar maydonlari', 'Sport hududi', 'Tandir va qozonli choyxona'],
    lifeKicker: '04 · HAYOT SSENARIYLARI', lifeTitle: 'Bitta hovli.', lifeAccent: 'Kunning turli sur’ati.',
    lifeTabs: ['Tong', 'Oilaviy kun', 'Oqshom'],
    lifeCopy: [
      ['Kun boshlanishidan oldingi sokinlik', 'Yorug‘lik daraxtlar orasidan o‘tadi, sayr yo‘laklari esa kunni osoyishta boshlash uchun xizmat qiladi.'],
      ['Oila uchun makon', 'O‘yin, sport va sokin hududlar har kimga o‘z ritmini tanlash va yaqin qolish imkonini beradi.'],
      ['Uyning iliq nuri', 'Hovli shahar sur’atini sekinlashtirib, qo‘shnilar va yaqinlarni kamer muhitda birlashtiradi.'],
    ],
    hallsKicker: '05 · XOLLAR', hallsTitle: 'Uyga qaytish', hallsAccent: 'kirishdan boshlanadi.',
    hallsCopy: 'Mualliflik bezagi, yumshoq kutish joylari va ikki tomonlama kirishlar sokin birinchi taassurot yaratadi.',
    hallItems: ['Face ID va videokuzatuv', 'Shovqinsiz liftlar', 'Bolalar aravachasi xonalari', 'Ikki tomonlama kirishlar'],
    locationKicker: '06 · JOYLASHUV', locationTitle: 'Mirobod.', locationAccent: 'Shahar tabiiy yaqinlikda.',
    locationCopy: 'Meros 8 Mart ko‘chasida — ish, ta’lim, bog‘lar va kundalik yo‘nalishlar shakllangan hududda joylashgan.',
    places: ['Alfraganus Mall', 'Furqat bog‘i', 'Tashkent International School', 'Mirobod bozori'], map: 'Xaritani ochish', route: 'Yo‘nalish qurish',
    constructionKicker: '07 · QURILISH JARAYONI', constructionTitle: 'Haqiqiy taraqqiyot.', constructionAccent: '2026-yil iyul.',
    constructionCopy: 'Business bosqichining dolzarb hisoboti: 1-blokda monolit yakunlangan, 9-qavatda g‘isht terish, 6-qavatda santexnika, 8-qavatda elektr montaj ishlari olib borilmoqda. Tom yopish ishlari boshlangan.',
    constructionStatus: ['1-blok', 'monolit yakunlangan'], panorama: '360° panorama',
    selectionKicker: '08 · XONADON TANLASH', selectionTitle: 'O‘zingizniki bo‘ladigan', selectionAccent: 'makonni toping.',
    selectionCopy: 'Rasmiy katalogdan 256 ta faol taklif: aniq maydon, narx, qavat va rejalar.', selectionButton: 'Katalogni ochish',
    footerNote: 'Saytdagi ma’lumot ommaviy oferta emas. Mavjudlik, narx va xarid shartlarini menejerdan aniqlang.',
  },
  en: {
    nav: ['About', 'Architecture', 'Courtyard', 'Location', 'Construction'],
    choose: 'Choose an apartment', menu: 'Menu', close: 'Close', contact: 'Request a consultation', scroll: 'Explore the project',
    eyebrow: 'MEROS · MIROBOD · TASHKENT', title: 'Created today.', titleAccent: 'Made to outlast generations.',
    heroCopy: 'Contemporary architecture, natural stone and a warm family setting in one of Tashkent’s most established districts.',
    heroMeta: ['Business & Comfort+', '11 · 13 · 16 storeys', 'Due: Comfort — Q2 2026 · Business — Q4 2027'],
    storyKicker: '01 · THE IDEA', storyTitle: 'Heritage is not only the past.', storyAccent: 'It is what remains after us.',
    storyCopy: 'Meros reinterprets familiar values through contemporary architecture: lasting materials, a private family courtyard and spaces designed to age beautifully.',
    storyAside: 'The architecture brings the city’s rhythm and the calm of home together. No literal pastiche — only honest materials, exact proportions and respect for place.',
    facts: [['Business & Comfort+', 'two ways of living'], ['Mirobod', '8 Marta Street'], ['11 · 13 · 16', 'storeys in the skyline'], ['First line', 'commercial spaces']],
    architectureKicker: '02 · ARCHITECTURE', architectureTitle: 'Contemporary form.', architectureAccent: 'Enduring character.',
    architectureCopy: 'Select a marker to see how structure, light and material work together.',
    architectureFeatures: [
      ['Natural stone', 'Ventilated façades with a natural texture are specified for lasting performance.'],
      ['Seismic-resistant frame', 'A monolithic structure and gas-block walls meet the needs of contemporary urban architecture.'],
      ['Larger windows', 'More natural light and open views towards the city and the inner courtyard.'],
      ['Expressive skyline', 'Volumes of 11, 13 and 16 storeys create a recognisable composition.'],
    ],
    courtyardKicker: '03 · FAMILY COURTYARD', courtyardTitle: 'Where traditions', courtyardAccent: 'become part of every day.',
    courtyardCopy: 'The private courtyard continues the home: orchard, quiet retreats and active zones come together in one family landscape.',
    courtyardItems: ['Orchard and landscape', 'Age-specific play areas', 'Outdoor workout space', 'Tea house with tandir and kazan'],
    lifeKicker: '04 · WAYS OF LIVING', lifeTitle: 'One courtyard.', lifeAccent: 'A different pace through the day.',
    lifeTabs: ['Morning', 'Family day', 'Evening'],
    lifeCopy: [
      ['Quiet before the day begins', 'Light moves through the trees while the walking paths offer a calm start.'],
      ['A place for family', 'Play, sport and quiet zones let everyone choose their own pace while staying close.'],
      ['The warm light of home', 'The courtyard slows the city down and brings neighbours and loved ones together.'],
    ],
    hallsKicker: '05 · LOBBIES', hallsTitle: 'Coming home', hallsAccent: 'starts at the entrance.',
    hallsCopy: 'Bespoke finishes, soft waiting areas and through entrances create a calm first impression.',
    hallItems: ['Face ID and CCTV', 'Quiet lifts', 'Stroller rooms', 'Through entrance lobbies'],
    locationKicker: '06 · LOCATION', locationTitle: 'Mirobod.', locationAccent: 'The city naturally close.',
    locationCopy: 'Meros is set on 8 Marta Street, where business, education, parks and everyday routes are already established.',
    places: ['Alfraganus Mall', 'Furkat Park', 'Tashkent International School', 'Mirobod Bazaar'], map: 'Open map', route: 'Build a route',
    constructionKicker: '07 · CONSTRUCTION', constructionTitle: 'Real progress.', constructionAccent: 'July 2026.',
    constructionCopy: 'Latest Business-phase report: the structural frame of block 1 is complete; masonry is under way on level 9, plumbing on level 6 and electrical installation on level 8. Roofing work has started.',
    constructionStatus: ['Block 1', 'structural frame complete'], panorama: '360° panorama',
    selectionKicker: '08 · APARTMENT SELECTION', selectionTitle: 'Find a space', selectionAccent: 'to make your own.',
    selectionCopy: '256 active official listings with exact areas, prices, floors and plans.', selectionButton: 'Open catalogue',
    footerNote: 'Information on this site is not a public offer. Please confirm availability, price and purchase terms with a project manager.',
  },
} as const;

const interfaceCopy = {
  ru: {
    introTop: 'ТАШКЕНТ · 41°16′49″ N', introTagline: 'СОВРЕМЕННОЕ НАСЛЕДИЕ', language: 'Язык', menuLocation: 'MEROS · МИРАБАД',
    architectureCaption: 'МАТЕРИАЛ · СВЕТ · ПРОПОРЦИЯ', previous: 'Предыдущее изображение', next: 'Следующее изображение', constructionLabel: 'СТАТУС / BUSINESS',
    contactLabel: 'MEROS · ПЕРСОНАЛЬНЫЙ ПОДБОР', privacy: 'Конфиденциальность',
    alts: { hero: 'Архитектурная визуализация жилого комплекса Meros', facade: 'Фасад Meros', boulevard: 'Городской бульвар Meros', architecture: 'Архитектура Meros', courtyard: 'Семейный двор Meros', location: 'Окружение Meros' },
  },
  uz: {
    introTop: 'TOSHKENT · 41°16′49″ N', introTagline: 'ZAMONAVIY MEROS', language: 'Til', menuLocation: 'MEROS · MIROBOD',
    architectureCaption: 'MATERIAL · YORUG‘LIK · NISBAT', previous: 'Oldingi rasm', next: 'Keyingi rasm', constructionLabel: 'HOLAT / BUSINESS',
    contactLabel: 'MEROS · SHAXSIY TANLOV', privacy: 'Maxfiylik',
    alts: { hero: 'Meros turar-joy majmuasining me’moriy vizualizatsiyasi', facade: 'Meros fasadi', boulevard: 'Meros shahar xiyoboni', architecture: 'Meros arxitekturasi', courtyard: 'Meros oilaviy hovlisi', location: 'Meros atrofidagi hudud' },
  },
  en: {
    introTop: 'TASHKENT · 41°16′49″ N', introTagline: 'CONTEMPORARY HERITAGE', language: 'Language', menuLocation: 'MEROS · MIROBOD',
    architectureCaption: 'MATERIAL · LIGHT · PROPORTION', previous: 'Previous image', next: 'Next image', constructionLabel: 'STATUS / BUSINESS',
    contactLabel: 'MEROS · PERSONAL SELECTION', privacy: 'Privacy',
    alts: { hero: 'Architectural visualisation of the Meros residential development', facade: 'Meros facade', boulevard: 'Meros urban boulevard', architecture: 'Meros architecture', courtyard: 'Meros family courtyard', location: 'The neighbourhood around Meros' },
  },
} as const;

const sectionIDs = ['about', 'architecture', 'courtyard', 'location', 'construction'] as const;
const lifeImages = ['/meros/life-morning.webp', '/meros/life-day.webp', '/meros/life-evening.webp'];
const hallImages = ['/meros/hall-1.webp', '/meros/hall-2.webp', '/meros/hall-3.webp'];
const constructionImages = ['/meros/construction-1.webp', '/meros/construction-2.webp', '/meros/construction-3.webp'];
const markerPositions = [['27%', '27%'], ['58%', '45%'], ['72%', '23%'], ['46%', '69%']] as const;

function withLanguage(path: string, language: KayanLanguage) {
  return `${appBasePath}${path}?lang=${language}`;
}

function asset(path: string) {
  return `${appBasePath}${path}`;
}

function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}

function useLanguage(initialLanguage: KayanLanguage = 'ru') {
  const [language, setLanguageState] = useState<KayanLanguage>(initialLanguage);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const stored = window.localStorage.getItem('kayan-language');
    const next = languages.includes(query as KayanLanguage) ? query : stored;
    const frame = window.requestAnimationFrame(() => {
      if (languages.includes(next as KayanLanguage)) setLanguageState(next as KayanLanguage);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: KayanLanguage) => {
    setLanguageState(next);
    window.localStorage.setItem('kayan-language', next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  };
  return [language, setLanguage] as const;
}

function useEntrance() {
  const [loading, setLoading] = useState(true);
  const [skipTransition, setSkipTransition] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = window.sessionStorage.getItem('meros-loader-seen-v1') === '1';
    if (reduced || seen) {
      const frame = window.requestAnimationFrame(() => {
        setSkipTransition(true);
        setLoading(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    document.body.classList.add('is-meros-loading');
    const timer = window.setTimeout(() => {
      setLoading(false);
      document.body.classList.remove('is-meros-loading');
      window.sessionStorage.setItem('meros-loader-seen-v1', '1');
    }, 2100);
    return () => { window.clearTimeout(timer); document.body.classList.remove('is-meros-loading'); };
  }, []);
  return { loading, skipTransition };
}

function useReveals(language: KayanLanguage) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.meros-site [data-reveal]'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8%', threshold: 0.12 });
    nodes.forEach((node) => observer.observe(node));
    const fallback = window.setTimeout(() => nodes.forEach((node) => node.classList.add('is-visible')), 700);
    return () => { window.clearTimeout(fallback); observer.disconnect(); };
  }, [language]);
}

export function MerosPage({ initialAvailable = 256, initialLanguage = 'ru' }: { initialAvailable?: number; initialLanguage?: KayanLanguage }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [architectureFeature, setArchitectureFeature] = useState(0);
  const [life, setLife] = useState(0);
  const [hall, setHall] = useState(0);
  const [construction, setConstruction] = useState(0);
  const { loading, skipTransition } = useEntrance();
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const c = content[language];
  const i = interfaceCopy[language];
  useReveals(language);

  useEffect(() => {
    document.body.classList.toggle('is-meros-menu-open', menuOpen);
    if (!menuOpen) return () => document.body.classList.remove('is-meros-menu-open');
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const nodes = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.classList.remove('is-meros-menu-open');
      window.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [menuOpen]);

  return <main className="meros-site" id="top" lang={language}>
    <a className="meros-skip" href="#about">{c.scroll}</a>
    <div className={`meros-intro ${skipTransition ? 'is-skip' : ''} ${loading ? 'is-visible' : ''}`} aria-hidden={!loading}>
      <div className="meros-intro__grid" /><span>{i.introTop}</span><strong>MEROS</strong><i /><small>{i.introTagline}</small>
    </div>

    <header className="meros-header">
      <a className="meros-brand" href={withLanguage('/meros', language)} aria-label="Meros"><i>M</i><span><strong>MEROS</strong><small>RESIDENCE</small></span></a>
      <nav aria-label={c.menu}>{c.nav.slice(0, 3).map((label, index) => <a key={sectionIDs[index]} href={`#${sectionIDs[index]}`}>{label}</a>)}</nav>
      <div className="meros-header__actions">
        <div className="meros-languages" role="group" aria-label={i.language}>{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
        <a className="meros-header__choose" href={withLanguage('/meros/apartments', language)}>{c.choose}</a>
        <button className="meros-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-label={c.menu}><span>{c.menu}</span><i /><i /></button>
      </div>
    </header>

    <div ref={menuRef} className={`meros-menu ${menuOpen ? 'is-open' : ''}`} inert={!menuOpen ? true : undefined} aria-hidden={!menuOpen}>
      <button ref={closeRef} className="meros-menu__close" type="button" onClick={() => setMenuOpen(false)}><span>{c.close}</span><i /><i /></button>
      <div className="meros-menu__image"><img src={asset('/meros/story-detail.webp')} alt="" /><span>{i.menuLocation}</span></div>
      <nav>{c.nav.map((label, index) => <a key={sectionIDs[index]} href={`#${sectionIDs[index]}`} onClick={() => setMenuOpen(false)}><small>0{index + 1}</small>{label}</a>)}<a href={withLanguage('/meros/apartments', language)} onClick={() => setMenuOpen(false)}><small>06</small>{c.choose}</a></nav>
      <button className="meros-menu__contact" type="button" onClick={() => { setMenuOpen(false); setLeadOpen(true); }}>{c.contact}<span>↗</span></button>
      <a className="meros-menu__phone" href="tel:+998785552020">+998 78 555 20 20</a>
    </div>

    <section className="meros-hero">
      <picture><source media="(max-width: 760px)" srcSet={asset('/meros/hero-mobile.webp')} /><img src={asset('/meros/hero.webp')} alt={i.alts.hero} fetchPriority="high" /></picture>
      <div className="meros-hero__veil" />
      <div className="meros-hero__copy">
        <p>{c.eyebrow}</p><h1>{c.title}<em>{c.titleAccent}</em></h1><span>{c.heroCopy}</span>
        <div className="meros-hero__actions"><a href={withLanguage('/meros/apartments', language)}>{c.choose}<b>↗</b></a><button type="button" onClick={() => setLeadOpen(true)}>{c.contact}</button></div>
      </div>
      <div className="meros-hero__meta">{c.heroMeta.map((item, index) => <span key={item}><small>0{index + 1}</small>{item}</span>)}</div>
      <a className="meros-scroll" href="#about"><i />{c.scroll}</a>
    </section>

    <section className="meros-story" id="about">
      <div className="meros-section-head" data-reveal><p>{c.storyKicker}</p><h2>{c.storyTitle}<em>{c.storyAccent}</em></h2></div>
      <div className="meros-story__grid">
        <figure data-reveal><img src={asset('/meros/story.webp')} alt={i.alts.facade} loading="lazy" /><figcaption>41.280449° N · 69.296886° E</figcaption></figure>
        <div className="meros-story__copy" data-reveal><p>{c.storyCopy}</p><span>{c.storyAside}</span><img src={asset('/meros/story-detail.webp')} alt={i.alts.boulevard} loading="lazy" /></div>
      </div>
      <div className="meros-facts" data-reveal>{c.facts.map(([value, label], index) => <div key={value}><small>0{index + 1}</small><strong>{value}</strong><span>{label}</span></div>)}</div>
    </section>

    <section className="meros-architecture" id="architecture">
      <div className="meros-architecture__copy" data-reveal><p>{c.architectureKicker}</p><h2>{c.architectureTitle}<em>{c.architectureAccent}</em></h2><span>{c.architectureCopy}</span>
        <div className="meros-architecture__detail"><small>0{architectureFeature + 1} / 04</small><h3>{c.architectureFeatures[architectureFeature][0]}</h3><p>{c.architectureFeatures[architectureFeature][1]}</p></div>
      </div>
      <div className="meros-architecture__visual" data-reveal><img src={asset('/meros/architecture.webp')} alt={i.alts.architecture} loading="lazy" />{markerPositions.map(([left, top], index) => <button type="button" key={index} className={architectureFeature === index ? 'is-active' : ''} style={{ left, top }} aria-label={c.architectureFeatures[index][0]} aria-pressed={architectureFeature === index} onClick={() => setArchitectureFeature(index)}><i />0{index + 1}</button>)}<span className="meros-architecture__caption">{i.architectureCaption}</span></div>
    </section>

    <section className="meros-courtyard" id="courtyard">
      <img className="meros-courtyard__background" src={asset('/meros/courtyard-heritage.webp')} alt={i.alts.courtyard} loading="lazy" />
      <div className="meros-courtyard__shade" />
      <div className="meros-courtyard__copy" data-reveal><p>{c.courtyardKicker}</p><h2>{c.courtyardTitle}<em>{c.courtyardAccent}</em></h2><span>{c.courtyardCopy}</span><ul>{c.courtyardItems.map((item, index) => <li key={item}><small>0{index + 1}</small>{item}</li>)}</ul></div>
    </section>

    <section className={`meros-life is-scene-${life}`}>
      <div className="meros-section-head" data-reveal><p>{c.lifeKicker}</p><h2>{c.lifeTitle}<em>{c.lifeAccent}</em></h2></div>
      <div className="meros-life__layout" data-reveal>
        <div className="meros-life__visual">{lifeImages.map((image, index) => <img key={image} className={life === index ? 'is-active' : ''} src={asset(image)} alt={c.lifeTabs[index]} loading="lazy" />)}<small>0{life + 1} · {c.lifeTabs[life]}</small></div>
        <div className="meros-life__controls"><div role="tablist" aria-label={c.lifeKicker}>{c.lifeTabs.map((item, index) => <button type="button" role="tab" key={item} aria-selected={life === index} className={life === index ? 'is-active' : ''} onClick={() => setLife(index)}><small>0{index + 1}</small>{item}</button>)}</div><article><h3>{c.lifeCopy[life][0]}</h3><p>{c.lifeCopy[life][1]}</p></article></div>
      </div>
    </section>

    <section className="meros-halls">
      <div className="meros-halls__copy" data-reveal><p>{c.hallsKicker}</p><h2>{c.hallsTitle}<em>{c.hallsAccent}</em></h2><span>{c.hallsCopy}</span><ul>{c.hallItems.map((item) => <li key={item}>{item}</li>)}</ul></div>
      <div className="meros-halls__gallery" data-reveal><figure><img src={asset(hallImages[hall])} alt={`${c.hallsTitle} ${hall + 1}`} loading="lazy" /><figcaption><span>0{hall + 1} / 03</span><div><button type="button" onClick={() => setHall((hall + 2) % 3)} aria-label={i.previous}>←</button><button type="button" onClick={() => setHall((hall + 1) % 3)} aria-label={i.next}>→</button></div></figcaption></figure><div>{hallImages.map((image, index) => <button type="button" key={image} className={hall === index ? 'is-active' : ''} aria-pressed={hall === index} onClick={() => setHall(index)}><img src={asset(image)} alt="" loading="lazy" /></button>)}</div></div>
    </section>

    <section className="meros-location" id="location">
      <div className="meros-location__copy" data-reveal><p>{c.locationKicker}</p><h2>{c.locationTitle}<em>{c.locationAccent}</em></h2><span>{c.locationCopy}</span><ul>{c.places.map((place, index) => <li key={place}><small>0{index + 1}</small>{place}</li>)}</ul><div><a href="https://yandex.com/maps/?ll=69.296886%2C41.280449&z=16&pt=69.296886,41.280449,pm2rdm" target="_blank" rel="noreferrer">{c.map} ↗</a><a href="https://yandex.com/maps/?rtext=~41.280449%2C69.296886&rtt=auto" target="_blank" rel="noreferrer">{c.route} ↗</a></div></div>
      <div className="meros-location__map" data-reveal><img src={asset('/meros/location-view.webp')} alt={i.alts.location} loading="lazy" /><div className="meros-location__diagram"><i className="meros-location__road road-a" /><i className="meros-location__road road-b" /><i className="meros-location__road road-c" /><span className="meros-location__pin"><b>M</b><small>MEROS</small></span>{c.places.map((place, index) => <span className={`meros-location__place place-${index + 1}`} key={place}><i />{place}</span>)}</div></div>
    </section>

    <section className="meros-construction" id="construction">
      <div className="meros-construction__head" data-reveal><div><p>{c.constructionKicker}</p><h2>{c.constructionTitle}<em>{c.constructionAccent}</em></h2></div><span>{c.constructionCopy}</span></div>
      <div className="meros-construction__layout" data-reveal><figure><img src={asset(constructionImages[construction])} alt={`${c.constructionAccent} ${construction + 1}`} loading="lazy" /><figcaption><span>30.07.2026 · 0{construction + 1}/03</span><div><button type="button" onClick={() => setConstruction((construction + 2) % 3)} aria-label={i.previous}>←</button><button type="button" onClick={() => setConstruction((construction + 1) % 3)} aria-label={i.next}>→</button></div></figcaption></figure><aside><small>{i.constructionLabel}</small><strong>{c.constructionStatus[0]}</strong><span>{c.constructionStatus[1]}</span><div>{constructionImages.map((image, index) => <button type="button" key={image} className={construction === index ? 'is-active' : ''} aria-pressed={construction === index} onClick={() => setConstruction(index)}>0{index + 1}</button>)}</div><a href="https://uzbekistan360.uz/ru/location/nrg-merosuoI" target="_blank" rel="noreferrer">{c.panorama} ↗</a></aside></div>
    </section>

    <section className="meros-selection">
      <img src={asset('/meros/selection.webp')} alt="Meros" loading="lazy" /><div className="meros-selection__shade" /><div data-reveal><p>{c.selectionKicker}</p><h2>{c.selectionTitle}<em>{c.selectionAccent}</em></h2><span>{c.selectionCopy.replace('256', String(initialAvailable))}</span><a href={withLanguage('/meros/apartments', language)}>{c.selectionButton}<b>{initialAvailable}</b><i>↗</i></a></div>
    </section>

    <section className="meros-contact">
      <div data-reveal><span>{i.contactLabel}</span><h2>{c.contact}</h2><button type="button" onClick={() => setLeadOpen(true)}>{c.contact}<i>↗</i></button></div><a href="tel:+998785552020">+998 78 555 20 20</a>
    </section>

    <footer className="meros-footer"><a className="meros-brand" href="#top"><i>M</i><span><strong>MEROS</strong><small>RESIDENCE</small></span></a><p>{c.footerNote}</p><div><a href={`${appBasePath}/privacy?project=meros&lang=${language}`}>{i.privacy}</a><a href="#top">↑ 2026</a></div></footer>

    {leadOpen ? <LeadModal open language={language} context="MEROS · landing" onClose={() => setLeadOpen(false)} projectName="MEROS" hideBrand tagline={language === 'ru' ? 'Современное наследие для будущих поколений.' : language === 'uz' ? 'Kelajak avlodlar uchun zamonaviy meros.' : 'A contemporary legacy for future generations.'} facts={c.facts.slice(0, 3).map(([value, label]) => `${value} · ${label}`)} submitUrl={leadSubmitUrl()} projectSlug="meros" privacyUrl={`${appBasePath}/privacy?project=meros&lang=${language}`} requireConsent /> : null}
  </main>;
}
