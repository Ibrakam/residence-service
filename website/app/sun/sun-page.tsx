'use client';

/* eslint-disable @next/next/no-img-element */

import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import snapshotJson from '@/data/sun-client.json';
import { LeadModal } from '@/app/lead-modal';
import { rememberSunUnit, sunLeadContext, sunLeadSubmitUrl, type SunUnit } from './sun-lead';
import {
  formatSunNumber,
  formatSunPrice,
  lockSunBody,
  sunAsset,
  sunLanguages,
  sunPath,
  type SunLanguage as Language,
  useSunLanguage,
} from './sun-ui';

type LeadRequest = { surface: string; unit: SunUnit | null; opener: HTMLElement | null };
type MediaKind = 'cgi' | 'construction' | 'mixed-video';
type MediaSlide = {
  src: string;
  width: number;
  height: number;
  kind: MediaKind;
  title: Record<Language, string>;
  caption: Record<Language, string>;
  date?: string;
};
type LightboxState = { slides: MediaSlide[]; index: number; opener: HTMLButtonElement };
type Snapshot = { capturedAt: string; units: SunUnit[] };

const snapshot = snapshotJson as Snapshot;

const mediaLabels: Record<MediaKind, Record<Language, string>> = {
  cgi: { ru: 'Архитектурная визуализация · концепция', uz: 'Arxitektura vizualizatsiyasi · konsepsiya', en: 'Architectural visualisation · concept' },
  construction: { ru: 'Официальное фото стройки · 15.08.2026', uz: 'Qurilishning rasmiy surati · 15.08.2026', en: 'Official construction photo · 15 Aug 2026' },
  'mixed-video': { ru: 'Официальный ролик · CGI и кадры стройки', uz: 'Rasmiy video · CGI va qurilish kadrlari', en: 'Official film · CGI and construction footage' },
};

const cgiSlides: MediaSlide[] = [
  {
    src: '/sun/images/overview.webp', width: 1920, height: 1080, kind: 'cgi',
    title: { ru: 'Пять корпусов в ритме дня', uz: 'Kun ritmidagi besh bino', en: 'Five buildings in the rhythm of a day' },
    caption: { ru: 'Официальная визуализация общего замысла SUN. Это концепция, не фотография завершённого комплекса.', uz: 'SUN umumiy g‘oyasining rasmiy vizualizatsiyasi. Bu konsepsiya, qurib bitkazilgan majmua fotosurati emas.', en: 'Official visualisation of the overall SUN concept. This is not a photograph of a completed project.' },
  },
  {
    src: '/sun/images/courtyard-01.webp', width: 1600, height: 1067, kind: 'cgi',
    title: { ru: 'Двор как общая гостиная', uz: 'Umumiy mehmonxona sifatidagi hovli', en: 'A courtyard conceived as a shared living room' },
    caption: { ru: 'Визуализированы двор, фонтан и детские площадки. Решения показаны как предусмотренные проектом.', uz: 'Hovli, favvora va bolalar maydonchalari vizualizatsiya qilingan. Yechimlar loyihada ko‘zda tutilgan tarzda ko‘rsatilgan.', en: 'The courtyard, fountain and children’s areas are visualised as planned project features.' },
  },
  {
    src: '/sun/images/lounge-01.webp', width: 1600, height: 1067, kind: 'cgi',
    title: { ru: 'Двухуровневый lounge', uz: 'Ikki darajali lounge', en: 'Two-level lounge' },
    caption: { ru: 'Официальная концептуальная визуализация пространства для общения и событий.', uz: 'Muloqot va tadbirlar maydonining rasmiy konseptual vizualizatsiyasi.', en: 'Official concept visualisation of a space for gathering and events.' },
  },
  {
    src: '/sun/images/roof-01.webp', width: 1600, height: 1067, kind: 'cgi',
    title: { ru: 'Эксплуатируемая кровля', uz: 'Foydalaniladigan tom', en: 'Accessible rooftop' },
    caption: { ru: 'В проекте визуализированы кровля с залом, пространства отдыха и обсерватория.', uz: 'Loyihada zal, dam olish joylari va observatoriyaga ega tom vizualizatsiya qilingan.', en: 'The concept visualises a rooftop gym, leisure spaces and an observatory.' },
  },
  {
    src: '/sun/images/lobby-01.webp', width: 1600, height: 1067, kind: 'cgi',
    title: { ru: 'Лобби', uz: 'Lobbi', en: 'Lobby' },
    caption: { ru: 'Официальная архитектурная визуализация интерьерной концепции.', uz: 'Interyer konsepsiyasining rasmiy arxitektura vizualizatsiyasi.', en: 'Official architectural visualisation of the interior concept.' },
  },
];

const constructionSlides: MediaSlide[] = [
  {
    src: '/sun/images/construction-a.webp', width: 1600, height: 1200, kind: 'construction', date: '15.08.2026',
    title: { ru: 'Корпус A', uz: 'A binosi', en: 'Building A' },
    caption: { ru: 'Официальное фото из последнего опубликованного апдейта девелопера.', uz: 'Developerning so‘nggi e’lon qilingan yangilanishidagi rasmiy surat.', en: 'Official photograph from the developer’s latest published update.' },
  },
  {
    src: '/sun/images/construction-v.webp', width: 1600, height: 1200, kind: 'construction', date: '15.08.2026',
    title: { ru: 'Корпус В', uz: 'V binosi', en: 'Building V' },
    caption: { ru: 'Официальное фото из последнего опубликованного апдейта девелопера.', uz: 'Developerning so‘nggi e’lon qilingan yangilanishidagi rasmiy surat.', en: 'Official photograph from the developer’s latest published update.' },
  },
  {
    src: '/sun/images/construction-d.webp', width: 1600, height: 1200, kind: 'construction', date: '15.08.2026',
    title: { ru: 'Корпус Д', uz: 'D binosi', en: 'Building D' },
    caption: { ru: 'Фасад на сайте назван завершённым, но ограждения и лобби ещё описаны как работы в процессе.', uz: 'Saytda fasad yakunlangan deb ko‘rsatilgan, ammo to‘siqlar va lobbi ishlari hali davom etayotgani yozilgan.', en: 'The site calls the facade complete, while balustrades and lobby work are still described as in progress.' },
  },
  {
    src: '/sun/images/construction-g.webp', width: 1600, height: 1200, kind: 'construction', date: '15.08.2026',
    title: { ru: 'Корпус Г', uz: 'G binosi', en: 'Building G' },
    caption: { ru: 'Фасадные работы, стеклянные ограждения и лобби описаны девелопером как завершаемые.', uz: 'Developer fasad, shisha to‘siqlar va lobbi ishlarini yakunlanayotgan deb ta’riflaydi.', en: 'The developer describes facade work, glass balustrades and the lobby as nearing completion.' },
  },
];

const copy = {
  ru: {
    skip: 'Перейти к содержанию', menu: 'Меню', close: 'Закрыть', language: 'Язык', navLabel: 'Навигация SUN',
    nav: [['story', 'Будущее / сейчас'], ['dayline', 'Пять корпусов'], ['amenities', 'Среда'], ['apartments', 'Квартиры'], ['location', 'Контакты']] as const,
    apartments: 'Выбрать квартиру', consult: 'Получить консультацию', play: 'Включить видео', pause: 'Поставить видео на паузу',
    heroEyebrow: 'HUMAN2HUMAN · ПЕРВЫЙ ПРОЕКТ', heroTitle: 'Жизнь следует линии дня.', heroText: 'Клубный жилой проект в Мирабадском районе: пять корпусов, общий двор и пространства, задуманные людьми для людей.',
    heroFacts: [['1 га', 'территория'], ['5', 'корпусов проекта'], ['361', 'квартира во всём проекте'], ['11–14', 'этажей']] as const,
    videoNotice: 'Официальный ролик сочетает архитектурную визуализацию и реальные кадры стройплощадки.',
    storyEyebrow: 'БУДУЩЕЕ ↔ СОСТОЯНИЕ СЕЙЧАС', storyTitle: 'Две честно подписанные стороны одного проекта.', storyText: 'CGI показывает архитектурный замысел. Фотографии от 15.08.2026 фиксируют последнее опубликованное состояние стройки. Мы не выдаём одно за другое и не заявляем сдачу.', future: 'Замысел', now: 'Состояние сейчас', openImage: 'Открыть изображение',
    updateTitle: 'Что сообщил девелопер 15.08.2026', updateItems: ['A: начаты отделочные работы в коридорах; фасадные работы продолжаются.', 'В: инженерные, потолочные и фасадные работы продолжаются.', 'Д: фасад назван завершённым; ограждения и лобби ещё в работе.', 'Г: фасад, ограждения и лобби описаны как завершаемые.', 'По Б свежего прогресса в этом апдейте нет.'],
    evidenceLead: 'Запросить актуальную информацию',
    dayEyebrow: '06:00 — 12:00 — 18:00', dayTitle: 'Пять корпусов на одной шкале.', dayText: 'Слева — опубликованный график. Справа — последнее сообщение девелопера. Для Г и Д июньские даты графика уже прошли, тогда как августовский апдейт всё ещё описывает работы. Поэтому здесь нет слов «сдан» или «готов».',
    schedule: 'Опубликованный график', latest: 'Последнее сообщение', noCatalog: 'Нет в публичном live-каталоге', catalogPresent: 'Есть в публичном live-каталоге',
    blocks: [
      ['A', 'Октябрь 2026', 'Коридоры и фасадные работы продолжаются.'],
      ['Б', 'Октябрь 2027', 'Свежего прогресса в апдейте 15.08.2026 нет.'],
      ['В', 'Февраль 2027', 'Инженерные, потолочные и фасадные работы продолжаются.'],
      ['Г', 'Июнь 2026', 'Работы ещё описаны как завершаемые — график и апдейт расходятся.'],
      ['Д', 'Июнь 2026', 'Фасад назван завершённым, другие работы продолжаются — график и апдейт расходятся.'],
    ] as const,
    dayLead: 'Уточнить текущий статус',
    amenityEyebrow: 'ПРЕДУСМОТРЕНО / ВИЗУАЛИЗИРОВАНО', amenityTitle: 'Пространства для длинного дня.', amenityText: 'Двор и детские площадки, фонтан, подземный паркинг, эксплуатируемые кровли, lounge, арт-студия, event/cinema, спортивная площадка и детские пространства показаны как проектная концепция, а не готовые объекты.',
    gallery: 'Галерея концепции', amenityLead: 'Обсудить проект',
    catalogEyebrow: 'СНИМОК ПУБЛИЧНОГО КАТАЛОГА', catalogTitle: 'Солнечный инструмент выбора.', catalogText: '51 доступная позиция в четырёх корпусах публичного каталога. Это отдельный срез 306 записей и не то же самое, что 361 квартира во всём проекте.',
    free: 'доступна', rooms: 'комн.', area: 'площадь', floor: 'этаж', block: 'корпус', price: 'Текущая цена', unit: 'Квартира №', askUnit: 'Оставить заявку', allApartments: 'Открыть все 51 квартиру',
    catalogFacts: [['51', 'доступная'], ['18 / 31 / 2', '1 / 2 / 3 комнаты'], ['34,61–83,90 м²', 'диапазон площади'], ['4 из 5', 'корпусов в live-каталоге']] as const,
    catalogNote: 'Корпус Б отсутствует в текущем публичном каталоге. Мы не создаём для него фиктивные позиции.',
    locationEyebrow: 'МИРАБАД · ТАШКЕНТ', locationTitle: 'Официальный адрес без лишней точности.', addressLabel: 'Адрес проекта', address: 'Ташкент, Мирабадский район, ул. Сайхун 56/2', map: 'Точка по ссылке девелопера', mapNote: 'Текстовый адрес и объект в картографической ссылке могут отображаться по-разному; используйте ссылку как опубликованный девелопером ориентир.',
    contacts: 'Контакты', hours: 'Ежедневно, 09:00–20:00', locationLead: 'Назначить встречу',
    contactEyebrow: 'ДАЛЬШЕ — РАЗГОВОР', contactTitle: 'Подберём квартиру под ваш ритм.', contactText: 'Менеджер уточнит текущую доступность и ответит на вопросы. Заявка не является бронированием.',
    privacy: 'Обработка персональных данных', top: 'Наверх', disclaimer: 'Данные каталога — зафиксированный публичный срез. Проектные изображения — визуализации. Статусы строительства основаны на публикации девелопера от 15.08.2026.',
    lightbox: 'Просмотр официальных материалов', previous: 'Предыдущее изображение', next: 'Следующее изображение', imageOf: 'Изображение',
    formTagline: 'День начинается дома.', formFacts: ['Клубный формат', '5 корпусов', '51 доступная квартира'] as const,
  },
  uz: {
    skip: 'Asosiy mazmunga o‘tish', menu: 'Menyu', close: 'Yopish', language: 'Til', navLabel: 'SUN navigatsiyasi',
    nav: [['story', 'Kelajak / bugun'], ['dayline', 'Besh bino'], ['amenities', 'Muhit'], ['apartments', 'Xonadonlar'], ['location', 'Kontaktlar']] as const,
    apartments: 'Xonadon tanlash', consult: 'Maslahat olish', play: 'Videoni yoqish', pause: 'Videoni pauza qilish',
    heroEyebrow: 'HUMAN2HUMAN · BIRINCHI LOYIHA', heroTitle: 'Hayot kun chizig‘i bo‘ylab kechadi.', heroText: 'Mirobod tumanidagi klub formatidagi turar joy loyihasi: besh bino, umumiy hovli va odamlar tomonidan odamlar uchun o‘ylangan makonlar.',
    heroFacts: [['1 ga', 'hudud'], ['5', 'loyiha binolari'], ['361', 'butun loyihadagi xonadon'], ['11–14', 'qavat']] as const,
    videoNotice: 'Rasmiy video arxitektura vizualizatsiyasi va haqiqiy qurilish maydoni kadrlarini birlashtiradi.',
    storyEyebrow: 'KELAJAK ↔ BUGUNGI HOLAT', storyTitle: 'Bitta loyihaning aniq belgilangan ikki tomoni.', storyText: 'CGI arxitektura g‘oyasini ko‘rsatadi. 15.08.2026 sanasidagi suratlar qurilishning so‘nggi e’lon qilingan holatini qayd etadi. Biz ularni aralashtirmaymiz va topshirilgan deb da’vo qilmaymiz.', future: 'G‘oya', now: 'Bugungi holat', openImage: 'Tasvirni ochish',
    updateTitle: 'Developer 15.08.2026 kuni nima ma’lum qildi', updateItems: ['A: koridor pardozlash ishlari boshlandi; fasad ishlari davom etmoqda.', 'V: muhandislik, shift va fasad ishlari davom etmoqda.', 'D: fasad yakunlangan deb ko‘rsatilgan; to‘siqlar va lobbi hali jarayonda.', 'G: fasad, to‘siqlar va lobbi ishlari yakunlanayotgan deb ta’riflangan.', 'B bo‘yicha bu yangilanishda yangi ma’lumot yo‘q.'],
    evidenceLead: 'Dolzarb ma’lumotni so‘rash',
    dayEyebrow: '06:00 — 12:00 — 18:00', dayTitle: 'Besh bino bitta shkalada.', dayText: 'Chapda e’lon qilingan jadval, o‘ngda developerning so‘nggi xabari. G va D uchun iyun sanalari o‘tgan, avgust yangilanishida esa ishlar hali davom etayotgani yozilgan. Shu sababli bu yerda “topshirildi” yoki “tayyor” deyilmaydi.',
    schedule: 'E’lon qilingan jadval', latest: 'So‘nggi xabar', noCatalog: 'Ommaviy live-katalogda yo‘q', catalogPresent: 'Ommaviy live-katalogda bor',
    blocks: [['A', '2026-yil oktabr', 'Koridor va fasad ishlari davom etmoqda.'], ['B', '2027-yil oktabr', '15.08.2026 yangilanishida yangi ma’lumot yo‘q.'], ['V', '2027-yil fevral', 'Muhandislik, shift va fasad ishlari davom etmoqda.'], ['G', '2026-yil iyun', 'Ishlar hali yakunlanayotgan deb ta’riflangan — jadval va yangilanish mos emas.'], ['D', '2026-yil iyun', 'Fasad yakunlangan, boshqa ishlar davom etmoqda — jadval va yangilanish mos emas.']] as const,
    dayLead: 'Joriy holatni aniqlash',
    amenityEyebrow: 'KO‘ZDA TUTILGAN / VIZUALIZATSIYA', amenityTitle: 'Uzun kun uchun makonlar.', amenityText: 'Hovli, bolalar maydonchalari, favvora, yerosti parkingi, foydalaniladigan tomlar, lounge, art-studiya, event/cinema, sport va bolalar makonlari tayyor obyektlar emas, loyiha konsepsiyasi sifatida ko‘rsatilgan.',
    gallery: 'Konsepsiya galereyasi', amenityLead: 'Loyihani muhokama qilish',
    catalogEyebrow: 'OMMAVIY KATALOG KESIMI', catalogTitle: 'Quyoshli tanlov vositasi.', catalogText: 'Ommaviy katalogning to‘rt binosida 51 ta mavjud pozitsiya. Bu 306 ta yozuvdan iborat alohida kesim bo‘lib, butun loyihadagi 361 xonadon bilan bir xil ko‘rsatkich emas.',
    free: 'mavjud', rooms: 'xona', area: 'maydon', floor: 'qavat', block: 'bino', price: 'Joriy narx', unit: 'Xonadon №', askUnit: 'Ariza qoldirish', allApartments: 'Barcha 51 xonadonni ochish',
    catalogFacts: [['51', 'mavjud'], ['18 / 31 / 2', '1 / 2 / 3 xona'], ['34,61–83,90 m²', 'maydon oralig‘i'], ['5 tadan 4', 'live-katalogdagi bino']] as const,
    catalogNote: 'B binosi joriy ommaviy katalogda yo‘q. Biz unga sun’iy pozitsiyalar yaratmaymiz.',
    locationEyebrow: 'MIROBOD · TOSHKENT', locationTitle: 'Ortiqcha aniqliksiz rasmiy manzil.', addressLabel: 'Loyiha manzili', address: 'Toshkent, Mirobod tumani, Sayxun ko‘chasi 56/2', map: 'Developer havolasidagi nuqta', mapNote: 'Matnli manzil va xarita havolasidagi obyekt turlicha ko‘rinishi mumkin; havoladan developer e’lon qilgan mo‘ljal sifatida foydalaning.',
    contacts: 'Kontaktlar', hours: 'Har kuni, 09:00–20:00', locationLead: 'Uchrashuv belgilash',
    contactEyebrow: 'KEYINGI QADAM — SUHBAT', contactTitle: 'Ritmingizga mos xonadon tanlaymiz.', contactText: 'Menejer joriy mavjudlikni aniqlaydi va savollarga javob beradi. Ariza bron hisoblanmaydi.',
    privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga', disclaimer: 'Katalog ma’lumotlari — qayd etilgan ommaviy kesim. Loyiha tasvirlari — vizualizatsiya. Qurilish holati developerning 15.08.2026 e’loniga asoslangan.',
    lightbox: 'Rasmiy materiallarni ko‘rish', previous: 'Oldingi tasvir', next: 'Keyingi tasvir', imageOf: 'Tasvir',
    formTagline: 'Kun uydan boshlanadi.', formFacts: ['Klub formati', '5 bino', '51 ta mavjud xonadon'] as const,
  },
  en: {
    skip: 'Skip to content', menu: 'Menu', close: 'Close', language: 'Language', navLabel: 'SUN navigation',
    nav: [['story', 'Future / now'], ['dayline', 'Five buildings'], ['amenities', 'Shared spaces'], ['apartments', 'Apartments'], ['location', 'Contact']] as const,
    apartments: 'Choose an apartment', consult: 'Request a consultation', play: 'Play video', pause: 'Pause video',
    heroEyebrow: 'HUMAN2HUMAN · FIRST PROJECT', heroTitle: 'Life follows the line of day.', heroText: 'A club-format residential project in Mirabad: five buildings, a shared courtyard and spaces conceived by people, for people.',
    heroFacts: [['1 ha', 'site'], ['5', 'project buildings'], ['361', 'apartments in the full project'], ['11–14', 'floors']] as const,
    videoNotice: 'The official film combines architectural visualisation with actual construction-site footage.',
    storyEyebrow: 'FUTURE ↔ CURRENT STATE', storyTitle: 'Two clearly labelled sides of one project.', storyText: 'CGI presents the architectural intent. Photographs dated 15 August 2026 record the latest published construction state. We do not pass one off as the other or claim completion.', future: 'The concept', now: 'Current state', openImage: 'Open image',
    updateTitle: 'What the developer reported on 15 August 2026', updateItems: ['A: corridor finishing has started; facade work continues.', 'V: engineering, ceiling and facade work continues.', 'D: the facade is called complete; balustrades and lobby remain in progress.', 'G: facade, balustrades and lobby are described as nearing completion.', 'No fresh progress for B appears in this update.'],
    evidenceLead: 'Request a current update',
    dayEyebrow: '06:00 — 12:00 — 18:00', dayTitle: 'Five buildings on one timeline.', dayText: 'The published schedule sits beside the latest developer update. June dates for G and D have passed, while the August update still describes work in progress. We therefore do not say “completed” or “ready”.',
    schedule: 'Published schedule', latest: 'Latest report', noCatalog: 'Absent from the public live catalogue', catalogPresent: 'Present in the public live catalogue',
    blocks: [['A', 'October 2026', 'Corridor and facade work continues.'], ['B', 'October 2027', 'No fresh progress in the 15 August 2026 update.'], ['V', 'February 2027', 'Engineering, ceiling and facade work continues.'], ['G', 'June 2026', 'Work is still described as nearing completion — schedule and update diverge.'], ['D', 'June 2026', 'Facade called complete, other work continues — schedule and update diverge.']] as const,
    dayLead: 'Check the current status',
    amenityEyebrow: 'PLANNED / VISUALISED', amenityTitle: 'Spaces for a full day.', amenityText: 'The courtyard, children’s areas, fountain, underground parking, accessible rooftops, lounge, art studio, event/cinema, sports court and children’s spaces are shown as planned concepts, not completed facilities.',
    gallery: 'Concept gallery', amenityLead: 'Discuss the project',
    catalogEyebrow: 'PUBLIC CATALOGUE SNAPSHOT', catalogTitle: 'A sunlit selection tool.', catalogText: '51 available listings across four buildings in the public catalogue. This is a separate 306-record snapshot and is not the same figure as the full project’s 361 apartments.',
    free: 'available', rooms: 'rooms', area: 'area', floor: 'floor', block: 'building', price: 'Current price', unit: 'Apartment no. ', askUnit: 'Send a request', allApartments: 'Open all 51 apartments',
    catalogFacts: [['51', 'available'], ['18 / 31 / 2', '1 / 2 / 3 rooms'], ['34.61–83.90 m²', 'area range'], ['4 of 5', 'buildings in live catalogue']] as const,
    catalogNote: 'Building B is absent from the current public catalogue. We do not invent listings for it.',
    locationEyebrow: 'MIRABAD · TASHKENT', locationTitle: 'The official address, without invented precision.', addressLabel: 'Project address', address: '56/2 Saykhun Street, Mirabad District, Tashkent', map: 'Point in the developer’s link', mapNote: 'The written address and the object shown by the mapping link may differ; use the link only as the reference published by the developer.',
    contacts: 'Contact', hours: 'Daily, 09:00–20:00', locationLead: 'Arrange a visit',
    contactEyebrow: 'NEXT — A CONVERSATION', contactTitle: 'We will find an apartment for your rhythm.', contactText: 'A manager will confirm current availability and answer your questions. A request is not a reservation.',
    privacy: 'Personal data processing', top: 'Back to top', disclaimer: 'Catalogue data is a frozen public snapshot. Project imagery is visualisation. Construction status follows the developer’s publication dated 15 August 2026.',
    lightbox: 'View official materials', previous: 'Previous image', next: 'Next image', imageOf: 'Image',
    formTagline: 'The day begins at home.', formFacts: ['Club format', '5 buildings', '51 available apartments'] as const,
  },
} as const;

function MediaLightbox({ state, language, covered, onClose, onChange, onLead }: { state: LightboxState; language: Language; covered: boolean; onClose: () => void; onChange: (index: number) => void; onLead: (opener: HTMLButtonElement) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const t = copy[language];
  const slide = state.slides[state.index];
  const go = useCallback((direction: number) => onChange((state.index + direction + state.slides.length) % state.slides.length), [onChange, state.index, state.slides.length]);

  useEffect(() => {
    const unlock = lockSunBody();
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal') || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame); window.removeEventListener('keydown', onKey); unlock();
      window.requestAnimationFrame(() => state.opener.isConnected && state.opener.focus({ preventScroll: true }));
    };
  }, [go, onClose, state.opener]);

  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointer.current; pointer.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  return <div className="sun-lightbox" role="dialog" aria-modal="true" aria-label={t.lightbox} aria-hidden={covered || undefined} inert={covered ? true : undefined}>
    <button className="sun-lightbox__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.close} />
    <div ref={dialogRef} className="sun-lightbox__dialog">
      <header><div><span>{mediaLabels[slide.kind][language]}</span><strong>{state.index + 1} / {state.slides.length}</strong></div><button ref={closeRef} type="button" onClick={onClose} aria-label={t.close}>×</button></header>
      <div className="sun-lightbox__stage" onPointerDown={(event) => { pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }} onPointerUp={pointerUp} onPointerCancel={() => { pointer.current = null; }}>
        <img src={sunAsset(slide.src)} width={slide.width} height={slide.height} alt={slide.caption[language]} draggable={false} />
        <span>{mediaLabels[slide.kind][language]}</span>
      </div>
      <footer><div><small>{slide.date || 'HUMAN2HUMAN · SUN'}</small><h2>{slide.title[language]}</h2><p>{slide.caption[language]}</p></div><nav aria-label={`${t.imageOf} ${state.slides.length}`}><button type="button" onClick={() => go(-1)} aria-label={t.previous}>←</button><button type="button" onClick={() => go(1)} aria-label={t.next}>→</button><button type="button" data-lead-trigger onClick={(event) => onLead(event.currentTarget)}>{t.consult} ↗</button></nav></footer>
    </div>
  </div>;
}

export function SunPage({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useSunLanguage(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lead, setLead] = useState<LeadRequest | null>(null);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  const units = snapshot.units;
  const previewUnits = useMemo(() => [units[0], units[12], units[28], units[44]].filter(Boolean), [units]);
  const minPrice = Math.min(...units.map((unit) => Number(unit.effectivePrice ?? unit.price)));
  const maxPrice = Math.max(...units.map((unit) => Number(unit.effectivePrice ?? unit.price)));
  const closeLead = useCallback(() => setLead(null), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const changeLightbox = useCallback((index: number) => setLightbox((current) => current ? { ...current, index } : current), []);
  const openLead = useCallback((surface: string, unit: SunUnit | null = null, opener: HTMLElement | null = document.activeElement as HTMLElement | null) => {
    if (unit) rememberSunUnit(unit);
    setLead({ surface, unit, opener });
  }, []);
  const openLightbox = useCallback((slides: MediaSlide[], index: number, opener: HTMLButtonElement) => setLightbox({ slides, index, opener }), []);

  useEffect(() => {
    document.body.classList.add('sun-active');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => {
      setReducedMotion(motion.matches);
      if (motion.matches) { videoRef.current?.pause(); setVideoPlaying(false); }
    };
    updateMotion(); motion.addEventListener('change', updateMotion);
    const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-revealed', 'true'); reveal.unobserve(entry.target); }
    }), { threshold: 0.1 });
    document.querySelectorAll('.sun-site [data-reveal]').forEach((node) => reveal.observe(node));
    return () => { document.body.classList.remove('sun-active'); motion.removeEventListener('change', updateMotion); reveal.disconnect(); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const unlock = lockSunBody();
    const opener = menuButtonRef.current;
    window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus({ preventScroll: true }));
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal') || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!menuRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlock(); if (!document.querySelector('.lead-modal')) window.requestAnimationFrame(() => opener?.focus({ preventScroll: true })); };
  }, [menuOpen]);

  const toggleVideo = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) { await video.play(); setVideoPlaying(true); }
    else { video.pause(); setVideoPlaying(false); }
  };

  const rootCovered = menuOpen || Boolean(lightbox);

  return <div className="sun-site" lang={language}>
    <a className="sun-skip" href="#sun-main" aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}>{t.skip}</a>
    <header className="sun-header" aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}>
      <a className="sun-brand" href="#top" aria-label="SUN"><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /></a>
      <nav aria-label={t.navLabel}>{t.nav.slice(0, 3).map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="sun-languages" aria-label={t.language}>{sunLanguages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div>
      <a className="sun-header__catalog" href={sunPath('/sun/apartments', language)}>{t.apartments}</a>
      <button className="sun-header__lead" type="button" data-lead-trigger onClick={(event) => openLead('landing:header', null, event.currentTarget)}>{t.consult}</button>
      <button ref={menuButtonRef} className="sun-menu-button" type="button" aria-expanded={menuOpen} aria-controls="sun-menu" onClick={() => setMenuOpen(true)}><span>{t.menu}</span><i /><i /></button>
    </header>

    <div className={`sun-menu ${menuOpen ? 'is-open' : ''}`} role="dialog" aria-modal={menuOpen && !lead ? true : undefined} aria-label={t.navLabel} aria-hidden={!menuOpen || Boolean(lead)} inert={!menuOpen || Boolean(lead) ? true : undefined}>
      <button className="sun-menu__backdrop" type="button" tabIndex={-1} onClick={() => setMenuOpen(false)} aria-label={t.close} />
      <nav ref={menuRef} id="sun-menu">
        <header><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /><button type="button" onClick={() => setMenuOpen(false)} aria-label={t.close}>×</button></header>
        <div className="sun-menu__links">{t.nav.map(([id, label], index) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}><span>{String(index + 1).padStart(2, '0')}</span>{label}</a>)}</div>
        <footer><div aria-label={t.language}>{sunLanguages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button type="button" data-lead-trigger onClick={(event) => openLead('landing:menu', null, event.currentTarget)}>{t.consult}<span>↗</span></button></footer>
      </nav>
    </div>

    <main id="sun-main" aria-hidden={rootCovered || undefined} inert={rootCovered ? true : undefined}>
      <section id="top" className="sun-hero" aria-labelledby="sun-hero-title">
        <picture className="sun-hero__poster"><img src={sunAsset('/sun/images/overview.webp')} width="1920" height="1080" alt="" fetchPriority="high" /></picture>
        <video ref={videoRef} className="sun-hero__video" autoPlay={!reducedMotion} muted loop playsInline preload="metadata" poster={sunAsset('/sun/images/overview.webp')} onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)}>
          <source media="(max-width: 700px)" src={sunAsset('/sun/video/hero-mobile.mp4')} type="video/mp4" />
          <source src={sunAsset('/sun/video/hero-desktop.mp4')} type="video/mp4" />
        </video>
        <div className="sun-hero__shade" />
        <div className="sun-hero__copy"><span>{t.heroEyebrow}</span><h1 id="sun-hero-title">{t.heroTitle}</h1><p>{t.heroText}</p><div><a href={sunPath('/sun/apartments', language)}>{t.apartments}<b>↗</b></a><button type="button" data-lead-trigger onClick={(event) => openLead('landing:hero', null, event.currentTarget)}>{t.consult}</button></div></div>
        <div className="sun-hero__dayline" aria-hidden="true"><span>06:00</span><i /><b>12:00</b><i /><span>18:00</span></div>
        <dl className="sun-hero__facts">{t.heroFacts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
        <div className="sun-hero__media"><span>{mediaLabels['mixed-video'][language]}</span><button type="button" onClick={toggleVideo} aria-label={videoPlaying ? t.pause : t.play}>{videoPlaying ? 'Ⅱ' : '▶'}</button></div>
        <p className="sun-hero__notice">{t.videoNotice}</p>
      </section>

      <section id="story" className="sun-section sun-story">
        <header className="sun-section__header" data-reveal><span>{t.storyEyebrow}</span><h2>{t.storyTitle}</h2><p>{t.storyText}</p></header>
        <div className="sun-story__split">
          <article data-reveal><button type="button" onClick={(event) => openLightbox(cgiSlides, 0, event.currentTarget)} aria-label={`${t.openImage}: ${cgiSlides[0].title[language]}`}><img src={sunAsset(cgiSlides[0].src)} width={cgiSlides[0].width} height={cgiSlides[0].height} loading="lazy" alt={cgiSlides[0].caption[language]} /><span>{mediaLabels.cgi[language]}</span></button><div><small>01 · {t.future}</small><h3>{cgiSlides[0].title[language]}</h3><p>{cgiSlides[0].caption[language]}</p></div></article>
          <article data-reveal><button type="button" onClick={(event) => openLightbox(constructionSlides, 0, event.currentTarget)} aria-label={`${t.openImage}: ${constructionSlides[0].title[language]}`}><img src={sunAsset(constructionSlides[0].src)} width={constructionSlides[0].width} height={constructionSlides[0].height} loading="lazy" alt={constructionSlides[0].caption[language]} /><span>{mediaLabels.construction[language]}</span></button><div><small>02 · {t.now}</small><h3>15.08.2026</h3><p>{constructionSlides[0].caption[language]}</p></div></article>
        </div>
        <aside className="sun-update" data-reveal><div><span>15 · 08 · 2026</span><h3>{t.updateTitle}</h3></div><ol>{t.updateItems.map((item) => <li key={item}>{item}</li>)}</ol><button type="button" data-lead-trigger onClick={(event) => openLead('landing:evidence', null, event.currentTarget)}>{t.evidenceLead}<b>↗</b></button></aside>
      </section>

      <section id="dayline" className="sun-section sun-dayline">
        <header className="sun-section__header sun-section__header--dark" data-reveal><span>{t.dayEyebrow}</span><h2>{t.dayTitle}</h2><p>{t.dayText}</p></header>
        <div className="sun-dayline__clock" aria-hidden="true"><span>06:00</span><i /><span>12:00</span><i /><span>18:00</span></div>
        <div className="sun-dayline__blocks">{t.blocks.map(([block, schedule, latest], index) => <article key={block} className={index >= 3 ? 'has-conflict' : ''} data-reveal>
          <header><span>{String(index + 1).padStart(2, '0')}</span><strong>{block}</strong></header><dl><div><dt>{t.schedule}</dt><dd>{schedule}</dd></div><div><dt>{t.latest}</dt><dd>{latest}</dd></div></dl><p>{block === 'Б' || block === 'B' ? t.noCatalog : t.catalogPresent}</p>
        </article>)}</div>
        <button className="sun-dayline__lead" type="button" data-lead-trigger onClick={(event) => openLead('landing:dayline', null, event.currentTarget)}>{t.dayLead}<span>↗</span></button>
      </section>

      <section id="amenities" className="sun-section sun-amenities">
        <header className="sun-section__header" data-reveal><span>{t.amenityEyebrow}</span><h2>{t.amenityTitle}</h2><p>{t.amenityText}</p></header>
        <div className="sun-gallery" aria-label={t.gallery}>{cgiSlides.slice(1).map((slide, index) => <button type="button" key={slide.src} data-reveal onClick={(event) => openLightbox(cgiSlides.slice(1), index, event.currentTarget)} aria-label={`${t.openImage}: ${slide.title[language]}`}><img src={sunAsset(slide.src)} width={slide.width} height={slide.height} loading="lazy" alt={slide.caption[language]} /><span><small>{String(index + 1).padStart(2, '0')} · {mediaLabels.cgi[language]}</small><strong>{slide.title[language]}</strong><i>↗</i></span></button>)}</div>
        <button className="sun-section__lead" type="button" data-lead-trigger onClick={(event) => openLead('landing:amenities', null, event.currentTarget)}>{t.amenityLead}<span>↗</span></button>
      </section>

      <section id="apartments" className="sun-section sun-inventory">
        <header className="sun-section__header sun-section__header--dark" data-reveal><span>{t.catalogEyebrow}</span><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header>
        <dl className="sun-inventory__facts">{t.catalogFacts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
        <div className="sun-inventory__range"><span>MIN</span><strong>{formatSunPrice(minPrice, language)}</strong><i /><span>MAX</span><strong>{formatSunPrice(maxPrice, language)}</strong></div>
        <div className="sun-inventory__cards">{previewUnits.map((unit) => <article key={unit.id} data-reveal>
          <div className="sun-inventory__plan"><img src={sunAsset(unit.secondPlanPath || unit.primaryPlanPath)} width={unit.planWidth || 1772} height={unit.planHeight || 1772} loading="lazy" alt={`${t.unit}${unit.number}`} /></div>
          <header><span>{t.block} {unit.block ?? unit.blockName}</span><strong>{t.unit}{unit.number}</strong><em>{t.free}</em></header>
          <dl><div><dt>{t.rooms}</dt><dd>{unit.rooms}</dd></div><div><dt>{t.area}</dt><dd>{formatSunNumber(unit.area, language)} м²</dd></div><div><dt>{t.floor}</dt><dd>{unit.floor} / {unit.maxFloor}</dd></div></dl>
          <p><span>{t.price}</span><strong>{formatSunPrice(Number(unit.effectivePrice ?? unit.price), language)}</strong></p>
          <button type="button" data-lead-trigger onClick={(event) => openLead('landing:catalog-preview', unit, event.currentTarget)}>{t.askUnit}<span>↗</span></button>
        </article>)}</div>
        <p className="sun-inventory__note">{t.catalogNote}</p><a className="sun-inventory__cta" href={sunPath('/sun/apartments', language)}>{t.allApartments}<span>↗</span></a>
      </section>

      <section id="location" className="sun-section sun-location">
        <header className="sun-section__header" data-reveal><span>{t.locationEyebrow}</span><h2>{t.locationTitle}</h2></header>
        <div className="sun-location__grid"><article data-reveal><span>01 · {t.addressLabel}</span><h3>{t.address}</h3><p>{t.mapNote}</p><a href="https://yandex.uz/maps/?ll=69.301919%2C41.282957&z=16" target="_blank" rel="noopener noreferrer">{t.map}<b>↗</b></a></article><article data-reveal><span>02 · {t.contacts}</span><a className="sun-location__phone" href="tel:+998781137712">+998 78 113 77 12</a><a href="mailto:info@h2h.uz">info@h2h.uz</a><p>{t.hours}</p></article></div>
        <button className="sun-section__lead" type="button" data-lead-trigger onClick={(event) => openLead('landing:location', null, event.currentTarget)}>{t.locationLead}<span>↗</span></button>
      </section>

      <section className="sun-contact">
        <div data-reveal><span>{t.contactEyebrow}</span><h2>{t.contactTitle}</h2><p>{t.contactText}</p><button type="button" data-lead-trigger onClick={(event) => openLead('landing:footer', null, event.currentTarget)}>{t.consult}<b>↗</b></button></div>
        <a className="sun-contact__phone" href="tel:+998781137712">+998 78 113 77 12 <span>↗</span></a>
        <footer><div><img src={sunAsset('/sun/logo.svg')} width="380" height="64" alt="SUN" /><img src={sunAsset('/sun/h2h-logo.svg')} width="217" height="42" alt="Human2Human" /></div><p>{t.disclaimer}</p><nav><a href={`${sunAsset('/privacy')}?project=sun&lang=${language}&from=landing`}>{t.privacy}</a><a href="#top">{t.top}</a></nav></footer>
      </section>
    </main>

    {lightbox ? <MediaLightbox state={lightbox} language={language} covered={Boolean(lead)} onClose={closeLightbox} onChange={changeLightbox} onLead={(opener) => openLead(lightbox.slides[0].kind === 'construction' ? 'landing:evidence' : 'landing:amenities', null, opener)} /> : null}
    {lead ? <LeadModal open language={language} context={sunLeadContext(lead.surface, language, lead.unit)} hideBrand projectName="SUN" tagline={t.formTagline} facts={t.formFacts} submitUrl={sunLeadSubmitUrl()} projectSlug="sun" unitKey={lead.unit?.unitKey} privacyUrl={`${sunAsset('/privacy')}?project=sun&lang=${language}&from=landing`} requireConsent returnFocusTo={lead.opener} onClose={closeLead} /> : null}
  </div>;
}
