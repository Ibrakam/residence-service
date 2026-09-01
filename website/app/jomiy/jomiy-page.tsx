'use client';

/* eslint-disable @next/next/no-img-element */

import { usePathname, useRouter } from 'next/navigation';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LeadModal } from '@/app/lead-modal';
import { jomiyLeadSubmitUrl } from './jomiy-lead';
import { lockJomiyBody, type JomiyLanguage as Language } from './jomiy-ui';

type MediaType = 'real-photo' | 'cgi-concept' | 'construction-photo' | 'phase-scheme';
type Slide = { src: string; type: MediaType; caption: Record<Language, string> };
type LightboxState = { slides: Slide[]; index: number; opener: HTMLButtonElement };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const storageKey = 'jomiy-language';
const languages: Language[] = ['ru', 'uz', 'en'];
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) => `${appBasePath}${path}?lang=${language}`;

const livedSlides: Slide[] = [
  { src: '/jomiy/images/real-02.webp', type: 'real-photo', caption: { ru: 'Реализованный фасад Jomiy', uz: 'Jomiy’ning amalga oshirilgan fasadi', en: 'Implemented Jomiy facade' } },
  { src: '/jomiy/images/real-03.webp', type: 'real-photo', caption: { ru: 'Реальная среда готовой части проекта', uz: 'Loyihaning tayyor qismidagi haqiqiy muhit', en: 'Actual setting in the completed part of the project' } },
  { src: '/jomiy/images/real-04.webp', type: 'real-photo', caption: { ru: 'Деталь реализованного благоустройства', uz: 'Amalga oshirilgan obodonlashtirish tafsiloti', en: 'Detail of implemented landscaping' } },
  { src: '/jomiy/images/real-05.webp', type: 'real-photo', caption: { ru: 'Двор готовой части Jomiy', uz: 'Jomiy tayyor qismining hovlisi', en: 'Courtyard in the completed part of Jomiy' } },
  { src: '/jomiy/images/real-06.webp', type: 'real-photo', caption: { ru: 'Реальный интерьер входной группы', uz: 'Kirish guruhining haqiqiy interyeri', en: 'Actual entrance-lobby interior' } },
  { src: '/jomiy/images/real-07.webp', type: 'real-photo', caption: { ru: 'Холл реализованного дома', uz: 'Amalga oshirilgan uyning holli', en: 'Lobby in an implemented building' } },
  { src: '/jomiy/images/real-08.webp', type: 'real-photo', caption: { ru: 'Реальная общая зона Jomiy', uz: 'Jomiy’ning haqiqiy umumiy hududi', en: 'Actual Jomiy common area' } },
  { src: '/jomiy/images/real-09.webp', type: 'real-photo', caption: { ru: 'Реализованная территория комплекса', uz: 'Majmuaning amalga oshirilgan hududi', en: 'Implemented project grounds' } },
  { src: '/jomiy/images/real-10.webp', type: 'real-photo', caption: { ru: 'Фасад и благоустройство готовой части', uz: 'Tayyor qism fasadi va obodonlashtirilishi', en: 'Facade and landscaping in the completed part' } },
  { src: '/jomiy/images/real-11.webp', type: 'real-photo', caption: { ru: 'Реальный вид Jomiy', uz: 'Jomiy’ning haqiqiy ko‘rinishi', en: 'Actual view of Jomiy' } },
];

const cgiSlides: Slide[] = [
  { src: '/jomiy/images/cgi-01.webp', type: 'cgi-concept', caption: { ru: 'Образ финальной очереди 2.2 · визуализация', uz: 'Yakuniy 2.2 bosqich obrazi · vizualizatsiya', en: 'Vision for the final phase 2.2 · visualisation' } },
  { src: '/jomiy/images/cgi-02.webp', type: 'cgi-concept', caption: { ru: 'Двор очереди 2.2 · визуализация', uz: '2.2 bosqich hovlisi · vizualizatsiya', en: 'Phase 2.2 courtyard · visualisation' } },
  { src: '/jomiy/images/cgi-03.webp', type: 'cgi-concept', caption: { ru: 'Архитектурный ритм очереди 2.2 · визуализация', uz: '2.2 bosqich me’moriy ritmi · vizualizatsiya', en: 'Architectural rhythm of phase 2.2 · visualisation' } },
  { src: '/jomiy/images/cgi-04.webp', type: 'cgi-concept', caption: { ru: 'Проектный образ входной группы · визуализация', uz: 'Kirish guruhining loyiha obrazi · vizualizatsiya', en: 'Entrance-lobby concept · visualisation' } },
  { src: '/jomiy/images/cgi-05.webp', type: 'cgi-concept', caption: { ru: 'Проектный образ благоустройства · визуализация', uz: 'Obodonlashtirishning loyiha obrazi · vizualizatsiya', en: 'Landscaping concept · visualisation' } },
];

const constructionSlides: Slide[] = [
  { src: '/jomiy/images/construction-01.webp', type: 'construction-photo', caption: { ru: 'Очередь 2.2 · ход строительства · июль 2026 · кадр 01', uz: '2.2 bosqich · qurilish jarayoni · 2026-yil iyul · 01-kadr', en: 'Phase 2.2 · construction progress · July 2026 · frame 01' } },
  { src: '/jomiy/images/construction-02.webp', type: 'construction-photo', caption: { ru: 'Очередь 2.2 · ход строительства · июль 2026 · кадр 02', uz: '2.2 bosqich · qurilish jarayoni · 2026-yil iyul · 02-kadr', en: 'Phase 2.2 · construction progress · July 2026 · frame 02' } },
  { src: '/jomiy/images/construction-03.webp', type: 'construction-photo', caption: { ru: 'Очередь 2.2 · ход строительства · июль 2026 · кадр 03', uz: '2.2 bosqich · qurilish jarayoni · 2026-yil iyul · 03-kadr', en: 'Phase 2.2 · construction progress · July 2026 · frame 03' } },
  { src: '/jomiy/images/construction-04.webp', type: 'construction-photo', caption: { ru: 'Очередь 2.2 · ход строительства · июль 2026 · кадр 04', uz: '2.2 bosqich · qurilish jarayoni · 2026-yil iyul · 04-kadr', en: 'Phase 2.2 · construction progress · July 2026 · frame 04' } },
  { src: '/jomiy/images/construction-05.webp', type: 'construction-photo', caption: { ru: 'Очередь 2.2 · ход строительства · июль 2026 · кадр 05', uz: '2.2 bosqich · qurilish jarayoni · 2026-yil iyul · 05-kadr', en: 'Phase 2.2 · construction progress · July 2026 · frame 05' } },
];

const copy = {
  ru: {
    skip: 'К содержанию', navLabel: 'Навигация Jomiy', menu: 'Оглавление', closeMenu: 'Закрыть', language: 'Язык',
    nav: [['origin', 'Поэзия'], ['lived', 'Уже живёт'], ['phase21', 'Очередь 2.1'], ['phase22', 'Очередь 2.2'], ['progress', 'Стройка'], ['living', 'Среда'], ['catalog', 'Квартиры'], ['location', 'Локация']] as const,
    catalog: 'Выбрать квартиру', consult: 'Уточнить доступность', call: 'Позвонить 1360', menuNote: 'Архитектурное собрание · восемь глав',
    heroOverline: 'ТАШКЕНТ · NRG-BI · БИЗНЕС-КЛАСС', heroTitle: 'JOMIY', heroLead: 'Вдохновлённый поэзией.', heroSublead: 'Готовая часть, сданная очередь 2.1 и строящаяся финальная глава 2.2 — без смешения фактов и образов.', heroImage: 'Реальная официальная фотография готовой части Jomiy',
    heroFacts: [['Бизнес', 'класс'], ['≥ 3,0 м', 'потолки'], ['2.2', 'финальная очередь']] as const,
    originIndex: 'BAYT 01 · ИМЯ И РИТМ', originTitle: 'Имя поэта. Ритм архитектуры.', originText: 'Проект назван в честь Абдурахмана Джами. Официальная формула — «Вдохновлённый поэзией». Мы не приписываем поэту цитат: история начинается с подтверждённого имени и продолжается в ритме фасада.', architectureTitle: 'Решётка света и материала', architectureText: 'Комбинированные фасады соединяют алюминиевые панели, клинкерную плитку и национальные декоративные элементы. Сетка страницы следует ритму реальных окон и золотистой фасадной геометрии.', schemeCaption: 'Концептуальный фотомонтаж / схема очередей · не фотография готового объекта', materials: ['алюминиевые панели', 'клинкерная плитка', 'национальные декоративные элементы'] as const,
    livedIndex: 'BAYT 02 · УЖЕ ОБЖИТАЯ СРЕДА', livedTitle: 'Первая глава уже живёт.', livedText: 'Первая очередь и двор сданы. В этой главе — только реальные официальные фотографии готовой части: фасады, благоустройство и холлы.',
    phase21Index: 'BAYT 03 · СДАННАЯ ОЧЕРЕДЬ', phase21Title: 'Jomiy 2.1 сдана 28 января 2026 года.', phase21Text: 'Официальная новость фиксирует завершение работ и появление первых жителей. Это относится к очереди 2.1 — не ко всему комплексу.', phase21Date: '28.01.2026 · официальная новость', phase21Address: 'Карточки очереди 2.1 / 2.2 в API: ул. Уста Ширин, 21',
    phase22Index: 'BAYT 04 · ОБРАЗ ФИНАЛЬНОЙ ГЛАВЫ', phase22Title: 'Jomiy 2.2 — финальная очередь. Она строится.', phase22Text: 'Эта галерея показывает только официальные CGI-концепции будущего образа 2.2. Это визуализации, а не фотографии готового дома; итоговый вид может измениться.',
    progressIndex: 'BAYT 05 · СТРОЙКА · ИЮЛЬ 2026', progressTitle: 'Факт, привязанный к месяцу.', progressText: 'В июле 2026 года зафиксированы монолитный каркас, подготовка перекрытия 7 этажа и параллельная кладка стен. Фотографии ниже — реальная стройка очереди 2.2, а не утверждение о её готовности.', progressFact: 'Монолит · перекрытие 7 этажа · кладка стен',
    livingIndex: 'BAYT 06 · ДВОР, ХОЛЛ, СЕРВИС', livingTitle: 'Повседневность собрана вокруг спокойного двора.', livingText: 'Подтверждены двор без машин, BBQ, безопасные игровые площадки, workout, прогулочная дорожка для колясок, соседский центр и аллея. Также предусмотрены подземный паркинг, кладовые и озеленение.', safetyTitle: 'Безопасность и управление', safetyText: 'Электронные замки, IP-домофония, CCTV 24/7 и сервисная компания. Предварительные тарифы не превращены здесь в постоянное обещание.', amenities: [['Двор', 'без машин'], ['BBQ', 'зона встреч'], ['Workout', 'для движения'], ['CCTV', '24 / 7'], ['IP', 'домофония'], ['Storage', 'кладовые']] as const,
    catalogIndex: 'BAYT 07 · КАТАЛОГ · 30.08.2026', catalogTitle: '121 позиция. Ни одной со статусом «Свободно».', catalogText: 'Это 121 предложение / позиция в официальном квартирном каталоге, а не 121 гарантированно свободная квартира. Каждая карточка показывает точный raw-статус и предлагает уточнить доступность.', catalogStats: [['121', 'позиция'], ['107', 'снятие резерва'], ['7', 'расторжение'], ['5', 'снятие брони'], ['2', 'бронирование'], ['0', 'Offers в JSON-LD']] as const, catalogGroups: ['2.1 · 5 позиций · сдана', '2.2 · 116 позиций · строится', '40,86–124,50 м²', '1–4 комнаты · 1–12 этажи'], openCatalog: 'Открыть каталог', catalogNote: 'Цены и кампании — срез API на 30 августа 2026. Срок 20% для пяти позиций 2.1 — до 31 августа 2026, срок 12% для 116 позиций 2.2 — до 31 декабря 2026. После дедлайна кампания автоматически помечается завершённой.',
    locationIndex: 'BAYT 08 · ЛОКАЦИЯ', locationTitle: 'Два адреса — две рамки источника.', locationText: 'Экосистема NRG-BI указывает ул. Шимолий Олмазор, 7. Карточки очередей 2.1 и 2.2 в API указывают ул. Уста Ширин, 21. Мы сохраняем обе подписи и не сливаем их в один адрес.', ecosystemAddress: 'Экосистема · ул. Шимолий Олмазор, 7', phaseAddress: 'Карточки очередей · ул. Уста Ширин, 21', panorama: 'Панорама реального двора',
    contactIndex: 'CODA · КОНСУЛЬТАЦИЯ', contactTitle: 'Продолжим с вашей строки.', contactText: 'Менеджер уточнит сценарий покупки и перепроверит текущий статус выбранной позиции. Заявка не является бронированием.',
    formTagline: 'Вдохновлённый поэзией.', formFacts: ['Бизнес-класс', '121 позиция', 'финальная очередь 2.2'] as const,
    media: { real: 'Реальная официальная фотография', cgi: 'Официальная визуализация · итог может измениться', construction: 'Реальная стройка · июль 2026', scheme: 'Концептуальный фотомонтаж / схема очередей' },
    galleryLabel: 'Галерея', previous: 'Предыдущее изображение', next: 'Следующее изображение', openImage: 'Открыть изображение', closeImage: 'Закрыть изображение', imageOf: 'из',
    sources: 'Источники', landing: 'Официальная страница', news: 'Сдача Jomiy 2.1', ecosystem: 'Экосистема и адрес', source360: 'Панорама 360', noBooklet: 'Подтверждённого буклета нет', privacy: 'Обработка персональных данных', top: 'Наверх',
    disclaimer: 'CGI и схема показывают концепцию и могут измениться. Реальные фотографии, стройка и проектные образы разделены. Информация и цены не являются публичной офертой.',
  },
  uz: {
    skip: 'Mazmunga o‘tish', navLabel: 'Jomiy navigatsiyasi', menu: 'Mundarija', closeMenu: 'Yopish', language: 'Til',
    nav: [['origin', 'She’riyat'], ['lived', 'Hayot boshlangan'], ['phase21', '2.1 bosqich'], ['phase22', '2.2 bosqich'], ['progress', 'Qurilish'], ['living', 'Muhit'], ['catalog', 'Xonadonlar'], ['location', 'Joylashuv']] as const,
    catalog: 'Xonadon tanlash', consult: 'Mavjudligini aniqlash', call: '1360 ga qo‘ng‘iroq', menuNote: 'Me’moriy to‘plam · sakkiz bob',
    heroOverline: 'TOSHKENT · NRG-BI · BIZNES-KLASS', heroTitle: 'JOMIY', heroLead: 'She’riyatdan ilhomlangan.', heroSublead: 'Tayyor qism, topshirilgan 2.1 bosqichi va qurilayotgan yakuniy 2.2 bobi — faktlar va obrazlar aralashtirilmagan.', heroImage: 'Jomiy tayyor qismining haqiqiy rasmiy fotosurati',
    heroFacts: [['Biznes', 'klass'], ['≥ 3,0 m', 'shift'], ['2.2', 'yakuniy bosqich']] as const,
    originIndex: 'BAYT 01 · NOM VA RITM', originTitle: 'Shoir nomi. Me’morchilik ritmi.', originText: 'Loyiha Abdurahmon Jomiy sharafiga nomlangan. Tasdiqlangan formula — “She’riyatdan ilhomlangan”. Biz shoirga uydirma iqtiboslar nisbat bermaymiz: hikoya tasdiqlangan nomdan boshlanib, fasad ritmida davom etadi.', architectureTitle: 'Yorug‘lik va material panjarasi', architectureText: 'Aralash fasadlar alyuminiy panellar, klinker plitkalar va milliy bezak elementlarini birlashtiradi. Sahifa to‘ri haqiqiy derazalar ritmi va oltin tusli fasad geometriyasiga ergashadi.', schemeCaption: 'Konseptual fotomontaj / bosqichlar sxemasi · tayyor obyekt fotosurati emas', materials: ['alyuminiy panellar', 'klinker plitkalar', 'milliy bezak elementlari'] as const,
    livedIndex: 'BAYT 02 · YASHALAYOTGAN MUHIT', livedTitle: 'Birinchi bobda hayot allaqachon boshlangan.', livedText: 'Birinchi bosqich va hovli topshirilgan. Bu bobda faqat tayyor qismning haqiqiy rasmiy fotosuratlari: fasadlar, obodonlashtirish va hollar.',
    phase21Index: 'BAYT 03 · TOPSHIRILGAN BOSQICH', phase21Title: 'Jomiy 2.1 2026-yil 28-yanvarda topshirilgan.', phase21Text: 'Rasmiy xabar ishlar yakunlanganini va ilk yashovchilar kelganini tasdiqlaydi. Bu butun majmuaga emas, aynan 2.1 bosqichiga tegishli.', phase21Date: '28.01.2026 · rasmiy xabar', phase21Address: 'API dagi 2.1 / 2.2 kartalari: Usta Shirin ko‘chasi, 21',
    phase22Index: 'BAYT 04 · YAKUNIY BOB OBRAZI', phase22Title: 'Jomiy 2.2 — yakuniy bosqich. U qurilmoqda.', phase22Text: 'Bu galereya faqat 2.2 ning kelajak obrazi uchun rasmiy CGI konsepsiyalarni ko‘rsatadi. Bular tayyor uy fotosuratlari emas; yakuniy ko‘rinish o‘zgarishi mumkin.',
    progressIndex: 'BAYT 05 · QURILISH · 2026-YIL IYUL', progressTitle: 'Oyga bog‘langan fakt.', progressText: '2026-yil iyulda monolit karkas, 7-qavat yopmasiga tayyorgarlik va parallel devor terimi qayd etilgan. Quyidagi fotosuratlar 2.2 bosqichining haqiqiy qurilishi bo‘lib, uning tayyorligini anglatmaydi.', progressFact: 'Monolit · 7-qavat yopmasi · devor terimi',
    livingIndex: 'BAYT 06 · HOVLI, HOLL, SERVIS', livingTitle: 'Kundalik hayot sokin hovli atrofida yig‘ilgan.', livingText: 'Avtomobillarsiz hovli, BBQ, xavfsiz o‘yin maydonchalari, workout, bolalar aravachasi uchun yo‘lak, qo‘shnichilik markazi va alleya tasdiqlangan. Yerosti parkingi, omborxonalar va ko‘kalamzor ham ko‘zda tutilgan.', safetyTitle: 'Xavfsizlik va boshqaruv', safetyText: 'Elektron qulflar, IP-domofoniya, 24/7 CCTV va servis kompaniyasi. Dastlabki tariflar bu yerda doimiy va’da sifatida berilmaydi.', amenities: [['Hovli', 'avtomobilsiz'], ['BBQ', 'uchrashuv joyi'], ['Workout', 'harakat uchun'], ['CCTV', '24 / 7'], ['IP', 'domofoniya'], ['Storage', 'omborxonalar']] as const,
    catalogIndex: 'BAYT 07 · KATALOG · 30.08.2026', catalogTitle: '121 pozitsiya. “Bo‘sh” holatida bittasi ham yo‘q.', catalogText: 'Bu rasmiy xonadon katalogidagi 121 taklif / pozitsiya, 121 ta kafolatlangan bo‘sh xonadon emas. Har bir karta aniq raw-holatni ko‘rsatadi va mavjudlikni aniqlashni taklif qiladi.', catalogStats: [['121', 'pozitsiya'], ['107', 'rezervdan chiqarish'], ['7', 'bekor qilish'], ['5', 'brondan chiqarish'], ['2', 'bron qilish'], ['0', 'JSON-LD Offer']] as const, catalogGroups: ['2.1 · 5 pozitsiya · topshirilgan', '2.2 · 116 pozitsiya · qurilmoqda', '40,86–124,50 m²', '1–4 xona · 1–12 qavat'], openCatalog: 'Katalogni ochish', catalogNote: 'Narxlar va kampaniyalar — 2026-yil 30-avgustdagi API nusxasi. 2.1 dagi besh pozitsiya uchun 20% muddati 31-avgustgacha, 2.2 dagi 116 pozitsiya uchun 12% muddati 31-dekabrgacha. Muddatdan so‘ng kampaniya avtomatik yakunlangan deb belgilanadi.',
    locationIndex: 'BAYT 08 · JOYLASHUV', locationTitle: 'Ikki manba — ikki manzil doirasi.', locationText: 'NRG-BI ekotizimi Shimoliy Olmazor ko‘chasi, 7 ni ko‘rsatadi. API dagi 2.1 va 2.2 bosqich kartalari Usta Shirin ko‘chasi, 21 ni ko‘rsatadi. Ikkala izoh ham alohida saqlanadi.', ecosystemAddress: 'Ekotizim · Shimoliy Olmazor ko‘chasi, 7', phaseAddress: 'Bosqich kartalari · Usta Shirin ko‘chasi, 21', panorama: 'Haqiqiy hovli panoramasi',
    contactIndex: 'CODA · MASLAHAT', contactTitle: 'Sizning satringiz bilan davom etamiz.', contactText: 'Menejer xarid maqsadini aniqlaydi va tanlangan pozitsiyaning joriy holatini qayta tekshiradi. Ariza bron hisoblanmaydi.',
    formTagline: 'She’riyatdan ilhomlangan.', formFacts: ['Biznes-klass', '121 pozitsiya', 'yakuniy 2.2 bosqich'] as const,
    media: { real: 'Haqiqiy rasmiy fotosurat', cgi: 'Rasmiy vizualizatsiya · yakuniy ko‘rinish o‘zgarishi mumkin', construction: 'Haqiqiy qurilish · 2026-yil iyul', scheme: 'Konseptual fotomontaj / bosqichlar sxemasi' },
    galleryLabel: 'Galereya', previous: 'Oldingi tasvir', next: 'Keyingi tasvir', openImage: 'Tasvirni ochish', closeImage: 'Tasvirni yopish', imageOf: 'dan',
    sources: 'Manbalar', landing: 'Rasmiy sahifa', news: 'Jomiy 2.1 topshirilishi', ecosystem: 'Ekotizim va manzil', source360: '360 panorama', noBooklet: 'Tasdiqlangan buklet yo‘q', privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga',
    disclaimer: 'CGI va sxema konsepsiyani ko‘rsatadi va o‘zgarishi mumkin. Haqiqiy fotosuratlar, qurilish va loyiha obrazlari ajratilgan. Ma’lumot va narxlar ommaviy oferta emas.',
  },
  en: {
    skip: 'Skip to content', navLabel: 'Jomiy navigation', menu: 'Contents', closeMenu: 'Close', language: 'Language',
    nav: [['origin', 'Poetry'], ['lived', 'Already lived in'], ['phase21', 'Phase 2.1'], ['phase22', 'Phase 2.2'], ['progress', 'Construction'], ['living', 'Everyday life'], ['catalog', 'Apartments'], ['location', 'Location']] as const,
    catalog: 'Choose an apartment', consult: 'Check availability', call: 'Call 1360', menuNote: 'An architectural collection · eight chapters',
    heroOverline: 'TASHKENT · NRG-BI · BUSINESS CLASS', heroTitle: 'JOMIY', heroLead: 'Inspired by poetry.', heroSublead: 'A completed part, completed phase 2.1 and the final chapter 2.2 under construction — facts and visions kept distinct.', heroImage: 'Actual official photograph of a completed part of Jomiy',
    heroFacts: [['Business', 'class'], ['≥ 3.0 m', 'ceilings'], ['2.2', 'final phase']] as const,
    originIndex: 'BAYT 01 · NAME AND RHYTHM', originTitle: 'A poet’s name. An architectural rhythm.', originText: 'The project is named after Abdurahman Jami. Its official formula is “Inspired by poetry”. We attribute no invented quotations to the poet: the story starts with the confirmed name and continues through the rhythm of the facade.', architectureTitle: 'A lattice of light and material', architectureText: 'The combined facades bring together aluminium panels, clinker tile and national decorative elements. The page grid follows the rhythm of the actual windows and the warm metallic facade geometry.', schemeCaption: 'Conceptual photomontage / phase diagram · not a photograph of a completed property', materials: ['aluminium panels', 'clinker tile', 'national decorative elements'] as const,
    livedIndex: 'BAYT 02 · A LIVED-IN SETTING', livedTitle: 'The first chapter is already lived in.', livedText: 'The first phase and courtyard have been completed. This chapter contains only actual official photographs of completed areas: facades, landscaping and lobbies.',
    phase21Index: 'BAYT 03 · COMPLETED PHASE', phase21Title: 'Jomiy 2.1 was completed on 28 January 2026.', phase21Text: 'The official announcement records completion of the works and the arrival of the first residents. This applies to phase 2.1 — not the whole project.', phase21Date: '28 Jan 2026 · official announcement', phase21Address: 'API cards for phases 2.1 / 2.2: 21 Usta Shirin Street',
    phase22Index: 'BAYT 04 · VISION FOR THE FINAL CHAPTER', phase22Title: 'Jomiy 2.2 is the final phase. It is under construction.', phase22Text: 'This gallery contains only official CGI concepts for the future phase 2.2. These are visualisations, not photographs of completed buildings; the final appearance may change.',
    progressIndex: 'BAYT 05 · CONSTRUCTION · JULY 2026', progressTitle: 'A fact tied to a month.', progressText: 'In July 2026, the monolithic frame, preparation of the seventh-floor slab and parallel wall masonry were recorded. The photographs below show actual phase 2.2 construction, not a claim of completion.', progressFact: 'Monolith · seventh-floor slab · wall masonry',
    livingIndex: 'BAYT 06 · COURTYARD, LOBBY, SERVICE', livingTitle: 'Everyday life is gathered around a calm courtyard.', livingText: 'Confirmed features include a car-free courtyard, BBQ area, safe playgrounds, workout zone, pram walking route, neighbourhood centre and avenue. Underground parking, storage rooms and landscaping are also provided.', safetyTitle: 'Security and management', safetyText: 'Electronic locks, IP intercoms, 24/7 CCTV and a service company. Preliminary tariffs are not presented here as a permanent promise.', amenities: [['Courtyard', 'car-free'], ['BBQ', 'a place to meet'], ['Workout', 'room to move'], ['CCTV', '24 / 7'], ['IP', 'intercoms'], ['Storage', 'rooms']] as const,
    catalogIndex: 'BAYT 07 · CATALOGUE · 30 AUG 2026', catalogTitle: '121 entries. None marked “Available”.', catalogText: 'These are 121 listings / entries in the official apartment catalogue, not 121 guaranteed available apartments. Every card shows the exact raw status and offers a safe availability check.', catalogStats: [['121', 'entries'], ['107', 'reservation release'], ['7', 'termination'], ['5', 'booking release'], ['2', 'booking'], ['0', 'JSON-LD Offers']] as const, catalogGroups: ['2.1 · 5 entries · completed', '2.2 · 116 entries · under construction', '40.86–124.50 m²', '1–4 rooms · floors 1–12'], openCatalog: 'Open the catalogue', catalogNote: 'Prices and campaigns are an API snapshot dated 30 August 2026. The 20% term for five phase 2.1 entries ends 31 August 2026; the 12% term for 116 phase 2.2 entries ends 31 December 2026. A campaign is automatically marked ended after its deadline.',
    locationIndex: 'BAYT 08 · LOCATION', locationTitle: 'Two addresses, each within its source context.', locationText: 'The NRG-BI ecosystem lists 7 Shimoliy Olmazor Street. The API cards for phases 2.1 and 2.2 list 21 Usta Shirin Street. Both labels remain distinct rather than being merged.', ecosystemAddress: 'Ecosystem · 7 Shimoliy Olmazor Street', phaseAddress: 'Phase cards · 21 Usta Shirin Street', panorama: 'Panorama of the actual courtyard',
    contactIndex: 'CODA · CONSULTATION', contactTitle: 'Continue with your own line.', contactText: 'A manager will clarify your purchase scenario and recheck the current status of the selected entry. An enquiry is not a reservation.',
    formTagline: 'Inspired by poetry.', formFacts: ['Business class', '121 entries', 'final phase 2.2'] as const,
    media: { real: 'Actual official photograph', cgi: 'Official visualisation · final appearance may change', construction: 'Actual construction · July 2026', scheme: 'Conceptual photomontage / phase diagram' },
    galleryLabel: 'Gallery', previous: 'Previous image', next: 'Next image', openImage: 'Open image', closeImage: 'Close image', imageOf: 'of',
    sources: 'Sources', landing: 'Official project page', news: 'Jomiy 2.1 completion', ecosystem: 'Ecosystem and address', source360: '360 panorama', noBooklet: 'No confirmed booklet is available', privacy: 'Personal data processing', top: 'Back to top',
    disclaimer: 'CGI and the diagram show concepts and may change. Actual photographs, construction and project visions are kept distinct. Information and prices are not a public offer.',
  },
} as const;

function mediaLabel(type: MediaType, language: Language) {
  const media = copy[language].media;
  return type === 'real-photo' ? media.real : type === 'construction-photo' ? media.construction : type === 'phase-scheme' ? media.scheme : media.cgi;
}

function Gallery({ slides, language, label, onOpen }: { slides: Slide[]; language: Language; label: string; onOpen: (slides: Slide[], index: number, opener: HTMLButtonElement) => void }) {
  const [index, setIndex] = useState(0);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const suppressTimer = useRef<number | null>(null);
  const t = copy[language];
  const go = (next: number) => setIndex((next + slides.length) % slides.length);
  useEffect(() => () => { if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current); }, []);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); go(index - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); go(index + 1); }
    else if (event.key === 'Home') { event.preventDefault(); go(0); }
    else if (event.key === 'End') { event.preventDefault(); go(slides.length - 1); }
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const gesture = pointer.current;
    pointer.current = null;
    if (!gesture || gesture.id !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (Math.abs(dx) <= 42 || Math.abs(dx) <= Math.abs(dy)) return;
    go(index + (dx < 0 ? 1 : -1));
    suppressClick.current = true;
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current);
    suppressTimer.current = window.setTimeout(() => { suppressClick.current = false; }, 350);
  };
  const slide = slides[index];
  return (
    <div className="jm-gallery" role="region" aria-label={`${t.galleryLabel}: ${label}`} tabIndex={0} onKeyDown={onKeyDown}>
      <button
        className="jm-gallery__image"
        type="button"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointer.current = null; }}
        onClick={(event) => {
          if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); return; }
          onOpen(slides, index, event.currentTarget);
        }}
        aria-label={`${t.openImage}: ${slide.caption[language]}`}
      >
        <img src={asset(slide.src)} alt={slide.caption[language]} loading="lazy" decoding="async" draggable={false} />
        <span>{mediaLabel(slide.type, language)}</span>
      </button>
      <div className="jm-gallery__caption"><p><strong>{String(index + 1).padStart(2, '0')}</strong><span>/ {String(slides.length).padStart(2, '0')}</span>{slide.caption[language]}</p><div><button type="button" onClick={() => go(index - 1)} aria-label={t.previous}>←</button><button type="button" onClick={() => go(index + 1)} aria-label={t.next}>→</button></div></div>
    </div>
  );
}

function Lightbox({ state, language, onClose }: { state: LightboxState; language: Language; onClose: () => void }) {
  const [index, setIndex] = useState(state.index);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const t = copy[language];
  const go = useCallback((delta: number) => setIndex((current) => (current + delta + state.slides.length) % state.slides.length), [state.slides.length]);
  const setAbsolute = useCallback((next: number) => setIndex(Math.max(0, Math.min(state.slides.length - 1, next))), [state.slides.length]);
  useEffect(() => {
    const release = lockJomiyBody();
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); return; }
      if (event.key === 'Home') { event.preventDefault(); setAbsolute(0); return; }
      if (event.key === 'End') { event.preventDefault(); setAbsolute(state.slides.length - 1); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (!panelRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); release(); window.requestAnimationFrame(() => state.opener.isConnected && state.opener.focus({ preventScroll: true })); };
  }, [go, onClose, setAbsolute, state.opener, state.slides.length]);
  const slide = state.slides[index];
  return (
    <div className="jm-lightbox" role="dialog" aria-modal="true" aria-label={slide.caption[language]}>
      <button className="jm-lightbox__backdrop" type="button" tabIndex={-1} aria-label={t.closeImage} onClick={onClose} />
      <div className="jm-lightbox__panel" ref={panelRef}>
        <header><p><strong>{index + 1}</strong> {t.imageOf} {state.slides.length} · {mediaLabel(slide.type, language)}</p><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closeImage}>×</button></header>
        <img src={asset(slide.src)} alt={slide.caption[language]} draggable={false} onPointerDown={(event) => { pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={(event) => { const gesture = pointer.current; pointer.current = null; if (!gesture || gesture.id !== event.pointerId) return; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); const dx = event.clientX - gesture.x; const dy = event.clientY - gesture.y; if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1); }} onPointerCancel={() => { pointer.current = null; }} />
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
      try { stored = localStorage.getItem(storageKey); } catch { /* URL remains authoritative. */ }
      params.set('lang', stored === 'uz' || stored === 'en' ? stored : initialLanguage);
      router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    }
    document.documentElement.lang = initialLanguage;
    try { localStorage.setItem(storageKey, initialLanguage); } catch { /* Scoped fallback is optional. */ }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (language: Language) => {
    try { localStorage.setItem(storageKey, language); } catch { /* URL remains authoritative. */ }
    const params = new URLSearchParams(window.location.search);
    params.set('lang', language);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  return [initialLanguage, setLanguage] as const;
}

function useMobileNavigation() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 960px)');
    const update = () => setMobile(query.matches);
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export function JomiyPage({ initialLanguage }: { initialLanguage: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [leadSurface, setLeadSurface] = useState<string | null>(null);
  const [activeChapter, setActiveChapter] = useState(0);
  const mobile = useMobileNavigation();
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuNavigationTargetRef = useRef<string | undefined>(undefined);
  const leadOpenRef = useRef(false);
  const t = copy[language];
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const closeLead = useCallback(() => setLeadSurface(null), []);
  const openLightbox = useCallback((slides: Slide[], index: number, opener: HTMLButtonElement) => setLightbox({ slides, index, opener }), []);
  const mobileMenuOpen = mobile && menuOpen;

  useEffect(() => {
    document.body.classList.add('jm-active');
    const frame = window.requestAnimationFrame(() => document.querySelector('.jomiy-site')?.classList.add('is-ready'));
    const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-revealed', 'true'); reveal.unobserve(entry.target); }
    }), { threshold: 0.12 });
    document.querySelectorAll('.jomiy-site [data-reveal]').forEach((node) => reveal.observe(node));
    const progress = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) setActiveChapter(Number((entry.target as HTMLElement).dataset.chapter ?? 0));
    }), { rootMargin: '-40% 0px -48% 0px', threshold: 0 });
    document.querySelectorAll('.jomiy-site [data-chapter]').forEach((node) => progress.observe(node));
    return () => { window.cancelAnimationFrame(frame); reveal.disconnect(); progress.disconnect(); document.body.classList.remove('jm-active'); };
  }, []);

  useEffect(() => {
    leadOpenRef.current = Boolean(leadSurface);
  }, [leadSurface]);

  useEffect(() => {
    if (!menuOpen) return;
    const menuToggle = menuToggleRef.current;
    const release = lockJomiyBody();
    const frame = window.requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('a,button')?.focus({ preventScroll: true }));
    const onKeyDown = (event: KeyboardEvent) => {
      if (leadOpenRef.current || event.defaultPrevented) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        return;
      }
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
  }, [menuOpen]);

  useEffect(() => leadSurface ? lockJomiyBody() : undefined, [leadSurface]);

  const selectNavigationTarget = (id: string) => {
    menuNavigationTargetRef.current = id;
    setMenuOpen(false);
  };

  const selectMenuLanguage = (next: Language) => {
    setLanguage(next);
    setMenuOpen(false);
  };

  const landingContext = `projectSlug=jomiy;lang=${language};surface=landing:${leadSurface ?? 'general'};unit=general`;
  return (
    <div className="jomiy-site" lang={language}>
      <a className="jm-skip" href="#main" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>{t.skip}</a>
      <aside className="jm-progress" aria-hidden="true" inert={mobileMenuOpen ? true : undefined}><span>{String(activeChapter + 1).padStart(2, '0')}</span><i style={{ '--jm-progress': `${((activeChapter + 1) / 9) * 100}%` } as CSSProperties} /><small>09</small></aside>
      <header className="jm-header">
        <a className="jm-wordmark" href="#top" aria-label="Jomiy" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>JOMIY<small>NRG-BI</small></a>
        <button ref={menuToggleRef} className="jm-menu-toggle" type="button" aria-expanded={menuOpen} aria-haspopup={mobile ? 'dialog' : true} aria-controls="jm-navigation" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? t.closeMenu : t.menu}</button>
        {mobile && menuOpen ? <button className="jm-menu-backdrop" type="button" tabIndex={-1} aria-label={t.closeMenu} onClick={() => setMenuOpen(false)} /> : null}
        <nav ref={menuRef} id="jm-navigation" className={menuOpen ? 'is-open' : ''} role={mobileMenuOpen && !leadSurface ? 'dialog' : undefined} aria-modal={mobileMenuOpen && !leadSurface ? true : undefined} aria-label={t.navLabel} aria-hidden={!menuOpen || Boolean(leadSurface) || undefined} inert={!menuOpen || Boolean(leadSurface) ? true : undefined}>
          <div><small>{t.menuNote}</small>{t.nav.map(([id, label], index) => <a href={`#${id}`} key={id} onClick={() => selectNavigationTarget(id)}><span>0{index + 1}</span>{label}</a>)}<div className="jm-menu-languages" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} aria-current={item === language ? 'true' : undefined} onClick={() => selectMenuLanguage(item)}>{item.toUpperCase()}</button>)}</div></div>
          <button type="button" data-lead-trigger onClick={() => setLeadSurface('menu')}>{t.consult}<span>↗</span></button>
        </nav>
        <div className="jm-header__actions" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}><div className="jm-languages" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} aria-current={item === language ? 'true' : undefined} onClick={() => setLanguage(item)}>{item.toUpperCase()}</button>)}</div><a href={withLanguage('/jomiy/apartments', language)}>{t.catalog}</a><button type="button" data-lead-trigger onClick={() => setLeadSurface('header')}>{t.consult}</button></div>
      </header>

      <main id="main" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}>
        <section className="jm-hero" id="top" data-chapter="0" aria-labelledby="jm-title">
          <div className="jm-hero__folio"><span>{t.heroOverline}</span><span>01 / 09</span></div>
          <div className="jm-hero__image"><img src={asset('/jomiy/images/hero-real.webp')} alt={t.heroImage} fetchPriority="high" draggable={false} /><span>{t.media.real}</span></div>
          <div className="jm-hero__title"><h1 id="jm-title">{t.heroTitle}</h1><p><strong>{t.heroLead}</strong>{t.heroSublead}</p><button type="button" data-lead-trigger onClick={() => setLeadSurface('hero')}>{t.consult}<span>↗</span></button></div>
          <dl>{t.heroFacts.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
        </section>

        <section className="jm-chapter jm-origin" id="origin" data-chapter="1" data-reveal>
          <header><span>{t.originIndex}</span><h2>{t.originTitle}</h2><p>{t.originText}</p></header>
          <div className="jm-origin__spread"><article><small>POETIC LATTICE</small><h3>{t.architectureTitle}</h3><p>{t.architectureText}</p><ol>{t.materials.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ol></article><figure><img src={asset('/jomiy/images/scheme-phases.webp')} alt={t.schemeCaption} loading="lazy" draggable={false} /><figcaption>{t.media.scheme}<strong>{t.schemeCaption}</strong></figcaption></figure></div>
        </section>

        <section className="jm-chapter jm-lived" id="lived" data-chapter="2" data-reveal>
          <header><span>{t.livedIndex}</span><h2>{t.livedTitle}</h2><p>{t.livedText}</p></header>
          <Gallery slides={livedSlides} language={language} label={t.livedTitle} onOpen={openLightbox} />
        </section>

        <section className="jm-chapter jm-phase21" id="phase21" data-chapter="3" data-reveal>
          <header><span>{t.phase21Index}</span><h2>{t.phase21Title}</h2><p>{t.phase21Text}</p></header>
          <div className="jm-phase21__spread"><figure><img src={asset('/jomiy/images/real-09.webp')} alt={livedSlides[7].caption[language]} loading="lazy" draggable={false} /><figcaption>{t.media.real}</figcaption></figure><aside><strong>2.1</strong><p>{t.phase21Date}</p><span>{t.phase21Address}</span><a href="https://nrg-bi.uz/uz-ru/news/jomiy-2.1-uspeshno-sdana!" target="_blank" rel="noreferrer">{t.news} ↗</a></aside></div>
        </section>

        <section className="jm-chapter jm-phase22" id="phase22" data-chapter="4" data-reveal>
          <header><span>{t.phase22Index}</span><h2>{t.phase22Title}</h2><p>{t.phase22Text}</p></header>
          <Gallery slides={cgiSlides} language={language} label={t.phase22Title} onOpen={openLightbox} />
        </section>

        <section className="jm-chapter jm-construction" id="progress" data-chapter="5" data-reveal>
          <header><span>{t.progressIndex}</span><h2>{t.progressTitle}</h2><p>{t.progressText}</p><strong>{t.progressFact}</strong></header>
          <Gallery slides={constructionSlides} language={language} label={t.progressTitle} onOpen={openLightbox} />
        </section>

        <section className="jm-chapter jm-living" id="living" data-chapter="6" data-reveal>
          <header><span>{t.livingIndex}</span><h2>{t.livingTitle}</h2><p>{t.livingText}</p></header>
          <div className="jm-living__grid"><figure><img src={asset('/jomiy/images/real-06.webp')} alt={livedSlides[4].caption[language]} loading="lazy" draggable={false} /><figcaption>{t.media.real}</figcaption></figure><article><small>SECURITY / SERVICE</small><h3>{t.safetyTitle}</h3><p>{t.safetyText}</p></article><dl>{t.amenities.map(([title, note], index) => <div key={title}><dt><span>0{index + 1}</span>{title}</dt><dd>{note}</dd></div>)}</dl></div>
        </section>

        <section className="jm-chapter jm-catalog" id="catalog" data-chapter="7" data-reveal>
          <header><span>{t.catalogIndex}</span><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header>
          <div className="jm-catalog__panel"><dl>{t.catalogStats.map(([value, label]) => <div key={label}><dt>{value}</dt><dd>{label}</dd></div>)}</dl><ul>{t.catalogGroups.map((group) => <li key={group}>{group}</li>)}</ul><div><p>{t.catalogNote}</p><a href={withLanguage('/jomiy/apartments', language)}>{t.openCatalog}<span>↗</span></a><button type="button" data-lead-trigger onClick={() => setLeadSurface('catalog-preview')}>{t.consult}</button></div></div>
        </section>

        <section className="jm-chapter jm-location" id="location" data-chapter="8" data-reveal>
          <header><span>{t.locationIndex}</span><h2>{t.locationTitle}</h2><p>{t.locationText}</p></header>
          <div className="jm-location__map" aria-label={t.locationTitle}><span>41.35142° N</span><span>69.25746° E</span><i aria-hidden="true" /><strong>JOMIY</strong><address>{t.ecosystemAddress}</address><address>{t.phaseAddress}</address><a href="https://uzbekistan360.uz/ru/location/nrg-jomiy-vid-so-dvoraOWb" target="_blank" rel="noreferrer">{t.panorama} ↗</a></div>
        </section>

        <section className="jm-contact" id="contacts" data-reveal>
          <span>{t.contactIndex}</span><h2>{t.contactTitle}</h2><p>{t.contactText}</p><div><button type="button" data-lead-trigger onClick={() => setLeadSurface('final')}>{t.consult}<span>↗</span></button><a href="tel:1360">{t.call}</a></div>
        </section>
      </main>

      <footer className="jm-footer" aria-hidden={mobileMenuOpen || undefined} inert={mobileMenuOpen ? true : undefined}><div><strong>JOMIY</strong><span>{t.heroLead}</span></div><nav aria-label={t.sources}><a href={language === 'uz' ? 'https://nrg-bi.uz/uz/landing/jomiy' : 'https://nrg-bi.uz/uz-ru/landing/jomiy'} target="_blank" rel="noreferrer">{t.landing} ↗</a><a href="https://nrg-bi.uz/uz-ru/news/jomiy-2.1-uspeshno-sdana!" target="_blank" rel="noreferrer">{t.news} ↗</a><a href="https://nrg-bi.uz/uz-ru/special/ecosystem" target="_blank" rel="noreferrer">{t.ecosystem} ↗</a><a href="https://uzbekistan360.uz/ru/location/nrg-jomiy-vid-so-dvoraOWb" target="_blank" rel="noreferrer">{t.source360} ↗</a><a href={`${appBasePath}/privacy?project=jomiy&lang=${language}&from=landing`}>{t.privacy} ↗</a><span>{t.noBooklet}</span></nav><p>{t.disclaimer}</p><a href="#top">{t.top} ↑</a></footer>

      {lightbox ? <Lightbox state={lightbox} language={language} onClose={closeLightbox} /> : null}
      <LeadModal open={Boolean(leadSurface)} language={language} context={landingContext} brandName="NRG-BI" projectName="JOMIY" tagline={t.formTagline} facts={t.formFacts} submitUrl={jomiyLeadSubmitUrl()} projectSlug="jomiy" privacyUrl={`${appBasePath}/privacy?project=jomiy&lang=${language}&from=landing`} requireConsent onClose={closeLead} />
    </div>
  );
}
