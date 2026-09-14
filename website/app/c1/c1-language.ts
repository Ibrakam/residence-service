'use client';

import { useEffect } from 'react';

export type C1Language = 'ru' | 'uz' | 'en';

export function useC1DocumentLanguage(language: C1Language) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { if (root.lang === language) root.lang = previous; };
  }, [language]);
}
