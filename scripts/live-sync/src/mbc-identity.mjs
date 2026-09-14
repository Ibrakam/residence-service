import { createHash } from 'node:crypto';

function text(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function slugify(value) {
  return text(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'main';
}

function templatePhaseSlug(unit) {
  const explicit = text(unit?.phaseSlug);
  if (explicit) return explicit;
  const named = ['phaseName', 'phase', 'block', 'buildingDisplay', 'building']
    .map((key) => text(unit?.[key]))
    .find(Boolean);
  if (named) return slugify(named);
  const queue = text(unit?.queue);
  return slugify(queue ? `Queue ${queue}` : 'Main');
}

/**
 * Matches the backend importer's historical fallback identity for a template
 * that predates explicit sourceKey fields. This keeps already-imported rows
 * addressable when MBC's rotating public id is replaced by stable crm_id.
 */
export function templateMbcSourceKey(projectSlug, unit) {
  const explicit = text(unit?.sourceKey || unit?.unitKey);
  if (explicit) return explicit;
  const sourceId = text(unit?.id ?? unit?.sourceId ?? unit?.uuid);
  if (!sourceId) return null;
  return `catalog:${text(projectSlug)}:${templatePhaseSlug(unit)}:${sha256(sourceId).slice(0, 20)}`;
}

/**
 * Deterministic fallback for a previously unseen CRM row. The stable CRM id is
 * used only as hash input and is never embedded in the public sourceKey.
 */
export function opaqueMbcSourceKey(projectSlug, crmId) {
  const slug = text(projectSlug);
  const identity = text(crmId);
  if (!slug || !identity) throw new Error('MBC source-key namespace and identity are required');
  return `mbc:${slug}:${sha256(`mbc\u0000${slug}\u0000${identity}`).slice(0, 24)}`;
}
