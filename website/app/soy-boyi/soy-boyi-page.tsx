"use client";

import Image from "next/image";
import Lenis from "lenis";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import mediaManifest from "@/data/soy-boyi-media-manifest.json";
import { LeadModal } from "@/app/lead-modal";
import { soyBoyiLeadSubmitUrl } from "./soy-boyi-lead";
import { type SoyLanguage, useSoyDocumentLanguage } from "./soy-boyi-language";

type Unit = {
  id: string;
  unitKey: string;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  section: string;
  phase: string;
  completion: string | null;
  status: string;
  plan: string | null;
  planStatus: string;
};
type LeadState = { surface: string; unit?: Unit; opener: HTMLElement | null };
type GalleryItem = { src: string; kind: "cgi" | "photo"; title: string };

const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const asset = (path: string) => `${basePath}${path}`;
const media = Object.fromEntries(
  mediaManifest.assets.map((item) => [item.name, item.localPath]),
) as Record<string, string>;
const languageOf = (
  value: string | null,
  fallback: SoyLanguage,
): SoyLanguage =>
  value === "uz" || value === "en" || value === "ru" ? value : fallback;
const locale = (language: SoyLanguage) =>
  language === "ru" ? "ru-RU" : language === "uz" ? "uz-UZ" : "en-US";

const copy = {
  ru: {
    skip: "Перейти к содержанию",
    language: "Язык",
    footerNav: "Навигация в подвале",
    menu: "Меню",
    close: "Закрыть",
    nav: ["Проект", "Архитектура", "Среда", "Ход проекта", "Квартиры"],
    navIds: ["story", "architecture", "amenities", "progress", "apartments"],
    status: "Бизнес-класс · идут продажи",
    heroTitle: ["Жизнь течёт", "у самой реки."],
    heroLead:
      "Soy Bo‘yi соединяет городскую жизнь с собственной набережной, большим двором-парком и спокойным ритмом современной махалли.",
    cgi: "Проектная визуализация · CGI",
    film: "Официальный проектный видеоматериал",
    playVideo: "Воспроизвести видео",
    pauseVideo: "Приостановить видео",
    choose: "Выбрать квартиру",
    consult: "Получить консультацию",
    facts: [
      ["14", "блоков"],
      ["1 249", "квартир"],
      ["4", "очереди"],
      ["43 321 м²", "площадь проекта"],
      ["13–16", "этажей"],
    ],
    riverEyebrow: "Течение жизни",
    riverTitle: "Город отступает. Река остаётся.",
    riverText:
      "Собственная набережная, озеленение, фонтан и маршруты для прогулок и пробежек формируют повседневный ландшафт комплекса. Большой двор-парк объединяет сады и функциональные зоны.",
    architectureEyebrow: "Архитектура",
    architectureTitle: "Материалы, которые держат ритм.",
    architectureText:
      "Корпуса высотой от 13 до 16 этажей объединяет армированный железобетонный каркас. Фасады сочетают керамогранит, алюминиевые композитные панели и панорамное витражное остекление.",
    openImage: "Открыть изображение",
    previous: "Предыдущее изображение",
    next: "Следующее изображение",
    closeGallery: "Закрыть галерею",
    architectureNames: [
      "Панорама квартала у реки",
      "Пластика фасадов",
      "Керамогранит и остекление",
    ],
    genplanEyebrow: "Официальный генплан",
    genplanTitle: "Ориентир, а не полный каталог.",
    genplanText:
      "Опубликованный генплан показывает часть секций. Полный выбор квартир ниже строится по актуальному официальному API и не ограничивается этим изображением.",
    amenitiesEyebrow: "Современная махалля",
    amenitiesTitle: "Места, где соседи становятся знакомыми.",
    amenitiesText:
      "Детские и спортивные площадки, летний кинотеатр, чайхана, детский летний бассейн, пекарня, гостевая и игровая комнаты собраны вокруг зелёного двора.",
    amenitiesNames: [
      "Большой двор-парк",
      "Детские площадки",
      "Спортивные площадки",
      "Летний кинотеатр",
      "Чайхана",
      "Детский летний бассейн",
      "Пекарня",
      "Гостевая комната",
      "Детская игровая комната",
    ],
    lobbyEyebrow: "Дом начинается раньше квартиры",
    lobbyTitle: "Лобби как вторая гостиная.",
    lobbyText:
      "Лаунж-зона, виды на зелёный двор, два лифта и повседневные сервисы, включая химчистку, продолжают спокойный ритм комплекса внутри дома.",
    progressEyebrow: "Реализация · реальные фото",
    progressTitle: "Первая очередь открыта.",
    progressText:
      "8 февраля 2026 года состоялось открытие первой очереди; первые жители уже получают ключи. Фотографии ниже сделаны на официальном мероприятии — это не CGI.",
    actual: "Реальная фотография · 08.02.2026",
    insurance:
      "Страховая защита жилья предусмотрена на 10 лет после завершения строительных работ.",
    locationEyebrow: "Учтепинский район",
    locationTitle: "Проспект Юсуфа Саккаки, 3А.",
    locationText: "Ташкент · 41.299120, 69.176107",
    call: "Позвонить",
    apartmentsEyebrow: "Актуальный выбор",
    apartmentsTitle: "Квартиры без догадок.",
    apartmentsText: (count: number) =>
      `${count} жилых квартир доступны в свежем официальном снимке. Цены источник не публикует — условия уточняются по запросу.`,
    room: (n: number) => (n === 0 ? "Комнаты не указаны" : `${n}-комнатная`),
    floor: "этаж",
    section: "секция",
    phase: "очередь",
    request: "По запросу",
    details: "Уточнить эту квартиру",
    fullCatalog: "Открыть полный каталог",
    formEyebrow: "Личный подбор",
    formTitle: "Найдём ваш ритм у реки.",
    formText:
      "Оставьте номер — менеджер TENCORP уточнит пожелания и проверит доступность выбранных вариантов.",
    formButton: "Оставить заявку",
    formFacts: [
      "Бизнес-класс",
      "Собственная набережная",
      "Страхование на 10 лет",
    ],
    privacy: "Обработка данных",
    disclaimer:
      "Информация и визуализации носят справочный характер. Актуальные условия уточняйте у менеджера.",
    top: "Наверх",
  },
  uz: {
    skip: "Asosiy mazmunga o‘tish",
    language: "Til",
    footerNav: "Pastki navigatsiya",
    menu: "Menyu",
    close: "Yopish",
    nav: ["Loyiha", "Arxitektura", "Muhit", "Loyiha jarayoni", "Xonadonlar"],
    navIds: ["story", "architecture", "amenities", "progress", "apartments"],
    status: "Biznes-klass · sotuvda",
    heroTitle: ["Hayot oqimi", "daryo bo‘yida."],
    heroLead:
      "Soy Bo‘yi shahar hayotini xususiy sohilbo‘yi, katta hovli-bog‘ va zamonaviy mahallaning osoyishta sur’ati bilan birlashtiradi.",
    cgi: "Loyiha vizualizatsiyasi · CGI",
    film: "Rasmiy loyiha videomateriali",
    playVideo: "Videoni ijro etish",
    pauseVideo: "Videoni pauza qilish",
    choose: "Xonadon tanlash",
    consult: "Maslahat olish",
    facts: [
      ["14", "blok"],
      ["1 249", "xonadon"],
      ["4", "navbat"],
      ["43 321 m²", "loyiha maydoni"],
      ["13–16", "qavat"],
    ],
    riverEyebrow: "Hayot oqimi",
    riverTitle: "Shahar ortda qoladi. Daryo qoladi.",
    riverText:
      "Xususiy sohilbo‘yi, ko‘kalamzor, favvora, sayr va yugurish yo‘laklari majmuaning kundalik manzarasini yaratadi. Katta hovli-bog‘ bog‘lar va funksional hududlarni birlashtiradi.",
    architectureEyebrow: "Arxitektura",
    architectureTitle: "Ritmni belgilovchi materiallar.",
    architectureText:
      "13–16 qavatli korpuslarni mustahkamlangan temir-beton karkas birlashtiradi. Fasadlarda keramogranit, alyuminiy kompozit panellar va panoramali vitraj oynalar uyg‘unlashadi.",
    openImage: "Tasvirni ochish",
    previous: "Oldingi tasvir",
    next: "Keyingi tasvir",
    closeGallery: "Galereyani yopish",
    architectureNames: [
      "Daryo bo‘yidagi kvartal panoramasi",
      "Fasadlar plastikasi",
      "Keramogranit va oynalar",
    ],
    genplanEyebrow: "Rasmiy bosh reja",
    genplanTitle: "Yo‘nalish, ammo to‘liq katalog emas.",
    genplanText:
      "E’lon qilingan bosh reja seksiyalarning bir qismini ko‘rsatadi. Quyidagi to‘liq tanlov joriy rasmiy API asosida tuzilgan va bu tasvir bilan cheklanmaydi.",
    amenitiesEyebrow: "Zamonaviy mahalla",
    amenitiesTitle: "Qo‘shnilar tanishadigan joylar.",
    amenitiesText:
      "Bolalar va sport maydonchalari, yozgi kinoteatr, choyxona, bolalar yozgi basseyni, novvoyxona, mehmon va o‘yin xonalari yashil hovli atrofida jamlangan.",
    amenitiesNames: [
      "Katta hovli-bog‘",
      "Bolalar maydonchalari",
      "Sport maydonchalari",
      "Yozgi kinoteatr",
      "Choyxona",
      "Bolalar yozgi basseyni",
      "Novvoyxona",
      "Mehmon xonasi",
      "Bolalar o‘yin xonasi",
    ],
    lobbyEyebrow: "Uy xonadondan oldin boshlanadi",
    lobbyTitle: "Lobbi — ikkinchi mehmonxona.",
    lobbyText:
      "Lounge hududi, yashil hovli manzarasi, ikkita lift va kimyoviy tozalash kabi kundalik xizmatlar majmuaning osoyishta ritmini uy ichida davom ettiradi.",
    progressEyebrow: "Amalga oshirish · haqiqiy foto",
    progressTitle: "Birinchi navbat ochildi.",
    progressText:
      "2026-yil 8-fevralda birinchi navbat ochildi; dastlabki aholi kalitlarni olib bormoqda. Quyidagi suratlar rasmiy tadbirda olingan — ular CGI emas.",
    actual: "Haqiqiy foto · 08.02.2026",
    insurance:
      "Qurilish tugagach, uy-joy uchun 10 yillik sug‘urta himoyasi ko‘zda tutilgan.",
    locationEyebrow: "Uchtepa tumani",
    locationTitle: "Yusuf Sakkaki shoh ko‘chasi, 3A.",
    locationText: "Toshkent · 41.299120, 69.176107",
    call: "Qo‘ng‘iroq qilish",
    apartmentsEyebrow: "Dolzarb tanlov",
    apartmentsTitle: "Taxminsiz xonadonlar.",
    apartmentsText: (count: number) =>
      `Yangi rasmiy snapshotda ${count} ta turar joy mavjud. Manba narxlarni e’lon qilmaydi — shartlar so‘rov bo‘yicha aniqlanadi.`,
    room: (n: number) => (n === 0 ? "Xonalar ko‘rsatilmagan" : `${n} xonali`),
    floor: "qavat",
    section: "seksiya",
    phase: "navbat",
    request: "So‘rov bo‘yicha",
    details: "Shu xonadonni aniqlash",
    fullCatalog: "To‘liq katalogni ochish",
    formEyebrow: "Shaxsiy tanlov",
    formTitle: "Daryo bo‘yidagi ritmingizni topamiz.",
    formText:
      "Raqamingizni qoldiring — TENCORP menejeri istaklaringizni aniqlab, variantlarning mavjudligini tekshiradi.",
    formButton: "Ariza qoldirish",
    formFacts: ["Biznes-klass", "Xususiy sohilbo‘yi", "10 yillik sug‘urta"],
    privacy: "Ma’lumotlarni qayta ishlash",
    disclaimer:
      "Ma’lumot va vizualizatsiyalar axborot uchun. Dolzarb shartlarni menejerdan aniqlang.",
    top: "Yuqoriga",
  },
  en: {
    skip: "Skip to content",
    language: "Language",
    footerNav: "Footer navigation",
    menu: "Menu",
    close: "Close",
    nav: ["Project", "Architecture", "Setting", "Progress", "Apartments"],
    navIds: ["story", "architecture", "amenities", "progress", "apartments"],
    status: "Business class · on sale",
    heroTitle: ["Life flows", "beside the river."],
    heroLead:
      "Soy Bo‘yi connects city life with a private promenade, a large garden courtyard and the calm rhythm of a contemporary mahalla.",
    cgi: "Project visualisation · CGI",
    film: "Official project video material",
    playVideo: "Play video",
    pauseVideo: "Pause video",
    choose: "Choose an apartment",
    consult: "Request a consultation",
    facts: [
      ["14", "blocks"],
      ["1,249", "apartments"],
      ["4", "phases"],
      ["43,321 m²", "project area"],
      ["13–16", "floors"],
    ],
    riverEyebrow: "The flow of life",
    riverTitle: "The city recedes. The river remains.",
    riverText:
      "A private promenade, planting, a fountain, walking and running routes shape the everyday landscape. The large garden courtyard brings together gardens and functional zones.",
    architectureEyebrow: "Architecture",
    architectureTitle: "Materials that hold the rhythm.",
    architectureText:
      "The 13–16-storey buildings share a reinforced-concrete frame. Their façades combine porcelain stoneware, aluminium composite panels and panoramic curtain glazing.",
    openImage: "Open image",
    previous: "Previous image",
    next: "Next image",
    closeGallery: "Close gallery",
    architectureNames: [
      "Riverfront quarter panorama",
      "Façade composition",
      "Porcelain stoneware and glazing",
    ],
    genplanEyebrow: "Official masterplan",
    genplanTitle: "A guide, not the full catalogue.",
    genplanText:
      "The published masterplan covers only part of the current sections. The complete apartment selection below comes from the current official API and is not limited to this image.",
    amenitiesEyebrow: "A contemporary mahalla",
    amenitiesTitle: "Places where neighbours become familiar.",
    amenitiesText:
      "Children’s and workout areas, a summer cinema, teahouse, children’s summer pool, bakery, guest room and playroom gather around the green courtyard.",
    amenitiesNames: [
      "Large garden courtyard",
      "Modern playgrounds",
      "Sports areas",
      "Open-air cinema",
      "Choyxona",
      "Summer children’s pool",
      "Bakery",
      "Guest room",
      "Children’s playroom",
    ],
    lobbyEyebrow: "Home begins before the apartment",
    lobbyTitle: "A lobby as a second living room.",
    lobbyText:
      "A lounge, views of the green courtyard, two lifts and everyday services including dry cleaning extend the project’s calm rhythm indoors.",
    progressEyebrow: "Delivery · actual photography",
    progressTitle: "Phase one is open.",
    progressText:
      "Phase one opened on 8 February 2026; the first residents are already receiving their keys. The images below were taken at the official event — they are not CGI.",
    actual: "Actual photograph · 08 Feb 2026",
    insurance:
      "Ten years of property insurance protection is planned after construction completion.",
    locationEyebrow: "Uchtepa District",
    locationTitle: "3A Yusuf Sakkaki Avenue.",
    locationText: "Tashkent · 41.299120, 69.176107",
    call: "Call us",
    apartmentsEyebrow: "Current selection",
    apartmentsTitle: "Apartments without guesswork.",
    apartmentsText: (count: number) =>
      `${count} residential apartments are available in the latest official snapshot. The source does not publish prices, so terms are available on request.`,
    room: (n: number) => (n === 0 ? "Rooms not specified" : `${n}-room`),
    floor: "floor",
    section: "section",
    phase: "phase",
    request: "On request",
    details: "Ask about this apartment",
    fullCatalog: "Open the full catalogue",
    formEyebrow: "Personal selection",
    formTitle: "Find your rhythm by the river.",
    formText:
      "Leave your number and a TENCORP manager will clarify your needs and re-check the options you like.",
    formButton: "Send an enquiry",
    formFacts: ["Business class", "Private promenade", "10-year insurance"],
    privacy: "Data processing",
    disclaimer:
      "Information and visualisations are for reference. Ask a manager for current terms.",
    top: "Back to top",
  },
} as const;

function lockDocumentScroll() {
  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPaddingRight = body.style.paddingRight;
  const scrollbarWidth =
    window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${Number.parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`;
  }
  return () => {
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPaddingRight;
  };
}

function useMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    let lenis: Lenis | null = null;
    let observer: IntersectionObserver | null = null;
    try {
      lenis = new Lenis({
        autoRaf: true,
        anchors: { offset: -82 },
        lerp: 0.075,
        smoothWheel: true,
        wheelMultiplier: 0.9,
      });
      observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            }
          }),
        { threshold: 0.12 },
      );
      root.classList.add("soy-motion-ready");
      document
        .querySelectorAll("[data-soy-reveal]")
        .forEach((node) => observer?.observe(node));
    } catch {
      root.classList.remove("soy-motion-ready");
      observer?.disconnect();
      lenis?.destroy();
      return;
    }
    return () => {
      root.classList.remove("soy-motion-ready");
      observer?.disconnect();
      lenis?.destroy();
    };
  }, []);
}

function GalleryLightbox({
  items,
  index,
  language,
  onIndex,
  onClose,
  returnFocus,
}: {
  items: GalleryItem[];
  index: number;
  language: SoyLanguage;
  onIndex: (index: number) => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const swipe = useRef<number | null>(null);
  const indexRef = useRef(index);
  const onIndexRef = useRef(onIndex);
  const onCloseRef = useRef(onClose);
  const t = copy[language];
  useEffect(() => {
    indexRef.current = index;
  }, [index]);
  useEffect(() => {
    onIndexRef.current = onIndex;
  }, [onIndex]);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const unlockScroll = lockDocumentScroll();
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onIndexRef.current(
          (indexRef.current - 1 + items.length) % items.length,
        );
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onIndexRef.current((indexRef.current + 1) % items.length);
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "button:not([disabled])",
        ),
      ];
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      unlockScroll();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [items.length, returnFocus]);
  const item = items[index];
  return (
    <div
      className="soy-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="soy-lightbox__panel"
        ref={panel}
        onPointerDown={(event) => {
          swipe.current = event.clientX;
        }}
        onPointerUp={(event) => {
          if (swipe.current == null) return;
          const delta = event.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(delta) >= 45)
            onIndex(
              delta < 0
                ? (index + 1) % items.length
                : (index - 1 + items.length) % items.length,
            );
        }}
      >
        <button
          ref={close}
          type="button"
          className="soy-lightbox__close"
          onClick={onClose}
          aria-label={t.closeGallery}
        >
          ×
        </button>
        <Image src={asset(item.src)} alt={item.title} fill sizes="94vw" />
        <span className="soy-media-label">
          {item.kind === "photo" ? t.actual : t.cgi}
        </span>
        <div className="soy-lightbox__bar">
          <button
            type="button"
            onClick={() => onIndex((index - 1 + items.length) % items.length)}
            aria-label={t.previous}
          >
            ←
          </button>
          <p role="status" aria-live="polite" aria-atomic="true">
            {String(index + 1).padStart(2, "0")} /{" "}
            {String(items.length).padStart(2, "0")} · {item.title}
          </p>
          <button
            type="button"
            onClick={() => onIndex((index + 1) % items.length)}
            aria-label={t.next}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

function MobileMenu({
  language,
  navigation,
  languageLinks,
  onClose,
  returnFocus,
}: {
  language: SoyLanguage;
  navigation: Array<{ label: string; id: string }>;
  languageLinks: Array<{ language: SoyLanguage; href: string }>;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const navigationTarget = useRef<string | null>(null);
  const t = copy[language];
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const unlockScroll = lockDocumentScroll();
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = [
        ...panel.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href]",
        ),
      ];
      if (!nodes.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      unlockScroll();
      const targetId = navigationTarget.current;
      if (targetId) {
        requestAnimationFrame(() =>
          document.getElementById(targetId)?.focus({ preventScroll: true }),
        );
      } else if (returnFocus?.isConnected) {
        returnFocus.focus();
      }
    };
  }, [returnFocus]);
  return (
    <div
      className="soy-mobile-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={t.menu}
    >
      <div ref={panel}>
        <header>
          <span>SOY BO‘YI</span>
          <button ref={close} type="button" onClick={onClose}>
            {t.close} ×
          </button>
        </header>
        <nav aria-label={t.menu}>
          {navigation.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => {
                navigationTarget.current = item.id;
                onClose();
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div
          className="soy-mobile-dialog__languages"
          role="group"
          aria-label={t.language}
        >
          {languageLinks.map((item) => (
            <a
              key={item.language}
              href={item.href}
              aria-current={language === item.language ? "page" : undefined}
              onClick={onClose}
            >
              {item.language.toUpperCase()}
            </a>
          ))}
        </div>
        <a className="soy-mobile-dialog__phone" href="tel:+998781137712">
          +998 78 113 77 12
        </a>
      </div>
    </div>
  );
}

function GalleryRail({
  items,
  language,
  amenity = false,
  onOpen,
}: {
  items: GalleryItem[];
  language: SoyLanguage;
  amenity?: boolean;
  onOpen: (index: number, opener: HTMLElement) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);
  const t = copy[language];
  const move = (direction: -1 | 1) =>
    viewport.current?.scrollBy({
      left: direction * (amenity ? 460 : 620),
      behavior: "smooth",
    });
  return (
    <div className="soy-rail-wrap">
      <div className="soy-rail-controls">
        <button type="button" aria-label={t.previous} onClick={() => move(-1)}>
          ←
        </button>
        <button type="button" aria-label={t.next} onClick={() => move(1)}>
          →
        </button>
      </div>
      <div
        ref={viewport}
        className={`soy-rail${amenity ? " soy-rail--amenities" : ""}`}
        tabIndex={0}
        aria-label={amenity ? t.amenitiesTitle : t.architectureTitle}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
        onPointerDown={(event) => {
          swipe.current = event.clientX;
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
        onPointerUp={(event) => {
          if (swipe.current == null) return;
          const delta = event.clientX - swipe.current;
          swipe.current = null;
          if (Math.abs(delta) >= 45) move(delta < 0 ? 1 : -1);
        }}
      >
        {items.map((item, index) => (
          <button
            type="button"
            className="soy-gallery-card"
            key={item.src}
            onClick={(event) => onOpen(index, event.currentTarget)}
          >
            <Image
              src={asset(item.src)}
              alt={item.title}
              fill
              sizes={
                amenity
                  ? "(max-width: 700px) 86vw, 38vw"
                  : "(max-width: 700px) 86vw, 52vw"
              }
            />
            <span className="soy-media-label">{t.cgi}</span>
            <strong>{item.title}</strong>
            {amenity ? null : <small>{t.openImage} ↗</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SoyBoyiPage({
  initialLanguage,
  previewUnits,
  availableCount,
}: {
  initialLanguage: SoyLanguage;
  previewUnits: Unit[];
  availableCount: number;
}) {
  const searchParams = useSearchParams();
  const language = languageOf(searchParams.get("lang"), initialLanguage);
  const t = copy[language];
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [lead, setLead] = useState<LeadState | null>(null);
  const [gallery, setGallery] = useState<{
    items: GalleryItem[];
    index: number;
    opener: HTMLElement | null;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  useSoyDocumentLanguage(language);
  useMotion();
  const href = (
    path: string,
    nextLanguage = language,
    extras?: Record<string, string>,
  ) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("lang", nextLanguage);
    Object.entries(extras ?? {}).forEach(([key, value]) =>
      params.set(key, value),
    );
    return `${asset(path)}?${params}`;
  };
  const architecture = useMemo<GalleryItem[]>(
    () =>
      [
        "architecture-river",
        "architecture-facade",
        "architecture-materials",
      ].map((name, index) => ({
        src: media[name],
        kind: "cgi",
        title: t.architectureNames[index],
      })),
    [t],
  );
  const amenities = useMemo<GalleryItem[]>(
    () =>
      [
        "courtyard",
        "playground",
        "workout",
        "summer-cinema",
        "teahouse",
        "summer-pool",
        "bakery",
        "guest-room",
        "playroom",
      ].map((name, index) => ({
        src: media[name],
        kind: "cgi",
        title: t.amenitiesNames[index],
      })),
    [t],
  );
  const openGallery = (
    items: GalleryItem[],
    index: number,
    opener: HTMLElement,
  ) => {
    setLead(null);
    setMenu(null);
    setGallery({ items, index, opener });
  };
  const openLead = (surface: string, opener: HTMLElement, unit?: Unit) => {
    setGallery(null);
    setMenu(null);
    setLead({ surface, unit, opener });
  };
  const modalOpen = Boolean(gallery || lead);
  const backgroundBlocked = Boolean(modalOpen || menu);
  useEffect(() => {
    const scroll = () => setScrolled(window.scrollY > 48);
    scroll();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => window.removeEventListener("scroll", scroll);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return;
    void video.play().catch(() => setVideoPlaying(false));
  }, []);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1101px)");
    const closeOnDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMenu(null);
    };
    query.addEventListener("change", closeOnDesktop);
    return () => query.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <>
      <div
        className="soy-page"
        aria-hidden={backgroundBlocked || undefined}
        inert={backgroundBlocked ? true : undefined}
      >
        <a className="soy-skip" href="#soy-main">
          {t.skip}
        </a>
        <header className={`soy-header${scrolled ? " is-scrolled" : ""}`}>
          <a
            className="soy-brand"
            href={href("/soy-boyi")}
            aria-label="Soy Bo‘yi"
          >
            <Image
              src={asset(media.logo)}
              alt="Soy Bo‘yi"
              width={116}
              height={44}
              unoptimized
            />
          </a>
          <nav aria-label={t.menu}>
            {t.nav.map((label, i) => (
              <a key={label} href={`#${t.navIds[i]}`}>
                {label}
              </a>
            ))}
          </nav>
          <div className="soy-header__actions">
            <div className="soy-languages" role="group" aria-label={t.language}>
              {(["ru", "uz", "en"] as const).map((lang) => (
                <a
                  key={lang}
                  href={href("/soy-boyi", lang)}
                  aria-current={language === lang ? "page" : undefined}
                >
                  {lang.toUpperCase()}
                </a>
              ))}
            </div>
            <a className="soy-phone" href="tel:+998781137712">
              +998 78 113 77 12
            </a>
            <button
              type="button"
              className="soy-menu"
              aria-expanded={Boolean(menu)}
              aria-controls="soy-mobile-menu"
              onClick={(event) => {
                setGallery(null);
                setLead(null);
                setMenu(event.currentTarget);
              }}
            >
              {t.menu}
            </button>
          </div>
        </header>
        <main id="soy-main" tabIndex={-1}>
          <section className="soy-hero">
            <picture>
              <source
                media="(max-width: 640px)"
                srcSet={asset(media["hero-mobile"])}
              />
              <Image
                className="soy-hero__poster"
                src={asset(media.hero)}
                alt={t.architectureNames[0]}
                fill
                priority
                sizes="100vw"
              />
            </picture>
            <video
              ref={videoRef}
              className="soy-hero__video"
              muted
              loop
              playsInline
              aria-hidden="true"
              tabIndex={-1}
              preload="metadata"
              poster={asset(media.hero)}
              onPlay={() => setVideoPlaying(true)}
              onPause={() => setVideoPlaying(false)}
            >
              <source src={asset(media["river-film"])} type="video/mp4" />
            </video>
            <div className="soy-hero__veil" />
            <div className="soy-hero__content">
              <p className="soy-kicker">{t.status}</p>
              <h1>
                {t.heroTitle[0]}
                <br />
                <em>{t.heroTitle[1]}</em>
              </h1>
              <p>{t.heroLead}</p>
              <div className="soy-hero__cta">
                <a href={href("/soy-boyi/apartments")}>
                  {t.choose}
                  <span>→</span>
                </a>
                <button
                  type="button"
                  onClick={(event) => openLead("hero", event.currentTarget)}
                >
                  {t.consult}
                </button>
              </div>
            </div>
            <span className="soy-media-label soy-hero__label">{t.film}</span>
            <button
              type="button"
              className="soy-video-toggle"
              aria-label={videoPlaying ? t.pauseVideo : t.playVideo}
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) void video.play();
                else video.pause();
              }}
            >
              {videoPlaying ? "Ⅱ" : "▶"}
            </button>
            <div className="soy-current" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </section>
          <section className="soy-facts" aria-label={t.riverEyebrow}>
            {t.facts.map(([value, label]) => (
              <div key={label} data-soy-reveal>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </section>
          <section
            id="story"
            tabIndex={-1}
            className="soy-story soy-shell"
            data-soy-reveal
          >
            <div>
              <p className="soy-kicker">{t.riverEyebrow}</p>
              <h2>{t.riverTitle}</h2>
            </div>
            <p>{t.riverText}</p>
            <span className="soy-line" aria-hidden="true" />
          </section>
          <section
            id="architecture"
            tabIndex={-1}
            className="soy-gallery-section"
          >
            <header className="soy-shell" data-soy-reveal>
              <p className="soy-kicker">{t.architectureEyebrow}</p>
              <h2>{t.architectureTitle}</h2>
              <p>{t.architectureText}</p>
            </header>
            <GalleryRail
              items={architecture}
              language={language}
              onOpen={(index, opener) =>
                openGallery(architecture, index, opener)
              }
            />
          </section>
          <section className="soy-genplan soy-shell" data-soy-reveal>
            <div className="soy-genplan__image">
              <Image
                src={asset(media.genplan)}
                alt={t.genplanTitle}
                fill
                sizes="(max-width: 800px) 100vw, 64vw"
              />
              <span className="soy-media-label">{t.genplanEyebrow}</span>
            </div>
            <div>
              <p className="soy-kicker">{t.genplanEyebrow}</p>
              <h2>{t.genplanTitle}</h2>
              <p>{t.genplanText}</p>
              <a href={href("/soy-boyi/apartments")}>{t.fullCatalog} →</a>
            </div>
          </section>
          <section id="amenities" tabIndex={-1} className="soy-amenities">
            <div className="soy-shell">
              <header data-soy-reveal>
                <p className="soy-kicker">{t.amenitiesEyebrow}</p>
                <h2>{t.amenitiesTitle}</h2>
                <p>{t.amenitiesText}</p>
              </header>
            </div>
            <GalleryRail
              items={amenities}
              language={language}
              amenity
              onOpen={(index, opener) => openGallery(amenities, index, opener)}
            />
          </section>
          <section className="soy-lobby soy-shell" data-soy-reveal>
            <div>
              <p className="soy-kicker">{t.lobbyEyebrow}</p>
              <h2>{t.lobbyTitle}</h2>
              <p>{t.lobbyText}</p>
            </div>
            <figure>
              <Image
                src={asset(media.lobby)}
                alt={t.lobbyTitle}
                fill
                sizes="(max-width: 800px) 100vw, 48vw"
              />
              <span className="soy-media-label">{t.cgi}</span>
            </figure>
          </section>
          <section id="progress" tabIndex={-1} className="soy-progress">
            <div className="soy-shell">
              <header data-soy-reveal>
                <p className="soy-kicker">{t.progressEyebrow}</p>
                <h2>{t.progressTitle}</h2>
                <p>{t.progressText}</p>
              </header>
              <div className="soy-progress__grid">
                {["opening-01", "opening-02"].map((name, index) => (
                  <figure key={name} data-soy-reveal>
                    <Image
                      src={asset(media[name])}
                      alt={`${t.progressTitle} ${index + 1}`}
                      fill
                      sizes="(max-width: 700px) 100vw, 50vw"
                    />
                    <span className="soy-media-label">{t.actual}</span>
                  </figure>
                ))}
              </div>
              <p className="soy-insurance">
                10 <span>{t.insurance}</span>
              </p>
            </div>
          </section>
          <section
            id="location"
            className="soy-location soy-shell"
            data-soy-reveal
          >
            <div>
              <p className="soy-kicker">{t.locationEyebrow}</p>
              <h2>{t.locationTitle}</h2>
              <p>{t.locationText}</p>
              <a href="tel:+998781137712">{t.call} · +998 78 113 77 12</a>
            </div>
            <div className="soy-location__map" aria-label={t.locationText}>
              <span>41.299120</span>
              <i aria-hidden="true" />
              <strong>
                SOY
                <br />
                BO‘YI
              </strong>
              <span>69.176107</span>
            </div>
          </section>
          <section id="apartments" tabIndex={-1} className="soy-apartments">
            <div className="soy-shell">
              <header data-soy-reveal>
                <p className="soy-kicker">{t.apartmentsEyebrow}</p>
                <h2>{t.apartmentsTitle}</h2>
                <p>{t.apartmentsText(availableCount)}</p>
              </header>
              <div className="soy-preview-grid">
                {previewUnits.map((unit) => (
                  <article key={unit.id} data-soy-reveal>
                    <div className="soy-preview-plan">
                      {unit.plan ? (
                        <Image
                          src={asset(unit.plan)}
                          alt={`${t.room(unit.rooms)} · №${unit.number}`}
                          fill
                          sizes="(max-width: 700px) 92vw, 30vw"
                        />
                      ) : (
                        <span>{t.openImage}</span>
                      )}
                    </div>
                    <p>
                      {t.room(unit.rooms)} · №{unit.number}
                    </p>
                    <h3>
                      {new Intl.NumberFormat(locale(language), {
                        maximumFractionDigits: 2,
                      }).format(unit.area)}{" "}
                      m²
                    </h3>
                    <dl>
                      <div>
                        <dt>{t.floor}</dt>
                        <dd>{unit.floor}</dd>
                      </div>
                      <div>
                        <dt>{t.section}</dt>
                        <dd>{unit.section}</dd>
                      </div>
                      <div>
                        <dt>{t.phase}</dt>
                        <dd>{unit.phase}</dd>
                      </div>
                    </dl>
                    <strong>{t.request}</strong>
                    <button
                      type="button"
                      onClick={(event) =>
                        openLead("landing-preview", event.currentTarget, unit)
                      }
                    >
                      {t.details} →
                    </button>
                  </article>
                ))}
              </div>
              <a
                className="soy-catalog-link"
                href={href("/soy-boyi/apartments")}
              >
                {t.fullCatalog}
                <span>{availableCount}</span>
                <i>→</i>
              </a>
            </div>
          </section>
          <section className="soy-form soy-shell" data-soy-reveal>
            <div>
              <p className="soy-kicker">{t.formEyebrow}</p>
              <h2>{t.formTitle}</h2>
              <p>{t.formText}</p>
            </div>
            <div>
              <ul>
                {t.formFacts.map((fact) => (
                  <li key={fact}>{fact}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={(event) => openLead("final-form", event.currentTarget)}
              >
                {t.formButton}
                <span>→</span>
              </button>
            </div>
          </section>
        </main>
        <footer className="soy-footer">
          <a href={href("/soy-boyi")}>
            <Image
              src={asset(media.logo)}
              alt="Soy Bo‘yi"
              width={130}
              height={48}
              unoptimized
            />
          </a>
          <p>{t.disclaimer}</p>
          <nav aria-label={t.footerNav}>
            <a
              href={href("/privacy", language, {
                project: "soy-boyi",
                from: "landing",
              })}
            >
              {t.privacy}
            </a>
            <a href="#soy-main">{t.top} ↑</a>
          </nav>
        </footer>
      </div>
      {menu ? (
        <div id="soy-mobile-menu">
          <MobileMenu
            language={language}
            navigation={t.nav.map((label, index) => ({
              label,
              id: t.navIds[index],
            }))}
            languageLinks={(["ru", "uz", "en"] as const).map((lang) => ({
              language: lang,
              href: href("/soy-boyi", lang),
            }))}
            onClose={() => setMenu(null)}
            returnFocus={menu}
          />
        </div>
      ) : null}
      {!menu && gallery ? (
        <GalleryLightbox
          items={gallery.items}
          index={gallery.index}
          language={language}
          onIndex={(index) =>
            setGallery((value) => (value ? { ...value, index } : value))
          }
          onClose={() => setGallery(null)}
          returnFocus={gallery.opener}
        />
      ) : null}
      {!menu && lead ? (
        <LeadModal
          open
          language={language}
          context={`projectSlug=soy-boyi;surface=landing:${lead.surface};lang=${language};${lead.unit ? `unitId=${lead.unit.id};unitKey=${lead.unit.unitKey};number=${lead.unit.number};rooms=${lead.unit.rooms};area=${lead.unit.area};floor=${lead.unit.floor};section=${lead.unit.section};phase=${lead.unit.phase}` : "unit=general"}`}
          brandName="TENCORP"
          projectName="SOY BO‘YI"
          tagline={
            lead.unit
              ? `${t.room(lead.unit.rooms)} · ${lead.unit.area} m² · №${lead.unit.number}`
              : t.formTitle
          }
          facts={
            lead.unit
              ? [
                  `${t.floor} ${lead.unit.floor}`,
                  `${t.section} ${lead.unit.section}`,
                  t.request,
                ]
              : t.formFacts
          }
          submitUrl={soyBoyiLeadSubmitUrl()}
          projectSlug="soy-boyi"
          unitId={lead.unit?.id}
          unitKey={lead.unit?.unitKey}
          privacyUrl={href("/privacy", language, {
            project: "soy-boyi",
            from: "landing",
          })}
          requireConsent
          returnFocusTo={lead.opener}
          onClose={() => setLead(null)}
        />
      ) : null}
    </>
  );
}
