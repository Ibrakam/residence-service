export type CatalogLanguage = 'ru' | 'uz' | 'en';
export type CatalogQuery = Record<string, string | string[] | undefined>;

export type PublishedPlan = {
  id: string;
  block: string;
  rooms: number;
  area: number;
  plan: string;
  floorPlan?: string | null;
  floors?: string | null;
};

export type PlanFilters = {
  block: string;
  rooms: string;
  minArea: string;
  maxArea: string;
};

export const emptyFilters: PlanFilters = { block: '', rooms: '', minArea: '', maxArea: '' };
export const projectPath = '/dormon-hills';
export const catalogPath = `${projectPath}/apartments`;
export const basePath = (process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '').replace(/\/$/, '');

const marketingKeys = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id',
  'tcid', 'fbclid', 'gclid',
]);

function firstQueryValue(value: CatalogQuery[string]) {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export function catalogLanguage(query: CatalogQuery): CatalogLanguage {
  const language = firstQueryValue(query.lang);
  return language === 'en' || language === 'uz' ? language : 'ru';
}

export function attributionQuery(query: CatalogQuery) {
  const params = new URLSearchParams();
  for (const [key, entry] of Object.entries(query)) {
    const value = firstQueryValue(entry);
    if (marketingKeys.has(key) && value) params.set(key, value);
  }
  return params.toString();
}

function areaValue(value: string) {
  return /^(?:\d{1,4})(?:\.\d{1,2})?$/.test(value) && Number(value) <= 9999 ? value : '';
}

export function initialPlanFilters(query: CatalogQuery, plans: readonly PublishedPlan[]): PlanFilters {
  const block = firstQueryValue(query.block);
  const rooms = firstQueryValue(query.rooms);
  return {
    block: plans.some(plan => plan.block === block) ? block : '',
    rooms: plans.some(plan => String(plan.rooms) === rooms) ? rooms : '',
    minArea: areaValue(firstQueryValue(query.minArea)),
    maxArea: areaValue(firstQueryValue(query.maxArea)),
  };
}

export function isLegacyPlanPreviewQuery(query: CatalogQuery, plans: readonly PublishedPlan[]): boolean {
  const filters = initialPlanFilters(query, plans);
  return Boolean(filters.block && filters.rooms && filters.minArea && filters.maxArea
    && Number(filters.minArea) === Number(filters.maxArea)
    && plans.some(plan => plan.block === filters.block && String(plan.rooms) === filters.rooms
      && plan.area === Number(filters.minArea)));
}

export function catalogHref(path: string, language: CatalogLanguage, attribution = '', filters?: PlanFilters) {
  const params = new URLSearchParams(attribution);
  params.set('lang', language);
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
  }
  return `${basePath}${path}?${params.toString()}`;
}

export const copy = {
  ru: {
    project: 'О проекте',
    contact: 'Получить консультацию',
    title: 'Планировки квартир',
    description: 'Сравните типовые планировки Do’rmon Hills по блоку, количеству комнат и площади. Цены и наличие уточнит менеджер TenCorp.',
    filters: 'Подбор планировки',
    block: 'Блок',
    rooms: 'Комнаты',
    allBlocks: 'Все блоки',
    allRooms: 'Любое количество',
    areaFrom: 'Площадь от, м²',
    areaTo: 'Площадь до, м²',
    reset: 'Сбросить фильтры',
    invalidArea: 'Минимальная площадь больше максимальной. Проверьте диапазон.',
    count: (value: number) => `Найдено планировок: ${value}`,
    empty: 'Подходящих планировок нет',
    emptyDescription: 'Измените диапазон площади или сбросьте фильтры.',
    plan: 'План квартиры',
    floorPlan: 'План этажа',
    view: 'Смотреть планировку',
    close: 'Закрыть планировку',
    inquire: 'Узнать цену',
    floors: (value: string) => `Этажи ${value}`,
    roomsLabel: (value: number) => value === 1 ? '1 комната' : `${value} комнаты`,
    imagePlaceholder: 'Планировка не загрузилась',
    district: 'Кибрайский район',
    business: 'Бизнес-класс',
    heroAlt: 'Визуализация Do’rmon Hills от Millennium House',
  },
  uz: {
    project: 'Loyiha haqida',
    contact: 'Maslahat olish',
    title: 'Xonadon rejalari',
    description: 'Do’rmon Hills xonadonlarining namunaviy rejalarini blok, xonalar soni va maydon bo‘yicha taqqoslang. Narx va mavjudligini TenCorp menejeri aniqlashtiradi.',
    filters: 'Rejani tanlash',
    block: 'Blok',
    rooms: 'Xonalar',
    allBlocks: 'Barcha bloklar',
    allRooms: 'Xonalar soni muhim emas',
    areaFrom: 'Maydon, m² dan',
    areaTo: 'Maydon, m² gacha',
    reset: 'Filtrlarni tozalash',
    invalidArea: 'Minimal maydon maksimal maydondan katta. Oraliqni tekshiring.',
    count: (value: number) => `${value} ta reja topildi`,
    empty: 'Mos rejalar topilmadi',
    emptyDescription: 'Maydon oralig‘ini o‘zgartiring yoki filtrlarni tozalang.',
    plan: 'Xonadon rejasi',
    floorPlan: 'Qavat rejasi',
    view: 'Rejani ko‘rish',
    close: 'Rejani yopish',
    inquire: 'Narxni bilish',
    floors: (value: string) => `${value}-qavatlar`,
    roomsLabel: (value: number) => `${value} xona`,
    imagePlaceholder: 'Rejani yuklab bo‘lmadi',
    district: 'Qibray tumani',
    business: 'Biznes klass',
    heroAlt: 'Millennium House taqdim etgan Do’rmon Hills vizualizatsiyasi',
  },
  en: {
    project: 'About the project',
    contact: 'Request a consultation',
    title: 'Apartment floor plans',
    description: 'Compare Do’rmon Hills layout types by block, room count and area. Your TenCorp manager can confirm prices and availability.',
    filters: 'Find a floor plan',
    block: 'Block',
    rooms: 'Rooms',
    allBlocks: 'All blocks',
    allRooms: 'Any room count',
    areaFrom: 'Minimum area, m²',
    areaTo: 'Maximum area, m²',
    reset: 'Reset filters',
    invalidArea: 'Minimum area exceeds maximum area. Check the range.',
    count: (value: number) => `${value} ${value === 1 ? 'floor plan' : 'floor plans'} found`,
    empty: 'No floor plans match',
    emptyDescription: 'Change the area range or reset the filters.',
    plan: 'Apartment plan',
    floorPlan: 'Building floor plan',
    view: 'View floor plan',
    close: 'Close floor plan',
    inquire: 'Ask about pricing',
    floors: (value: string) => `Floors ${value}`,
    roomsLabel: (value: number) => `${value} ${value === 1 ? 'room' : 'rooms'}`,
    imagePlaceholder: 'The floor plan could not be loaded',
    district: 'Qibray District',
    business: 'Business class',
    heroAlt: 'Do’rmon Hills visualisation by Millennium House',
  },
};
