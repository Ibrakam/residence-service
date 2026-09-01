import type catalog from '@/data/regnum-plaza-client.json';
import { rememberLastViewedApartment } from '@/app/lead-modal';
import { type RegnumLanguage } from './regnum-ui';

export type RegnumUnit = (typeof catalog.units)[number];

export function regnumLeadSubmitUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_BASE_PATH ?? '';
  const basePath = configured ? `/${configured.replace(/^\/+|\/+$/g, '')}` : '';
  return process.env.NODE_ENV === 'production'
    ? `${basePath}/v1/leads`
    : `${basePath}/api/regnum-plaza-lead`;
}

export function regnumLeadContext(surface: string, language: RegnumLanguage, unit?: RegnumUnit | null) {
  const fields: Array<[string, string]> = [
    ['projectSlug', 'regnum-plaza'], ['lang', language], ['surface', surface],
  ];
  if (unit) fields.push(['unitId', unit.id]);
  return fields.map(([key, value]) => `${key}=${value}`).join(';');
}

export function rememberRegnumUnit(unit: RegnumUnit) {
  rememberLastViewedApartment({ uuid: unit.id }, 'regnum-plaza');
}
