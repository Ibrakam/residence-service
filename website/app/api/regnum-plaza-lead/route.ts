import publicCatalog from '@/data/regnum-plaza-client.json';
import { forwardLeadJson, leadJson as json, readLeadJson, safeForwardUrl } from '@/app/api/lead-route-security';

type Payload = {
  name?: unknown; phone?: unknown; goal?: unknown; consent?: unknown; formContext?: unknown; projectSlug?: unknown;
  unitId?: unknown; lang?: unknown; language?: unknown; lastViewedApartment?: unknown;
  fbc?: unknown; fbp?: unknown; fbclid?: unknown; utm_source?: unknown; utm_medium?: unknown; utm_campaign?: unknown;
  utm_content?: unknown; utm_term?: unknown; tcid?: unknown; landing_url?: unknown; referrer_url?: unknown;
};
type Unit = (typeof publicCatalog.units)[number];

const units = new Map((publicCatalog.units as Unit[]).map((unit) => [unit.id, unit]));
const languages = new Set(['ru', 'uz', 'en']);
const goals = new Set(['live', 'invest', 'rent']);
const surfaces = new Set(['landing:header', 'landing:menu', 'landing:hero', 'landing:amenities', 'landing:catalog-preview', 'landing:footer', 'catalog:header', 'catalog:hero', 'catalog:card', 'catalog:matrix', 'catalog:matrix-plus', 'catalog:plan', 'catalog:empty', 'catalog:footer']);
const trackingKeys = ['fbc', 'fbp', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'tcid', 'landing_url', 'referrer_url'] as const;

function parseContext(value: string) {
  const entries = new Map<string, string>();
  for (const part of value.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) return null;
    const key = part.slice(0, index);
    if (entries.has(key)) return null;
    entries.set(key, part.slice(index + 1));
  }
  return entries;
}

function publicUnitContext(unit: Unit) {
  return {
    projectSlug: 'regnum-plaza',
    unitId: unit.id,
    number: unit.number,
    rooms: unit.rooms,
    area: unit.area,
    floor: unit.floor,
    queue: unit.queue,
    section: unit.section,
    completion: unit.completion,
    status: unit.status,
    publicPrice: false,
    displayPrice: 'price-on-request',
  };
}

function canonicalContextString(surface: string, language: string, unit: Unit | null) {
  const fields: Array<[string, string]> = [['projectSlug', 'regnum-plaza'], ['lang', language], ['surface', surface]];
  if (unit) fields.push(['unitId', unit.id]);
  return fields.map(([key, value]) => `${key}=${value}`).join(';');
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

function forwardUrl() {
  const exact = process.env.REGNUM_LEAD_FORWARD_URL?.trim() || process.env.LEAD_BACKEND_URL?.trim();
  const catalogBase = process.env.CATALOG_API_URL?.trim();
  const candidate = exact || (catalogBase ? `${catalogBase.replace(/\/+$/, '')}/v1/leads` : '');
  if (!candidate) return null;
  return safeForwardUrl(candidate);
}

export async function POST(request: Request) {
  const incoming = await readLeadJson<Payload>(request);
  if (!incoming.ok) return incoming.response;
  const payload = incoming.value;

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone : '';
  const goal = typeof payload.goal === 'string' ? payload.goal : '';
  const language = typeof payload.language === 'string' ? payload.language : '';
  const explicitLang = typeof payload.lang === 'string' ? payload.lang : '';
  const rawContext = typeof payload.formContext === 'string' ? payload.formContext : '';
  const context = parseContext(rawContext);
  if (name.length < 2 || !/^\+998\d{9}$/.test(phone) || !goals.has(goal) || payload.consent !== true) return json({ success: false, error: 'invalid_fields_or_consent' }, 422);
  if (payload.projectSlug !== 'regnum-plaza' || !languages.has(language) || explicitLang !== language) return json({ success: false, error: 'invalid_project_or_language' }, 422);
  if (!context || context.get('projectSlug') !== 'regnum-plaza' || context.get('lang') !== language || !surfaces.has(context.get('surface') ?? '')) return json({ success: false, error: 'invalid_context' }, 422);
  if ([...context.keys()].some((key) => !['projectSlug', 'lang', 'surface', 'unitId'].includes(key))) return json({ success: false, error: 'unexpected_context_fields' }, 422);

  const requestedUnitId = typeof payload.unitId === 'string' || typeof payload.unitId === 'number' ? String(payload.unitId) : '';
  const contextUnitId = context.get('unitId') ?? '';
  if (requestedUnitId !== contextUnitId) return json({ success: false, error: 'unit_identity_mismatch' }, 422);
  const unit = requestedUnitId ? units.get(requestedUnitId) ?? null : null;
  if (requestedUnitId && !unit) return json({ success: false, error: 'invalid_unit_id' }, 422);

  let viewedUnit: Unit | null = null;
  if (payload.lastViewedApartment !== undefined && payload.lastViewedApartment !== null) {
    if (typeof payload.lastViewedApartment !== 'object') return json({ success: false, error: 'invalid_last_viewed_unit' }, 422);
    const viewedId = 'uuid' in payload.lastViewedApartment && typeof payload.lastViewedApartment.uuid === 'string' ? payload.lastViewedApartment.uuid : '';
    viewedUnit = viewedId ? units.get(viewedId) ?? null : null;
    if (!viewedUnit) return json({ success: false, error: 'invalid_last_viewed_unit' }, 422);
  }

  const surface = context.get('surface')!;
  const testMarker = process.env.NODE_ENV !== 'production'
    && (request.headers.get('x-regnum-qa') === '1' || /(^|\s)(qa|test|тест)(\s|$)/iu.test(name));
  if (testMarker) return json({ success: true, receipt: 'qa-test-local-only', projectSlug: 'regnum-plaza', lang: language, unitValidated: unit?.id ?? null, lastViewedValidated: viewedUnit?.id ?? null, publicCatalogValidated: true, stored: false, forwarded: false });

  const destination = forwardUrl();
  if (!destination) {
    if (process.env.NODE_ENV === 'production') return json({ success: false, error: 'lead_delivery_unconfigured' }, 503);
    return json({ success: true, receipt: 'development-local-only', projectSlug: 'regnum-plaza', lang: language, unitValidated: unit?.id ?? null, lastViewedValidated: viewedUnit?.id ?? null, publicCatalogValidated: true, stored: false, forwarded: false });
  }

  const tracking = Object.fromEntries(trackingKeys.flatMap((key) => {
    const value = optionalString(payload[key]);
    return value === undefined ? [] : [[key, value]];
  }));
  const forwardPayload = {
    name,
    phone,
    goal,
    consent: true,
    projectSlug: 'regnum-plaza',
    lang: language,
    language,
    surface,
    unitId: unit?.id ?? null,
    unit: unit ? publicUnitContext(unit) : null,
    lastViewedApartment: viewedUnit ? publicUnitContext(viewedUnit) : null,
    formContext: canonicalContextString(surface, language, unit),
    ...tracking,
  };
  const forwarded = await forwardLeadJson(destination, forwardPayload);
  if (!forwarded.ok) return json({ success: false, error: forwarded.error }, 502);
  if (forwarded.status < 200 || forwarded.status >= 300) return json({ success: false, error: 'forward_failed' }, 502);
  return json({ success: true, projectSlug: 'regnum-plaza', lang: language, unitValidated: unit?.id ?? null, publicCatalogValidated: true, stored: false, forwarded: true });
}
