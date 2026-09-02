'use client';

/* eslint-disable @next/next/no-img-element */

import { useRouter } from 'next/navigation';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { LeadModal } from '@/app/lead-modal';
import { bayterakLeadSubmitUrl } from './bayterak-lead';

type Language = 'ru' | 'uz' | 'en';
type ClassKey = 'comfort' | 'business';
type SlideKind = 'visualisation' | 'concept' | 'future';
type Slide = { src: string; kind: SlideKind };
type IntroPhase = 'visible' | 'leaving' | 'hidden';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const classKeys: ClassKey[] = ['comfort', 'business'];
const storageKey = 'bayterak-language';
const introKey = 'bayterak-intro-seen-v1';
const panorama = 'https://uzbekistan360.uz/ru/location/nrg-bi-bayterakHcY';

const gallerySlides: Slide[] = [
  { src: '/bayterak/images/hero-comfort.webp', kind: 'visualisation' },
  { src: '/bayterak/images/business-gate.webp', kind: 'visualisation' },
  { src: '/bayterak/images/business-alt.webp', kind: 'visualisation' },
  { src: '/bayterak/images/masterplan.webp', kind: 'visualisation' },
  { src: '/bayterak/images/new-tashkent.webp', kind: 'future' },
  { src: '/bayterak/images/courtyard-01.webp', kind: 'visualisation' },
  { src: '/bayterak/images/courtyard-02.webp', kind: 'visualisation' },
  { src: '/bayterak/images/courtyard-03.webp', kind: 'visualisation' },
  { src: '/bayterak/images/lobby-business.webp', kind: 'concept' },
  { src: '/bayterak/images/fitness-business.webp', kind: 'concept' },
  { src: '/bayterak/images/guest-room.webp', kind: 'concept' },
];

const copy = {
  ru: {
    skip: 'К содержанию', navigation: 'Навигация', footerNavigation: 'Источники и юридическая информация', menu: 'Меню', closeMenu: 'Закрыть меню', language: 'Язык',
    nav: [['roots', 'Корни'], ['architecture', 'Архитектура'], ['courtyards', 'Дворы'], ['city', 'Город'], ['inside', 'Внутри'], ['gallery', 'Галерея']] as const,
    choose: 'Выбрать квартиру', consult: 'Получить консультацию', phone: 'Позвонить · +998 78 113 77 12',
    heroOverline: 'НОВЫЙ ТАШКЕНТ · COMFORT+ / BUSINESS', heroText: 'Архитектурная вертикаль между легендой, домом и новым городом.',
    heroAlt: 'Официальная архитектурная визуализация фасада Bayterak в Новом Ташкенте',
    heroFacts: [['Новый Ташкент', 'локация'], ['Comfort+ / Business', 'классы'], ['9–16', 'этажей'], ['3 м', 'потолки']] as const,
    visualisation: 'Официальная визуализация проекта', concept: 'Официальная концепция интерьера / CGI', future: 'Официальная перспективная концепция',
    visualisationNotice: 'Официальная визуализация проекта · финальный вид может измениться',
    conceptNotice: 'Официальная концепция интерьера / CGI · не фотография · финальный вид может измениться',
    futureNotice: 'Официальная перспективная концепция Нового Ташкента · запланированная среда · финальный вид может измениться',
    masterplanNotice: 'Официальная визуализация генплана · срок всего комплекса — 2030 · финальный вид может измениться',
    rootsIndex: '01 · КОРНИ', rootsTitle: 'Легенда становится системой координат.',
    rootsText: 'В официальной легенде Bayterak — мировое дерево, соединяющее небо и землю. Симург откладывает золотое яйцо — образ, связанный с жизнью, солнцем и гармонией. Архитектура переводит легенду в вертикальную ось, без буквальной иллюстрации.',
    rootsQuote: 'Между землёй и небом — дом.',
    architectureIndex: '02 · СТВОЛ', architectureTitle: 'Вертикаль, собранная из света и орнамента.',
    architectureText: 'Фасад переосмысливает традиционный орнамент через современный архитектурный ритм. Высотные объёмы в 9, 12 и 16 этажей формируют силуэт, а коммерческие помещения с потолками 4 м продолжают город на уровне улицы.',
    architectureAlt: 'Официальная визуализация входа и фасада Business-класса Bayterak',
    architectureDetails: [['Comfort+', 'вентилируемый фасад'], ['Окна', 'металлопластиковые'], ['Межквартирные стены', 'кирпич'], ['Внешние и внутренние стены', 'газоблок']] as const,
    courtyardsIndex: '03 · КРОНА', courtyardsTitle: 'Несколько дворов. Несколько ритмов дня.',
    courtyardsText: 'Закрытые дворы объединяют авторский ландшафт, озеленение и сценарии для детей, спорта и спокойного отдыха. Охрана и видеонаблюдение заявлены круглосуточно.',
    courtyardAlt: 'Официальная визуализация закрытого двора Bayterak',
    courtyardFeatures: ['детские зоны', 'BBQ и тихий отдых', 'workout', 'охрана и видеонаблюдение 24/7'],
    cityIndex: '04 · ГОРОД ВОКРУГ', cityTitle: 'Новый Ташкент — контекст будущего.',
    cityText: 'Bayterak заявлен в Новом Ташкенте. Школа и детский сад поблизости показаны как запланированная инфраструктура: визуализация не означает, что эти объекты уже работают.',
    cityAlt: 'Официальная перспективная концепция будущей среды Нового Ташкента рядом с Bayterak',
    cityNote: 'Генплан текущего буклета указывает 2030 год как срок всего комплекса, а не конкретной очереди.',
    insideIndex: '05 · ВНУТРИ', insideTitle: 'Два класса — одна точность деталей.', insideText: 'Переключите класс, чтобы увидеть подтверждённые характеристики. Интерьеры показаны только как официальные концепции.',
    classTabs: { comfort: 'Comfort+', business: 'Business' },
    inside: {
      comfort: {
        title: 'Comfort+ · рациональная долговечность',
        text: 'Вентилируемый фасад, металлопластиковые окна, кирпичные межквартирные стены и газоблок во внешних и внутренних стенах.',
        features: ['закрытый двор', 'авторский ландшафт', 'электронные замки', 'IP-видеодомофон', 'крытая и велопарковка', 'кладовые и EV charging'],
        src: '/bayterak/images/hero-comfort.webp',
        alt: 'Официальная архитектурная визуализация корпуса Comfort+ Bayterak',
        notice: 'Официальная визуализация проекта · финальный вид может измениться',
      },
      business: {
        title: 'Business · дополнительные сценарии внутри дома',
        text: 'Дизайнерские холлы; в официальных материалах упомянуты натуральный мрамор и MDF-панели. Для жителей предусмотрены fitness room и guest room.',
        features: ['fitness room', 'guest room', 'натуральный мрамор', 'MDF-панели', 'электронные замки', 'IP-видеодомофон'],
        src: '/bayterak/images/lobby-business.webp',
        alt: 'Официальная концепция дизайнерского холла Business-класса Bayterak',
        notice: 'Официальная концепция интерьера / CGI · не фотография · финальный вид может измениться',
      },
    },
    galleryIndex: '06 · ОФИЦИАЛЬНЫЕ МАТЕРИАЛЫ', galleryTitle: 'Галерея без подмены реальности.',
    galleryText: 'Все кадры ниже — архитектурные визуализации или концепции, а не фотографии готового Bayterak. Используйте кнопки, клавиши или свайп; изображение открывается во весь экран.',
    galleryTitles: ['Comfort+ · фасад', 'Business · входная группа', 'Business · альтернативный ракурс', 'Генплан комплекса', 'Будущий контекст Нового Ташкента', 'Двор · сценарий 01', 'Двор · сценарий 02', 'Двор · сценарий 03', 'Business · концепция холла', 'Business · концепция fitness room', 'Business · концепция guest room'],
    galleryLabel: 'Галерея официальных визуализаций', openImage: 'Открыть изображение', closeImage: 'Закрыть изображение', previous: 'Предыдущее изображение', next: 'Следующее изображение',
    optionsNote: 'Электронные замки, IP-видеодомофоны, места крытого паркинга и велопарковки, кладовые и EV charging — опциональные решения и места, приобретаемые отдельно; они не входят автоматически в каждую квартиру. Наличие и условия уточняет отдел продаж. EV charging предусмотрен только для 5% парковочных мест.',
    catalogIndex: '07 · АРХИТЕКТУРНЫЙ РЕЕСТР', catalogTitle: '140 предложений в официальной подборке.',
    catalogText: 'Срез placementList от 30 августа 2026, 14:18 UZT. Это предложения с исходными CRM-статусами, а не заявление, что все квартиры свободны.',
    catalogStats: [['140', 'предложений'], ['1–4', 'комнаты'], ['26,51–129,02 м²', 'площадь'], ['2–16', 'этажи']] as const,
    catalogPrice: 'Текущая цена кампании: 467 567 900–2 055 877 755 UZS. Условия и статус подтверждает отдел продаж.', openCatalog: 'Открыть полный каталог',
    contactIndex: '08 · КОНСУЛЬТАЦИЯ', contactTitle: 'Найдём квартиру на вашей оси координат.', contactText: 'Оставьте контакты — менеджер NRG-BI уточнит актуальный статус, цену и срок выбранного предложения.',
    formTagline: 'Золотая ось Нового Ташкента.', formFacts: ['Comfort+ / Business', '9–16 этажей', 'потолки 3 м'],
    privacy: 'Обработка персональных данных', booklet: 'Буклет · август 2026', panorama: 'Панорама 360', top: 'Наверх',
    disclaimer: 'Все проектные изображения имеют статус визуализации или концепции. Финальный вид может измениться. Материалы и каталог не являются публичной офертой.',
    introLabel: 'ЗОЛОТАЯ ОСЬ · НОВЫЙ ТАШКЕНТ',
  },
  uz: {
    skip: 'Mazmunga o‘tish', navigation: 'Navigatsiya', footerNavigation: 'Manbalar va huquqiy ma’lumot', menu: 'Menyu', closeMenu: 'Menyuni yopish', language: 'Til',
    nav: [['roots', 'Ildizlar'], ['architecture', 'Arxitektura'], ['courtyards', 'Hovlilar'], ['city', 'Shahar'], ['inside', 'Ichkarida'], ['gallery', 'Galereya']] as const,
    choose: 'Xonadon tanlash', consult: 'Maslahat olish', phone: 'Qo‘ng‘iroq · +998 78 113 77 12',
    heroOverline: 'YANGI TOSHKENT · COMFORT+ / BUSINESS', heroText: 'Afsona, uy va yangi shaharni bog‘laydigan arxitektura vertikali.',
    heroAlt: 'Yangi Toshkentdagi Bayterak fasadining rasmiy arxitektura vizualizatsiyasi',
    heroFacts: [['Yangi Toshkent', 'joylashuv'], ['Comfort+ / Business', 'klasslar'], ['9–16', 'qavat'], ['3 m', 'shiftlar']] as const,
    visualisation: 'Loyihaning rasmiy vizualizatsiyasi', concept: 'Interyerning rasmiy konsepsiyasi / CGI', future: 'Rasmiy istiqbol konsepsiyasi',
    visualisationNotice: 'Loyihaning rasmiy vizualizatsiyasi · yakuniy ko‘rinish o‘zgarishi mumkin',
    conceptNotice: 'Interyerning rasmiy konsepsiyasi / CGI · fotosurat emas · yakuniy ko‘rinish o‘zgarishi mumkin',
    futureNotice: 'Yangi Toshkentning rasmiy istiqbol konsepsiyasi · rejalashtirilgan muhit · yakuniy ko‘rinish o‘zgarishi mumkin',
    masterplanNotice: 'Bosh rejaning rasmiy vizualizatsiyasi · butun majmua muddati — 2030 · yakuniy ko‘rinish o‘zgarishi mumkin',
    rootsIndex: '01 · ILDIZLAR', rootsTitle: 'Afsona koordinatalar tizimiga aylanadi.',
    rootsText: 'Rasmiy afsonada Bayterak — osmon bilan yerni bog‘laydigan dunyo daraxti. Simurg‘ hayot, quyosh va uyg‘unlik bilan bog‘langan oltin tuxum qo‘yadi. Arxitektura bu afsonani literal tasvirsiz vertikal o‘qqa aylantiradi.',
    rootsQuote: 'Yer bilan osmon orasida — uy.',
    architectureIndex: '02 · TANA', architectureTitle: 'Yorug‘lik va naqshdan yig‘ilgan vertikal.',
    architectureText: 'Fasad an’anaviy naqshni zamonaviy arxitektura ritmi orqali qayta talqin qiladi. 9, 12 va 16 qavatli hajmlar siluetni shakllantiradi, 4 m shiftli tijorat xonalari esa ko‘cha sathida shaharni davom ettiradi.',
    architectureAlt: 'Bayterak Business klassi kirish qismi va fasadining rasmiy vizualizatsiyasi',
    architectureDetails: [['Comfort+', 'ventilyatsiyali fasad'], ['Derazalar', 'metall-plastik'], ['Xonadonlararo devorlar', 'g‘isht'], ['Tashqi va ichki devorlar', 'gazoblok']] as const,
    courtyardsIndex: '03 · TOJ', courtyardsTitle: 'Bir nechta hovli. Kunning bir nechta ritmi.',
    courtyardsText: 'Yopiq hovlilar mualliflik landshafti, ko‘kalamzor hamda bolalar, sport va sokin dam olish ssenariylarini birlashtiradi. Qo‘riqlash va videokuzatuv 24/7 deb ko‘rsatilgan.',
    courtyardAlt: 'Bayterak yopiq hovlisining rasmiy vizualizatsiyasi',
    courtyardFeatures: ['bolalar zonalari', 'BBQ va sokin dam', 'workout', '24/7 qo‘riqlash va videokuzatuv'],
    cityIndex: '04 · ATROFDAGI SHAHAR', cityTitle: 'Yangi Toshkent — kelajak konteksti.',
    cityText: 'Bayterak Yangi Toshkentda taqdim etilgan. Yaqindagi maktab va bog‘cha rejalashtirilgan infratuzilma sifatida ko‘rsatilgan: vizualizatsiya bu obyektlar allaqachon ishlayotganini anglatmaydi.',
    cityAlt: 'Bayterak yaqinidagi Yangi Toshkent kelajak muhitining rasmiy istiqbol konsepsiyasi',
    cityNote: 'Joriy buklet bosh rejasida 2030-yil butun majmua muddati sifatida ko‘rsatilgan, alohida navbat muddati sifatida emas.',
    insideIndex: '05 · ICHKARIDA', insideTitle: 'Ikki klass — detallarga bir xil aniqlik.', insideText: 'Tasdiqlangan xususiyatlarni ko‘rish uchun klassni almashtiring. Interyerlar faqat rasmiy konsepsiya sifatida ko‘rsatilgan.',
    classTabs: { comfort: 'Comfort+', business: 'Business' },
    inside: {
      comfort: {
        title: 'Comfort+ · oqilona chidamlilik',
        text: 'Ventilyatsiyali fasad, metall-plastik derazalar, g‘ishtli xonadonlararo devorlar hamda tashqi va ichki devorlarda gazoblok.',
        features: ['yopiq hovli', 'mualliflik landshafti', 'elektron qulflar', 'IP videodomofon', 'yopiq parking va veloparking', 'omborlar va EV charging'],
        src: '/bayterak/images/hero-comfort.webp',
        alt: 'Bayterak Comfort+ korpusining rasmiy arxitektura vizualizatsiyasi',
        notice: 'Loyihaning rasmiy vizualizatsiyasi · yakuniy ko‘rinish o‘zgarishi mumkin',
      },
      business: {
        title: 'Business · uy ichidagi qo‘shimcha ssenariylar',
        text: 'Dizaynerlik xollari; rasmiy materiallarda tabiiy marmar va MDF panellari tilga olingan. Rezidentlar uchun fitness room va guest room ko‘zda tutilgan.',
        features: ['fitness room', 'guest room', 'tabiiy marmar', 'MDF panellari', 'elektron qulflar', 'IP videodomofon'],
        src: '/bayterak/images/lobby-business.webp',
        alt: 'Bayterak Business klassi dizaynerlik xollining rasmiy konsepsiyasi',
        notice: 'Interyerning rasmiy konsepsiyasi / CGI · fotosurat emas · yakuniy ko‘rinish o‘zgarishi mumkin',
      },
    },
    galleryIndex: '06 · RASMIY MATERIALLAR', galleryTitle: 'Haqiqatni almashtirmaydigan galereya.',
    galleryText: 'Quyidagi barcha kadrlar tayyor Bayterak fotosuratlari emas, balki arxitektura vizualizatsiyalari yoki konsepsiyalaridir. Tugmalar, klaviatura yoki surishdan foydalaning; tasvir to‘liq ekranda ochiladi.',
    galleryTitles: ['Comfort+ · fasad', 'Business · kirish guruhi', 'Business · muqobil rakurs', 'Majmua bosh rejasi', 'Yangi Toshkentning kelajak konteksti', 'Hovli · 01-ssenariy', 'Hovli · 02-ssenariy', 'Hovli · 03-ssenariy', 'Business · xoll konsepsiyasi', 'Business · fitness room konsepsiyasi', 'Business · guest room konsepsiyasi'],
    galleryLabel: 'Rasmiy vizualizatsiyalar galereyasi', openImage: 'Tasvirni ochish', closeImage: 'Tasvirni yopish', previous: 'Oldingi tasvir', next: 'Keyingi tasvir',
    optionsNote: 'Elektron qulflar, IP videodomofonlar, yopiq parking va veloparking joylari, omborlar hamda EV charging — alohida xarid qilinadigan ixtiyoriy yechimlar va joylar; ular har bir xonadonga avtomatik ravishda kiritilmaydi. Mavjudlik va shartlarni sotuv bo‘limidan aniqlashtiring. EV charging parking joylarining faqat 5% ida ko‘zda tutilgan.',
    catalogIndex: '07 · ARXITEKTURA REYESTRI', catalogTitle: 'Rasmiy tanlovdagi 140 ta taklif.',
    catalogText: '2026-yil 30-avgust, 14:18 UZT dagi placementList kesimi. Bu boshlang‘ich CRM statuslari bilan takliflar; barcha xonadonlar bo‘sh degan da’vo emas.',
    catalogStats: [['140', 'taklif'], ['1–4', 'xonalar'], ['26.51–129.02 m²', 'maydon'], ['2–16', 'qavatlar']] as const,
    catalogPrice: 'Kampaniya bo‘yicha joriy narx: 467 567 900–2 055 877 755 UZS. Shart va statusni sotuv bo‘limi tasdiqlaydi.', openCatalog: 'To‘liq katalogni ochish',
    contactIndex: '08 · MASLAHAT', contactTitle: 'Koordinatalaringizga mos xonadonni topamiz.', contactText: 'Kontaktlaringizni qoldiring — NRG-BI menejeri tanlangan taklifning joriy statusi, narxi va muddatini aniqlashtiradi.',
    formTagline: 'Yangi Toshkentning oltin o‘qi.', formFacts: ['Comfort+ / Business', '9–16 qavat', '3 m shiftlar'],
    privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', booklet: 'Buklet · 2026-yil avgust', panorama: '360 panorama', top: 'Yuqoriga',
    disclaimer: 'Barcha loyiha tasvirlari vizualizatsiya yoki konsepsiya maqomiga ega. Yakuniy ko‘rinish o‘zgarishi mumkin. Materiallar va katalog ommaviy oferta emas.',
    introLabel: 'OLTIN O‘Q · YANGI TOSHKENT',
  },
  en: {
    skip: 'Skip to content', navigation: 'Navigation', footerNavigation: 'Sources and legal information', menu: 'Menu', closeMenu: 'Close menu', language: 'Language',
    nav: [['roots', 'Roots'], ['architecture', 'Architecture'], ['courtyards', 'Courtyards'], ['city', 'City'], ['inside', 'Inside'], ['gallery', 'Gallery']] as const,
    choose: 'Choose an apartment', consult: 'Get a consultation', phone: 'Call · +998 78 113 77 12',
    heroOverline: 'NEW TASHKENT · COMFORT+ / BUSINESS', heroText: 'An architectural vertical connecting legend, home and a new city.',
    heroAlt: 'Official architectural visualisation of the Bayterak facade in New Tashkent',
    heroFacts: [['New Tashkent', 'location'], ['Comfort+ / Business', 'classes'], ['9–16', 'storeys'], ['3 m', 'ceilings']] as const,
    visualisation: 'Official project visualisation', concept: 'Official interior concept / CGI', future: 'Official future concept',
    visualisationNotice: 'Official project visualisation · final appearance may change',
    conceptNotice: 'Official interior concept / CGI · not a photograph · final appearance may change',
    futureNotice: 'Official future concept for New Tashkent · planned setting · final appearance may change',
    masterplanNotice: 'Official masterplan visualisation · whole-complex date: 2030 · final appearance may change',
    rootsIndex: '01 · ROOTS', rootsTitle: 'A legend becomes a coordinate system.',
    rootsText: 'In the official legend, Bayterak is the world tree connecting heaven and earth. Simurgh lays a golden egg associated with life, the sun and harmony. The architecture translates this legend into a vertical axis without a literal illustration.',
    rootsQuote: 'Between earth and sky — home.',
    architectureIndex: '02 · TRUNK', architectureTitle: 'A vertical composed from light and ornament.',
    architectureText: 'The facade reinterprets traditional ornament through a contemporary architectural rhythm. Volumes of 9, 12 and 16 storeys shape the skyline, while commercial premises with 4 m ceilings extend the city at street level.',
    architectureAlt: 'Official visualisation of the Bayterak Business entrance and facade',
    architectureDetails: [['Comfort+', 'ventilated facade'], ['Windows', 'metal-plastic'], ['Party walls', 'brick'], ['External and internal walls', 'aerated concrete block']] as const,
    courtyardsIndex: '03 · CROWN', courtyardsTitle: 'Several courtyards. Several rhythms of the day.',
    courtyardsText: 'Private courtyards combine authored landscaping, greenery and settings for children, exercise and quiet rest. Security and video surveillance are specified around the clock.',
    courtyardAlt: 'Official visualisation of a private Bayterak courtyard',
    courtyardFeatures: ['children’s zones', 'BBQ and quiet rest', 'workout', '24/7 security and video surveillance'],
    cityIndex: '04 · THE CITY AROUND', cityTitle: 'New Tashkent is a future context.',
    cityText: 'Bayterak is presented in New Tashkent. A nearby school and kindergarten are shown only as planned infrastructure: the visualisation does not mean those facilities are operating today.',
    cityAlt: 'Official future concept for the New Tashkent setting around Bayterak',
    cityNote: 'The current booklet’s masterplan shows 2030 as the date for the whole complex, not for a specific phase.',
    insideIndex: '05 · INSIDE', insideTitle: 'Two classes, one precision of detail.', insideText: 'Switch class to review confirmed specifications. Interior imagery is presented only as official concept work.',
    classTabs: { comfort: 'Comfort+', business: 'Business' },
    inside: {
      comfort: {
        title: 'Comfort+ · rational durability',
        text: 'A ventilated facade, metal-plastic windows, brick party walls and aerated concrete block in external and internal walls.',
        features: ['private courtyard', 'authored landscaping', 'electronic locks', 'IP video intercom', 'covered parking and cycle parking', 'storage rooms and EV charging'],
        src: '/bayterak/images/hero-comfort.webp',
        alt: 'Official architectural visualisation of a Bayterak Comfort+ building',
        notice: 'Official project visualisation · final appearance may change',
      },
      business: {
        title: 'Business · more settings within the home',
        text: 'Designer lobbies; the official materials mention natural marble and MDF panels. A fitness room and guest room are provided for residents.',
        features: ['fitness room', 'guest room', 'natural marble', 'MDF panels', 'electronic locks', 'IP video intercom'],
        src: '/bayterak/images/lobby-business.webp',
        alt: 'Official concept for a Bayterak Business designer lobby',
        notice: 'Official interior concept / CGI · not a photograph · final appearance may change',
      },
    },
    galleryIndex: '06 · OFFICIAL MATERIALS', galleryTitle: 'A gallery that does not replace reality.',
    galleryText: 'Every frame below is an architectural visualisation or concept, not a photograph of a completed Bayterak. Use the controls, keyboard or swipe, then open the image fullscreen.',
    galleryTitles: ['Comfort+ · facade', 'Business · entrance', 'Business · alternate view', 'Complex masterplan', 'Future New Tashkent context', 'Courtyard · setting 01', 'Courtyard · setting 02', 'Courtyard · setting 03', 'Business · lobby concept', 'Business · fitness room concept', 'Business · guest room concept'],
    galleryLabel: 'Gallery of official visualisations', openImage: 'Open image', closeImage: 'Close image', previous: 'Previous image', next: 'Next image',
    optionsNote: 'Electronic locks, IP video intercoms, covered parking and cycle-parking spaces, storage rooms and EV charging are optional solutions and spaces purchased separately; they are not automatically included with every apartment. Confirm availability and terms with the sales team. EV charging is provided for only 5% of parking spaces.',
    catalogIndex: '07 · ARCHITECTURAL REGISTER', catalogTitle: '140 listings in the official selection.',
    catalogText: 'A placementList snapshot captured on 30 August 2026, 14:18 UZT. These listings retain their source CRM statuses; this is not a claim that every apartment is available.',
    catalogStats: [['140', 'listings'], ['1–4', 'rooms'], ['26.51–129.02 m²', 'area'], ['2–16', 'floors']] as const,
    catalogPrice: 'Current campaign price: UZS 467,567,900–2,055,877,755. The sales team confirms terms and status.', openCatalog: 'Open the full catalogue',
    contactIndex: '08 · CONSULTATION', contactTitle: 'Find an apartment on your own axis.', contactText: 'Leave your details and an NRG-BI manager will confirm the current status, price and completion date for your chosen listing.',
    formTagline: 'The golden axis of New Tashkent.', formFacts: ['Comfort+ / Business', '9–16 storeys', '3 m ceilings'],
    privacy: 'Personal data processing', booklet: 'Booklet · August 2026', panorama: '360 panorama', top: 'Back to top',
    disclaimer: 'Every project image is identified as a visualisation or concept. Final appearance may change. The materials and catalogue are not a public offer.',
    introLabel: 'GOLDEN AXIS · NEW TASHKENT',
  },
} as const;

function asset(path: string) {
  return `${appBasePath}${path}`;
}

function withLanguage(path: string, language: Language) {
  return `${appBasePath}${path}?lang=${language}`;
}

function privacyUrl(language: Language) {
  return `${withLanguage('/privacy', language)}&project=bayterak`;
}

function preferredScrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

let measuredScrollbarWidth = 0;

function lockBody() {
  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPaddingRight = body.style.paddingRight;
  const scrollbar = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
  const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
  body.style.overflow = 'hidden';
  if (scrollbar > 0) body.style.paddingRight = `${currentPadding + scrollbar}px`;
  return () => {
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPaddingRight;
  };
}

function useIntro() {
  const [phase, setPhase] = useState<IntroPhase>('visible');
  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let seen = false;
    try { seen = window.sessionStorage.getItem(introKey) === '1'; } catch { seen = false; }
    if (reduced || seen) {
      const frame = window.requestAnimationFrame(() => setPhase('hidden'));
      return () => window.cancelAnimationFrame(frame);
    }

    const unlock = lockBody();
    let unlocked = false;
    const unlockOnce = () => { if (!unlocked) { unlocked = true; unlock(); } };
    const leaveTimer = window.setTimeout(() => setPhase('leaving'), 760);
    const closeTimer = window.setTimeout(() => {
      try { window.sessionStorage.setItem(introKey, '1'); } catch { /* The intro can still close without storage. */ }
      setPhase('hidden');
      unlockOnce();
    }, 1040);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(closeTimer);
      unlockOnce();
    };
  }, []);
  return phase;
}

function useReveals(language: Language) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.bayterak-site [data-bayterak-reveal]'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }), { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });
    nodes.forEach((node) => observer.observe(node));
    const fallback = window.setTimeout(() => nodes.forEach((node) => node.classList.add('is-visible')), 900);
    return () => { window.clearTimeout(fallback); observer.disconnect(); };
  }, [language]);
}

function ProjectFigure({ src, alt, notice, className = '' }: { src: string; alt: string; notice: string; className?: string }) {
  return <figure className={`bayterak-project-figure ${className}`}><img src={asset(src)} alt={alt} loading="lazy" decoding="async" /><figcaption>{notice}</figcaption></figure>;
}

function Lightbox({ slides, titles, index, language, onMove, onSelect, onClose }: { slides: Slide[]; titles: readonly string[]; index: number; language: Language; onMove: (direction: number) => void; onSelect: (index: number) => void; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerX = useRef<number | undefined>(undefined);
  const t = copy[language];
  const current = slides[index];
  const notice = current.kind === 'concept' ? t.conceptNotice : current.kind === 'future' ? t.futureNotice : current.src.includes('masterplan') ? t.masterplanNotice : t.visualisationNotice;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const unlock = lockBody();
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); onMove(1); return; }
      if (event.key === 'Home') { event.preventDefault(); onSelect(0); return; }
      if (event.key === 'End') { event.preventDefault(); onSelect(slides.length - 1); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
      window.requestAnimationFrame(() => opener?.isConnected && opener.focus({ preventScroll: true }));
    };
  }, [onClose, onMove, onSelect, slides.length]);

  const beginSwipe = (event: ReactPointerEvent) => {
    event.stopPropagation();
    if (event.isPrimary) pointerX.current = event.clientX;
  };
  const endSwipe = (event: ReactPointerEvent) => {
    event.stopPropagation();
    if (!event.isPrimary || pointerX.current === undefined) return;
    const delta = event.clientX - pointerX.current;
    if (Math.abs(delta) > 44) onMove(delta > 0 ? -1 : 1);
    pointerX.current = undefined;
  };

  return <div className="bayterak-lightbox" role="dialog" aria-modal="true" aria-labelledby="bayterak-lightbox-caption" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={panelRef} className="bayterak-lightbox__panel" onPointerDown={beginSwipe} onPointerUp={endSwipe} onPointerCancel={(event) => { event.stopPropagation(); pointerX.current = undefined; }}><button ref={closeRef} className="bayterak-lightbox__close" type="button" onClick={onClose} aria-label={t.closeImage}>×</button><button className="bayterak-lightbox__previous" type="button" onClick={() => onMove(-1)} aria-label={t.previous}>←</button><figure><img src={asset(current.src)} alt={`${titles[index]} · ${notice}`} draggable={false} /><figcaption id="bayterak-lightbox-caption" aria-live="polite"><span>{notice}</span><strong>{titles[index]}</strong><small>{String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</small></figcaption></figure><button className="bayterak-lightbox__next" type="button" onClick={() => onMove(1)} aria-label={t.next}>→</button></div></div>;
}

function Gallery({ language }: { language: Language }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const pointerX = useRef<number | undefined>(undefined);
  const swiped = useRef(false);
  const t = copy[language];
  const move = useCallback((direction: number) => setIndex((value) => (value + direction + gallerySlides.length) % gallerySlides.length), []);
  const closeLightbox = useCallback(() => setLightbox(false), []);
  const current = gallerySlides[index];
  const notice = current.kind === 'concept' ? t.conceptNotice : current.kind === 'future' ? t.futureNotice : current.src.includes('masterplan') ? t.masterplanNotice : t.visualisationNotice;
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('.bayterak-lightbox')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    if (event.key === 'End') { event.preventDefault(); setIndex(gallerySlides.length - 1); }
  };
  const onPointerDown = (event: ReactPointerEvent) => { if (event.isPrimary) { pointerX.current = event.clientX; swiped.current = false; } };
  const onPointerUp = (event: ReactPointerEvent) => {
    if (!event.isPrimary || pointerX.current === undefined) return;
    const delta = event.clientX - pointerX.current;
    if (Math.abs(delta) > 44) { swiped.current = true; move(delta > 0 ? -1 : 1); }
    pointerX.current = undefined;
  };

  return <div className="bayterak-gallery" role="region" tabIndex={0} aria-label={t.galleryLabel} onKeyDown={onKey} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { pointerX.current = undefined; }}><button className="bayterak-gallery__image" type="button" onClick={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; return; } setLightbox(true); }} aria-label={`${t.openImage}: ${t.galleryTitles[index]}`}><img key={current.src} src={asset(current.src)} alt={`${t.galleryTitles[index]} · ${notice}`} loading="lazy" decoding="async" draggable={false} /><span>{notice}</span><i aria-hidden="true">↗</i></button><div className="bayterak-gallery__caption" aria-live="polite"><span>{String(index + 1).padStart(2, '0')} / {String(gallerySlides.length).padStart(2, '0')}</span><strong>{t.galleryTitles[index]}</strong></div><div className="bayterak-gallery__controls"><button type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button><div>{gallerySlides.map((slide, slideIndex) => <button type="button" key={slide.src} className={slideIndex === index ? 'is-active' : ''} aria-pressed={slideIndex === index} aria-label={t.galleryTitles[slideIndex]} onClick={() => setIndex(slideIndex)}>{String(slideIndex + 1).padStart(2, '0')}</button>)}</div><button type="button" onClick={() => move(1)} aria-label={t.next}>→</button></div>{lightbox ? <Lightbox slides={gallerySlides} titles={t.galleryTitles} index={index} language={language} onMove={move} onSelect={setIndex} onClose={closeLightbox} /> : null}</div>;
}

function InsideTabs({ language }: { language: Language }) {
  const [active, setActive] = useState<ClassKey>('comfort');
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const t = copy[language];
  const selectFromKey = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (index + 1) % classKeys.length : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (index - 1 + classKeys.length) % classKeys.length : event.key === 'Home' ? 0 : event.key === 'End' ? classKeys.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(classKeys[next]);
    window.requestAnimationFrame(() => tabRefs.current[next]?.focus());
  };
  return <div className="bayterak-inside__tabs"><div className="bayterak-tablist" role="tablist" aria-label={t.insideTitle}>{classKeys.map((key, index) => <button ref={(node) => { tabRefs.current[index] = node; }} id={`bayterak-tab-${key}`} type="button" role="tab" aria-selected={active === key} aria-controls={`bayterak-panel-${key}`} tabIndex={active === key ? 0 : -1} className={active === key ? 'is-active' : ''} key={key} onClick={() => setActive(key)} onKeyDown={(event) => selectFromKey(event, index)}><span>0{index + 1}</span>{t.classTabs[key]}</button>)}</div>{classKeys.map((key) => { const panel = t.inside[key]; return <article key={key} id={`bayterak-panel-${key}`} role="tabpanel" aria-labelledby={`bayterak-tab-${key}`} hidden={active !== key} tabIndex={0}><div><small>{t.classTabs[key]}</small><h3>{panel.title}</h3><p>{panel.text}</p><ul>{panel.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><p className="bayterak-inside__options-note">{t.optionsNote}</p></div><ProjectFigure src={panel.src} alt={panel.alt} notice={panel.notice} /></article>; })}</div>;
}

export function BayterakPage({ initialLanguage }: { initialLanguage: Language }) {
  const router = useRouter();
  const language = initialLanguage;
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadContext, setLeadContext] = useState<string>();
  const introPhase = useIntro();
  const menuRef = useRef<HTMLElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const restoreMenuFocus = useRef(true);
  const t = copy[language];
  useReveals(language);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('lang')) {
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(storageKey); } catch { /* URL language remains authoritative when storage is unavailable. */ }
      const fallback = stored === 'ru' || stored === 'uz' || stored === 'en' ? stored : language;
      url.searchParams.set('lang', fallback);
      router.replace(`${url.pathname}?${url.searchParams.toString()}${url.hash}`, { scroll: false });
      if (fallback !== language) return;
    }
    document.documentElement.lang = language;
    document.documentElement.classList.add('bayterak-scroll-smooth');
    try { window.localStorage.setItem(storageKey, language); } catch { /* Scoped fallback is optional. */ }
    return () => document.documentElement.classList.remove('bayterak-scroll-smooth');
  }, [language, router]);

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuTriggerRef.current;
    const unlock = lockBody();
    menuCloseRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); restoreMenuFocus.current = true; setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!menuRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlock();
      window.removeEventListener('keydown', onKey);
      const shouldRestore = restoreMenuFocus.current;
      restoreMenuFocus.current = true;
      if (shouldRestore) window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!leadContext) return;
    const body = document.body;
    const previousPadding = body.style.paddingRight;
    const scrollbar = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    const currentPadding = Number.parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    if (scrollbar > 0) body.style.paddingRight = `${currentPadding + scrollbar}px`;
    return () => { body.style.paddingRight = previousPadding; };
  }, [leadContext]);

  const setLanguage = (next: Language) => {
    try { window.localStorage.setItem(storageKey, next); } catch { /* Navigation must not depend on storage. */ }
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    router.replace(`${url.pathname}?${url.searchParams.toString()}${url.hash}`, { scroll: false });
  };
  const goToAnchor = (event: ReactMouseEvent<HTMLAnchorElement>, id: string) => {
    event.preventDefault();
    if (menuOpen) restoreMenuFocus.current = false;
    setMenuOpen(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const section = document.getElementById(id);
      section?.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
      section?.focus({ preventScroll: true });
      const url = new URL(window.location.href);
      url.hash = id;
      window.history.replaceState({}, '', url);
    }));
  };
  const openLead = (surface: string) => {
    measuredScrollbarWidth = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    setLeadContext(`bayterak:landing:${surface}:lang=${language}`);
  };
  return <div className="bayterak-site" lang={language}>
    {introPhase !== 'hidden' ? <div className={`bayterak-intro ${introPhase === 'leaving' ? 'is-leaving' : ''}`} aria-hidden="true"><span>{t.introLabel}</span><i /><small>BAY / TERAK</small></div> : null}
    <a className="bayterak-skip" href="#bayterak-content">{t.skip}</a>
    <header className="bayterak-header">
      <a className="bayterak-mark" href={withLanguage('/bayterak', language)} aria-label="Bayterak"><span>BAY</span><span>TERAK</span></a>
      <nav aria-label={t.navigation}>{t.nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(event) => goToAnchor(event, id)}>{label}</a>)}</nav>
      <div className="bayterak-header__actions"><a className="bayterak-header__catalog" href={withLanguage('/bayterak/apartments', language)}>{t.choose}</a><div className="bayterak-languages" role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} aria-pressed={item === language} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button ref={menuTriggerRef} className="bayterak-menu-trigger" type="button" aria-expanded={menuOpen} aria-controls="bayterak-menu" onClick={() => { restoreMenuFocus.current = true; setMenuOpen(true); }}><span>{t.menu}</span><i aria-hidden="true" /></button></div>
    </header>

    {menuOpen ? <nav id="bayterak-menu" ref={menuRef} className="bayterak-menu" role="dialog" aria-modal="true" aria-label={t.navigation}><header><a className="bayterak-mark" href={withLanguage('/bayterak', language)}><span>BAY</span><span>TERAK</span></a><button ref={menuCloseRef} type="button" onClick={() => { restoreMenuFocus.current = true; setMenuOpen(false); }} aria-label={t.closeMenu}>×</button></header><div>{t.nav.map(([id, label], index) => <a key={id} href={`#${id}`} onClick={(event) => goToAnchor(event, id)}><small>0{index + 1}</small>{label}</a>)}</div><footer><div role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} aria-pressed={item === language} onClick={() => { restoreMenuFocus.current = true; setMenuOpen(false); setLanguage(item); }}>{item.toUpperCase()}</button>)}</div><a href={withLanguage('/bayterak/apartments', language)}>{t.choose} ↗</a></footer></nav> : null}

    <main id="bayterak-content" tabIndex={-1}>
      <section className="bayterak-hero" aria-labelledby="bayterak-title">
        <div className="bayterak-hero__axis" aria-hidden="true"><span>00</span><i /></div>
        <div className="bayterak-hero__copy"><p>{t.heroOverline}</p><h1 id="bayterak-title"><span>BAY</span><span>TERAK</span></h1><strong>{t.heroText}</strong><div className="bayterak-hero__actions"><a className="bayterak-button is-solid" href={withLanguage('/bayterak/apartments', language)}>{t.choose}<span>↗</span></a><button className="bayterak-button" type="button" data-lead-trigger onClick={() => openLead('hero-consultation')}>{t.consult}<span>↗</span></button></div></div>
        <figure className="bayterak-hero__visual"><img src={asset('/bayterak/images/hero-comfort.webp')} alt={t.heroAlt} fetchPriority="high" decoding="async" /><figcaption>{t.visualisationNotice}</figcaption></figure>
        <dl className="bayterak-hero__facts">{t.heroFacts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
      </section>

      <section className="bayterak-roots bayterak-axis-section" id="roots" tabIndex={-1}><div className="bayterak-section-index" aria-hidden="true"><span>01</span><i /></div><div className="bayterak-roots__copy" data-bayterak-reveal><p className="bayterak-overline">{t.rootsIndex}</p><h2>{t.rootsTitle}</h2><p>{t.rootsText}</p></div><blockquote data-bayterak-reveal>{t.rootsQuote}</blockquote><ProjectFigure className="bayterak-roots__plan" src="/bayterak/images/masterplan.webp" alt={t.masterplanNotice} notice={t.masterplanNotice} /></section>

      <section className="bayterak-architecture bayterak-axis-section" id="architecture" tabIndex={-1}><div className="bayterak-section-index" aria-hidden="true"><span>02</span><i /></div><header data-bayterak-reveal><p className="bayterak-overline">{t.architectureIndex}</p><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p></header><div className="bayterak-architecture__body"><ProjectFigure className="bayterak-architecture__figure" src="/bayterak/images/business-gate.webp" alt={t.architectureAlt} notice={t.visualisationNotice} /><dl data-bayterak-reveal>{t.architectureDetails.map(([label, value], index) => <div key={label}><span>0{index + 1}</span><dt>{label}</dt><dd>{value}</dd></div>)}</dl></div></section>

      <section className="bayterak-courtyards bayterak-axis-section" id="courtyards" tabIndex={-1}><div className="bayterak-section-index" aria-hidden="true"><span>03</span><i /></div><header data-bayterak-reveal><p className="bayterak-overline">{t.courtyardsIndex}</p><h2>{t.courtyardsTitle}</h2><p>{t.courtyardsText}</p></header><div className="bayterak-courtyards__spread"><ProjectFigure src="/bayterak/images/courtyard-01.webp" alt={t.courtyardAlt} notice={t.visualisationNotice} /><ul data-bayterak-reveal>{t.courtyardFeatures.map((feature, index) => <li key={feature}><span>0{index + 1}</span>{feature}</li>)}</ul></div></section>

      <section className="bayterak-city" id="city" tabIndex={-1}><ProjectFigure src="/bayterak/images/new-tashkent.webp" alt={t.cityAlt} notice={t.futureNotice} /><div data-bayterak-reveal><p className="bayterak-overline">{t.cityIndex}</p><h2>{t.cityTitle}</h2><p>{t.cityText}</p><small>{t.cityNote}</small></div></section>

      <section className="bayterak-inside bayterak-axis-section" id="inside" tabIndex={-1}><div className="bayterak-section-index" aria-hidden="true"><span>05</span><i /></div><header data-bayterak-reveal><p className="bayterak-overline">{t.insideIndex}</p><h2>{t.insideTitle}</h2><p>{t.insideText}</p></header><InsideTabs language={language} /></section>

      <section className="bayterak-gallery-section" id="gallery" tabIndex={-1}><header data-bayterak-reveal><p className="bayterak-overline">{t.galleryIndex}</p><h2>{t.galleryTitle}</h2><p>{t.galleryText}</p></header><Gallery language={language} /></section>

      <section className="bayterak-catalog" data-bayterak-reveal><header><p className="bayterak-overline">{t.catalogIndex}</p><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header><div className="bayterak-catalog__stats">{t.catalogStats.map(([value, label]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div><footer><p>{t.catalogPrice}</p><a className="bayterak-button is-solid" href={withLanguage('/bayterak/apartments', language)}>{t.openCatalog}<span>↗</span></a></footer></section>

      <section className="bayterak-contact" data-bayterak-reveal><div><p className="bayterak-overline">{t.contactIndex}</p><h2>{t.contactTitle}</h2><p>{t.contactText}</p></div><div className="bayterak-contact__actions"><button className="bayterak-button is-solid" type="button" data-lead-trigger onClick={() => openLead('contact-consultation')}>{t.consult}<span>↗</span></button><a className="bayterak-button" href="tel:+998781137712">{t.phone}<span>↗</span></a></div></section>
    </main>

    <footer className="bayterak-footer"><a className="bayterak-mark" href={withLanguage('/bayterak', language)}><span>BAY</span><span>TERAK</span></a><p>{t.disclaimer}</p><nav aria-label={t.footerNavigation}><a href={panorama} target="_blank" rel="noreferrer">{t.panorama} ↗</a><a href={privacyUrl(language)}>{t.privacy}</a><a href="#bayterak-content" onClick={(event) => goToAnchor(event, 'bayterak-content')}>{t.top} ↑</a></nav></footer>

    {leadContext ? <div className="bayterak-lead-host" data-project-slug="bayterak" data-context={leadContext}><LeadModal open language={language} context={leadContext} brandName="NRG-BI" projectName="BAYTERAK" tagline={t.formTagline} facts={t.formFacts} submitUrl={bayterakLeadSubmitUrl()} projectSlug="bayterak" privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadContext(undefined)} /></div> : null}
  </div>;
}
