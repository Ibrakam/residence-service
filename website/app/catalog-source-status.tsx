'use client';

import type { CatalogDataSource } from './live-catalog';
import './catalog-source-status.css';

const copy = {
  ru: { loading: 'Загружаем каталог…', error: 'Не удалось открыть каталог. Попробуйте ещё раз.', retry: 'Повторить' },
  uz: { loading: 'Katalog yuklanmoqda…', error: 'Katalog ochilmadi. Qayta urinib ko‘ring.', retry: 'Qayta urinish' },
  en: { loading: 'Loading the catalogue…', error: 'The catalogue could not open. Please try again.', retry: 'Try again' },
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

export function CatalogSourceStatus({ language = 'ru', isLoading, loadError, hasData = true, onRetry }: CatalogSourceStatusProps) {
  // Capture times and provider health remain technical metadata. Public pages
  // only need feedback when there is no catalogue content to display.
  if (hasData || (!isLoading && !loadError)) return null;
  const t = copy[language];
  return <div className={`catalog-source-status${loadError && !isLoading ? ' is-warning' : ''}`} role="status" aria-live="polite" aria-atomic="true">
    <div><strong>{isLoading ? t.loading : t.error}</strong></div>
    {onRetry && loadError ? <button type="button" disabled={isLoading} onClick={onRetry}>{isLoading ? t.loading : t.retry}</button> : null}
  </div>;
}
