'use client';

import { useEffect } from 'react';

type Language = 'ru' | 'uz' | 'en';

export function PrivacyLanguageSync({ language }: { language: Language }) {
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  return null;
}
