import type snapshotJson from '@/data/sun-client.json';
import { rememberLastViewedApartment } from '@/app/lead-modal';
import type { SunLanguage } from './sun-ui';

export type SunUnit = (typeof snapshotJson.units)[number];

export function sunLeadSubmitUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const basePath = configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';
  return process.env.NODE_ENV === 'production'
    ? `${basePath}/v1/leads`
    : `${basePath}/api/sun-lead`;
}

export function sunLeadContext(surface: string, language: SunLanguage, unit?: SunUnit | null) {
  const fields: Array<[string, string]> = [
    ['projectSlug', 'sun'],
    ['lang', language],
    ['surface', surface],
  ];
  if (unit) fields.push(['unitKey', String(unit.unitKey)]);
  return fields.map(([key, value]) => `${key}=${value}`).join(';');
}

export function rememberSunUnit(unit: SunUnit) {
  rememberLastViewedApartment({ unitKey: String(unit.unitKey) }, 'sun');
}
