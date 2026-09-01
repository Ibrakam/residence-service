'use client';

/* eslint-disable @next/next/no-img-element */

import { usePathname, useRouter } from 'next/navigation';
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LeadModal } from '@/app/lead-modal';
import { regnumLeadContext, regnumLeadSubmitUrl, rememberRegnumUnit, type RegnumUnit } from './regnum-lead';
import { lockRegnumBody, type RegnumLanguage as Language } from './regnum-ui';

type MediaType = 'real-first-phase' | 'documentary-opening' | 'cgi-full-project' | 'archival-cgi-concept' | 'official-plan';
type Localized = Record<Language, string>;
type Slide = { src: string; width: number; height: number; type: MediaType; title: Localized; caption: Localized };
type LightboxState = { slides: Slide[]; index: number; opener: HTMLButtonElement };
type LeadRequest = { surface: string; unit: RegnumUnit | null; opener: HTMLElement | null };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const appBasePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}` : '';
const asset = (path: string) => `${appBasePath}${path}`;
const withLanguage = (path: string, language: Language) => `${appBasePath}${path}?lang=${language}`;
const languages: Language[] = ['ru', 'uz', 'en'];
const storageKey = 'regnum-plaza-language';

const mediaLabels: Record<MediaType, Localized> = {
  'real-first-phase': { ru: 'Реальная первая очередь', uz: 'Haqiqiy birinchi bosqich', en: 'Actual first phase' },
  'documentary-opening': { ru: 'Документальная съёмка открытия', uz: 'Ochilishning hujjatli tasvirlari', en: 'Documentary opening photography' },
  'cgi-full-project': { ru: 'CGI полного проекта · итог может измениться', uz: 'Butun loyiha CGI tasviri · yakuniy ko‘rinish o‘zgarishi mumkin', en: 'Full-project CGI · final appearance may change' },
  'archival-cgi-concept': { ru: 'Архивный концепт · не текущая фотография', uz: 'Arxiv konsepti · joriy fotosurat emas', en: 'Archival concept · not a current photograph' },
  'official-plan': { ru: 'Официальная планировка', uz: 'Rasmiy reja', en: 'Official plan' },
};

const architectureSlides: Slide[] = [
  { src: '/regnum-plaza/images/architecture-copper.webp', width: 1018, height: 852, type: 'real-first-phase', title: { ru: 'Медный ритм', uz: 'Mis ritmi', en: 'Copper rhythm' }, caption: { ru: 'Реальная деталь фасада открытой первой очереди: тёплые металлические рамы ловят свет.', uz: 'Ochilgan birinchi bosqich fasadining haqiqiy detali: iliq metall ramalar yorug‘likni tutadi.', en: 'An actual facade detail from the opened first phase: warm metal frames catch the light.' } },
  { src: '/regnum-plaza/images/architecture-geometry.webp', width: 1018, height: 852, type: 'real-first-phase', title: { ru: 'Глубина проёма', uz: 'O‘yiq chuqurligi', en: 'Aperture depth' }, caption: { ru: 'Реальная динамическая геометрия: выступы и ниши меняют рисунок света и тени.', uz: 'Haqiqiy dinamik geometriya: bo‘rtmalar va o‘yiqlar yorug‘lik-soya chizig‘ini o‘zgartiradi.', en: 'Actual dynamic geometry: projections and recesses reshape light and shadow.' } },
  { src: '/regnum-plaza/images/architecture-brick.webp', width: 1018, height: 852, type: 'real-first-phase', title: { ru: 'Клинкер и контраст', uz: 'Klinker va kontrast', en: 'Clinker and contrast' }, caption: { ru: 'Реальная фактура клинкера рядом с гладкими графитовыми и медными поверхностями.', uz: 'Klinkerning haqiqiy fakturasi silliq grafit va mis yuzalar bilan yonma-yon.', en: 'Actual clinker texture set against smooth graphite and copper surfaces.' } },
];

const amenityData: Array<[string, number, number, Localized, Localized]> = [
  ['amenity-lounge.webp', 1280, 791, { ru: 'Lounge-зоны', uz: 'Lounge hududlari', en: 'Lounge areas' }, { ru: 'Общие зоны для спокойной паузы и общения.', uz: 'Tinch dam olish va muloqot uchun umumiy joylar.', en: 'Shared spaces for a quiet pause and conversation.' }],
  ['amenity-sport.webp', 1280, 791, { ru: 'Спортплощадка', uz: 'Sport maydonchasi', en: 'Sports court' }, { ru: 'Мультифункциональная площадка открытой первой очереди.', uz: 'Ochilgan birinchi bosqichdagi ko‘p funksiyali maydoncha.', en: 'A multi-purpose court in the opened first phase.' }],
  ['amenity-workout.webp', 1280, 791, { ru: 'Workout и бег', uz: 'Workout va yugurish', en: 'Workout and running' }, { ru: 'Workout-зона и маршрут для бега.', uz: 'Workout hududi va yugurish yo‘nalishi.', en: 'A workout zone and running route.' }],
  ['amenity-fitness-women.webp', 1280, 791, { ru: 'Женский фитнес', uz: 'Ayollar fitnesi', en: 'Women’s fitness' }, { ru: 'Отдельный женский фитнес-зал.', uz: 'Alohida ayollar fitnes zali.', en: 'A separate women’s fitness room.' }],
  ['amenity-fitness-men.webp', 1280, 791, { ru: 'Мужской фитнес', uz: 'Erkaklar fitnesi', en: 'Men’s fitness' }, { ru: 'Отдельный мужской фитнес-зал.', uz: 'Alohida erkaklar fitnes zali.', en: 'A separate men’s fitness room.' }],
  ['amenity-event.webp', 1280, 791, { ru: 'Event-комнаты', uz: 'Tadbir xonalari', en: 'Event rooms' }, { ru: 'Комнаты для встреч и событий резидентов.', uz: 'Rezidentlar uchrashuvlari va tadbirlari uchun xonalar.', en: 'Rooms for resident gatherings and events.' }],
  ['amenity-library.webp', 1280, 791, { ru: 'Библиотека', uz: 'Kutubxona', en: 'Library' }, { ru: 'Тихое пространство для чтения и работы.', uz: 'O‘qish va ishlash uchun sokin joy.', en: 'A quiet space for reading and work.' }],
  ['amenity-dry-cleaning.webp', 1280, 1461, { ru: 'Химчистка', uz: 'Kimyoviy tozalash', en: 'Dry cleaning' }, { ru: 'Бытовой сервис внутри среды проекта.', uz: 'Loyiha muhitidagi maishiy xizmat.', en: 'An everyday service within the project environment.' }],
  ['amenity-children.webp', 1280, 791, { ru: 'Детские зоны', uz: 'Bolalar hududlari', en: 'Children’s areas' }, { ru: 'Закрытые и открытые пространства для детей.', uz: 'Bolalar uchun yopiq va ochiq joylar.', en: 'Indoor and outdoor spaces for children.' }],
  ['amenity-music.webp', 1280, 791, { ru: 'Музыкальная комната', uz: 'Musiqa xonasi', en: 'Music room' }, { ru: 'Отдельное пространство для музыки.', uz: 'Musiqa uchun alohida joy.', en: 'A dedicated room for music.' }],
  ['amenity-game.webp', 1280, 791, { ru: 'Game zone', uz: 'O‘yin hududi', en: 'Game zone' }, { ru: 'Игровое пространство для резидентов.', uz: 'Rezidentlar uchun o‘yin maydoni.', en: 'A play space for residents.' }],
  ['amenity-parking.webp', 1280, 791, { ru: 'Паркинг', uz: 'Parking', en: 'Parking' }, { ru: 'CCTV, места и зарядки для электромобилей.', uz: 'CCTV, elektromobillar uchun joylar va quvvatlash.', en: 'CCTV, EV spaces and charging.' }],
  ['amenity-carwash.webp', 1280, 970, { ru: 'Автомойка', uz: 'Avtoyuvish', en: 'Car wash' }, { ru: 'Автомойка в сервисной инфраструктуре.', uz: 'Servis infratuzilmasidagi avtoyuvish.', en: 'A car wash within the service infrastructure.' }],
  ['amenity-bakery.webp', 1280, 847, { ru: 'Пекарня', uz: 'Nonvoyxona', en: 'Bakery' }, { ru: 'Пекарня в повседневной инфраструктуре.', uz: 'Kundalik infratuzilmadagi nonvoyxona.', en: 'A bakery in the everyday amenity mix.' }],
];
const amenitySlides: Slide[] = amenityData.map(([file, width, height, title, caption]) => ({ src: `/regnum-plaza/images/${file}`, width, height, type: 'real-first-phase', title, caption }));

const openingSlides: Slide[] = ['opening-cover', 'opening-1', 'opening-4', 'opening-6'].map((name, index) => ({
  src: `/regnum-plaza/images/${name}.webp`, width: 900, height: 600, type: 'documentary-opening',
  title: { ru: `Открытие первой очереди · ${index + 1}`, uz: `Birinchi bosqich ochilishi · ${index + 1}`, en: `First-phase opening · ${index + 1}` },
  caption: { ru: 'Документальная фотография официального открытия первой очереди 20 мая. Год в статье не указан.', uz: '20-maydagi birinchi bosqich rasmiy ochilishining hujjatli fotosurati. Maqolada yil ko‘rsatilmagan.', en: 'Documentary photography from the official first-phase opening on 20 May. The article does not state the year.' },
}));
const cgiSlides: Slide[] = [
  { src: '/regnum-plaza/images/full-project-cgi.webp', width: 1500, height: 904, type: 'cgi-full-project', title: { ru: 'Полный проект', uz: 'Butun loyiha', en: 'Full project' }, caption: { ru: 'Официальная CGI-визуализация полного проекта. Это не фотография готового комплекса; итоговый вид может измениться.', uz: 'Butun loyihaning rasmiy CGI tasviri. Bu tayyor majmua fotosurati emas; yakuniy ko‘rinish o‘zgarishi mumkin.', en: 'Official full-project CGI. This is not a photograph of a completed development; the final appearance may change.' } },
  { src: '/regnum-plaza/images/genplan-cgi.webp', width: 1800, height: 909, type: 'cgi-full-project', title: { ru: 'Генплан', uz: 'Bosh reja', en: 'Masterplan' }, caption: { ru: 'Официальная CGI-схема полного проекта из 11 блоков. Итоговое исполнение может измениться.', uz: '11 blokdan iborat butun loyihaning rasmiy CGI sxemasi. Yakuniy ijro o‘zgarishi mumkin.', en: 'Official CGI plan of the full 11-block project. Final execution may change.' } },
];
const archiveSlides: Slide[] = ['archival-cover', 'archival-12', 'archival-13', 'archival-14'].map((name, index) => ({
  src: `/regnum-plaza/images/${name}.webp`, width: index ? 1200 : 1218, height: 850, type: 'archival-cgi-concept',
  title: { ru: `Архивный концепт · ${index + 1}`, uz: `Arxiv konsepti · ${index + 1}`, en: `Archival concept · ${index + 1}` },
  caption: { ru: 'CGI из исторической launch-статьи. Это архивный образ, а не доказательство текущей реализации сервиса или пространства.', uz: 'Tarixiy launch-maqoladagi CGI. Bu arxiv obrazi, joriy xizmat yoki makon amalga oshirilganining isboti emas.', en: 'CGI from the historical launch article. It is an archival vision, not evidence that a service or space currently operates.' },
}));

const copy = {
  ru: {
    skip: 'К содержанию', navLabel: 'Навигация Regnum Plaza', menu: 'Меню', close: 'Закрыть', language: 'Язык',
    nav: [['architecture', 'Архитектура'], ['reality', 'Индекс реальности'], ['genplan', 'Генплан'], ['amenities', 'Среда'], ['location', 'Локация'], ['apartments', 'Квартиры']] as const,
    apartments: 'Выбрать квартиру', consult: 'Получить консультацию', call: 'Позвонить',
    heroEyebrow: 'COPPER APERTURES · БИЗНЕС-КЛАСС · САЙРАМ', heroTitle: 'Свет входит через медь.', heroText: 'Фасад первой очереди уже работает как точный прибор: глубокие графитовые ниши, клинкер и тёплые рамы меняются вместе с ташкентским светом.',
    heroFacts: [['Последние квартиры', 'статус'], ['IV квартал 2026', 'срок проекта'], ['10 лет', 'страхование квартир']] as const, heroImage: 'Реальная фотография открытой первой очереди Regnum Plaza',
    architectureEyebrow: '01 · АРХИТЕКТУРА СВЕТА', architectureTitle: 'Три фактуры. Один меняющийся фасад.', architectureText: 'Медь и золото ташкентского заката прочитаны без декоративного шума: вертикальные рамы, глубокие ниши и клинкер дают фасаду разный характер утром, днём и вечером.',
    realityEyebrow: '02 · ИНДЕКС РЕАЛЬНОСТИ', realityTitle: 'Факт, документ, проектный образ — отдельно.', realityText: 'Мы не смешиваем готовую среду с визуализациями. Каждая поверхность получает собственную подпись и источник.',
    realityCards: ['Реальная первая очередь', 'Документальное открытие', 'CGI полного проекта', 'Архивные концепты'] as const,
    videoTitle: '24 секунды реального пространства', videoText: 'Официальное видео открытой первой очереди · без звука.', tour: 'Открыть официальный 360-тур', openGallery: 'Открыть галерею',
    genplanEyebrow: '03 · ГЕНПЛАН', genplanTitle: 'Один адрес. Одиннадцать блоков.', genplanText: 'CGI показывает полный проект, а цифры относятся к официальной карточке Regnum Plaza. Визуализация не является фотографией готового комплекса.', genplanFacts: [['11', 'блоков'], ['776', 'квартир'], ['3', 'очереди'], ['30 000 м²', 'территория']] as const,
    amenitiesEyebrow: '04 · СРЕДА ПЕРВОЙ ОЧЕРЕДИ', amenitiesTitle: 'День не заканчивается у двери квартиры.', amenitiesText: 'Реальные фотографии показывают пространства открытой первой очереди. Нажмите на кадр для полноэкранного просмотра.', amenitiesLead: 'Уточнить среду и доступность',
    lobbyEyebrow: '05 · ЛОББИ БЕЗ ПОРОГОВ', lobbyTitle: 'От витража — прямо во двор.', lobbyText: 'Большие витражные окна, мягкий свет и лифт прямо в приватный двор без ступеней. Официальное описание также заявляет постаматы, скоростные лифты и металлические двери.', barrier: ['лифт во двор', 'без ступеней', 'постаматы', 'мягкий свет'] as const,
    locationEyebrow: '06 · САЙРАМ', locationTitle: 'Два проверенных адреса.', locationText: 'Проект и офис продаж отмечены официальными координатами. Время до объектов рядом воспроизводит подписи официальной карты и не является нашим расчётом.', projectAddress: 'Проект · ул. Сайрам', salesAddress: 'Офис продаж · ул. Ойбека, 38A', maps: 'Открыть карту', nearby: 'Рядом по официальной карте', nearbyFacts: [['3 мин', 'Yaponamama'], ['4 мин', 'Семейная поликлиника № 4'], ['5 мин', 'Школа № 225'], ['5 мин', 'Детский сад № 332'], ['6 мин', 'Korzinka']] as const,
    catalogEyebrow: '07 · КВАРТИРНЫЙ СРЕЗ · 31.08.2026', catalogTitle: '12 предложений. Цена — по запросу.', catalogText: 'Все 12 записей имеют официальный статус AVAILABLE. Числовые цены не публикуются; каталог использует внутренние значения среза только для сортировки и точного контекста заявки.', catalogStats: [['12', 'предложений'], ['38,48–249,27 м²', 'площадь'], ['1–4', 'комнаты'], ['6', 'официальных планировок']] as const, number: 'Квартира №', rooms: 'комн.', floor: 'этаж', queue: 'очередь', section: 'секция', price: 'По запросу', missingPlan: 'Официальная планировка не опубликована', allApartments: 'Открыть полный каталог', askUnit: 'Уточнить квартиру',
    contactEyebrow: '08 · КОНСУЛЬТАЦИЯ', contactTitle: 'Выберите свой проём в город.', contactText: 'Менеджер перепроверит текущую доступность и подготовит подборку. Заявка не является бронированием.', office: 'Офис продаж', project: 'Проект', privacy: 'Обработка персональных данных', top: 'Наверх',
    lightbox: 'Просмотр изображения', previous: 'Предыдущее', next: 'Следующее', closeImage: 'Закрыть изображение', imageOf: 'из',
    formTagline: 'Свет входит через медь.', formFacts: ['Бизнес-класс', 'Сайрам', 'IV квартал 2026'] as const,
    disclaimer: 'Реальные фото и видео первой очереди, документальная съёмка открытия, CGI полного проекта и архивные концепты разделены. CGI может измениться. Информация не является публичной офертой.',
  },
  uz: {
    skip: 'Mazmunga o‘tish', navLabel: 'Regnum Plaza navigatsiyasi', menu: 'Menyu', close: 'Yopish', language: 'Til',
    nav: [['architecture', 'Arxitektura'], ['reality', 'Haqiqat indeksi'], ['genplan', 'Bosh reja'], ['amenities', 'Muhit'], ['location', 'Joylashuv'], ['apartments', 'Xonadonlar']] as const,
    apartments: 'Xonadon tanlash', consult: 'Maslahat olish', call: 'Qo‘ng‘iroq qilish',
    heroEyebrow: 'COPPER APERTURES · BIZNES-KLASS · SAYRAM', heroTitle: 'Yorug‘lik mis orqali kiradi.', heroText: 'Birinchi bosqich fasadi aniq asbobdek ishlaydi: chuqur grafit o‘yiqlar, klinker va iliq ramalar Toshkent yorug‘ligi bilan birga o‘zgaradi.',
    heroFacts: [["Eng so'nggi kvartiralar", 'holat'], ['2026-yil IV chorak', 'loyiha muddati'], ['10 yil', 'xonadon sug‘urtasi']] as const, heroImage: 'Regnum Plaza ochilgan birinchi bosqichining haqiqiy fotosurati',
    architectureEyebrow: '01 · YORUG‘LIK ARXITEKTURASI', architectureTitle: 'Uch faktura. O‘zgaruvchan bir fasad.', architectureText: 'Toshkent quyosh botishidagi mis va oltin dekorativ shovqinsiz talqin qilingan: vertikal ramalar, chuqur o‘yiqlar va klinker fasadga kun davomida turli xarakter beradi.',
    realityEyebrow: '02 · HAQIQAT INDEKSI', realityTitle: 'Fakt, hujjat va loyiha obrazi — alohida.', realityText: 'Tayyor muhitni vizualizatsiya bilan aralashtirmaymiz. Har bir yuzaga o‘z yorlig‘i va manbasi berilgan.', realityCards: ['Haqiqiy birinchi bosqich', 'Hujjatli ochilish', 'Butun loyiha CGI', 'Arxiv konseptlari'] as const,
    videoTitle: 'Haqiqiy makonning 24 soniyasi', videoText: 'Ochilgan birinchi bosqichning rasmiy videosi · ovozsiz.', tour: 'Rasmiy 360-turni ochish', openGallery: 'Galereyani ochish',
    genplanEyebrow: '03 · BOSH REJA', genplanTitle: 'Bir manzil. O‘n bir blok.', genplanText: 'CGI butun loyihani ko‘rsatadi, raqamlar esa Regnum Plaza rasmiy kartasidan. Vizualizatsiya tayyor majmuaning fotosurati emas.', genplanFacts: [['11', 'blok'], ['776', 'xonadon'], ['3', 'bosqich'], ['30 000 m²', 'hudud']] as const,
    amenitiesEyebrow: '04 · BIRINCHI BOSQICH MUHITI', amenitiesTitle: 'Kun xonadon eshigida tugamaydi.', amenitiesText: 'Haqiqiy fotosuratlar ochilgan birinchi bosqich makonlarini ko‘rsatadi. To‘liq ekran uchun kadrni bosing.', amenitiesLead: 'Muhit va mavjudlikni aniqlash',
    lobbyEyebrow: '05 · TO‘SIQSIZ LOBBI', lobbyTitle: 'Vitrajdan — to‘g‘ri hovliga.', lobbyText: 'Katta vitraj oynalar, yumshoq yorug‘lik va zinapoyasiz xususiy hovliga to‘g‘ri lift. Rasmiy tavsif postamatlar, tezkor liftlar va metall eshiklarni ham bayon qiladi.', barrier: ['hovliga lift', 'zinapoyasiz', 'postamatlar', 'yumshoq yorug‘lik'] as const,
    locationEyebrow: '06 · SAYRAM', locationTitle: 'Ikki tasdiqlangan manzil.', locationText: 'Loyiha va savdo ofisi rasmiy koordinatalar bilan belgilangan. Yaqin joylargacha vaqt rasmiy xarita yorliqlaridan olinadi va bizning hisobimiz emas.', projectAddress: 'Loyiha · Sayram ko‘chasi', salesAddress: 'Savdo ofisi · Oybek ko‘chasi, 38A', maps: 'Xaritani ochish', nearby: 'Rasmiy xarita bo‘yicha yaqin', nearbyFacts: [['3 daq', 'Yaponamama'], ['4 daq', '4-son oilaviy poliklinika'], ['5 daq', '225-son maktab'], ['5 daq', '332-son bolalar bog‘chasi'], ['6 daq', 'Korzinka']] as const,
    catalogEyebrow: '07 · XONADON KESIMI · 31.08.2026', catalogTitle: '12 taklif. Narx — so‘rov bo‘yicha.', catalogText: 'Barcha 12 yozuv rasmiy AVAILABLE holatida. Raqamli narxlar e’lon qilinmaydi; katalog ichki kesim qiymatlaridan faqat saralash va aniq ariza konteksti uchun foydalanadi.', catalogStats: [['12', 'taklif'], ['38,48–249,27 m²', 'maydon'], ['1–4', 'xona'], ['6', 'rasmiy reja']] as const, number: 'Xonadon №', rooms: 'xona', floor: 'qavat', queue: 'bosqich', section: 'seksiya', price: 'So‘rov bo‘yicha', missingPlan: 'Rasmiy reja e’lon qilinmagan', allApartments: 'To‘liq katalogni ochish', askUnit: 'Xonadonni aniqlash',
    contactEyebrow: '08 · MASLAHAT', contactTitle: 'Shaharga o‘z oynangizni tanlang.', contactText: 'Menejer joriy mavjudlikni qayta tekshiradi va tanlov tayyorlaydi. Ariza bron hisoblanmaydi.', office: 'Savdo ofisi', project: 'Loyiha', privacy: 'Shaxsiy ma’lumotlarni qayta ishlash', top: 'Yuqoriga',
    lightbox: 'Tasvirni ko‘rish', previous: 'Oldingi', next: 'Keyingi', closeImage: 'Tasvirni yopish', imageOf: 'dan', formTagline: 'Yorug‘lik mis orqali kiradi.', formFacts: ['Biznes-klass', 'Sayram', '2026-yil IV chorak'] as const,
    disclaimer: 'Birinchi bosqichning haqiqiy foto va videosi, ochilish hujjatlari, butun loyiha CGI va arxiv konseptlari ajratilgan. CGI o‘zgarishi mumkin. Ma’lumot ommaviy oferta emas.',
  },
  en: {
    skip: 'Skip to content', navLabel: 'Regnum Plaza navigation', menu: 'Menu', close: 'Close', language: 'Language',
    nav: [['architecture', 'Architecture'], ['reality', 'Reality index'], ['genplan', 'Masterplan'], ['amenities', 'Amenities'], ['location', 'Location'], ['apartments', 'Apartments']] as const,
    apartments: 'Choose an apartment', consult: 'Get a consultation', call: 'Call',
    heroEyebrow: 'COPPER APERTURES · BUSINESS CLASS · SAYRAM', heroTitle: 'Light enters through copper.', heroText: 'The first-phase facade already works like a precise instrument: deep graphite recesses, clinker and warm frames change with Tashkent light.',
    heroFacts: [['Last Remaining Apartments', 'status'], ['Q4 2026', 'project completion'], ['10 years', 'apartment insurance']] as const, heroImage: 'Actual photograph of the opened first phase at Regnum Plaza',
    architectureEyebrow: '01 · ARCHITECTURE OF LIGHT', architectureTitle: 'Three textures. One changing facade.', architectureText: 'The copper and gold of a Tashkent sunset are translated without decorative noise: vertical frames, deep recesses and clinker give the facade a different character throughout the day.',
    realityEyebrow: '02 · REALITY INDEX', realityTitle: 'Fact, document and design image — kept apart.', realityText: 'We do not mix completed environments with visualisations. Every surface carries its own label and source.', realityCards: ['Actual first phase', 'Documentary opening', 'Full-project CGI', 'Archival concepts'] as const,
    videoTitle: '24 seconds of actual space', videoText: 'Official video of the opened first phase · silent.', tour: 'Open the official 360 tour', openGallery: 'Open gallery',
    genplanEyebrow: '03 · MASTERPLAN', genplanTitle: 'One address. Eleven blocks.', genplanText: 'The CGI shows the full project, while the figures come from the official Regnum Plaza record. It is not a photograph of a completed development.', genplanFacts: [['11', 'blocks'], ['776', 'apartments'], ['3', 'phases'], ['30,000 m²', 'site']] as const,
    amenitiesEyebrow: '04 · FIRST-PHASE AMENITIES', amenitiesTitle: 'The day does not end at your apartment door.', amenitiesText: 'Actual photographs show spaces in the opened first phase. Select a frame for full-screen viewing.', amenitiesLead: 'Ask about amenities and availability',
    lobbyEyebrow: '05 · STEP-FREE LOBBY', lobbyTitle: 'From stained glass — straight to the courtyard.', lobbyText: 'Large stained-glass windows, soft light and a lift directly to the private courtyard without steps. The official description also states parcel lockers, high-speed lifts and metal doors.', barrier: ['lift to courtyard', 'step-free', 'parcel lockers', 'soft light'] as const,
    locationEyebrow: '06 · SAYRAM', locationTitle: 'Two verified addresses.', locationText: 'The project and sales office are pinned by official coordinates. Nearby travel times reproduce labels from the official map and are not our calculation.', projectAddress: 'Project · Sayram Street', salesAddress: 'Sales office · 38A Oybek Street', maps: 'Open map', nearby: 'Nearby on the official map', nearbyFacts: [['3 min', 'Yaponamama'], ['4 min', 'Family clinic no. 4'], ['5 min', 'School no. 225'], ['5 min', 'Kindergarten no. 332'], ['6 min', 'Korzinka']] as const,
    catalogEyebrow: '07 · APARTMENT SNAPSHOT · 31 AUG 2026', catalogTitle: '12 listings. Price on request.', catalogText: 'All 12 records carry the official AVAILABLE status. Numeric prices are not published; the catalogue uses internal snapshot values only for sorting and exact lead context.', catalogStats: [['12', 'listings'], ['38.48–249.27 m²', 'area'], ['1–4', 'rooms'], ['6', 'official plans']] as const, number: 'Apartment no.', rooms: 'rooms', floor: 'floor', queue: 'phase', section: 'section', price: 'Price on request', missingPlan: 'Official plan has not been published', allApartments: 'Open full catalogue', askUnit: 'Ask about this apartment',
    contactEyebrow: '08 · CONSULTATION', contactTitle: 'Choose your aperture onto the city.', contactText: 'A manager will re-check current availability and prepare a selection. A request is not a reservation.', office: 'Sales office', project: 'Project', privacy: 'Personal data processing', top: 'Back to top',
    lightbox: 'Image viewer', previous: 'Previous', next: 'Next', closeImage: 'Close image', imageOf: 'of', formTagline: 'Light enters through copper.', formFacts: ['Business class', 'Sayram', 'Q4 2026'] as const,
    disclaimer: 'Actual first-phase photos/video, documentary opening photography, full-project CGI and archival concepts are separated. CGI may change. Information is not a public offer.',
  },
} as const;

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
    try { localStorage.setItem(storageKey, initialLanguage); } catch { /* Optional fallback only. */ }
  }, [initialLanguage, pathname, router]);
  const setLanguage = (language: Language) => {
    try { localStorage.setItem(storageKey, language); } catch { /* URL remains authoritative. */ }
    const params = new URLSearchParams(window.location.search);
    params.set('lang', language);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
  };
  return [initialLanguage, setLanguage] as const;
}

function Lightbox({ state, language, onClose, onChange }: { state: LightboxState; language: Language; onClose: () => void; onChange: (index: number) => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
  const latest = useRef({ state, onChange });
  useEffect(() => { latest.current = { state, onChange }; }, [state, onChange]);
  const t = copy[language];
  const slide = state.slides[state.index];
  const go = useCallback((delta: number) => {
    const current = latest.current;
    current.onChange((current.state.index + delta + current.state.slides.length) % current.state.slides.length);
  }, []);

  useEffect(() => {
    const opener = latest.current.state.opener;
    const unlock = lockRegnumBody();
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal')) return;
      const current = latest.current;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'ArrowLeft' && current.state.slides.length > 1) { event.preventDefault(); go(-1); return; }
      if (event.key === 'ArrowRight' && current.state.slides.length > 1) { event.preventDefault(); go(1); return; }
      if (event.key === 'Home' && current.state.slides.length > 1) { event.preventDefault(); current.onChange(0); return; }
      if (event.key === 'End' && current.state.slides.length > 1) { event.preventDefault(); current.onChange(current.state.slides.length - 1); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href]'));
      const first = focusable[0]; const last = focusable.at(-1);
      if (!first || !last) return;
      if (!dialogRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlock(); window.requestAnimationFrame(() => opener.isConnected && opener.focus({ preventScroll: true })); };
  }, [go, onClose]);

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (state.slides.length < 2) return;
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointer.current; pointer.current = null;
    if (!gesture || gesture.id !== event.pointerId || state.slides.length < 2) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = event.clientX - gesture.x; const dy = event.clientY - gesture.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  return <div className="rp-lightbox" role="dialog" aria-modal="true" aria-label={t.lightbox}>
    <button className="rp-lightbox__backdrop" type="button" tabIndex={-1} onClick={onClose} aria-label={t.closeImage} />
    <div ref={dialogRef} className="rp-lightbox__dialog">
      <header><span>{mediaLabels[slide.type][language]}</span><strong>{state.index + 1} / {state.slides.length}</strong><button ref={closeRef} type="button" onClick={onClose} aria-label={t.closeImage}>×</button></header>
      <div className="rp-lightbox__stage" onPointerDown={pointerDown} onPointerUp={pointerUp} onPointerCancel={() => { pointer.current = null; }}>
        <img src={asset(slide.src)} width={slide.width} height={slide.height} alt={slide.caption[language]} draggable={false} />
      </div>
      <footer><div><h2>{slide.title[language]}</h2><p>{slide.caption[language]}</p></div>{state.slides.length > 1 ? <nav aria-label={`${t.imageOf} ${state.slides.length}`}><button type="button" onClick={() => go(-1)} aria-label={t.previous}>←</button><button type="button" onClick={() => go(1)} aria-label={t.next}>→</button></nav> : null}</footer>
    </div>
  </div>;
}

export function RegnumPlazaPage({ initialLanguage, previewUnits }: { initialLanguage: Language; previewUnits: RegnumUnit[] }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);
  const [lead, setLead] = useState<LeadRequest | null>(null);
  const menuRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const t = copy[language];
  const closeLead = useCallback(() => setLead(null), []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const changeLightbox = useCallback((index: number) => setLightbox((current) => current ? { ...current, index } : current), []);
  const openLightbox = useCallback((slides: Slide[], index: number, opener: HTMLButtonElement) => setLightbox({ slides, index, opener }), []);
  const openLead = useCallback((surface: string, unit: RegnumUnit | null = null, opener: HTMLElement | null = document.activeElement as HTMLElement | null) => {
    if (unit) rememberRegnumUnit(unit);
    setLead({ surface, unit, opener });
  }, []);

  useEffect(() => {
    document.body.classList.add('rp-active');
    const frame = window.requestAnimationFrame(() => document.querySelector('.rp-site')?.classList.add('is-ready'));
    const reveal = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.setAttribute('data-revealed', 'true'); reveal.unobserve(entry.target); }
    }), { threshold: 0.12 });
    document.querySelectorAll('.rp-site [data-reveal]').forEach((node) => reveal.observe(node));
    return () => { document.body.classList.remove('rp-active'); window.cancelAnimationFrame(frame); reveal.disconnect(); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const unlock = lockRegnumBody();
    const menuButton = menuButtonRef.current;
    const first = menuRef.current?.querySelector<HTMLElement>('a[href],button:not([disabled])');
    first?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector('.lead-modal') || event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
      if (event.key !== 'Tab' || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>('a[href],button:not([disabled])'));
      const start = focusable[0]; const end = focusable.at(-1);
      if (!start || !end) return;
      if (!menuRef.current.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? end : start).focus(); }
      else if (event.shiftKey && document.activeElement === start) { event.preventDefault(); end.focus(); }
      else if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); start.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); unlock(); if (!document.querySelector('.lead-modal')) window.requestAnimationFrame(() => menuButton?.focus({ preventScroll: true })); };
  }, [menuOpen]);

  const selectMenuLanguage = (next: Language, button: HTMLButtonElement) => {
    setLanguage(next);
    window.requestAnimationFrame(() => button.focus({ preventScroll: true }));
  };

  return <div className="rp-site" lang={language}>
    <a className="rp-skip" href="#rp-main" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>{t.skip}</a>
    <header className="rp-header" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>
      <a className="rp-brand" href="#top" aria-label="Regnum Plaza"><img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" /></a>
      <nav className="rp-header__nav" aria-label={t.navLabel}>{t.nav.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
      <div className="rp-languages" aria-label={t.language}>{languages.map((item) => <button key={item} type="button" className={language === item ? 'is-active' : ''} onClick={() => setLanguage(item)} aria-pressed={language === item}>{item.toUpperCase()}</button>)}</div>
      <a className="rp-header__apartments" href={withLanguage('/regnum-plaza/apartments', language)}>{t.apartments}</a>
      <button className="rp-header__lead" type="button" data-lead-trigger onClick={() => openLead('landing:header')}>{t.consult}</button>
      <button ref={menuButtonRef} className="rp-menu-button" type="button" aria-expanded={menuOpen} aria-controls="rp-menu" onClick={() => setMenuOpen(true)}><span>{t.menu}</span><i /><i /></button>
    </header>

    <div className={`rp-menu ${menuOpen ? 'is-open' : ''}`} role="dialog" aria-modal={menuOpen && !lead ? true : undefined} aria-label={t.navLabel} aria-hidden={!menuOpen || Boolean(lead)} inert={!menuOpen || Boolean(lead) ? true : undefined}>
      <button className="rp-menu__backdrop" type="button" tabIndex={menuOpen ? 0 : -1} aria-label={t.close} onClick={() => setMenuOpen(false)} />
      <nav ref={menuRef} id="rp-menu" aria-label={t.navLabel}>
        <header><img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" /><button type="button" onClick={() => setMenuOpen(false)} aria-label={t.close}>×</button></header>
        <div className="rp-menu__links">{t.nav.map(([id, label], index) => <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}><span>0{index + 1}</span>{label}</a>)}</div>
        <footer><div aria-label={t.language}>{languages.map((item) => <button key={item} type="button" className={language === item ? 'is-active' : ''} aria-pressed={language === item} onClick={(event) => selectMenuLanguage(item, event.currentTarget)}>{item.toUpperCase()}</button>)}</div><button type="button" data-lead-trigger onClick={(event) => openLead('landing:menu', null, event.currentTarget)}>{t.consult}<span>↗</span></button></footer>
      </nav>
    </div>

    <main id="rp-main" aria-hidden={menuOpen || undefined} inert={menuOpen ? true : undefined}>
      <section id="top" className="rp-hero" aria-labelledby="rp-hero-title">
        <div className="rp-hero__apertures" aria-hidden="true">{[0, 1, 2, 3].map((index) => <div key={index} className={`rp-aperture rp-aperture--${index + 1}`}><img src={asset('/regnum-plaza/images/hero.webp')} alt="" width="1920" height="873" fetchPriority="high" /></div>)}</div>
        <picture className="rp-hero__mobile"><source media="(max-width: 720px)" srcSet={asset('/regnum-plaza/images/hero-mobile.webp')} /><img src={asset('/regnum-plaza/images/hero.webp')} width="1920" height="873" alt={t.heroImage} fetchPriority="high" /></picture>
        <div className="rp-hero__shade" />
        <div className="rp-hero__copy">
          <span>{t.heroEyebrow}</span>
          <img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" />
          <h1 id="rp-hero-title">{t.heroTitle}</h1>
          <p>{t.heroText}</p>
          <div><a href={withLanguage('/regnum-plaza/apartments', language)}>{t.apartments}<b>↗</b></a><button type="button" data-lead-trigger onClick={() => openLead('landing:hero')}>{t.consult}</button></div>
        </div>
        <ul className="rp-hero__facts">{t.heroFacts.map(([value, label]) => <li key={value}><strong>{value}</strong><span>{label}</span></li>)}</ul>
        <span className="rp-hero__media-label">{mediaLabels['real-first-phase'][language]}</span>
      </section>

      <section id="architecture" className="rp-section rp-architecture">
        <header className="rp-section__header" data-reveal><span>{t.architectureEyebrow}</span><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p></header>
        <div className="rp-architecture__grid">{architectureSlides.map((slide, index) => <button key={slide.src} type="button" data-reveal onClick={(event) => openLightbox(architectureSlides, index, event.currentTarget)} aria-label={`${t.openGallery}: ${slide.title[language]}`}>
          <img src={asset(slide.src)} width={slide.width} height={slide.height} loading="lazy" alt={slide.caption[language]} />
          <span><small>{mediaLabels[slide.type][language]}</small><strong>{slide.title[language]}</strong><i>↗</i></span>
        </button>)}</div>
      </section>

      <section id="reality" className="rp-section rp-reality">
        <header className="rp-section__header rp-section__header--dark" data-reveal><span>{t.realityEyebrow}</span><h2>{t.realityTitle}</h2><p>{t.realityText}</p></header>
        <div className="rp-reality__grid">
          <article className="rp-reality__video" data-reveal><div><video controls playsInline preload="metadata" poster={asset('/regnum-plaza/images/video-poster.webp')} width="1492" height="900"><source src={asset('/regnum-plaza/video/first-phase.mp4')} type="video/mp4" /></video><span>{mediaLabels['real-first-phase'][language]}</span></div><h3>{t.videoTitle}</h3><p>{t.videoText}</p><a href="https://cloud.chaos.com/collaboration/n/VELR7kWdz9hqfoHWYRwfai/present?t=vrt" target="_blank" rel="noreferrer">{t.tour}<b>↗</b></a></article>
          <article className="rp-reality__card" data-reveal><button type="button" onClick={(event) => openLightbox(openingSlides, 0, event.currentTarget)}><img src={asset(openingSlides[0].src)} width="900" height="600" loading="lazy" alt={openingSlides[0].caption[language]} /><span>{mediaLabels['documentary-opening'][language]}</span></button><h3>{t.realityCards[1]}</h3><p>{openingSlides[0].caption[language]}</p></article>
          <article className="rp-reality__card" data-reveal><button type="button" onClick={(event) => openLightbox(cgiSlides, 0, event.currentTarget)}><img src={asset(cgiSlides[0].src)} width="1500" height="904" loading="lazy" alt={cgiSlides[0].caption[language]} /><span>{mediaLabels['cgi-full-project'][language]}</span></button><h3>{t.realityCards[2]}</h3><p>{cgiSlides[0].caption[language]}</p></article>
          <article className="rp-reality__card" data-reveal><button type="button" onClick={(event) => openLightbox(archiveSlides, 0, event.currentTarget)}><img src={asset(archiveSlides[0].src)} width="1218" height="850" loading="lazy" alt={archiveSlides[0].caption[language]} /><span>{mediaLabels['archival-cgi-concept'][language]}</span></button><h3>{t.realityCards[3]}</h3><p>{archiveSlides[0].caption[language]}</p></article>
        </div>
      </section>

      <section id="genplan" className="rp-section rp-genplan">
        <div className="rp-genplan__image" data-reveal><img src={asset('/regnum-plaza/images/genplan-cgi.webp')} width="1800" height="909" loading="lazy" alt={cgiSlides[1].caption[language]} /><span>{mediaLabels['cgi-full-project'][language]}</span></div>
        <div className="rp-genplan__copy" data-reveal><span>{t.genplanEyebrow}</span><h2>{t.genplanTitle}</h2><p>{t.genplanText}</p><dl>{t.genplanFacts.map(([value, label]) => <div key={value}><dt>{value}</dt><dd>{label}</dd></div>)}</dl></div>
      </section>

      <section id="amenities" className="rp-section rp-amenities">
        <header className="rp-section__header" data-reveal><span>{t.amenitiesEyebrow}</span><h2>{t.amenitiesTitle}</h2><p>{t.amenitiesText}</p></header>
        <div className="rp-amenities__rail" aria-label={t.openGallery}>{amenitySlides.map((slide, index) => <button key={slide.src} type="button" data-reveal onClick={(event) => openLightbox(amenitySlides, index, event.currentTarget)} aria-label={`${t.openGallery}: ${slide.title[language]}`}>
          <img src={asset(slide.src)} width={slide.width} height={slide.height} loading="lazy" alt={slide.caption[language]} />
          <span><small>{String(index + 1).padStart(2, '0')} · {mediaLabels[slide.type][language]}</small><strong>{slide.title[language]}</strong><i>↗</i></span>
        </button>)}</div>
        <button className="rp-section__lead" type="button" data-lead-trigger onClick={() => openLead('landing:amenities')}>{t.amenitiesLead}<span>↗</span></button>
      </section>

      <section className="rp-section rp-lobby">
        <div className="rp-lobby__image" data-reveal><img src={asset('/regnum-plaza/images/lobby.webp')} width="1100" height="1157" loading="lazy" alt={`${mediaLabels['real-first-phase'][language]} · lobby`} /><span>{mediaLabels['real-first-phase'][language]}</span></div>
        <div className="rp-lobby__copy" data-reveal><span>{t.lobbyEyebrow}</span><h2>{t.lobbyTitle}</h2><p>{t.lobbyText}</p><ul>{t.barrier.map((item, index) => <li key={item}><span>0{index + 1}</span>{item}</li>)}</ul></div>
      </section>

      <section id="location" className="rp-section rp-location">
        <header className="rp-section__header" data-reveal><span>{t.locationEyebrow}</span><h2>{t.locationTitle}</h2><p>{t.locationText}</p></header>
        <div className="rp-location__grid">
          <article data-reveal><span>41.331564 · 69.324328</span><h3>{t.projectAddress}</h3><p>{language === 'ru' ? 'Ташкент, Мирзо-Улугбекский район, ул. Сайрам' : language === 'uz' ? 'Toshkent, Mirzo Ulug‘bek tumani, Sayram ko‘chasi' : 'Sayram Street, Mirzo-Ulugbek District, Tashkent'}</p><a href="https://www.google.com/maps?q=41.331564,69.324328" target="_blank" rel="noreferrer">{t.maps} ↗</a></article>
          <article data-reveal><span>41.291432 · 69.280519</span><h3>{t.salesAddress}</h3><p>{language === 'ru' ? 'Ташкент, Мирабадский район, ул. Ойбека, 38A' : language === 'uz' ? 'Toshkent, Mirobod tumani, Oybek ko‘chasi, 38A' : '38A Oybek Street, Mirabad District, Tashkent'}</p><a href="https://www.google.com/maps?q=41.291432,69.280519" target="_blank" rel="noreferrer">{t.maps} ↗</a></article>
          <aside data-reveal><h3>{t.nearby}</h3><ul>{t.nearbyFacts.map(([time, place]) => <li key={place}><strong>{time}</strong><span>{place}</span></li>)}</ul></aside>
        </div>
      </section>

      <section id="apartments" className="rp-section rp-apartments-preview">
        <header className="rp-section__header rp-section__header--dark" data-reveal><span>{t.catalogEyebrow}</span><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p></header>
        <dl className="rp-apartments-preview__stats">{t.catalogStats.map(([value, label]) => <div key={value}><dt>{value}</dt><dd>{label}</dd></div>)}</dl>
        <div className="rp-apartments-preview__grid">{previewUnits.map((unit) => <article key={unit.id} data-reveal>
          <div className="rp-preview-plan">{unit.planPublicPath ? <img src={asset(unit.planPublicPath)} width={unit.planWidth!} height={unit.planHeight!} loading="lazy" alt={`${mediaLabels['official-plan'][language]} · ${t.number}${unit.number}`} /> : <div><i /><span>{t.missingPlan}</span></div>}</div>
          <header><span>{t.number}{unit.number}</span><strong>{unit.rooms} {t.rooms}</strong></header>
          <dl><div><dt>{unit.area.toLocaleString(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US')} м²</dt><dd>{unit.floor} {t.floor}</dd></div><div><dt>{unit.completion}</dt><dd>{unit.queue} {t.queue} · {unit.section} {t.section}</dd></div></dl>
          <p>{t.price}</p><button type="button" data-lead-trigger onClick={(event) => openLead('landing:catalog-preview', unit, event.currentTarget)}>{t.askUnit}<span>↗</span></button>
        </article>)}</div>
        <a className="rp-apartments-preview__cta" href={withLanguage('/regnum-plaza/apartments', language)}>{t.allApartments}<span>↗</span></a>
      </section>

      <section className="rp-contact">
        <div data-reveal><span>{t.contactEyebrow}</span><h2>{t.contactTitle}</h2><p>{t.contactText}</p><button type="button" data-lead-trigger onClick={() => openLead('landing:footer')}>{t.consult}<b>↗</b></button></div>
        <a className="rp-contact__phone" href="tel:+998781228822">+998 78 122 88 22 <span>↗</span></a>
        <dl><div><dt>{t.office}</dt><dd>{t.salesAddress.replace(' · ', ' · ')}</dd></div><div><dt>{t.project}</dt><dd>{t.projectAddress.replace(' · ', ' · ')}</dd></div></dl>
        <footer><img src={asset('/regnum-plaza/logo.svg')} width="522" height="95" alt="Regnum Plaza" /><p>{t.disclaimer}</p><nav><a href={`${appBasePath}/privacy?project=regnum-plaza&lang=${language}&from=landing`}>{t.privacy}</a><a href="#top">{t.top}</a></nav></footer>
      </section>
    </main>

    {lightbox ? <Lightbox state={lightbox} language={language} onClose={closeLightbox} onChange={changeLightbox} /> : null}
    {lead ? <LeadModal
      open={Boolean(lead)} language={language} context={regnumLeadContext(lead?.surface ?? 'landing:unknown', language, lead?.unit)}
      brandName="MURAD BUILDINGS" projectName="REGNUM PLAZA" tagline={t.formTagline} facts={t.formFacts}
      submitUrl={regnumLeadSubmitUrl()} projectSlug="regnum-plaza" unitId={lead?.unit?.id}
      privacyUrl={`${appBasePath}/privacy?project=regnum-plaza&lang=${language}&from=landing`} requireConsent returnFocusTo={lead.opener} onClose={closeLead}
    /> : null}
  </div>;
}
