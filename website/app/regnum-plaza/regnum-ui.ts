export type RegnumLanguage = 'ru' | 'uz' | 'en';

let bodyLockDepth = 0;
let previousOverflow = '';
let previousPaddingRight = '';

export function lockRegnumBody() {
  if (bodyLockDepth === 0) {
    previousOverflow = document.body.style.overflow;
    previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const currentPadding = Number.parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${currentPadding + scrollbarWidth}px`;
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
    }
  };
}

export function regnumLocale(language: RegnumLanguage) {
  return language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-US';
}

export function priceOnRequest(language: RegnumLanguage) {
  return language === 'ru' ? 'По запросу' : language === 'uz' ? 'So‘rov bo‘yicha' : 'Price on request';
}
