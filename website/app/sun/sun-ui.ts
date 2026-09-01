'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export type SunLanguage = 'ru' | 'uz' | 'en';

export const sunLanguages: readonly SunLanguage[] = ['ru', 'uz', 'en'];

let bodyLockDepth = 0;
let previousOverflow = '';
let previousPaddingRight = '';

export function lockSunBody() {
  if (bodyLockDepth === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
    document.body.classList.add('sun-body-locked');
  }
  bodyLockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    bodyLockDepth = Math.max(0, bodyLockDepth - 1);
    if (bodyLockDepth === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      document.body.classList.remove('sun-body-locked');
    }
  };
}

export function sunLocale(language: SunLanguage) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US';
}

export function formatSunNumber(value: number, language: SunLanguage, maximumFractionDigits = 2) {
  return new Intl.NumberFormat(sunLocale(language), { maximumFractionDigits }).format(value);
}

export function formatSunPrice(value: number, language: SunLanguage) {
  return `${new Intl.NumberFormat(sunLocale(language), { maximumFractionDigits: 0 }).format(value)} UZS`;
}

export function sunBasePath() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  return configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';
}

export function sunAsset(path: string) {
  return `${sunBasePath()}${path}`;
}

export function sunPath(path: string, language: SunLanguage) {
  return `${sunBasePath()}${path}?lang=${language}`;
}

const languageStorageKey = 'sun-language';

export function useSunLanguage(initialLanguage: SunLanguage) {
  const pathname = usePathname();
  const router = useRouter();
  const [language, setLanguageState] = useState<SunLanguage>(initialLanguage);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const explicit = params.get('lang');
    if (explicit === 'ru' || explicit === 'uz' || explicit === 'en') {
      try { window.localStorage.setItem(languageStorageKey, explicit); } catch { /* optional preference */ }
      document.documentElement.lang = explicit;
      const frame = window.requestAnimationFrame(() => setLanguageState(explicit));
      return () => window.cancelAnimationFrame(frame);
    }
    let stored: string | null = null;
    try { stored = window.localStorage.getItem(languageStorageKey); } catch { /* optional preference */ }
    const next: SunLanguage = stored === 'uz' || stored === 'en' ? stored : initialLanguage;
    params.set('lang', next);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    document.documentElement.lang = next;
    const frame = window.requestAnimationFrame(() => setLanguageState(next));
    return () => window.cancelAnimationFrame(frame);
  }, [initialLanguage, pathname, router]);

  const setLanguage = useCallback((next: SunLanguage) => {
    setLanguageState(next);
    try { window.localStorage.setItem(languageStorageKey, next); } catch { /* optional preference */ }
    const params = new URLSearchParams(window.location.search);
    params.set('lang', next);
    router.replace(`${pathname}?${params.toString()}${window.location.hash}`, { scroll: false });
    document.documentElement.lang = next;
  }, [pathname, router]);

  return [language, setLanguage] as const;
}

export function useSunMobile(query = '(max-width: 900px)') {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return mobile;
}
