'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Slide = { src: string; alt: string; label: string; kind?: 'photo' | 'concept' | 'report' };
type LightboxState = { slides: Slide[]; index: number } | null;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const panorama = 'https://uzbekistan360.uz/ru/location/nrg-voha0Kw';
const camera = 'https://rtsp.me/embed/3Ny3iFi8/';
const mapLink = 'https://2gis.uz/tashkent/search/NRG%20Voha';

const copy = {
  ru: {
    nav: { project: 'О проекте', architecture: 'Архитектура', water: 'У воды', halls: 'Холлы', location: 'Локация' },
    menu: 'Меню', close: 'Закрыть', choose: 'Выбрать квартиру', consult: 'Получить консультацию', skip: 'К содержанию', language: 'Язык',
    heroTop: 'Премиальный жилой комплекс NRG-BI · Ташкент', heroTitle: 'Тишина', heroAccent: 'у воды.', heroText: 'Живите по соседству с природой — в приватном дворе, где канал, зрелая зелень и архитектура существуют в одном спокойном ритме.', heroLive: 'Live · реальная фотография проекта',
    manifestTop: 'Private Waterside Club', manifestTitle: 'Приватность начинается с пространства вокруг дома.', manifestText: 'Низкая плотность застройки, вода и обильное озеленение создают здесь не декорацию, а уже сформированную среду для ежедневной жизни.',
    facts: [['Премиум', 'класс жилья'], ['Сдана', 'I очередь'], ['3,3 м', 'высота потолков'], ['> 45%', 'территории — зелень']],
    architectureTop: '01 · Натуральные материалы', architectureTitle: 'Камень, металл и мягкий свет.', architectureText: 'Архитектурный образ сочетает натуральный камень и современные алюминиевые панели. Точная геометрия фасадов остаётся спокойным фоном для воды и зелени.',
    landscapeTop: '02 · Зрелый ландшафт', landscapeTitle: 'Более 45% территории отдано озеленению.', landscapeText: 'Многоуровневая посадка объединяет клёны, сосны, ивы, цветущие кустарники, многолетники и декоративные травы. Водоёмы поддерживают микроклимат и городскую фауну.', landscapeList: ['Клён, сосна, ива и катальпа', 'Можжевельник, туя и самшит', 'Лаванда, шалфей и гортензии', 'Декоративные травы и многолетники'],
    waterTop: '03 · Жизнь у воды', waterTitle: 'Канал задаёт ритм всему двору.', waterText: 'Водопады в начале и конце двора создают звук текущей воды. У пирса с японскими карпами устроена мягкая зона, а часть лотов первых этажей имеет выход к прогулочной линии вдоль канала.',
    courtyardTop: '04 · Тихий двор', courtyardTitle: 'Природный сценарий вместо набора объектов.', courtyardText: 'Импортные и местные растения, природные материалы и вода формируют устойчивый микроклимат. Здесь легко оставаться наедине с собой — и так же естественно встречаться с соседями.',
    clubTop: '05 · Клубная среда', clubTitle: 'Пространства для жителей.', clubText: 'В материалах проекта заявлены Gentlemen’s club, фитнес-залы, детская комната и финская парная. Буклет также показывает кинотеатр. Актуальную доступность конкретной зоны подтверждает отдел продаж.', clubItems: ['Gentlemen’s club', 'Фитнес-залы', 'Детская комната', 'Финская парная', 'Кинотеатр'],
    hallsTop: '06 · Дизайнерские холлы', hallsTitle: 'Две очереди — два честных статуса.', hallsText: 'Для I очереди показываем фактическую фотосъёмку готовых пространств. Для II очереди — официальную визуальную концепцию, без выдачи её за готовый интерьер.', phase1: 'I очередь · реальные фото', phase2: 'II очередь · официальная концепция', phase1Status: 'I очередь сдана', phase2Status: 'II очередь · ближайшая сдача указана как III кв. 2027',
    serviceTop: '07 · Управление', serviceTitle: 'Сервис как спокойная ежедневная работа.', serviceText: 'Управляющая компания отвечает за чистоту, безопасность, инженерные системы и уход за ландшафтом.', serviceRate: 'На 30.08.2026 были опубликованы предварительные платежи: квартира — 18 500 сум/м², офис — 19 772 сум/м², паркинг — 361 714 сум за место. Тарифы не являются офертой и требуют актуального подтверждения.',
    locationTop: '08 · Локация', locationTitle: 'Ташкент, улица Кайнарсой, 136А.', locationText: 'В опубликованных материалах также встречается адрес «ул. Карасу Буйи, 21» — перед визитом уточните нужную точку у отдела продаж.', map: 'Открыть Voha в 2GIS', offices: 'Отделы продаж',
    mediaTop: '09 · Смотреть проект', mediaTitle: 'Панорама, камера и буклет.', panorama: 'Открыть панораму 360', panoramaNote: 'Внешний сервис Uzbekistan360', camera: 'Открыть онлайн-камеру', cameraNote: 'Внешний поток RTSP.me; доступность зависит от сервиса', booklet: 'Скачать официальный буклет', bookletNote: 'PDF · 88 страниц · 24,8 МБ',
    buildTop: '10 · Ход строительства', buildTitle: 'Фотоотчёт за июль 2026.', buildText: 'Архивные фотографии официального отчёта. Это не live-изображения и не заменяет онлайн-камеру.',
    catalogTop: '11 · Официальный snapshot', catalogTitle: '104 опубликованных предложения.', catalogText: 'Полный датированный срез официального каталога на 30 августа 2026 года: реальные планировки, очереди, площади, этажи и цены на дату проверки.', catalogNote: 'Цены, акции и статусы могут измениться у официального продавца.',
    contactTop: '12 · Персональная консультация', contactTitle: 'Найдите своё место у воды.', contactText: 'Оставьте контакты — менеджер проекта подтвердит актуальные условия и детали выбранного предложения.', phone: 'Телефон', privacy: 'Конфиденциальность',
    formTitle: 'Получить консультацию', formName: 'Ваше имя', formPhone: 'Номер телефона', formSubmit: 'Отправить запрос', formNameError: 'Введите имя — не менее 2 символов.', formPhoneError: 'Введите 9 цифр номера после +998.', formSuccess: 'Спасибо. Запрос сохранён в интерфейсе — тестовая отправка лида не выполнялась.', formContext: 'Контекст запроса',
    photo: 'Реальная фотография', concept: 'Официальная концепция', report: 'Архивный фотоотчёт · июль 2026', previous: 'Предыдущее фото', next: 'Следующее фото',
  },
  uz: {
    nav: { project: 'Loyiha', architecture: 'Arxitektura', water: 'Suv bo‘yida', halls: 'Xollar', location: 'Joylashuv' }, menu: 'Menyu', close: 'Yopish', choose: 'Xonadon tanlash', consult: 'Maslahat olish', skip: 'Mazmunga o‘tish', language: 'Til',
    heroTop: 'NRG-BI premium turar joy majmuasi · Toshkent', heroTitle: 'Suv bo‘yidagi', heroAccent: 'sukunat.', heroText: 'Tabiatga qo‘shni yashang — kanal, yetuk ko‘kalamzor va arxitektura bir sokin ritmda yashaydigan xususiy hovlida.', heroLive: 'Live · loyihaning haqiqiy surati',
    manifestTop: 'Private Waterside Club', manifestTitle: 'Xususiylik uy atrofidagi makondan boshlanadi.', manifestText: 'Past qurilish zichligi, suv va boy ko‘kalamzor kundalik hayot uchun shakllangan muhit yaratadi.', facts: [['Premium', 'uy klassi'], ['Topshirilgan', 'I navbat'], ['3,3 m', 'shift balandligi'], ['> 45%', 'hudud — ko‘kalamzor']],
    architectureTop: '01 · Tabiiy materiallar', architectureTitle: 'Tosh, metall va yumshoq yorug‘lik.', architectureText: 'Me’moriy qiyofa tabiiy tosh va zamonaviy alyuminiy panellarni birlashtiradi. Fasadlar suv va ko‘kalamzor uchun sokin fon bo‘ladi.',
    landscapeTop: '02 · Yetuk landshaft', landscapeTitle: 'Hududning 45% dan ortig‘i ko‘kalamzor.', landscapeText: 'Ko‘p qatlamli landshaft zarang, qarag‘ay, tol, gullaydigan butalar va manzarali o‘tlarni birlashtiradi. Suv havzalari mikroiqlimni qo‘llab-quvvatlaydi.', landscapeList: ['Zarang, qarag‘ay, tol va katalpa', 'Archa, tuya va shamshod', 'Lavanda, shalfey va gortenziya', 'Manzarali o‘tlar va ko‘p yilliklar'],
    waterTop: '03 · Suv bo‘yidagi hayot', waterTitle: 'Kanal butun hovli ritmini belgilaydi.', waterText: 'Hovlining boshida va oxiridagi sharsharalar oqar suv ovozini yaratadi. Yapon karplari bor pirsgacha yumshoq dam olish zonasi, ayrim birinchi qavat lotlarida esa kanal bo‘ylab sayr yo‘liga chiqish bor.',
    courtyardTop: '04 · Sokin hovli', courtyardTitle: 'Obyektlar to‘plami emas, tabiiy ssenariy.', courtyardText: 'Mahalliy va import o‘simliklar, tabiiy materiallar va suv barqaror mikroiqlim yaratadi.',
    clubTop: '05 · Klub muhiti', clubTitle: 'Rezidentlar uchun makonlar.', clubText: 'Loyiha materiallarida Gentlemen’s club, fitnes zallari, bolalar xonasi va fin bug‘xonasi ko‘rsatilgan. Bukletda kinoteatr ham bor. Amaldagi mavjudlikni sotuv bo‘limidan tasdiqlang.', clubItems: ['Gentlemen’s club', 'Fitnes zallari', 'Bolalar xonasi', 'Fin bug‘xonasi', 'Kinoteatr'],
    hallsTop: '06 · Dizaynerlik xollari', hallsTitle: 'Ikki navbat — ikki aniq holat.', hallsText: 'I navbat uchun haqiqiy tayyor makonlar, II navbat uchun esa tayyor interyer deb ko‘rsatilmagan rasmiy konsepsiya.', phase1: 'I navbat · haqiqiy suratlar', phase2: 'II navbat · rasmiy konsepsiya', phase1Status: 'I navbat topshirilgan', phase2Status: 'II navbat · eng yaqin topshirish 2027-yil III chorak deb ko‘rsatilgan',
    serviceTop: '07 · Boshqaruv', serviceTitle: 'Servis — kundalik sokin mehnat.', serviceText: 'Boshqaruv kompaniyasi tozalik, xavfsizlik, muhandislik tizimlari va landshaft parvarishiga javob beradi.', serviceRate: '30.08.2026 kuni e’lon qilingan dastlabki to‘lovlar: xonadon — 18 500 so‘m/m², ofis — 19 772 so‘m/m², parking — 361 714 so‘m/joy. Tariflarni qayta tasdiqlash kerak.',
    locationTop: '08 · Joylashuv', locationTitle: 'Toshkent, Qaynorsoy ko‘chasi, 136A.', locationText: 'E’lon qilingan materiallarda “Qorasuv bo‘yi ko‘chasi, 21” manzili ham uchraydi — tashrifdan oldin nuqtani aniqlang.', map: 'Voha’ni 2GIS’da ochish', offices: 'Sotuv bo‘limlari',
    mediaTop: '09 · Loyihani ko‘ring', mediaTitle: 'Panorama, kamera va buklet.', panorama: '360 panoramani ochish', panoramaNote: 'Uzbekistan360 tashqi servisi', camera: 'Onlayn kamerani ochish', cameraNote: 'RTSP.me tashqi oqimi; mavjudlik servisga bog‘liq', booklet: 'Rasmiy bukletni yuklab olish', bookletNote: 'PDF · 88 sahifa · 24,8 MB',
    buildTop: '10 · Qurilish jarayoni', buildTitle: '2026-yil iyul foto hisoboti.', buildText: 'Rasmiy hisobotning arxiv suratlari. Bu live tasvir emas.',
    catalogTop: '11 · Rasmiy snapshot', catalogTitle: '104 ta e’lon qilingan taklif.', catalogText: '2026-yil 30-avgustdagi to‘liq rasmiy katalog kesimi: haqiqiy rejalar, navbatlar, maydonlar, qavatlar va narxlar.', catalogNote: 'Narxlar, aksiyalar va holatlar rasmiy sotuvchida o‘zgarishi mumkin.',
    contactTop: '12 · Shaxsiy maslahat', contactTitle: 'Suv bo‘yidagi o‘z joyingizni toping.', contactText: 'Kontakt qoldiring — loyiha menejeri amaldagi shartlar va tanlangan taklif tafsilotlarini tasdiqlaydi.', phone: 'Telefon', privacy: 'Maxfiylik',
    formTitle: 'Maslahat olish', formName: 'Ismingiz', formPhone: 'Telefon raqami', formSubmit: 'So‘rov yuborish', formNameError: 'Ismni kiriting — kamida 2 ta belgi.', formPhoneError: '+998 dan keyin 9 ta raqam kiriting.', formSuccess: 'Rahmat. So‘rov interfeysda saqlandi — test lead yuborilmadi.', formContext: 'So‘rov konteksti', photo: 'Haqiqiy surat', concept: 'Rasmiy konsepsiya', report: 'Arxiv foto hisoboti · 2026-yil iyul', previous: 'Oldingi surat', next: 'Keyingi surat',
  },
  en: {
    nav: { project: 'Project', architecture: 'Architecture', water: 'Waterside', halls: 'Lobbies', location: 'Location' }, menu: 'Menu', close: 'Close', choose: 'Choose an apartment', consult: 'Request a consultation', skip: 'Skip to content', language: 'Language',
    heroTop: 'Premium residences by NRG-BI · Tashkent', heroTitle: 'Quiet', heroAccent: 'by the water.', heroText: 'Live next to nature in a private courtyard where the canal, mature planting and architecture share one calm rhythm.', heroLive: 'Live · actual project photography',
    manifestTop: 'Private Waterside Club', manifestTitle: 'Privacy begins with the space around your home.', manifestText: 'Low development density, water and abundant planting form an established everyday setting rather than scenery.', facts: [['Premium', 'residential class'], ['Completed', 'Phase I'], ['3.3 m', 'ceiling height'], ['> 45%', 'of the grounds planted']],
    architectureTop: '01 · Natural materials', architectureTitle: 'Stone, metal and soft light.', architectureText: 'Natural stone meets contemporary aluminium panels. Calm façade geometry becomes a backdrop to water and greenery.',
    landscapeTop: '02 · Mature landscape', landscapeTitle: 'More than 45% of the grounds are landscaped.', landscapeText: 'Layered planting brings together maples, pines, willows, flowering shrubs, perennials and ornamental grasses. Water supports the microclimate and urban wildlife.', landscapeList: ['Maple, pine, willow and catalpa', 'Juniper, thuja and boxwood', 'Lavender, sage and hydrangea', 'Ornamental grasses and perennials'],
    waterTop: '03 · Waterside living', waterTitle: 'The canal sets the pace of the courtyard.', waterText: 'Waterfalls at either end bring the sound of running water. A soft seating zone sits by the pier with Japanese carp, while selected ground-floor lots open onto the canal walk.',
    courtyardTop: '04 · Quiet courtyard', courtyardTitle: 'A natural sequence, not a collection of objects.', courtyardText: 'Local and imported planting, natural materials and water support a resilient microclimate.',
    clubTop: '05 · Club environment', clubTitle: 'Spaces for residents.', clubText: 'The project materials list a Gentlemen’s club, gyms, a children’s room and a Finnish steam room. The brochure also shows a cinema. Confirm current access with the sales team.', clubItems: ['Gentlemen’s club', 'Gyms', 'Children’s room', 'Finnish steam room', 'Cinema'],
    hallsTop: '06 · Designer lobbies', hallsTitle: 'Two phases, two honest states.', hallsText: 'Phase I is shown through actual completed-space photography. Phase II is presented as an official visual concept, never as a completed interior.', phase1: 'Phase I · actual photography', phase2: 'Phase II · official concept', phase1Status: 'Phase I is completed', phase2Status: 'Phase II · nearest completion is listed as Q3 2027',
    serviceTop: '07 · Management', serviceTitle: 'Service as calm, daily work.', serviceText: 'The management company covers cleanliness, safety, engineering systems and landscape care.', serviceRate: 'Preliminary payments published on 30 Aug 2026: apartment — UZS 18,500/m², office — UZS 19,772/m², parking — UZS 361,714/space. Reconfirm current tariffs.',
    locationTop: '08 · Location', locationTitle: '136A Qaynorsoy Street, Tashkent.', locationText: 'Published materials also show “21 Karasu Buyi Street”; confirm the correct point before visiting.', map: 'Open Voha in 2GIS', offices: 'Sales offices',
    mediaTop: '09 · Explore the project', mediaTitle: 'Panorama, camera and brochure.', panorama: 'Open 360 panorama', panoramaNote: 'External Uzbekistan360 service', camera: 'Open live camera', cameraNote: 'External RTSP.me stream; availability depends on the service', booklet: 'Download official brochure', bookletNote: 'PDF · 88 pages · 24.8 MB',
    buildTop: '10 · Construction', buildTitle: 'July 2026 photo report.', buildText: 'Archived photographs from the official report. These are not live images.',
    catalogTop: '11 · Official snapshot', catalogTitle: '104 published listings.', catalogText: 'The complete official catalogue snapshot from 30 August 2026: real plans, phases, areas, floors and prices at capture.', catalogNote: 'Prices, promotions and statuses may change with the official seller.',
    contactTop: '12 · Personal consultation', contactTitle: 'Find your place by the water.', contactText: 'Leave your details and the project manager will confirm current terms and the selected listing.', phone: 'Phone', privacy: 'Privacy',
    formTitle: 'Request a consultation', formName: 'Your name', formPhone: 'Phone number', formSubmit: 'Send request', formNameError: 'Enter at least 2 characters.', formPhoneError: 'Enter 9 digits after +998.', formSuccess: 'Thank you. The request was saved in the interface; no test lead was sent.', formContext: 'Request context', photo: 'Actual photography', concept: 'Official concept', report: 'Archived report · July 2026', previous: 'Previous photograph', next: 'Next photograph',
  },
} as const;

const architecture: Slide[] = [
  { src: '/voha/images/architecture-01.webp', alt: 'Архитектура Voha и натуральный камень', label: 'Архитектура · фактическая фотография' },
  { src: '/voha/images/architecture-02.webp', alt: 'Фасад Voha и озеленение', label: 'Фасад · фактическая фотография' },
  { src: '/voha/images/architecture-03.webp', alt: 'Архитектура двора Voha', label: 'Двор · фактическая фотография' },
];
const waterSlides: Slide[] = [
  { src: '/voha/images/water-01.webp', alt: 'Канал во дворе Voha', label: 'Канал во дворе' },
  { src: '/voha/images/water-02.webp', alt: 'Пирс у воды в Voha', label: 'Пирс у воды' },
  { src: '/voha/images/water-03.webp', alt: 'Прогулочная зона вдоль канала', label: 'Прогулочная зона' },
  { src: '/voha/images/water-04.webp', alt: 'Вода и озеленение Voha', label: 'Вода и зрелая зелень' },
];
const hallPhase1: Slide[] = [
  { src: '/voha/images/hall-phase-1-01.webp', alt: 'Холл первой очереди Voha', label: 'I очередь · реальная фотография' },
  { src: '/voha/images/hall-phase-1-02.webp', alt: 'Дизайнерский холл первой очереди', label: 'I очередь · реальная фотография' },
  { src: '/voha/images/hall-phase-1-03.webp', alt: 'Интерьер холла первой очереди', label: 'I очередь · реальная фотография' },
];
const hallPhase2: Slide[] = [
  { src: '/voha/images/hall-phase-2-01.webp', alt: 'Официальная концепция холла второй очереди', label: 'II очередь · официальная концепция', kind: 'concept' },
  { src: '/voha/images/hall-phase-2-02.webp', alt: 'Концепция холла второй очереди Voha', label: 'II очередь · официальная концепция', kind: 'concept' },
  { src: '/voha/images/hall-phase-2-03.webp', alt: 'Официальная визуализация холла второй очереди', label: 'II очередь · официальная концепция', kind: 'concept' },
];
const buildSlides: Slide[] = [
  { src: '/voha/images/construction-01.webp', alt: 'Строительство Voha в июле 2026 года', label: 'Июль 2026', kind: 'report' },
  { src: '/voha/images/construction-02.webp', alt: 'Фотоотчёт Voha за июль 2026 года', label: 'Июль 2026', kind: 'report' },
  { src: '/voha/images/construction-03.webp', alt: 'Ход строительства Voha, июль 2026', label: 'Июль 2026', kind: 'report' },
];

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function leadSubmitUrl() { return `${appBasePath}/v1/leads`; }

function useLanguage(initialLanguage: Language = 'ru') {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = window.localStorage.getItem('voha-language');
    const next = languages.includes(query as Language) ? query : saved;
    const frame = window.requestAnimationFrame(() => { if (languages.includes(next as Language)) setLanguageState(next as Language); });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => {
    setLanguageState(next); window.localStorage.setItem('voha-language', next);
    const url = new URL(window.location.href); url.searchParams.set('lang', next); window.history.replaceState({}, '', url);
  };
  return [language, setLanguage] as const;
}

function useLoader() {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = window.sessionStorage.getItem('voha-loader-seen') === '1';
    if (reduced || seen) { const frame = window.requestAnimationFrame(() => setLoading(false)); return () => window.cancelAnimationFrame(frame); }
    document.body.classList.add('is-voha-loading');
    const timer = window.setTimeout(() => { setLoading(false); window.sessionStorage.setItem('voha-loader-seen', '1'); document.body.classList.remove('is-voha-loading'); }, 1150);
    return () => { window.clearTimeout(timer); document.body.classList.remove('is-voha-loading'); };
  }, []);
  return loading;
}

function useReveal(language: Language) {
  useEffect(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-voha-reveal]')];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { nodes.forEach((node) => node.classList.add('is-visible')); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: .12 });
    nodes.forEach((node) => observer.observe(node)); return () => observer.disconnect();
  }, [language]);
}

function PhotoButton({ slide, index, slides, onOpen, className = '' }: { slide: Slide; index: number; slides: Slide[]; onOpen: (state: LightboxState) => void; className?: string }) {
  return <button className={`voha-photo ${className}`} type="button" onClick={() => onOpen({ slides, index })} aria-label={slide.alt}><img src={asset(slide.src)} alt={slide.alt} loading="lazy" decoding="async" /><span>{slide.label}</span><i aria-hidden="true">↗</i></button>;
}

function Lightbox({ state, language, onClose }: { state: NonNullable<LightboxState>; language: Language; onClose: () => void }) {
  const [index, setIndex] = useState(state.index); const closeRef = useRef<HTMLButtonElement>(null); const touch = useRef(0); const t = copy[language];
  const move = (direction: number) => setIndex((value) => (value + direction + state.slides.length) % state.slides.length);
  useEffect(() => {
    closeRef.current?.focus(); document.body.classList.add('is-voha-overlay');
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1); };
    window.addEventListener('keydown', onKey); return () => { document.body.classList.remove('is-voha-overlay'); window.removeEventListener('keydown', onKey); };
  });
  const current = state.slides[index];
  return <div className="voha-lightbox" role="dialog" aria-modal="true" aria-label={current.alt} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onTouchStart={(event) => { touch.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }}>
    <button ref={closeRef} className="voha-lightbox__close" type="button" onClick={onClose} aria-label={t.close}>×</button>
    <button className="voha-lightbox__prev" type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button>
    <figure><img src={asset(current.src)} alt={current.alt} /><figcaption><strong>{current.kind === 'concept' ? t.concept : current.kind === 'report' ? t.report : t.photo}</strong><span>{String(index + 1).padStart(2, '0')} / {String(state.slides.length).padStart(2, '0')}</span></figcaption></figure>
    <button className="voha-lightbox__next" type="button" onClick={() => move(1)} aria-label={t.next}>→</button>
  </div>;
}

function Consultation({ open, language, context, onClose }: { open: boolean; language: Language; context: string; onClose: () => void }) {
  const t = copy[language];
  return <LeadModal open={open} language={language} context={`projectSlug=voha;lang=${language};surface=landing:${context};unit=general`} brandName="NRG-BI" projectName="VOHA" tagline={t.heroText} facts={t.facts.slice(0, 3).map(([value, label]) => `${value} · ${label}`)} submitUrl={leadSubmitUrl()} projectSlug="voha" privacyUrl={`${appBasePath}/privacy?project=voha&lang=${language}&from=landing`} requireConsent onClose={onClose} />;
}

export function VohaPage({ initialLanguage = 'ru' }: { initialLanguage?: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage); const loading = useLoader(); const t = copy[language]; useReveal(language);
  const [menuOpen, setMenuOpen] = useState(false); const [lightbox, setLightbox] = useState<LightboxState>(null); const [consult, setConsult] = useState(''); const [hallPhase, setHallPhase] = useState<1 | 2>(1);
  useEffect(() => { document.body.classList.toggle('is-voha-menu', menuOpen); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', key); return () => { document.body.classList.remove('is-voha-menu'); window.removeEventListener('keydown', key); }; }, [menuOpen]);
  const hallSlides = hallPhase === 1 ? hallPhase1 : hallPhase2;
  const openConsult = (context: string) => { setMenuOpen(false); setConsult(context); };
  const closeMenu = () => setMenuOpen(false);
  return <main className="voha-site" lang={language}>
    <a className="voha-skip" href="#voha-content">{t.skip}</a>
    <div className={`voha-loader ${loading ? '' : 'is-hidden'}`} aria-hidden={!loading}><span>VOHA</span><i /></div>
    <header className="voha-header"><a className="voha-wordmark" href={withLanguage('/voha', language)} aria-label="Voha">VOHA<small>by NRG-BI</small></a><nav>{Object.entries(t.nav).map(([key, value]) => <a key={key} href={`#${key}`}>{value}</a>)}</nav><a className="voha-header__phone" href="tel:1360">1360</a><button className="voha-menu-button" type="button" onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>{t.menu}<i /></button></header>
    <div className={`voha-menu ${menuOpen ? 'is-open' : ''}`} aria-hidden={!menuOpen} inert={!menuOpen ? true : undefined}><button type="button" className="voha-menu__close" onClick={closeMenu}>{t.close} ×</button><div><small>VOHA · TASHKENT</small>{Object.entries(t.nav).map(([key, value], index) => <a key={key} href={`#${key}`} onClick={closeMenu}><span>0{index + 1}</span>{value}</a>)}</div><footer><div aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button type="button" onClick={() => openConsult('voha:menu')}>{t.consult} ↗</button></footer></div>
    <section className="voha-hero" id="voha-content"><picture><source media="(max-width: 600px)" srcSet={asset('/voha/images/hero-mobile.webp')} /><img src={asset('/voha/images/hero.webp')} alt="Voha — фактический вид канала, пирса и готового двора" fetchPriority="high" /></picture><div className="voha-hero__veil" /><div className="voha-hero__content"><p>{t.heroTop}</p><h1>{t.heroTitle}<em>{t.heroAccent}</em></h1><div><span>{t.heroText}</span><nav><a className="voha-button is-light" href={withLanguage('/voha/apartments', language)}>{t.choose}<b>↗</b></a><button className="voha-button is-ghost" type="button" onClick={() => openConsult('voha:hero')}>{t.consult}<b>↗</b></button></nav></div></div><div className="voha-hero__meta"><span>{t.heroLive}</span><a href="#project">Scroll ↓</a></div></section>
    <section className="voha-manifest" id="project" data-voha-reveal><div className="voha-section-index"><span>00</span><i /></div><div><p className="voha-overline">{t.manifestTop}</p><h2>{t.manifestTitle}</h2><p>{t.manifestText}</p></div><figure><img src={asset('/voha/images/hero-alt.webp')} alt="Voha — реальная фотография канала и архитектуры" loading="lazy" /><figcaption><span>LIVE</span>{t.photo}</figcaption></figure></section>
    <section className="voha-facts" aria-label="Voha facts">{t.facts.map(([value, label]) => <div key={label} data-voha-reveal><strong>{value}</strong><span>{label}</span></div>)}</section>
    <section className="voha-editorial voha-architecture" id="architecture" data-voha-reveal><div className="voha-copy"><p className="voha-overline">{t.architectureTop}</p><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p><span className="voha-live-tag">LIVE · {t.photo}</span></div><div className="voha-architecture__gallery">{architecture.map((slide, index) => <PhotoButton key={slide.src} slide={slide} index={index} slides={architecture} onOpen={setLightbox} className={index === 0 ? 'is-main' : ''} />)}</div></section>
    <section className="voha-landscape" data-voha-reveal><div className="voha-landscape__image"><img src={asset('/voha/images/landscape-01.webp')} alt="Фактическое многоуровневое озеленение Voha" loading="lazy" /><span>LIVE · {t.photo}</span></div><div className="voha-landscape__copy"><p className="voha-overline">{t.landscapeTop}</p><h2>{t.landscapeTitle}</h2><p>{t.landscapeText}</p><ol>{t.landscapeList.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol></div></section>
    <section className="voha-water" id="water"><header data-voha-reveal><p className="voha-overline">{t.waterTop}</p><h2>{t.waterTitle}</h2><p>{t.waterText}</p></header><div className="voha-water__line" aria-hidden="true"><span /></div><div className="voha-water__gallery">{waterSlides.map((slide, index) => <PhotoButton key={slide.src} slide={slide} index={index} slides={waterSlides} onOpen={setLightbox} className={index === 0 || index === 3 ? 'is-wide' : ''} />)}</div></section>
    <section className="voha-courtyard" data-voha-reveal><div><p className="voha-overline">{t.courtyardTop}</p><h2>{t.courtyardTitle}</h2><p>{t.courtyardText}</p></div><figure><img src={asset('/voha/images/courtyard-01.webp')} alt="Реальный тихий двор Voha" loading="lazy" /><figcaption>LIVE · {t.photo}</figcaption></figure><figure><img src={asset('/voha/images/courtyard-02.webp')} alt="Фактическая фотография двора Voha" loading="lazy" /><figcaption>LIVE · {t.photo}</figcaption></figure></section>
    <section className="voha-club" data-voha-reveal><header><p className="voha-overline">{t.clubTop}</p><h2>{t.clubTitle}</h2><p>{t.clubText}</p></header><ol>{t.clubItems.map((item, index) => <li key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></li>)}</ol></section>
    <section className="voha-halls" id="halls"><header data-voha-reveal><div><p className="voha-overline">{t.hallsTop}</p><h2>{t.hallsTitle}</h2></div><p>{t.hallsText}</p></header><div className="voha-hall-tabs" role="radiogroup" aria-label={t.hallsTop}><button type="button" role="radio" aria-checked={hallPhase === 1} className={hallPhase === 1 ? 'is-active' : ''} onClick={() => setHallPhase(1)}>{t.phase1}</button><button type="button" role="radio" aria-checked={hallPhase === 2} className={hallPhase === 2 ? 'is-active' : ''} onClick={() => setHallPhase(2)}>{t.phase2}</button></div><div className="voha-halls__status"><span>{hallPhase === 1 ? 'LIVE' : 'CONCEPT'}</span><p>{hallPhase === 1 ? t.phase1Status : t.phase2Status}</p></div><div className="voha-halls__gallery">{hallSlides.map((slide, index) => <PhotoButton key={slide.src} slide={slide} index={index} slides={hallSlides} onOpen={setLightbox} className={index === 0 ? 'is-main' : ''} />)}</div></section>
    <section className="voha-service" data-voha-reveal><div><p className="voha-overline">{t.serviceTop}</p><h2>{t.serviceTitle}</h2><p>{t.serviceText}</p><small>{t.serviceRate}</small></div><img src={asset('/voha/images/service-01.webp')} alt="Управляющая компания Voha" loading="lazy" /></section>
    <section className="voha-location" id="location" data-voha-reveal><div className="voha-location__copy"><p className="voha-overline">{t.locationTop}</p><h2>{t.locationTitle}</h2><p>{t.locationText}</p><a className="voha-button is-solid" href={mapLink} target="_blank" rel="noreferrer">{t.map}<span>↗</span></a></div><div className="voha-location__map"><span>VOHA</span><i /><small>Ташкент<br />Мирзо-Улугбекский район</small><a href={mapLink} target="_blank" rel="noreferrer">2GIS ↗</a></div><aside><small>{t.offices}</small><strong>ул. Нукус, 91/1</strong><strong>ул. Айбека, 38Б</strong><a href="tel:1360">1360</a></aside></section>
    <section className="voha-media" data-voha-reveal><header><p className="voha-overline">{t.mediaTop}</p><h2>{t.mediaTitle}</h2></header><div><a href={panorama} target="_blank" rel="noreferrer"><span>360°</span><strong>{t.panorama}</strong><small>{t.panoramaNote}</small><b>↗</b></a><a href={camera} target="_blank" rel="noreferrer"><span>LIVE</span><strong>{t.camera}</strong><small>{t.cameraNote}</small><b>↗</b></a><a href={asset('/voha/voha-official-booklet.pdf')} download><span>PDF</span><strong>{t.booklet}</strong><small>{t.bookletNote}</small><b>↓</b></a></div></section>
    <section className="voha-build" data-voha-reveal><header><div><p className="voha-overline">{t.buildTop}</p><h2>{t.buildTitle}</h2></div><p>{t.buildText}</p></header><div>{buildSlides.map((slide, index) => <PhotoButton key={slide.src} slide={slide} index={index} slides={buildSlides} onOpen={setLightbox} />)}</div><a className="voha-text-link" href={camera} target="_blank" rel="noreferrer">{t.camera} ↗</a></section>
    <section className="voha-catalog-cta" data-voha-reveal><p className="voha-overline">{t.catalogTop}</p><div><h2>{t.catalogTitle}</h2><p>{t.catalogText}<small>{t.catalogNote}</small></p></div><a className="voha-button is-light" href={withLanguage('/voha/apartments', language)}>{t.choose}<span>↗</span></a></section>
    <section className="voha-contact" data-voha-reveal><div><p className="voha-overline">{t.contactTop}</p><h2>{t.contactTitle}</h2><p>{t.contactText}</p><button className="voha-button is-solid" type="button" onClick={() => openConsult('voha:contact')}>{t.consult}<span>↗</span></button></div><figure><img src={asset('/voha/images/waterside.webp')} alt="Реальная фотография жизни у воды в Voha" loading="lazy" /><figcaption>LIVE · {t.photo}</figcaption></figure></section>
    <footer className="voha-footer"><a className="voha-wordmark" href={withLanguage('/voha', language)}>VOHA<small>by NRG-BI</small></a><div><a href="tel:1360">{t.phone} · 1360</a><a href={`${appBasePath}/privacy?project=voha&lang=${language}`}>{t.privacy}</a></div><p>© 2026 · Информация не является публичной офертой.</p></footer>
    {lightbox ? <Lightbox state={lightbox} language={language} onClose={() => setLightbox(null)} /> : null}{consult ? <Consultation open language={language} context={consult} onClose={() => setConsult('')} /> : null}
  </main>;
}
