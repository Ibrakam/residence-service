import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { DormonLanguage } from './dormon-data';

const copy = {
  ru: {
    views: ['2D', '3D', 'Чертёж', 'На этаже'],
    open: 'Просмотр', close: 'Закрыть', missing: 'Изображение недоступно.',
    previous: 'Предыдущее изображение', next: 'Следующее изображение',
    zoomIn: 'Увеличить', zoomOut: 'Уменьшить', reset: 'Сбросить масштаб и поворот',
    rotateLeft: 'Повернуть влево', rotateRight: 'Повернуть вправо',
  },
  uz: {
    views: ['2D', '3D', 'Chizma', 'Qavatda'],
    open: 'Ko‘rish', close: 'Yopish', missing: 'Tasvir mavjud emas.',
    previous: 'Oldingi tasvir', next: 'Keyingi tasvir',
    zoomIn: 'Kattalashtirish', zoomOut: 'Kichraytirish', reset: 'Masshtab va burilishni tiklash',
    rotateLeft: 'Chapga burish', rotateRight: 'O‘ngga burish',
  },
  en: {
    views: ['2D', '3D', 'Drawing', 'On the floor'],
    open: 'Preview', close: 'Close', missing: 'Image unavailable.',
    previous: 'Previous image', next: 'Next image',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', reset: 'Reset zoom and rotation',
    rotateLeft: 'Rotate left', rotateRight: 'Rotate right',
  },
};

function PreviewImage({ src, alt, missing }: { src: string; alt: string; missing: string }) {
  const [failed, setFailed] = useState(false);

  return failed
    ? <span className="dormon-showroom-preview-missing">{missing}</span>
    : <img src={src} alt={alt} decoding="async" onError={() => setFailed(true)} />;
}

function isBackdropClick({ target, currentTarget, clientX, clientY }: MouseEvent<HTMLDialogElement>) {
  if (target !== currentTarget) return false;
  const { left, right, top, bottom } = currentTarget.getBoundingClientRect();
  return clientX < left || clientX >= right || clientY < top || clientY >= bottom;
}

export function DormonShowroomPreview({ language, label, groupLabel, sources }: {
  language: DormonLanguage;
  label: string;
  groupLabel: string;
  sources: readonly string[];
}) {
  const t = copy[language];
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const startedOnBackdrop = useRef(false);
  const [view, setView] = useState(0);
  const [slide, setSlide] = useState<number>();
  const [zoom, setZoom] = useState(1);
  const [turns, setTurns] = useState(0);

  useLayoutEffect(() => {
    const target = stage.current;
    if (target) {
      target.scrollTo({
        left: (target.scrollWidth - target.clientWidth) / 2,
        top: (target.scrollHeight - target.clientHeight) / 2,
      });
    }
  }, [slide, zoom]);

  function resetImage() {
    setZoom(1);
    setTurns(0);
  }

  function move(direction: number) {
    if (slide === undefined || sources.length < 2) return;
    setSlide((slide + direction + sources.length) % sources.length);
    resetImage();
  }

  function openPreview() {
    setSlide(view);
    resetImage();
    startedOnBackdrop.current = false;
    dialog.current?.showModal();
    close.current?.focus({ preventScroll: true });
  }

  return <div className="dormon-showroom-preview">
    <button className="dormon-showroom-preview-open" ref={opener} type="button" aria-haspopup="dialog"
      aria-label={`${t.open} · ${t.views[view]} · ${label}`} onClick={openPreview}>
      <PreviewImage key={sources[view]} src={sources[view]} alt="" missing={t.missing} />
      <span className="dormon-showroom-preview-caption">{t.open} <span aria-hidden="true">↗</span></span>
    </button>
    <div className="dormon-showroom-views" role="group" aria-label={groupLabel}>
      {sources.map((source, index) => <button key={source} type="button" aria-pressed={view === index}
        onClick={() => setView(index)}>{t.views[index]}</button>)}
    </div>

    <dialog className="dormon-showroom-lightbox" ref={dialog} aria-label={`${t.open} · ${label}`}
      onClose={() => {
        if (!dialog.current?.open) opener.current?.focus({ preventScroll: true });
      }}
      onPointerDown={event => {
        startedOnBackdrop.current = isBackdropClick(event);
      }}
      onClick={event => {
        if (startedOnBackdrop.current && isBackdropClick(event)) event.currentTarget.close();
        startedOnBackdrop.current = false;
      }}
      onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (zoom > 1 && event.target === stage.current) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }
      }}>
      <div className="dormon-showroom-lightbox-bar">
        <strong>{label}</strong>
        <button ref={close} type="button" aria-label={t.close} title={t.close}
          onClick={() => dialog.current?.close()}>×</button>
      </div>
      <div className="dormon-showroom-lightbox-stage" ref={stage} tabIndex={zoom > 1 ? 0 : undefined}
        role={zoom > 1 ? 'region' : undefined}
        aria-label={zoom > 1 && slide !== undefined ? t.views[slide] : undefined}>
        {slide !== undefined && <div className={`dormon-showroom-lightbox-canvas${turns % 2 ? ' is-quarter-turned' : ''}`}
          style={{ '--plan-zoom': zoom, '--plan-turn': `${turns * 90}deg` } as CSSProperties}>
          <PreviewImage key={sources[slide]} src={sources[slide]} alt={`${t.views[slide]} · ${label}`} missing={t.missing} />
        </div>}
      </div>
      <div className="dormon-showroom-lightbox-controls">
        <div className="dormon-showroom-lightbox-navigation" role="group" aria-label={groupLabel}>
          <button type="button" aria-label={t.previous} title={t.previous} onClick={() => move(-1)}
            disabled={sources.length < 2}>←</button>
          <span role="status">{slide === undefined ? '' : `${slide + 1} / ${sources.length}`}</span>
          <button type="button" aria-label={t.next} title={t.next} onClick={() => move(1)}
            disabled={sources.length < 2}>→</button>
        </div>
        <div className="dormon-showroom-lightbox-tools">
          <button type="button" aria-label={t.zoomOut} title={t.zoomOut} onClick={() => setZoom(zoom - .5)}
            disabled={zoom <= 1}>−</button>
          <button type="button" aria-label={t.zoomIn} title={t.zoomIn} onClick={() => setZoom(zoom + .5)}
            disabled={zoom >= 3}>+</button>
          <button type="button" aria-label={t.rotateLeft} title={t.rotateLeft} onClick={() => setTurns((turns + 3) % 4)}>↶</button>
          <button type="button" aria-label={t.rotateRight} title={t.rotateRight} onClick={() => setTurns((turns + 1) % 4)}>↷</button>
          <button type="button" aria-label={t.reset} title={t.reset} onClick={resetImage}
            disabled={zoom === 1 && turns === 0}>1:1</button>
        </div>
      </div>
    </dialog>
  </div>;
}
