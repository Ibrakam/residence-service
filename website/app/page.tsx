'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';
import crmSnapshot from '@/data/avalon-units.json';
import { floorLayouts } from '@/data/floor-layouts';
import { LeadModal, rememberLastViewedApartment } from '@/app/lead-modal';

type View = 'city' | 'complex' | 'facade' | 'showroom';
type HotspotId = 'metro' | 'mall' | 'avalon';
type BuildingId = 'B1' | 'A' | 'B2';
type UnitStatus = 'free' | 'occupied' | 'sold';
type RoomFilter = 'all' | 2 | 3;
type CatalogMode = 'plan' | 'chess' | 'list';
type AmenityId = 'playground' | 'bbq' | 'cinema' | 'parking';
type Language = 'ru' | 'uz';

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const assetPath = (path: string) => `${appBasePath}${path}`;

type Apartment = {
  id: string;
  building: BuildingId;
  number: number;
  floor: number;
  rooms: number;
  area: number;
  pricePerM2: number | null;
  price: number | null;
  repair: string;
  status: UnitStatus;
  rawStatus: string;
};

const units = crmSnapshot.units as Apartment[];

const hotspots = {
  metro: { ru: { eyebrow: 'Метро', title: 'Станция Тузель', description: 'Городской ритм — в нескольких шагах от дома.' }, uz: { eyebrow: 'Metro', title: 'Tuzel bekati', description: 'Shahar ritmi — uydan bir necha qadam narida.' } },
  mall: { ru: { eyebrow: 'Инфраструктура', title: 'ТРЦ · savdo markazi', description: 'Покупки и повседневные сервисы рядом.' }, uz: { eyebrow: 'Infratuzilma', title: 'Savdo markazi', description: 'Xaridlar va kundalik xizmatlar yoningizda.' } },
  avalon: { ru: { eyebrow: 'Комфорт+', title: 'AVALON RESIDENCE', description: 'Срок сдачи — II квартал 2028 года.' }, uz: { eyebrow: 'Komfort+', title: 'AVALON RESIDENCE', description: 'Topshirish muddati — 2028-yil II chorak.' } },
} satisfies Record<HotspotId, Record<Language, { eyebrow: string; title: string; description: string }>>;

const amenities: { id: AmenityId; number: string; title: Record<Language, string>; short: Record<Language, string>; description: Record<Language, string>; images: string[] }[] = [
  { id: 'playground', number: '01', title: { ru: 'Детская площадка', uz: 'Bolalar maydonchasi' }, short: { ru: 'Игры во дворе', uz: 'Hovlidagi o‘yinlar' }, description: { ru: 'Безопасное пространство для игр с мягким покрытием, зонами для разных возрастов и местами отдыха для родителей.', uz: 'Yumshoq qoplama, turli yoshdagilar uchun zonalar va ota-onalar dam olishi uchun joylarga ega xavfsiz maydon.' }, images: ['/amenity-playground.webp'] },
  { id: 'bbq', number: '02', title: { ru: 'BBQ-зона', uz: 'BBQ hududi' }, short: { ru: 'Встречи с близкими', uz: 'Yaqinlar bilan uchrashuvlar' }, description: { ru: 'Двухуровневая терраса с навесами, кухонной зоной и местами для спокойных встреч на свежем воздухе.', uz: 'Soyabonlar, oshxona hududi va ochiq havoda sokin uchrashuvlar uchun joylarga ega ikki qavatli ayvon.' }, images: ['/amenity-bbq-01.webp', '/amenity-bbq-02.webp'] },
  { id: 'cinema', number: '03', title: { ru: 'Летний кинотеатр', uz: 'Yozgi kinoteatr' }, short: { ru: 'Кино под открытым небом', uz: 'Ochiq osmon ostida kino' }, description: { ru: 'Камерный амфитеатр во дворе для вечерних кинопоказов, событий и летних встреч жителей.', uz: 'Kechki kinoseanslar, tadbirlar va yozgi uchrashuvlar uchun hovlidagi shinam amfiteatr.' }, images: ['/amenity-cinema.webp'] },
  { id: 'parking', number: '04', title: { ru: 'Паркинг', uz: 'Avtoturargoh' }, short: { ru: 'Удобный въезд', uz: 'Qulay kirish' }, description: { ru: 'Отдельный въезд в паркинг помогает освободить двор от машин и сохранить приватное пешеходное пространство.', uz: 'Avtoturargohga alohida kirish hovlini avtomobillardan xoli va piyodalar uchun yopiq saqlashga yordam beradi.' }, images: ['/amenity-parking.webp'] },
];

const ui = {
  ru: {
    district: 'Ташкент · Яшнободский район', cityTitle: 'В ритме города.', homeTitle: 'В комфорте дома.', enterShowroom: 'Нажмите на AVALON RESIDENCE, чтобы войти в интерактивный showroom комплекса.', metro: 'Метро Тузель', mall: 'ТРЦ', openComplex: 'Открыть комплекс', contact: 'Связаться', consultation: 'Консультация', cityAround: 'Город вокруг', interactiveArea: 'Интерактивная территория', complexTitle: 'Дом.', complexAccent: 'Двор. Жизнь.', complexLead: 'Выберите корпус для перехода к этажам или нажмите на объект благоустройства, чтобы посмотреть готовые рендеры.', projectEight: 'О проекте в 8 тезисах', selectedNow: 'Сейчас выбран', building: 'Корпус', apartments: 'Квартир', available: 'Свободно', rooms: 'Комнаты', chooseFloor: 'Выбрать этаж', chooseBuilding: 'Выберите корпус', chooseBuildingLead: 'Нажмите на корпус — дальше покажем этажи и квартиры.', buildingChoice: 'Выбор корпуса', visualChoice: 'Визуальный выбор', yourView: 'Ваш вид.', yourLevel: 'Ваш уровень.', facadeLead: 'Наведите на фасад или выберите номер этажа. После откроется план с доступными квартирами.', freeOnFloor: 'Свободные квартиры на этаже', floor: 'Этаж', facade: 'Фасад корпуса', floorPlan: 'План этажа', chess: 'Шахматка', list: 'Список', clickApartment: 'Нажмите на квартиру на плане', all: 'Все', onlyFree: 'Только свободные', courtyardView: 'Вид на двор', priceM2: 'Цена за м²', cost: 'Стоимость', repair: 'Ремонт', status: 'Статус', price: 'Цена', details: 'Подробнее', layout2d: 'Планировка 2D', condition: 'Состояние', projectTitle: 'Продуманный дом', projectAccent: 'для спокойной жизни.', projectDue: 'Срок сдачи — II квартал 2028 года', returnArea: 'Вернуться к территории', apartmentInfo: 'Информация о квартире', installment: 'Рассрочка · расчёт от 24 до 36 месяцев', total: 'Общая сумма', downPayment: 'Первоначальный взнос', monthly: 'Ежемесячный платёж', downPaymentUzs: 'Первоначальный взнос, UZS', installmentTerm: 'Срок рассрочки', months: 'месяцев', saleAmount: 'Сумма продажи', printOffer: 'Печатное предложение', contactTencorp: 'Связаться с Tencorp', disclaimer: 'Расчёт носит ознакомительный характер. Финальные условия подтверждаются менеджером Tencorp.', statusSource: 'Статус, площадь и цена обновляются автоматически.', landscaping: 'Благоустройство', returnTerritory: 'Вернуться к территории', comfort: 'Комфорт+', dueShort: 'II квартал 2028', neighborhood: 'Район', apartment: 'Квартира', chooseApartment: 'Выбрать квартиру', statuses: { free: 'Свободно', occupied: 'Занято', sold: 'Продано' },
  },
  uz: {
    district: 'Toshkent · Yashnobod tumani', cityTitle: 'Shahar ritmida.', homeTitle: 'Uy qulayligida.', enterShowroom: 'Majmuaning interaktiv showroomiga kirish uchun AVALON RESIDENCE ustiga bosing.', metro: 'Tuzel metrosi', mall: 'Savdo markazi', openComplex: 'Majmuani ochish', contact: 'Bog‘lanish', consultation: 'Maslahat', cityAround: 'Shahar atrofi', interactiveArea: 'Interaktiv hudud', complexTitle: 'Uy.', complexAccent: 'Hovli. Hayot.', complexLead: 'Qavatlarga o‘tish uchun korpusni tanlang yoki tayyor renderlarni ko‘rish uchun obodonlashtirish obyektini bosing.', projectEight: 'Loyiha haqida 8 ta tezis', selectedNow: 'Hozir tanlangan', building: 'Korpus', apartments: 'Kvartiralar', available: 'Bo‘sh', rooms: 'Xonalar', chooseFloor: 'Qavatni tanlash', chooseBuilding: 'Korpusni tanlang', chooseBuildingLead: 'Korpusni bosing — keyin qavatlar va kvartiralarni ko‘rsatamiz.', buildingChoice: 'Korpusni tanlash', visualChoice: 'Vizual tanlov', yourView: 'Sizning manzarangiz.', yourLevel: 'Sizning qavatingiz.', facadeLead: 'Fasad ustiga olib boring yoki qavat raqamini tanlang. Keyin mavjud kvartiralar rejasi ochiladi.', freeOnFloor: 'Qavatdagi bo‘sh kvartiralar', floor: 'Qavat', facade: 'Korpus fasadi', floorPlan: 'Qavat rejasi', chess: 'Shaxmatka', list: 'Ro‘yxat', clickApartment: 'Rejadagi kvartirani bosing', all: 'Barchasi', onlyFree: 'Faqat bo‘sh', courtyardView: 'Hovli tomoni', priceM2: '1 m² narxi', cost: 'Qiymati', repair: 'Ta’mir', status: 'Holati', price: 'Narxi', details: 'Batafsil', layout2d: '2D reja', condition: 'Holati', projectTitle: 'Puxta o‘ylangan uy', projectAccent: 'osoyishta hayot uchun.', projectDue: 'Topshirish muddati — 2028-yil II chorak', returnArea: 'Hududga qaytish', apartmentInfo: 'Kvartira haqida ma’lumot', installment: 'Muddatli to‘lov · 24 oydan 36 oygacha', total: 'Umumiy summa', downPayment: 'Boshlang‘ich to‘lov', monthly: 'Oylik to‘lov', downPaymentUzs: 'Boshlang‘ich to‘lov, UZS', installmentTerm: 'To‘lov muddati', months: 'oy', saleAmount: 'Sotuv summasi', printOffer: 'Taklifni chop etish', contactTencorp: 'Tencorp bilan bog‘lanish', disclaimer: 'Hisob-kitob tanishish uchun. Yakuniy shartlarni Tencorp menejeri tasdiqlaydi.', statusSource: 'Holat, maydon va narx avtomatik yangilanadi.', landscaping: 'Obodonlashtirish', returnTerritory: 'Hududga qaytish', comfort: 'Komfort+', dueShort: '2028-yil II chorak', neighborhood: 'Hudud', apartment: 'Kvartira', chooseApartment: 'Kvartira tanlash', statuses: { free: 'Bo‘sh', occupied: 'Band', sold: 'Sotilgan' },
  },
} as const;

const facadeImages: Record<BuildingId, string> = { A: '/facade-a.jpg', B1: '/facade-b1.jpg', B2: '/facade-b2.jpg' };
const facadeImagesMobile: Record<BuildingId, string> = { A: '/facade-a-mobile.webp', B1: '/facade-b1-mobile.webp', B2: '/facade-b2-mobile.webp' };
const floorImagesMobile: Record<BuildingId, string> = { A: '/floor-a-mobile.webp', B1: '/floor-b1-mobile.webp', B2: '/floor-b2-mobile.webp' };

const projectTheses: Record<Language, string[]> = {
  ru: ['Закрытая и охраняемая территория', 'Современная классическая архитектура', 'Система Face ID', 'Видеонаблюдение', 'Подземный паркинг на 178 машиномест', 'Детские площадки', 'Зоны отдыха для взрослых', 'Собственная управляющая компания'],
  uz: ['Yopiq va qo‘riqlanadigan hudud', 'Zamonaviy klassik arxitektura', 'Face ID tizimi', 'Videokuzatuv', '178 ta avtomobil uchun yerosti avtoturargohi', 'Bolalar maydonchalari', 'Kattalar uchun dam olish hududlari', 'Shaxsiy boshqaruv kompaniyasi'],
};

function formatMoney(value: number | null) {
  return value !== null ? `${new Intl.NumberFormat('ru-RU').format(value)} UZS` : 'По запросу';
}

function repairLabel(value: string, language: Language) {
  if (language === 'ru') return value;
  return value.toLowerCase().includes('без') ? 'Ta’mirsiz' : value;
}

function floorList(building: BuildingId) {
  return [...new Set(units.filter((unit) => unit.building === building).map((unit) => unit.floor))].sort((a, b) => b - a);
}

function facadeFloorZone(building: BuildingId, floor: number) {
  if (building === 'A' && floor > 12) {
    return { x: 552, y: 84 + (14 - floor) * 67, width: 766, height: 67 };
  }

  return { x: 160, y: 218 + (12 - floor) * 69, width: 1550, height: 69 };
}

export default function Home() {
  const [view, setView] = useState<View>('city');
  const [language, setLanguage] = useState<Language>('ru');
  const [activeHotspot, setActiveHotspot] = useState<HotspotId>('avalon');
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingId>('A');
  const [selectedFloor, setSelectedFloor] = useState(9);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [roomFilter, setRoomFilter] = useState<RoomFilter>('all');
  const [onlyFree, setOnlyFree] = useState(false);
  const [catalogMode, setCatalogMode] = useState<CatalogMode>('plan');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [projectInfoOpen, setProjectInfoOpen] = useState(false);
  const [activeAmenity, setActiveAmenity] = useState<AmenityId | null>(null);
  const [amenitySlide, setAmenitySlide] = useState(0);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadContext, setLeadContext] = useState('Консультация AVALON RESIDENCE');
  const [leadAutoPrompt, setLeadAutoPrompt] = useState(false);
  const t = ui[language];
  const active = hotspots[activeHotspot][language];

  const buildingUnits = useMemo(() => units.filter((unit) => unit.building === selectedBuilding), [selectedBuilding]);
  const floors = useMemo(() => floorList(selectedBuilding), [selectedBuilding]);
  const floorUnits = useMemo(() => buildingUnits.filter((unit) => unit.floor === selectedFloor).sort((a, b) => a.number - b.number), [buildingUnits, selectedFloor]);
  const selectedUnit = selectedUnitId ? units.find((unit) => unit.id === selectedUnitId) ?? null : null;
  const floorLayout = floorLayouts[selectedBuilding];
  const freeCount = buildingUnits.filter((unit) => unit.status === 'free').length;
  const maxUnitsOnFloor = Math.max(...floors.map((floor) => buildingUnits.filter((unit) => unit.floor === floor).length));
  const filteredUnits = buildingUnits.filter((unit) => (roomFilter === 'all' || unit.rooms === roomFilter) && (!onlyFree || unit.status === 'free'));

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [view]);

  useEffect(() => {
    const storageKey = 'avalon-lead-prompt-seen-v1';
    try {
      if (sessionStorage.getItem(storageKey)) return;
    } catch {
      // Continue without session persistence when storage is unavailable.
    }

    let elapsed = 0;
    let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
    let timeoutId: number | null = null;

    const markSeen = () => {
      try { sessionStorage.setItem(storageKey, '1'); } catch { /* no-op */ }
    };
    const showPrompt = () => {
      try {
        if (sessionStorage.getItem(storageKey)) return;
      } catch {
        // Continue when storage is unavailable.
      }
      markSeen();
      setLeadContext('Автоматическая консультация после 60 секунд на сайте AVALON RESIDENCE');
      setLeadAutoPrompt(true);
      setLeadOpen(true);
    };
    const schedule = () => {
      if (document.visibilityState !== 'visible') return;
      visibleSince = Date.now();
      timeoutId = window.setTimeout(showPrompt, Math.max(0, 60_000 - elapsed));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (visibleSince !== null) elapsed += Date.now() - visibleSince;
        visibleSince = null;
        if (timeoutId !== null) window.clearTimeout(timeoutId);
      } else {
        schedule();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);

  const openLeadForm = (context: string, autoPrompt = false) => {
    try { sessionStorage.setItem('avalon-lead-prompt-seen-v1', '1'); } catch { /* no-op */ }
    setLeadContext(context);
    setLeadAutoPrompt(autoPrompt);
    setLeadOpen(true);
  };

  const chooseBuilding = (building: BuildingId, openFacade = false) => {
    const availableFloors = floorList(building);
    const nextFloor = availableFloors.includes(9) ? 9 : availableFloors[0];
    setSelectedBuilding(building);
    setSelectedFloor(nextFloor);
    setSelectedUnitId(null);
    setDetailsOpen(false);
    setCatalogMode('plan');
    if (openFacade) window.setTimeout(() => setView('facade'), 90);
  };

  const chooseFloor = (floor: number) => {
    setSelectedFloor(floor);
    setSelectedUnitId(null);
    setDetailsOpen(false);
    setCatalogMode('plan');
    setView('showroom');
  };

  const chooseUnit = (unit: Apartment) => {
    setSelectedFloor(unit.floor);
    setSelectedUnitId(unit.id);
    if (window.innerWidth <= 850) {
      window.setTimeout(() => document.querySelector('.unit-detail--visual')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    }
  };

  const openApartmentDetails = () => {
    if (!selectedUnit) return;
    rememberLastViewedApartment({
      uuid: selectedUnit.id,
      number: String(selectedUnit.number),
      rooms: selectedUnit.rooms,
      area: selectedUnit.area,
      floor: selectedUnit.floor,
      maxFloor: Math.max(...floorList(selectedUnit.building)),
      entrance: 1,
      blockName: `Корпус ${selectedUnit.building}`,
      blockId: selectedUnit.building,
      price: selectedUnit.price ?? 0,
    });
    setDetailsOpen(true);
  };

  const matchesFilter = (unit: Apartment) => (roomFilter === 'all' || unit.rooms === roomFilter) && (!onlyFree || unit.status === 'free');

  const openAmenity = (id: AmenityId) => {
    setAmenitySlide(0);
    setActiveAmenity(id);
  };

  return (
    <main className={`experience-shell experience-shell--${view}`}>
      {view === 'city' ? (
        <section className="city-scene view-stage" aria-labelledby="hero-title">
          <picture>
            <source media="(max-width: 850px)" srcSet={assetPath('/avalon-city-mobile.webp')} />
            <img className="city-scene__image" src={assetPath('/avalon-city.webp')} alt="Панорама Ташкента с AVALON RESIDENCE и станцией метро Тузель" fetchPriority="high" decoding="async" />
          </picture>
          <div className="city-scene__shade" />
          <SiteHeader language={language} onLanguageChange={setLanguage} onHome={() => setView('city')} onApartments={() => setView('facade')} />
          <a className="construction-passport-link" href="https://api-nazorat.mc.uz/object-info/240228796" target="_blank" rel="noreferrer" aria-label={language === 'ru' ? 'Открыть официальный паспорт объекта строительного надзора' : 'Qurilish nazoratidagi obyektning rasmiy pasportini ochish'}>
            <img src={assetPath('/construction-nazorat.svg')} alt="" />
          </a>
          <div className="hero-copy"><p className="eyebrow">{t.district}</p><h1 id="hero-title">{t.cityTitle}<em>{t.homeTitle}</em></h1><p className="hero-copy__lead">{t.enterShowroom}</p></div>
          <div className="mobile-hero-meta" aria-label={language === 'ru' ? 'Ключевая информация о проекте' : 'Loyiha haqida asosiy ma’lumot'}><span>{t.comfort}</span><span>{t.dueShort}</span><span>{language === 'ru' ? 'Метро рядом' : 'Metro yonida'}</span></div>
          <svg className="hotspot-map" viewBox="0 0 4096 2359" preserveAspectRatio="xMidYMid slice" aria-label="Интерактивная карта района">
            <path className={`hotspot hotspot--metro ${activeHotspot === 'metro' ? 'is-active' : ''}`} d="M2031 2282L1995 2267.5L1615.5 2015L1306 1834.5L1066.5 1709L847.5 1601.5L659.5 1522L493.5 1458L486.5 1440V1420L490 1407L519.5 1395.5H533L659.5 1440L871 1523.5L1077 1612.5L1200.5 1670.5L1351.5 1744H1364L1390.5 1758.5L1685.5 1915.5L1936 2057.5L2077 2139V2239L2062 2274L2031 2282Z" role="button" tabIndex={0} aria-label="Метро — станция Тузель" onMouseEnter={() => setActiveHotspot('metro')} onFocus={() => setActiveHotspot('metro')} onClick={() => setActiveHotspot('metro')} onKeyDown={(event) => event.key === 'Enter' && setActiveHotspot('metro')} />
            <path className={`hotspot hotspot--mall ${activeHotspot === 'mall' ? 'is-active' : ''}`} d="M176 1031L181.5 1080L84 1120L555.5 1207L971.5 1093L967 1034.5L1012 1012.5L976.5 995.5L923.5 990.5H898L876.5 986H837.5L769.5 978V970L698.5 973.5L679.5 982V973.5H629L599.5 982V971.5H555.5V978L457 975.5L361.5 990L277.5 1001L167.5 1016V1029L176 1031Z" role="button" tabIndex={0} aria-label="ТРЦ — savdo markazi" onMouseEnter={() => setActiveHotspot('mall')} onFocus={() => setActiveHotspot('mall')} onClick={() => setActiveHotspot('mall')} onKeyDown={(event) => event.key === 'Enter' && setActiveHotspot('mall')} />
            <path className={`hotspot hotspot--avalon ${activeHotspot === 'avalon' ? 'is-active' : ''}`} d="M2604.5 1386L2516 1368.5L2523 1309L2501.5 1305L2522.5 926L2467 921V908.5L2368.5 903V912L2264 903L2200.5 908.5V847L2109 838.5V818.5L1987 815L1932.5 818.5V829.5L1867 826L1710 838V890L1571 904L1585.76 1253.5L1561.5 1260L1563.5 1338.5L1467 1380.64L2267 1595L2604.5 1386Z" role="button" tabIndex={0} aria-label="Открыть AVALON RESIDENCE" onMouseEnter={() => setActiveHotspot('avalon')} onFocus={() => setActiveHotspot('avalon')} onClick={() => setView('complex')} onKeyDown={(event) => event.key === 'Enter' && setView('complex')} />
          </svg>
          <button className="map-label map-label--metro" type="button" onMouseEnter={() => setActiveHotspot('metro')} onClick={() => setActiveHotspot('metro')}><span>01</span> {t.metro}</button>
          <button className="map-label map-label--mall" type="button" onMouseEnter={() => setActiveHotspot('mall')} onClick={() => setActiveHotspot('mall')}><span>02</span> {t.mall}</button>
          <button className="map-label map-label--avalon" type="button" onMouseEnter={() => setActiveHotspot('avalon')} onClick={() => setView('complex')}><span>03</span> Avalon Residence ↘</button>
          <aside className="location-card" aria-live="polite"><div className="location-card__count">0{(['metro', 'mall', 'avalon'] as HotspotId[]).indexOf(activeHotspot) + 1}</div><p>{active.eyebrow}</p><h2>{active.title}</h2><span>{active.description}</span>{activeHotspot === 'avalon' ? <button type="button" onClick={() => setView('complex')}>{t.openComplex} <span>↘</span></button> : null}</aside>
          <div className="hero-contact-rail"><span>{t.contact}</span><a href="tel:+998781137712">+998 78 113 77 12</a><a href="mailto:tencorp.uzb@gmail.com">tencorp.uzb@gmail.com</a><address>{language === 'ru' ? 'Ташкент, ул. Ойбек, 20' : 'Toshkent, Oybek ko‘chasi, 20'}</address><button type="button" onClick={() => openLeadForm('Консультация из контактной панели AVALON RESIDENCE')}>{t.consultation} ↗</button></div>
        </section>
      ) : null}

      {view === 'complex' ? (
        <section className="complex-section complex-screen view-stage" aria-labelledby="complex-title">
          <SiteHeader language={language} onLanguageChange={setLanguage} onHome={() => setView('city')} onApartments={() => setView('facade')} />
          <button className="screen-back" type="button" onClick={() => setView('city')}>← <span>{t.cityAround}</span></button>
          <div className="masterplan-stage">
            <picture>
              <source media="(max-width: 850px)" srcSet={assetPath('/avalon-courtyard-mobile.webp')} />
              <img className="masterplan-stage__image" src={assetPath('/avalon-courtyard.webp')} alt="AVALON RESIDENCE — корпуса и благоустройство двора" decoding="async" />
            </picture>
            <div className="masterplan-stage__shade" />
            <svg className="masterplan-map" viewBox="0 0 4096 2276" preserveAspectRatio="xMidYMax slice" aria-label="Интерактивная схема комплекса">
              <path className={`masterplan-zone masterplan-zone--building ${selectedBuilding === 'B2' ? 'is-active' : ''}`} d="M1558.5 1778.5L1728 1809H1738V1831L1760 1730H1771.5V1725H1785.5L1790.5 1692.5H1777L1776 1600H1768L1759 976L1732.5 975L1731.5 921.5H1725V904.5L1618.5 905.5L1620 921.5H1560H1462L1443.5 938H1438L1434 941V928L1425.5 929.5L1420 933.5V935L1416.5 939.5H1410.5L1404.5 944L1407.5 961L1354.5 1003.5V989L1344.5 990L1338 993.5V995.5L1340.5 996L1332 1004H1323.5L1317.5 1010.5L1321 1013L1321.5 1029L1315 1035H1311.5L1304 1040.5L1305.5 1042.5L1289.5 1057L1293 1060.5V1074.5H1297.5L1304.5 1186L1300.5 1193.5L1304.5 1195.5V1207.5H1307L1322 1439H1383L1385.5 1466.5L1388.5 1469.5L1449.5 1477L1438.5 1495L1453 1754.5L1558.5 1746.5V1778.5Z" role="button" tabIndex={0} aria-label="Корпус B2" onMouseEnter={() => setSelectedBuilding('B2')} onFocus={() => setSelectedBuilding('B2')} onClick={() => chooseBuilding('B2', true)} onKeyDown={(event) => event.key === 'Enter' && chooseBuilding('B2', true)} />
              <path className={`masterplan-zone masterplan-zone--building ${selectedBuilding === 'A' ? 'is-active' : ''}`} d="M1730 872L1733 975L1759 976L1768.5 1600.5H1776V1681.5H1869V1690L1986.5 1689V1692.5H2002V1700L2127.5 1699V1689.5L2254 1688.5V1681H2343L2346 1610.5H2351V1600H2365L2352.5 1544H2355L2366 976H2391L2393.5 873L2396.5 872.5V859L2399 857V854L2380 833V823L2366 809.5L2141 811.5V794.5L1980.5 795.5L1981 811H1864H1785.5L1754.5 810L1743 823V825H1745V830L1725.5 853.5V857H1727.5V872H1730Z" role="button" tabIndex={0} aria-label="Корпус A" onMouseEnter={() => setSelectedBuilding('A')} onFocus={() => setSelectedBuilding('A')} onClick={() => chooseBuilding('A', true)} onKeyDown={(event) => event.key === 'Enter' && chooseBuilding('A', true)} />
              <path className={`masterplan-zone masterplan-zone--building ${selectedBuilding === 'B1' ? 'is-active' : ''}`} d="M2391.5 976.5V974.5L2393 904L2500 904.5V920H2656.5L2687 939.5V927.5H2696.5L2717 942.5L2715 961L2770.5 1001L2772.5 988H2779L2810.5 1010.5L2808 1012L2806 1028L2813 1033.5H2818L2825 1039.5L2823.5 1043L2840 1057L2837 1060.5V1073.5H2832L2823.5 1186.5L2827 1190L2822 1207L2797.5 1563L2802.5 1571V1591.5H2795L2792.5 1634L2832.5 1695.5L2820.5 1854H2807.5V1857.5H2729.5V1855.5L2691 1857.5L2694 1816.5H2696.5V1812.5L2669 1753L2571.5 1747.5L2569.5 1778L2404 1807L2399 1781H2394.5V1810.5H2389V1833L2362.5 1729H2352V1724H2338.5L2332 1691.5H2343V1681.5L2346 1610.5H2351V1600H2365L2352 1543.5H2355L2366 976.5H2391.5Z" role="button" tabIndex={0} aria-label="Корпус B1" onMouseEnter={() => setSelectedBuilding('B1')} onFocus={() => setSelectedBuilding('B1')} onClick={() => chooseBuilding('B1', true)} onKeyDown={(event) => event.key === 'Enter' && chooseBuilding('B1', true)} />
              <path className="masterplan-zone masterplan-zone--amenity" d="M1782 2026L1794.5 1942.5L1796.5 1951H1816L1821.5 1889H1831.5L1836.5 1893.5L1861 1893L1881.5 1889L1897 1885L1916 1877.5L1922 1874L1926.5 1893.5L1941.5 1893L1952 1891.5L1965 1888L1980 1882.5L1995 1874L2020 1927H2049.5V1950.5H2218L2221 1973.5L2233.5 2071.5H1782V2026Z" role="button" tabIndex={0} aria-label="BBQ-зона" onClick={() => openAmenity('bbq')} onKeyDown={(event) => event.key === 'Enter' && openAmenity('bbq')} />
              <path className="masterplan-zone masterplan-zone--amenity" d="M2235 2087L2218 1948.04L2622.89 1946L2660 2087H2235Z" role="button" tabIndex={0} aria-label="Детская площадка" onClick={() => openAmenity('playground')} onKeyDown={(event) => event.key === 'Enter' && openAmenity('playground')} />
              <path className="masterplan-zone masterplan-zone--amenity" d="M2394 1833H2389V1810.5H2394.5V1781.5H2399L2404 1807L2570 1778L2571.5 1747.5L2669 1753L2696.5 1813V1817H2694L2689.5 1917H2403.5L2392 1864.5V1845H2394V1833Z" role="button" tabIndex={0} aria-label="Паркинг" onClick={() => openAmenity('parking')} onKeyDown={(event) => event.key === 'Enter' && openAmenity('parking')} />
              <path className="masterplan-zone masterplan-zone--amenity" d="M1453.5 1770.5L1459 1921L1724.86 1920.5L1740 1864V1832H1738V1809H1728L1558.5 1778V1746.5L1461.5 1754L1453.5 1770.5Z" role="button" tabIndex={0} aria-label="Летний кинотеатр" onClick={() => openAmenity('cinema')} onKeyDown={(event) => event.key === 'Enter' && openAmenity('cinema')} />
            </svg>
            <div className="complex-intro"><p className="eyebrow">{t.interactiveArea}</p><h2 id="complex-title">{t.complexTitle}<br /><em>{t.complexAccent}</em></h2><p>{t.complexLead}</p><button className="project-info-trigger" type="button" onClick={() => setProjectInfoOpen(true)}>{t.projectEight} <span>↗</span></button></div>
            <div className="mobile-complex-sheet">
              <header><div><span>01</span><small>{t.buildingChoice}</small><strong>{t.chooseBuilding}</strong></div><button type="button" onClick={() => setProjectInfoOpen(true)}>{language === 'ru' ? 'О проекте' : 'Loyiha haqida'} ↗</button></header>
              <div className="mobile-building-selector" role="group" aria-label={t.chooseBuilding}>{(['B2', 'A', 'B1'] as BuildingId[]).map((building) => { const free = units.filter((unit) => unit.building === building && unit.status === 'free').length; return <button key={building} type="button" className={selectedBuilding === building ? 'is-active' : ''} onClick={() => chooseBuilding(building)}><strong>{building}</strong><small>{free} {t.available.toLowerCase()}</small></button>; })}</div>
              <button className="mobile-primary-action" type="button" onClick={() => chooseBuilding(selectedBuilding, true)}><span>{t.building} {selectedBuilding}</span><strong>{t.chooseFloor}</strong><b>↗</b></button>
            </div>
            <button className="masterplan-label masterplan-label--b2" type="button" onClick={() => chooseBuilding('B2', true)}><span>B2</span><small>{units.filter((unit) => unit.building === 'B2' && unit.status === 'free').length} свободно</small></button>
            <button className="masterplan-label masterplan-label--a" type="button" onClick={() => chooseBuilding('A', true)}><span>A</span><small>{units.filter((unit) => unit.building === 'A' && unit.status === 'free').length} свободно</small></button>
            <button className="masterplan-label masterplan-label--b1" type="button" onClick={() => chooseBuilding('B1', true)}><span>B1</span><small>{units.filter((unit) => unit.building === 'B1' && unit.status === 'free').length} свободно</small></button>
            <aside className="complex-summary"><p>{t.selectedNow}</p><h3>{t.building} {selectedBuilding}</h3><dl><div><dt>{t.apartments}</dt><dd>{buildingUnits.length}</dd></div><div><dt>{t.available}</dt><dd>{freeCount}</dd></div><div><dt>{t.rooms}</dt><dd>2–3</dd></div></dl><button type="button" onClick={() => chooseBuilding(selectedBuilding, true)}>{t.chooseFloor} <span>↘</span></button></aside>
          </div>
          <div className="amenity-dock amenity-dock--renders">{amenities.map((item) => <button key={item.id} type="button" onClick={() => openAmenity(item.id)}><img src={assetPath(item.images[0])} alt="" loading="lazy" decoding="async" /><span>{item.number}</span><strong>{item.title[language]}</strong><small>{item.short[language]}</small></button>)}</div>
        </section>
      ) : null}

      {view === 'facade' ? (
        <section className="facade-screen view-stage" aria-labelledby="facade-title">
          <SiteHeader light language={language} onLanguageChange={setLanguage} onHome={() => setView('city')} onApartments={() => setView('facade')} />
          <div className="facade-toolbar"><button className="screen-back screen-back--static" type="button" onClick={() => setView('complex')}>← <span>{t.buildingChoice}</span></button><div><p className="eyebrow eyebrow--dark">{t.visualChoice}</p><h1 id="facade-title">{t.building} {selectedBuilding}</h1></div></div>
          <div className="facade-workspace">
            <aside className="facade-copy"><span className="facade-copy__index">03</span><p>{t.visualChoice}</p><h2>{t.chooseFloor}</h2><small>{t.facadeLead}</small><nav className="facade-floor-list" aria-label={t.floor}><span>{t.floor}</span>{floors.map((floor) => { const available = buildingUnits.filter((unit) => unit.floor === floor && unit.status === 'free').length; return <button key={floor} type="button" onClick={() => chooseFloor(floor)}><strong>{floor}</strong><i style={{ '--availability': Math.max(18, available * 14) } as React.CSSProperties} /><small>{available}</small></button>; })}</nav></aside>
            <div className="facade-visual"><div className="facade-image-frame"><picture><source media="(max-width: 850px)" srcSet={assetPath(facadeImagesMobile[selectedBuilding])} /><img src={assetPath(facadeImages[selectedBuilding])} alt={`AVALON RESIDENCE · ${t.building} ${selectedBuilding}`} decoding="async" /></picture><div className="facade-building-tag"><span>{selectedBuilding}</span><small>{t.building.toLowerCase()}</small></div><svg className="facade-floor-overlay" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid meet" aria-label={t.chooseFloor}>{floors.map((floor) => { const available = buildingUnits.filter((unit) => unit.floor === floor && unit.status === 'free').length; const zone = facadeFloorZone(selectedBuilding, floor); return <g key={floor} className="facade-floor-zone" role="button" tabIndex={0} aria-label={`${floor} ${t.floor.toLowerCase()}, ${available} ${t.available.toLowerCase()}`} onClick={() => chooseFloor(floor)} onKeyDown={(event) => event.key === 'Enter' && chooseFloor(floor)}><rect x={zone.x} y={zone.y} width={zone.width} height={zone.height} /><text x={zone.x + zone.width / 2} y={zone.y + zone.height / 2 + 3}>{floor} {t.floor.toLowerCase()} · {available} {t.available.toLowerCase()}</text></g>; })}</svg></div></div>
            <div className="mobile-facade-tip"><span>↑</span><strong>{t.chooseFloor}</strong><small>{language === 'ru' ? 'Листайте этажи по горизонтали и нажмите на номер.' : 'Qavatlarni yon tomonga suring va raqamni bosing.'}</small></div>
          </div>
        </section>
      ) : null}

      {view === 'showroom' ? (
        <section className="apartments-section apartments-screen view-stage" aria-labelledby="apartments-title">
          <SiteHeader light language={language} onLanguageChange={setLanguage} onHome={() => setView('city')} onApartments={() => setView('facade')} />
          <div className="showroom-shell showroom-shell--visual">
            <div className="showroom-topbar"><button className="screen-back screen-back--static" type="button" onClick={() => setView('facade')}>← <span>{t.facade}</span></button><div className="showroom-title"><p className="eyebrow eyebrow--dark">AVALON RESIDENCE · {t.building.toLowerCase()} {selectedBuilding}</p><h1 id="apartments-title">{selectedFloor} {t.floor.toLowerCase()}</h1></div></div>
            <div className="visual-modebar"><div className="catalog-tabs"><button type="button" className={catalogMode === 'plan' ? 'is-active' : ''} onClick={() => setCatalogMode('plan')}>◆ {t.floorPlan}</button><button type="button" className={catalogMode === 'chess' ? 'is-active' : ''} onClick={() => setCatalogMode('chess')}>▦ {t.chess}</button><button type="button" className={catalogMode === 'list' ? 'is-active' : ''} onClick={() => setCatalogMode('list')}>☷ {t.list}</button></div>{catalogMode !== 'plan' ? <div className="filter-pills"><span>{t.rooms}</span>{(['all', 2, 3] as RoomFilter[]).map((room) => <button key={room} type="button" className={roomFilter === room ? 'is-active' : ''} onClick={() => setRoomFilter(room)}>{room === 'all' ? t.all : room}</button>)}<button type="button" className={onlyFree ? 'is-active is-free' : ''} onClick={() => setOnlyFree((value) => !value)}>{t.onlyFree}</button></div> : <div className="plan-hint"><i /> {t.clickApartment}</div>}</div>

            {catalogMode === 'plan' ? (
              <div className={`floor-plan-layout ${selectedUnit ? 'has-selection' : 'is-empty'}`}>
                <nav className="floor-rail" aria-label={t.chooseFloor}><span>{t.floor}</span>{floors.map((floor) => <button key={floor} type="button" className={selectedFloor === floor ? 'is-active' : ''} onClick={() => chooseFloor(floor)}><strong>{floor}</strong><i /></button>)}</nav>
                <div className="floor-plan-canvas"><div className="floor-plan-caption"><span>{t.courtyardView}</span><small>{floorUnits.length} {t.apartments.toLowerCase()} · {floorUnits.filter((unit) => unit.status === 'free').length} {t.available.toLowerCase()}</small></div><div className="floor-plan-image-wrap"><picture><source media="(max-width: 850px)" srcSet={assetPath(floorImagesMobile[selectedBuilding])} /><img src={assetPath(floorLayout.image)} alt={`${t.floorPlan} ${selectedFloor}, ${t.building} ${selectedBuilding}`} decoding="async" /></picture><svg className="floor-unit-overlay" viewBox="0 0 4961 3508" preserveAspectRatio="xMidYMid meet" aria-label={`${t.apartments} · ${selectedFloor} ${t.floor.toLowerCase()}`}>{floorLayout.zones.map((zone, zoneIndex) => { const unit = floorUnits[floorLayout.order[zoneIndex]]; if (!unit) return null; return <g key={unit.id} className={`floor-unit-zone floor-unit-zone--${unit.status} ${selectedUnit?.id === unit.id ? 'is-selected' : ''}`} role="button" tabIndex={0} aria-label={`${t.apartment} №${unit.number}, ${t.statuses[unit.status]}`} onClick={() => chooseUnit(unit)} onKeyDown={(event) => event.key === 'Enter' && chooseUnit(unit)}><polygon points={zone.points} /><text x={zone.x} y={zone.y - 32}>№{unit.number}</text><text className="floor-unit-zone__rooms" x={zone.x} y={zone.y + 48}>{unit.rooms}к · {unit.area} м²</text></g>; })}</svg></div></div>
                <section className="mobile-unit-picker" aria-label={`${t.apartments} · ${selectedFloor} ${t.floor.toLowerCase()}`}><header><div><small>{t.floorPlan}</small><strong>{language === 'ru' ? `Квартиры на ${selectedFloor} этаже` : `${selectedFloor}-qavatdagi kvartiralar`}</strong></div><span>{floorUnits.filter((unit) => unit.status === 'free').length} {t.available.toLowerCase()}</span></header><div>{floorUnits.map((unit) => <button key={unit.id} type="button" className={`mobile-unit-card mobile-unit-card--${unit.status} ${selectedUnit?.id === unit.id ? 'is-active' : ''}`} onClick={() => chooseUnit(unit)}><span><small>№</small>{unit.number}</span><div><strong>{unit.rooms} {language === 'ru' ? 'комн.' : 'xona'} · {unit.area} m²</strong><small>{formatMoney(unit.price)}</small></div><i>{t.statuses[unit.status]}</i></button>)}</div></section>
                {selectedUnit ? <ApartmentDetail unit={selectedUnit} language={language} onDetails={openApartmentDetails} /> : null}
              </div>
            ) : (
              <div className="crm-layout crm-layout--screen crm-layout--catalog">
                <div className="crm-board"><div className="crm-board__head"><div><strong>{catalogMode === 'chess' ? `${t.chess} · ${t.building} ${selectedBuilding}` : `${filteredUnits.length} ${t.apartments.toLowerCase()}`}</strong><span>{freeCount} / {buildingUnits.length} · {t.available.toLowerCase()}</span></div><div className="status-legend"><span className="free">{t.statuses.free}</span><span className="occupied">{t.statuses.occupied}</span><span className="sold">{t.statuses.sold}</span></div></div>
                  {catalogMode === 'chess' ? <div className="floor-scroll"><div className="floor-grid" style={{ '--unit-columns': maxUnitsOnFloor } as React.CSSProperties}>{floors.map((floor) => <div className="floor-row" key={floor}><div className="floor-number"><strong>{floor}</strong><span>{t.floor.toLowerCase()}</span></div>{buildingUnits.filter((unit) => unit.floor === floor).sort((a, b) => a.number - b.number).map((unit) => <button key={unit.id} type="button" className={`unit-cell unit-cell--${unit.status} ${selectedUnit?.id === unit.id ? 'is-selected' : ''} ${matchesFilter(unit) ? '' : 'is-filtered'}`} onClick={() => chooseUnit(unit)}><span><small>№</small>{unit.number}</span><strong>{unit.rooms}к · {unit.area} м²</strong><em>{unit.status === 'free' && unit.price ? `${Math.round(unit.price / 1_000_000)} mln` : t.statuses[unit.status]}</em></button>)}</div>)}</div></div> : <div className="unit-table-wrap"><table className="unit-table"><thead><tr><th>№</th><th>{t.floor}</th><th>{t.rooms}</th><th>m²</th><th>{t.priceM2}</th><th>{t.cost}</th><th>{t.repair}</th><th>{t.status}</th></tr></thead><tbody>{filteredUnits.map((unit) => <tr key={unit.id} className={selectedUnit?.id === unit.id ? 'is-selected' : ''} onClick={() => chooseUnit(unit)}><td>{unit.number}</td><td>{unit.floor}</td><td>{unit.rooms}</td><td>{unit.area} m²</td><td>{formatMoney(unit.pricePerM2)}</td><td>{formatMoney(unit.price)}</td><td>{repairLabel(unit.repair, language)}</td><td><span className={`table-status table-status--${unit.status}`}>{t.statuses[unit.status]}</span></td></tr>)}</tbody></table></div>}
                </div>
                {selectedUnit ? <ApartmentDetail unit={selectedUnit} language={language} onDetails={openApartmentDetails} /> : null}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {activeAmenity ? <AmenityModal amenity={amenities.find((item) => item.id === activeAmenity) ?? amenities[0]} language={language} slide={amenitySlide} onSlide={setAmenitySlide} onClose={() => setActiveAmenity(null)} /> : null}
      {projectInfoOpen ? <ProjectModal language={language} onClose={() => setProjectInfoOpen(false)} /> : null}
      {detailsOpen && selectedUnit ? <ApartmentModal unit={selectedUnit} language={language} onClose={() => setDetailsOpen(false)} onPrint={() => setPrintOpen(true)} onLead={() => openLeadForm(`Заявка из карточки квартиры №${selectedUnit.number} · корпус ${selectedUnit.building}`)} /> : null}
      {printOpen && selectedUnit ? <PrintProposal unit={selectedUnit} language={language} onClose={() => setPrintOpen(false)} /> : null}
      {leadOpen ? <LeadModal open language={language} context={leadContext} autoPrompt={leadAutoPrompt} onClose={() => setLeadOpen(false)} /> : null}
    </main>
  );
}

function AmenityModal({ amenity, language, slide, onSlide, onClose }: { amenity: (typeof amenities)[number]; language: Language; slide: number; onSlide: (slide: number) => void; onClose: () => void }) {
  const image = amenity.images[slide] ?? amenity.images[0];
  const t = ui[language];
  return <div className="modal-backdrop amenity-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="amenity-modal" role="dialog" aria-modal="true" aria-labelledby="amenity-title"><div className="amenity-modal__visual"><img src={assetPath(image)} alt={`${amenity.title[language]} · AVALON RESIDENCE`} />{amenity.images.length > 1 ? <div className="amenity-modal__arrows"><button type="button" aria-label="Previous" onClick={() => onSlide((slide - 1 + amenity.images.length) % amenity.images.length)}>←</button><span>{slide + 1} / {amenity.images.length}</span><button type="button" aria-label="Next" onClick={() => onSlide((slide + 1) % amenity.images.length)}>→</button></div> : null}</div><div className="amenity-modal__copy"><button className="modal-close amenity-modal__close" type="button" aria-label="Close" onClick={onClose}>×</button><span className="amenity-modal__number">{amenity.number}</span><p>{t.landscaping}</p><h2 id="amenity-title">{amenity.title[language]}</h2><strong>{amenity.short[language]}</strong><small>{amenity.description[language]}</small><div className="amenity-modal__meta"><span>AVALON RESIDENCE</span><span>{t.comfort}</span><span>{t.dueShort}</span></div><button className="amenity-modal__return" type="button" onClick={onClose}>{t.returnTerritory} <span>↙</span></button></div></section></div>;
}

function ProjectModal({ language, onClose }: { language: Language; onClose: () => void }) {
  const t = ui[language];
  return <div className="modal-backdrop project-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="project-modal" role="dialog" aria-modal="true" aria-labelledby="project-modal-title"><button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button><p className="eyebrow eyebrow--dark">AVALON RESIDENCE · {t.comfort}</p><h2 id="project-modal-title">{t.projectTitle}<br /><em>{t.projectAccent}</em></h2><div className="project-theses">{projectTheses[language].map((thesis, index) => <article key={thesis}><span>{String(index + 1).padStart(2, '0')}</span><p>{thesis}</p></article>)}</div><footer><span>{t.projectDue}</span><button type="button" onClick={onClose}>{t.returnArea} ↙</button></footer></section></div>;
}

function ApartmentDetail({ unit, language, onDetails }: { unit: Apartment; language: Language; onDetails: () => void }) {
  const t = ui[language];
  return <aside className="unit-detail unit-detail--visual" aria-live="polite"><div className="unit-detail__top"><p>{t.apartment} №{unit.number}</p><span className={`status-chip status-chip--${unit.status}`}>{t.statuses[unit.status]}</span></div><div className="unit-plan-preview"><picture><source media="(max-width: 850px)" srcSet={assetPath('/avalon-apartment-plan-mobile.webp')} /><img src={assetPath('/avalon-apartment-plan.png')} alt={`${t.floorPlan} №${unit.number}`} loading="lazy" decoding="async" /></picture></div><div className="plan-format-label">▦ {t.layout2d}</div><h3>{unit.rooms} {t.rooms.toLowerCase()} · {unit.area} m²</h3><dl><div><dt>{t.building}</dt><dd>{unit.building}</dd></div><div><dt>{t.floor}</dt><dd>{unit.floor}</dd></div><div><dt>{t.condition}</dt><dd>{repairLabel(unit.repair, language)}</dd></div><div><dt>{t.status}</dt><dd>{t.statuses[unit.status]}</dd></div></dl><div className="unit-price"><span>{t.price}</span><strong>{formatMoney(unit.price)}</strong><small>{formatMoney(unit.pricePerM2)} / m²</small></div><button className="unit-detail__details" type="button" onClick={onDetails}>{t.details} <span>↗</span></button><small className="unit-detail__source">{t.statusSource}</small></aside>;
}

function ApartmentModal({ unit, language, onClose, onPrint, onLead }: { unit: Apartment; language: Language; onClose: () => void; onPrint: () => void; onLead: () => void }) {
  const [downPaymentInput, setDownPaymentInput] = useState('0');
  const [term, setTerm] = useState(24);
  const t = ui[language];
  const price = unit.price ?? 0;
  const downPayment = Math.min(price, Math.max(0, Number(downPaymentInput.replace(/\s/g, '')) || 0));
  const balance = unit.price ? Math.max(unit.price - downPayment, 0) : null;
  const monthly = balance === null ? null : Math.ceil(balance / term);
  const downPaymentPercent = price ? Math.round((downPayment / price) * 1000) / 10 : 0;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="apartment-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button className="modal-close" type="button" aria-label="Close" onClick={onClose}>×</button><div className="modal-heading"><div><p>{t.apartmentInfo}</p><h2 id="detail-title">{t.apartment} №{unit.number}</h2></div><span className={`status-chip status-chip--${unit.status}`}>{t.statuses[unit.status]}</span></div><div className="modal-unit-card"><div className="modal-plan"><picture><source media="(max-width: 850px)" srcSet={assetPath('/avalon-apartment-plan-mobile.webp')} /><img src={assetPath('/avalon-apartment-plan.png')} alt={`${t.floorPlan} №${unit.number}`} loading="lazy" decoding="async" /></picture></div><div><span className="room-badge">{unit.rooms}к</span><h3>AVALON RESIDENCE · {unit.building}</h3><p>{unit.floor} {t.floor.toLowerCase()} · № {unit.number}</p><strong>{formatMoney(unit.price)}</strong><small>{unit.area} m² · {formatMoney(unit.pricePerM2)} / m²</small></div></div><h3 className="payment-title">{t.installment}</h3><div className="payment-grid"><article><span>₿</span><small>{t.total}</small><strong>{formatMoney(unit.price)}</strong></article><article><span>◫</span><small>{t.downPayment} · {downPaymentPercent}%</small><strong>{formatMoney(downPayment)}</strong></article><article><span>◇</span><small>{t.monthly} · {term} {t.months}</small><strong>{formatMoney(monthly)}</strong></article></div><div className="installment-calculator"><div className="calculator-controls"><label><span>{t.downPaymentUzs}</span><input type="number" min="0" max={price || undefined} step="1000000" value={downPaymentInput} onChange={(event) => setDownPaymentInput(event.target.value)} /></label><label><span>{t.installmentTerm}: <strong>{term} {t.months}</strong></span><input type="range" min="24" max="36" step="1" value={term} onChange={(event) => setTerm(Number(event.target.value))} /></label><div className="term-presets">{[24, 30, 36].map((months) => <button key={months} type="button" className={term === months ? 'is-active' : ''} onClick={() => setTerm(months)}>{months} {language === 'ru' ? 'мес.' : 'oy'}</button>)}</div></div><div className="calculator-result"><span>{t.saleAmount}</span><strong>{formatMoney(balance)}</strong><span>{t.installmentTerm}</span><strong>{term} {t.months}</strong><span>{t.monthly}</span><strong>{formatMoney(monthly)}</strong></div></div><div className="modal-actions"><button type="button" onClick={onPrint}>{t.printOffer}</button><button className="modal-actions__lead" type="button" onClick={onLead}>{t.contactTencorp} ↗</button></div><small className="calculation-disclaimer">{t.disclaimer}</small></section></div>;
}

function PrintProposal({ unit, language, onClose }: { unit: Apartment; language: Language; onClose: () => void }) {
  const monthly = unit.price ? Math.ceil(unit.price / 24) : null;
  const t = ui[language];
  const date = new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const uz = language === 'uz';
  return <div className="proposal-backdrop"><div className="proposal-controls"><button type="button" onClick={onClose}>× {uz ? 'Yopish' : 'Закрыть'}</button><button type="button" onClick={() => window.print()}>⌁ {uz ? 'Chop etish' : 'Печать'} / PDF</button></div><article className="print-proposal" id="print-proposal"><aside className="proposal-brand"><div className="proposal-logo"><span>A</span><strong>AVALON</strong><small>RESIDENCE</small></div><p>{uz ? 'Turar-joy majmuasi' : 'Жилой комплекс'}</p><h2>AVALON<br />RESIDENCE</h2><div className="proposal-location"><span>{uz ? 'Joylashuv' : 'Расположение'}</span><strong>{uz ? 'Toshkent · Tuzel' : 'Ташкент · Тузель'}</strong><small>{uz ? 'Yashnobod tumani' : 'Яшнободский район'}</small></div><div className="proposal-tencorp"><span>TENCORP</span><small>{uz ? 'Ko‘chmas mulk — strategiya sifatida' : 'Недвижимость как стратегия'}</small></div></aside><div className="proposal-main"><header><div><span>{t.building}</span><strong>{unit.building}</strong></div><div><span>{uz ? 'Kirish' : 'Подъезд'}</span><strong>1</strong></div><div><span>{t.floor}</span><strong>{unit.floor}</strong></div><div><span>{t.apartment}</span><strong>№{unit.number}</strong></div><div><span>{t.condition}</span><strong>{repairLabel(unit.repair, language)}</strong></div></header><div className="proposal-address"><span>{uz ? 'Majmua manzili' : 'Адрес комплекса'}</span><strong>{uz ? 'Toshkent shahri, Yashnobod tumani, Tuzel massivi' : 'город Ташкент, Яшнободский район, массив Тузель'}</strong></div><div className="proposal-plan"><span>{t.floorPlan}</span><img src={assetPath('/avalon-apartment-plan.png')} alt={`${t.floorPlan} №${unit.number}`} /></div><footer><span>{uz ? `Taklif ${date} sanasida shakllantirildi` : `Предложение сформировано ${date}`}</span><strong>{uz ? 'Dolzarb ma’lumotlar' : 'Актуальные данные'}</strong></footer></div><aside className="proposal-summary"><div className="proposal-room">{unit.rooms}к</div><dl><div><dt>{uz ? 'Umumiy maydon' : 'Общая площадь'}</dt><dd>{unit.area} m²</dd></div><div><dt>{t.price}</dt><dd>{formatMoney(unit.price)}</dd></div></dl><div className="proposal-payment"><span>{t.downPayment}</span><strong>0 UZS</strong><span>{t.priceM2}</span><strong>{formatMoney(unit.pricePerM2)}</strong><span>{t.monthly} · 24 {t.months}</span><strong>{formatMoney(monthly)}</strong></div><div className="proposal-contact"><span>{uz ? 'Tencorp savdo ofisi' : 'Офис продаж Tencorp'}</span><strong>{uz ? 'Toshkent, Oybek ko‘chasi, 20' : 'Ташкент, ул. Ойбек, 20'}</strong><span>{uz ? 'Telefon' : 'Телефон'}</span><a href="tel:+998781137712">+998 78 113 77 12</a><span>E-mail</span><a href="mailto:tencorp.uzb@gmail.com">tencorp.uzb@gmail.com</a><small>{uz ? 'Taklif ommaviy oferta emas. Amaldagi shartlarni Tencorp menejeridan aniqlang.' : 'Предложение не является публичной офертой. Актуальные условия уточняйте у менеджера Tencorp.'}</small></div></aside></article></div>;
}

function SiteHeader({ language, onLanguageChange, onHome, onApartments, light = false }: { language: Language; onLanguageChange: (language: Language) => void; onHome: () => void; onApartments: () => void; light?: boolean }) {
  const t = ui[language];
  return <header className={`site-header ${light ? 'site-header--light' : ''}`}><button className="brand" type="button" onClick={onHome}><span className="brand__mark">A</span><span><strong>AVALON</strong><small>RESIDENCE</small></span></button><div className="showroom-steps"><span>{t.neighborhood}</span><i>→</i><span>{t.building}</span><i>→</i><span>{t.floor}</span><i>→</i><strong>{t.apartment}</strong></div><div className="site-header__actions"><a className="header-phone" href="tel:+998781137712">+998 78 113 77 12</a><button className="language-switch" type="button" onClick={() => onLanguageChange(language === 'ru' ? 'uz' : 'ru')} aria-label={language === 'ru' ? 'UZ — O‘zbek tiliga o‘tish' : 'RU — переключить на русский'}>{language === 'ru' ? 'UZ' : 'RU'}</button><button className="header-cta" type="button" onClick={onApartments}><span className="header-cta__desktop">{t.chooseApartment}</span><span className="header-cta__mobile">{language === 'ru' ? 'Квартиры' : 'Kvartiralar'}</span></button></div></header>;
}
