'use client';

import { useEffect } from 'react';

export type SaadiyatLanguage = 'ru' | 'uz' | 'en';

export function useSaadiyatDocumentLanguage(language: SaadiyatLanguage) {
  useEffect(() => {
    const root = document.documentElement;
    const previousLanguage = root.lang;

    root.lang = language;

    return () => {
      if (root.lang === language) root.lang = previousLanguage;
    };
  }, [language]);
}
