import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFile(`${root}/${path}`, 'utf8');
const assertIncludes = (source, expected, label) => {
  for (const fragment of expected) {
    if (!source.includes(fragment)) throw new Error(`${label} is missing: ${fragment}`);
  }
};

const [leadModal, sado, avalon, maftun, kayan] = await Promise.all([
  read('app/lead-modal.tsx'),
  read('app/sado/sado-page.tsx'),
  read('app/page.tsx'),
  read('app/maftun-makon/apartments/maftun-makon-catalog.tsx'),
  read('app/kayan/project-page.tsx'),
]);

assertIncludes(leadModal, ["body?.success !== true"], 'shared lead response guard');
assertIncludes(sado, ["body?.success !== true"], 'Sad\u2019O inline response guard');
assertIncludes(avalon, [
  "rememberLiveCatalogUnit(selectedUnit, 'avalon-residence');",
  '{...catalogLeadIdentity(selectedUnit)}',
], 'Avalon unit identity');
if (avalon.includes('unitId={selectedUnit?.id}')) throw new Error('Avalon still submits a presentation unitId');
assertIncludes(maftun, [
  "rememberLiveCatalogUnit(unit, 'maftun-makon');",
  '{...catalogLeadIdentity(lead.unit)}',
], 'Maftun Makon unit identity');
if (maftun.includes('unitId={lead.unit.id}')) throw new Error('Maftun Makon still submits a presentation unitId');
assertIncludes(kayan, [
  'if (selection?.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);',
  'if (selection.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);',
], 'KAYAN landing unit memory');

console.log('Lead client contract checks passed.');
