import catalog from '@/data/yangibaxt-catalog.json';
import { leadJson as json, readLeadJson } from '@/app/api/lead-route-security';

type Payload = {
  name?: unknown;
  phone?: unknown;
  goal?: unknown;
  formContext?: unknown;
  projectSlug?: unknown;
  unitId?: unknown;
  language?: unknown;
  lastViewedApartment?: unknown;
};

type Unit = (typeof catalog.units)[number];
type Viewed = {
  uuid?: unknown;
  number?: unknown;
  rooms?: unknown;
  area?: unknown;
  floor?: unknown;
  maxFloor?: unknown;
  entrance?: unknown;
  block?: unknown;
  blockName?: unknown;
  blockId?: unknown;
  price?: unknown;
  normalizedDeadline?: unknown;
  sourceStatus?: unknown;
  studio?: unknown;
  viewedAt?: unknown;
  url?: unknown;
};

const units = new Map((catalog.units as Unit[]).map((unit) => [unit.id, unit]));
const languages = new Set(['ru', 'uz', 'en']);
const goals = new Set(['live', 'invest', 'rent']);

function exactViewed(viewed: Viewed, unit: Unit) {
  return viewed.uuid === unit.id
    && viewed.number === unit.number
    && viewed.rooms === unit.rooms
    && viewed.area === unit.area
    && viewed.floor === unit.floor
    && viewed.maxFloor === unit.totalFloors
    && viewed.entrance === unit.entrance
    && viewed.block === unit.building
    && viewed.blockName === unit.building
    && viewed.blockId === unit.buildingId
    && viewed.price === unit.price
    && viewed.normalizedDeadline === unit.completionDate
    && viewed.sourceStatus === unit.statusOriginal
    && viewed.studio === unit.studio
    && typeof viewed.viewedAt === 'string'
    && typeof viewed.url === 'string';
}

export async function POST(request: Request) {
  const incoming = await readLeadJson<Payload>(request);
  if (!incoming.ok) return incoming.response;
  if (process.env.NODE_ENV === 'production') return json({ success: false, error: 'local_receipt_disabled' }, 404);
  const payload = incoming.value;

  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const phone = typeof payload.phone === 'string' ? payload.phone : '';
  const language = typeof payload.language === 'string' ? payload.language : '';
  const context = typeof payload.formContext === 'string' ? payload.formContext : '';
  const goal = typeof payload.goal === 'string' ? payload.goal : '';
  if (name.length < 2 || !/^\+998\d{9}$/.test(phone) || !goals.has(goal)) return json({ success: false, error: 'invalid_fields' }, 422);
  if (payload.projectSlug !== 'yangibaxt' || !languages.has(language)) return json({ success: false, error: 'invalid_project_or_language' }, 422);
  if (!context.includes('projectSlug=yangibaxt') || !context.includes(`lang=${language}`) || !/(?:^|;)surface=(?:landing|catalog):[a-z0-9-]+(?:;|$)/.test(context)) {
    return json({ success: false, error: 'invalid_context' }, 422);
  }

  const unitId = typeof payload.unitId === 'string' ? payload.unitId : '';
  if (unitId) {
    const unit = units.get(unitId);
    const viewed = payload.lastViewedApartment && typeof payload.lastViewedApartment === 'object' ? payload.lastViewedApartment as Viewed : null;
    if (!unit || !context.includes(`unitUuid=${unitId}`) || !viewed || !exactViewed(viewed, unit)) {
      return json({ success: false, error: 'invalid_unit_context' }, 422);
    }
  } else if (context.includes('unitUuid=')) {
    return json({ success: false, error: 'unexpected_unit_context' }, 422);
  }

  return json({
    success: true,
    receipt: 'development-only',
    projectSlug: 'yangibaxt',
    language,
    unitValidated: unitId || null,
    stored: false,
    forwarded: false,
  });
}
