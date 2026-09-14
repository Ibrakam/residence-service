'use client';

import { useEffect } from 'react';

export type SoyLanguage = 'ru' | 'uz' | 'en';

export function useSoyDocumentLanguage(language: SoyLanguage) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { if (root.lang === language) root.lang = previous; };
  }, [language]);
}
