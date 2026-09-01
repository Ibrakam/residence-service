import catalog from '@/data/zamon-catalog.json';
import { leadJson as json, readLeadJson } from '@/app/api/lead-route-security';

type LocalLeadPayload = {
  name?: unknown;
  phone?: unknown;
  goal?: unknown;
  formContext?: unknown;
  projectSlug?: unknown;
  unitId?: unknown;
  language?: unknown;
  lastViewedApartment?: unknown;
};

const unitIds = new Set((catalog.units as Array<{ id: string }>).map((unit) => unit.id));
const languages = new Set(['ru', 'uz', 'en']);
const goals = new Set(['live', 'invest', 'rent']);

export async function POST(request: Request) {
  const incoming = await readLeadJson<LocalLeadPayload>(request);
  if (!incoming.ok) return incoming.response;
  if (process.env.NODE_ENV === 'production') {
    return json({ success: false, error: 'local_receipt_disabled' }, 404);
  }
  const payload = incoming.value;

  const context = typeof payload.formContext === 'string' ? payload.formContext : '';
  const unitId = typeof payload.unitId === 'string' ? payload.unitId : undefined;
  const lastViewed = payload.lastViewedApartment && typeof payload.lastViewedApartment === 'object'
    ? payload.lastViewedApartment as Record<string, unknown>
    : null;

  if (
    payload.projectSlug !== 'zamon'
    || typeof payload.language !== 'string'
    || !languages.has(payload.language)
    || typeof payload.name !== 'string'
    || payload.name.trim().length < 2
    || typeof payload.phone !== 'string'
    || !/^\+998\d{9}$/.test(payload.phone)
    || typeof payload.goal !== 'string'
    || !goals.has(payload.goal)
    || !context.includes('projectSlug=zamon')
    || !context.includes(`lang=${payload.language}`)
    || !context.includes('surface=')
  ) {
    return json({ success: false, error: 'invalid_payload' }, 422);
  }

  if (unitId) {
    if (!unitIds.has(unitId) || !context.includes(`unitUuid=${unitId}`)) {
      return json({ success: false, error: 'invalid_unit_context' }, 422);
    }
    if (lastViewed) {
      const requiredApartmentFields = ['number', 'rooms', 'area', 'floor', 'maxFloor', 'entrance', 'block', 'blockId', 'price'];
      if (lastViewed.uuid !== unitId || !requiredApartmentFields.every((field) => lastViewed[field] !== undefined)) {
        return json({ success: false, error: 'incomplete_unit_context' }, 422);
      }
    }
  }

  // Development/test receipt only: validate the full form contract without
  // persisting PII or forwarding it to a third party.
  return json({
    success: true,
    mode: 'local-only',
    receipt: {
      projectSlug: 'zamon',
      language: payload.language,
      surface: context.match(/(?:^|;)surface=([^;]+)/)?.[1] ?? 'unknown',
      unitId: unitId ?? null,
    },
  });
}
