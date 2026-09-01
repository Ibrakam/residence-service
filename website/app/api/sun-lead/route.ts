import publicCatalog from '@/data/sun-client.json';
import { forwardLeadJson, leadJson as json, readLeadJson, safeForwardUrl } from '@/app/api/lead-route-security';

type Payload = {
  name?: unknown;
  phone?: unknown;
  goal?: unknown;
  consent?: unknown;
  formContext?: unknown;
  projectSlug?: unknown;
  unitId?: unknown;
  unitKey?: unknown;
  lang?: unknown;
  language?: unknown;
  lastViewedApartment?: unknown;
  fbc?: unknown;
  fbp?: unknown;
  fbclid?: unknown;
  utm_source?: unknown;
  utm_medium?: unknown;
  utm_campaign?: unknown;
  utm_content?: unknown;
  utm_term?: unknown;
  tcid?: unknown;
  landing_url?: unknown;
  referrer_url?: unknown;
};

type Unit = (typeof publicCatalog.units)[number];
type Language = 'ru' | 'uz' | 'en';

const units = new Map<string, Unit>((publicCatalog.units as Unit[]).map((unit) => [unit.unitKey, unit]));
const languages = new Set<Language>(['ru', 'uz', 'en']);
const goals = new Set(['live', 'invest', 'rent']);
const surfaces = new Set([
  'landing:header', 'landing:menu', 'landing:hero', 'landing:evidence', 'landing:dayline',
  'landing:amenities', 'landing:catalog-preview', 'landing:location', 'landing:footer',
  'catalog:header', 'catalog:hero', 'catalog:card', 'catalog:empty', 'catalog:matrix',
  'catalog:plan', 'catalog:footer',
]);
const trackingKeys = [
  'fbc', 'fbp', 'fbclid', 'utm_source', 'utm_medium', 'utm_campaign',
  'utm_content', 'utm_term', 'tcid', 'landing_url', 'referrer_url',
] as const;

if (publicCatalog.schemaVersion !== 2 || publicCatalog.units.length !== 51 || units.size !== publicCatalog.units.length) {
  throw new Error('SUN sanitized catalogue must contain 51 unique public unit keys');
}
for (const unit of publicCatalog.units as Unit[]) {
  const serialized = JSON.stringify(unit);
  if (!/^sun-[a-z0-9-]+$/.test(unit.unitKey)
    || unit.id !== unit.unitKey
    || unit.status !== 'available'
    || unit.price !== unit.effectivePrice
    || unit.regularPrice !== unit.effectivePrice
    || unit.snapshotCampaignPrice !== null
    || unit.campaignActive !== false
    || unit.campaignDeadline !== null
    || !unit.primaryPlanPath.startsWith('/sun/plans/')
    || !unit.secondPlanPath.startsWith('/sun/plans/')
    || /(?:crm|internal|houseId|planId|fileId|sourceUrl|signed|auth_token)/i.test(serialized)) {
    throw new Error(`SUN public unit ${unit.unitKey} violates the sanitized lead contract`);
  }
}

function parseContext(value: string) {
  if (!value || value.length > 512) return null;
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

function canonicalUnit(unit: Unit, language: Language) {
  return {
    projectSlug: 'sun',
    unitKey: unit.unitKey,
    number: unit.number,
    title: unit.title,
    block: unit.block,
    blockName: unit.blockName,
    floor: unit.floor,
    maxFloor: unit.maxFloor,
    entrance: unit.entrance,
    rooms: unit.rooms,
    area: unit.area,
    currency: 'UZS',
    status: unit.status,
    price: unit.price,
    effectivePrice: unit.effectivePrice,
    displayPrice: unit.displayPrice[language],
    regularPrice: unit.regularPrice,
    pricePerM2: unit.pricePerM2,
    snapshotCampaignPrice: unit.snapshotCampaignPrice,
    campaignActive: unit.campaignActive,
    campaignDeadline: unit.campaignDeadline,
    plans: {
      primary: { publicPath: unit.primaryPlanPath },
      second: { publicPath: unit.secondPlanPath },
    },
    windowView: unit.windowView,
  };
}

function canonicalContextString(surface: string, language: Language, unit: Unit | null) {
  const fields: Array<[string, string | number | boolean | null]> = [
    ['projectSlug', 'sun'], ['lang', language], ['surface', surface],
  ];
  if (unit) {
    fields.push(
      ['unitKey', unit.unitKey], ['number', unit.number], ['block', unit.block],
      ['floor', `${unit.floor}/${unit.maxFloor}`], ['entrance', unit.entrance],
      ['rooms', unit.rooms], ['area', unit.area], ['status', unit.status],
      ['price', unit.price], ['effectivePrice', unit.effectivePrice],
      ['displayPrice', unit.displayPrice[language]], ['regularPrice', unit.regularPrice],
      ['pricePerM2', unit.pricePerM2], ['snapshotCampaignPrice', unit.snapshotCampaignPrice],
      ['campaignActive', unit.campaignActive], ['campaignDeadline', unit.campaignDeadline],
    );
  }
  return fields.map(([key, value]) => `${key}=${value === null ? 'null' : String(value)}`).join(';');
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length <= 2048 ? value : undefined;
}

function publicUnitKey(value: unknown) {
  return typeof value === 'string' && /^sun-[a-z0-9-]+$/.test(value) ? value : null;
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

  if (name.length < 2 || name.length > 120 || /[\u0000-\u001f\u007f]/u.test(name) || !/^\+998\d{9}$/.test(phone) || !goals.has(goal) || payload.consent !== true) {
    return json({ success: false, error: 'invalid_fields_or_consent' }, 422);
  }
  if (payload.projectSlug !== 'sun' || !languages.has(language as Language) || explicitLang !== language) {
    return json({ success: false, error: 'invalid_project_or_language' }, 422);
  }
  if (payload.unitId !== undefined) return json({ success: false, error: 'private_unit_id_not_accepted' }, 422);
  if (!context || context.get('projectSlug') !== 'sun' || context.get('lang') !== language || !surfaces.has(context.get('surface') ?? '')) {
    return json({ success: false, error: 'invalid_context' }, 422);
  }
  if ([...context.keys()].some((key) => !['projectSlug', 'lang', 'surface', 'unitKey'].includes(key))) {
    return json({ success: false, error: 'unexpected_context_fields' }, 422);
  }

  const payloadHasUnit = payload.unitKey !== undefined && payload.unitKey !== null;
  const contextHasUnit = context.has('unitKey');
  if (payloadHasUnit !== contextHasUnit) return json({ success: false, error: 'unit_identity_mismatch' }, 422);

  let unit: Unit | null = null;
  if (payloadHasUnit) {
    const requestedUnitKey = publicUnitKey(payload.unitKey);
    if (requestedUnitKey === null || context.get('unitKey') !== requestedUnitKey) {
      return json({ success: false, error: 'unit_identity_mismatch' }, 422);
    }
    unit = units.get(requestedUnitKey) ?? null;
    if (!unit) return json({ success: false, error: 'invalid_unit_key' }, 422);
  }

  let viewedUnit: Unit | null = null;
  if (payload.lastViewedApartment !== undefined && payload.lastViewedApartment !== null) {
    if (typeof payload.lastViewedApartment !== 'object' || Array.isArray(payload.lastViewedApartment)) {
      return json({ success: false, error: 'invalid_last_viewed_unit' }, 422);
    }
    const viewed = payload.lastViewedApartment as Record<string, unknown>;
    if ('uuid' in viewed || 'unitId' in viewed || 'crmId' in viewed || 'internalId' in viewed) {
      return json({ success: false, error: 'invalid_last_viewed_unit' }, 422);
    }
    const viewedKey = publicUnitKey(viewed.unitKey);
    viewedUnit = viewedKey === null ? null : units.get(viewedKey) ?? null;
    if (!viewedUnit) return json({ success: false, error: 'invalid_last_viewed_unit' }, 422);
  }

  const lang = language as Language;
  const surface = context.get('surface')!;
  const canonical = unit ? canonicalUnit(unit, lang) : null;
  const canonicalViewed = viewedUnit ? canonicalUnit(viewedUnit, lang) : null;
  const testMarker = process.env.NODE_ENV !== 'production'
    && (request.headers.get('x-sun-qa') === '1' || /(^|\s)(qa|test|тест)(\s|$)/iu.test(name));
  if (testMarker) {
    return json({
      success: true, receipt: 'qa-test-local-only', projectSlug: 'sun', lang,
      unitValidated: unit?.unitKey ?? null, lastViewedValidated: viewedUnit?.unitKey ?? null,
      canonicalized: true, priceContractAttached: Boolean(canonical || canonicalViewed),
      stored: false, forwarded: false,
    });
  }

  const forwardUrl = process.env.LEAD_FORWARD_URL?.trim() || process.env.SUN_LEAD_FORWARD_URL?.trim();
  if (!forwardUrl) {
    if (process.env.NODE_ENV === 'production') return json({ success: false, error: 'lead_delivery_unconfigured' }, 503);
    return json({
      success: true, receipt: 'development-local-only', projectSlug: 'sun', lang,
      unitValidated: unit?.unitKey ?? null, lastViewedValidated: viewedUnit?.unitKey ?? null,
      canonicalized: true, priceContractAttached: Boolean(canonical || canonicalViewed),
      stored: false, forwarded: false,
    });
  }

  let candidateUrl: URL;
  try {
    candidateUrl = new URL(forwardUrl);
  } catch {
    return json({ success: false, error: 'invalid_forward_configuration' }, 503);
  }
  const parsedUrl = safeForwardUrl(candidateUrl.href, true);
  if (!parsedUrl) {
    return json({ success: false, error: 'unsafe_forward_configuration' }, 503);
  }

  const tracking = Object.fromEntries(trackingKeys.flatMap((key) => {
    const value = optionalString(payload[key]);
    return value === undefined ? [] : [[key, value]];
  }));
  const forwardPayload = {
    name, phone, goal, consent: true, projectSlug: 'sun', lang, language: lang, surface,
    unitKey: unit?.unitKey ?? null, unit: canonical, lastViewedApartment: canonicalViewed,
    formContext: canonicalContextString(surface, lang, unit), ...tracking,
  };

  const forwarded = await forwardLeadJson(parsedUrl, forwardPayload);
  if (!forwarded.ok) return json({ success: false, error: forwarded.error }, 502);
  if (forwarded.status < 200 || forwarded.status >= 300) return json({ success: false, error: 'forward_failed' }, 502);
  return json({
    success: true, projectSlug: 'sun', lang,
    unitValidated: unit?.unitKey ?? null, lastViewedValidated: viewedUnit?.unitKey ?? null,
    canonicalized: true, stored: false, forwarded: true,
  });
}
