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
import { zamonLeadSubmitUrl } from './zamon-lead';

type Language = 'ru' | 'uz' | 'en';
type Layer = 'realized' | 'concept' | 'construction';
type IntroPhase = 'visible' | 'leaving' | 'hidden';
type Slide = { src: string; type: 'actual-photo' | 'official-cgi' | 'construction-photo'; date?: string };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const languages: Language[] = ['ru', 'uz', 'en'];
const storageKey = 'zamon-language';
const introKey = 'zamon-intro-seen-v1';
const officialLandingRu = 'https://nrg-bi.uz/uz-ru/landing/zamon';
const officialLandingUz = 'https://nrg-bi.uz/uz/landing/zamon';
const officialBooklet = '/zamon/documents/zamon-booklet-2026-03.pdf';
const panorama = 'https://uzbekistan360.uz/ru/location/nrg-zamon-vid-s-ptichego-poljotappC';

const media: Record<Layer, Slide[]> = {
  realized: [
    { src: '/zamon/images/realized-02.webp', type: 'actual-photo' },
    { src: '/zamon/images/realized-03.webp', type: 'actual-photo' },
    { src: '/zamon/images/realized-04.webp', type: 'actual-photo' },
    { src: '/zamon/images/realized-05.webp', type: 'actual-photo' },
    { src: '/zamon/images/realized-06.webp', type: 'actual-photo' },
    { src: '/zamon/images/lobby-01.webp', type: 'actual-photo' },
  ],
  concept: [
    { src: '/zamon/images/concept-01.webp', type: 'official-cgi' },
    { src: '/zamon/images/concept-02.webp', type: 'official-cgi' },
    { src: '/zamon/images/concept-03.webp', type: 'official-cgi' },
    { src: '/zamon/images/concept-04.webp', type: 'official-cgi' },
    { src: '/zamon/images/concept-05.webp', type: 'official-cgi' },
  ],
  construction: [
    { src: '/zamon/images/construction-2026-07-04.webp', type: 'construction-photo', date: '07.2026' },
    { src: '/zamon/images/construction-2026-07-05.webp', type: 'construction-photo', date: '07.2026' },
  ],
};

const archiveSlides: Slide[] = [
  { src: '/zamon/images/construction-2026-07-01.webp', type: 'construction-photo', date: '07.2026' },
  { src: '/zamon/images/construction-2026-07-02.webp', type: 'construction-photo', date: '07.2026' },
  { src: '/zamon/images/construction-2026-07-03.webp', type: 'construction-photo', date: '07.2026' },
];

const copy = {
  ru: {
    skip: 'К содержанию', navigation: 'Навигация Zamon', footerNavigation: 'Источники и юридическая информация', menu: 'Меню', closeMenu: 'Закрыть меню', language: 'Язык',
    nav: [['time', 'Время'], ['realized', 'Реализовано'], ['media', 'Медиатека'], ['landscape', 'Двор'], ['catalog', 'Квартиры'], ['contacts', 'Контакты']] as const,
    choose: 'Выбрать квартиру', consult: 'Оставить заявку', phone: 'Позвонить 1360',
    heroOverline: 'ТАШКЕНТ · COMFORT CLASS · 4 ОЧЕРЕДИ', heroTitle: 'Zamon', heroText: 'Дом в нескольких временных слоях: сданная I очередь, актуальная подборка квартир и будущая архитектурная концепция.',
    heroAlt: 'Реальная фотография сданной I очереди Zamon', actualPhoto: 'Реальная фотография сданной I очереди',
    phaseCards: [
      { index: '02', title: 'NRG Zamon 2-2', rows: '42 позиции в каталоге', deadline: 'Срок · 14 ноября 2026' },
      { index: '03', title: 'NRG Zamon 3-1', rows: '62 позиции в каталоге', deadline: 'Срок · 25 декабря 2027' },
    ],
    phaseCardNote: 'Каталог зафиксирован 30 августа 2026; актуальность каждой квартиры подтверждает отдел продаж.',
    facts: [['Comfort', 'класс'], ['4', 'очереди'], ['8 / 9 / 12', 'этажей'], ['≥ 30%', 'озеленения'], ['1', 'собственный пруд']] as const,
    timeIndex: '01 · ХРОНОЛОГИЯ', timeTitle: 'Четыре очереди. Только подтверждённые временные отметки.',
    timeLead: 'Официальная страница заявляет четыре очереди. В каталоге на 30 августа 2026 представлены только блоки 2-2 и 3-1; квартир I и IV очередей в подборке нет.',
    phases: [
      ['I очередь', 'Сдана', 'Статус подтверждён официальным буклетом.'],
      ['II очередь · блок 2-2', '14.11.2026', '42 позиции в официальном каталоге на дату среза.'],
      ['III очередь · блок 3-1', '25.12.2027', '62 позиции в официальном каталоге на дату среза.'],
      ['IV очередь', 'Без статуса в каталоге', 'Очередь заявлена в структуре проекта; квартир этой очереди в текущей подборке нет.'],
    ] as const,
    storyIndex: '02 · УЖЕ РЕАЛИЗОВАНО', storyTitle: 'I очередь — не обещание, а существующая архитектура.',
    storyText: 'Здесь показаны только реальные официальные фотографии сданной I очереди: фасады, двор, общие зоны и озеленение.',
    storyAlt: 'Реальная архитектура сданной I очереди Zamon',
    mediaIndex: '03 · МЕДИАТЕКА', mediaTitle: 'Три слоя, которые не смешиваются.',
    mediaText: 'Реальные фотографии, официальная концепция будущих дворов и стройархив за июль 2026 разделены по происхождению и подписи.',
    layers: {
      realized: { title: 'Реализовано', note: 'Реальные официальные фотографии сданной I очереди', disclosure: 'Реальная фотография · сданная I очередь', titles: ['Фасад · 01', 'Фасад · 02', 'Архитектура · 03', 'Двор · 04', 'Фасадная деталь · 05', 'Архитектурная деталь · 06'] },
      concept: { title: 'Официальная концепция', note: 'CGI будущих очередей; итоговый вид может измениться', disclosure: 'Официальная визуализация / концепция · итог может измениться', titles: ['Двор · концепция 01', 'Двор · концепция 02', 'Двор · концепция 03', 'Двор · концепция 04', 'Двор · концепция 05'] },
      construction: { title: 'Стройархив · июль 2026', note: 'Последний официальный стройотчёт на landing', disclosure: 'Официальный стройархив · июль 2026', titles: ['Стройархив · 01', 'Стройархив · 02', 'Стройархив · 03', 'Стройархив · 04', 'Стройархив · 05'] },
    },
    galleryLabel: 'Галерея', openImage: 'Открыть изображение', closeImage: 'Закрыть изображение', previous: 'Предыдущее изображение', next: 'Следующее изображение',
    architectureIndex: '04 · АРХИТЕКТУРНАЯ ВЕДОМОСТЬ', architectureTitle: 'Тёплый фасад, глубокая тень, ясный ритм.',
    architectureText: 'Фотографии фиксируют реальную пластику I очереди. Это визуальное наблюдение, а не выдуманная спецификация материалов.',
    architectureAlt: 'Реальная фотография архитектурной детали Zamon',
    architectureNotes: ['теплая фасадная гамма', 'глубокие лоджии', 'контрастные рамы', 'светлые общие зоны'] as const,
    landscapeIndex: '05 · ДВОР И ЛАНДШАФТ', landscapeTitle: 'Пруд и не менее 30% озеленения.',
    landscapeText: 'Официальные материалы подтверждают собственный пруд, закрытый двор, круглосуточную охрану и видеонаблюдение, playground, workout и barbecue-сценарии.',
    landscapeAlt: 'Реальное озеленение сданной I очереди Zamon',
    landscapeFeatures: ['собственный пруд', 'не менее 30% озеленения', 'закрытый двор', 'охрана и видеонаблюдение 24/7', 'playground / workout / barbecue'] as const,
    archiveIndex: '06 · ПОСЛЕДНИЙ СТРОЙОТЧЁТ', archiveTitle: 'Июль 2026 — дата, а не фон.',
    archiveText: 'Каждый кадр ниже относится к официальному стройархиву за июль 2026. Статус отдельных квартир по фотографиям не определяется.',
    environmentIndex: '07 · ОКРУЖЕНИЕ', environmentTitle: 'Названия без придуманных минут.',
    environmentText: 'Буклет называет следующие объекты окружения, но не даёт точного времени в пути.',
    environment: ['метро «Янгиабад»', 'школы №212, №206 и №198', 'детский сад №425', 'IT school', 'Intellect baby', 'Joy KIDS preschool', 'мечети «Алибек» и «Чилонота»'] as const,
    catalogIndex: '08 · КАТАЛОГ · 30.08.2026', catalogTitle: '104 позиции. Четыре статуса источника.',
    catalogText: 'На дату каталога: 93 «Свободно», 1 «Бронирование», 7 «Расторжение» и 3 «Снятие резерва». Статус и юридическую доступность каждой квартиры подтверждает отдел продаж.',
    catalogStats: [['104', 'позиции каталога'], ['1–5', 'комнаты'], ['31,14–134,42 м²', 'площадь'], ['392 276 808–1 488 956 497 UZS', 'цена по акции на дату каталога']] as const,
    catalogNote: 'Скидка 12% была указана до 31.12.2026 17:59:59Z. Это датированный факт; текущие условия подтверждает отдел продаж.', openCatalog: 'Открыть полный каталог',
    dataNoteTitle: 'О данных и источниках', dataNoteText: '104 записи сохранены из официального каталога NRG-BI 30.08.2026 в 20:15 UZT. В техническом источнике isSale=true у 103 из 104 записей; сроки на странице приведены по единому значению официальных filter/realEstateList, а исходная дата placementList сохранена внутри карточки в разделе происхождения данных.',
    contactsIndex: '09 · КОНТАКТЫ', contactsTitle: 'Поговорить о конкретной квартире.', contactsText: 'Менеджер NRG-BI подтверждает актуальный статус, цену, срок и условия.', offices: 'Отделы продаж', officeOne: 'ул. Нукус, 91/1', officeTwo: 'ул. Айбека, 38А',
    formTagline: 'Хронология света.', formFacts: ['Comfort class', '4 очереди', 'собственный пруд'],
    privacy: 'Обработка персональных данных', source: 'Официальная страница', booklet: 'Официальный буклет · 36 страниц', panorama: 'Панорама 360', top: 'Наверх',
    bookletContext: 'PDF откроется отдельно; текущая страница сохранит выбранный язык.',
    disclaimer: 'Реальные фото, CGI и стройархив подписаны отдельно. Каталог датирован 30.08.2026, не является публичной офертой и не гарантирует юридическую доступность.',
    introLabel: 'ХРОНОЛОГИЯ СВЕТА · ZAMON',
  },
  uz: {
    skip: 'Mazmunga o‘tish', navigation: 'Zamon navigatsiyasi', footerNavigation: 'Manbalar va huquqiy ma’lumot', menu: 'Menyu', closeMenu: 'Menyuni yopish', language: 'Til',
    nav: [['time', 'Vaqt'], ['realized', 'Amalga oshgan'], ['media', 'Mediateka'], ['landscape', 'Hovli'], ['catalog', 'Xonadonlar'], ['contacts', 'Aloqa']] as const,
    choose: 'Xonadon tanlash', consult: 'Ariza qoldirish', phone: '1360 ga qo‘ng‘iroq',
    heroOverline: 'TOSHKENT · COMFORT CLASS · 4 BOSQICH', heroTitle: 'Zamon', heroText: 'Bir necha vaqt qatlamidagi uy: topshirilgan I bosqich, dolzarb xonadonlar tanlovi va kelajak me’moriy konsepsiyasi.',
    heroAlt: 'Zamon topshirilgan I bosqichining haqiqiy fotosurati', actualPhoto: 'Topshirilgan I bosqichning haqiqiy fotosurati',
    phaseCards: [{ index: '02', title: 'NRG Zamon 2-2', rows: 'Katalogda 42 ta pozitsiya', deadline: 'Muddat · 2026-yil 14-noyabr' }, { index: '03', title: 'NRG Zamon 3-1', rows: 'Katalogda 62 ta pozitsiya', deadline: 'Muddat · 2027-yil 25-dekabr' }],
    phaseCardNote: 'Katalog 2026-yil 30-avgustda qayd etilgan; har bir xonadonning dolzarbligini savdo bo‘limi tasdiqlaydi.',
    facts: [['Comfort', 'klass'], ['4', 'bosqich'], ['8 / 9 / 12', 'qavat'], ['≥ 30%', 'ko‘kalamzor'], ['1', 'shaxsiy hovuz']] as const,
    timeIndex: '01 · XRONOLOGIYA', timeTitle: 'To‘rt bosqich. Faqat tasdiqlangan vaqt belgilari.', timeLead: 'Rasmiy sahifa to‘rt bosqichni ko‘rsatadi. 2026-yil 30-avgustdagi katalogda faqat 2-2 va 3-1 bloklari bor; I va IV bosqichlar uchun xonadonlar ko‘rsatilmagan.',
    phases: [['I bosqich', 'Topshirilgan', 'Holat rasmiy buklet bilan tasdiqlangan.'], ['II bosqich · 2-2 blok', '14.11.2026', 'Rasmiy katalogda 42 ta pozitsiya.'], ['III bosqich · 3-1 blok', '25.12.2027', 'Rasmiy katalogda 62 ta pozitsiya.'], ['IV bosqich', 'Katalogda holat yo‘q', 'Bosqich loyiha tuzilmasida bor; joriy tanlovda xonadonlar yo‘q.']] as const,
    storyIndex: '02 · AMALGA OSHGAN', storyTitle: 'I bosqich — va’da emas, mavjud me’morchilik.', storyText: 'Faqat topshirilgan I bosqichning haqiqiy rasmiy fotosuratlari ko‘rsatiladi: fasadlar, hovli, umumiy zonalar va ko‘kalamzor.', storyAlt: 'Zamon topshirilgan I bosqichining haqiqiy me’morchiligi',
    mediaIndex: '03 · MEDIATEKA', mediaTitle: 'Aralashmaydigan uch qatlam.', mediaText: 'Haqiqiy fotosuratlar, kelajak hovlilarining rasmiy konsepsiyasi va 2026-yil iyul qurilish arxivi kelib chiqishi bo‘yicha ajratilgan.',
    layers: { realized: { title: 'Amalga oshgan', note: 'Topshirilgan I bosqichning haqiqiy rasmiy fotosuratlari', disclosure: 'Haqiqiy fotosurat · topshirilgan I bosqich', titles: ['Fasad · 01', 'Fasad · 02', 'Me’morchilik · 03', 'Hovli · 04', 'Fasad detali · 05', 'Me’moriy detal · 06'] }, concept: { title: 'Rasmiy konsepsiya', note: 'Kelajak bosqichlari CGI; yakuniy ko‘rinish o‘zgarishi mumkin', disclosure: 'Rasmiy vizualizatsiya / konsepsiya · yakuniy ko‘rinish o‘zgarishi mumkin', titles: ['Hovli · konsepsiya 01', 'Hovli · konsepsiya 02', 'Hovli · konsepsiya 03', 'Hovli · konsepsiya 04', 'Hovli · konsepsiya 05'] }, construction: { title: 'Qurilish arxivi · 2026-yil iyul', note: 'Landingdagi so‘nggi rasmiy qurilish hisoboti', disclosure: 'Rasmiy qurilish arxivi · 2026-yil iyul', titles: ['Qurilish · 01', 'Qurilish · 02', 'Qurilish · 03', 'Qurilish · 04', 'Qurilish · 05'] } },
    galleryLabel: 'Galereya', openImage: 'Tasvirni ochish', closeImage: 'Tasvirni yopish', previous: 'Oldingi tasvir', next: 'Keyingi tasvir',
    architectureIndex: '04 · ME’MORIY QAYDNOMA', architectureTitle: 'Iliq fasad, chuqur soya, aniq ritm.', architectureText: 'Fotosuratlar I bosqichning haqiqiy plastikasini qayd etadi. Bu vizual kuzatuv, o‘ylab topilgan material spetsifikatsiyasi emas.', architectureAlt: 'Zamon haqiqiy me’moriy detali', architectureNotes: ['iliq fasad gammasi', 'chuqur lodjiyalar', 'kontrast romlar', 'yorug‘ umumiy zonalar'] as const,
    landscapeIndex: '05 · HOVLI VA LANDSHAFT', landscapeTitle: 'Hovuz va kamida 30% ko‘kalamzor.', landscapeText: 'Rasmiy materiallar shaxsiy hovuz, yopiq hovli, 24/7 qo‘riqlash va videokuzatuv, playground, workout va barbecue ssenariylarini tasdiqlaydi.', landscapeAlt: 'Zamon topshirilgan I bosqichining haqiqiy ko‘kalamzori', landscapeFeatures: ['shaxsiy hovuz', 'kamida 30% ko‘kalamzor', 'yopiq hovli', '24/7 qo‘riqlash va videokuzatuv', 'playground / workout / barbecue'] as const,
    archiveIndex: '06 · SO‘NGGI QURILISH HISOBOTI', archiveTitle: '2026-yil iyul — fon emas, sana.', archiveText: 'Har bir kadr 2026-yil iyuldagi rasmiy qurilish arxiviga tegishli. Fotosuratlardan alohida xonadon holati aniqlanmaydi.',
    environmentIndex: '07 · ATROF', environmentTitle: 'O‘ylab topilgan daqiqalarsiz nomlar.', environmentText: 'Buklet quyidagi obyektlarni tilga oladi, ammo aniq yo‘l vaqtini bermaydi.', environment: ['«Yangiabad» metrosi', '212-, 206- va 198-maktablar', '425-bolalar bog‘chasi', 'IT school', 'Intellect baby', 'Joy KIDS preschool', '«Alibek» va «Chilonota» masjidlari'] as const,
    catalogIndex: '08 · KATALOG · 30.08.2026', catalogTitle: '104 pozitsiya. Manbadagi to‘rtta holat.', catalogText: 'Katalog sanasida: 93 «Bo‘sh», 1 «Bron», 7 «Bekor qilish» va 3 «Rezervni yechish». Har bir xonadonning holati va huquqiy mavjudligini savdo bo‘limi tasdiqlaydi.', catalogStats: [['104', 'katalog pozitsiyasi'], ['1–5', 'xonalar'], ['31.14–134.42 m²', 'maydon'], ['392 276 808–1 488 956 497 UZS', 'katalog sanasidagi aksiya narxi']] as const, catalogNote: '12% chegirma 2026-12-31 17:59:59Z gacha ko‘rsatilgan. Bu sanali fakt; joriy shartlarni savdo bo‘limi tasdiqlaydi.', openCatalog: 'To‘liq katalogni ochish',
    dataNoteTitle: 'Ma’lumotlar va manbalar haqida', dataNoteText: '104 ta yozuv NRG-BI rasmiy katalogidan 30.08.2026 soat 20:15 UZT da saqlangan. Texnik manbada 104 yozuvdan 103 tasida isSale=true; sahifadagi muddatlar rasmiy filter/realEstateList yagona qiymati bo‘yicha berilgan, placementList dagi asl sana esa xonadon kartasining ma’lumotlar bo‘limida saqlangan.',
    contactsIndex: '09 · ALOQA', contactsTitle: 'Aniq xonadon haqida gaplashish.', contactsText: 'NRG-BI menejeri joriy holat, narx, muddat va shartlarni tasdiqlaydi.', offices: 'Savdo bo‘limlari', officeOne: 'Nukus ko‘chasi, 91/1', officeTwo: 'Oybek ko‘chasi, 38A',
    formTagline: 'Yorug‘lik xronologiyasi.', formFacts: ['Comfort class', '4 bosqich', 'shaxsiy hovuz'], privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', source: 'Rasmiy sahifa', booklet: 'Rasmiy buklet · 36 sahifa', panorama: '360 panorama', top: 'Yuqoriga', bookletContext: 'PDF alohida ochiladi; joriy sahifada tanlangan til saqlanadi.', disclaimer: 'Haqiqiy foto, CGI va qurilish arxivi alohida belgilangan. Katalog 30.08.2026 sanasiga tegishli, ommaviy oferta yoki huquqiy mavjudlik kafolati emas.', introLabel: 'YORUG‘LIK XRONOLOGIYASI · ZAMON',
  },
  en: {
    skip: 'Skip to content', navigation: 'Zamon navigation', footerNavigation: 'Sources and legal information', menu: 'Menu', closeMenu: 'Close menu', language: 'Language',
    nav: [['time', 'Time'], ['realized', 'Built'], ['media', 'Media'], ['landscape', 'Courtyard'], ['catalog', 'Apartments'], ['contacts', 'Contacts']] as const,
    choose: 'Choose an apartment', consult: 'Send a request', phone: 'Call 1360',
    heroOverline: 'TASHKENT · COMFORT CLASS · 4 PHASES', heroTitle: 'Zamon', heroText: 'A home across several layers of time: completed phase I, a current apartment selection and future architectural concepts.', heroAlt: 'Actual photograph of Zamon completed phase I', actualPhoto: 'Actual photograph of the completed first phase',
    phaseCards: [{ index: '02', title: 'NRG Zamon 2-2', rows: '42 catalogue entries', deadline: 'Completion · 14 November 2026' }, { index: '03', title: 'NRG Zamon 3-1', rows: '62 catalogue entries', deadline: 'Completion · 25 December 2027' }], phaseCardNote: 'The catalogue was captured on 30 August 2026; the sales team confirms each apartment’s current status.',
    facts: [['Comfort', 'class'], ['4', 'phases'], ['8 / 9 / 12', 'storeys'], ['≥ 30%', 'landscaping'], ['1', 'own pond']] as const,
    timeIndex: '01 · CHRONOLOGY', timeTitle: 'Four phases. Only confirmed time markers.', timeLead: 'The official page states four phases. The catalogue dated 30 August 2026 contains only blocks 2-2 and 3-1; no apartments are shown for phases I or IV.', phases: [['Phase I', 'Completed', 'Confirmed by the official booklet.'], ['Phase II · block 2-2', '14 Nov 2026', '42 entries in the official catalogue.'], ['Phase III · block 3-1', '25 Dec 2027', '62 entries in the official catalogue.'], ['Phase IV', 'No catalogue status', 'The project states a fourth phase; the current selection has no phase IV apartments.']] as const,
    storyIndex: '02 · ALREADY BUILT', storyTitle: 'Phase I is existing architecture, not a promise.', storyText: 'Only actual official photographs of completed phase I are shown here: facades, courtyard, common areas and landscaping.', storyAlt: 'Actual architecture of Zamon completed phase I',
    mediaIndex: '03 · MEDIA LIBRARY', mediaTitle: 'Three layers that never blur together.', mediaText: 'Actual photography, official future-courtyard concepts and the July 2026 construction archive are separated by origin and disclosure.',
    layers: { realized: { title: 'Built', note: 'Actual official photographs of completed phase I', disclosure: 'Actual photograph · completed phase I', titles: ['Facade · 01', 'Facade · 02', 'Architecture · 03', 'Courtyard · 04', 'Facade detail · 05', 'Architecture detail · 06'] }, concept: { title: 'Official concept', note: 'Future-phase CGI; final appearance may change', disclosure: 'Official visualization / concept · final appearance may change', titles: ['Courtyard · concept 01', 'Courtyard · concept 02', 'Courtyard · concept 03', 'Courtyard · concept 04', 'Courtyard · concept 05'] }, construction: { title: 'Construction archive · July 2026', note: 'Latest official construction report on the landing', disclosure: 'Official construction archive · July 2026', titles: ['Construction · 01', 'Construction · 02', 'Construction · 03', 'Construction · 04', 'Construction · 05'] } },
    galleryLabel: 'Gallery', openImage: 'Open image', closeImage: 'Close image', previous: 'Previous image', next: 'Next image',
    architectureIndex: '04 · ARCHITECTURAL LEDGER', architectureTitle: 'Warm facade, deep shade, clear rhythm.', architectureText: 'The photographs record the real form of phase I. This is visual observation, not an invented material specification.', architectureAlt: 'Actual Zamon architectural detail', architectureNotes: ['warm facade palette', 'deep loggias', 'contrasting frames', 'light common areas'] as const,
    landscapeIndex: '05 · COURTYARD AND LANDSCAPE', landscapeTitle: 'A pond and at least 30% landscaping.', landscapeText: 'Official materials confirm an own pond, private courtyard, 24/7 security and video surveillance, playground, workout and barbecue settings.', landscapeAlt: 'Actual landscaping at Zamon completed phase I', landscapeFeatures: ['own pond', 'at least 30% landscaping', 'private courtyard', '24/7 security and video surveillance', 'playground / workout / barbecue'] as const,
    archiveIndex: '06 · LATEST CONSTRUCTION REPORT', archiveTitle: 'July 2026 is a date, not scenery.', archiveText: 'Every frame below belongs to the official July 2026 construction archive. A unit’s status cannot be inferred from a photograph.',
    environmentIndex: '07 · SURROUNDINGS', environmentTitle: 'Names without invented minutes.', environmentText: 'The booklet names the following places but gives no exact travel times.', environment: ['Yangiabad metro', 'schools no. 212, 206 and 198', 'kindergarten no. 425', 'IT school', 'Intellect baby', 'Joy KIDS preschool', 'Alibek and Chilonota mosques'] as const,
    catalogIndex: '08 · CATALOGUE · 30 AUG 2026', catalogTitle: '104 entries. Four source statuses.', catalogText: 'On the catalogue date: 93 “Available”, 1 “Booking”, 7 “Termination” and 3 “Reservation release”. The sales team confirms each apartment’s status and legal availability.', catalogStats: [['104', 'catalogue entries'], ['1–5', 'rooms'], ['31.14–134.42 m²', 'area'], ['392,276,808–1,488,956,497 UZS', 'promotional price on catalogue date']] as const, catalogNote: 'The 12% discount was shown through 31 Dec 2026 17:59:59Z. This is a dated fact; the sales team confirms current terms.', openCatalog: 'Open the full catalogue',
    dataNoteTitle: 'About the data and sources', dataNoteText: '104 records were saved from the official NRG-BI catalogue on 30 Aug 2026 at 20:15 UZT. The technical source has isSale=true for 103 of 104 records; displayed completion dates use the consistent official filter/realEstateList value, while the original placementList date is retained in each apartment’s data note.',
    contactsIndex: '09 · CONTACTS', contactsTitle: 'Discuss one specific apartment.', contactsText: 'An NRG-BI manager confirms current status, price, completion and terms.', offices: 'Sales offices', officeOne: '91/1 Nukus Street', officeTwo: '38A Oybek Street',
    formTagline: 'A chronology of light.', formFacts: ['Comfort class', '4 phases', 'own pond'], privacy: 'Personal data processing', source: 'Official project page', booklet: 'Official booklet · 36 pages', panorama: '360 panorama', top: 'Back to top', bookletContext: 'The PDF opens separately; this page keeps the selected language.', disclaimer: 'Actual photos, CGI and construction records are labelled separately. The catalogue is dated 30 Aug 2026, is not a public offer and does not guarantee legal availability.', introLabel: 'CHRONOLOGY OF LIGHT · ZAMON',
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${withLanguage('/privacy', language)}&project=zamon`; }
function preferredScrollBehavior(): ScrollBehavior { return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; }

let bodyLockDepth = 0;
let bodyOverflowBefore = '';
let bodyPaddingBefore = '';
let measuredScrollbarWidth = 0;
function lockBody() {
  if (bodyLockDepth === 0) {
    bodyOverflowBefore = document.body.style.overflow;
    bodyPaddingBefore = document.body.style.paddingRight;
    const scrollbar = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${currentPadding + scrollbar}px`;
  }
  bodyLockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockDepth = Math.max(0, bodyLockDepth - 1);
    if (bodyLockDepth === 0) {
      document.body.style.overflow = bodyOverflowBefore;
      document.body.style.paddingRight = bodyPaddingBefore;
    }
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
    const leave = window.setTimeout(() => setPhase('leaving'), 620);
    const close = window.setTimeout(() => {
      try { window.sessionStorage.setItem(introKey, '1'); } catch { /* Intro can close without storage. */ }
      setPhase('hidden');
      unlock();
    }, 880);
    return () => { window.clearTimeout(leave); window.clearTimeout(close); unlock(); };
  }, []);
  return phase;
}

function useReveals(language: Language) {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.zamon-site [data-zamon-reveal]'));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { nodes.forEach((node) => node.classList.add('is-visible')); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }), { threshold: .05, rootMargin: '0px 0px 18% 0px' });
    nodes.forEach((node) => observer.observe(node));
    const fallback = window.setTimeout(() => nodes.forEach((node) => node.classList.add('is-visible')), 1000);
    return () => { window.clearTimeout(fallback); observer.disconnect(); };
  }, [language]);
}

function MediaLightbox({ slides, titles, disclosure, index, language, onMove, onSelect, onClose }: { slides: Slide[]; titles: readonly string[]; disclosure: string; index: number; language: Language; onMove: (step: number) => void; onSelect: (index: number) => void; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const t = copy[language];
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const unlock = lockBody();
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); onMove(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); onMove(1); return; }
      if (event.key === 'Home') { event.preventDefault(); onSelect(0); return; }
      if (event.key === 'End') { event.preventDefault(); onSelect(slides.length - 1); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { unlock(); window.removeEventListener('keydown', onKey); window.requestAnimationFrame(() => opener?.isConnected && opener.focus({ preventScroll: true })); };
  }, [onClose, onMove, onSelect, slides.length]);
  const start = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary) return;
    pointerStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const end = (event: ReactPointerEvent) => {
    const startPoint = pointerStart.current;
    if (!event.isPrimary || !startPoint || startPoint.id !== event.pointerId) return;
    const deltaX = event.clientX - startPoint.x;
    const deltaY = event.clientY - startPoint.y;
    if (Math.abs(deltaX) > 44 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) onMove(deltaX > 0 ? -1 : 1);
    pointerStart.current = null;
  };
  const current = slides[index];
  return <div className="zamon-lightbox" role="dialog" aria-modal="true" aria-labelledby="zamon-lightbox-caption" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div ref={panelRef} className="zamon-lightbox__panel"><button ref={closeRef} className="zamon-lightbox__close" type="button" onClick={onClose} aria-label={t.closeImage}>×</button><button className="zamon-lightbox__previous" type="button" onClick={() => onMove(-1)} aria-label={t.previous}>←</button><figure onPointerDown={start} onPointerUp={end} onPointerCancel={() => { pointerStart.current = null; }}><img src={asset(current.src)} alt={`${titles[index]} · ${disclosure}`} draggable={false} /><figcaption id="zamon-lightbox-caption" aria-live="polite"><span>{disclosure}{current.date ? ` · ${current.date}` : ''}</span><strong>{titles[index]}</strong><small>{String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</small></figcaption></figure><button className="zamon-lightbox__next" type="button" onClick={() => onMove(1)} aria-label={t.next}>→</button><div className="zamon-lightbox__thumbs">{slides.map((slide, slideIndex) => <button key={slide.src} type="button" aria-pressed={slideIndex === index} className={slideIndex === index ? 'is-active' : ''} onClick={() => onSelect(slideIndex)} aria-label={titles[slideIndex]}><img src={asset(slide.src)} alt="" loading="lazy" /></button>)}</div></div></div>;
}

function MediaLayer({ layer, language }: { layer: Layer; language: Language }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const pointerStart = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const slides = media[layer];
  const t = copy[language];
  const currentCopy = t.layers[layer];
  const move = useCallback((step: number) => setIndex((value) => (value + step + slides.length) % slides.length), [slides.length]);
  const close = useCallback(() => setLightbox(false), []);
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    else if (event.key === 'Home') { event.preventDefault(); setIndex(0); }
    else if (event.key === 'End') { event.preventDefault(); setIndex(slides.length - 1); }
  };
  return <section className={`zamon-media-layer is-${layer}`} aria-labelledby={`zamon-layer-${layer}`}><header><span>{layer === 'realized' ? '03.1' : layer === 'concept' ? '03.2' : '03.3'}</span><div><h3 id={`zamon-layer-${layer}`}>{currentCopy.title}</h3><p>{currentCopy.note}</p></div></header><div className="zamon-media-layer__stage" role="region" tabIndex={0} aria-label={`${t.galleryLabel}: ${currentCopy.title}`} onKeyDown={onKey}><button className="zamon-media-layer__image" type="button" onPointerDown={(event) => { if (!event.isPrimary) return; pointerStart.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; swiped.current = false; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={(event) => { const startPoint = pointerStart.current; if (!event.isPrimary || !startPoint || startPoint.id !== event.pointerId) return; const deltaX = event.clientX - startPoint.x; const deltaY = event.clientY - startPoint.y; if (Math.abs(deltaX) > 44 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) { swiped.current = true; move(deltaX > 0 ? -1 : 1); } pointerStart.current = null; }} onPointerCancel={() => { pointerStart.current = null; }} onClick={(event) => { if (swiped.current) { event.preventDefault(); swiped.current = false; return; } setLightbox(true); }} aria-label={`${t.openImage}: ${currentCopy.titles[index]}`}><img key={slides[index].src} src={asset(slides[index].src)} alt={`${currentCopy.titles[index]} · ${currentCopy.disclosure}`} loading={index === 0 ? 'eager' : 'lazy'} decoding="async" draggable={false} /><span>{currentCopy.disclosure}</span><i aria-hidden="true">↗</i></button><div className="zamon-media-layer__meta" aria-live="polite"><strong>{currentCopy.titles[index]}</strong><span>{String(index + 1).padStart(2, '0')} / {String(slides.length).padStart(2, '0')}</span></div><div className="zamon-media-layer__controls"><button type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button><div>{slides.map((slide, slideIndex) => <button key={slide.src} type="button" className={slideIndex === index ? 'is-active' : ''} aria-pressed={slideIndex === index} aria-label={currentCopy.titles[slideIndex]} onClick={() => setIndex(slideIndex)}><img src={asset(slide.src)} alt="" loading="lazy" /></button>)}</div><button type="button" onClick={() => move(1)} aria-label={t.next}>→</button></div></div>{lightbox ? <MediaLightbox slides={slides} titles={currentCopy.titles} disclosure={currentCopy.disclosure} index={index} language={language} onMove={move} onSelect={setIndex} onClose={close} /> : null}</section>;
}

export function ZamonPage({ initialLanguage }: { initialLanguage: Language }) {
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
      try { stored = window.localStorage.getItem(storageKey); } catch { /* URL remains authoritative. */ }
      const fallback = stored === 'ru' || stored === 'uz' || stored === 'en' ? stored : language;
      url.searchParams.set('lang', fallback);
      router.replace(`${url.pathname}?${url.searchParams.toString()}${url.hash}`, { scroll: false });
      if (fallback !== language) return;
    }
    document.documentElement.lang = language;
    try { window.localStorage.setItem(storageKey, language); } catch { /* Storage fallback is optional. */ }
  }, [language, router]);

  useEffect(() => {
    if (!menuOpen) return;
    const trigger = menuTriggerRef.current;
    const unlock = lockBody();
    menuCloseRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); restoreMenuFocus.current = true; setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!menuRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { unlock(); window.removeEventListener('keydown', onKey); const restore = restoreMenuFocus.current; restoreMenuFocus.current = true; if (restore) window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true })); };
  }, [menuOpen]);

  useEffect(() => {
    if (!leadContext) return;
    return lockBody();
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
      const url = new URL(window.location.href); url.hash = id; window.history.replaceState({}, '', url);
    }));
  };
  const openLead = (surface: string) => {
    measuredScrollbarWidth = Math.max(measuredScrollbarWidth, window.innerWidth - document.documentElement.clientWidth, 0);
    setLeadContext(`projectSlug=zamon;surface=landing:${surface};lang=${language};unit=general`);
  };
  const officialLanding = language === 'uz' ? officialLandingUz : officialLandingRu;

  return <div className="zamon-site" lang={language}>
    {introPhase !== 'hidden' ? <div className={`zamon-intro${introPhase === 'leaving' ? ' is-leaving' : ''}`} aria-hidden="true"><span>{t.introLabel}</span><i /><small>01 — 04</small></div> : null}
    <a className="zamon-skip" href="#zamon-content">{t.skip}</a>
    <header className="zamon-header">
      <a className="zamon-name" href={withLanguage('/zamon', language)} aria-label="Zamon"><strong>Zamon</strong><span>NRG-BI</span></a>
      <nav aria-label={t.navigation}>{t.nav.map(([id, label]) => <a key={id} href={`#${id}`} onClick={(event) => goToAnchor(event, id)}>{label}</a>)}</nav>
      <div className="zamon-header__actions"><a className="zamon-header__catalog" href={withLanguage('/zamon/apartments', language)}>{t.choose}</a><div className="zamon-languages" role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} aria-pressed={item === language} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><button ref={menuTriggerRef} className="zamon-menu-trigger" type="button" aria-label={t.menu} aria-expanded={menuOpen} aria-controls="zamon-menu" onClick={() => { restoreMenuFocus.current = true; setMenuOpen(true); }}><span>{t.menu}</span><i aria-hidden="true" /></button></div>
    </header>
    {menuOpen ? <nav id="zamon-menu" ref={menuRef} className="zamon-menu" role="dialog" aria-modal="true" aria-label={t.navigation}><header><a className="zamon-name" href={withLanguage('/zamon', language)}><strong>Zamon</strong><span>NRG-BI</span></a><button ref={menuCloseRef} type="button" onClick={() => { restoreMenuFocus.current = true; setMenuOpen(false); }} aria-label={t.closeMenu}>×</button></header><div>{t.nav.map(([id, label], index) => <a key={id} href={`#${id}`} onClick={(event) => goToAnchor(event, id)}><small>0{index + 1}</small>{label}</a>)}</div><footer><div role="group" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} className={item === language ? 'is-active' : ''} aria-pressed={item === language} onClick={() => { restoreMenuFocus.current = true; setMenuOpen(false); setLanguage(item); }}>{item.toUpperCase()}</button>)}</div><a href={withLanguage('/zamon/apartments', language)}>{t.choose} ↗</a></footer></nav> : null}

    <main id="zamon-content" tabIndex={-1}>
      <section className="zamon-hero" aria-labelledby="zamon-title">
        <figure><img src={asset('/zamon/images/hero-phase-one.webp')} alt={t.heroAlt} fetchPriority="high" decoding="async" /><figcaption><span>01</span>{t.actualPhoto}</figcaption></figure>
        <div className="zamon-hero__copy"><p>{t.heroOverline}</p><h1 id="zamon-title">{t.heroTitle}</h1><strong>{t.heroText}</strong><div className="zamon-hero__actions"><a className="zamon-button is-solid" href={withLanguage('/zamon/apartments', language)}>{t.choose}<span>↗</span></a><button className="zamon-button" type="button" data-lead-trigger onClick={() => openLead('hero-consultation')}>{t.consult}<span>↗</span></button></div><div className="zamon-phase-cards">{t.phaseCards.map((phase) => <article key={phase.title}><span>{phase.index}</span><h2>{phase.title}</h2><strong>{phase.rows}</strong><p>{phase.deadline}</p></article>)}</div><small className="zamon-phase-note">{t.phaseCardNote}</small></div>
        <div className="zamon-hero__chronology" aria-label={t.timeTitle}>{t.phases.map(([title, date], index) => <span key={title}><b>0{index + 1}</b><small>{title}</small><i>{date}</i></span>)}</div>
      </section>
      <section className="zamon-facts" aria-label={t.timeTitle}>{t.facts.map(([value, label], index) => <article key={label}><span>0{index + 1}</span><strong>{value}</strong><p>{label}</p></article>)}</section>

      <section id="time" className="zamon-ledger-section zamon-time" tabIndex={-1}><div className="zamon-ledger-index"><span>01</span><i /></div><header data-zamon-reveal><p className="zamon-overline">{t.timeIndex}</p><h2>{t.timeTitle}</h2><p>{t.timeLead}</p></header><div className="zamon-timeline">{t.phases.map(([title, date, note], index) => <article key={title} data-zamon-reveal><span>0{index + 1}</span><div><small>{date}</small><h3>{title}</h3><p>{note}</p></div></article>)}</div></section>

      <section id="realized" className="zamon-story" tabIndex={-1}><div data-zamon-reveal><p className="zamon-overline">{t.storyIndex}</p><h2>{t.storyTitle}</h2><p>{t.storyText}</p></div><figure><img src={asset('/zamon/images/architecture-01.webp')} alt={t.storyAlt} loading="lazy" decoding="async" /><figcaption>{t.actualPhoto}</figcaption></figure><div className="zamon-story__secondary"><img src={asset('/zamon/images/lobby-02.webp')} alt={t.storyAlt} loading="lazy" decoding="async" /><span>{t.actualPhoto}</span></div></section>

      <section id="media" className="zamon-media" tabIndex={-1}><header data-zamon-reveal><p className="zamon-overline">{t.mediaIndex}</p><h2>{t.mediaTitle}</h2><p>{t.mediaText}</p></header><MediaLayer layer="realized" language={language} /><MediaLayer layer="concept" language={language} /><MediaLayer layer="construction" language={language} /></section>

      <section className="zamon-ledger-section zamon-architecture" tabIndex={-1}><div className="zamon-ledger-index"><span>04</span><i /></div><header data-zamon-reveal><p className="zamon-overline">{t.architectureIndex}</p><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p></header><div className="zamon-architecture__grid">{['architecture-02', 'architecture-03', 'architecture-04', 'lobby-03'].map((name, index) => <figure key={name}><img src={asset(`/zamon/images/${name}.webp`)} alt={`${t.architectureAlt} · ${index + 1}`} loading="lazy" decoding="async" /><figcaption><span>0{index + 1}</span>{t.architectureNotes[index]}</figcaption></figure>)}</div></section>

      <section id="landscape" className="zamon-landscape" tabIndex={-1}><div data-zamon-reveal><p className="zamon-overline">{t.landscapeIndex}</p><h2>{t.landscapeTitle}</h2><p>{t.landscapeText}</p><ul>{t.landscapeFeatures.map((feature, index) => <li key={feature}><span>0{index + 1}</span>{feature}</li>)}</ul></div><figure><img src={asset('/zamon/images/landscape-01.webp')} alt={t.landscapeAlt} loading="lazy" decoding="async" /><figcaption>{t.actualPhoto}</figcaption></figure><figure><img src={asset('/zamon/images/landscape-02.webp')} alt={t.landscapeAlt} loading="lazy" decoding="async" /><figcaption>{t.actualPhoto}</figcaption></figure></section>

      <section className="zamon-archive" tabIndex={-1}><header data-zamon-reveal><p className="zamon-overline">{t.archiveIndex}</p><h2>{t.archiveTitle}</h2><p>{t.archiveText}</p></header><div>{archiveSlides.map((slide, index) => <figure key={slide.src}><img src={asset(slide.src)} alt={`${t.layers.construction.titles[index]} · ${t.layers.construction.disclosure}`} loading="lazy" decoding="async" /><figcaption><span>{slide.date}</span>{t.layers.construction.disclosure}</figcaption></figure>)}</div></section>

      <section className="zamon-environment" tabIndex={-1}><div data-zamon-reveal><p className="zamon-overline">{t.environmentIndex}</p><h2>{t.environmentTitle}</h2><p>{t.environmentText}</p></div><ol>{t.environment.map((place, index) => <li key={place}><span>{String(index + 1).padStart(2, '0')}</span>{place}</li>)}</ol></section>

      <section id="catalog" className="zamon-catalog-teaser" tabIndex={-1} data-zamon-reveal><header><p className="zamon-overline">{t.catalogIndex}</p><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header><div>{t.catalogStats.map(([value, label]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}</div><details className="zamon-data-note"><summary>{t.dataNoteTitle}<span aria-hidden="true">＋</span></summary><p>{t.dataNoteText}</p></details><footer><p>{t.catalogNote}</p><a className="zamon-button is-solid" href={withLanguage('/zamon/apartments', language)}>{t.openCatalog}<span>↗</span></a></footer></section>

      <section id="contacts" className="zamon-contacts" tabIndex={-1}><div data-zamon-reveal><p className="zamon-overline">{t.contactsIndex}</p><h2>{t.contactsTitle}</h2><p>{t.contactsText}</p></div><address><small>{t.offices}</small><span>{t.officeOne}</span><span>{t.officeTwo}</span><a href="tel:1360">1360</a></address><div className="zamon-contacts__actions"><button className="zamon-button is-solid" type="button" data-lead-trigger onClick={() => openLead('contacts-consultation')}>{t.consult}<span>↗</span></button><a className="zamon-button" href="tel:1360">{t.phone}<span>↗</span></a></div></section>
    </main>

    <footer className="zamon-footer"><a className="zamon-name" href={withLanguage('/zamon', language)}><strong>Zamon</strong><span>NRG-BI</span></a><p>{t.disclaimer}</p><nav aria-label={t.footerNavigation}><a href={officialLanding} target="_blank" rel="noreferrer">{t.source} ↗</a><a href={`${asset(officialBooklet)}?lang=${language}`} target="_blank" rel="noreferrer" data-return-url={withLanguage('/zamon', language)} title={t.bookletContext}>{t.booklet} ↗</a><a href={panorama} target="_blank" rel="noreferrer">{t.panorama} ↗</a><a href={privacyUrl(language)}>{t.privacy}</a><a href="#zamon-content" onClick={(event) => goToAnchor(event, 'zamon-content')}>{t.top} ↑</a></nav></footer>

    {leadContext ? <div className="zamon-lead-host" data-project-slug="zamon" data-context={leadContext}><LeadModal open language={language} context={leadContext} brandName="NRG-BI" projectName="ZAMON" tagline={t.formTagline} facts={t.formFacts} submitUrl={zamonLeadSubmitUrl()} projectSlug="zamon" privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadContext(undefined)} /></div> : null}
  </div>;
}

export default ZamonPage;
