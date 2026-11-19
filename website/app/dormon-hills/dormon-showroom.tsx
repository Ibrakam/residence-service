'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { DormonPublishedPlan } from '@/lib/dormon-plans-state';
import { blocks as capturedBlocks } from '@/data/dormon-showroom.json';
import { copy as catalogCopy } from './apartments/plan-catalog-data';
import { dormonBase, type DormonLanguage } from './dormon-data';
import { DormonShowroomPreview } from './dormon-showroom-preview';
import { dormonShowroomPriceKey, useDormonShowroomPrices } from './dormon-showroom-prices';
import { dormonShowroomOverview, dormonShowroomScenes, type Outline } from './dormon-showroom-scenes';
import { dormonMediaSources, dormonSceneSizes, preloadDormonMedia } from './dormon-media';

type Unit = { number: number; rooms: number | null; area: number | null; marker: number[] | null; outline?: number[][]; views: string[] };
type Floor = { image: string | null; units: Unit[] };

const floorsByBlock: Record<string, Record<string, Floor>> = capturedBlocks;
const media = (file: string) => `${dormonBase}/dormon-hills/showroom/${file}`;

const facadeMedia = (file: string) => `${dormonBase}/dormon-hills/facades/${file}`;
const scenes = Object.entries(dormonShowroomScenes);
const highestRoofMarker = Math.min(...scenes.flatMap(([, scene]) => scene ? [scene.position[1]] : []));

const text = {
  ru: {
    chooseBuilding: 'Выберите корпус', business: 'Жилой комплекс бизнес-класса', location: 'Кибрайский район', sitePlan: 'Генплан комплекса', house: 'Вид на комплекс Do’rmon Hills с высоты', overview: 'К общему виду', facade: 'К фасаду',
    floor: 'Этаж', unit: 'Квартира', chooseUnit: 'Выберите квартиру на схеме', closeUnit: 'Закрыть карточку квартиры', chooseFacadeFloor: 'Выберите этаж на фасаде',
    layout: 'Типовая схема', layouts: 'Типовые схемы', openLayouts: 'Открыть типовые схемы', browse: 'Все планировки', browseBlock: 'Планировки корпуса',
    floorUnavailable: 'Схема этого этажа недоступна.', unitUnavailable: 'Планировка этой квартиры недоступна.',
    coverage: 'Наличие уточняйте в отделе продаж.',
    priceFrom: (amount: string) => `от ${amount} сум`,
  },
  uz: {
    chooseBuilding: 'Blokni tanlang', business: 'Biznes toifasidagi turar joy majmuasi', location: 'Qibray tumani', sitePlan: 'Majmua bosh rejasi', house: 'Do’rmon Hills majmuasining yuqoridan ko‘rinishi', overview: 'Umumiy ko‘rinishga', facade: 'Fasadga qaytish',
    floor: 'Qavat', unit: 'Xonadon', chooseUnit: 'Xonadonni chizmadan tanlang', closeUnit: 'Xonadon kartasini yopish', chooseFacadeFloor: 'Qavatni fasaddan tanlang',
    layout: 'Namuna chizmasi', layouts: 'Namuna chizmalari', openLayouts: 'Namuna chizmalarini ochish', browse: 'Barcha rejalar', browseBlock: 'Blok rejalari',
    floorUnavailable: 'Bu qavatning chizmasi mavjud emas.', unitUnavailable: 'Bu xonadonning rejasi mavjud emas.',
    coverage: 'Xonadon mavjudligini savdo bo‘limidan aniqlang.',
    priceFrom: (amount: string) => `${amount} so‘mdan`,
  },
  en: {
    chooseBuilding: 'Choose a building', business: 'Business-class residences', location: 'Qibray District', sitePlan: 'Development master plan', house: 'Aerial view of Do’rmon Hills', overview: 'Back to overview', facade: 'Back to facade',
    floor: 'Floor', unit: 'Apartment', chooseUnit: 'Choose an apartment on the plan', closeUnit: 'Close apartment details', chooseFacadeFloor: 'Choose a floor on the facade',
    layout: 'Typical floor plan', layouts: 'Typical floor plans', openLayouts: 'Open typical floor plans', browse: 'All floor plans', browseBlock: 'Block floor plans',
    floorUnavailable: 'The plan for this floor is unavailable.', unitUnavailable: 'The plan for this apartment is unavailable.',
    coverage: 'Ask the sales team about availability.',
    priceFrom: (amount: string) => `From UZS ${amount}`,
  },
};

function SceneHotspot({ label, title, position, outline, kind = 'block', active, spotlight, onClick }: {
  label: string | number;
  title: string;
  position: readonly number[];
  outline?: readonly (readonly number[])[];
  kind?: 'block' | 'floor' | 'unit';
  active?: boolean;
  spotlight?: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const xs = outline?.map(([x]) => x) ?? [0, 100];
  const ys = outline?.map(([, y]) => y) ?? [0, 100];
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  const relativeX = (x: number) => `${(x - left) * 100 / width}%`;
  const relativeY = (y: number) => `${(y - top) * 100 / height}%`;
  const style = {
    left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%`,
    '--pin-x': relativeX(position[0]), '--pin-y': relativeY(position[1]),
    '--hotspot-outline': outline ? `polygon(${outline.map(([x, y]) => `${relativeX(x)} ${relativeY(y)}`).join(', ')})` : undefined,
  } as CSSProperties;

  return <button type="button" className="dormon-showroom-hotspot" data-kind={kind}
    style={style} data-outline={Boolean(outline)} data-spotlight={spotlight || undefined} aria-label={title} aria-pressed={active} onClick={onClick}>
    <span className="dormon-showroom-pin" aria-hidden="true">{label}</span>
  </button>;
}

function FacadeShade({ floors }: { floors: Readonly<Partial<Record<number, Outline>>> }) {
  const maskId = useId();

  return <svg className="dormon-showroom-shade" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
    <defs>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <rect width="100" height="100" fill="white" />
        {Object.entries(floors).map(([level, band]) => band &&
          <polygon key={level} points={band.outline.map(point => point.join(',')).join(' ')} fill="black" />)}
      </mask>
    </defs>
    <rect width="100" height="100" fill="black" fillOpacity=".32" mask={`url(#${maskId})`} />
  </svg>;
}

type ApartmentSelection = { block: string; floor: string; number: number; label: string };
type View = { block: string; floor: string };
type Attention = { kind: 'block' | 'floor'; key: string; point: readonly number[] };
type Flight = { from: View; fromImage: string; fromWithUnit: boolean; attention?: Attention; phase: 'focus' | 'arrival' };
type CameraPose = { point: readonly number[]; desktop: number; mobile: number; verticalSpan?: number };

const overview: View = { block: '', floor: '' };
const neutralCamera: CameraPose = { point: [50, 50], desktop: 1, mobile: 1 };
const focusDuration = 570;
const arrivalDuration = 460;

function facadeCamera(floors: Readonly<Partial<Record<number, Outline>>>): CameraPose {
  const points = Object.values(floors).flatMap(band => band?.outline ?? []);
  if (!points.length) return neutralCamera;
  const [xs, ys] = [points.map(point => point[0]), points.map(point => point[1])];
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  return {
    point: [(Math.min(...xs) + Math.max(...xs)) / 2, (top + bottom) / 2],
    desktop: 1.17,
    mobile: 2.12,
    verticalSpan: (bottom - top) / 100,
  };
}

function cameraStyle({ point: [x, y], desktop, mobile }: CameraPose) {
  return {
    '--zoom-desktop': desktop,
    '--zoom-mobile': mobile,
    '--pan-desktop-x': `${(50 - x) * desktop}%`,
    '--pan-desktop-y': `${(50 - y) * desktop}%`,
    '--pan-mobile-x': `${(50 - x) * mobile}%`,
    '--pan-mobile-y': `${(50 - y) * mobile}%`,
  } as CSSProperties;
}

function SceneArtwork({ target, mode, attention, floorImage, withUnit, activeNumber, hasTypical, filteredCatalog,
  t, c, onTravel, onChooseUnit, onFailedImage }: {
  target: View;
  mode: 'exiting' | 'entering' | 'static';
  attention?: Attention;
  floorImage: string;
  withUnit: boolean;
  activeNumber?: number;
  hasTypical: boolean;
  filteredCatalog: string;
  t: typeof text[DormonLanguage];
  c: typeof catalogCopy[DormonLanguage];
  onTravel: (next: View, attention?: Attention) => void;
  onChooseUnit: (number: number, opener: HTMLButtonElement) => void;
  onFailedImage: (image: string) => void;
}) {
  const facade = dormonShowroomScenes[target.block];
  const activeCamera = facade ? facadeCamera(facade.floors) : neutralCamera;
  const pose = attention ? {
    point: attention.point,
    desktop: attention.kind === 'block' ? 1.36 : 1.33,
    mobile: attention.kind === 'block' ? 1.45 : 2.3,
  } : activeCamera;
  const floorUnits = floorsByBlock[target.block]?.[target.floor]?.units ?? [];
  const isExiting = mode === 'exiting';
  const isCurrent = mode !== 'exiting';
  const label = target.block ? `${c.block} ${target.block}` : t.house;
  const rendering = facadeMedia(facade?.file ?? dormonShowroomOverview.file);
  const responsive = dormonMediaSources(rendering);
  const imageSizes = dormonSceneSizes(Boolean(facade));
  const verticalSpan = activeCamera.verticalSpan ?? 1;

  return <div className="dormon-showroom-layer" data-motion={mode}
    data-plan={Boolean(target.floor)} data-has-unit={withUnit} inert={isExiting || undefined} aria-hidden={isExiting || undefined}>
    {target.floor ? (
      floorImage ? <div className="dormon-showroom-plan">
        <div className="dormon-showroom-drawing">
          <img key={floorImage} src={floorImage} alt={`${c.floorPlan} · ${label}${target.floor === 'typical' ? '' : ` · ${t.floor} ${target.floor}`}`}
            onError={isCurrent ? () => onFailedImage(floorImage) : undefined} />
          {floorUnits.map(unit => unit.marker && <SceneHotspot key={unit.number} kind="unit"
            label={unit.number} title={`${t.unit} №${unit.number}`} position={unit.marker} outline={unit.outline}
            active={isCurrent && activeNumber === unit.number} onClick={event => onChooseUnit(unit.number, event.currentTarget)} />)}
        </div>
      </div> : <div className="dormon-showroom-empty">
        <p role="status">{t.floorUnavailable}</p>
        {isCurrent && hasTypical && <button type="button" className="dormon-showroom-typical"
          onClick={() => onTravel({ block: target.block, floor: 'typical' })}>{t.openLayouts}</button>}
        {isCurrent && <a href={filteredCatalog}>{t.browseBlock}</a>}
      </div>
    ) : (
      <div className={`dormon-showroom-world ${facade ? 'is-facade' : 'is-overview'}`} style={{
        ...cameraStyle(pose),
        '--highest-roof-marker': `${highestRoofMarker}%`,
        '--rest-desktop': activeCamera.desktop,
        '--rest-mobile': activeCamera.mobile,
        '--fit-desktop': verticalSpan * activeCamera.desktop,
        '--fit-mobile': verticalSpan * activeCamera.mobile,
      } as CSSProperties}>
        <picture className="dormon-media">
          {responsive && <source type="image/avif" srcSet={responsive.avif} sizes={imageSizes} />}
          <img src={rendering} srcSet={responsive?.webp} sizes={imageSizes} width={dormonShowroomOverview.width}
            height={dormonShowroomOverview.height} alt={label} fetchPriority={facade ? undefined : 'high'} decoding="async" />
        </picture>
        {facade ? <>
          <FacadeShade floors={facade.floors} />
          {Object.entries(facade.floors).map(([level, band]) => band && <SceneHotspot key={level}
            label={level} title={`${t.floor} ${level}`} kind="floor" position={band.position} outline={band.outline}
            spotlight={attention?.key === level} onClick={() => onTravel({ block: target.block, floor: level }, {
              key: level, kind: 'floor', point: band.position,
            })} />)}
        </> : scenes.map(([name, hotspot]) => hotspot && <SceneHotspot key={name}
          label={name} title={`${c.block} ${name}`} position={hotspot.position} outline={hotspot.outline}
          spotlight={attention?.key === name} onClick={() => onTravel({ block: name, floor: '' }, {
            key: name, kind: 'block', point: hotspot.position,
          })} />)}
      </div>
    )}
  </div>;
}

export function DormonShowroom({ language, plans, catalogHref, onEnquire }: {
  language: DormonLanguage;
  plans: DormonPublishedPlan[];
  catalogHref: string;
  onEnquire: (opener: HTMLButtonElement, apartment: ApartmentSelection) => void;
}) {
  const t = text[language];
  const c = catalogCopy[language];
  const prices = useDormonShowroomPrices();
  const sceneTitle = useRef<HTMLHeadingElement>(null);
  const unitTitle = useRef<HTMLHeadingElement>(null);
  const unitOpener = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [view, setView] = useState<View>(overview);
  const [flight, setFlight] = useState<Flight>();
  const [unitNumber, setUnitNumber] = useState<number>();
  const [unitOpen, setUnitOpen] = useState(false);
  const [failedFloorImage, setFailedFloorImage] = useState('');
  const [typicalImage, setTypicalImage] = useState('');
  const { block, floor } = view;
  const typicalPlans = typicalForBlock(block);
  const units = floorsByBlock[block]?.[floor]?.units ?? [];
  const selectedUnit = units.find(unit => unit.number === unitNumber);
  const activeUnit = unitOpen ? selectedUnit : undefined;
  const price = selectedUnit && prices[dormonShowroomPriceKey(block, floor, selectedUnit.number)];
  const numberFormat = new Intl.NumberFormat(language === 'uz' ? 'uz-Latn' : language);
  const unitFacts = selectedUnit && [
    selectedUnit.rooms != null && c.roomsLabel(selectedUnit.rooms),
    selectedUnit.area != null && `${numberFormat.format(selectedUnit.area)} ${language === 'ru' ? 'м²' : 'm²'}`,
  ].filter(Boolean).join(' · ');
  const showTypical = floor === 'typical';
  const showPlan = Boolean(floor);
  const sceneLabel = block ? `${c.block} ${block}` : t.sitePlan;
  const currentImage = floorSource(view);
  const hasDrawing = Boolean(currentImage && currentImage !== failedFloorImage);
  const unitsWithoutHotspots = units.filter(unit => !hasDrawing || !unit.marker);
  const instruction = !block ? t.chooseBuilding : !showPlan ? t.chooseFacadeFloor :
    hasDrawing && units.some(unit => unit.marker) ? t.chooseUnit : '';
  const filteredCatalog = block ? `${catalogHref}&block=${encodeURIComponent(block)}` : catalogHref;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function typicalForBlock(name: string) {
    return [...new Map(plans.filter(plan => plan.block === name && plan.floorPlan)
      .map(plan => [plan.floorPlan, plan])).values()];
  }

  function floorSource(target: View) {
    if (target.floor === 'typical') {
      const options = typicalForBlock(target.block);
      const plan = options.find(entry => entry.floorPlan === typicalImage) ?? options[0];
      return plan ? dormonBase + plan.floorPlan : '';
    }
    const level = floorsByBlock[target.block]?.[target.floor];
    const image = level?.image ?? (level?.units.length === 1 ? level.units[0].views[3] : undefined);
    return image ? media(image) : '';
  }

  function focusScene() {
    requestAnimationFrame(() => sceneTitle.current?.focus({ preventScroll: true }));
  }

  function travel(next: View, attention?: Attention) {
    if (timer.current !== undefined || (view.block === next.block && view.floor === next.floor)) return;

    function commit() {
      const nextUnits = floorsByBlock[next.block]?.[next.floor]?.units;
      const single = nextUnits?.length === 1 ? nextUnits[0] : undefined;
      setTypicalImage('');
      setFailedFloorImage('');
      setView(next);
      setUnitNumber(single?.number);
      setUnitOpen(Boolean(single));
      focusScene();
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      commit();
      return;
    }

    const nextFacade = dormonShowroomScenes[next.block];
    const source = next.floor ? floorSource(next) : facadeMedia(nextFacade?.file ?? dormonShowroomOverview.file);
    const preload = source ? preloadDormonMedia(source, dormonSceneSizes(Boolean(nextFacade))) : undefined;
    const departing = { from: view, fromImage: hasDrawing ? currentImage : '', fromWithUnit: Boolean(activeUnit), attention };
    setFlight({ ...departing, phase: 'focus' });
    function arrive() {
      commit();
      setFlight({ ...departing, phase: 'arrival' });
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        setFlight(undefined);
      }, arrivalDuration);
    }
    timer.current = window.setTimeout(() => {
      if (preload && !preload.complete) timer.current = window.setTimeout(arrive, 150);
      else arrive();
    }, attention ? focusDuration : 80);
  }

  function chooseUnit(number: number, opener: HTMLButtonElement) {
    if (flight?.phase === 'focus') return;
    unitOpener.current = opener;
    setUnitNumber(number);
    setUnitOpen(true);
    requestAnimationFrame(() => unitTitle.current?.focus({ preventScroll: true }));
  }

  function closeUnit() {
    setUnitOpen(false);
    requestAnimationFrame(() => {
      if (unitOpener.current?.isConnected) unitOpener.current.focus({ preventScroll: true });
      else sceneTitle.current?.focus({ preventScroll: true });
    });
  }


  return (
    <section id="dormon-plans" className="dormon-showroom" aria-labelledby="dormon-title">
      <div className="dormon-showroom-stage" data-view={showPlan ? 'plan' : block ? 'facade' : 'overview'}
        data-has-unit={Boolean(activeUnit)} data-flight={flight?.phase}
        onKeyDown={event => {
          if (event.key === 'Escape' && activeUnit && !(event.target as HTMLElement).closest('dialog')) closeUnit();
        }}>
        <div className="dormon-showroom-heading" data-visible={!block}>
          <p className="dormon-showroom-location">{t.location}</p>
          <h1 id="dormon-title"><span>Do‘rmon</span> <span>Hills</span></h1>
          <p className="dormon-showroom-class">{t.business}</p>
        </div>

        <div className="dormon-showroom-stagebar">
          <div className="dormon-showroom-path">
            {block && <button type="button" className="dormon-showroom-back" onClick={() => {
              travel(showPlan ? { block, floor: '' } : overview);
            }}>
              <span aria-hidden="true">←</span><span>{showPlan ? t.facade : t.overview}</span>
            </button>}
            <h2 ref={sceneTitle} tabIndex={-1} id="dormon-showroom-title" className="dormon-showroom-scene-title">
              {sceneLabel}{showPlan && <span>{showTypical ? t.layouts : `${t.floor} ${floor}`}</span>}
            </h2>
          </div>
        </div>

        <div className="dormon-showroom-viewport" aria-busy={Boolean(flight)}>
          {flight?.phase === 'arrival' && <SceneArtwork key={`${flight.from.block}:${flight.from.floor}`}
            target={flight.from} mode="exiting" floorImage={flight.fromImage} attention={flight.attention}
            withUnit={flight.fromWithUnit}
            hasTypical={false} filteredCatalog={filteredCatalog} t={t} c={c}
            onTravel={travel} onChooseUnit={chooseUnit} onFailedImage={setFailedFloorImage} />}
          <SceneArtwork key={`${block}:${floor}`} target={view}
            mode={flight?.phase === 'arrival' ? 'entering' : 'static'}
            attention={flight?.phase === 'focus' ? flight.attention : undefined}
            floorImage={hasDrawing ? currentImage : ''} withUnit={Boolean(activeUnit)} activeNumber={activeUnit?.number}
            hasTypical={!showTypical && typicalPlans.length > 0} filteredCatalog={filteredCatalog} t={t} c={c}
            onTravel={travel} onChooseUnit={chooseUnit} onFailedImage={setFailedFloorImage} />
        </div>
        <a href={filteredCatalog} className="dormon-showroom-catalog">{block ? t.browseBlock : t.browse}</a>

        <div className="dormon-showroom-stagefoot">
          <p key={`${block}:${floor}`} className="dormon-showroom-instruction">{instruction}</p>
          {unitsWithoutHotspots.length > 0 && <div className="dormon-showroom-unit-fallback" inert={Boolean(activeUnit) || undefined}>
            {unitsWithoutHotspots.map(unit => <button key={unit.number} type="button" className="dormon-showroom-typical"
              onClick={event => chooseUnit(unit.number, event.currentTarget)}>{t.unit} №{unit.number}</button>)}
          </div>}
          {showTypical && typicalPlans.length > 1 && <label className="dormon-showroom-typical-choice">{t.layouts}
            <select value={typicalImage || typicalPlans[0].floorPlan} onChange={event => {
              setFailedFloorImage('');
              setTypicalImage(event.currentTarget.value);
            }}>
              {typicalPlans.map(plan => <option key={plan.floorPlan} value={plan.floorPlan}>
                {plan.floors ? c.floors(plan.floors) : t.layout}
              </option>)}
            </select>
          </label>}
          {block && !showPlan && typicalPlans.length > 0 && <button type="button" className="dormon-showroom-typical"
            onClick={() => travel({ block, floor: 'typical' })}>{t.openLayouts}</button>}
        </div>

        {selectedUnit && <aside key={selectedUnit.number} className="dormon-showroom-unit" data-open={unitOpen}
          inert={!unitOpen || undefined} aria-labelledby="dormon-showroom-unit-title">
          <div className="dormon-showroom-unit-heading">
            <div>
              <h3 ref={unitTitle} tabIndex={-1} id="dormon-showroom-unit-title">{t.unit} №{selectedUnit.number}</h3>
              {unitFacts && <p>{unitFacts}</p>}
            </div>
            <button type="button" className="dormon-showroom-unit-close" onClick={closeUnit} aria-label={t.closeUnit}>×</button>
          </div>
          {selectedUnit.views.length > 0 ? <DormonShowroomPreview
            language={language} label={`${t.unit} №${selectedUnit.number}`} groupLabel={c.plan}
            sources={selectedUnit.views.map(media)} /> : <p>{t.unitUnavailable}</p>}
          <button type="button" className="dormon-action is-gold" onClick={event => onEnquire(event.currentTarget, {
            block, floor, number: selectedUnit.number, label: `${t.unit} №${selectedUnit.number} · ${c.block} ${block}`,
          })}>{price ? t.priceFrom(numberFormat.format(price)) : c.inquire}</button>
          <p className="dormon-showroom-coverage">{t.coverage}</p>
        </aside>}
      </div>
    </section>
  );
}
