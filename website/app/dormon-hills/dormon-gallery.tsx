'use client';

import { useEffect, useRef, useState } from 'react';
import { dormonBase, dormonCopy, type DormonLanguage } from './dormon-data';

const photos = ['hero', 'architecture', 'courtyard', 'fountain', 'lounge', 'promenade'];
const image = (name: string) => `${dormonBase}/dormon-hills/renders/${name}.webp`;

export function DormonGallery({ language }: { language: DormonLanguage }) {
  const t = dormonCopy[language];
  const [requested, setRequested] = useState(0);
  const [active, setActive] = useState(0);
  const [previous, setPrevious] = useState<number>();
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (requested === active) return;
    const preload = new Image();
    let cancelled = false;
    preload.src = image(photos[requested]);
    void preload.decode().then(() => {
      if (cancelled) return;
      setPrevious(active);
      setActive(requested);
    }, () => {
      if (!cancelled) setRequested(active);
    });
    return () => { cancelled = true; };
  }, [requested, active]);

  function move(direction: number) {
    setRequested((index) => (index + direction + photos.length) % photos.length);
  }

  return (
    <div className="dormon-gallery">
      <div className="dormon-gallery-stage" data-dormon-reveal="photo">
        {previous !== undefined && <img src={image(photos[previous])} alt="" aria-hidden="true" />}
        <img key={active} className={previous === undefined ? undefined : 'dormon-gallery-enter'}
          src={image(photos[active])} alt={t.galleryLabels[active]} loading="lazy" />
        <button className="dormon-gallery-expand" type="button" aria-label={t.enlarge}
          onClick={() => { dialog.current?.showModal(); close.current?.focus(); }}>↗</button>
      </div>
      <div className="dormon-gallery-toolbar">
        <p aria-live="polite">{t.galleryLabels[active]}</p>
        <div className="dormon-gallery-controls">
          <span aria-hidden="true">{String(active + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</span>
          <button type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button>
          <button type="button" onClick={() => move(1)} aria-label={t.next}>→</button>
        </div>
      </div>
      <div className="dormon-gallery-thumbs">
        {photos.map((photo, index) => (
          <button type="button" key={photo} aria-label={t.galleryLabels[index]} aria-pressed={active === index}
            onClick={() => setRequested(index)}>
            <img src={image(photo + '-800')} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      <dialog className="dormon-photo-dialog" ref={dialog} aria-label={t.gallery}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
        }}>
        <button type="button" className="dormon-photo-close" ref={close} aria-label={t.close}
          onClick={() => dialog.current?.close()}>×</button>
        <img src={image(photos[active])} alt={t.galleryLabels[active]} />
        <div className="dormon-gallery-toolbar">
          <p aria-live="polite">{t.galleryLabels[active]}</p>
          <div className="dormon-gallery-controls">
            <button type="button" onClick={() => move(-1)} aria-label={t.previous}>←</button>
            <button type="button" onClick={() => move(1)} aria-label={t.next}>→</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
