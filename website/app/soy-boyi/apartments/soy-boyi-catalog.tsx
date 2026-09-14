"use client";

import Image from "next/image";
import { useSearchParams } from "next/navigation";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LeadModal, rememberLiveCatalogUnit } from "@/app/lead-modal";
import {
  catalogLeadIdentity,
  useLiveCatalogSnapshot,
} from "@/app/live-catalog";
import { soyBoyiLeadSubmitUrl } from "../soy-boyi-lead";
import { type SoyLanguage, useSoyDocumentLanguage } from "../soy-boyi-language";

type Unit = {
  id: string;
  unitKey: string;
  sourceKey?: string;
  sourceOrder: number;
  number: string;
  rooms: number;
  area: number;
  floor: number;
  section: string;
  phase: string;
  completion: string | null;
  status: "AVAILABLE";
  priceVisibility: "request-only";
  plan: string | null;
  planStatus: "available" | "missing-at-source";
};
type Snapshot = {
  schemaVersion: number;
  capturedAt: string;
  serverDate: string;
  availableResidentialTotal: number;
  excludedCommercial: number;
  planCount: number;
  missingPlanCount: number;
  reconciliation: string;
  filters: {
    rooms: number[];
    floors: number[];
    sections: string[];
    phases: string[];
    completions: Array<string | null>;
    area: { min: number; max: number };
  };
  units: Unit[];
};
type Mode = "cards" | "chess";
type Sort =
  | "source"
  | "areaAsc"
  | "areaDesc"
  | "floorAsc"
  | "floorDesc"
  | "roomsAsc"
  | "roomsDesc";
type ModalState = {
  kind: "detail" | "plan";
  unit: Unit;
  opener: HTMLElement | null;
};
type LeadState = {
  unit: Unit | null;
  surface: string;
  opener: HTMLElement | null;
};
const configuredBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? "";
const basePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";
const asset = (path: string) => `${basePath}${path}`;
const languageOf = (
  value: string | null,
  fallback: SoyLanguage,
): SoyLanguage =>
  value === "ru" || value === "uz" || value === "en" ? value : fallback;
const locale = (language: SoyLanguage) =>
  language === "ru" ? "ru-RU" : language === "uz" ? "uz-UZ" : "en-US";
const formatArea = (language: SoyLanguage, area: number) =>
  new Intl.NumberFormat(locale(language), { maximumFractionDigits: 2 }).format(
    area,
  );

const copy = {
  ru: {
    back: "Soy Bo‘yi",
    language: "Язык",
    skipResults: "Перейти к результатам квартир",
    title: "Квартиры у реки.",
    subtitle: "Актуальные квартиры в продаже",
    inventory: "жилых квартир",
    commercial: "очереди",
    plans: "квартир с планировкой",
    missing: "без опубликованной планировки",
    updated: "Обновлено",
    sourceStatus: "Доступна",
    price: "Цена",
    request: "По запросу",
    modes: { cards: "Карточки", chess: "Шахматка" },
    modeLabel: "Режим каталога",
    filters: "Фильтры",
    rooms: "Комнаты",
    roomsUnknown: "Не указаны",
    floor: "Этаж",
    area: "Площадь, м²",
    section: "Секция",
    phase: "Очередь",
    completion: "Срок",
    all: "Все",
    from: "от",
    to: "до",
    completionUnknown: "Не указан",
    reset: "Сбросить",
    sort: "Сортировка",
    sorts: {
      source: "По умолчанию",
      areaAsc: "Площадь: меньше",
      areaDesc: "Площадь: больше",
      floorAsc: "Этаж: ниже",
      floorDesc: "Этаж: выше",
      roomsAsc: "Комнат: меньше",
      roomsDesc: "Комнат: больше",
    },
    found: "Найдено",
    room: (n: number) => (n === 0 ? "Комнаты не указаны" : `${n}-комнатная`),
    unit: "Квартира",
    openDetails: "Открыть детали",
    openPlan: "Открыть планировку",
    planMissing: "Планировка пока недоступна",
    showMore: "Показать ещё",
    shown: "Показано",
    of: "из",
    matrixTitle: "Шахматка по секциям",
    matrixHint:
      "Свайпайте, используйте трекпад, кнопки или клавиши ← →. Фильтры сохраняют только подходящие позиции.",
    scrollLeft: "Прокрутить влево",
    scrollRight: "Прокрутить вправо",
    empty: "По этим параметрам квартир нет.",
    select: "Выберите квартиру в шахматке.",
    detail: "Паспорт квартиры",
    close: "Закрыть",
    ask: "Уточнить условия",
    planTitle: "Официальная планировка",
    planNote: "Актуальная планировка выбранной квартиры.",
    missingNote:
      "Для этой квартиры планировка пока недоступна. Менеджер поможет уточнить детали.",
    availability: "Статус",
    captured: "Обновлено",
    disclaimer:
      "Цены уточняются по запросу. Доступность и условия подтверждает менеджер.",
    privacy: "Обработка данных",
    top: "Наверх",
  },
  uz: {
    back: "Soy Bo‘yi",
    language: "Til",
    skipResults: "Xonadonlar natijalariga o‘tish",
    title: "Daryo bo‘yidagi xonadonlar.",
    subtitle: "Sotuvdagi dolzarb xonadonlar",
    inventory: "turar joy",
    commercial: "bosqich",
    plans: "rejasi bor xonadon",
    missing: "rejasi e’lon qilinmagan",
    updated: "Yangilandi",
    sourceStatus: "Mavjud",
    price: "Narx",
    request: "So‘rov bo‘yicha",
    modes: { cards: "Kartochkalar", chess: "Shaxmatka" },
    modeLabel: "Katalog rejimi",
    filters: "Filtrlar",
    rooms: "Xonalar",
    roomsUnknown: "Ko‘rsatilmagan",
    floor: "Qavat",
    area: "Maydon, m²",
    section: "Seksiya",
    phase: "Navbat",
    completion: "Muddat",
    all: "Barchasi",
    from: "dan",
    to: "gacha",
    completionUnknown: "Ko‘rsatilmagan",
    reset: "Tozalash",
    sort: "Saralash",
    sorts: {
      source: "Standart tartibda",
      areaAsc: "Maydon: kichik",
      areaDesc: "Maydon: katta",
      floorAsc: "Qavat: past",
      floorDesc: "Qavat: yuqori",
      roomsAsc: "Xonalar: kam",
      roomsDesc: "Xonalar: ko‘p",
    },
    found: "Topildi",
    room: (n: number) => (n === 0 ? "Xonalar ko‘rsatilmagan" : `${n} xonali`),
    unit: "Xonadon",
    openDetails: "Tafsilotlarni ochish",
    openPlan: "Rejani ochish",
    planMissing: "Reja hozircha mavjud emas",
    showMore: "Yana ko‘rsatish",
    shown: "Ko‘rsatildi",
    of: "/",
    matrixTitle: "Seksiyalar bo‘yicha shaxmatka",
    matrixHint:
      "Svip, trekpad, tugmalar yoki ← → klavishlaridan foydalaning. Filtrlar faqat mos pozitsiyalarni qoldiradi.",
    scrollLeft: "Chapga surish",
    scrollRight: "O‘ngga surish",
    empty: "Bu parametrlar bo‘yicha xonadon yo‘q.",
    select: "Shaxmatkadan xonadon tanlang.",
    detail: "Xonadon pasporti",
    close: "Yopish",
    ask: "Shartlarni aniqlash",
    planTitle: "Rasmiy reja",
    planNote: "Tanlangan xonadonning dolzarb rejasi.",
    missingNote:
      "Bu xonadonning rejasi hozircha mavjud emas. Menejer tafsilotlarni aniqlashga yordam beradi.",
    availability: "Holat",
    captured: "Yangilandi",
    disclaimer:
      "Narxlar so‘rov bo‘yicha aniqlanadi. Mavjudlik va shartlarni menejer tasdiqlaydi.",
    privacy: "Ma’lumotlarni qayta ishlash",
    top: "Yuqoriga",
  },
  en: {
    back: "Soy Bo‘yi",
    language: "Language",
    skipResults: "Skip to apartment results",
    title: "Apartments by the river.",
    subtitle: "Currently available apartments",
    inventory: "residential apartments",
    commercial: "phases",
    plans: "apartments with a floor plan",
    missing: "without a published floor plan",
    updated: "Updated",
    sourceStatus: "Available",
    price: "Price",
    request: "On request",
    modes: { cards: "Cards", chess: "Chessboard" },
    modeLabel: "Catalogue view",
    filters: "Filters",
    rooms: "Rooms",
    roomsUnknown: "Not specified",
    floor: "Floor",
    area: "Area, m²",
    section: "Section",
    phase: "Phase",
    completion: "Completion",
    all: "All",
    from: "from",
    to: "to",
    completionUnknown: "Not specified",
    reset: "Reset",
    sort: "Sort",
    sorts: {
      source: "Default order",
      areaAsc: "Area: smaller",
      areaDesc: "Area: larger",
      floorAsc: "Floor: lower",
      floorDesc: "Floor: higher",
      roomsAsc: "Rooms: fewer",
      roomsDesc: "Rooms: more",
    },
    found: "Found",
    room: (n: number) => (n === 0 ? "Rooms not specified" : `${n}-room`),
    unit: "Apartment",
    openDetails: "Open details",
    openPlan: "Open plan",
    planMissing: "Floor plan is not available yet",
    showMore: "Show more",
    shown: "Shown",
    of: "of",
    matrixTitle: "Section-by-section chessboard",
    matrixHint:
      "Swipe, use a trackpad, buttons or the ← → keys. Filters retain matching entries only.",
    scrollLeft: "Scroll left",
    scrollRight: "Scroll right",
    empty: "No apartments match these filters.",
    select: "Choose an apartment in the chessboard.",
    detail: "Apartment record",
    close: "Close",
    ask: "Ask about terms",
    planTitle: "Official apartment plan",
    planNote: "Current floor plan for the selected apartment.",
    missingNote:
      "The floor plan is not available yet. A manager can help clarify the details.",
    availability: "Status",
    captured: "Updated",
    disclaimer:
      "Prices are available on request. A manager confirms availability and terms.",
    privacy: "Data processing",
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

function Modal({
  state,
  language,
  onClose,
  onPlan,
  onLead,
}: {
  state: ModalState;
  language: SoyLanguage;
  onClose: () => void;
  onPlan: (unit: Unit, opener: HTMLElement | null) => void;
  onLead: (unit: Unit, opener: HTMLElement | null) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const t = copy[language];
  const unit = state.unit;
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    closeRef.current?.focus();
  }, [state.kind]);
  useEffect(() => {
    const unlockScroll = lockDocumentScroll();
    closeRef.current?.focus();
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
      if (state.opener?.isConnected) state.opener.focus();
    };
  }, [state.opener]);
  return (
    <div
      className={`sbc-modal ${state.kind === "plan" ? "is-plan" : "is-detail"}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="sbc-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <article ref={panel}>
        <button
          ref={closeRef}
          type="button"
          className="sbc-modal__close"
          onClick={onClose}
          aria-label={t.close}
        >
          ×
        </button>
        {state.kind === "plan" ? (
          <>
            <header>
              <small>{t.planTitle}</small>
              <h2 id="sbc-modal-title">
                {t.unit} №{unit.number}
              </h2>
            </header>
            <div className="sbc-modal__plan">
              {unit.plan ? (
                <Image
                  src={asset(unit.plan)}
                  alt={`${t.planTitle} · №${unit.number}`}
                  fill
                  sizes="min(90vw, 900px)"
                />
              ) : (
                <div className="sbc-plan-missing">
                  <i aria-hidden="true">∿</i>
                  <strong>{t.planMissing}</strong>
                  <p>{t.missingNote}</p>
                </div>
              )}
            </div>
            <p className="sbc-modal__note">
              {unit.plan ? t.planNote : t.missingNote}
            </p>
          </>
        ) : (
          <>
            <UnitDetail
              unit={unit}
              language={language}
              headingId="sbc-modal-title"
            />
            <div className="sbc-modal__actions">
              {unit.plan ? (
                <button
                  type="button"
                  onClick={(event) =>
                    onPlan(unit, state.opener ?? event.currentTarget)
                  }
                >
                  {t.openPlan}
                </button>
              ) : (
                <p>{t.planMissing}</p>
              )}
              <button
                type="button"
                onClick={(event) =>
                  onLead(unit, state.opener ?? event.currentTarget)
                }
              >
                {t.ask} →
              </button>
            </div>
          </>
        )}
      </article>
    </div>
  );
}

function UnitDetail({
  unit,
  language,
  headingId,
}: {
  unit: Unit;
  language: SoyLanguage;
  headingId?: string;
}) {
  const t = copy[language];
  return (
    <div className="sbc-detail__content">
      <small>{t.detail}</small>
      <h2 id={headingId}>
        {t.room(unit.rooms)}
        <br />№{unit.number}
      </h2>
      <strong>
        {new Intl.NumberFormat(locale(language), {
          maximumFractionDigits: 2,
        }).format(unit.area)}{" "}
        m²
      </strong>
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
        <div>
          <dt>{t.completion}</dt>
          <dd>{unit.completion ?? t.completionUnknown}</dd>
        </div>
        <div>
          <dt>{t.availability}</dt>
          <dd>{t.sourceStatus}</dd>
        </div>
        <div>
          <dt>{t.price}</dt>
          <dd>{t.request}</dd>
        </div>
      </dl>
      {!unit.plan ? (
        <p className="sbc-detail__missing">{t.missingNote}</p>
      ) : null}
    </div>
  );
}

function MatrixGroup({
  section,
  units,
  language,
  selected,
  onSelect,
}: {
  section: string;
  units: Unit[];
  language: SoyLanguage;
  selected: string | null;
  onSelect: (unit: Unit, opener: HTMLButtonElement) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const t = copy[language];
  const floors = [...new Set(units.map((unit) => unit.floor))].sort(
    (a, b) => b - a,
  );
  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!viewport.current) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      viewport.current.scrollBy({
        left: event.key === "ArrowLeft" ? -320 : 320,
        behavior: "smooth",
      });
    }
  };
  return (
    <section className="sbc-matrix-group">
      <header>
        <div>
          <small>{t.section}</small>
          <h3>{section}</h3>
        </div>
        <div>
          <button
            type="button"
            aria-label={t.scrollLeft}
            onClick={() =>
              viewport.current?.scrollBy({ left: -360, behavior: "smooth" })
            }
          >
            ←
          </button>
          <button
            type="button"
            aria-label={t.scrollRight}
            onClick={() =>
              viewport.current?.scrollBy({ left: 360, behavior: "smooth" })
            }
          >
            →
          </button>
        </div>
      </header>
      <div
        className="sbc-matrix-scroll"
        ref={viewport}
        tabIndex={0}
        onKeyDown={key}
        aria-label={`${t.matrixTitle}: ${t.section} ${section}`}
      >
        <table>
          <tbody>
            {floors.map((floor) => (
              <tr key={floor}>
                <th scope="row">{floor}</th>
                <td>
                  {units
                    .filter((unit) => unit.floor === floor)
                    .map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        className={selected === unit.id ? "is-selected" : ""}
                        onClick={(event) => onSelect(unit, event.currentTarget)}
                        aria-pressed={selected === unit.id}
                      >
                        <span>№{unit.number}</span>
                        <strong>{unit.area} m²</strong>
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function SoyBoyiCatalog({
  snapshot: embeddedSnapshot,
  initialLanguage,
}: {
  snapshot: Snapshot;
  initialLanguage: SoyLanguage;
}) {
  const searchParams = useSearchParams();
  const language = languageOf(searchParams.get("lang"), initialLanguage);
  const t = copy[language];
  const { data: snapshot } = useLiveCatalogSnapshot("soy-boyi", embeddedSnapshot);
  useSoyDocumentLanguage(language);
  const [mode, setMode] = useState<Mode>("cards");
  const [sort, setSort] = useState<Sort>("source");
  const [rooms, setRooms] = useState<number[]>([]);
  const [floorFrom, setFloorFrom] = useState("");
  const [floorTo, setFloorTo] = useState("");
  const [areaFrom, setAreaFrom] = useState("");
  const [areaTo, setAreaTo] = useState("");
  const [section, setSection] = useState("all");
  const [phase, setPhase] = useState("all");
  const [completion, setCompletion] = useState("all");
  const [visible, setVisible] = useState(12);
  const [selected, setSelected] = useState<Unit | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [lead, setLead] = useState<LeadState | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
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
  const filtered = useMemo(
    () =>
      snapshot.units
        .filter(
          (unit) =>
            (!rooms.length || rooms.includes(unit.rooms)) &&
            (!floorFrom || unit.floor >= Number(floorFrom)) &&
            (!floorTo || unit.floor <= Number(floorTo)) &&
            (!areaFrom || unit.area >= Number(areaFrom)) &&
            (!areaTo || unit.area <= Number(areaTo)) &&
            (section === "all" || unit.section === section) &&
            (phase === "all" || unit.phase === phase) &&
            (completion === "all" ||
              (completion === "unknown"
                ? unit.completion == null
                : unit.completion === completion)),
        )
        .sort((a, b) => {
          const primary =
            sort === "source"
              ? a.sourceOrder - b.sourceOrder
              : sort === "areaAsc"
                ? a.area - b.area
                : sort === "areaDesc"
                  ? b.area - a.area
                  : sort === "floorAsc"
                    ? a.floor - b.floor
                    : sort === "floorDesc"
                      ? b.floor - a.floor
                      : sort === "roomsAsc"
                        ? a.rooms - b.rooms
                        : b.rooms - a.rooms;
          return primary || a.sourceOrder - b.sourceOrder;
        }),
    [
      snapshot.units,
      rooms,
      floorFrom,
      floorTo,
      areaFrom,
      areaTo,
      section,
      phase,
      completion,
      sort,
    ],
  );
  const groups = useMemo(
    () =>
      [...new Set(filtered.map((unit) => unit.section))]
        .sort((a, b) => Number(a) - Number(b))
        .map((value) => ({
          section: value,
          units: filtered.filter((unit) => unit.section === value),
        })),
    [filtered],
  );
  const activeSelected =
    selected && filtered.some((unit) => unit.id === selected.id)
      ? selected
      : null;
  const modalOpen = Boolean(modal || lead);
  const reset = () => {
    setRooms([]);
    setFloorFrom("");
    setFloorTo("");
    setAreaFrom("");
    setAreaTo("");
    setSection("all");
    setPhase("all");
    setCompletion("all");
    setVisible(12);
    setSelected(null);
  };
  const openModal = (
    kind: "detail" | "plan",
    unit: Unit,
    opener: HTMLElement | null,
  ) => {
    setLead(null);
    setModal({ kind, unit, opener });
  };
  const openLead = (
    unit: Unit | null,
    surface: string,
    opener: HTMLElement | null,
  ) => {
    setModal(null);
    if (unit) {
      rememberLiveCatalogUnit(unit, "soy-boyi");
    }
    setLead({ unit, surface, opener });
  };
  const leadIdentity = catalogLeadIdentity(lead?.unit);
  const modeKey = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? 1
          : event.key === "ArrowLeft"
            ? (index + 1) % 2
            : (index + 1) % 2;
    const nextMode = (["cards", "chess"] as const)[next];
    setMode(nextMode);
    tabRefs.current[next]?.focus();
  };
  return (
    <>
      <div
        id="sbc-top"
        className="sbc-page"
        aria-hidden={modalOpen || undefined}
        inert={modalOpen ? true : undefined}
      >
        <a className="sbc-skip" href="#sbc-results">
          {t.skipResults}
        </a>
        <header className="sbc-header">
          <a href={href("/soy-boyi")}>
            <span>←</span>
            {t.back}
          </a>
          <div className="sbc-langs" role="group" aria-label={t.language}>
            {(["ru", "uz", "en"] as const).map((lang) => (
              <a
                key={lang}
                href={href("/soy-boyi/apartments", lang)}
                aria-current={language === lang ? "page" : undefined}
              >
                {lang.toUpperCase()}
              </a>
            ))}
          </div>
          <a href="tel:+998781137712">+998 78 113 77 12</a>
        </header>
        <main>
          <section className="sbc-intro">
            <p>{t.subtitle}</p>
            <h1>{t.title}</h1>
            <div className="sbc-summary">
              <span>
                <strong>{snapshot.availableResidentialTotal}</strong>
                {t.inventory}
              </span>
              <span>
                <strong>{snapshot.planCount}</strong>
                {t.plans}
              </span>
              <span>
                <strong>{snapshot.missingPlanCount}</strong>
                {t.missing}
              </span>
              <span>
                <strong>{snapshot.filters.phases.length}</strong>
                {t.commercial}
              </span>
            </div>
            <p className="sbc-updated">
              {t.updated}:{" "}
              {new Intl.DateTimeFormat(locale(language), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Tashkent",
              }).format(new Date(snapshot.serverDate))}
            </p>
          </section>
          <section className="sbc-toolbar">
            <div className="sbc-modes" role="tablist" aria-label={t.modeLabel}>
              {(["cards", "chess"] as const).map((item, index) => (
                <button
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  key={item}
                  type="button"
                  role="tab"
                  id={`sbc-tab-${item}`}
                  aria-controls={`sbc-panel-${item}`}
                  aria-selected={mode === item}
                  tabIndex={mode === item ? 0 : -1}
                  onClick={() => setMode(item)}
                  onKeyDown={(event) => modeKey(event, index)}
                >
                  <small>0{index + 1}</small>
                  {t.modes[item]}
                </button>
              ))}
            </div>
            <label>
              {t.sort}
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
              >
                {Object.entries(t.sorts).map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="sbc-workspace">
            <aside className="sbc-filters">
              <div>
                <h2>{t.filters}</h2>
                <button type="button" onClick={reset}>
                  {t.reset}
                </button>
              </div>
              <fieldset>
                <legend>{t.rooms}</legend>
                <div className="sbc-room-filters">
                  {snapshot.filters.rooms.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={rooms.includes(value) ? "is-active" : ""}
                      aria-pressed={rooms.includes(value)}
                      onClick={() =>
                        setRooms((current) =>
                          current.includes(value)
                            ? current.filter((item) => item !== value)
                            : [...current, value],
                        )
                      }
                    >
                      {value === 0 ? t.roomsUnknown : value}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>{t.floor}</legend>
                <div className="sbc-range">
                  <input
                    inputMode="numeric"
                    type="number"
                    min={1}
                    max={16}
                    placeholder={t.from}
                    aria-label={t.floor + " " + t.from}
                    value={floorFrom}
                    onChange={(event) => setFloorFrom(event.target.value)}
                  />
                  <input
                    inputMode="numeric"
                    type="number"
                    min={1}
                    max={16}
                    placeholder={t.to}
                    aria-label={t.floor + " " + t.to}
                    value={floorTo}
                    onChange={(event) => setFloorTo(event.target.value)}
                  />
                </div>
              </fieldset>
              <fieldset>
                <legend>{t.area}</legend>
                <div className="sbc-range">
                  <input
                    inputMode="decimal"
                    type="number"
                    min={snapshot.filters.area.min}
                    max={snapshot.filters.area.max}
                    placeholder={`${t.from} ${snapshot.filters.area.min}`}
                    aria-label={t.area + " " + t.from}
                    value={areaFrom}
                    onChange={(event) => setAreaFrom(event.target.value)}
                  />
                  <input
                    inputMode="decimal"
                    type="number"
                    min={snapshot.filters.area.min}
                    max={snapshot.filters.area.max}
                    placeholder={`${t.to} ${snapshot.filters.area.max}`}
                    aria-label={t.area + " " + t.to}
                    value={areaTo}
                    onChange={(event) => setAreaTo(event.target.value)}
                  />
                </div>
              </fieldset>
              {(
                [
                  [t.section, section, setSection, snapshot.filters.sections],
                  [t.phase, phase, setPhase, snapshot.filters.phases],
                ] as const
              ).map(([label, value, setter, options]) => (
                <label key={label}>
                  {label}
                  <select
                    value={value}
                    onChange={(event) => setter(event.target.value)}
                  >
                    <option value="all">{t.all}</option>
                    {options.map((option) => (
                      <option value={option} key={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                {t.completion}
                <select
                  value={completion}
                  onChange={(event) => setCompletion(event.target.value)}
                >
                  <option value="all">{t.all}</option>
                  {snapshot.filters.completions.map((option) => (
                    <option
                      value={option ?? "unknown"}
                      key={option ?? "unknown"}
                    >
                      {option ?? t.completionUnknown}
                    </option>
                  ))}
                </select>
              </label>
            </aside>
            <div className="sbc-results" id="sbc-results" tabIndex={-1}>
              <div className="sbc-result-count" aria-live="polite">
                <strong>{filtered.length}</strong> {t.found.toLowerCase()}
              </div>
              {mode !== "cards" ? (
                <div
                  role="tabpanel"
                  id="sbc-panel-cards"
                  aria-labelledby="sbc-tab-cards"
                  hidden
                />
              ) : null}
              {mode !== "chess" ? (
                <div
                  role="tabpanel"
                  id="sbc-panel-chess"
                  aria-labelledby="sbc-tab-chess"
                  hidden
                />
              ) : null}
              {filtered.length === 0 ? (
                <div
                  role="tabpanel"
                  id={`sbc-panel-${mode}`}
                  aria-labelledby={`sbc-tab-${mode}`}
                  className="sbc-empty"
                >
                  <p>{t.empty}</p>
                  <button type="button" onClick={reset}>
                    {t.reset}
                  </button>
                </div>
              ) : mode === "cards" ? (
                <div
                  role="tabpanel"
                  id="sbc-panel-cards"
                  aria-labelledby="sbc-tab-cards"
                  className="sbc-cards"
                >
                  <div className="sbc-card-grid">
                    {filtered.slice(0, visible).map((unit) => (
                      <article key={unit.id}>
                        <button
                          type="button"
                          className="sbc-card__main"
                          onClick={(event) =>
                            openModal("detail", unit, event.currentTarget)
                          }
                          aria-label={`${t.openDetails}: ${t.room(unit.rooms)}, ${formatArea(language, unit.area)} m², ${t.unit} №${unit.number}, ${t.floor} ${unit.floor}, ${t.section} ${unit.section}, ${t.phase} ${unit.phase}, ${t.price}: ${t.request}`}
                        >
                          <div className="sbc-card__plan">
                            {unit.plan ? (
                              <Image
                                src={asset(unit.plan)}
                                alt={`${t.planTitle} · №${unit.number}`}
                                fill
                                loading="lazy"
                                sizes="(max-width: 760px) 92vw, (max-width: 1200px) 42vw, 28vw"
                              />
                            ) : (
                              <div className="sbc-plan-missing">
                                <i aria-hidden="true">∿</i>
                                <span>{t.planMissing}</span>
                              </div>
                            )}
                          </div>
                          <small>
                            {t.room(unit.rooms)} · №{unit.number}
                          </small>
                          <h2>{formatArea(language, unit.area)} m²</h2>
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
                        </button>
                        <div className="sbc-card__actions">
                          <button
                            type="button"
                            onClick={(event) =>
                              openModal(
                                unit.plan ? "plan" : "detail",
                                unit,
                                event.currentTarget,
                              )
                            }
                          >
                            {unit.plan ? t.openPlan : t.openDetails}
                          </button>
                          <button
                            type="button"
                            onClick={(event) =>
                              openLead(unit, "card", event.currentTarget)
                            }
                          >
                            {t.ask}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {visible < filtered.length ? (
                    <button
                      className="sbc-show-more"
                      type="button"
                      onClick={() => setVisible((value) => value + 12)}
                    >
                      <span>{t.showMore}</span>
                      <strong>
                        {t.shown} {Math.min(visible, filtered.length)} {t.of}{" "}
                        {filtered.length}
                      </strong>
                      <i>↓</i>
                    </button>
                  ) : null}
                </div>
              ) : (
                <div
                  role="tabpanel"
                  id="sbc-panel-chess"
                  aria-labelledby="sbc-tab-chess"
                  className="sbc-chess"
                >
                  <header>
                    <h2>{t.matrixTitle}</h2>
                    <p>{t.matrixHint}</p>
                  </header>
                  <div className="sbc-chess-layout">
                    <div className="sbc-matrix-groups">
                      {groups.map((group) => (
                        <MatrixGroup
                          key={group.section}
                          section={group.section}
                          units={group.units}
                          language={language}
                          selected={activeSelected?.id ?? null}
                          onSelect={(unit, opener) => {
                            if (
                              window.matchMedia("(max-width: 850px)").matches
                            ) {
                              openModal("detail", unit, opener);
                            } else {
                              setSelected(unit);
                            }
                          }}
                        />
                      ))}
                    </div>
                    <aside
                      className={`sbc-detail ${activeSelected ? "" : "is-empty"}`}
                      aria-live="polite"
                    >
                      {activeSelected ? (
                        <>
                          <UnitDetail
                            unit={activeSelected}
                            language={language}
                          />
                          <div className="sbc-detail__actions">
                            {activeSelected.plan ? (
                              <button
                                type="button"
                                onClick={(event) =>
                                  openModal(
                                    "plan",
                                    activeSelected,
                                    event.currentTarget,
                                  )
                                }
                              >
                                {t.openPlan}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) =>
                                openLead(
                                  activeSelected,
                                  "matrix-detail",
                                  event.currentTarget,
                                )
                              }
                            >
                              {t.ask} →
                            </button>
                          </div>
                        </>
                      ) : (
                        <p>{t.select}</p>
                      )}
                    </aside>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
        <footer className="sbc-footer">
          <a href={href("/soy-boyi")}>SOY BO‘YI</a>
          <p>{t.disclaimer}</p>
          <a
            href={href("/privacy", language, {
              project: "soy-boyi",
              from: "catalog",
            })}
          >
            {t.privacy}
          </a>
          <a href="#sbc-top">{t.top} ↑</a>
        </footer>
      </div>
      {modal ? (
        <Modal
          state={modal}
          language={language}
          onClose={() => setModal(null)}
          onPlan={(unit, opener) => openModal("plan", unit, opener)}
          onLead={(unit, opener) => openLead(unit, "detail", opener)}
        />
      ) : null}
      {lead ? (
        <LeadModal
          open
          language={language}
          context={`projectSlug=soy-boyi;surface=catalog:${lead.surface};lang=${language};${lead.unit ? `${leadIdentity.unitKey ? `unitKey=${leadIdentity.unitKey};` : ""}number=${lead.unit.number};rooms=${lead.unit.rooms};area=${lead.unit.area};floor=${lead.unit.floor};section=${lead.unit.section};phase=${lead.unit.phase};completion=${lead.unit.completion ?? "unspecified"};price=request-only` : "unit=general"}`}
          brandName="TENCORP"
          projectName="SOY BO‘YI"
          tagline={
            lead.unit
              ? `${t.room(lead.unit.rooms)} · ${lead.unit.area} m² · №${lead.unit.number}`
              : t.title
          }
          facts={
            lead.unit
              ? [
                  `${t.floor} ${lead.unit.floor}`,
                  `${t.section} ${lead.unit.section}`,
                  t.request,
                ]
              : [
                  `${snapshot.availableResidentialTotal} · ${t.inventory}`,
                  `${snapshot.planCount} · ${t.plans}`,
                  t.request,
                ]
          }
          submitUrl={soyBoyiLeadSubmitUrl()}
          projectSlug="soy-boyi"
          {...leadIdentity}
          privacyUrl={href("/privacy", language, {
            project: "soy-boyi",
            from: "catalog",
          })}
          requireConsent
          returnFocusTo={lead.opener}
          onClose={() => setLead(null)}
        />
      ) : null}
    </>
  );
}
