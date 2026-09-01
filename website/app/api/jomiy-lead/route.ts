import catalog from '@/data/jomiy-catalog.json';
import { leadJson as json, readLeadJson } from '@/app/api/lead-route-security';

type Payload = {
  name?: unknown; phone?: unknown; goal?: unknown; formContext?: unknown; projectSlug?: unknown; unitId?: unknown; lang?: unknown; language?: unknown; lastViewedApartment?: unknown;
};
type Unit = (typeof catalog.units)[number];
type Viewed = {
  uuid?: unknown; number?: unknown; rooms?: unknown; area?: unknown; floor?: unknown; maxFloor?: unknown; entrance?: unknown; block?: unknown; blockName?: unknown; blockId?: unknown; price?: unknown; effectivePrice?: unknown; displayPrice?: unknown; regularPrice?: unknown; snapshotCampaignPrice?: unknown; campaignActive?: unknown; campaignDeadline?: unknown; normalizedDeadline?: unknown; sourceStatus?: unknown; studio?: unknown; viewedAt?: unknown; url?: unknown;
};
type PriceSnapshot = {
  price: number;
  effectivePrice: number;
  displayPrice: number;
  regularPrice: number;
  snapshotCampaignPrice: number;
  campaignActive: boolean;
  campaignDeadline: string | null;
};

const units = new Map((catalog.units as Unit[]).map((unit) => [unit.id, unit]));
const languages = new Set(['ru', 'uz', 'en']);
const goals = new Set(['live', 'invest', 'rent']);

function contextMap(context: string) {
  const entries: Array<[string, string]> = [];
  for (const part of context.split(';')) {
    const index = part.indexOf('=');
    if (index > 0) entries.push([part.slice(0, index), part.slice(index + 1)]);
  }
  return new Map<string, string>(entries);
}
function priceSnapshotAt(unit: Unit, evaluationTime: number): PriceSnapshot {
  const campaignDeadline = unit.promotion?.deadlineUtc ?? null;
  const deadlineTime = campaignDeadline ? Date.parse(campaignDeadline) : Number.NaN;
  const campaignActive = Boolean(unit.promotion) && unit.oldPrice > unit.price && Number.isFinite(deadlineTime) && evaluationTime < deadlineTime;
  const effectivePrice = unit.promotion && unit.oldPrice > unit.price && !campaignActive ? unit.oldPrice : unit.price;
  return { price: effectivePrice, effectivePrice, displayPrice: effectivePrice, regularPrice: unit.oldPrice, snapshotCampaignPrice: unit.price, campaignActive, campaignDeadline };
}
function exactViewed(viewed: Viewed, unit: Unit, pricing: PriceSnapshot) {
  return viewed.uuid === unit.id && viewed.number === unit.number && viewed.rooms === unit.rooms && viewed.area === unit.area && viewed.floor === unit.floor && viewed.maxFloor === unit.totalFloors && viewed.entrance === unit.entrance && viewed.block === unit.building && viewed.blockName === unit.building && viewed.blockId === unit.buildingId && viewed.price === pricing.price && viewed.effectivePrice === pricing.effectivePrice && viewed.displayPrice === pricing.displayPrice && viewed.regularPrice === pricing.regularPrice && viewed.snapshotCampaignPrice === pricing.snapshotCampaignPrice && viewed.campaignActive === pricing.campaignActive && viewed.campaignDeadline === pricing.campaignDeadline && viewed.normalizedDeadline === unit.completionDate && viewed.sourceStatus === unit.statusOriginal && viewed.studio === unit.studio && typeof viewed.viewedAt === 'string' && typeof viewed.url === 'string';
}
function exactContext(context: ReadonlyMap<string, string>, unit: Unit, pricing: PriceSnapshot) {
  return context.get('unitUuid') === unit.id
    && context.get('number') === unit.number
    && context.get('buildingId') === unit.buildingId
    && context.get('building') === unit.building
    && context.get('entrance') === String(unit.entrance)
    && context.get('floor') === `${unit.floor}/${unit.totalFloors}`
    && context.get('rooms') === String(unit.rooms)
    && context.get('area') === String(unit.area)
    && context.get('completion') === unit.completionDate
    && context.get('workflowStatus') === unit.statusOriginal
    && context.get('isSale') === String(unit.isSale)
    && context.get('canBuy') === String(unit.canBuy)
    && context.get('strictOfferEligible') === String(unit.strictOfferEligible)
    && context.get('campaignDeadline') === (pricing.campaignDeadline ?? 'none')
    && context.get('campaignActive') === String(pricing.campaignActive)
    && context.get('repairIncluded') === String(unit.repairIncluded)
    && context.get('studio') === String(unit.studio)
    && context.get('price') === String(pricing.price)
    && context.get('effectivePrice') === String(pricing.effectivePrice)
    && context.get('displayPrice') === String(pricing.displayPrice)
    && context.get('regularPrice') === String(pricing.regularPrice)
    && context.get('snapshotCampaignPrice') === String(pricing.snapshotCampaignPrice);
}

export async function POST(request: Request) {
  const incoming = await readLeadJson<Payload>(request);
  if (!incoming.ok) return incoming.response;
  if (process.env.NODE_ENV === 'production') return json({ success: false, error: 'local_receipt_disabled' }, 404);
  const payload = incoming.value;

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone : '';
  const language = typeof payload.language === 'string' ? payload.language : '';
  const explicitLang = typeof payload.lang === 'string' ? payload.lang : '';
  const context = typeof payload.formContext === 'string' ? payload.formContext : '';
  const parsed = contextMap(context);
  const goal = typeof payload.goal === 'string' ? payload.goal : '';
  if (name.length < 2 || !/^\+998\d{9}$/.test(phone) || !goals.has(goal)) return json({ success: false, error: 'invalid_fields' }, 422);
  if (payload.projectSlug !== 'jomiy' || !languages.has(language) || explicitLang !== language) return json({ success: false, error: 'invalid_project_or_language' }, 422);
  if (parsed.get('projectSlug') !== 'jomiy' || parsed.get('lang') !== language || !/^(landing|catalog):[a-z0-9-]+$/.test(parsed.get('surface') ?? '')) return json({ success: false, error: 'invalid_context' }, 422);

  const unitId = typeof payload.unitId === 'string' ? payload.unitId : '';
  if (unitId) {
    const unit = units.get(unitId);
    const viewed = payload.lastViewedApartment && typeof payload.lastViewedApartment === 'object' ? payload.lastViewedApartment as Viewed : null;
    if (!unit) return json({ success: false, error: 'invalid_unit_context' }, 422);
    const pricing = priceSnapshotAt(unit, Date.now());
    if (!exactContext(parsed, unit, pricing) || !viewed || !exactViewed(viewed, unit, pricing)) return json({ success: false, error: 'invalid_unit_context' }, 422);
  } else if (parsed.has('unitUuid')) {
    return json({ success: false, error: 'unexpected_unit_context' }, 422);
  }

  return json({ success: true, receipt: 'development-only', projectSlug: 'jomiy', lang: language, language, unitValidated: unitId || null, stored: false, forwarded: false });
}
