export const dormonSource = 'https://millenniumhouse.uz/dormon-hills';
export const dormonStoreDefault = '/var/lib/residence-dormon-plans';
export const generationPattern = /^[a-f0-9]{24}$/;
export const planFilenamePattern = /^(?:u|floor)-[a-z0-9-]+-[a-f0-9]{12}\.webp$/;
export const sourceAssetPattern = /^\/media\/project-pages\/dormon\/(?:u|floor)-[a-z0-9-]+\.webp$/;
const blocks = new Set(['А', 'Б', 'В', 'Г', 'Д']);

export function validCaptureDate(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.now() + 300_000;
}

/**
 * Validate the complete public layout snapshot before publication or serving.
 * @param {any} snapshot
 * @param {string} [generation]
 */
export function validateDormonSnapshot(snapshot, generation = undefined) {
  if (snapshot?.source !== dormonSource || !validCaptureDate(snapshot.capturedAt) ||
      !Array.isArray(snapshot.plans) || snapshot.plans.length < 1 || snapshot.plans.length > 128) {
    throw new Error('Invalid Do‘rmon Hills layout snapshot');
  }
  if (generation !== undefined && !generationPattern.test(generation)) throw new Error('Invalid generation');
  const prefix = generation ? `/dormon-hills/plans/live/${generation}/` : '/dormon-hills/plans/';
  const ids = new Set();
  const plans = new Set();
  const floorPlans = new Set();
  const seenBlocks = new Set();
  for (const row of snapshot.plans) {
    if (!row || !/^layout-[abvgd](?:-(?:2-7|8-12))?-[123]-[0-9]{1,5}$/.test(row.id) || ids.has(row.id) ||
        !blocks.has(row.block) || ![1, 2, 3].includes(row.rooms) ||
        !Number.isFinite(row.area) || row.area <= 0 || row.area > 500 ||
        !['', '2–7', '8–12'].includes(row.floors ?? '') || Boolean(row.floors) !== (row.block === 'Д')) {
      throw new Error('Invalid or duplicate layout');
    }
    for (const key of ['plan', 'floorPlan']) {
      const url = row[key];
      if (typeof url !== 'string' || !url.startsWith(prefix) || !planFilenamePattern.test(url.slice(prefix.length)) ||
          !url.slice(prefix.length).startsWith(key === 'plan' ? 'u-' : 'floor-')) {
        throw new Error('Invalid layout image path');
      }
    }
    if (plans.has(row.plan)) throw new Error('Duplicate layout image');
    ids.add(row.id);
    plans.add(row.plan);
    floorPlans.add(row.floorPlan);
    seenBlocks.add(row.block);
  }
  if (seenBlocks.size !== blocks.size || floorPlans.size !== 6) throw new Error('Incomplete building or floor groups');
  return snapshot;
}
