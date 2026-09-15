"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LeadModal } from "@/app/lead-modal";
import { useLiveCatalogSnapshot } from "@/app/live-catalog";
import { sarbonLeadSubmitUrl } from "./sarbon-lead";
import { type SarbonLanguage, useSarbonDocumentLanguage } from "./sarbon-language";

type Unit = { id: string | number; sourceKey?: string; unitKey: string; sourceOrder: number; number: string; rooms: number; area: number; floor: number; section: string; phase: string; completion: string; status: string; priceVisibility: string; plan: string | null; planStatus: string };
type Snapshot = { units: Unit[] };
type Props = { initialLanguage: SarbonLanguage; initialTracking: Record<string, string>; basePath: string; media: Record<string, Record<string, string>>; snapshot: Snapshot };
const languages = ["ru", "uz", "en"] as const;
const galleryNames = ["architecture-01", "architecture-02", "architecture-03", "amenity-01", "amenity-02", "amenity-03", "amenity-04", "amenity-05"];

const copy = {
  ru: {
    skip: "Перейти к содержанию", status: "Идет бронирование", place: "Новый Ташкент", className: "Бизнес-класс", title: "Новый городской ориентир", lead: "Архитектура, культурное наследие и продуманный городской ритм — в квартале, где путь от города к дому становится естественным.", catalogue: "Выбрать квартиру", consultation: "Получить консультацию", nav: ["Проект", "Архитектура", "Двор", "Квартиры", "Локация"], menu: "Открыть меню", close: "Закрыть меню", cgi: "Визуализация проекта / CGI",
    route: "Проводник в Новый Ташкент", overviewEyebrow: "01 / Город → ориентир", overviewTitle: "Квартал, который задаёт новый ритм", overviewText: ["SARBON создан как современный ориентир Нового Ташкента. Архитектурная выразительность и культурное наследие здесь соединяются с ясным городским ритмом.", "Пространства отдыха, общения и спорта находятся рядом с домом, а общие гостиные, детские комнаты и библиотека встроены в первые этажи корпусов."],
    facts: [["21", "блок в проекте"], ["1 023", "квартиры"], ["5", "очередей"], ["39 600 м²", "площадь проекта"]], floors: "до 12 этажей", aerialTitle: "Масштаб квартала", aerialText: "Обзорная визуализация показывает композицию проекта. Это не технический генплан и не интерактивная схема блоков.",
    archEyebrow: "02 / Ориентир → квартал", archTitle: "Материал, свет, ритм", archIntro: "Фасады собраны из керамогранита разных оттенков и светлой клинкерной плитки. Гранатовые, охристые и бежевые акценты отмечают балконы и верхние террасы.", materialTitles: ["Керамогранит", "Клинкерная плитка", "Акцентные террасы"], materialText: ["Разные оттенки создают глубину и собранный ритм фасада.", "Светлые вставки выделяют архитектурные модули.", "Открытые балконы и террасы окрашены в цвета комплекса."], terracesTitle: "Открытые террасы верхних этажей", terracesText: "Архитектурный силуэт завершают открытые пространства, где строгая геометрия фасада встречается с небом Нового Ташкента.",
    courtyardEyebrow: "03 / Квартал → двор", courtyardTitle: "Повседневность рядом", courtyardLead: "Зелёные маршруты связывают безопасные детские площадки, workout-зоны, прогулочные аллеи и места для отдыха и общения.", amenities: [["Благоустройство", "Ухоженная территория, озеленение и удобные маршруты."], ["Детские пространства", "Безопасные игровые зоны для движения и развития."], ["Workout и спорт", "Тренировки на свежем воздухе рядом с домом."], ["Прогулочные аллеи", "Зелёные маршруты для семьи и спокойного отдыха."], ["Зоны общения", "Места, где можно встретиться, отдохнуть и побыть вместе."]], amenitiesLabel: "Пространства благоустройства", amenitiesPrevious: "Прокрутить благоустройство влево", amenitiesNext: "Прокрутить благоустройство вправо", terraceKicker: "Архитектурная линия",
    galleryEyebrow: "04 / Архитектурный журнал", galleryTitle: "SARBON в деталях", openImage: "Открыть изображение", previous: "Предыдущее изображение", next: "Следующее изображение", closeGallery: "Закрыть галерею", imageOf: "Изображение",
    apartmentsEyebrow: "05 / Дом → выбор", apartmentsTitle: "Квартиры первой очереди", apartmentsLead: (count: number) => `Сейчас доступно ${count} квартир. Состав предложений обновляется автоматически; срок 2028 относится только к этой первой очереди, а не ко всему проекту.`, apartment: "Квартира", rooms: "комн.", area: "Площадь", floor: "Этаж", section: "Секция", phase: "Очередь", completion: "Срок предложения", price: "По запросу", allApartments: (count: number) => `Смотреть все квартиры · ${count}`, noPlan: "План уточняется",
    locationEyebrow: "06 / Новый Ташкент", locationTitle: "Точка нового города", locationLead: "SARBON расположен в Новом Ташкенте — в формирующейся городской среде с собственной системой маршрутов, общественных пространств и повседневных связей.", coordinates: "Координаты", locationNote: "Точное время в пути зависит от маршрута и трафика.",
    finalEyebrow: "Ваш маршрут в SARBON", finalTitle: "Начните с квартиры, которая подходит именно вам", finalLead: "Оставьте контакты — менеджер TENCORP уточнит задачу, проверит актуальность предложения и подготовит персональную подборку.", call: "Позвонить", footerNav: "Навигация", legal: "Информация", privacy: "Обработка персональных данных", rights: "© 2026 TENCORP. Консультация по жилому проекту SARBON.", developer: "Проект девелопера Murad Buildings",
  },
  uz: {
    skip: "Asosiy mazmunga o‘tish", status: "Bron qilish jarayoni ketmoqda", place: "Yangi Toshkent", className: "Biznes-klass", title: "Yangi shahar mo‘ljali", lead: "Arxitektura ifodasi, madaniy meros va o‘ylangan shahar ritmi — shahardan uyga eltuvchi yo‘l tabiiy his qilinadigan mavzeda.", catalogue: "Xonadon tanlash", consultation: "Maslahat olish", nav: ["Loyiha", "Arxitektura", "Hovli", "Xonadonlar", "Joylashuv"], menu: "Menyuni ochish", close: "Menyuni yopish", cgi: "Loyiha vizualizatsiyasi / CGI",
    route: "Yangi Toshkent sari yo‘l", overviewEyebrow: "01 / Shahar → mo‘ljal", overviewTitle: "Yangi ritmni belgilaydigan mavze", overviewText: ["SARBON Yangi Toshkentning zamonaviy mo‘ljali sifatida yaratilgan. Arxitektura ifodasi va madaniy meros aniq shahar ritmi bilan uyg‘unlashadi.", "Dam olish, muloqot va sport joylari uyga yaqin. Umumiy mehmonxonalar, bolalar xonalari va kutubxona binolarning birinchi qavatlariga joylashtirilgan."],
    facts: [["21", "loyihadagi blok"], ["1 023", "xonadon"], ["5", "navbat"], ["39 600 m²", "loyiha maydoni"]], floors: "12 qavatgacha", aerialTitle: "Mavze ko‘lami", aerialText: "Umumiy vizualizatsiya loyihaning kompozitsiyasini ko‘rsatadi. Bu texnik bosh reja yoki interaktiv bloklar sxemasi emas.",
    archEyebrow: "02 / Mo‘ljal → mavze", archTitle: "Material, yorug‘lik, ritm", archIntro: "Fasadlar turli tusdagi keramik granit va och rangli klinker plitkadan tuzilgan. Anor rang, oxra va bej aksentlar balkonlar hamda yuqori terrasalarni ajratib turadi.", materialTitles: ["Keramik granit", "Klinker plitka", "Aksentli terrasalar"], materialText: ["Turli tuslar fasadga chuqurlik va tartibli ritm beradi.", "Och rangli qo‘shimchalar arxitektura modullarini ajratadi.", "Ochiq balkon va terrasalar loyiha ranglarida ishlangan."], terracesTitle: "Yuqori qavatlardagi ochiq terrasalar", terracesText: "Arxitektura siluetini ochiq makonlar yakunlaydi: qat’iy fasad geometriyasi Yangi Toshkent osmoni bilan uchrashadi.",
    courtyardEyebrow: "03 / Mavze → hovli", courtyardTitle: "Kundalik hayot — yoningizda", courtyardLead: "Yashil yo‘nalishlar xavfsiz bolalar maydonchalari, workout-zonalar, sayr xiyobonlari hamda dam olish va muloqot joylarini bog‘laydi.", amenities: [["Obodonlashtirish", "Ko‘kalamzorlashtirilgan, qulay yo‘nalishlarga ega hudud."], ["Bolalar makonlari", "Harakat va rivojlanish uchun xavfsiz o‘yin zonalari."], ["Workout va sport", "Uyga yaqin ochiq havodagi mashg‘ulotlar."], ["Sayr xiyobonlari", "Oila bilan sayr va sokin dam olish uchun yashil yo‘llar."], ["Muloqot zonalari", "Uchrashish, dam olish va birga vaqt o‘tkazish joylari."]], amenitiesLabel: "Obodonlashtirish makonlari", amenitiesPrevious: "Obodonlashtirish lentasini chapga surish", amenitiesNext: "Obodonlashtirish lentasini o‘ngga surish", terraceKicker: "Arxitektura chizig‘i",
    galleryEyebrow: "04 / Arxitektura jurnali", galleryTitle: "SARBON tafsilotlarda", openImage: "Tasvirni ochish", previous: "Oldingi tasvir", next: "Keyingi tasvir", closeGallery: "Galereyani yopish", imageOf: "Tasvir",
    apartmentsEyebrow: "05 / Uy → tanlov", apartmentsTitle: "Birinchi navbat xonadonlari", apartmentsLead: (count: number) => `Hozir ${count} ta xonadon mavjud. Takliflar avtomatik yangilanadi; 2028-yil muddati faqat ushbu birinchi navbatga tegishli, butun loyihaga emas.`, apartment: "Xonadon", rooms: "xona", area: "Maydon", floor: "Qavat", section: "Seksiya", phase: "Navbat", completion: "Taklif muddati", price: "So‘rov bo‘yicha", allApartments: (count: number) => `Barcha xonadonlarni ko‘rish · ${count}`, noPlan: "Reja aniqlashtirilmoqda",
    locationEyebrow: "06 / Yangi Toshkent", locationTitle: "Yangi shaharning nuqtasi", locationLead: "SARBON Yangi Toshkentda — o‘z yo‘nalishlari, jamoat makonlari va kundalik aloqalari shakllanayotgan shahar muhitida joylashgan.", coordinates: "Koordinatalar", locationNote: "Aniq yo‘l vaqti marshrut va tirbandlikka bog‘liq.",
    finalEyebrow: "SARBON sari yo‘lingiz", finalTitle: "Sizga mos xonadondan boshlang", finalLead: "Kontaktlaringizni qoldiring — TENCORP menejeri ehtiyojingizni aniqlaydi, taklif dolzarbligini tekshiradi va shaxsiy tanlov tayyorlaydi.", call: "Qo‘ng‘iroq qilish", footerNav: "Navigatsiya", legal: "Ma’lumot", privacy: "Shaxsiy ma’lumotlarni qayta ishlash", rights: "© 2026 TENCORP. SARBON turar joy loyihasi bo‘yicha maslahat.", developer: "Murad Buildings loyihasi",
  },
  en: {
    skip: "Skip to content", status: "Booking in progress", place: "New Tashkent", className: "Business class", title: "A new urban landmark", lead: "Architectural expression, cultural heritage and a considered urban rhythm—within a quarter where the route from city to home feels natural.", catalogue: "Choose an apartment", consultation: "Request a consultation", nav: ["Project", "Architecture", "Courtyard", "Apartments", "Location"], menu: "Open menu", close: "Close menu", cgi: "Project visualisation / CGI",
    route: "A guide to New Tashkent", overviewEyebrow: "01 / City → landmark", overviewTitle: "A quarter setting a new rhythm", overviewText: ["SARBON is conceived as a contemporary landmark for New Tashkent. Architectural expression and cultural heritage meet a clear, considered urban rhythm.", "Spaces for rest, conversation and sport are close to home, while shared lounges, children’s rooms and a library are integrated into the ground floors."],
    facts: [["21", "blocks in the project"], ["1,023", "apartments"], ["5", "phases"], ["39,600 m²", "project area"]], floors: "up to 12 floors", aerialTitle: "The scale of the quarter", aerialText: "This aerial visualisation shows the project composition. It is not a technical masterplan or an interactive block scheme.",
    archEyebrow: "02 / Landmark → quarter", archTitle: "Material, light, rhythm", archIntro: "The façades combine porcelain stoneware in varied tones with light clinker tile. Pomegranate, ochre and beige accents define balconies and upper-floor terraces.", materialTitles: ["Porcelain stoneware", "Clinker tile", "Accent terraces"], materialText: ["Varied tones give the façade depth and a measured rhythm.", "Light inserts articulate the architectural modules.", "Open balconies and terraces carry the project’s signature colours."], terracesTitle: "Open terraces on the upper floors", terracesText: "Open spaces complete the architectural silhouette, where precise façade geometry meets the sky of New Tashkent.",
    courtyardEyebrow: "03 / Quarter → courtyard", courtyardTitle: "Everyday life, close at hand", courtyardLead: "Green routes connect safe playgrounds, workout areas, walking alleys and places for rest and conversation.", amenities: [["Landscaping", "A maintained green setting with convenient routes."], ["Children’s spaces", "Safe play areas for movement and development."], ["Workout and sport", "Outdoor exercise close to home."], ["Walking alleys", "Green routes for family walks and quiet moments."], ["Social spaces", "Places to meet, pause and spend time together."]], amenitiesLabel: "Landscaped amenity spaces", amenitiesPrevious: "Scroll amenity spaces left", amenitiesNext: "Scroll amenity spaces right", terraceKicker: "Architectural line",
    galleryEyebrow: "04 / Architectural journal", galleryTitle: "SARBON in detail", openImage: "Open image", previous: "Previous image", next: "Next image", closeGallery: "Close gallery", imageOf: "Image",
    apartmentsEyebrow: "05 / Home → choice", apartmentsTitle: "Phase-one apartments", apartmentsLead: (count: number) => `${count} apartments are currently available. Listings update automatically; the 2028 completion applies only to this first phase, not to the entire project.`, apartment: "Apartment", rooms: "rooms", area: "Area", floor: "Floor", section: "Section", phase: "Phase", completion: "Offer completion", price: "On request", allApartments: (count: number) => `View all apartments · ${count}`, noPlan: "Plan to be confirmed",
    locationEyebrow: "06 / New Tashkent", locationTitle: "A point in the new city", locationLead: "SARBON is located in New Tashkent, within an emerging urban environment shaped by its own routes, public spaces and everyday connections.", coordinates: "Coordinates", locationNote: "Exact travel time depends on route and traffic.",
    finalEyebrow: "Your route to SARBON", finalTitle: "Begin with the apartment that fits you", finalLead: "Leave your details and a TENCORP manager will clarify your needs, re-check availability and prepare a personal selection.", call: "Call us", footerNav: "Navigation", legal: "Information", privacy: "Personal data processing", rights: "© 2026 TENCORP. Consultation for the SARBON residential project.", developer: "A Murad Buildings development",
  },
} as const;

function Media({ media, name, className = "", eager = false, alt }: { media: Props["media"]; name: string; className?: string; eager?: boolean; alt: string }) {
  const item = media[name] ?? {};
  return <picture className={className}><source srcSet={item["main-avif"] ?? item["wide-avif"]} type="image/avif" /><img src={item["main-webp"] ?? item["wide-webp"]} alt={alt} loading={eager ? "eager" : "lazy"} /></picture>;
}

export function SarbonPage({ initialLanguage, initialTracking, basePath, media, snapshot: embeddedSnapshot }: Props) {
  const { data: snapshot } = useLiveCatalogSnapshot("sarbon", embeddedSnapshot);
  const preview = snapshot.units.slice(0, 4);
  const [language, setLanguage] = useState(initialLanguage);
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadContext, setLeadContext] = useState("sarbon:landing:hero");
  const [leadReturnFocusTo, setLeadReturnFocusTo] = useState<HTMLElement | null>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const galleryTriggerRef = useRef<HTMLElement | null>(null);
  const amenitiesRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<number | null>(null);
  useSarbonDocumentLanguage(language);
  const t = copy[language];
  const query = useMemo(() => { const params = new URLSearchParams(initialTracking); params.set("lang", language); return params; }, [initialTracking, language]);
  const href = useCallback((pathname: string, extra?: Record<string, string>) => { const params = new URLSearchParams(query); for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value); return `${basePath}${pathname}?${params}`; }, [basePath, query]);
  const openLead = (context: string, target?: HTMLElement | null) => { setLeadReturnFocusTo(target ?? document.activeElement as HTMLElement | null); setLeadContext(context); setLeadOpen(true); };

  useEffect(() => {
    const url = new URL(window.location.href); url.searchParams.set("lang", language);
    for (const [key, value] of Object.entries(initialTracking)) url.searchParams.set(key, value);
    window.history.replaceState({}, "", url);
  }, [initialTracking, language]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.documentElement.classList.add("sarbon-motion-ready");
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: .12 });
    document.querySelectorAll(".sarbon [data-reveal]").forEach((node) => observer.observe(node));
    let cancelled = false;
    let lenis: { raf: (time: number) => void; destroy: () => void } | undefined;
    let frame = 0;
    import("lenis").then(({ default: Lenis }) => { if (cancelled) return; lenis = new Lenis({ duration: 1.05, smoothWheel: true }); const raf = (time: number) => { if (cancelled) return; lenis?.raf(time); frame = requestAnimationFrame(raf); }; frame = requestAnimationFrame(raf); });
    return () => { cancelled = true; observer.disconnect(); cancelAnimationFrame(frame); lenis?.destroy(); document.documentElement.classList.remove("sarbon-motion-ready"); };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", close);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", close); };
  }, [menuOpen]);

  const moveGallery = useCallback((direction: number) => setGalleryIndex((value) => value === null ? value : (value + direction + galleryNames.length) % galleryNames.length), []);
  const closeGallery = useCallback(() => { setGalleryIndex(null); requestAnimationFrame(() => galleryTriggerRef.current?.focus()); }, []);
  useEffect(() => {
    if (galleryIndex === null) return;
    const previous = document.body.style.overflow; document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGallery();
      if (event.key === "ArrowLeft") moveGallery(-1);
      if (event.key === "ArrowRight") moveGallery(1);
      if (event.key === "Tab" && lightboxRef.current) {
        const focusable = [...lightboxRef.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"])')]; const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", onKey); requestAnimationFrame(() => lightboxRef.current?.querySelector<HTMLElement>(".sarbon-lightbox__close")?.focus());
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [closeGallery, galleryIndex, moveGallery]);

  const navTargets = ["overview", "architecture", "courtyard", "apartments", "location"];
  const navClick = (id: string) => (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); setMenuOpen(false); const node = document.getElementById(id); node?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); window.setTimeout(() => { node?.setAttribute("tabindex", "-1"); node?.focus({ preventScroll: true }); }, 450); };
  const scrollAmenities = (direction: number) => amenitiesRef.current?.scrollBy({ left: direction * Math.min(440, amenitiesRef.current.clientWidth * .8), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });

  return <div className="sarbon" lang={language}>
    <a className="sarbon-skip" href="#sarbon-main">{t.skip}</a>
    <header className="sarbon-header">
      <a className="sarbon-wordmark" href="#top" onClick={navClick("top")} aria-label="SARBON"><img src={media.logo?.["main-webp"]} alt="SARBON" /></a>
      <nav aria-label="Primary navigation">{t.nav.map((item, index) => <a key={item} href={`#${navTargets[index]}`} onClick={navClick(navTargets[index])}>{item}</a>)}</nav>
      <div className="sarbon-header__tools"><div className="sarbon-languages" aria-label="Language">{languages.map((value) => <button key={value} type="button" className={language === value ? "is-active" : ""} aria-pressed={language === value} onClick={() => setLanguage(value)}>{value.toUpperCase()}</button>)}</div><button className="sarbon-menu" type="button" aria-expanded={menuOpen} aria-controls="sarbon-mobile-menu" aria-label={menuOpen ? t.close : t.menu} onClick={() => setMenuOpen((value) => !value)}><span /><span /></button></div>
      <div id="sarbon-mobile-menu" className={`sarbon-mobile-menu${menuOpen ? " is-open" : ""}`} inert={!menuOpen ? true : undefined}>{t.nav.map((item, index) => <a key={item} href={`#${navTargets[index]}`} onClick={navClick(navTargets[index])}>{item}</a>)}<a href={href("/sarbon/apartments")}>{t.catalogue}</a><a href="tel:+998781137712">+998 78 113 77 12</a></div>
    </header>
    <main id="sarbon-main">
      <section className="sarbon-hero" id="top" tabIndex={-1}>
        <picture><source media="(max-width: 700px)" srcSet={media.hero?.["mobile-avif"]} type="image/avif" /><source media="(max-width: 700px)" srcSet={media.hero?.["mobile-webp"]} type="image/webp" /><source srcSet={media.hero?.["wide-avif"]} type="image/avif" /><img src={media.hero?.["wide-webp"]} alt={t.cgi} fetchPriority="high" /></picture>
        <div className="sarbon-hero__veil" /><div className="sarbon-route" aria-hidden="true"><span>41.283289</span><i /><span>69.498216</span></div>
        <div className="sarbon-hero__content"><div className="sarbon-hero__meta"><span>{t.status}</span><span>{t.place}</span><span>{t.className}</span></div><h1><span>SARBON</span>{t.title}</h1><p>{t.lead}</p><div className="sarbon-hero__actions"><a className="sarbon-button sarbon-button--light" href={href("/sarbon/apartments")}>{t.catalogue}<span>↗</span></a><button className="sarbon-button sarbon-button--outline" data-lead-trigger type="button" onClick={(event) => openLead("sarbon:landing:hero", event.currentTarget)}>{t.consultation}</button></div></div>
        <small className="sarbon-hero__caption">{t.cgi}</small><div className="sarbon-hero__chapter"><span>00</span><i /><strong>{t.route}</strong></div>
      </section>

      <section id="overview" className="sarbon-overview sarbon-section" tabIndex={-1}><div className="sarbon-section__head" data-reveal><small>{t.overviewEyebrow}</small><h2>{t.overviewTitle}</h2></div><div className="sarbon-overview__copy" data-reveal>{t.overviewText.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><div className="sarbon-facts" data-reveal>{t.facts.map(([value, label]) => <article key={label}><strong>{value}</strong><span>{label}</span></article>)}<article className="sarbon-facts__note"><span>↑</span><strong>{t.floors}</strong></article></div></section>

      <section className="sarbon-aerial"><Media media={media} name="aerial" className="sarbon-aerial__image" alt={t.cgi} /><div className="sarbon-aerial__veil" /><div className="sarbon-aerial__content" data-reveal><small>{t.cgi}</small><h2>{t.aerialTitle}</h2><p>{t.aerialText}</p><div className="sarbon-aerial__legend"><span>21</span><i /><span>1 023</span><i /><span>5</span></div></div></section>

      <section id="architecture" className="sarbon-architecture sarbon-section" tabIndex={-1}><div className="sarbon-section__head sarbon-section__head--wide" data-reveal><small>{t.archEyebrow}</small><h2>{t.archTitle}</h2><p>{t.archIntro}</p></div><div className="sarbon-architecture__grid"><Media media={media} name="architecture-01" className="sarbon-architecture__lead" alt={t.cgi} /><div className="sarbon-materials" data-reveal>{t.materialTitles.map((title, index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{t.materialText[index]}</p></article>)}</div><Media media={media} name="architecture-02" className="sarbon-architecture__detail" alt={t.cgi} /></div><div className="sarbon-terraces" data-reveal><div><small>{t.terraceKicker}</small><h3>{t.terracesTitle}</h3><p>{t.terracesText}</p></div><Media media={media} name="architecture-03" alt={t.cgi} /></div></section>

      <section id="courtyard" className="sarbon-courtyard" tabIndex={-1}><div className="sarbon-courtyard__intro" data-reveal><small>{t.courtyardEyebrow}</small><h2>{t.courtyardTitle}</h2><p>{t.courtyardLead}</p></div><div className="sarbon-amenities-shell"><div className="sarbon-amenities__controls"><button type="button" onClick={() => scrollAmenities(-1)} aria-label={t.amenitiesPrevious}>←</button><button type="button" onClick={() => scrollAmenities(1)} aria-label={t.amenitiesNext}>→</button></div><div ref={amenitiesRef} className="sarbon-amenities" role="region" tabIndex={0} aria-label={t.amenitiesLabel} onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); scrollAmenities(-1); } if (event.key === "ArrowRight") { event.preventDefault(); scrollAmenities(1); } }}>{t.amenities.map(([title, description], index) => <article key={title} data-reveal><Media media={media} name={`amenity-0${index + 1}`} alt={t.cgi} /><div><span>0{index + 1}</span><h3>{title}</h3><p>{description}</p><small>{t.cgi}</small></div></article>)}</div></div></section>

      <section className="sarbon-gallery sarbon-section" aria-labelledby="sarbon-gallery-title"><div className="sarbon-section__head" data-reveal><small>{t.galleryEyebrow}</small><h2 id="sarbon-gallery-title">{t.galleryTitle}</h2></div><div className="sarbon-gallery__grid">{galleryNames.map((name, index) => <button key={name} type="button" className={`sarbon-gallery__item sarbon-gallery__item--${index + 1}`} onClick={(event) => { galleryTriggerRef.current = event.currentTarget; setGalleryIndex(index); }} aria-label={`${t.openImage} ${index + 1}`}><Media media={media} name={name} alt={`${t.cgi} ${index + 1}`} /><span>{String(index + 1).padStart(2, "0")}</span></button>)}</div></section>

      <section id="apartments" className="sarbon-apartments-preview sarbon-section" tabIndex={-1}><div className="sarbon-section__head sarbon-section__head--wide" data-reveal><small>{t.apartmentsEyebrow}</small><h2>{t.apartmentsTitle}</h2><p>{t.apartmentsLead(snapshot.units.length)}</p></div><div className="sarbon-apartment-cards">{preview.map((unit) => <article key={unit.unitKey} data-reveal><div className="sarbon-apartment-cards__plan">{unit.plan ? <img src={unit.plan} alt={`${t.apartment} №${unit.number}`} loading="lazy" /> : <span>{t.noPlan}</span>}</div><div className="sarbon-apartment-cards__body"><small>{t.apartment} №{unit.number} · ID {unit.id}</small><h3>{unit.rooms} {t.rooms} · {unit.area} m²</h3><dl><div><dt>{t.floor}</dt><dd>{unit.floor}</dd></div><div><dt>{t.section}</dt><dd>{unit.section}</dd></div><div><dt>{t.phase}</dt><dd>{unit.phase}</dd></div><div><dt>{t.completion}</dt><dd>{unit.completion}</dd></div></dl><strong>{t.price}</strong><a href={href("/sarbon/apartments", { unit: String(unit.id) })}>{t.catalogue}<span>↗</span></a></div></article>)}</div><a className="sarbon-button sarbon-button--wine" href={href("/sarbon/apartments")}>{t.allApartments(snapshot.units.length)}<span>↗</span></a></section>

      <section id="location" className="sarbon-location" tabIndex={-1}><div className="sarbon-location__map" aria-hidden="true"><div className="sarbon-location__axis sarbon-location__axis--x" /><div className="sarbon-location__axis sarbon-location__axis--y" /><span className="sarbon-location__point">SARBON<i /></span><span className="sarbon-location__coord">41.283289 / 69.498216</span><span className="sarbon-location__city">NEW<br />TASHKENT</span></div><div className="sarbon-location__copy" data-reveal><small>{t.locationEyebrow}</small><h2>{t.locationTitle}</h2><p>{t.locationLead}</p><dl><div><dt>{t.coordinates}</dt><dd>41.283289, 69.498216</dd></div><div><dt>{t.place}</dt><dd>{t.className}</dd></div></dl><small>{t.locationNote}</small></div></section>

      <section className="sarbon-final"><Media media={media} name="amenity-05" className="sarbon-final__image" alt={t.cgi} /><div className="sarbon-final__veil" /><div className="sarbon-final__content" data-reveal><small>{t.finalEyebrow}</small><h2>{t.finalTitle}</h2><p>{t.finalLead}</p><div><button type="button" className="sarbon-button sarbon-button--light" data-lead-trigger onClick={(event) => openLead("sarbon:landing:final", event.currentTarget)}>{t.consultation}<span>↗</span></button><a className="sarbon-button sarbon-button--outline" href="tel:+998781137712">{t.call} · +998 78 113 77 12</a></div></div><small className="sarbon-final__caption">{t.cgi}</small></section>
    </main>

    <footer className="sarbon-footer"><div className="sarbon-footer__brand"><strong>SARBON</strong><span>{t.developer}</span></div><div><small>{t.footerNav}</small>{t.nav.map((item, index) => <a key={item} href={`#${navTargets[index]}`} onClick={navClick(navTargets[index])}>{item}</a>)}</div><div><small>{t.legal}</small><a href={href("/privacy", { project: "sarbon", from: "landing" })}>{t.privacy}</a><a href="tel:+998781137712">+998 78 113 77 12</a></div><p>{t.rights}</p></footer>

    {galleryIndex !== null ? <div ref={lightboxRef} className="sarbon-lightbox" role="dialog" aria-modal="true" aria-label={t.galleryTitle} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }} onTouchEnd={(event) => { if (touchStart.current === null) return; const distance = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current; if (Math.abs(distance) > 50) moveGallery(distance > 0 ? -1 : 1); touchStart.current = null; }}><button className="sarbon-lightbox__backdrop" type="button" tabIndex={-1} onClick={closeGallery} aria-label={t.closeGallery} /><button className="sarbon-lightbox__close" type="button" onClick={closeGallery} aria-label={t.closeGallery}>×</button><button className="sarbon-lightbox__arrow sarbon-lightbox__arrow--left" type="button" onClick={() => moveGallery(-1)} aria-label={t.previous}>←</button><Media media={media} name={galleryNames[galleryIndex]} alt={`${t.cgi} ${galleryIndex + 1}`} /><button className="sarbon-lightbox__arrow sarbon-lightbox__arrow--right" type="button" onClick={() => moveGallery(1)} aria-label={t.next}>→</button><p aria-live="polite">{t.imageOf} {galleryIndex + 1} / {galleryNames.length} · {t.cgi}</p></div> : null}
    <LeadModal open={leadOpen} language={language} context={`${leadContext}:${language}`} brandName="TENCORP" projectName="SARBON" tagline={t.title} facts={[t.className, t.place, t.status]} submitUrl={sarbonLeadSubmitUrl()} projectSlug="sarbon" privacyUrl={href("/privacy", { project: "sarbon", from: "landing" })} requireConsent returnFocusTo={leadReturnFocusTo} onClose={() => setLeadOpen(false)} />
  </div>;
}
