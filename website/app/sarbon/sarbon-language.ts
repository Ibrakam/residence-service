"use client";

import { useEffect } from "react";

export type SarbonLanguage = "ru" | "uz" | "en";

export function useSarbonDocumentLanguage(language: SarbonLanguage) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { if (root.lang === language) root.lang = previous; };
  }, [language]);
}
