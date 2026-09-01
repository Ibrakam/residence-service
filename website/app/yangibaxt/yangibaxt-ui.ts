export type YangiBaxtLanguage = 'ru' | 'uz' | 'en';

let lockDepth = 0;
let previousOverflow = '';
let previousPadding = '';

export function lockYangiBaxtBody() {
  if (lockDepth === 0) {
    previousOverflow = document.body.style.overflow;
    previousPadding = document.body.style.paddingRight;
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbar > 0) document.body.style.paddingRight = `${currentPadding + scrollbar}px`;
  }
  lockDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockDepth = Math.max(0, lockDepth - 1);
    if (lockDepth === 0) {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPadding;
    }
  };
}

export function yangiBaxtLocale(language: YangiBaxtLanguage) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US';
}

export function yangiBaxtLanguageTag(language: YangiBaxtLanguage) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en';
}
