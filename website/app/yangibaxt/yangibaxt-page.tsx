'use client';

/* eslint-disable @next/next/no-img-element */

import { usePathname, useRouter } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LeadModal } from '@/app/lead-modal';
import { useLiveCatalogProject } from '@/app/live-catalog';
import { yangiBaxtLeadSubmitUrl } from './yangibaxt-lead';
import { lockYangiBaxtBody, type YangiBaxtLanguage as Language } from './yangibaxt-ui';

type MediaType = 'real-photo' | 'cgi-concept' | 'construction-photo';
type Slide = { src: string; type: MediaType; caption: Record<Language, string> };
type LightboxState = { slides: Slide[]; index: number; opener: HTMLButtonElement };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const storageKey = 'yangibaxt-language';
const languages: Language[] = ['ru', 'uz', 'en'];

function useMobileNavigation() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 820px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) => `${appBasePath}${path}?lang=${language}`;

const gallerySlides: Slide[] = [
  { src: '/yangibaxt/images/realized-landscape-01.webp', type: 'real-photo', caption: { ru: 'Озеленение реализованной части', uz: 'Amalga oshirilgan hududning ko‘kalamzorligi', en: 'Landscaping in the implemented part' } },
  { src: '/yangibaxt/images/realized-landscape-02.webp', type: 'real-photo', caption: { ru: 'Прогулочный маршрут у воды', uz: 'Suv bo‘yidagi sayr yo‘li', en: 'A walking route by the water' } },
  { src: '/yangibaxt/images/realized-landscape-03.webp', type: 'real-photo', caption: { ru: 'Реализованное благоустройство', uz: 'Amalga oshirilgan obodonlashtirish', en: 'Implemented landscaping' } },
  { src: '/yangibaxt/images/gallery-courtyard-01.webp', type: 'real-photo', caption: { ru: 'Двор и детская площадка', uz: 'Hovli va bolalar maydonchasi', en: 'Courtyard and playground' } },
  { src: '/yangibaxt/images/gallery-courtyard-02.webp', type: 'real-photo', caption: { ru: 'Маршрут внутри двора', uz: 'Hovli ichidagi yo‘nalish', en: 'A route through the courtyard' } },
  { src: '/yangibaxt/images/gallery-courtyard-03.webp', type: 'real-photo', caption: { ru: 'Зелёная зона двора', uz: 'Hovlining yashil hududi', en: 'Courtyard green area' } },
  { src: '/yangibaxt/images/gallery-courtyard-04.webp', type: 'real-photo', caption: { ru: 'Благоустройство у дома', uz: 'Uy yonidagi obodonlashtirish', en: 'Landscaping by the building' } },
  { src: '/yangibaxt/images/hall-01.webp', type: 'real-photo', caption: { ru: 'Реализованный дизайнерский холл', uz: 'Amalga oshirilgan dizaynerlik holli', en: 'Implemented designer lobby' } },
  { src: '/yangibaxt/images/hall-03.webp', type: 'real-photo', caption: { ru: 'Общая зона реализованного дома', uz: 'Amalga oshirilgan uyning umumiy hududi', en: 'Common area in an implemented building' } },
];

const towersSlides: Slide[] = [
  { src: '/yangibaxt/images/towers-concept-01.webp', type: 'cgi-concept', caption: { ru: 'Towers-3 · первая линия Ахангаранского шоссе', uz: 'Towers-3 · Ohangaron shossesining birinchi chizig‘i', en: 'Towers-3 · first line of the Akhangaran highway' } },
  { src: '/yangibaxt/images/towers-concept-02.webp', type: 'cgi-concept', caption: { ru: 'Архитектурный сценарий Towers-3', uz: 'Towers-3 me’moriy ssenariysi', en: 'Towers-3 architectural scenario' } },
  { src: '/yangibaxt/images/towers-concept-03.webp', type: 'cgi-concept', caption: { ru: 'Общественный фронт первых этажей', uz: 'Birinchi qavatlarning jamoat fronti', en: 'Active frontage at ground level' } },
];

const constructionSlides: Slide[] = [
  { src: '/yangibaxt/images/construction-2026-07-01.webp', type: 'construction-photo', caption: { ru: 'Yangi Baxt 3 · строительный отчёт 01', uz: 'Yangi Baxt 3 · qurilish hisoboti 01', en: 'Yangi Baxt 3 · construction report 01' } },
  { src: '/yangibaxt/images/construction-2026-07-02.webp', type: 'construction-photo', caption: { ru: 'Yangi Baxt 3 · строительный отчёт 02', uz: 'Yangi Baxt 3 · qurilish hisoboti 02', en: 'Yangi Baxt 3 · construction report 02' } },
  { src: '/yangibaxt/images/construction-2026-07-03.webp', type: 'construction-photo', caption: { ru: 'Yangi Baxt 3 · строительный отчёт 03', uz: 'Yangi Baxt 3 · qurilish hisoboti 03', en: 'Yangi Baxt 3 · construction report 03' } },
  { src: '/yangibaxt/images/construction-2026-07-04.webp', type: 'construction-photo', caption: { ru: 'Yangi Baxt 3 · строительный отчёт 04', uz: 'Yangi Baxt 3 · qurilish hisoboti 04', en: 'Yangi Baxt 3 · construction report 04' } },
];

const copy = {
  ru: {
    skip: 'К содержанию', navLabel: 'Навигация Yangi Baxt', menu: 'Меню', closeMenu: 'Закрыть меню', language: 'Язык',
    nav: [['contour', 'Контур'], ['living', 'Уже живёт'], ['towers', 'Towers-3'], ['gallery', 'Среда'], ['progress', 'Стройка'], ['catalog', 'Квартиры']] as const,
    catalog: 'Выбрать квартиру', consult: 'Оставить заявку', call: 'Позвонить · +998 78 113 77 12',
    heroOverline: 'ТАШКЕНТ · COMFORT / COMFORT+ · АХАНГАРАНСКИЙ ПРОСПЕКТ', heroTitle: 'YANGI BAXT', heroLead: 'Город у озера. В одном ритме с природой.', heroImage: 'Реальная официальная фотография благоустройства Yangi Baxt', heroCgi: 'Towers-3 · официальная CGI-концепция',
    facts: [['58 га', 'территория проекта'], ['7,3 га', 'парковая зона'], ['>30%', 'озеленение']] as const,
    contourIndex: '01 · КОНТУР РАЙОНА', contourTitle: 'Озеро, парк и городская жизнь связаны одним маршрутом.', contourText: 'Yangi Baxt занимает 58 гектаров. Внутри — озеро Baxt, парковая зона 7,3 гектара, спортивные и общественные пространства. Более 30% территории отведено озеленению.', contourCgi: 'Официальная CGI-концепция района · итоговый вид может измениться', contourCards: [['Озеро Baxt', 'точка притяжения'], ['Workout', 'спорт на маршруте'], ['Общественные зоны', 'места для встреч']] as const,
    livingIndex: '02 · УЖЕ ЖИВЁТ', livingTitle: 'II очередь сдана 27 января 2026 года.', livingText: 'Официальная новость подтверждает завершение всех работ во II очереди и появление первых жителей. Здесь — только реальные фотографии реализованной части.', livingPhoto: 'Реальная официальная фотография фасада II очереди', livingCourtyard: 'Реальная официальная фотография двора', livingDate: '27.01.2026 · официальная новость',
    towersIndex: '03 · СЛЕДУЮЩИЙ КОНТУР', towersTitle: 'Towers-3 выходит на первую линию.', towersText: 'Новая очередь формирует городской фасад вдоль Ахангаранского шоссе. Галерея показывает официальную CGI-концепцию, а не готовый дом.', commerceTitle: 'Коммерческий первый этаж', commerceText: 'Высота до 5 м и возможность антресоли относятся только к коммерческим помещениям первых этажей. Это не высота квартир.',
    galleryIndex: '04 · РЕАЛЬНАЯ СРЕДА', galleryTitle: 'Двор, зелень и холлы — без смешения с рендерами.', galleryText: 'Курированная последовательность реальных официальных фотографий: прогулочные дорожки, зелёные зоны, детские площадки и дизайнерские холлы.',
    materialsIndex: '05 · МАТЕРИАЛЫ И АРХИТЕКТУРА', materialsTitle: 'Тактильный фасад, прочные стены, светлые входы.', materialsText: 'Официальные материалы проекта называют натуральный камень и алюминиевые панели SIBALUX, межкомнатные стены из газоблока, межквартирные стены из кирпича и витражные алюминиевые блоки.', materials: ['натуральный камень', 'панели SIBALUX', 'газоблок внутри квартиры', 'кирпич между квартирами', 'витражные алюминиевые блоки'] as const, materialsCgi: 'Официальная CGI-концепция архитектуры · материалы и итоговый вид могут измениться',
    progressIndex: '06 · СТРОЙКА · ИЮЛЬ 2026', progressTitle: 'Yangi Baxt 3 — отчёт, привязанный к дате.', progressText: 'Официальный отчёт за июль 2026 фиксирует работы по монолиту, кладке, стяжке, отделке, инженерным трубам, техническим дверям, окнам, электрике и слаботочным системам. Это ход строительства, а не утверждение о готовности III очереди.',
    catalogIndex: '07 · КАТАЛОГ ОБНОВЛЯЕТСЯ', catalogTitle: 'Актуальные квартиры и официальные статусы.', catalogText: 'Состав квартир, цены и статусы обновляются автоматически. Паркинги, офисы и цокольные объекты в подборку квартир не включены.', catalogStats: [['Актуально', 'квартиры'], ['Онлайн', 'статусы'], ['Официально', 'группы каталога'], ['Автоматически', 'обновление']] as const, catalogGroups: ['Опубликованные группы квартир', 'Актуальные очереди', 'Текущий диапазон площадей', 'Этажи актуальных предложений'] as const, openCatalog: 'Открыть полный каталог', catalogNote: 'Цены, статусы и действующие кампании обновляются автоматически. Текущие условия подтверждает отдел продаж.',
    contactIndex: '08 · КОНТАКТ', contactTitle: 'Начните с маршрута, который подходит именно вам.', contactText: 'Менеджер уточнит сценарий покупки и проверит актуальный статус выбранной квартиры.', address: 'Ташкент, Ахангаранский проспект', formTagline: 'Вместе с природой.', formFacts: ['58 га', 'озеро Baxt', '7,3 га парка'] as const,
    media: { real: 'Реальная официальная фотография', cgi: 'Официальная CGI-концепция · итог может измениться', construction: 'Реальная официальная фотография стройки · июль 2026' },
    galleryLabel: 'Галерея', previous: 'Предыдущее изображение', next: 'Следующее изображение', openImage: 'Открыть изображение', closeImage: 'Закрыть изображение', imageOf: 'из',
    sources: 'Источники', booklet: 'Официальный буклет · 33 страницы', privacy: 'Обработка персональных данных', top: 'Наверх',
    disclaimer: 'Архитектура, благоустройство, фасады, интерьеры, материалы, нумерация и инфраструктура на концептуальных изображениях условны и могут измениться. Информация не является публичной офертой.',
  },
  uz: {
    skip: 'Mazmunga o‘tish', navLabel: 'Yangi Baxt navigatsiyasi', menu: 'Menyu', closeMenu: 'Menyuni yopish', language: 'Til',
    nav: [['contour', 'Kontur'], ['living', 'Hayot boshlangan'], ['towers', 'Towers-3'], ['gallery', 'Muhit'], ['progress', 'Qurilish'], ['catalog', 'Xonadonlar']] as const,
    catalog: 'Xonadon tanlash', consult: 'Ariza qoldirish', call: 'Qo‘ng‘iroq · +998 78 113 77 12',
    heroOverline: 'TOSHKENT · COMFORT / COMFORT+ · OHANGARON PROSPEKTI', heroTitle: 'YANGI BAXT', heroLead: 'Ko‘l bo‘yidagi shahar. Tabiat bilan bir maromda.', heroImage: 'Yangi Baxt obodonlashtirilishining haqiqiy rasmiy fotosurati', heroCgi: 'Towers-3 · rasmiy CGI konsepsiyasi',
    facts: [['58 ga', 'loyiha hududi'], ['7,3 ga', 'park hududi'], ['>30%', 'ko‘kalamzor']] as const,
    contourIndex: '01 · HUDUD KONTURI', contourTitle: 'Ko‘l, park va shahar hayoti bitta yo‘nalishda bog‘langan.', contourText: 'Yangi Baxt 58 gektarni egallaydi. Hududda Baxt ko‘li, 7,3 gektarlik park, sport va jamoat makonlari bor. Hududning 30 foizidan ko‘prog‘i ko‘kalamzorlashtirishga ajratilgan.', contourCgi: 'Hududning rasmiy CGI konsepsiyasi · yakuniy ko‘rinish o‘zgarishi mumkin', contourCards: [['Baxt ko‘li', 'asosiy tortish nuqtasi'], ['Workout', 'yo‘nalishdagi sport'], ['Jamoat hududlari', 'uchrashuv joylari']] as const,
    livingIndex: '02 · HAYOT BOSHLANGAN', livingTitle: 'II bosqich 2026-yil 27-yanvarda topshirilgan.', livingText: 'Rasmiy yangilik II bosqichdagi barcha ishlar yakunlanganini va ilk yashovchilar ko‘chib kelganini tasdiqlaydi. Bu yerda faqat amalga oshirilgan qismning haqiqiy fotosuratlari ko‘rsatilgan.', livingPhoto: 'II bosqich fasadining haqiqiy rasmiy fotosurati', livingCourtyard: 'Hovlining haqiqiy rasmiy fotosurati', livingDate: '27.01.2026 · rasmiy yangilik',
    towersIndex: '03 · KEYINGI KONTUR', towersTitle: 'Towers-3 birinchi chiziqqa chiqadi.', towersText: 'Yangi bosqich Ohangaron shossesi bo‘ylab shahar fasadini shakllantiradi. Galereyada tayyor uy emas, rasmiy CGI konsepsiyasi ko‘rsatilgan.', commerceTitle: 'Birinchi qavatdagi tijorat', commerceText: '5 metrgacha balandlik va antresol imkoniyati faqat birinchi qavatdagi tijorat joylariga tegishli. Bu xonadon balandligi emas.',
    galleryIndex: '04 · HAQIQIY MUHIT', galleryTitle: 'Hovli, yashillik va hollar — renderlar bilan aralashtirilmagan.', galleryText: 'Haqiqiy rasmiy fotosuratlarning saralangan ketma-ketligi: sayr yo‘llari, yashil hududlar, bolalar maydonchalari va dizaynerlik hollari.',
    materialsIndex: '05 · MATERIALLAR VA ME’MORCHILIK', materialsTitle: 'Taktil fasad, mustahkam devorlar, yorug‘ kirishlar.', materialsText: 'Rasmiy materiallarda tabiiy tosh va SIBALUX alyuminiy panellari, gazoblokdan kvartira ichki devorlari, g‘ishtdan kvartiralararo devorlar hamda vitrajli alyuminiy bloklar ko‘rsatilgan.', materials: ['tabiiy tosh', 'SIBALUX panellari', 'xonadon ichida gazoblok', 'xonadonlar orasida g‘isht', 'vitrajli alyuminiy bloklar'] as const, materialsCgi: 'Me’morchilikning rasmiy CGI konsepsiyasi · materiallar va yakuniy ko‘rinish o‘zgarishi mumkin',
    progressIndex: '06 · QURILISH · 2026-YIL IYUL', progressTitle: 'Yangi Baxt 3 — sanaga bog‘langan hisobot.', progressText: '2026-yil iyuldagi rasmiy hisobot monolit, terim, styajka, pardoz, muhandislik quvurlari, texnik eshiklar, derazalar, elektr va past tok tizimlari bo‘yicha ishlarni qayd etadi. Bu III bosqich tayyor degani emas.',
    catalogIndex: '07 · KATALOG YANGILANADI', catalogTitle: 'Dolzarb xonadonlar va rasmiy holatlar.', catalogText: 'Xonadonlar, narxlar va holatlar avtomatik yangilanadi. Parking, ofis va sokol obyektlari xonadonlar tanloviga kiritilmaydi.', catalogStats: [['Dolzarb', 'xonadonlar'], ['Onlayn', 'holatlar'], ['Rasmiy', 'katalog guruhlari'], ['Avtomatik', 'yangilanish']] as const, catalogGroups: ['E’lon qilingan xonadon guruhlari', 'Dolzarb bosqichlar', 'Joriy maydon oralig‘i', 'Dolzarb taklif qavatlari'] as const, openCatalog: 'To‘liq katalogni ochish', catalogNote: 'Narxlar, holatlar va amaldagi kampaniyalar avtomatik yangilanadi. Shartlarni savdo bo‘limi tasdiqlaydi.',
    contactIndex: '08 · ALOQA', contactTitle: 'Sizga mos yo‘nalishdan boshlang.', contactText: 'Menejer xarid maqsadini aniqlaydi va tanlangan xonadonning dolzarb holatini tekshiradi.', address: 'Toshkent, Ohangaron prospekti', formTagline: 'Tabiat bilan birga.', formFacts: ['58 ga', 'Baxt ko‘li', '7,3 ga park'] as const,
    media: { real: 'Haqiqiy rasmiy fotosurat', cgi: 'Rasmiy CGI konsepsiyasi · yakuniy ko‘rinish o‘zgarishi mumkin', construction: 'Qurilishning haqiqiy rasmiy fotosurati · 2026-yil iyul' },
    galleryLabel: 'Galereya', previous: 'Oldingi tasvir', next: 'Keyingi tasvir', openImage: 'Tasvirni ochish', closeImage: 'Tasvirni yopish', imageOf: 'dan',
    sources: 'Manbalar', booklet: 'Rasmiy buklet · 33 sahifa', privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga',
    disclaimer: 'Konseptual tasvirlardagi me’morchilik, obodonlashtirish, fasadlar, interyerlar, materiallar, raqamlash va infratuzilma shartli bo‘lib, o‘zgarishi mumkin. Ma’lumot ommaviy oferta emas.',
  },
  en: {
    skip: 'Skip to content', navLabel: 'Yangi Baxt navigation', menu: 'Menu', closeMenu: 'Close menu', language: 'Language',
    nav: [['contour', 'The loop'], ['living', 'Already lived in'], ['towers', 'Towers-3'], ['gallery', 'Setting'], ['progress', 'Construction'], ['catalog', 'Apartments']] as const,
    catalog: 'Choose an apartment', consult: 'Send an enquiry', call: 'Call · +998 78 113 77 12',
    heroOverline: 'TASHKENT · COMFORT / COMFORT+ · AKHANGARAN AVENUE', heroTitle: 'YANGI BAXT', heroLead: 'A city by the lake. In rhythm with nature.', heroImage: 'Actual official photograph of Yangi Baxt landscaping', heroCgi: 'Towers-3 · official CGI concept',
    facts: [['58 ha', 'project territory'], ['7.3 ha', 'park area'], ['>30%', 'landscaping']] as const,
    contourIndex: '01 · DISTRICT LOOP', contourTitle: 'The lake, park and urban life connect along one route.', contourText: 'Yangi Baxt covers 58 hectares. It includes Lake Baxt, a 7.3-hectare park, sports areas and public spaces. More than 30% of the territory is landscaped.', contourCgi: 'Official CGI district concept · final appearance may change', contourCards: [['Lake Baxt', 'a focal point'], ['Workout', 'sport along the route'], ['Public spaces', 'places to meet']] as const,
    livingIndex: '02 · ALREADY LIVED IN', livingTitle: 'Phase II was completed on 27 January 2026.', livingText: 'The official announcement confirms that all phase II works were completed and the first residents moved in. Only actual photographs of implemented areas appear here.', livingPhoto: 'Actual official photograph of the phase II facade', livingCourtyard: 'Actual official courtyard photograph', livingDate: '27 Jan 2026 · official announcement',
    towersIndex: '03 · THE NEXT LOOP', towersTitle: 'Towers-3 moves onto the first line.', towersText: 'The new phase creates an urban frontage along the Akhangaran highway. The gallery shows an official CGI concept, not a completed building.', commerceTitle: 'Ground-floor commercial space', commerceText: 'Heights of up to 5 m and the option of a mezzanine apply only to ground-floor commercial units. This is not apartment ceiling height.',
    galleryIndex: '04 · THE REAL SETTING', galleryTitle: 'Courtyards, greenery and lobbies — kept separate from renders.', galleryText: 'A curated sequence of actual official photographs: walking paths, green areas, playgrounds and designer lobbies.',
    materialsIndex: '05 · MATERIALS AND ARCHITECTURE', materialsTitle: 'Tactile facades, solid walls, bright entrances.', materialsText: 'Official project materials specify natural stone and SIBALUX aluminium panels, aerated-concrete internal walls, brick party walls and glazed aluminium units.', materials: ['natural stone', 'SIBALUX panels', 'aerated concrete inside apartments', 'brick between apartments', 'glazed aluminium units'] as const, materialsCgi: 'Official CGI architecture concept · materials and final appearance may change',
    progressIndex: '06 · CONSTRUCTION · JULY 2026', progressTitle: 'Yangi Baxt 3 — a report tied to a date.', progressText: 'The official July 2026 report records work on the monolith, masonry, screed, finishes, engineering pipes, technical doors, windows, electrical and low-voltage systems. This is construction progress, not a claim that phase III is complete.',
    catalogIndex: '07 · CATALOGUE UPDATES AUTOMATICALLY', catalogTitle: 'Current apartments and official statuses.', catalogText: 'Apartment listings, prices and statuses update automatically. Parking, offices and basement units are excluded.', catalogStats: [['Current', 'apartments'], ['Automatic', 'status updates'], ['Official', 'floor plans'], ['Confirmed', 'current terms']] as const, catalogGroups: ['Published apartment groups', 'Current phases', 'Current area range', 'Current listing floors'] as const, openCatalog: 'Open the full catalogue', catalogNote: 'Prices, statuses and current campaigns update automatically. The sales team confirms current terms.',
    contactIndex: '08 · CONTACT', contactTitle: 'Start with the route that fits you.', contactText: 'A manager will clarify your purchase scenario and check the current status of the selected apartment.', address: 'Tashkent, Akhangaran Avenue', formTagline: 'Together with nature.', formFacts: ['58 ha', 'Lake Baxt', '7.3 ha park'] as const,
    media: { real: 'Actual official photograph', cgi: 'Official CGI concept · final appearance may change', construction: 'Actual official construction photograph · July 2026' },
    galleryLabel: 'Gallery', previous: 'Previous image', next: 'Next image', openImage: 'Open image', closeImage: 'Close image', imageOf: 'of',
    sources: 'Sources', booklet: 'Official booklet · 33 pages', privacy: 'Personal data processing', top: 'Back to top',
    disclaimer: 'Architecture, landscaping, facades, interiors, materials, numbering and infrastructure shown in concept images are indicative and may change. This information is not a public offer.',
  },
} as const;

function mediaLabel(type: MediaType, language: Language) {
  const t = copy[language].media;
  return type === 'real-photo' ? t.real : type === 'construction-photo' ? t.construction : t.cgi;
}

function Gallery({ slides, language, onOpen }: { slides: Slide[]; language: Language; onOpen: (slides: Slide[], index: number, opener: HTMLButtonElement) => void }) {
  const [index, setIndex] = useState(0);
  const pointerGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const suppressClickTimer = useRef<number | null>(null);
  const t = copy[language];
  const go = (next: number) => setIndex((next + slides.length) % slides.length);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
    if (event.key === 'Home') { event.preventDefault(); go(0); }
    if (event.key === 'End') { event.preventDefault(); go(slides.length - 1); }
  };
  useEffect(() => () => {
    if (suppressClickTimer.current !== null) window.clearTimeout(suppressClickTimer.current);
  }, []);
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointerGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (Math.abs(deltaX) <= 42 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    go(index + (deltaX < 0 ? 1 : -1));
    suppressClick.current = true;
    if (suppressClickTimer.current !== null) window.clearTimeout(suppressClickTimer.current);
    suppressClickTimer.current = window.setTimeout(() => { suppressClick.current = false; }, 350);
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };
  const slide = slides[index];
  return (
    <div className="yb-gallery" role="region" aria-label={t.galleryLabel} tabIndex={0} onKeyDown={onKeyDown}>
      <button
        className="yb-gallery__image"
        type="button"
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
            if (suppressClickTimer.current !== null) window.clearTimeout(suppressClickTimer.current);
            suppressClickTimer.current = null;
            return;
          }
          onOpen(slides, index, event.currentTarget);
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-label={`${t.openImage}: ${slide.caption[language]}`}
      >
        <img src={asset(slide.src)} alt={slide.caption[language]} loading="lazy" decoding="async" draggable={false} />
        <span>{mediaLabel(slide.type, language)}</span>
      </button>
      <div className="yb-gallery__bar">
        <p><strong>{String(index + 1).padStart(2, '0')}</strong><span>/ {String(slides.length).padStart(2, '0')}</span>{slide.caption[language]}</p>
        <div><button type="button" onClick={() => go(index - 1)} aria-label={t.previous}>←</button><button type="button" onClick={() => go(index + 1)} aria-label={t.next}>→</button></div>
      </div>
    </div>
  );
}

function Lightbox({ state, language, onClose }: { state: LightboxState; language: Language; onClose: () => void }) {
  const [index, setIndex] = useState(state.index);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerGesture = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const t = copy[language];
  const go = useCallback((delta: number) => setIndex((current) => (current + delta + state.slides.length) % state.slides.length), [state.slides.length]);
  useEffect(() => {
    const release = lockYangiBaxtBody();
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); release(); window.requestAnimationFrame(() => state.opener.isConnected && state.opener.focus({ preventScroll: true })); };
  }, [go, onClose, state.opener]);
  const onPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    pointerGesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLImageElement>) => {
    const gesture = pointerGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - gesture.x;
    const deltaY = event.clientY - gesture.y;
    if (Math.abs(deltaX) > 42 && Math.abs(deltaX) > Math.abs(deltaY)) go(deltaX < 0 ? 1 : -1);
  };
  const onPointerCancel = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (pointerGesture.current?.pointerId === event.pointerId) pointerGesture.current = null;
  };
  const slide = state.slides[index];
  return (
    <div className="yb-lightbox" role="dialog" aria-modal="true" aria-label={slide.caption[language]}>
      <button className="yb-lightbox__backdrop" type="button" tabIndex={-1} aria-label={t.closeImage} onClick={onClose} />
      <div className="yb-lightbox__panel" ref={panelRef}>
        <header><p><strong>{index + 1}</strong> {t.imageOf} {state.slides.length} · {mediaLabel(slide.type, language)}</p><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closeImage}>×</button></header>
        <img
          src={asset(slide.src)}
          alt={slide.caption[language]}
          draggable={false}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        <footer><p>{slide.caption[language]}</p><div><button type="button" onClick={() => go(-1)} aria-label={t.previous}>←</button><button type="button" onClick={() => go(1)} aria-label={t.next}>→</button></div></footer>
      </div>
    </div>
  );
}

function useLanguage(initialLanguage: Language) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('lang')) {
      let stored: string | null = null;
      try { stored = localStorage.getItem(storageKey); } catch { /* URL fallback remains usable. */ }
      const language = stored === 'uz' || stored === 'en' ? stored : initialLanguage;
      params.set('lang', language);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    }
    document.documentElement.lang = initialLanguage;
    try { localStorage.setItem(storageKey, initialLanguage); } catch { /* Scoped storage is optional. */ }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (language: Language) => {
    try { localStorage.setItem(storageKey, language); } catch { /* URL is authoritative. */ }
    const params = new URLSearchParams(window.location.search);
    params.set('lang', language);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  return [initialLanguage, setLanguage] as const;
}

export function YangiBaxtPage({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const { data: catalogProject, dataSource } = useLiveCatalogProject('yangibaxt', { slug: 'yangibaxt', name: 'Yangi Baxt', totalUnits: 0, availableUnits: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const mobile = useMobileNavigation();
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuNavigationTargetRef = useRef<string | undefined>(undefined);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [leadSurface, setLeadSurface] = useState<string | null>(null);
  const t = copy[language];
  const countFormat = new Intl.NumberFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US');
  const catalogStats = dataSource === 'embedded' ? t.catalogStats : [
    [countFormat.format(catalogProject.totalUnits), language === 'ru' ? 'квартир в каталоге' : language === 'uz' ? 'katalogdagi xonadonlar' : 'catalogue apartments'],
    [countFormat.format(catalogProject.availableUnits), language === 'ru' ? 'свободно' : language === 'uz' ? 'mavjud' : 'available'],
    ...t.catalogStats.slice(2),
  ] as const;
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const closeLead = useCallback(() => setLeadSurface(null), []);
  const openLightbox = useCallback((slides: Slide[], index: number, opener: HTMLButtonElement) => setLightbox({ slides, index, opener }), []);
  const mobileMenuOpen = mobile && menuOpen;

  useEffect(() => {
    document.body.classList.add('yb-active');
    const frame = window.requestAnimationFrame(() => document.querySelector('.yangibaxt-site')?.classList.add('is-ready'));
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-revealed', 'true'); observer.unobserve(entry.target); }
    }), { threshold: 0.13 });
    document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
    return () => { window.cancelAnimationFrame(frame); observer.disconnect(); document.body.classList.remove('yb-active'); };
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const menuToggle = menuToggleRef.current;
    const release = lockYangiBaxtBody();
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!menuRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      release();
      const navigationTarget = menuNavigationTargetRef.current;
      menuNavigationTargetRef.current = undefined;
      window.requestAnimationFrame(() => {
        if (navigationTarget) {
          const target = document.getElementById(navigationTarget);
          if (target) {
            const hadTabIndex = target.hasAttribute('tabindex');
            if (!hadTabIndex) target.setAttribute('tabindex', '-1');
            target.focus({ preventScroll: true });
            if (!hadTabIndex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
            return;
          }
        }
        menuToggle?.focus({ preventScroll: true });
      });
    };
  }, [mobileMenuOpen]);

  useEffect(() => leadSurface ? lockYangiBaxtBody() : undefined, [leadSurface]);

  const selectNavigationTarget = (id: string) => {
    if (mobileMenuOpen) {
      menuNavigationTargetRef.current = id;
      setMenuOpen(false);
      return;
    }
    setMenuOpen(false);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(id);
      if (!target) {
        menuToggleRef.current?.focus({ preventScroll: true });
        return;
      }
      const hadTabIndex = target.hasAttribute('tabindex');
      if (!hadTabIndex) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
      if (!hadTabIndex) target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    });
  };

  const landingContext = `projectSlug=yangibaxt;lang=${language};surface=landing:${leadSurface ?? 'general'};unit=general`;
  return (
    <div className="yangibaxt-site" lang={language}>
      <a className="yb-skip" href="#main" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>{t.skip}</a>
      <header className="yb-header">
        <a className="yb-wordmark" href="#top" aria-label="Yangi Baxt" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>YANGI BAXT<small>NRG-BI</small></a>
        <button ref={menuToggleRef} className="yb-menu-toggle" type="button" aria-expanded={menuOpen} aria-haspopup="dialog" aria-controls="yb-navigation" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? t.closeMenu : t.menu}</button>
        <nav ref={menuRef} id="yb-navigation" className={menuOpen ? 'is-open' : ''} role={mobileMenuOpen ? 'dialog' : undefined} aria-modal={mobileMenuOpen ? true : undefined} aria-label={t.navLabel} aria-hidden={mobile && !menuOpen ? true : undefined} inert={mobile && !menuOpen ? true : undefined}>{t.nav.map(([id, label]) => <a href={`#${id}`} key={id} onClick={() => selectNavigationTarget(id)}>{label}</a>)}</nav>
        <div className="yb-header__actions" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>
          <div className="yb-languages" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} aria-current={item === language ? 'true' : undefined} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
          <a className="yb-header__catalog" href={withLanguage('/yangibaxt/apartments', language)}>{t.catalog}</a>
          <button className="yb-header__lead" type="button" data-lead-trigger onClick={() => setLeadSurface('header')}>{t.consult}</button>
        </div>
      </header>

      <main id="main" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>
        <section className="yb-hero" id="top" aria-labelledby="yb-title">
          <div className="yb-hero__topline"><span>{t.heroOverline}</span><span>01 / 08</span></div>
          <h1 id="yb-title">{t.heroTitle}</h1>
          <div className="yb-hero__landscape">
            <img src={asset('/yangibaxt/images/hero-real.webp')} alt={t.heroImage} fetchPriority="high" />
            <span className="yb-media-label">{t.media.real}</span>
            <div className="yb-hero__loop" aria-hidden="true"><i /><b /></div>
            <button type="button" data-lead-trigger onClick={() => setLeadSurface('hero')}>{t.consult}<span>↗</span></button>
          </div>
          <div className="yb-hero__bottom">
            <p>{t.heroLead}</p>
            <dl>{t.facts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
            <figure><img src={asset('/yangibaxt/images/towers-concept-01.webp')} alt={t.heroCgi} /><figcaption>{t.heroCgi}</figcaption></figure>
          </div>
        </section>

        <section className="yb-section yb-contour" id="contour" data-reveal>
          <header className="yb-section__header"><span>{t.contourIndex}</span><h2>{t.contourTitle}</h2><p>{t.contourText}</p></header>
          <div className="yb-contour__visual">
            <figure><img src={asset('/yangibaxt/images/district-concept.webp')} alt={t.contourCgi} loading="lazy" /><figcaption>{t.contourCgi}</figcaption></figure>
            <div className="yb-contour__route" aria-hidden="true"><i /><i /><i /><i /></div>
            <div className="yb-contour__cards">{t.contourCards.map(([title, note], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{note}</p></article>)}</div>
          </div>
        </section>

        <section className="yb-section yb-living" id="living" data-reveal>
          <header className="yb-section__header"><span>{t.livingIndex}</span><h2>{t.livingTitle}</h2><p>{t.livingText}</p></header>
          <div className="yb-living__grid">
            <figure className="is-main"><img src={asset('/yangibaxt/images/phase-two-facade.webp')} alt={t.livingPhoto} loading="lazy" /><figcaption><span>{t.media.real}</span><strong>{t.livingDate}</strong></figcaption></figure>
            <figure><img src={asset('/yangibaxt/images/realized-courtyard-01.webp')} alt={t.livingCourtyard} loading="lazy" /><figcaption>{t.media.real}</figcaption></figure>
            <figure><img src={asset('/yangibaxt/images/realized-courtyard-02.webp')} alt={t.livingCourtyard} loading="lazy" /><figcaption>{t.media.real}</figcaption></figure>
          </div>
        </section>

        <section className="yb-section yb-towers" id="towers" data-reveal>
          <header className="yb-section__header"><span>{t.towersIndex}</span><h2>{t.towersTitle}</h2><p>{t.towersText}</p></header>
          <div className="yb-towers__layout"><Gallery slides={towersSlides} language={language} onOpen={openLightbox} /><aside><span>COMMERCIAL</span><h3>{t.commerceTitle}</h3><strong>≤ 5 m</strong><p>{t.commerceText}</p></aside></div>
        </section>

        <section className="yb-section yb-real-gallery" id="gallery" data-reveal>
          <header className="yb-section__header"><span>{t.galleryIndex}</span><h2>{t.galleryTitle}</h2><p>{t.galleryText}</p></header>
          <Gallery slides={gallerySlides} language={language} onOpen={openLightbox} />
        </section>

        <section className="yb-section yb-materials" id="materials" data-reveal>
          <header className="yb-section__header"><span>{t.materialsIndex}</span><h2>{t.materialsTitle}</h2><p>{t.materialsText}</p></header>
          <div className="yb-materials__layout"><figure><img src={asset('/yangibaxt/images/architecture-concept.webp')} alt={t.materialsCgi} loading="lazy" /><figcaption>{t.materialsCgi}</figcaption></figure><ol>{t.materials.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol></div>
          <p className="yb-disclaimer">{t.disclaimer}</p>
        </section>

        <section className="yb-section yb-progress" id="progress" data-reveal>
          <header className="yb-section__header"><span>{t.progressIndex}</span><h2>{t.progressTitle}</h2><p>{t.progressText}</p></header>
          <Gallery slides={constructionSlides} language={language} onOpen={openLightbox} />
        </section>

        <section className="yb-section yb-catalog-preview" id="catalog" data-reveal>
          <header className="yb-section__header"><span>{t.catalogIndex}</span><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header>
          <div className="yb-catalog-preview__panel">
            <dl>{catalogStats.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
            <ul>{t.catalogGroups.map((group) => <li key={group}>{group}</li>)}</ul>
            <div><p>{t.catalogNote}</p><a href={withLanguage('/yangibaxt/apartments', language)}>{t.openCatalog}<span>↗</span></a><button type="button" data-lead-trigger onClick={() => setLeadSurface('catalog-preview')}>{t.consult}</button></div>
          </div>
        </section>

        <section className="yb-contact" id="contacts" data-reveal>
          <span>{t.contactIndex}</span><h2>{t.contactTitle}</h2><p>{t.contactText}</p>
          <div><button type="button" data-lead-trigger onClick={() => setLeadSurface('final')}>{t.consult}<span>↗</span></button><a href="tel:+998781137712">{t.call}</a></div>
          <address>{t.address}</address>
        </section>
      </main>

      <footer className="yb-footer" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>
        <div><strong>YANGI BAXT</strong><span>{t.heroLead}</span></div>
        <nav aria-label={t.sources}>
          <a href={`${appBasePath}/privacy?project=yangibaxt&lang=${language}&from=landing`}>{t.privacy} ↗</a>
        </nav>
        <p>{t.disclaimer}</p><a href="#top">{t.top} ↑</a>
      </footer>

      {lightbox ? <Lightbox state={lightbox} language={language} onClose={closeLightbox} /> : null}
      <LeadModal open={Boolean(leadSurface)} language={language} context={landingContext} brandName="NRG-BI" projectName="YANGI BAXT" tagline={t.formTagline} facts={t.formFacts} submitUrl={yangiBaxtLeadSubmitUrl()} projectSlug="yangibaxt" privacyUrl={`${appBasePath}/privacy?project=yangibaxt&lang=${language}&from=landing`} requireConsent onClose={closeLead} />
    </div>
  );
}
