export const MIRADOR_VISUAL_FLOW_MEDIA = '(min-width: 768px) and (min-height: 600px)';

const catalogIntentKeys = ['mode', 'queue', 'building', 'phase', 'entrance', 'floor', 'rooms', 'areaFrom', 'areaTo', 'sort', 'unitKey', 'unit', 'unitEntrance', 'unitFloor'];

export function hasMiradorCatalogIntent(search: string | URLSearchParams) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  return catalogIntentKeys.some((key) => params.has(key));
}
