'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef } from 'react';

type Props = {
  src: string;
  alt: string;
  title: string;
  description: string;
  closeLabel: string;
  previousLabel: string;
  nextLabel: string;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
};

const appBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';

export function OfiyatGalleryLightbox({ src, alt, title, description, closeLabel, previousLabel, nextLabel, onClose, onPrevious, onNext }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pointerStartRef = useRef<number | null>(null);
  const actionsRef = useRef({ onClose, onPrevious, onNext });

  useEffect(() => {
    actionsRef.current = { onClose, onPrevious, onNext };
  }, [onClose, onNext, onPrevious]);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        actionsRef.current.onClose();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        actionsRef.current.onPrevious();
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        actionsRef.current.onNext();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => openerRef.current?.isConnected && openerRef.current.focus());
    };
  }, []);

  return <div
    ref={dialogRef}
    className="ofiyat-gallery-lightbox"
    role="dialog"
    aria-modal="true"
    aria-label={title}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    onPointerDown={(event) => { pointerStartRef.current = event.clientX; }}
    onPointerUp={(event) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      if (start === null) return;
      const distance = event.clientX - start;
      if (Math.abs(distance) < 52) return;
      if (distance > 0) onPrevious(); else onNext();
    }}
  >
    <button ref={closeRef} className="ofiyat-gallery-lightbox__close" type="button" onClick={onClose} aria-label={closeLabel}>×</button>
    <button className="ofiyat-gallery-lightbox__previous" type="button" onClick={onPrevious} aria-label={previousLabel}>←</button>
    <figure>
      <img src={src.startsWith('/') ? `${appBasePath}${src}` : src} alt={alt} />
      <figcaption><strong>{title}</strong><span>{description}</span></figcaption>
    </figure>
    <button className="ofiyat-gallery-lightbox__next" type="button" onClick={onNext} aria-label={nextLabel}>→</button>
  </div>;
}
