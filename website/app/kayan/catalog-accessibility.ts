export type CatalogAccessibilityLanguage = 'ru' | 'uz' | 'en';
export type CatalogAccessibilityStatus = 'available' | 'reserved' | 'sold' | 'unavailable';

export type AccessibleCatalogUnit = {
  number: string;
  propertyType: string;
  entrance?: string;
  floor: number;
  status: CatalogAccessibilityStatus;
  rooms?: number;
  area: number;
};

const copy = {
  ru: {
    apartment: 'Квартира', parking: 'Машиноместо', entrance: 'Подъезд', floor: 'Этаж', status: 'Статус', rooms: 'комн.', area: 'м²',
    statuses: { available: 'Свободно', reserved: 'Бронь', sold: 'Продано', unavailable: 'Не продаётся' },
  },
  uz: {
    apartment: 'Xonadon', parking: 'Parking o‘rni', entrance: 'Kirish', floor: 'Qavat', status: 'Holat', rooms: 'xona', area: 'm²',
    statuses: { available: 'Mavjud', reserved: 'Band', sold: 'Sotilgan', unavailable: 'Sotuvda emas' },
  },
  en: {
    apartment: 'Apartment', parking: 'Parking space', entrance: 'Entrance', floor: 'Floor', status: 'Status', rooms: 'rooms', area: 'm²',
    statuses: { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Not for sale' },
  },
} as const;

function accessibleFloorLabel(value: number) {
  return value < 0 ? `P${Math.abs(value)}` : String(value);
}

export function catalogUnitAriaLabel({
  projectName,
  phaseLabel,
  language,
  unit,
}: {
  projectName: string;
  phaseLabel: string;
  language: CatalogAccessibilityLanguage;
  unit: AccessibleCatalogUnit;
}) {
  const t = copy[language];
  const objectType = unit.propertyType === 'parking' ? t.parking : t.apartment;
  const details = [
    projectName,
    phaseLabel,
    `${objectType} №${unit.number}`,
    `${t.entrance} ${unit.entrance || '—'}`,
    `${t.floor} ${accessibleFloorLabel(unit.floor)}`,
    `${t.status}: ${t.statuses[unit.status]}`,
  ];
  if (unit.propertyType !== 'parking' && typeof unit.rooms === 'number') {
    const roomsLabel = language === 'en' && unit.rooms === 1 ? 'room' : t.rooms;
    details.push(`${unit.rooms} ${roomsLabel}`);
  }
  details.push(`${unit.area} ${t.area}`);
  return details.join(' · ');
}
