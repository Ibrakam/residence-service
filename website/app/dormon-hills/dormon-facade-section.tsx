'use client';

import { useId, useState, type CSSProperties, type FocusEvent, type PointerEvent } from 'react';
import { dormonBase, type DormonLanguage } from './dormon-data';
import { dormonEditorial } from './dormon-editorial-data';

const drawingSize = 1254;
const drawing = `${dormonBase}/dormon-hills/editorial/facade-section.webp`;
const airflow = `${dormonBase}/dormon-hills/editorial/facade-air.webp`;

// Regions and marker positions use the original cutaway's 1254 × 1254 coordinates.
const regions = [
  ['157,170 706,87 911,115 774,151 748,218 711,283 712,298 563,270 469,288 466,465 627,488 656,500 630,566 597,624 542,682 486,736 444,800 415,868 396,945 384,1010 380,1101 170,1004'],
  [
    '776,150 1007,127 1007,333 791,389 791,301 705,300 721,253 745,219',
    '655,498 631,566 597,624 543,680 486,737 444,800 415,868 394,946 383,1009 378,1103 438,1144 548,1112 652,1063',
  ],
  [
    '468,288 562,263 651,285 779,296 793,337 799,397 797,986 653,1004 650,501 626,491 468,473',
  ],
  ['738,456 784,474 797,951 772,993 713,1008 735,902'],
  [
    '779,387 1129,285 1132,324 1199,332 1196,827 829,1004 798,985 779,470',
    '640,998 767,944 770,983 826,1002 1188,819 1188,959 835,1152 701,1236 702,1081 643,1062',
  ],
] as const;

const markers = [
  { layer: 0, x: 300, y: 650 },
  { layer: 1, x: 455, y: 955 },
  { layer: 1, x: 958, y: 222, part: 'membrane' },
  { layer: 1, x: 572, y: 806, part: 'dowel' },
  { layer: 2, x: 560, y: 380, part: 'bracket' },
  { layer: 2, x: 700, y: 640 },
  { layer: 3, x: 756, y: 770 },
  { layer: 4, x: 1010, y: 650 },
] as const;

const layerCameras = [
  { x: 365, y: 610, scale: 1.32 },
  { x: 485, y: 889, scale: 1.36 },
  { x: 646, y: 531, scale: 1.38 },
  { x: 756, y: 627, scale: 1.06 },
  { x: 990, y: 672, scale: 1.27 },
] as const;

type Marker = typeof markers[number];
type Detail = Extract<Marker, { part: string }>;
type Selection = { layer: number; detail?: Detail };

function getCamera(selection: Selection | null) {
  if (!selection) return { scale: 1, x: 0, y: 0 };
  const focus = selection.detail ? { ...selection.detail, scale: 1.47 } : layerCameras[selection.layer];
  const pan = (coordinate: number) => Math.max(1 - focus.scale, Math.min(0, .5 - focus.scale * coordinate / drawingSize));
  return { scale: focus.scale, x: pan(focus.x), y: pan(focus.y) };
}

const copy = {
  ru: { title: 'Фасад в разрезе', reset: 'Все слои', membrane: 'Гидроветрозащитная мембрана', dowel: 'Тарельчатый дюбель', bracket: 'Крепёжный кронштейн' },
  uz: { title: 'Fasad kesimi', reset: 'Barcha qatlamlar', membrane: 'Suv va shamoldan himoyalovchi membrana', dowel: 'Likopchali dyubel', bracket: 'Mahkamlash kronshteyni' },
  en: { title: 'Façade cross section', reset: 'All layers', membrane: 'Weather-resistant membrane', dowel: 'Disc dowel', bracket: 'Mounting bracket' },
};

export function DormonFacadeSection({ language }: { language: DormonLanguage }) {
  const id = useId();
  const t = copy[language];
  const editorial = dormonEditorial[language];
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const layer = selection?.layer ?? preview;
  const camera = getCamera(selection);

  function clear() {
    setSelection(null);
    setPreview(null);
  }

  function select(next: number, detail?: Detail) {
    setSelection(current => current?.layer === next && (!detail || current.detail === detail) ? null : { layer: next, detail });
    setPreview(null);
  }

  function previewPointer(event: PointerEvent<HTMLButtonElement>, next: number) {
    if (event.pointerType === 'mouse') setPreview(next);
  }

  function layerInteraction(next: number, detail?: Detail) {
    return {
      onClick: () => select(next, detail),
      onPointerEnter: (event: PointerEvent<HTMLButtonElement>) => previewPointer(event, next),
      onPointerLeave: () => setPreview(null),
      onFocus: (event: FocusEvent<HTMLButtonElement>) => {
        if (event.currentTarget.matches(':focus-visible')) setPreview(next);
      },
      onBlur: () => setPreview(null),
    };
  }

  return (
    <section className="dormon-cutaway" aria-labelledby="dormon-facade-section"
      onKeyDown={event => {
        if (event.key === 'Escape' && layer !== null) {
          event.stopPropagation();
          clear();
        }
      }}>
      <div className="dormon-cutaway-head">
        <h2 id="dormon-facade-section">{t.title}</h2>
        <p>{editorial.layerHint}</p>
      </div>
      <figure className="dormon-cutaway-figure">
        <div className="dormon-cutaway-scene" data-highlighted={layer !== null}>
          <svg className="dormon-cutaway-art" viewBox={`0 0 ${drawingSize} ${drawingSize}`} aria-hidden="true" focusable="false"
            style={{ transform: `translate(${camera.x * 100}%, ${camera.y * 100}%) scale(${camera.scale})` }}>
            <defs>
              <image id={`${id}-drawing`} href={drawing} width={drawingSize} height={drawingSize} />
              <filter id={`${id}-feather`} x="0" y="0" width={drawingSize} height={drawingSize} filterUnits="userSpaceOnUse">
                <feGaussianBlur stdDeviation="12" />
              </filter>
              {regions.map((polygons, index) => (
                <mask key={index} id={`${id}-material-${index}`} x="0" y="0" width={drawingSize} height={drawingSize} maskUnits="userSpaceOnUse">
                  <g fill="white" filter={`url(#${id}-feather)`}>
                    {polygons.map(points => <polygon key={points} points={points} />)}
                  </g>
                </mask>
              ))}
            </defs>
            <use className="dormon-cutaway-base" href={`#${id}-drawing`} />
            {regions.map((_, index) => (
              <use key={index} className="dormon-cutaway-reveal" data-active={layer === index}
                href={`#${id}-drawing`} mask={`url(#${id}-material-${index})`} />
            ))}
            <image className="dormon-cutaway-reveal" data-active={layer === 3} href={airflow} width={drawingSize} height={drawingSize} />
          </svg>
          {markers.map(marker => {
            const detail = 'part' in marker ? marker : undefined;
            const label = detail ? t[detail.part] : editorial.layers[marker.layer].title;
            const x = camera.x + camera.scale * marker.x / drawingSize;
            const y = camera.y + camera.scale * marker.y / drawingSize;
            const visible = [x, y].every(coordinate => coordinate >= .09 && coordinate <= .91);
            return (
              <div key={marker.x} className="dormon-cutaway-marker" data-visible={visible} data-active={layer === marker.layer}
                style={{ '--cutaway-x': `${x * 100}%`, '--cutaway-y': `${y * 100}%` } as CSSProperties}>
                <button className="dormon-cutaway-point" type="button" aria-label={label}
                  aria-controls={`${id}-layer-${marker.layer}`} aria-pressed={selection?.layer === marker.layer && selection.detail === detail}
                  aria-hidden={!visible || undefined} tabIndex={visible ? undefined : -1}
                  {...layerInteraction(marker.layer, detail)}>
                  <span aria-hidden="true">{marker.layer + 1}</span>
                </button>
              </div>
            );
          })}
        </div>
        <figcaption>{editorial.layerNote}</figcaption>
      </figure>
      <div className="dormon-cutaway-controls">
        <div className="dormon-cutaway-layers">
          {editorial.layers.map(({ title, text }, index) => {
            const open = selection?.layer === index;
            const content = `${id}-layer-${index}`;
            return (
              <div key={title} className="dormon-cutaway-layer" data-active={layer === index}>
                <h3>
                  <button type="button" aria-expanded={open} aria-controls={content} {...layerInteraction(index)}>
                    <span className="dormon-cutaway-index" aria-hidden="true">{index + 1}</span>
                    <span>{title}</span>
                    <span className="dormon-cutaway-toggle" aria-hidden="true">{open ? '−' : '+'}</span>
                  </button>
                </h3>
                <div id={content} hidden={!open}>
                  {open && selection.detail && <span className="dormon-cutaway-detail-name">{t[selection.detail.part]}</span>}
                  <p>{text}</p>
                </div>
              </div>
            );
          })}
        </div>
        <button className="dormon-cutaway-reset" type="button" aria-disabled={selection === null} onClick={clear}>{t.reset}</button>
      </div>
    </section>
  );
}
