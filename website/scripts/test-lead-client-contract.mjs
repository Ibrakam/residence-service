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
assertIncludes(avalon, ["}, 'avalon-residence');", 'unitId={selectedUnit?.id}'], 'Avalon unit identity');
assertIncludes(maftun, ['unitId={lead.unit.id}'], 'Maftun Makon unit identity');
assertIncludes(kayan, [
  'if (selection?.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);',
  'if (selection.unitKey) rememberLastViewedApartment({ unitKey: selection.unitKey }, slug);',
], 'KAYAN landing unit memory');

console.log('Lead client contract checks passed.');
