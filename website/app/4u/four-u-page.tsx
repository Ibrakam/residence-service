'use client';

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Slide = { src: string; label: string; type: 'render' | 'photo' };
type LightboxState = { slides: Slide[]; index: number } | null;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];
const image = (name: string) => `${appBasePath}/4u/images/${name}.webp`;

const copy = {
  ru: {
    nav: { project: 'Идея', architecture: 'Архитектура', courtyards: 'Четыре двора', community: 'Соседский центр', location: 'Локация' },
    menu: 'Меню', close: 'Закрыть', choose: 'Выбрать квартиру', consult: 'Получить консультацию', language: 'Язык', skip: 'Перейти к содержанию',
    heroKicker: 'BUSINESS · MIRZO-ULUGBEK DISTRICT', heroTitle: '4U', heroDisplay: 'Tashkent', heroLead: 'Manhattan energy. California ease. Four courtyards.', heroAddress: 'Ташкент · Мирзо-Улугбекский район · вдоль улицы Сайрам', heroNote: 'Официальная визуализация проекта', nearest: 'Ближайшая сдача · III кв. 2027',
    manifestKicker: 'NRG-BI × AL-BINA', manifestTitle: 'Место, где сбываются мечты.', manifestText: 'Энергия Манхэттена встречается со статусом калифорнийской роскоши. 4U — это mix-used проект, где жилые дворы, общественные пространства, кафе и магазины складываются в единую городскую среду.',
    facts: [['3 м', 'потолки'], ['30–131 м²', 'площади'], ['16 / 20', 'этажность'], ['4', 'идеологии двора']],
    archKicker: '01 · METROPOLITAN OPTIMISM', archTitle: 'Городская энергия, собранная в архитектуру.', archText: 'Вертикальный ритм фасадов, светлый камень и активные первые этажи создают квартал, открытый большому городу. Рендеры показывают проектное видение и не являются фотографиями готового объекта.', render: 'Официальная визуализация', photo: 'Фото строительства · июль 2026', prev: 'Предыдущее изображение', next: 'Следующее изображение',
    courtsKicker: '02 · FOUR RHYTHMS', courtsTitle: 'Четыре двора. Четыре настроения.', courtsLead: 'Темы дворов отражаются в малых архитектурных формах, детских площадках, скамейках и декоративных деталях — сдержанно, без потери общего стиля.',
    courts: [
      { name: 'Чайный', code: '01', text: 'Спокойный ритм встреч и неспешного общения.', color: '#ee9c72' },
      { name: 'Ореховый', code: '02', text: 'Тактильные материалы и тёплая природная палитра.', color: '#b79063' },
      { name: 'Фруктовый', code: '03', text: 'Живое пространство движения и семейной активности.', color: '#df6d69' },
      { name: 'Сладкий', code: '04', text: 'Игривые детали в общей премиальной системе.', color: '#6d78b8' },
    ],
    amenitiesKicker: '03 · LANDSCAPE & LIFE', amenitiesTitle: 'Пространство, которое работает на каждый день.', amenities: ['Богатое озеленение', 'Авторский ландшафт', 'Безопасная территория', 'BBQ-зона', 'Европейские детские площадки', 'Футбольная площадка', 'Беседки'],
    hallsKicker: '04 · ARRIVAL', hallsTitle: 'Авторские холлы — спокойная пауза между городом и домом.', hallsText: 'Бесшумные лифты, мягкие зоны ожидания, колясочные, безбарьерная среда и сквозные подъезды формируют понятный ежедневный маршрут.',
    communityKicker: '05 · NEIGHBOURHOOD', communityTitle: 'Работа и кино — рядом с домом.', coworking: 'Коворкинг', cinema: 'Кинорум', coworkingText: 'Рабочие места, зоны для индивидуальной и командной работы, переговорные — для встреч, учёбы и сфокусированного дня без поездки в центр.', cinemaText: 'Кинорум соседского центра — пространство для совместных просмотров и отдыха жителей. Изображение отражает проектное видение.',
    locationKicker: '06 · SAYRAM STREET', locationTitle: 'Территория большой жизни.', locationText: 'Мирзо-Улугбекский район, вдоль улицы Сайрам. Рядом — Университет мировой экономики и дипломатии, супермаркет Korzinka, станции метро «Буюк Ипак Йули» и «Пушкинская»; неподалёку строится The British School of Tashkent.', map: 'Открыть карту', panorama: 'Панорама 360',
    buildKicker: '07 · CONSTRUCTION', buildTitle: 'Строительство — без подмены рендерами.', buildText: 'Официальный отчёт за июль 2026: монолитные работы ведутся в трёх блоках; в блоках 2 и 3 выполнялось бетонирование перекрытия второго этажа.', camera: 'Онлайн-камера', cameraStatus: 'Временно недоступна: проводятся технические работы.',
    catalogKicker: '08 · LIVE SELECTION', catalogTitle: '33 реальных предложения в локальном snapshot.', catalogText: 'Snapshot от 30 августа 2026 года собран из 183 предложений официального каталога. Площади, этажи, цены и планировки сохранены локально; перед покупкой статус нужно подтвердить.', catalogOpen: 'Открыть каталог', booklet: 'Скачать буклет · PDF',
    contactKicker: '09 · PERSONAL SELECTION', contactTitle: 'Выберите пространство для своей большой жизни.', contactText: 'Оставьте контакты — менеджер проекта подтвердит актуальность предложения и подберёт подходящий сценарий.', phone: 'Позвонить · +998 78 113 77 12', legal: 'Визуализации и проектные решения могут изменяться в ходе проектирования, строительства и эксплуатации. Информация не является публичной офертой.', partner: 'Партнёрский проект NRG-BI и Al-Bina',
  },
  uz: {
    nav: { project: 'G‘oya', architecture: 'Arxitektura', courtyards: 'To‘rt hovli', community: 'Qo‘shnilar markazi', location: 'Joylashuv' },
    menu: 'Menyu', close: 'Yopish', choose: 'Xonadon tanlash', consult: 'Maslahat olish', language: 'Til', skip: 'Asosiy mazmunga o‘tish',
    heroKicker: 'BUSINESS · MIRZO ULUG‘BEK TUMANI', heroTitle: '4U', heroDisplay: 'Tashkent', heroLead: 'Manhattan energiyasi. California yengilligi. To‘rt hovli.', heroAddress: 'Toshkent · Mirzo Ulug‘bek tumani · Sayram ko‘chasi bo‘ylab', heroNote: 'Loyihaning rasmiy vizualizatsiyasi', nearest: 'Eng yaqin topshirish · 2027-yil III chorak',
    manifestKicker: 'NRG-BI × AL-BINA', manifestTitle: 'Orzular ro‘yobga chiqadigan joy.', manifestText: 'Manhattan energiyasi California hashamati bilan uchrashadi. 4U — turar joy hovlilari, jamoat makonlari, kafe va do‘konlarni yagona shahar muhitiga birlashtirgan mix-used loyiha.',
    facts: [['3 m', 'shiftlar'], ['30–131 m²', 'maydon'], ['16 / 20', 'qavat'], ['4', 'hovli g‘oyasi']],
    archKicker: '01 · METROPOLITAN OPTIMISM', archTitle: 'Shahar energiyasi arxitekturaga aylangan.', archText: 'Fasadlarning vertikal ritmi, och tosh va faol birinchi qavatlar katta shaharga ochiq kvartal yaratadi. Renderlar loyiha tasavvurini ko‘rsatadi, tayyor obyekt fotosurati emas.', render: 'Rasmiy vizualizatsiya', photo: 'Qurilish fotosi · 2026-yil iyul', prev: 'Oldingi rasm', next: 'Keyingi rasm',
    courtsKicker: '02 · FOUR RHYTHMS', courtsTitle: 'To‘rt hovli. To‘rt kayfiyat.', courtsLead: 'Mavzular kichik me’moriy shakllar, bolalar maydonchalari, o‘rindiqlar va dekorativ detallarda aks etadi.',
    courts: [{ name: 'Choy', code: '01', text: 'Uchrashuv va sokin suhbatlar ritmi.', color: '#ee9c72' }, { name: 'Yong‘oq', code: '02', text: 'Tabiiy material va iliq palitra.', color: '#b79063' }, { name: 'Meva', code: '03', text: 'Oila va harakat uchun jonli makon.', color: '#df6d69' }, { name: 'Shirinlik', code: '04', text: 'Umumiy premium tizimdagi yengil detallar.', color: '#6d78b8' }],
    amenitiesKicker: '03 · LANDSCAPE & LIFE', amenitiesTitle: 'Har kun uchun ishlaydigan makon.', amenities: ['Boy ko‘kalamzorlashtirish', 'Mualliflik landshafti', 'Xavfsiz hudud', 'BBQ zonasi', 'Yevropa bolalar maydonchalari', 'Futbol maydoni', 'Ayvonlar'],
    hallsKicker: '04 · ARRIVAL', hallsTitle: 'Mualliflik xollari — shahar va uy orasidagi sokin pauza.', hallsText: 'Shovqinsiz liftlar, kutish joylari, aravachalar xonasi, to‘siqsiz muhit va ikki tomonlama kirishlar.',
    communityKicker: '05 · NEIGHBOURHOOD', communityTitle: 'Ish va kino — uy yonida.', coworking: 'Kovorking', cinema: 'Kinoxona', coworkingText: 'Individual va jamoaviy ish joylari, uchrashuv xonalari — markazga bormasdan ishlash va o‘qish uchun.', cinemaText: 'Qo‘shnilar markazidagi kinoxona — aholi uchun birgalikda tomosha qilish va dam olish makoni.',
    locationKicker: '06 · SAYRAM STREET', locationTitle: 'Katta hayot hududi.', locationText: 'Mirzo Ulug‘bek tumani, Sayram ko‘chasi bo‘ylab. Yaqinda JIDU, Korzinka, Buyuk Ipak Yo‘li va Pushkin metro bekatlari bor; The British School of Tashkent qurilmoqda.', map: 'Xaritani ochish', panorama: '360 panorama',
    buildKicker: '07 · CONSTRUCTION', buildTitle: 'Qurilish — renderlar bilan almashtirilmagan.', buildText: '2026-yil iyul rasmiy hisoboti: uch blokda monolit ishlari davom etgan, 2- va 3-bloklarda ikkinchi qavat yopmasi betonlangan.', camera: 'Onlayn kamera', cameraStatus: 'Vaqtincha ishlamaydi: texnik ishlar olib borilmoqda.',
    catalogKicker: '08 · LIVE SELECTION', catalogTitle: 'Mahalliy snapshotda 33 haqiqiy taklif.', catalogText: '2026-yil 30-avgust snapshoti rasmiy katalogdagi 183 taklifdan tuzilgan. Xariddan oldin holatni tasdiqlash kerak.', catalogOpen: 'Katalogni ochish', booklet: 'Bukletni yuklash · PDF',
    contactKicker: '09 · PERSONAL SELECTION', contactTitle: 'Katta hayotingiz uchun makonni tanlang.', contactText: 'Kontakt qoldiring — loyiha menejeri taklifning dolzarbligini tasdiqlaydi.', phone: 'Qo‘ng‘iroq · +998 78 113 77 12', legal: 'Vizualizatsiya va loyiha yechimlari o‘zgarishi mumkin. Ma’lumot ommaviy oferta emas.', partner: 'NRG-BI va Al-Bina hamkorlik loyihasi',
  },
  en: {
    nav: { project: 'Idea', architecture: 'Architecture', courtyards: 'Four courtyards', community: 'Community hub', location: 'Location' },
    menu: 'Menu', close: 'Close', choose: 'Choose an apartment', consult: 'Request a consultation', language: 'Language', skip: 'Skip to content',
    heroKicker: 'BUSINESS · MIRZO ULUGBEK DISTRICT', heroTitle: '4U', heroDisplay: 'Tashkent', heroLead: 'Manhattan energy. California ease. Four courtyards.', heroAddress: 'Tashkent · Mirzo Ulugbek district · along Sayram Street', heroNote: 'Official project visualisation', nearest: 'Nearest completion · Q3 2027',
    manifestKicker: 'NRG-BI × AL-BINA', manifestTitle: 'Where dreams come true.', manifestText: 'Manhattan energy meets the status of California luxury. 4U is a mixed-use project that brings residential courtyards, public spaces, cafés and shops into one urban environment.',
    facts: [['3 m', 'ceilings'], ['30–131 m²', 'areas'], ['16 / 20', 'storeys'], ['4', 'courtyard ideas']],
    archKicker: '01 · METROPOLITAN OPTIMISM', archTitle: 'Urban energy, shaped as architecture.', archText: 'Vertical façades, pale stone and active ground floors create a district open to the city. The renders show the design vision, not a completed building.', render: 'Official visualisation', photo: 'Construction photo · July 2026', prev: 'Previous image', next: 'Next image',
    courtsKicker: '02 · FOUR RHYTHMS', courtsTitle: 'Four courtyards. Four moods.', courtsLead: 'The themes appear in landscape objects, playgrounds, benches and decorative details while preserving one refined identity.',
    courts: [{ name: 'Tea', code: '01', text: 'A calm rhythm for meetings and conversation.', color: '#ee9c72' }, { name: 'Nut', code: '02', text: 'Tactile materials and a warm natural palette.', color: '#b79063' }, { name: 'Fruit', code: '03', text: 'A lively space for movement and family time.', color: '#df6d69' }, { name: 'Sweet', code: '04', text: 'Playful details within a premium system.', color: '#6d78b8' }],
    amenitiesKicker: '03 · LANDSCAPE & LIFE', amenitiesTitle: 'Space designed around every day.', amenities: ['Rich landscaping', 'Author-led landscape design', 'Secure grounds', 'BBQ area', 'European playgrounds', 'Football pitch', 'Gazebos'],
    hallsKicker: '04 · ARRIVAL', hallsTitle: 'Signature lobbies — a quiet pause between city and home.', hallsText: 'Silent lifts, waiting areas, pram rooms, step-free access and through entrances create an effortless daily route.',
    communityKicker: '05 · NEIGHBOURHOOD', communityTitle: 'Work and cinema — close to home.', coworking: 'Coworking', cinema: 'Cinema room', coworkingText: 'Individual and team workspaces plus meeting rooms — for a focused day without travelling downtown.', cinemaText: 'The community cinema room is designed for shared screenings and resident downtime.',
    locationKicker: '06 · SAYRAM STREET', locationTitle: 'A territory for a bigger life.', locationText: 'Mirzo Ulugbek district, along Sayram Street. UWED, Korzinka, Buyuk Ipak Yuli and Pushkinskaya metro stations are nearby; The British School of Tashkent is under construction.', map: 'Open map', panorama: '360 panorama',
    buildKicker: '07 · CONSTRUCTION', buildTitle: 'Construction, clearly separated from renders.', buildText: 'Official July 2026 report: monolithic works were underway in three blocks, with second-floor slab concreting in blocks 2 and 3.', camera: 'Live camera', cameraStatus: 'Temporarily unavailable due to maintenance.',
    catalogKicker: '08 · LIVE SELECTION', catalogTitle: '33 verified listings in the local snapshot.', catalogText: 'The 30 August 2026 snapshot is sampled from 183 official catalogue listings. Confirm availability before purchase.', catalogOpen: 'Open catalogue', booklet: 'Download brochure · PDF',
    contactKicker: '09 · PERSONAL SELECTION', contactTitle: 'Choose the space for your bigger life.', contactText: 'Leave your details and the project manager will confirm current availability.', phone: 'Call · +998 78 113 77 12', legal: 'Visualisations and project decisions may change. Information is not a public offer.', partner: 'A partnership project by NRG-BI and Al-Bina',
  },
} as const;

function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function leadSubmitUrl() { return `${appBasePath}/v1/leads`; }

function useLanguage(initialLanguage: Language = 'ru') {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  useEffect(() => { const query = new URLSearchParams(window.location.search).get('lang'); const saved = localStorage.getItem('fouru-language'); const next = languages.includes(query as Language) ? query : saved; const frame = requestAnimationFrame(() => { if (languages.includes(next as Language)) setLanguageState(next as Language); }); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => { setLanguageState(next); localStorage.setItem('fouru-language', next); const url = new URL(window.location.href); url.searchParams.set('lang', next); history.replaceState({}, '', url); };
  return [language, setLanguage] as const;
}

function Lightbox({ state, onClose, labels }: { state: NonNullable<LightboxState>; onClose: () => void; labels: { prev: string; next: string; close: string; render: string; photo: string } }) {
  const [index, setIndex] = useState(state.index); const touch = useRef(0); const closeRef = useRef<HTMLButtonElement>(null); const current = state.slides[index];
  const move = (delta: number) => setIndex((value) => (value + delta + state.slides.length) % state.slides.length);
  useEffect(() => { closeRef.current?.focus(); document.body.classList.add('is-fouru-overlay'); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); if (event.key === 'ArrowLeft') setIndex((value) => (value - 1 + state.slides.length) % state.slides.length); if (event.key === 'ArrowRight') setIndex((value) => (value + 1) % state.slides.length); }; addEventListener('keydown', key); return () => { document.body.classList.remove('is-fouru-overlay'); removeEventListener('keydown', key); }; }, [onClose, state.slides.length]);
  return <div className="fouru-lightbox" role="dialog" aria-modal="true" aria-label={current.label} onClick={(e) => { if (e.currentTarget === e.target) onClose(); }} onTouchStart={(e) => { touch.current = e.changedTouches[0].clientX; }} onTouchEnd={(e) => { const delta = e.changedTouches[0].clientX - touch.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }}>
    <button ref={closeRef} className="fouru-lightbox__close" type="button" aria-label={labels.close} onClick={onClose}>×</button>
    <button className="fouru-lightbox__arrow is-prev" type="button" aria-label={labels.prev} onClick={() => move(-1)}>←</button>
    <figure><img src={current.src} alt={current.label} /><figcaption><span>{current.type === 'photo' ? labels.photo : labels.render}</span><strong>{String(index + 1).padStart(2, '0')} / {String(state.slides.length).padStart(2, '0')}</strong></figcaption></figure>
    <button className="fouru-lightbox__arrow is-next" type="button" aria-label={labels.next} onClick={() => move(1)}>→</button>
  </div>;
}

export function FourUPage({ initialLanguage = 'ru' }: { initialLanguage?: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage); const t = copy[language];
  const [loading, setLoading] = useState(true); const [menu, setMenu] = useState(false); const [lead, setLead] = useState(false); const [lightbox, setLightbox] = useState<LightboxState>(null); const [court, setCourt] = useState(0); const [community, setCommunity] = useState<'coworking' | 'cinema'>('coworking');
  useEffect(() => { const seen = sessionStorage.getItem('fouru-loader-seen') === '1'; const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches; if (seen || reduced) { const frame = requestAnimationFrame(() => setLoading(false)); return () => cancelAnimationFrame(frame); } const timer = setTimeout(() => { setLoading(false); sessionStorage.setItem('fouru-loader-seen', '1'); }, 1550); return () => clearTimeout(timer); }, []);
  useEffect(() => { document.body.classList.toggle('is-fouru-menu', menu); const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); }; addEventListener('keydown', key); return () => { document.body.classList.remove('is-fouru-menu'); removeEventListener('keydown', key); }; }, [menu]);

  const architecture: Slide[] = [{ src: image('architecture-1'), label: t.archTitle, type: 'render' }, { src: image('architecture-2'), label: t.archTitle, type: 'render' }, { src: image('architecture-3'), label: t.archTitle, type: 'render' }];
  const courtyards: Slide[] = [{ src: image('courtyard-1'), label: t.courtsTitle, type: 'render' }, { src: image('courtyard-2'), label: t.courtsTitle, type: 'render' }];
  const halls: Slide[] = [{ src: image('hall-1'), label: t.hallsTitle, type: 'render' }, { src: image('hall-2'), label: t.hallsTitle, type: 'render' }, { src: image('hall-3'), label: t.hallsTitle, type: 'render' }];
  const construction: Slide[] = [{ src: image('construction-1'), label: t.buildTitle, type: 'photo' }, { src: image('construction-2'), label: t.buildTitle, type: 'photo' }, { src: image('construction-3'), label: t.buildTitle, type: 'photo' }];
  const langLinks = <div className="fouru-languages" aria-label={t.language}>{languages.map((item) => <a href={withLanguage('/4u', item)} key={item} className={language === item ? 'is-active' : ''} aria-current={language === item ? 'page' : undefined} onClick={(e) => { e.preventDefault(); setLanguage(item); }}>{item.toUpperCase()}</a>)}</div>;

  return <main className="fouru-site" lang={language}>
    <a className="fouru-skip" href="#fouru-content">{t.skip}</a>
    {loading ? <div className="fouru-loader" aria-label="4U Tashkent"><div className="fouru-loader__grid">{[0, 1, 2, 3].map((i) => <i key={i} />)}</div><strong>4U</strong><span>TASHKENT</span></div> : null}
    <header className="fouru-header"><a className="fouru-logo" href={withLanguage('/4u', language)} aria-label="4U Tashkent"><b>4U</b><span>TASHKENT</span></a><nav aria-label="4U">{Object.entries(t.nav).map(([key, value]) => <a key={key} href={`${withLanguage('/4u', language)}#${key}`}>{value}</a>)}</nav><div className="fouru-header__actions">{langLinks}<a className="fouru-header__cta" href={withLanguage('/4u/apartments', language)}>{t.choose}</a><button className="fouru-menu-button" type="button" onClick={() => setMenu(true)} aria-expanded={menu} aria-controls="fouru-menu">{t.menu}<i /></button></div></header>
    <div id="fouru-menu" className={`fouru-menu ${menu ? 'is-open' : ''}`} aria-hidden={!menu}><button className="fouru-menu__close" type="button" aria-label={t.close} onClick={() => setMenu(false)}>×</button><div className="fouru-menu__number">04</div><nav>{Object.entries(t.nav).map(([key, value], i) => <a key={key} href={`${withLanguage('/4u', language)}#${key}`} onClick={() => setMenu(false)}><span>0{i + 1}</span>{value}</a>)}</nav>{langLinks}<a className="fouru-button is-coral" href={withLanguage('/4u/apartments', language)}>{t.choose}<span>↗</span></a></div>

    <section className="fouru-hero" id="top"><picture><source media="(max-width:700px)" srcSet={image('hero-mobile')} /><img src={image('hero')} alt={t.heroNote} fetchPriority="high" /></picture><div className="fouru-hero__veil" /><div className="fouru-hero__rail"><span>01</span><i /><span>04</span></div><div className="fouru-hero__content"><span className="fouru-kicker">{t.heroKicker}</span><h1><b>{t.heroTitle}</b><em>{t.heroDisplay}</em></h1><p>{t.heroLead}</p><div className="fouru-hero__actions"><a className="fouru-button is-coral" href={withLanguage('/4u/apartments', language)}>{t.choose}<span>↗</span></a><button className="fouru-button is-light" type="button" onClick={() => setLead(true)}>{t.consult}<span>→</span></button></div></div><div className="fouru-hero__meta"><span>{t.heroAddress}</span><span>{t.nearest}</span><small>{t.heroNote}</small></div></section>

    <div id="fouru-content" />
    <section className="fouru-manifest" id="project"><div className="fouru-section-number">00 / 09</div><div><span className="fouru-kicker is-blue">{t.manifestKicker}</span><h2>{t.manifestTitle}</h2></div><p>{t.manifestText}</p></section>
    <section className="fouru-facts" aria-label="4U facts">{t.facts.map(([value, label], i) => <article key={label}><span>0{i + 1}</span><strong>{value}</strong><small>{label}</small></article>)}</section>

    <section className="fouru-architecture" id="architecture"><div className="fouru-copy"><span className="fouru-kicker is-coral">{t.archKicker}</span><h2>{t.archTitle}</h2><p>{t.archText}</p></div><button className="fouru-media is-main" type="button" onClick={() => setLightbox({ slides: architecture, index: 0 })}><img src={architecture[0].src} alt={architecture[0].label} loading="lazy" /><span>{t.render}</span><b>↗</b></button><button className="fouru-media is-side" type="button" onClick={() => setLightbox({ slides: architecture, index: 1 })}><img src={architecture[1].src} alt={architecture[1].label} loading="lazy" /><span>02 / 03</span><b>↗</b></button></section>

    <section className="fouru-courtyards" id="courtyards"><header><span className="fouru-kicker">{t.courtsKicker}</span><h2>{t.courtsTitle}</h2><p>{t.courtsLead}</p></header><div className="fouru-court-tabs" role="tablist" aria-label={t.courtsTitle}>{t.courts.map((item, i) => <button key={item.name} type="button" role="tab" aria-selected={court === i} onClick={() => setCourt(i)} style={{ '--court-color': item.color } as CSSProperties}><span>{item.code}</span><strong>{item.name}</strong></button>)}</div><div className="fouru-court-stage" style={{ '--court-color': t.courts[court].color } as CSSProperties}><button type="button" onClick={() => setLightbox({ slides: courtyards, index: court % 2 })}><img src={courtyards[court % 2].src} alt={`${t.render}: ${t.courts[court].name}`} loading="lazy" /><span>{t.render} · {t.courts[court].code}</span></button><aside><small>{t.courts[court].code} / 04</small><h3>{t.courts[court].name}</h3><p>{t.courts[court].text}</p></aside></div></section>

    <section className="fouru-amenities"><div><span className="fouru-kicker is-blue">{t.amenitiesKicker}</span><h2>{t.amenitiesTitle}</h2></div><ol>{t.amenities.map((item, i) => <li key={item}><span>{String(i + 1).padStart(2, '0')}</span>{item}</li>)}</ol></section>

    <section className="fouru-halls"><div className="fouru-halls__media">{halls.map((slide, i) => <button key={slide.src} type="button" onClick={() => setLightbox({ slides: halls, index: i })}><img src={slide.src} alt={slide.label} loading="lazy" /><span>{String(i + 1).padStart(2, '0')}</span></button>)}</div><div className="fouru-copy"><span className="fouru-kicker is-coral">{t.hallsKicker}</span><h2>{t.hallsTitle}</h2><p>{t.hallsText}</p></div></section>

    <section className="fouru-community" id="community"><div className="fouru-copy"><span className="fouru-kicker">{t.communityKicker}</span><h2>{t.communityTitle}</h2><div className="fouru-community__tabs" role="tablist"><button type="button" role="tab" aria-selected={community === 'coworking'} onClick={() => setCommunity('coworking')}>{t.coworking}</button><button type="button" role="tab" aria-selected={community === 'cinema'} onClick={() => setCommunity('cinema')}>{t.cinema}</button></div><p>{community === 'coworking' ? t.coworkingText : t.cinemaText}</p></div><button className="fouru-community__image" type="button" onClick={() => setLightbox({ slides: [{ src: image(community === 'coworking' ? 'coworking-2' : 'cinema'), label: community === 'coworking' ? t.coworking : t.cinema, type: 'render' }], index: 0 })}><img key={community} src={image(community === 'coworking' ? 'coworking-2' : 'cinema')} alt={`${t.render}: ${community === 'coworking' ? t.coworking : t.cinema}`} loading="lazy" /><span>{t.render}</span></button></section>

    <section className="fouru-location" id="location"><img src={image('aerial')} alt={t.render} loading="lazy" /><div className="fouru-location__veil" /><div className="fouru-location__copy"><span className="fouru-kicker">{t.locationKicker}</span><h2>{t.locationTitle}</h2><p>{t.locationText}</p><div><a className="fouru-button is-light" href="https://yandex.uz/maps/?text=4U%20Tashkent" target="_blank" rel="noreferrer">{t.map}<span>↗</span></a><a className="fouru-button is-coral" href="https://uzbekistan360.uz/ru/location/nrg-bi-4uZR3" target="_blank" rel="noreferrer">{t.panorama}<span>↗</span></a></div></div></section>

    <section className="fouru-build"><div className="fouru-copy"><span className="fouru-kicker is-blue">{t.buildKicker}</span><h2>{t.buildTitle}</h2><p>{t.buildText}</p><div className="fouru-camera"><span>{t.camera}</span><i />{t.cameraStatus}</div></div><div className="fouru-build__grid">{construction.map((slide, i) => <button key={slide.src} type="button" onClick={() => setLightbox({ slides: construction, index: i })}><img src={slide.src} alt={slide.label} loading="lazy" /><span>{t.photo} · 0{i + 1}</span></button>)}</div></section>

    <section className="fouru-catalog"><div><span className="fouru-kicker">{t.catalogKicker}</span><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p><div><a className="fouru-button is-coral" href={withLanguage('/4u/apartments', language)}>{t.catalogOpen}<span>↗</span></a></div></div><aside><span>183</span><small>OFFICIAL<br />LISTINGS</small><i /><span>33</span><small>LOCAL<br />SNAPSHOT</small></aside></section>

    <section className="fouru-contact"><div><span className="fouru-kicker is-coral">{t.contactKicker}</span><h2>{t.contactTitle}</h2><p>{t.contactText}</p></div><div className="fouru-contact__actions"><button className="fouru-button is-coral" type="button" onClick={() => setLead(true)}>{t.consult}<span>↗</span></button><a className="fouru-button is-outline" href="tel:+998781137712">{t.phone}<span>↗</span></a></div></section>
    <footer className="fouru-footer"><a className="fouru-logo" href="#top"><b>4U</b><span>TASHKENT</span></a><p>{t.partner}</p><div><a href={`${appBasePath}/privacy?project=4u&lang=${language}`}>Privacy</a></div><small>{t.legal}</small></footer>

    <LeadModal open={lead} onClose={() => setLead(false)} language={language} context="4U Tashkent — main page consultation" brandName="4U" projectName="TASHKENT" tagline={t.heroLead} facts={t.facts.map(([value, label]) => `${value} · ${label}`)} submitUrl={leadSubmitUrl()} projectSlug="4u" privacyUrl={`${appBasePath}/privacy?project=4u&lang=${language}`} requireConsent />
    {lightbox ? <Lightbox state={lightbox} onClose={() => setLightbox(null)} labels={{ prev: t.prev, next: t.next, close: t.close, render: t.render, photo: t.photo }} /> : null}
  </main>;
}
