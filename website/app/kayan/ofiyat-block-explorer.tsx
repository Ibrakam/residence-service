'use client';

/* eslint-disable @next/next/no-img-element */

import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KayanLanguage } from './project-data';
import {
  getOfiyatMaskPath,
  OFIYAT_BLOCKS,
  OFIYAT_BLOCK_PROVENANCE,
  OFIYAT_SELECTOR_VIEW_BOX,
  type OfiyatBlockNumber,
} from './ofiyat-block-data';

export type OfiyatExplorerUnit = {
  sourceKey: string;
  phaseSlug: string;
  status: 'available' | 'reserved' | 'sold' | 'unavailable';
  number: string;
  entrance?: string;
  floor: number;
  area: number;
  rooms?: number;
};

export type OfiyatExplorerSelection = {
  block: OfiyatBlockNumber;
  phaseSlug?: string;
  entrance?: string;
  floor?: number;
  unitKey?: string;
  unitNumber?: string;
};

type Props = {
  language: KayanLanguage;
  catalogHref: string;
  units: OfiyatExplorerUnit[];
  inventoryState: 'idle' | 'loading' | 'ready' | 'error';
  onReady?: () => void;
  onLead?: (selection: OfiyatExplorerSelection) => void;
  onBlockSelect?: (block: OfiyatBlockNumber | null) => void;
  onSelectionChange?: (selection: OfiyatExplorerSelection | null) => void;
};

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
const residentialPhases = ['phase-1', 'phase-2'] as const;
const statusRank = { available: 0, reserved: 1, sold: 2, unavailable: 3 } as const;

const copy = {
  ru: {
    title: 'Выберите визуальный блок',
    blueHour: 'СИНИЙ ЧАС',
    lead: 'Наведите на фасад или используйте кнопки 1–7. Выбор блока сохраняется как контекст и не подменяет официальный подъезд.',
    imageAlt: 'Рендер Ofiyat в синий час с семью интерактивными визуальными блоками',
    canvas: 'Выбор визуального блока Ofiyat на рендере',
    block: 'Блок', selectBlock: 'Выбрать блок', selected: 'Выбран', controls: 'Альтернативный выбор блока',
    chooseFirst: 'Сначала выберите один из семи блоков на фасаде.',
    mapping: 'Официальная связь блока с очередью или подъездом не опубликована. Поэтому следующий выбор выполняется явно.',
    phaseTitle: 'Выберите очередь', phaseLabel: 'Жилые очереди Ofiyat', phaseOne: 'I очередь', phaseTwo: 'II очередь', available: 'свободно',
    entranceTitle: 'Выберите подъезд', entranceLabel: 'Подъезды выбранной очереди', entrance: 'Подъезд',
    floorTitle: 'Выберите этаж', floorLabel: 'Этажи выбранного подъезда', floor: 'Этаж',
    unitsTitle: 'Официальная структура этажа', unitsLabel: 'Квартиры и статусы выбранного этажа',
    fallback: 'KAYAN не публикует для Ofiyat отдельную схему этажа. Ниже показана подтверждённая структура этажа из режима «Помещения» — без выдуманной графики.',
    unit: 'Квартира', area: 'м²', rooms: 'комн.', noRooms: 'тип не указан',
    statuses: { available: 'Свободно', reserved: 'Бронь', sold: 'Продано', unavailable: 'Не продаётся' },
    open: 'Открыть точную квартиру', consult: 'Уточнить условия', parking: 'Перейти к паркингу',
    back: 'Назад', clear: 'Начать заново', source: 'Источник: авторизованная витрина KAYAN · read-only capture 01.09.2026',
    renderLabel: 'Архитектурный рендер', unavailable: 'Для этого выбора нет подтверждённых квартир.',
    imageError: 'Рендер временно недоступен. Используйте доступные кнопки блоков 1–7.',
    inventoryLoading: 'Загружаем подтверждённую структуру квартир…',
    inventoryError: 'Структура квартир временно недоступна. Полный каталог остаётся доступен по ссылке ниже.',
    openCatalog: 'Открыть каталог',
    liveBlock: 'Выбран визуальный блок', livePhase: 'Выбрана очередь', liveEntrance: 'Выбран подъезд', liveFloor: 'Выбран этаж', liveUnit: 'Выбрана квартира',
  },
  uz: {
    title: 'Vizual blokni tanlang',
    blueHour: 'MOVIY SHOM',
    lead: 'Fasad ustiga kursorni olib boring yoki 1–7 tugmalaridan foydalaning. Blok faqat kontekst bo‘lib qoladi va rasmiy kirishni almashtirmaydi.',
    imageAlt: 'Ko‘k shafaq paytidagi Ofiyat renderi va yettita interaktiv vizual blok',
    canvas: 'Ofiyat renderida vizual blokni tanlash',
    block: 'Blok', selectBlock: 'Blokni tanlash', selected: 'Tanlandi', controls: 'Blokni muqobil tanlash',
    chooseFirst: 'Avval fasaddagi yettita blokdan birini tanlang.',
    mapping: 'Blokning bosqich yoki kirish bilan rasmiy bog‘liqligi e’lon qilinmagan. Keyingi tanlovlar alohida bajariladi.',
    phaseTitle: 'Bosqichni tanlang', phaseLabel: 'Ofiyat turar joy bosqichlari', phaseOne: 'I bosqich', phaseTwo: 'II bosqich', available: 'mavjud',
    entranceTitle: 'Kirishni tanlang', entranceLabel: 'Tanlangan bosqich kirishlari', entrance: 'Kirish',
    floorTitle: 'Qavatni tanlang', floorLabel: 'Tanlangan kirish qavatlari', floor: 'Qavat',
    unitsTitle: 'Qavatning rasmiy tuzilmasi', unitsLabel: 'Tanlangan qavatdagi xonadonlar va holatlar',
    fallback: 'KAYAN Ofiyat uchun alohida qavat sxemasini e’lon qilmagan. Quyida «Xonalar» rejimidan tasdiqlangan qavat tuzilmasi ko‘rsatilgan — to‘qib chiqarilgan grafikasiz.',
    unit: 'Xonadon', area: 'm²', rooms: 'xona', noRooms: 'turi ko‘rsatilmagan',
    statuses: { available: 'Mavjud', reserved: 'Band', sold: 'Sotilgan', unavailable: 'Sotuvda emas' },
    open: 'Aniq xonadonni ochish', consult: 'Shartlarni aniqlash', parking: 'Parkingga o‘tish',
    back: 'Orqaga', clear: 'Qayta boshlash', source: 'Manba: KAYAN avtorizatsiyalangan vitrinasining faqat o‘qish capture’i · 01.09.2026',
    renderLabel: 'Arxitektura renderi', unavailable: 'Bu tanlov uchun tasdiqlangan xonadonlar yo‘q.',
    imageError: 'Render hozircha mavjud emas. 1–7 blok tugmalaridan foydalaning.',
    inventoryLoading: 'Tasdiqlangan xonadonlar tuzilmasi yuklanmoqda…',
    inventoryError: 'Xonadonlar tuzilmasi vaqtincha mavjud emas. To‘liq katalog quyidagi havolada ochiladi.',
    openCatalog: 'Katalogni ochish',
    liveBlock: 'Vizual blok tanlandi', livePhase: 'Bosqich tanlandi', liveEntrance: 'Kirish tanlandi', liveFloor: 'Qavat tanlandi', liveUnit: 'Xonadon tanlandi',
  },
  en: {
    title: 'Choose a visual block',
    blueHour: 'BLUE HOUR',
    lead: 'Hover over the façade or use buttons 1–7. The block stays as context and never substitutes an official entrance.',
    imageAlt: 'Blue-hour render of Ofiyat with seven interactive visual blocks',
    canvas: 'Choose a visual block of Ofiyat on the render',
    block: 'Block', selectBlock: 'Choose block', selected: 'Selected', controls: 'Alternative block selection',
    chooseFirst: 'Start by choosing one of the seven blocks on the façade.',
    mapping: 'No official block-to-phase or block-to-entrance association is published, so the next choices are explicit.',
    phaseTitle: 'Choose a phase', phaseLabel: 'Ofiyat residential phases', phaseOne: 'Phase I', phaseTwo: 'Phase II', available: 'available',
    entranceTitle: 'Choose an entrance', entranceLabel: 'Entrances in the selected phase', entrance: 'Entrance',
    floorTitle: 'Choose a floor', floorLabel: 'Floors in the selected entrance', floor: 'Floor',
    unitsTitle: 'Official floor structure', unitsLabel: 'Apartments and statuses on the selected floor',
    fallback: 'KAYAN does not publish a separate Ofiyat floor-plan asset. The confirmed floor structure from “Properties” is shown below, without invented graphics.',
    unit: 'Apartment', area: 'm²', rooms: 'rooms', noRooms: 'type not stated',
    statuses: { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Not for sale' },
    open: 'Open exact apartment', consult: 'Ask about terms', parking: 'Open parking',
    back: 'Back', clear: 'Start again', source: 'Source: authenticated KAYAN storefront · read-only capture 1 Sep 2026',
    renderLabel: 'Architectural render', unavailable: 'No confirmed apartments match this selection.',
    imageError: 'The render is temporarily unavailable. Use the accessible block buttons 1–7.',
    inventoryLoading: 'Loading the confirmed apartment structure…',
    inventoryError: 'The apartment structure is temporarily unavailable. The full catalogue remains available below.',
    openCatalog: 'Open catalogue',
    liveBlock: 'Visual block selected', livePhase: 'Phase selected', liveEntrance: 'Entrance selected', liveFloor: 'Floor selected', liveUnit: 'Apartment selected',
  },
} as const;

function phaseLabel(slug: string, language: KayanLanguage) {
  const t = copy[language];
  return slug === 'phase-1' ? t.phaseOne : t.phaseTwo;
}

function catalogHrefFor(catalogHref: string, selection: OfiyatExplorerSelection) {
  const localOrigin = 'https://ofiyat.local';
  const url = new URL(catalogHref, localOrigin);
  url.searchParams.set('block', String(selection.block));
  if (selection.phaseSlug) url.searchParams.set('phase', selection.phaseSlug);
  if (selection.entrance) url.searchParams.set('entrance', selection.entrance);
  if (selection.floor !== undefined) url.searchParams.set('floor', String(selection.floor));
  if (selection.unitNumber) url.searchParams.set('unit', selection.unitNumber);
  return url.origin === localOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function parkingHref(catalogHref: string) {
  const localOrigin = 'https://ofiyat.local';
  const url = new URL(catalogHref, localOrigin);
  for (const key of ['block', 'entrance', 'floor', 'unit']) url.searchParams.delete(key);
  url.searchParams.set('phase', 'parking');
  return url.origin === localOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
}

function numericUnit(left: OfiyatExplorerUnit, right: OfiyatExplorerUnit) {
  const numeric = Number(left.number) - Number(right.number);
  if (Number.isFinite(numeric) && numeric !== 0) return numeric;
  return left.number.localeCompare(right.number, undefined, { numeric: true });
}

export function OfiyatBlockExplorer({
  language,
  catalogHref,
  units,
  inventoryState,
  onReady,
  onLead,
  onBlockSelect,
  onSelectionChange,
}: Props) {
  const t = copy[language];
  const id = useId();
  const panelId = `${id}-selection-panel`;
  const helpId = `${id}-mapping-help`;
  const [imageReady, setImageReady] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<OfiyatBlockNumber | null>(null);
  const [focusedBlock, setFocusedBlock] = useState<OfiyatBlockNumber | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<OfiyatBlockNumber | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<string | null>(null);
  const [selectedEntrance, setSelectedEntrance] = useState<string | null>(null);
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [selectedUnitKey, setSelectedUnitKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const blockControlRef = useRef<HTMLElement | SVGElement | null>(null);
  const returnFocusRef = useRef<{ choice: string; value: string } | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const activeBlock = focusedBlock ?? hoveredBlock ?? selectedBlock;
  const inventoryMessage = inventoryState === 'error' ? t.inventoryError : t.inventoryLoading;

  const residentialUnits = useMemo(
    () => units.filter((unit) => residentialPhases.includes(unit.phaseSlug as typeof residentialPhases[number])),
    [units],
  );
  const phases = useMemo(() => residentialPhases.map((slug) => ({
    slug,
    available: residentialUnits.filter((unit) => unit.phaseSlug === slug && unit.status === 'available').length,
  })), [residentialUnits]);
  const entrances = useMemo(() => selectedPhase === null ? [] : [...new Set(residentialUnits
    .filter((unit) => unit.phaseSlug === selectedPhase && unit.entrance)
    .map((unit) => unit.entrance as string))].sort((a, b) => a.localeCompare(b, language, { numeric: true })), [language, residentialUnits, selectedPhase]);
  const floors = useMemo(() => selectedPhase === null || selectedEntrance === null ? [] : [...new Set(residentialUnits
    .filter((unit) => unit.phaseSlug === selectedPhase && unit.entrance === selectedEntrance)
    .map((unit) => unit.floor))].sort((a, b) => b - a), [residentialUnits, selectedEntrance, selectedPhase]);
  const floorUnits = useMemo(() => selectedPhase === null || selectedEntrance === null || selectedFloor === null ? [] : residentialUnits
    .filter((unit) => unit.phaseSlug === selectedPhase && unit.entrance === selectedEntrance && unit.floor === selectedFloor)
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || numericUnit(a, b)), [residentialUnits, selectedEntrance, selectedFloor, selectedPhase]);
  const selectedUnit = floorUnits.find((unit) => unit.sourceKey === selectedUnitKey) ?? null;

  const selection = useMemo<OfiyatExplorerSelection | null>(() => selectedBlock === null ? null : ({
    block: selectedBlock,
    phaseSlug: selectedPhase ?? undefined,
    entrance: selectedEntrance ?? undefined,
    floor: selectedFloor ?? undefined,
    unitKey: selectedUnit?.sourceKey,
    unitNumber: selectedUnit?.number,
  }), [selectedBlock, selectedEntrance, selectedFloor, selectedPhase, selectedUnit]);

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [onSelectionChange, selection]);

  useEffect(() => {
    if (imageReady) onReady?.();
  }, [imageReady, onReady]);

  useEffect(() => {
    if (selectedBlock === null) return;
    const frame = window.requestAnimationFrame(() => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target) {
        const choice = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-ofiyat-choice]') ?? [])
          .find((element) => element.dataset.ofiyatChoice === target.choice && element.dataset.ofiyatValue === target.value);
        if (choice) {
          choice.focus({ preventScroll: true });
          return;
        }
      }
      panelHeadingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedBlock, selectedEntrance, selectedFloor, selectedPhase]);

  const selectBlock = (block: OfiyatBlockNumber, control: HTMLElement | SVGElement) => {
    blockControlRef.current = control;
    setSelectedBlock(block);
    setSelectedPhase(null);
    setSelectedEntrance(null);
    setSelectedFloor(null);
    setSelectedUnitKey(null);
    onBlockSelect?.(block);
  };

  const clearAll = () => {
    setSelectedBlock(null);
    setSelectedPhase(null);
    setSelectedEntrance(null);
    setSelectedFloor(null);
    setSelectedUnitKey(null);
    onBlockSelect?.(null);
    window.requestAnimationFrame(() => blockControlRef.current?.focus({ preventScroll: true }));
  };

  const goBack = () => {
    if (selectedUnitKey !== null) {
      const unitKey = selectedUnitKey;
      setSelectedUnitKey(null);
      window.requestAnimationFrame(() => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-ofiyat-choice="unit"]') ?? [])
        .find((element) => element.dataset.ofiyatValue === unitKey)?.focus({ preventScroll: true }));
      return;
    }
    if (selectedFloor !== null) {
      returnFocusRef.current = { choice: 'floor', value: String(selectedFloor) };
      setSelectedFloor(null);
      return;
    }
    if (selectedEntrance !== null) {
      returnFocusRef.current = { choice: 'entrance', value: selectedEntrance };
      setSelectedEntrance(null);
      return;
    }
    if (selectedPhase !== null) {
      returnFocusRef.current = { choice: 'phase', value: selectedPhase };
      setSelectedPhase(null);
      return;
    }
    clearAll();
  };

  const onRootKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || selectedBlock === null) return;
    event.preventDefault();
    event.stopPropagation();
    goBack();
  };

  const onBlockKeyDown = (event: ReactKeyboardEvent<SVGGElement>, block: OfiyatBlockNumber) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectBlock(block, event.currentTarget);
  };

  const liveMessage = selectedUnit
    ? `${t.liveUnit} ${selectedUnit.number}`
    : selectedFloor !== null
      ? `${t.liveFloor} ${selectedFloor}`
      : selectedEntrance !== null
        ? `${t.liveEntrance} ${selectedEntrance}`
        : selectedPhase !== null
          ? `${t.livePhase}: ${phaseLabel(selectedPhase, language)}`
          : selectedBlock !== null
            ? `${t.liveBlock} ${selectedBlock}`
            : '';

  return <div ref={rootRef} className={`ofiyat-explorer ${imageReady ? 'is-ready' : ''}`} onKeyDown={onRootKeyDown}>
    <div className="ofiyat-explorer__canvas" aria-label={t.canvas} aria-describedby={helpId}>
      <img
        className="ofiyat-explorer__image"
        src={`${appBasePath}${OFIYAT_BLOCK_PROVENANCE.render.publicPath}`}
        width={OFIYAT_SELECTOR_VIEW_BOX.width}
        height={OFIYAT_SELECTOR_VIEW_BOX.height}
        alt={t.imageAlt}
        loading="eager"
        fetchPriority="high"
        onLoad={() => setImageReady(true)}
        onError={() => { setImageFailed(true); setImageReady(true); }}
      />
      <div className="ofiyat-explorer__blue-hour" aria-hidden="true" />
      <svg className="ofiyat-explorer__mask" viewBox={OFIYAT_SELECTOR_VIEW_BOX.value} preserveAspectRatio="xMidYMid meet" aria-hidden={imageFailed || undefined}>
        {OFIYAT_BLOCKS.map((block) => <g
          key={block.number}
          role="button"
          tabIndex={imageFailed ? -1 : 0}
          aria-label={`${t.selectBlock} ${block.number}`}
          aria-pressed={selectedBlock === block.number}
          aria-controls={panelId}
          aria-describedby={`${helpId} ${id}-tooltip-${block.number}`}
          data-active={activeBlock === block.number}
          onPointerEnter={() => setHoveredBlock(block.number)}
          onPointerLeave={() => setHoveredBlock(null)}
          onFocus={() => setFocusedBlock(block.number)}
          onBlur={() => setFocusedBlock(null)}
          onClick={(event) => selectBlock(block.number, event.currentTarget)}
          onKeyDown={(event) => onBlockKeyDown(event, block.number)}
        ><path d={getOfiyatMaskPath(block.pathId).d} /></g>)}
      </svg>
      {OFIYAT_BLOCKS.map((block) => <span
        id={`${id}-tooltip-${block.number}`}
        key={block.number}
        className="ofiyat-explorer__tooltip"
        data-visible={activeBlock === block.number}
        style={{ left: `${(block.tooltip.x / OFIYAT_SELECTOR_VIEW_BOX.width) * 100}%`, top: `${(block.tooltip.y / OFIYAT_SELECTOR_VIEW_BOX.height) * 100}%` }}
      >{t.block} <b>{block.number}</b>{selectedBlock === block.number ? <small>{t.selected}</small> : null}</span>)}
      <span className="ofiyat-explorer__render-label">{t.renderLabel} · KAYAN / FRAME 4</span>
      {imageFailed ? <p className="ofiyat-explorer__image-error" role="status">{t.imageError}</p> : null}
    </div>

    <div className="ofiyat-explorer__intro">
      <small>OFIYAT · {t.blueHour}</small>
      <h1>{t.title}</h1>
      <p>{t.lead}</p>
    </div>

    <div className="ofiyat-explorer__block-controls" role="group" aria-label={t.controls}>
      {OFIYAT_BLOCKS.map((block) => <button
        key={block.number}
        type="button"
        aria-label={`${t.selectBlock} ${block.number}`}
        aria-pressed={selectedBlock === block.number}
        aria-controls={panelId}
        onPointerEnter={() => setHoveredBlock(block.number)}
        onPointerLeave={() => setHoveredBlock(null)}
        onFocus={() => setFocusedBlock(block.number)}
        onBlur={() => setFocusedBlock(null)}
        onClick={(event) => selectBlock(block.number, event.currentTarget)}
      >{block.number}</button>)}
    </div>

    <section id={panelId} className="ofiyat-explorer__panel" aria-label={selectedBlock === null ? t.chooseFirst : t.mapping}>
      {selectedBlock === null ? <div className="ofiyat-explorer__empty">
        <small>01 / 04</small>
        <h2>{t.chooseFirst}</h2>
        <p id={helpId}>{t.mapping}</p>
        {inventoryState !== 'ready' ? <p className="ofiyat-explorer__inventory-state" role="status">{inventoryMessage}</p> : null}
        <a href={inventoryState === 'error' ? catalogHref : parkingHref(catalogHref)}>{inventoryState === 'error' ? t.openCatalog : t.parking}<span>↗</span></a>
      </div> : <>
        <header>
          <div><small>{t.block}</small><strong>{selectedBlock}</strong></div>
          <p id={helpId}>{t.mapping}</p>
          <button type="button" onClick={clearAll}>{t.clear}</button>
        </header>

        {inventoryState !== 'ready' ? <p className="ofiyat-explorer__inventory-state" role="status">{inventoryMessage}</p> : null}

        {selectedPhase === null ? <div className="ofiyat-explorer__step">
          <small>02 / 04</small><h2 ref={panelHeadingRef} tabIndex={-1}>{t.phaseTitle}</h2>
          <div className="ofiyat-explorer__choices is-phase" role="group" aria-label={t.phaseLabel}>{phases.map((phase) => <button key={phase.slug} type="button" disabled={inventoryState !== 'ready'} data-ofiyat-choice="phase" data-ofiyat-value={phase.slug} onClick={() => { setSelectedPhase(phase.slug); setSelectedEntrance(null); setSelectedFloor(null); setSelectedUnitKey(null); }}><span>{phaseLabel(phase.slug, language)}</span><small>{phase.available} {t.available}</small></button>)}</div>
        </div> : selectedEntrance === null ? <div className="ofiyat-explorer__step">
          <small>02 / 04 · {phaseLabel(selectedPhase, language)}</small><h2 ref={panelHeadingRef} tabIndex={-1}>{t.entranceTitle}</h2>
          <div className="ofiyat-explorer__choices" role="group" aria-label={t.entranceLabel}>{entrances.map((entrance) => <button key={entrance} type="button" data-ofiyat-choice="entrance" data-ofiyat-value={entrance} onClick={() => { setSelectedEntrance(entrance); setSelectedFloor(null); setSelectedUnitKey(null); }}>{t.entrance} <strong>{entrance}</strong></button>)}</div>
          <button className="ofiyat-explorer__back" type="button" onClick={goBack}>← {t.back}</button>
        </div> : selectedFloor === null ? <div className="ofiyat-explorer__step">
          <small>03 / 04 · {phaseLabel(selectedPhase, language)} · {t.entrance} {selectedEntrance}</small><h2 ref={panelHeadingRef} tabIndex={-1}>{t.floorTitle}</h2>
          <div className="ofiyat-explorer__choices is-floors" role="group" aria-label={t.floorLabel}>{floors.map((floor) => <button key={floor} type="button" data-ofiyat-choice="floor" data-ofiyat-value={floor} onClick={() => { setSelectedFloor(floor); setSelectedUnitKey(null); }}>{floor}</button>)}</div>
          <button className="ofiyat-explorer__back" type="button" onClick={goBack}>← {t.back}</button>
        </div> : <div className="ofiyat-explorer__step is-units">
          <small>04 / 04 · {phaseLabel(selectedPhase, language)} · {t.entrance} {selectedEntrance} · {t.floor} {selectedFloor}</small><h2 ref={panelHeadingRef} tabIndex={-1}>{t.unitsTitle}</h2>
          <p className="ofiyat-explorer__fallback">{t.fallback}</p>
          {floorUnits.length ? <div className="ofiyat-explorer__units" role="group" aria-label={t.unitsLabel}>{floorUnits.map((unit) => <button
            key={unit.sourceKey}
            type="button"
            aria-pressed={selectedUnitKey === unit.sourceKey}
            data-status={unit.status}
            data-ofiyat-choice="unit"
            data-ofiyat-value={unit.sourceKey}
            onClick={() => setSelectedUnitKey(unit.sourceKey)}
          ><span><b>№ {unit.number}</b><small>{unit.rooms ? `${unit.rooms} ${t.rooms}` : t.noRooms} · {unit.area} {t.area}</small></span><i>{t.statuses[unit.status]}</i></button>)}</div> : <p className="ofiyat-explorer__unavailable">{t.unavailable}</p>}
          {selectedUnit && selection ? <div className="ofiyat-explorer__actions">
            <a href={catalogHrefFor(catalogHref, selection)}>{t.open}<span>↗</span></a>
            <button type="button" onClick={() => onLead?.(selection)}>{t.consult}</button>
          </div> : null}
          <button className="ofiyat-explorer__back" type="button" onClick={goBack}>← {t.back}</button>
        </div>}
      </>}
    </section>
    <p className="ofiyat-explorer__source">{t.source}</p>
    <span className="kayan-sr-only" role="status" aria-live="polite">{liveMessage}</span>
  </div>;
}
