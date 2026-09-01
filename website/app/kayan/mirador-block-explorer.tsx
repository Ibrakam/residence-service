'use client';

/* eslint-disable @next/next/no-img-element */

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KayanLanguage } from './project-data';
import {
  getMiradorMaskPath,
  MIRADOR_BLOCKS,
  MIRADOR_BLOCK_PROVENANCE,
  MIRADOR_SELECTOR_VIEW_BOX,
  type MiradorBlockDefinition,
  type MiradorBlockNumber,
} from './mirador-block-data';
import {
  MIRADOR_FLOOR_SCHEMES,
  type MiradorFloorScheme,
  type MiradorFloorSchemeZone,
} from './mirador-floor-scheme-data';

export type MiradorExplorerSelection = {
  block: MiradorBlockNumber;
  entrance?: string;
  floor?: number;
  unitKey?: string;
  unitNumber?: string;
};

type MiradorBlockExplorerProps = {
  language: KayanLanguage;
  catalogHref: string;
  onReady?: () => void;
  onLead?: (selection: MiradorExplorerSelection) => void;
  onBlockSelect?: (block: MiradorBlockNumber | null) => void;
  onSelectionChange?: (selection: MiradorExplorerSelection | null) => void;
  variant?: 'section' | 'hero';
};

type PanState = {
  overflow: boolean;
  canBack: boolean;
  canForward: boolean;
};

type FocusableBlockControl = HTMLElement | SVGGElement;
type FocusableUnitControl = HTMLButtonElement;

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

const copy = {
  ru: {
    kicker: 'ВЫБОР БЛОКА · MIRADOR',
    title: 'Семь городских объёмов.',
    accent: 'Один панорамный адрес.',
    lead: 'Наведите курсор или перейдите к зоне с клавиатуры. Нажатие фиксирует один из семи визуальных блоков.',
    imageAlt: 'Панорамный рендер жилого комплекса Mirador с семью интерактивными блоками',
    panorama: 'Панорамный выбор визуальных блоков Mirador',
    panoramaHelp: 'Панораму можно прокручивать пальцем, трекпадом, стрелками, клавишами Home и End или отдельными кнопками.',
    panControls: 'Управление панорамой',
    panBack: 'Прокрутить панораму влево',
    panForward: 'Прокрутить панораму вправо',
    swipe: 'Листайте панораму вбок',
    fallbackTitle: 'Блоки 1–7',
    fallbackLead: 'Доступный список повторяет зоны на рендере.',
    fallbackLabel: 'Выбор визуального блока',
    block: 'Блок',
    selected: 'Выбран',
    select: 'Выбрать',
    selectInstruction: 'Нажмите, чтобы выбрать блок.',
    selectedKicker: 'ВИЗУАЛЬНЫЙ НОМЕР',
    selectedTitle: 'Выбран блок',
    selectedCopy: 'Выбор сохранён в этой сцене. Перейдите в официальный каталог, чтобы выбрать квартиру.',
    emptyTitle: 'Выберите блок на панораме',
    emptyCopy: 'После выбора здесь появится компактная карточка и переход к квартирам.',
    availability: 'Общее наличие проекта',
    availableOf: 'доступно из',
    mappingNotice: 'Связь визуальных блоков 1–7 с подъездами 1–3 официального каталога не подтверждена, поэтому выбор не фильтрует квартиры.',
    catalogue: 'Открыть каталог квартир',
    request: 'Получить консультацию',
    clear: 'Сбросить выбор',
    flowLabel: 'Выбор квартиры по плану этажа',
    blockStep: 'Блок',
    floorStep: 'Этаж',
    apartmentStep: 'Квартира',
    floorKicker: 'ШАГ 02 · ЭТАЖ',
    floorTitle: 'Выберите этаж',
    floorChoiceLabel: 'Доступные этажи Mirador',
    floorButton: 'Этаж',
    floorUnavailable: 'Официальные схемы этажей сейчас недоступны. Перейдите в каталог квартир.',
    floorSource: 'Визуальный блок остаётся контекстом выбора. KAYAN не публикует его связь с подъездом, поэтому подъезд выбирается отдельно.',
    entranceTitle: 'Выберите подъезд',
    entranceChoiceLabel: 'Подъезды со схемой на этом этаже',
    entranceHint: 'Официальные схемы KAYAN сгруппированы по подъездам.',
    planKicker: 'ШАГ 03 · КВАРТИРА',
    planTitle: 'План этажа',
    planImageAlt: 'Официальная схема этажа Mirador',
    planLabel: 'Выбор квартиры на официальной схеме этажа',
    entrance: 'Подъезд',
    chooseUnit: 'Выбрать квартиру',
    selectedUnit: 'Выбрана квартира',
    unitSelectedStatus: 'Квартира выбрана на схеме. Можно открыть её в каталоге.',
    openUnit: 'Открыть квартиру в каталоге',
    backToPlan: 'Назад к схеме',
    backToFloors: 'Назад к этажам',
    backToBlocks: 'Назад к блокам',
  },
  uz: {
    kicker: 'BLOK TANLOVI · MIRADOR',
    title: 'Yettita shahar hajmi.',
    accent: 'Bitta panoramali manzil.',
    lead: 'Kursorni zona ustiga olib boring yoki klaviatura bilan o‘ting. Bosish yettita vizual blokdan birini tanlaydi.',
    imageAlt: 'Mirador turar joy majmuasining yettita interaktiv blokli panorama renderi',
    panorama: 'Mirador vizual bloklarini panoramada tanlash',
    panoramaHelp: 'Panoramani barmoq, trekpad, strelkalar, Home va End tugmalari yoki alohida boshqaruv tugmalari bilan surish mumkin.',
    panControls: 'Panoramani boshqarish',
    panBack: 'Panoramani chapga surish',
    panForward: 'Panoramani o‘ngga surish',
    swipe: 'Panoramani yon tomonga suring',
    fallbackTitle: '1–7 bloklar',
    fallbackLead: 'Qulay tugmalar ro‘yxati renderdagi zonalarni takrorlaydi.',
    fallbackLabel: 'Vizual blokni tanlash',
    block: 'Blok',
    selected: 'Tanlangan',
    select: 'Tanlash',
    selectInstruction: 'Blokni tanlash uchun bosing.',
    selectedKicker: 'VIZUAL RAQAM',
    selectedTitle: 'Tanlangan blok',
    selectedCopy: 'Tanlov ushbu sahnada saqlandi. Xonadon tanlash uchun rasmiy katalogga o‘ting.',
    emptyTitle: 'Panoramada blokni tanlang',
    emptyCopy: 'Tanlovdan so‘ng bu yerda ixcham karta va xonadonlarga o‘tish havolasi paydo bo‘ladi.',
    availability: 'Loyihadagi umumiy mavjudlik',
    availableOf: 'mavjud, jami',
    mappingNotice: '1–7 vizual bloklarning rasmiy katalogdagi 1–3 kirishlar bilan bog‘liqligi tasdiqlanmagan, shu sabab tanlov xonadonlarni filtrlamaydi.',
    catalogue: 'Xonadonlar katalogini ochish',
    request: 'Maslahat olish',
    clear: 'Tanlovni bekor qilish',
    flowLabel: 'Qavat rejasi orqali xonadon tanlash',
    blockStep: 'Blok',
    floorStep: 'Qavat',
    apartmentStep: 'Xonadon',
    floorKicker: '02-QADAM · QAVAT',
    floorTitle: 'Qavatni tanlang',
    floorChoiceLabel: 'Miradordagi mavjud qavatlar',
    floorButton: 'Qavat',
    floorUnavailable: 'Rasmiy qavat sxemalari hozircha mavjud emas. Xonadonlar katalogiga o‘ting.',
    floorSource: 'Vizual blok tanlov konteksti bo‘lib qoladi. KAYAN uning kirish bilan bog‘liqligini e’lon qilmagan, shu sabab kirish alohida tanlanadi.',
    entranceTitle: 'Kirishni tanlang',
    entranceChoiceLabel: 'Ushbu qavatda rasmiy sxemasi mavjud kirishlar',
    entranceHint: 'KAYAN rasmiy sxemalari kirishlar bo‘yicha guruhlangan.',
    planKicker: '03-QADAM · XONADON',
    planTitle: 'Qavat rejasi',
    planImageAlt: 'Mirador qavatining rasmiy sxemasi',
    planLabel: 'Rasmiy qavat sxemasida xonadon tanlash',
    entrance: 'Kirish',
    chooseUnit: 'Xonadonni tanlash',
    selectedUnit: 'Tanlangan xonadon',
    unitSelectedStatus: 'Xonadon sxemada tanlandi. Uni katalogda ochish mumkin.',
    openUnit: 'Xonadonni katalogda ochish',
    backToPlan: 'Sxemaga qaytish',
    backToFloors: 'Qavatlarga qaytish',
    backToBlocks: 'Bloklarga qaytish',
  },
  en: {
    kicker: 'BLOCK SELECTION · MIRADOR',
    title: 'Seven urban volumes.',
    accent: 'One panoramic address.',
    lead: 'Hover over a zone or reach it with the keyboard. Pressing selects one of the seven visual blocks.',
    imageAlt: 'Panoramic render of Mirador with seven interactive visual blocks',
    panorama: 'Panoramic selection of Mirador visual blocks',
    panoramaHelp: 'Pan the scene with touch, a trackpad, the arrow keys, Home and End, or the dedicated controls.',
    panControls: 'Panorama controls',
    panBack: 'Pan the panorama left',
    panForward: 'Pan the panorama right',
    swipe: 'Swipe the panorama sideways',
    fallbackTitle: 'Blocks 1–7',
    fallbackLead: 'The accessible button list mirrors the zones on the render.',
    fallbackLabel: 'Choose a visual block',
    block: 'Block',
    selected: 'Selected',
    select: 'Select',
    selectInstruction: 'Press to select this block.',
    selectedKicker: 'VISUAL NUMBER',
    selectedTitle: 'Selected block',
    selectedCopy: 'The choice is fixed in this scene. Continue to the official catalogue to choose an apartment.',
    emptyTitle: 'Choose a block on the panorama',
    emptyCopy: 'A compact card and the route to the apartments will appear here after selection.',
    availability: 'Overall project availability',
    availableOf: 'available out of',
    mappingNotice: 'Visual blocks 1–7 have no confirmed association with catalogue entrances 1–3, so this choice does not filter apartments.',
    catalogue: 'Open the apartment catalogue',
    request: 'Request a consultation',
    clear: 'Clear selection',
    flowLabel: 'Choose an apartment from a floor plan',
    blockStep: 'Block',
    floorStep: 'Floor',
    apartmentStep: 'Apartment',
    floorKicker: 'STEP 02 · FLOOR',
    floorTitle: 'Choose a floor',
    floorChoiceLabel: 'Available Mirador floors',
    floorButton: 'Floor',
    floorUnavailable: 'Official floor schemes are currently unavailable. Continue to the apartment catalogue.',
    floorSource: 'The visual block remains selection context. KAYAN does not publish a block-to-entrance association, so the entrance is chosen separately.',
    entranceTitle: 'Choose an entrance',
    entranceChoiceLabel: 'Entrances with an official scheme on this floor',
    entranceHint: 'Official KAYAN schemes are grouped by entrance.',
    planKicker: 'STEP 03 · APARTMENT',
    planTitle: 'Floor plan',
    planImageAlt: 'Official Mirador floor scheme',
    planLabel: 'Choose an apartment on the official floor scheme',
    entrance: 'Entrance',
    chooseUnit: 'Choose apartment',
    selectedUnit: 'Selected apartment',
    unitSelectedStatus: 'The apartment is selected on the scheme. You can open it in the catalogue.',
    openUnit: 'Open apartment in catalogue',
    backToPlan: 'Back to the scheme',
    backToFloors: 'Back to floors',
    backToBlocks: 'Back to blocks',
  },
} as const;

function blockTooltipId(block: MiradorBlockNumber) {
  return `mirador-block-tooltip-${block}`;
}

function floorSchemeKey(scheme: MiradorFloorScheme) {
  return `${scheme.entrance}\u001f${scheme.floor}`;
}

function unitCatalogHref(catalogHref: string, scheme: MiradorFloorScheme, unitNumber: string) {
  const localBase = 'https://mirador.local';
  const url = new URL(catalogHref, localBase);
  url.searchParams.set('entrance', scheme.entrance);
  url.searchParams.set('floor', String(scheme.floor));
  url.searchParams.set('unit', unitNumber);
  return url.origin === localBase ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

export function MiradorBlockExplorer({
  language,
  catalogHref,
  onReady,
  onLead,
  onBlockSelect,
  onSelectionChange,
  variant = 'section',
}: MiradorBlockExplorerProps) {
  const t = copy[language];
  const idPrefix = useId();
  const selectionCardId = `${idPrefix}-selection-card`;
  const panoramaHelpId = `${idPrefix}-panorama-help`;
  const floorPlanPanelId = `${idPrefix}-floor-plan-panel`;
  const selectedUnitPanelId = `${idPrefix}-selected-unit`;
  const viewportRef = useRef<HTMLDivElement>(null);
  const floorHeadingRef = useRef<HTMLHeadingElement>(null);
  const planHeadingRef = useRef<HTMLHeadingElement>(null);
  const unitHeadingRef = useRef<HTMLHeadingElement>(null);
  const lastControlRef = useRef<FocusableBlockControl | null>(null);
  const lastFloorControlRef = useRef<HTMLButtonElement | null>(null);
  const lastFloorRef = useRef<number | null>(null);
  const lastEntranceControlRef = useRef<HTMLButtonElement | null>(null);
  const lastHotspotRef = useRef<FocusableUnitControl | null>(null);
  const initialPanSetRef = useRef(false);
  const parentCallbacksRef = useRef({ onBlockSelect, onSelectionChange });
  const [desktopFlowEnabled, setDesktopFlowEnabled] = useState(false);
  const [renderReady, setRenderReady] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<MiradorBlockNumber | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<MiradorBlockNumber | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<MiradorBlockNumber | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [selectedEntrance, setSelectedEntrance] = useState<string | null>(null);
  const [selectedUnitNumber, setSelectedUnitNumber] = useState<string | null>(null);
  const [hoveredUnitNumber, setHoveredUnitNumber] = useState<string | null>(null);
  const [panState, setPanState] = useState<PanState>({ overflow: false, canBack: false, canForward: false });
  const previewBlock = focusedBlock ?? hoveredBlock ?? selectedBlock;
  const selectedDefinition = useMemo(
    () => MIRADOR_BLOCKS.find((block) => block.number === selectedBlock),
    [selectedBlock],
  );
  const availableFloors = useMemo(
    () => [...new Set(MIRADOR_FLOOR_SCHEMES.map((scheme) => scheme.floor))]
      .sort((left, right) => right - left),
    [],
  );
  const selectedFloorSchemes = useMemo(
    () => selectedBlock === null || selectedFloor === null
      ? []
      : MIRADOR_FLOOR_SCHEMES
        .filter((scheme) => scheme.floor === selectedFloor)
        .sort((a, b) => a.entrance.localeCompare(b.entrance, undefined, { numeric: true })),
    [selectedBlock, selectedFloor],
  );
  const selectedFloorScheme = useMemo(
    () => selectedEntrance === null
      ? null
      : selectedFloorSchemes.find((scheme) => scheme.entrance === selectedEntrance) ?? null,
    [selectedEntrance, selectedFloorSchemes],
  );
  const selectedUnitZone = useMemo(
    () => selectedUnitNumber === null || selectedFloorScheme === null
      ? null
      : selectedFloorScheme.zones.find((zone) => zone.unitNumber === selectedUnitNumber) ?? null,
    [selectedFloorScheme, selectedUnitNumber],
  );

  useEffect(() => {
    parentCallbacksRef.current = { onBlockSelect, onSelectionChange };
  }, [onBlockSelect, onSelectionChange]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
      setDesktopFlowEnabled(media.matches);
      if (media.matches) return;
      setHoveredBlock(null);
      setFocusedBlock(null);
      setSelectedBlock(null);
      setSelectedFloor(null);
      setSelectedEntrance(null);
      setSelectedUnitNumber(null);
      setHoveredUnitNumber(null);
      setPanState({ overflow: false, canBack: false, canForward: false });
      lastControlRef.current = null;
      lastFloorControlRef.current = null;
      lastFloorRef.current = null;
      lastEntranceControlRef.current = null;
      lastHotspotRef.current = null;
      initialPanSetRef.current = false;
      parentCallbacksRef.current.onBlockSelect?.(null);
      parentCallbacksRef.current.onSelectionChange?.(null);
    };
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      if (!media.matches) {
        parentCallbacksRef.current.onBlockSelect?.(null);
        parentCallbacksRef.current.onSelectionChange?.(null);
      }
    };
  }, []);

  const updatePanState = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const overflow = max > 2;
    let left = viewport.scrollLeft;
    if (overflow && !initialPanSetRef.current && left <= 1) {
      left = Math.round(max * 0.5);
      viewport.scrollLeft = left;
      initialPanSetRef.current = true;
    }
    const next = {
      overflow,
      canBack: overflow && left > 2,
      canForward: overflow && left < max - 2,
    };
    setPanState((current) => (
      current.overflow === next.overflow
      && current.canBack === next.canBack
      && current.canForward === next.canForward
        ? current
        : next
    ));
  }, []);

  useEffect(() => {
    if (!desktopFlowEnabled) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const frame = window.requestAnimationFrame(updatePanState);
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePanState);
    resizeObserver?.observe(viewport);
    window.addEventListener('resize', updatePanState, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updatePanState);
    };
  }, [desktopFlowEnabled, updatePanState]);

  const scrollBehavior = () => (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' as const : 'smooth' as const
  );

  const pan = (direction: -1 | 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({
      left: direction * Math.max(240, viewport.clientWidth * 0.72),
      behavior: scrollBehavior(),
    });
  };

  const panToEdge = (edge: 'start' | 'end') => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo({ left: edge === 'start' ? 0 : viewport.scrollWidth, behavior: scrollBehavior() });
  };

  const handlePanKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      pan(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      panToEdge(event.key === 'Home' ? 'start' : 'end');
    }
  };

  const activateBlock = (
    block: MiradorBlockDefinition,
    control: FocusableBlockControl,
  ) => {
    lastControlRef.current = control;
    setSelectedBlock(block.number);
    setSelectedFloor(null);
    setSelectedEntrance(null);
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    lastFloorControlRef.current = null;
    lastFloorRef.current = null;
    lastEntranceControlRef.current = null;
    lastHotspotRef.current = null;
    onBlockSelect?.(block.number);
    onSelectionChange?.({ block: block.number });
    window.requestAnimationFrame(() => floorHeadingRef.current?.focus({ preventScroll: true }));
  };

  const returnToBlocks = () => {
    setSelectedBlock(null);
    setSelectedFloor(null);
    setSelectedEntrance(null);
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    setHoveredBlock(null);
    setFocusedBlock(null);
    lastFloorControlRef.current = null;
    lastFloorRef.current = null;
    lastEntranceControlRef.current = null;
    lastHotspotRef.current = null;
    onBlockSelect?.(null);
    onSelectionChange?.(null);
    window.requestAnimationFrame(() => lastControlRef.current?.focus({ preventScroll: true }));
  };

  const activateFloor = (floor: number, control: HTMLButtonElement) => {
    const schemes = MIRADOR_FLOOR_SCHEMES
      .filter((scheme) => scheme.floor === floor)
      .sort((left, right) => left.entrance.localeCompare(right.entrance, undefined, { numeric: true }));
    const defaultScheme = schemes[0];
    if (!defaultScheme || selectedBlock === null) return;
    lastFloorControlRef.current = control;
    lastFloorRef.current = floor;
    lastEntranceControlRef.current = null;
    lastHotspotRef.current = null;
    setSelectedFloor(floor);
    setSelectedEntrance(defaultScheme.entrance);
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    onSelectionChange?.({ block: selectedBlock, entrance: defaultScheme.entrance, floor });
    window.requestAnimationFrame(() => planHeadingRef.current?.focus({ preventScroll: true }));
  };

  const activateEntrance = (scheme: MiradorFloorScheme, control: HTMLButtonElement) => {
    if (selectedBlock === null) return;
    lastEntranceControlRef.current = control;
    lastHotspotRef.current = null;
    setSelectedEntrance(scheme.entrance);
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    onSelectionChange?.({ block: selectedBlock, entrance: scheme.entrance, floor: scheme.floor });
    window.requestAnimationFrame(() => planHeadingRef.current?.focus({ preventScroll: true }));
  };

  const returnToFloors = () => {
    setSelectedFloor(null);
    setSelectedEntrance(null);
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    lastEntranceControlRef.current = null;
    lastHotspotRef.current = null;
    if (selectedDefinition) onSelectionChange?.({ block: selectedDefinition.number });
    window.requestAnimationFrame(() => lastFloorControlRef.current?.focus({ preventScroll: true }));
  };

  const activateUnit = (zone: MiradorFloorSchemeZone, control: FocusableUnitControl) => {
    lastHotspotRef.current = control;
    setSelectedUnitNumber(zone.unitNumber);
    if (selectedFloorScheme && selectedBlock !== null) onSelectionChange?.({
      block: selectedBlock,
      entrance: selectedFloorScheme.entrance,
      floor: selectedFloorScheme.floor,
      unitKey: zone.unitKey ?? undefined,
      unitNumber: zone.unitNumber,
    });
    window.requestAnimationFrame(() => unitHeadingRef.current?.focus({ preventScroll: true }));
  };

  const returnToPlan = () => {
    setSelectedUnitNumber(null);
    setHoveredUnitNumber(null);
    if (selectedFloorScheme && selectedBlock !== null) onSelectionChange?.({
      block: selectedBlock,
      entrance: selectedFloorScheme.entrance,
      floor: selectedFloorScheme.floor,
    });
    window.requestAnimationFrame(() => lastHotspotRef.current?.focus({ preventScroll: true }));
  };

  const handlePointerDown = (event: ReactPointerEvent<FocusableBlockControl>) => {
    lastControlRef.current = event.currentTarget;
  };

  const handleControlClick = (
    block: MiradorBlockDefinition,
    event: ReactMouseEvent<FocusableBlockControl>,
  ) => {
    activateBlock(block, event.currentTarget);
  };

  const handleSvgKeyDown = (
    block: MiradorBlockDefinition,
    event: ReactKeyboardEvent<SVGGElement>,
  ) => {
    if ((event.key !== 'Enter' && event.key !== ' ') || event.repeat) return;
    event.preventDefault();
    activateBlock(block, event.currentTarget);
  };

  const handleExplorerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || selectedBlock === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (selectedUnitNumber !== null) returnToPlan();
    else if (selectedFloorScheme !== null) returnToFloors();
    else returnToBlocks();
  };

  const ariaLabelForBlock = (block: MiradorBlockDefinition) => {
    const state = selectedBlock === block.number ? `${t.selected}. ` : '';
    return `${t.block} ${block.number}. ${state}${t.selectInstruction}`;
  };

  const ariaLabelForUnit = (zone: MiradorFloorSchemeZone) => {
    const state = selectedUnitNumber === zone.unitNumber ? `${t.selectedUnit}. ` : '';
    return `${t.chooseUnit} ${zone.unitNumber}. ${state}`;
  };

  if (!desktopFlowEnabled) return null;

  return (
    <section className={`mirador-block-explorer mirador-block-explorer--${variant}${variant === 'hero' && renderReady ? ' is-render-ready' : ''}`} aria-labelledby="mirador-block-explorer-title" onKeyDown={handleExplorerKeyDown}>
      {variant === 'section' ? (
        <header className="mirador-block-explorer__heading" data-reveal>
          <p>{t.kicker}</p>
          <h2 id="mirador-block-explorer-title">{t.title}<br /><em>{t.accent}</em></h2>
          <span>{t.lead}</span>
        </header>
      ) : <h2 id="mirador-block-explorer-title" className="mirador-block-explorer__sr-only">{t.panorama}</h2>}

      <div className="mirador-block-explorer__stage" data-reveal={variant === 'section' ? '' : undefined}>
        <div className="mirador-block-explorer__stagebar">
          <span>{MIRADOR_BLOCK_PROVENANCE.render.dimensions} · BLOCKS 01–07</span>
          <div className="mirador-block-explorer__pan-controls" role="group" aria-label={t.panControls}>
            <small>{panState.overflow ? t.swipe : t.panorama}</small>
            <button type="button" disabled={!panState.canBack} onClick={() => pan(-1)} aria-label={t.panBack}>←</button>
            <button type="button" disabled={!panState.canForward} onClick={() => pan(1)} aria-label={t.panForward}>→</button>
          </div>
        </div>

        <div
          ref={viewportRef}
          className="mirador-block-explorer__viewport"
          data-lenis-prevent
          tabIndex={0}
          aria-label={t.panorama}
          aria-describedby={panoramaHelpId}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          onScroll={updatePanState}
          onKeyDown={handlePanKeyDown}
        >
          <div className="mirador-block-explorer__canvas">
            <img
              src={`${appBasePath}${MIRADOR_BLOCK_PROVENANCE.render.publicPath}`}
              width={MIRADOR_SELECTOR_VIEW_BOX.width}
              height={MIRADOR_SELECTOR_VIEW_BOX.height}
              alt={t.imageAlt}
              loading={variant === 'hero' ? 'eager' : 'lazy'}
              fetchPriority={variant === 'hero' ? 'high' : 'auto'}
              decoding="async"
              draggable={false}
              onLoad={() => {
                if (variant !== 'hero') return;
                setRenderReady(true);
                onReady?.();
              }}
            />
            <div className="mirador-block-explorer__shade" aria-hidden="true" />
            <svg
              className="mirador-block-explorer__map"
              viewBox={MIRADOR_SELECTOR_VIEW_BOX.value}
              preserveAspectRatio="none"
              role="group"
              aria-label={t.fallbackLabel}
            >
              {MIRADOR_BLOCKS.map((block) => {
                const selected = selectedBlock === block.number;
                const active = previewBlock === block.number;
                return (
                  <g
                    key={block.number}
                    className={`mirador-block-zone ${selected ? 'is-selected' : ''} ${active ? 'is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={ariaLabelForBlock(block)}
                    aria-pressed={selected}
                    aria-controls={selectionCardId}
                    aria-describedby={`${panoramaHelpId} ${blockTooltipId(block.number)}`}
                    aria-keyshortcuts="Enter Space Escape"
                    onPointerDown={handlePointerDown}
                    onMouseEnter={() => setHoveredBlock(block.number)}
                    onMouseLeave={() => setHoveredBlock((current) => current === block.number ? null : current)}
                    onFocus={(event) => {
                      lastControlRef.current = event.currentTarget;
                      setFocusedBlock(block.number);
                    }}
                    onBlur={() => setFocusedBlock((current) => current === block.number ? null : current)}
                    onClick={(event) => handleControlClick(block, event)}
                    onKeyDown={(event) => handleSvgKeyDown(block, event)}
                  >
                    <title>{`${t.block} ${block.number}`}</title>
                    {block.pathIds.map((pathId) => <path key={pathId} d={getMiradorMaskPath(pathId).d} />)}
                  </g>
                );
              })}
            </svg>

            {MIRADOR_BLOCKS.map((block) => (
              <div
                id={blockTooltipId(block.number)}
                role="tooltip"
                key={block.number}
                className={`mirador-block-tooltip ${previewBlock === block.number ? 'is-visible' : ''} ${selectedBlock === block.number ? 'is-selected' : ''}`}
                style={{
                  '--mirador-block-x': `${(block.tooltip.x / MIRADOR_SELECTOR_VIEW_BOX.width) * 100}%`,
                  '--mirador-block-y': `${(block.tooltip.y / MIRADOR_SELECTOR_VIEW_BOX.height) * 100}%`,
                } as CSSProperties}
              >
                <small>{selectedBlock === block.number ? t.selected : t.select}</small>
                <strong>{t.block} {block.number}</strong>
              </div>
            ))}
          </div>
        </div>
        <p id={panoramaHelpId} className="mirador-block-explorer__help">{t.panoramaHelp}</p>
      </div>

      <div className="mirador-block-explorer__selection" data-reveal={variant === 'section' ? '' : undefined}>
        <div className="mirador-block-explorer__fallback">
          <header><p>{t.fallbackTitle}</p><span>{t.fallbackLead}</span></header>
          <div role="group" aria-label={t.fallbackLabel}>
            {MIRADOR_BLOCKS.map((block) => {
              const selected = selectedBlock === block.number;
              return (
                <button
                  type="button"
                  key={block.number}
                  className={selected ? 'is-selected' : ''}
                  aria-label={ariaLabelForBlock(block)}
                  aria-pressed={selected}
                  aria-controls={selectionCardId}
                  onPointerDown={handlePointerDown}
                  onMouseEnter={() => setHoveredBlock(block.number)}
                  onMouseLeave={() => setHoveredBlock((current) => current === block.number ? null : current)}
                  onFocus={(event) => {
                    lastControlRef.current = event.currentTarget;
                    setFocusedBlock(block.number);
                  }}
                  onBlur={() => setFocusedBlock((current) => current === block.number ? null : current)}
                  onClick={(event) => handleControlClick(block, event)}
                >
                  <small>0{block.number}</small>
                  <strong>{t.block} {block.number}</strong>
                  <span aria-hidden="true">↗</span>
                </button>
              );
            })}
          </div>
        </div>

        <aside
          id={selectionCardId}
          className={`mirador-block-card ${selectedDefinition ? 'has-selection' : ''} ${selectedFloorScheme ? 'has-floor-plan' : ''}`}
          data-lenis-prevent
        >
          {selectedDefinition ? (
            <>
              <div className="mirador-block-card__number" aria-hidden="true">0{selectedDefinition.number}</div>
              <ol className="mirador-block-flow" aria-label={t.flowLabel}>
                <li className="is-complete"><small>01</small><span>{t.blockStep} {selectedDefinition.number}</span></li>
                <li className={selectedFloor === null ? 'is-current' : 'is-complete'} aria-current={selectedFloor === null ? 'step' : undefined}><small>02</small><span>{t.floorStep}{selectedFloor === null ? '' : ` ${selectedFloor}`}</span></li>
                <li className={selectedFloorScheme ? 'is-current' : ''} aria-current={selectedFloorScheme ? 'step' : undefined}><small>03</small><span>{t.apartmentStep}{selectedUnitZone ? ` ${selectedUnitZone.unitNumber}` : ''}</span></li>
              </ol>

              {selectedFloorScheme ? (
                <>
                  <p>{t.planKicker}</p>
                  <h3 ref={planHeadingRef} tabIndex={-1}>{t.planTitle} {selectedFloorScheme.floor}</h3>
                </>
              ) : (
                <>
                  <p>{t.floorKicker}</p>
                  <h3 ref={floorHeadingRef} tabIndex={-1}>{t.floorTitle}</h3>
                </>
              )}

              <small className="mirador-block-card__source">{t.floorSource}</small>

              {selectedFloorScheme ? null : availableFloors.length ? (
                <div className="mirador-floor-picker" role="group" aria-label={t.floorChoiceLabel}>
                  {availableFloors.map((floor) => {
                    const selected = selectedFloor === floor;
                    return (
                      <button
                        key={floor}
                        ref={(node) => {
                          if (node && lastFloorRef.current === floor) lastFloorControlRef.current = node;
                        }}
                        type="button"
                        className={selected ? 'is-selected' : ''}
                        aria-label={`${t.floorButton} ${floor}`}
                        aria-pressed={selected}
                        aria-controls={floorPlanPanelId}
                        onClick={(event) => activateFloor(floor, event.currentTarget)}
                      >
                        <small>{t.floorButton}</small>
                        <strong>{floor}</strong>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="mirador-block-flow__locked" role="status">
                  <p>{t.floorUnavailable}</p>
                  <small>{t.floorSource}</small>
                </div>
              )}

              {selectedFloorScheme ? (
                <div id={floorPlanPanelId} className="mirador-floor-plan">
                  <div className="mirador-entrance-picker">
                    <header>
                      <strong>{t.entranceTitle}</strong>
                      <small>{t.entranceHint}</small>
                    </header>
                    <div role="group" aria-label={t.entranceChoiceLabel}>
                      {selectedFloorSchemes.map((scheme) => {
                        const selected = scheme.entrance === selectedEntrance;
                        return (
                          <button
                            key={floorSchemeKey(scheme)}
                            ref={(node) => {
                              if (selected && node) lastEntranceControlRef.current = node;
                            }}
                            type="button"
                            className={selected ? 'is-selected' : ''}
                            aria-label={`${t.entrance} ${scheme.entrance}`}
                            aria-pressed={selected}
                            aria-controls={`${floorPlanPanelId}-scheme`}
                            onClick={(event) => activateEntrance(scheme, event.currentTarget)}
                          >
                            {t.entrance} {scheme.entrance}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mirador-floor-plan__meta">
                    <span>{t.block} {selectedDefinition.number}</span>
                    <span>{t.entrance} {selectedFloorScheme.entrance}</span>
                    <span>{t.floorButton} {selectedFloorScheme.floor}</span>
                  </div>
                  <figure
                    id={`${floorPlanPanelId}-scheme`}
                    className="mirador-floor-plan__figure"
                    style={{ aspectRatio: `${selectedFloorScheme.width} / ${selectedFloorScheme.height}` }}
                  >
                    <img
                      src={`${appBasePath}${selectedFloorScheme.imageUrl}`}
                      width={selectedFloorScheme.width}
                      height={selectedFloorScheme.height}
                      alt={`${t.planImageAlt}: ${t.entrance.toLocaleLowerCase(language)} ${selectedFloorScheme.entrance}, ${t.floorButton.toLocaleLowerCase(language)} ${selectedFloorScheme.floor}`}
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    <svg
                      viewBox={`0 0 ${selectedFloorScheme.width} ${selectedFloorScheme.height}`}
                      preserveAspectRatio="xMidYMid meet"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {selectedFloorScheme.zones.map((zone) => {
                        const selected = selectedUnitNumber === zone.unitNumber;
                        const active = selected || hoveredUnitNumber === zone.unitNumber;
                        return (
                          <polygon
                            key={zone.unitKey ?? `unit-${zone.unitNumber}`}
                            className={`mirador-floor-hotspot__zone ${active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`}
                            points={zone.points}
                          />
                        );
                      })}
                    </svg>
                    <div className="mirador-floor-hotspots" role="group" aria-label={t.planLabel}>
                      {selectedFloorScheme.zones.map((zone) => {
                        const selected = selectedUnitNumber === zone.unitNumber;
                        return (
                          <button
                            key={zone.unitKey ?? `unit-${zone.unitNumber}`}
                            type="button"
                            className={selected ? 'is-selected' : ''}
                            style={{
                              '--mirador-hotspot-x': `${(zone.label.x / selectedFloorScheme.width) * 100}%`,
                              '--mirador-hotspot-y': `${(zone.label.y / selectedFloorScheme.height) * 100}%`,
                            } as CSSProperties}
                            aria-label={ariaLabelForUnit(zone)}
                            aria-pressed={selected}
                            aria-controls={selectedUnitPanelId}
                            aria-keyshortcuts="Enter Space Escape"
                            onPointerDown={(event) => { lastHotspotRef.current = event.currentTarget; }}
                            onPointerEnter={() => setHoveredUnitNumber(zone.unitNumber)}
                            onPointerLeave={() => setHoveredUnitNumber((current) => current === zone.unitNumber ? null : current)}
                            onFocus={(event) => {
                              lastHotspotRef.current = event.currentTarget;
                              setHoveredUnitNumber(zone.unitNumber);
                            }}
                            onBlur={() => setHoveredUnitNumber((current) => current === zone.unitNumber ? null : current)}
                            onClick={(event) => activateUnit(zone, event.currentTarget)}
                          >
                            <span>{zone.unitNumber}</span>
                          </button>
                        );
                      })}
                    </div>
                  </figure>

                  <div className="mirador-floor-plan__fallback" role="group" aria-label={t.planLabel}>
                    {selectedFloorScheme.zones.map((zone) => {
                      const selected = selectedUnitNumber === zone.unitNumber;
                      return (
                        <button
                          key={zone.unitKey ?? `unit-${zone.unitNumber}`}
                          type="button"
                          className={selected ? 'is-selected' : ''}
                          aria-label={ariaLabelForUnit(zone)}
                          aria-pressed={selected}
                          aria-controls={selectedUnitPanelId}
                          onClick={(event) => activateUnit(zone, event.currentTarget)}
                        >
                          №{zone.unitNumber}
                        </button>
                      );
                    })}
                  </div>

                  <div id={selectedUnitPanelId} className={`mirador-floor-plan__unit ${selectedUnitZone ? 'has-selection' : ''}`} aria-live="polite" aria-atomic="true">
                    {selectedUnitZone ? (
                      <>
                        <h4 ref={unitHeadingRef} tabIndex={-1}>{t.selectedUnit} №{selectedUnitZone.unitNumber}</h4>
                        <p>{t.unitSelectedStatus}</p>
                        <div>
                          <a href={unitCatalogHref(catalogHref, selectedFloorScheme, selectedUnitZone.unitNumber)}>{t.openUnit}<b aria-hidden="true">↗</b></a>
                          <button type="button" onClick={returnToPlan}>{t.backToPlan}</button>
                        </div>
                      </>
                    ) : <p>{t.planLabel}</p>}
                  </div>

                  <div className="mirador-block-card__actions">
                    {onLead ? (
                      <button
                        type="button"
                        onClick={() => onLead({
                          block: selectedDefinition.number,
                          entrance: selectedFloorScheme.entrance,
                          floor: selectedFloorScheme.floor,
                          unitKey: selectedUnitZone?.unitKey ?? undefined,
                          unitNumber: selectedUnitZone?.unitNumber,
                        })}
                      >
                        {t.request}<b aria-hidden="true">↗</b>
                      </button>
                    ) : null}
                    <button className="mirador-block-card__clear" type="button" onClick={returnToFloors}>{t.backToFloors}</button>
                  </div>
                </div>
              ) : (
                <>
                  {availableFloors.length ? <div id={floorPlanPanelId} className="mirador-block-explorer__sr-only" role="status">{t.floorTitle}</div> : null}
                  <div className="mirador-block-card__actions">
                    <a href={catalogHref}>{t.catalogue}<b aria-hidden="true">↗</b></a>
                    {onLead ? <button type="button" onClick={() => onLead({ block: selectedDefinition.number })}>{t.request}<b aria-hidden="true">↗</b></button> : null}
                    <button className="mirador-block-card__clear" type="button" onClick={returnToBlocks}>{t.backToBlocks}</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="mirador-block-card__number" aria-hidden="true">01—07</div>
              <p>{t.kicker}</p>
              <h3>{t.emptyTitle}</h3>
              <span>{t.emptyCopy}</span>
              <small className="mirador-block-card__notice">{t.mappingNotice}</small>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
