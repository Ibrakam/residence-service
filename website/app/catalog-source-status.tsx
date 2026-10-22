'use client';

import type { CatalogDataSource } from './live-catalog';
import './catalog-source-status.css';

const copy = {
  ru: { live: 'Данные подтверждены источником', stale: 'Данные устарели — наличие и цены нужно подтвердить', unverified: 'Свежесть данных пока не подтверждена', cached: 'Не удалось обновить данные. Показана последняя загруженная версия', embedded: 'Данные источника ещё не получены', loading: 'Проверяем наличие и цены…', error: 'Не удалось загрузить каталог. Это не означает, что квартир нет.', retry: 'Повторить проверку', date: 'Дата данных' },
  uz: { live: 'Ma’lumotlar manba tomonidan tasdiqlangan', stale: 'Ma’lumotlar eskirgan — mavjudlik va narxlarni tasdiqlang', unverified: 'Ma’lumotlarning dolzarbligi hali tasdiqlanmagan', cached: 'Yangilab bo‘lmadi. Oxirgi yuklangan ma’lumotlar ko‘rsatilgan', embedded: 'Manba ma’lumotlari hali olinmagan', loading: 'Mavjudlik va narxlar tekshirilmoqda…', error: 'Katalog yuklanmadi. Bu xonadonlar yo‘q degani emas.', retry: 'Qayta tekshirish', date: 'Ma’lumotlar sanasi' },
  en: { live: 'Data verified with the source', stale: 'Data is outdated — confirm availability and prices', unverified: 'Data freshness has not been verified', cached: 'Update failed. Showing the last loaded data', embedded: 'Source data has not loaded yet', loading: 'Checking availability and prices…', error: 'The catalogue could not load. This does not mean no apartments are available.', retry: 'Try again', date: 'Source date' },
};

export type CatalogSourceStatusProps = {
  language?: keyof typeof copy;
  dataSource: CatalogDataSource;
  refreshedAt?: string;
  isLoading?: boolean;
  loadError?: boolean;
  hasData?: boolean;
  onRetry?: () => void;
};

export function catalogStatusMessage(language: keyof typeof copy, source: CatalogDataSource) {
  return copy[language][source];
}

export function CatalogSourceStatus({ language = 'ru', dataSource, refreshedAt, isLoading, loadError, hasData = true, onRetry }: CatalogSourceStatusProps) {
  const t = copy[language];
  const date = dataSource === 'embedded' ? null : new Date(refreshedAt ?? '');
  const validDate = date && Number.isFinite(date.getTime()) ? date : null;
  const message = !hasData && isLoading ? t.loading : !hasData && loadError ? t.error : t[dataSource];
  const warning = loadError || dataSource === 'stale' || dataSource === 'unverified' || dataSource === 'cached';
  return <div className={`catalog-source-status${warning ? ' is-warning' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <div><strong>{message}</strong>{validDate ? <time dateTime={validDate.toISOString()}>{t.date}: {new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : language === 'uz' ? 'uz-UZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tashkent' }).format(validDate)}</time> : null}</div>
    {onRetry && warning ? <button type="button" disabled={isLoading} onClick={onRetry}>{isLoading ? t.loading : t.retry}</button> : null}
  </div>;
}
