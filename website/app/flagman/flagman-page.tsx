'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { LeadModal } from '@/app/lead-modal';

type Language = 'ru' | 'uz' | 'en';
type Slide = { src: string; alt: string; label: string };
type LightboxState = { slides: Slide[]; index: number } | null;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const languages: Language[] = ['ru', 'uz', 'en'];

const copy = {
  ru: {
    nav: { project: 'О проекте', architecture: 'Архитектура', halls: 'Холлы', courtyard: 'Двор', location: 'Локация' },
    menu: 'Меню', close: 'Закрыть', choose: 'Выбрать квартиру', consult: 'Получить консультацию', actual: 'Фактическая фотосъёмка', render: 'Возможный интерьер · визуализация', previous: 'Предыдущее фото', next: 'Следующее фото', language: 'Язык', skip: 'Перейти к содержанию',
    heroOverline: 'Клубный дом Business+ · дом сдан', heroTitle: 'Flagman', heroAccent: 'Роскошный минимализм', heroAddress: 'Мирзо-Улугбекский район · ул. Мухаммада Юсуфа', heroPhoto: 'Реальный готовый дом',
    manifestOverline: 'NRG-BI × AL-BINA', manifestTitle: 'Частная галерея роскошного минимализма — в готовом доме.', manifestText: 'Flagman строит ощущение статуса без демонстративности: спокойные пропорции, натуральные материалы, архитектурный ритм и пространства, где искусство становится частью повседневной жизни.',
    facts: [['Business+', 'Класс жилья'], ['16', 'этажей'], ['3 м', 'высота потолков'], ['Сдан', 'статус дома']],
    architectureOverline: '01 · Материал и ритм', architectureTitle: 'Limestone. Свет. Вертикали.', architectureText: 'Фасад сочетает натуральный камень Limestone, декоративные архитектурные решётки и алюминиевые композитные панели. Строгая пластика здания сохраняет выразительность без лишнего декора.', architectureNote: 'Реальные фотографии фасада готового дома',
    interiorOverline: '02 · Возможный сценарий', interiorTitle: 'Так могла бы выглядеть ваша квартира.', interiorText: 'Официальные изображения показывают один из возможных интерьерных сценариев. Они не являются обещанием или гарантией отделки выбранной квартиры.',
    hallsOverline: '03 · Частная галерея', hallsTitle: 'Светлые холлы, искусство и тишина.', hallsText: 'Лаконичная светлая палитра, дизайнерские картины, растения и зоны ожидания формируют спокойную последовательность от входа до квартиры.', hallsNote: 'Фактические фотографии холлов',
    courtyardOverline: '04 · Закрытый двор', courtyardTitle: 'Пространство без машин — для семьи и встреч.', courtyardText: 'Закрытый безопасный двор объединяет детскую площадку, зону BBQ и тихие места для отдыха. Система видеонаблюдения дополняет приватный сценарий территории.', courtyardFeatures: ['Двор без машин', 'Безопасная территория', 'Зона BBQ', 'Детская площадка'],
    landscapeOverline: '05 · Ландшафт', landscapeTitle: '45%', landscapeAccent: 'территории занимает озеленение.', landscapeText: 'Лиственные и хвойные деревья, декоративные кустарники, многолетние растения и газон создают зрелое, ухоженное окружение дома.',
    locationOverline: '06 · Ташкент', locationTitle: 'В центре Мирзо-Улугбекского района.', locationText: 'Улица Мухаммада Юсуфа, 54. Рядом — городская инфраструктура района, школы, магазины, кафе и общественный транспорт.', map: 'Открыть на карте',
    galleryOverline: '07 · Дом сдан', galleryTitle: 'Flagman сегодня.', galleryText: 'Фактическая фотогалерея готового дома, фасада, холлов и благоустроенной территории.',
    catalogOverline: '08 · Официальный каталог', catalogTitle: '8 актуальных предложений в сохранённом срезе.', catalogText: 'Точные площади, этажи, цены и планировки из официального каталога на 30 августа 2026 года.', catalogNote: 'Цена и статус фиксируются на дату snapshot и могут измениться у официального продавца.',
    contactOverline: '09 · Персональная консультация', contactTitle: 'Выберите пространство, которое будет вашим.', contactText: 'Оставьте контакты — менеджер проекта подтвердит актуальный статус, гибкие условия оплаты и детали выбранной квартиры.', phone: 'Телефон', booklet: 'Официальный буклет', privacy: 'Конфиденциальность', partner: 'Партнёрский проект NRG-BI и AL-BINA',
  },
  uz: {
    nav: { project: 'Loyiha', architecture: 'Arxitektura', halls: 'Xollar', courtyard: 'Hovli', location: 'Joylashuv' },
    menu: 'Menyu', close: 'Yopish', choose: 'Xonadon tanlash', consult: 'Maslahat olish', actual: 'Haqiqiy fotosurat', render: 'Mumkin bo‘lgan interyer · vizualizatsiya', previous: 'Oldingi surat', next: 'Keyingi surat', language: 'Til', skip: 'Asosiy mazmunga o‘tish',
    heroOverline: 'Business+ klub uyi · uy topshirilgan', heroTitle: 'Flagman', heroAccent: 'Hashamatli minimalizm', heroAddress: 'Mirzo Ulug‘bek tumani · Muhammad Yusuf ko‘chasi', heroPhoto: 'Haqiqiy tayyor uy',
    manifestOverline: 'NRG-BI × AL-BINA', manifestTitle: 'Tayyor uydagi hashamatli minimalizmning xususiy galereyasi.', manifestText: 'Flagman maqomni ortiqcha namoyishsiz his qildiradi: sokin nisbatlar, tabiiy materiallar, me’moriy ritm va san’at kundalik hayotning bir qismiga aylangan makonlar.',
    facts: [['Business+', 'Uy klassi'], ['16', 'qavat'], ['3 m', 'shift balandligi'], ['Tayyor', 'uy holati']],
    architectureOverline: '01 · Material va ritm', architectureTitle: 'Limestone. Yorug‘lik. Vertikallar.', architectureText: 'Fasadda tabiiy Limestone toshi, dekorativ me’moriy panjaralar va alyuminiy kompozit panellar uyg‘unlashgan. Qat’iy plastika ortiqcha bezaksiz ta’sirchan ko‘rinadi.', architectureNote: 'Tayyor uy fasadining haqiqiy fotosuratlari',
    interiorOverline: '02 · Mumkin bo‘lgan ssenariy', interiorTitle: 'Xonadoningiz shunday ko‘rinishi mumkin edi.', interiorText: 'Rasmiy tasvirlar mumkin bo‘lgan interyer ssenariylaridan birini ko‘rsatadi. Ular tanlangan xonadon pardozining va’dasi yoki kafolati emas.',
    hallsOverline: '03 · Xususiy galereya', hallsTitle: 'Yorug‘ xollar, san’at va sokinlik.', hallsText: 'Yorug‘ palitra, dizaynerlik kartinalari, o‘simliklar va kutish zonalari kirishdan xonadongacha sokin ketma-ketlik yaratadi.', hallsNote: 'Xollarning haqiqiy fotosuratlari',
    courtyardOverline: '04 · Yopiq hovli', courtyardTitle: 'Mashinalarsiz — oila va uchrashuvlar uchun.', courtyardText: 'Yopiq xavfsiz hovlida bolalar maydonchasi, BBQ zonasi va sokin dam olish joylari bor. Videokuzatuv hududning xususiy ssenariysini to‘ldiradi.', courtyardFeatures: ['Mashinalarsiz hovli', 'Xavfsiz hudud', 'BBQ zonasi', 'Bolalar maydonchasi'],
    landscapeOverline: '05 · Landshaft', landscapeTitle: '45%', landscapeAccent: 'hudud ko‘kalamzorlashtirilgan.', landscapeText: 'Bargli va ignabargli daraxtlar, dekorativ butalar, ko‘p yillik o‘simliklar va maysazor yetuk, parvarishlangan muhit yaratadi.',
    locationOverline: '06 · Toshkent', locationTitle: 'Mirzo Ulug‘bek tumani markazida.', locationText: 'Muhammad Yusuf ko‘chasi, 54. Yaqinda tuman infratuzilmasi, maktablar, do‘konlar, kafelar va jamoat transporti bor.', map: 'Xaritada ochish',
    galleryOverline: '07 · Uy topshirilgan', galleryTitle: 'Flagman bugun.', galleryText: 'Tayyor uy, fasad, xollar va obodonlashtirilgan hududning haqiqiy fotogalereyasi.',
    catalogOverline: '08 · Rasmiy katalog', catalogTitle: 'Saqlangan snapshotda 8 ta dolzarb taklif.', catalogText: '2026-yil 30-avgustdagi rasmiy katalogdan aniq maydon, qavat, narx va rejalar.', catalogNote: 'Narx va holat snapshot sanasiga tegishli va rasmiy sotuvchida o‘zgarishi mumkin.',
    contactOverline: '09 · Shaxsiy maslahat', contactTitle: 'Sizniki bo‘ladigan makonni tanlang.', contactText: 'Kontaktlaringizni qoldiring — loyiha menejeri tanlangan xonadon holati, moslashuvchan to‘lov shartlari va tafsilotlarini tasdiqlaydi.', phone: 'Telefon', booklet: 'Rasmiy buklet', privacy: 'Maxfiylik', partner: 'NRG-BI va AL-BINA hamkorlik loyihasi',
  },
  en: {
    nav: { project: 'Project', architecture: 'Architecture', halls: 'Lobbies', courtyard: 'Courtyard', location: 'Location' },
    menu: 'Menu', close: 'Close', choose: 'Choose an apartment', consult: 'Request a consultation', actual: 'Actual photography', render: 'Possible interior · visualisation', previous: 'Previous photograph', next: 'Next photograph', language: 'Language', skip: 'Skip to content',
    heroOverline: 'Business+ club residence · completed', heroTitle: 'Flagman', heroAccent: 'Luxury minimalism', heroAddress: 'Mirzo Ulugbek district · Muhammad Yusuf Street', heroPhoto: 'Actual completed residence',
    manifestOverline: 'NRG-BI × AL-BINA', manifestTitle: 'A private gallery of luxury minimalism — in a completed residence.', manifestText: 'Flagman conveys status without display: calm proportions, natural materials, architectural rhythm and spaces where art becomes part of everyday life.',
    facts: [['Business+', 'Residential class'], ['16', 'floors'], ['3 m', 'ceiling height'], ['Ready', 'building status']],
    architectureOverline: '01 · Material and rhythm', architectureTitle: 'Limestone. Light. Verticals.', architectureText: 'The façade combines natural Limestone, decorative architectural screens and aluminium composite panels. Its disciplined form stays expressive without excess decoration.', architectureNote: 'Actual photographs of the completed façade',
    interiorOverline: '02 · A possible scenario', interiorTitle: 'Your apartment could look like this.', interiorText: 'The official imagery shows one possible interior scenario. It is not a promise or guarantee of the finish in a selected apartment.',
    hallsOverline: '03 · Private gallery', hallsTitle: 'Light-filled lobbies, art and quiet.', hallsText: 'A restrained light palette, commissioned art, plants and waiting areas form a calm sequence from entrance to apartment.', hallsNote: 'Actual lobby photographs',
    courtyardOverline: '04 · Private courtyard', courtyardTitle: 'Car-free — for families and gatherings.', courtyardText: 'The private secure courtyard brings together a children’s playground, BBQ area and quiet places to pause. CCTV supports the private setting.', courtyardFeatures: ['Car-free courtyard', 'Secure grounds', 'BBQ area', 'Children’s playground'],
    landscapeOverline: '05 · Landscape', landscapeTitle: '45%', landscapeAccent: 'of the territory is landscaped.', landscapeText: 'Deciduous and evergreen trees, ornamental shrubs, perennials and lawn create a mature, carefully maintained setting.',
    locationOverline: '06 · Tashkent', locationTitle: 'At the heart of Mirzo Ulugbek district.', locationText: '54 Muhammad Yusuf Street. District infrastructure, schools, shops, cafés and public transport are nearby.', map: 'Open map',
    galleryOverline: '07 · Completed', galleryTitle: 'Flagman today.', galleryText: 'Actual photography of the completed residence, façade, lobbies and landscaped grounds.',
    catalogOverline: '08 · Official catalogue', catalogTitle: '8 current listings in the saved snapshot.', catalogText: 'Exact areas, floors, prices and plans from the official catalogue on 30 August 2026.', catalogNote: 'Prices and status are recorded at snapshot date and may change with the official seller.',
    contactOverline: '09 · Personal consultation', contactTitle: 'Choose a space to make your own.', contactText: 'Leave your details and the project manager will confirm current status, flexible payment terms and the selected apartment details.', phone: 'Phone', booklet: 'Official brochure', privacy: 'Privacy', partner: 'A partnership project by NRG-BI and AL-BINA',
  },
} as const;

function asset(path: string) { return `${appBasePath}${path}`; }
function withLanguage(path: string, language: Language) { return `${appBasePath}${path}?lang=${language}`; }
function privacyUrl(language: Language) { return `${appBasePath}/privacy?project=flagman&lang=${language}`; }
function leadSubmitUrl() {
  return `${appBasePath}/v1/leads`;
}

function useLanguage(initialLanguage: Language = 'ru') {
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search).get('lang');
    const saved = window.localStorage.getItem('flagman-language');
    const next = languages.includes(query as Language) ? query : saved;
    const frame = window.requestAnimationFrame(() => {
      if (languages.includes(next as Language)) setLanguageState(next as Language);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const setLanguage = (next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem('flagman-language', next);
    const url = new URL(window.location.href);
    url.searchParams.set('lang', next);
    window.history.replaceState({}, '', url);
  };
  return [language, setLanguage] as const;
}

function useLoader() {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const seen = window.sessionStorage.getItem('flagman-loader-seen') === '1';
    if (reduced || seen) {
      const frame = window.requestAnimationFrame(() => setLoading(false));
      return () => window.cancelAnimationFrame(frame);
    }
    document.body.classList.add('is-flagman-loading');
    const timer = window.setTimeout(() => {
      setLoading(false);
      window.sessionStorage.setItem('flagman-loader-seen', '1');
      document.body.classList.remove('is-flagman-loading');
    }, 1450);
    return () => { window.clearTimeout(timer); document.body.classList.remove('is-flagman-loading'); };
  }, []);
  return loading;
}

function useReveal(language: Language) {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll<HTMLElement>('[data-flagman-reveal]').forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-flagman-reveal]'));
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }), { threshold: .12 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [language]);
}

function GalleryButton({ slide, onOpen, className = '' }: { slide: Slide; onOpen: () => void; className?: string }) {
  return <button className={`flagman-photo ${className}`} type="button" onClick={onOpen} aria-label={slide.alt}><img src={asset(slide.src)} alt={slide.alt} loading="lazy" decoding="async" /><span>{slide.label}</span><i aria-hidden="true">↗</i></button>;
}

function Lightbox({ state, onClose, previous, next, closeLabel }: { state: NonNullable<LightboxState>; onClose: () => void; previous: string; next: string; closeLabel: string }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef(0);
  const [index, setIndex] = useState(state.index);
  const current = state.slides[index];
  const move = (direction: number) => setIndex((value) => (value + direction + state.slides.length) % state.slides.length);
  useEffect(() => {
    closeRef.current?.focus();
    document.body.classList.add('is-flagman-overlay');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((value) => (value - 1 + state.slides.length) % state.slides.length);
      if (event.key === 'ArrowRight') setIndex((value) => (value + 1) % state.slides.length);
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('is-flagman-overlay'); window.removeEventListener('keydown', onKey); };
  }, [onClose, state.slides.length]);
  return <div className="flagman-lightbox" role="dialog" aria-modal="true" aria-label={current.alt} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} onTouchStart={(event) => { touchStart.current = event.changedTouches[0].clientX; }} onTouchEnd={(event) => { const delta = event.changedTouches[0].clientX - touchStart.current; if (Math.abs(delta) > 45) move(delta > 0 ? -1 : 1); }}>
    <button ref={closeRef} className="flagman-lightbox__close" type="button" aria-label={closeLabel} onClick={onClose}>×</button>
    <button className="flagman-lightbox__arrow is-prev" type="button" aria-label={previous} onClick={() => move(-1)}>←</button>
    <figure><img src={asset(current.src)} alt={current.alt} /><figcaption><strong>{current.label}</strong><span>{String(index + 1).padStart(2, '0')} / {String(state.slides.length).padStart(2, '0')}</span></figcaption></figure>
    <button className="flagman-lightbox__arrow is-next" type="button" aria-label={next} onClick={() => move(1)}>→</button>
  </div>;
}

export function FlagmanPage({ initialLanguage = 'ru' }: { initialLanguage?: Language }) {
  const [language, setLanguage] = useLanguage(initialLanguage);
  const loading = useLoader();
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const t = copy[language];
  useReveal(language);

  useEffect(() => {
    document.body.classList.toggle('is-flagman-menu', menuOpen);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.classList.remove('is-flagman-menu'); window.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const architecture: Slide[] = [
    { src: '/flagman/images/architecture-01.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/architecture-02.webp', alt: `${t.actual}: Flagman`, label: t.actual },
  ];
  const interiors: Slide[] = [
    { src: '/flagman/images/interior-example-109.webp', alt: t.render, label: t.render },
    { src: '/flagman/images/interior-example-78.webp', alt: t.render, label: t.render },
    { src: '/flagman/images/interior-example-110.webp', alt: t.render, label: t.render },
  ];
  const halls: Slide[] = [
    { src: '/flagman/images/lobby-01.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/lobby-02.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/lobby-03.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/lobby-04.webp', alt: `${t.actual}: Flagman`, label: t.actual },
  ];
  const courtyard: Slide[] = [
    { src: '/flagman/images/courtyard-aerial.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/courtyard-play.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/courtyard-ground.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/courtyard-bbq.webp', alt: `${t.actual}: Flagman`, label: t.actual },
  ];
  const landscape: Slide[] = [
    { src: '/flagman/images/landscape-01.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/landscape-02.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/landscape-03.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/landscape-04.webp', alt: `${t.actual}: Flagman`, label: t.actual },
  ];
  const actualGallery: Slide[] = [
    { src: '/flagman/images/hero.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/building-close.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    { src: '/flagman/images/building-aerial.webp', alt: `${t.actual}: Flagman`, label: t.actual },
    courtyard[0], halls[0], landscape[2],
  ];
  const openGallery = (slides: Slide[], index: number) => setLightbox({ slides, index });

  return <main className="flagman-site" lang={language}>
    <a className="flagman-skip" href="#flagman-content">{t.skip}</a>
    {loading ? <div className="flagman-loader" aria-label="Flagman"><div><span>FLAGMAN</span><small>TASHKENT</small></div><i /></div> : null}

    <header className="flagman-header">
      <a className="flagman-wordmark" href="#top" aria-label="Flagman">FLAGMAN<small>TASHKENT</small></a>
      <nav aria-label="Flagman">{Object.entries(t.nav).map(([key, label]) => <a key={key} href={`#${key}`}>{label}</a>)}</nav>
      <div className="flagman-header__actions">
        <div className="flagman-language" aria-label={t.language}>{languages.map((item) => <button type="button" key={item} onClick={() => setLanguage(item)} className={language === item ? 'is-active' : ''} aria-pressed={language === item}>{item.toUpperCase()}</button>)}</div>
        <a className="flagman-header__cta" href={withLanguage('/flagman/apartments', language)}>{t.choose}<span>↗</span></a>
        <button className="flagman-menu-button" type="button" aria-expanded={menuOpen} aria-controls="flagman-menu" onClick={() => setMenuOpen(true)}>{t.menu}</button>
      </div>
    </header>

    <div id="flagman-menu" className={`flagman-menu ${menuOpen ? 'is-open' : ''}`} aria-hidden={!menuOpen}>
      <button type="button" aria-label={t.close} onClick={() => setMenuOpen(false)}>×</button>
      <a className="flagman-wordmark" href="#top" onClick={() => setMenuOpen(false)}>FLAGMAN<small>TASHKENT</small></a>
      <nav>{Object.entries(t.nav).map(([key, label], index) => <a key={key} href={`#${key}`} onClick={() => setMenuOpen(false)}><span>0{index + 1}</span>{label}</a>)}</nav>
      <div className="flagman-menu__languages">{languages.map((item) => <button type="button" key={item} className={language === item ? 'is-active' : ''} onClick={() => { setLanguage(item); setMenuOpen(false); }}>{item.toUpperCase()}</button>)}</div>
      <a className="flagman-menu__cta" href={withLanguage('/flagman/apartments', language)}>{t.choose}<span>↗</span></a>
    </div>

    <section className="flagman-hero" id="top">
      <picture><source media="(max-width: 700px)" srcSet={asset('/flagman/images/hero-mobile.webp')} /><img src={asset('/flagman/images/hero.webp')} alt={t.heroPhoto} fetchPriority="high" /></picture>
      <div className="flagman-hero__shade" />
      <div className="flagman-hero__content">
        <p>{t.heroOverline}</p><h1>{t.heroTitle}</h1><h2>{t.heroAccent}</h2><address>{t.heroAddress}</address>
        <div><a href={withLanguage('/flagman/apartments', language)}>{t.choose}<span>↗</span></a><button type="button" onClick={() => setLeadOpen(true)}>{t.consult}</button></div>
      </div>
      <button className="flagman-hero__photo" type="button" onClick={() => openGallery(actualGallery, 0)}><span>01 / 06</span>{t.heroPhoto}<i>↗</i></button>
      <div className="flagman-hero__index"><span>TASHKENT</span><span>MIRZO-ULUGBEK</span></div>
    </section>

    <div id="flagman-content">
      <section className="flagman-manifest" id="project" data-flagman-reveal>
        <div className="flagman-section-label"><span>00</span><p>{t.manifestOverline}</p></div>
        <div><h2>{t.manifestTitle}</h2><p>{t.manifestText}</p></div>
      </section>

      <section className="flagman-facts" aria-label={t.manifestOverline}>{t.facts.map(([value, label], index) => <article key={label} data-flagman-reveal><span>0{index + 1}</span><strong>{value}</strong><p>{label}</p></article>)}</section>

      <section className="flagman-architecture" id="architecture">
        <header data-flagman-reveal><div className="flagman-section-label"><span>01</span><p>{t.architectureOverline}</p></div><h2>{t.architectureTitle}</h2><p>{t.architectureText}</p></header>
        <div className="flagman-architecture__gallery">{architecture.map((slide, index) => <GalleryButton key={slide.src} slide={slide} className={index === 0 ? 'is-main' : ''} onOpen={() => openGallery(architecture, index)} />)}</div>
        <p className="flagman-media-note">{t.architectureNote}</p>
      </section>

      <section className="flagman-interior">
        <div className="flagman-interior__head" data-flagman-reveal><div className="flagman-section-label"><span>02</span><p>{t.interiorOverline}</p></div><h2>{t.interiorTitle}</h2><p>{t.interiorText}</p></div>
        <div className="flagman-interior__rail" data-lenis-prevent>{interiors.map((slide, index) => <GalleryButton key={slide.src} slide={slide} onOpen={() => openGallery(interiors, index)} />)}</div>
      </section>

      <section className="flagman-halls" id="halls">
        <header data-flagman-reveal><div className="flagman-section-label"><span>03</span><p>{t.hallsOverline}</p></div><div><h2>{t.hallsTitle}</h2><p>{t.hallsText}</p></div></header>
        <div className="flagman-halls__grid">{halls.map((slide, index) => <GalleryButton key={slide.src} slide={slide} className={`is-${index + 1}`} onOpen={() => openGallery(halls, index)} />)}</div>
        <p className="flagman-media-note">{t.hallsNote}</p>
      </section>

      <section className="flagman-courtyard" id="courtyard">
        <div className="flagman-courtyard__copy" data-flagman-reveal><div className="flagman-section-label"><span>04</span><p>{t.courtyardOverline}</p></div><h2>{t.courtyardTitle}</h2><p>{t.courtyardText}</p><ul>{t.courtyardFeatures.map((feature, index) => <li key={feature}><span>0{index + 1}</span>{feature}</li>)}</ul></div>
        <div className="flagman-courtyard__gallery">{courtyard.slice(0, 2).map((slide, index) => <GalleryButton key={slide.src} slide={slide} onOpen={() => openGallery(courtyard, index)} />)}</div>
      </section>

      <section className="flagman-landscape">
        <div className="flagman-landscape__stat" data-flagman-reveal><div className="flagman-section-label"><span>05</span><p>{t.landscapeOverline}</p></div><strong>{t.landscapeTitle}</strong><h2>{t.landscapeAccent}</h2><p>{t.landscapeText}</p></div>
        <div className="flagman-landscape__rail">{landscape.map((slide, index) => <GalleryButton key={slide.src} slide={slide} onOpen={() => openGallery(landscape, index)} />)}</div>
      </section>

      <section className="flagman-location" id="location">
        <div className="flagman-location__copy" data-flagman-reveal><div className="flagman-section-label"><span>06</span><p>{t.locationOverline}</p></div><h2>{t.locationTitle}</h2><p>{t.locationText}</p><a href="https://yandex.uz/maps/?text=Flagman%20Tashkent%2C%20Muhammad%20Yusuf%2054" target="_blank" rel="noreferrer">{t.map}<span>↗</span></a></div>
        <div className="flagman-location__map"><iframe title={`${t.locationTitle} — ${t.map}`} loading="lazy" src="https://yandex.com/map-widget/v1/?mode=search&text=Flagman%20Tashkent%2C%20Muhammad%20Yusuf%2054&z=16" /><div><span>FLAGMAN</span><small>MUHAMMAD YUSUF, 54</small></div></div>
      </section>

      <section className="flagman-gallery">
        <header data-flagman-reveal><div className="flagman-section-label"><span>07</span><p>{t.galleryOverline}</p></div><div><h2>{t.galleryTitle}</h2><p>{t.galleryText}</p></div></header>
        <div className="flagman-gallery__grid">{actualGallery.map((slide, index) => <GalleryButton key={`${slide.src}-${index}`} slide={slide} className={`is-${index + 1}`} onOpen={() => openGallery(actualGallery, index)} />)}</div>
      </section>

      <section className="flagman-catalog-callout">
        <div className="flagman-section-label"><span>08</span><p>{t.catalogOverline}</p></div>
        <div data-flagman-reveal><h2>{t.catalogTitle}</h2><p>{t.catalogText}</p><a href={withLanguage('/flagman/apartments', language)}>{t.choose}<span>↗</span></a><small>{t.catalogNote}</small></div>
        <strong aria-hidden="true">08</strong>
      </section>

      <section className="flagman-contact" id="contact">
        <div className="flagman-contact__copy" data-flagman-reveal><div className="flagman-section-label"><span>09</span><p>{t.contactOverline}</p></div><h2>{t.contactTitle}</h2><p>{t.contactText}</p><button type="button" onClick={() => setLeadOpen(true)}>{t.consult}<span>↗</span></button></div>
        <div className="flagman-contact__photo"><img src={asset('/flagman/images/building-close.webp')} alt={t.heroPhoto} loading="lazy" /><span>{t.actual}</span></div>
        <div className="flagman-contact__meta"><div><small>{t.phone}</small><a href="tel:+998781137712">+998 78 113 77 12</a></div><div><small>{t.partner}</small><span>NRG-BI × AL-BINA</span></div></div>
      </section>
    </div>

    <footer className="flagman-footer"><a className="flagman-wordmark" href="#top">FLAGMAN<small>TASHKENT</small></a><nav><a href={privacyUrl(language)}>{t.privacy}</a></nav><p>{t.partner}</p></footer>

    {lightbox ? <Lightbox state={lightbox} onClose={() => setLightbox(null)} previous={t.previous} next={t.next} closeLabel={t.close} /> : null}
    <LeadModal open={leadOpen} language={language} context="flagman:landing:consultation" projectName="FLAGMAN" hideBrand tagline={t.heroAccent} facts={t.facts.slice(0, 3).map(([value, label]) => `${value} · ${label}`)} submitUrl={leadSubmitUrl()} projectSlug="flagman" privacyUrl={privacyUrl(language)} requireConsent onClose={() => setLeadOpen(false)} />
  </main>;
}
