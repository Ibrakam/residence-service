import type catalog from '@/data/regnum-plaza-client.json';
import { rememberLiveCatalogUnit } from '@/app/lead-modal';
import { type RegnumLanguage } from './regnum-ui';
import { type RegnumQueueUnit } from './regnum-queues';

type EmbeddedRegnumUnit = (typeof catalog.units)[number];
export type RegnumUnit = Omit<EmbeddedRegnumUnit, 'id'> & RegnumQueueUnit & {
  id: string | number;
};

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
  if (unit) fields.push(['unitId', String(unit.id)]);
  return fields.map(([key, value]) => `${key}=${value}`).join(';');
}

export function rememberRegnumUnit(unit: RegnumUnit) {
  rememberLiveCatalogUnit(unit, 'regnum-plaza');
}
