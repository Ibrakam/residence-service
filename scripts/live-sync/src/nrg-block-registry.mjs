import { nrgBiProjects } from './providers.mjs';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Reviewed from the official read-only realEstateList response on 2026-09-15.
// This bootstrap prevents a first matrix rollout from silently accepting a
// future response that has already hidden a fully sold block. New official
// blocks are appended to the persistent registry after a complete normalized
// capture; existing block IDs are never removed automatically.
export const nrgBiSeedBlockRegistry = {
  schemaVersion: 1,
  provider: 'nrg-bi',
  source: 'https://apigw.bi.group/sales-picker/microfe-v3/realEstateList',
  reviewedAt: '2026-09-15',
  projects: {
    '4u': { realEstateUUID: 'c8945ad5-c737-42a6-a5c6-aa00375d3717', blocks: [
      { id: '019abb11-523b-7b23-924c-199c472deebd', name: '4U Tashkent 1 - 3' },
      { id: '144dd38d-d8c9-4e9d-be34-38a68d847896', name: '4U Tashkent 1-1' },
      { id: 'f61f45d8-6138-4161-abee-aed9e4d11a4e', name: '4U Tashkent 1 - 2' },
    ] },
    bayterak: { realEstateUUID: '56d93ca4-d70e-407c-ba5b-21c631a538c2', blocks: [
      { id: '019ec9cc-591e-7847-b5a5-d0603ac68d14', name: 'Bayterak Businees - 1' },
      { id: '019b12db-3c16-7985-9882-ff4aad939ef5', name: 'Bayterak - 2' },
      { id: '78e953be-6eba-4300-85bb-bad620174df4', name: 'Bayterak Comfort - 1 - 1' },
    ] },
    'botanika-saroyi': { realEstateUUID: '3f8ec6af-9595-11ee-a82d-001dd8b72708', blocks: [
      { id: '29a72416-bd75-41eb-91ed-6a8354f333a4', name: 'Botanika Saroyi 2 - 2' },
      { id: 'b07bba34-6a66-4c4d-a645-be1e04df36e7', name: 'Botanika Saroyi - 2 - 1' },
      { id: 'a3141c8b-5ceb-48ef-95e1-4f797b801308', name: 'Botanika Saroyi - 1 - Паркинг' },
      { id: '019f8357-b2ab-7532-bd32-5ca83d32185f', name: 'Botanika Saroyi 2 - 1 - Кладовка' },
    ] },
    flagman: { realEstateUUID: '8d1716cb-c89d-4738-b9b5-e53ceb5c7eaf', blocks: [
      { id: 'd9364974-6477-4e7f-84ca-ad8af1d832f9', name: 'Flagman Tashkent' },
    ] },
    jomiy: { realEstateUUID: '81153f29-f48b-11ed-a82e-001dd8b726aa', blocks: [
      { id: '31c49bc8-9266-11ed-a82b-001dd8b726aa', name: 'NRG Jomiy - 2.2' },
      { id: '019d67e5-2595-7f43-a93d-fce4f07c3f79', name: 'NRG Jomiy - 2.2 - Паркинг' },
      { id: '52dbef6a-463f-4459-9370-5d7c7a3e576c', name: 'NRG Jomiy - 2.1 - паркинг' },
      { id: 'd51410be-522c-11ee-a82a-001dd8b72708', name: 'NRG Jomiy - 1.2 - Паркинг' },
      { id: 'c3098c6f-6950-11ec-a81f-001dd8b72708', name: 'NRG Jomiy - 1 - 1' },
      { id: 'd800a644-de6b-11ed-a82c-001dd8b726aa', name: 'NRG Jomiy - 1 - Паркинг' },
      { id: '5d3d77de-9265-11ed-a82b-001dd8b726aa', name: 'NRG Jomiy - 1 - 2' },
      { id: 'd7207ffd-9265-11ed-a82b-001dd8b726aa', name: 'NRG Jomiy - 2 . 1' },
      { id: '019e023f-48e7-70bd-994a-c71a1081e063', name: 'NRG Jomiy - 2.2 - Кладовка' },
      { id: 'f131765a-c7c0-4fee-91ce-ec1254d355b8', name: 'NRG Jomiy 1.2 - кладовки' },
    ] },
    'maftun-makon': { realEstateUUID: '20b833b1-0d2a-420e-81d5-98585730350f', blocks: [
      { id: '563fb26c-f790-4262-8e29-cd973c4d9e15', name: 'NRG Maftun Makon Comfort 8' },
      { id: 'e776507e-26db-4660-9a2d-88c387a06e4c', name: 'NRG Maftun Makon Comfort 6' },
      { id: '85cefcb8-8204-486f-8545-9a3446b96431', name: 'NRG Maftun Makon Business - 1 паркинг' },
      { id: 'ba968922-5308-4438-9c97-a22f0214da4b', name: 'NRG Maftun Makon Comfort - 7' },
      { id: '3d4542d3-b66b-47a6-910f-61923f35f804', name: 'NRG Maftun Makon Business - 1 кладовые' },
      { id: '95f210ee-0aa3-4b3e-8f8a-7e93c5584448', name: 'NRG Maftun Makon Business - 1 - Паркинг - Кладовка' },
      { id: '21f5e18a-372a-4394-a0b5-eb7efca02237', name: 'NRG Maftun Makon Comfort - 5' },
      { id: 'af3202e0-62be-11ee-a82a-001dd8b72708', name: 'NRG Maftun Makon Comfort - 4' },
      { id: '5480a049-095a-4760-b372-10d0c51ba363', name: 'NRG Maftun Makon Comfort - 3' },
      { id: '5811f73e-d1df-11ed-a827-001dd8b72708', name: 'NRG Maftun Makon Comfort - 1' },
      { id: 'c7f0b686-a235-4bc7-8e18-968c78edfb8f', name: 'NRG Maftun Makon Comfort - 1 - Кладовка' },
      { id: '95ad42f8-d1df-11ed-a827-001dd8b72708', name: 'NRG Maftun Makon Comfort - 2' },
      { id: 'fecafe67-1969-11ee-a827-001dd8b72708', name: 'NRG Maftun Makon Business - 1' },
    ] },
    meros: { realEstateUUID: '0e6cc6d9-6f4a-405c-a8c0-037264d133c1', blocks: [
      { id: 'f7b0e7d0-8f26-4261-9591-097474601842', name: 'NRG Meros Business' },
      { id: '36cc37e1-4185-4294-a520-e7e2b096bdd1', name: 'NRG Meros Comfort - 2 - Кладовка' },
      { id: '8a824c62-0160-43e7-8e7a-5571f3491f99', name: 'NRG Meros Business 1 - Паркинг' },
      { id: 'a740f291-21c4-4691-bfc2-c32b1c4cca9d', name: 'NRG Meros Comfort - 1 - Кладовка' },
      { id: '6c3bd995-9972-4b84-a3a1-9c61acf2921f', name: 'NRG Meros Comfort 2' },
      { id: '08bccd05-81ee-4934-8652-5d40474e07be', name: 'NRG Meros Comfort - 1' },
      { id: '3ed181ab-ed82-4d12-8f09-59383adc207e', name: 'NRG Meros Comfort - 1 - Паркинг' },
      { id: 'a1049ec3-b149-4d62-932e-e7dd05c0b20e', name: 'NRG Meros Business 1 - Кладовка' },
    ] },
    sado: { realEstateUUID: '848ce8ff-54a9-4ffb-9fdf-183aea1710a6', blocks: [
      { id: '62e43d91-1295-483a-bc3b-ece4fa6f0652', name: 'Sado Business 2 - 2' },
      { id: 'f4591e3a-f4a3-4f34-a32a-c242c53d9f7e', name: 'Sado Comfort 2 - 2' },
      { id: '92ad4860-ad0a-4b80-b94c-0835f69b948e', name: 'Sado Business - 2-1' },
      { id: '08977484-3940-42af-974c-3af66b8ba995', name: 'Sado Business - Паркинг' },
      { id: '019f8354-1042-73e6-b637-bffabde79c46', name: 'Sado Comfort 2 - 2 - Кладовка' },
      { id: '019c6b0c-86b6-7b32-b5d8-3ba3b7a34642', name: 'Sado Business - 2-1 - Кладовка' },
      { id: '019f8352-4ded-7701-a7de-f63180ce6c16', name: 'Sado Comfort 2 - 1 - Кладовка' },
      { id: '15d215c0-5183-4e31-b4fd-39482258a963', name: 'Sado Comfort 2 - 1' },
    ] },
    voha: { realEstateUUID: 'ea3ccd82-e81b-11ed-a827-001dd8b72708', blocks: [
      { id: '1d044561-6950-11ec-a81f-001dd8b72708', name: 'NRG Voha - 2' },
      { id: '93030b9c-ce41-41b6-9964-2a7eb55310ea', name: 'NRG Voha - 2 - Паркинг' },
      { id: '1ee8570e-3f8d-4c9e-a283-10e92208889f', name: 'NRG Voha - 2 - Кладовка' },
      { id: '71d3b5d9-694f-11ec-a81f-001dd8b72708', name: 'NRG Voha - 1' },
    ] },
    yangibaxt: { realEstateUUID: '6481be1c-c9fe-11ed-a82c-001dd8b726aa', blocks: [
      { id: 'd54a2404-ec84-4f46-8538-309199668606', name: 'NRG Yangi Baxt - 3 -2' },
      { id: 'f3eb11ee-a08b-4d22-ad92-eefd8a6bd36c', name: 'Yangi Baxt Munavvar 1' },
      { id: '7c9c390f-7d48-4028-8804-0468ae6927a1', name: 'NRG Yangi Baxt - 2 - 2 - Паркинг' },
      { id: 'fd543000-f586-44cb-8952-a256db2b5a2e', name: 'NRG Yangi Baxt - 3 - 1' },
      { id: 'cfdd7d60-67ce-46b3-b79c-cbac725237e7', name: 'NRG Yangi Baxt - 1 - Паркинг' },
      { id: '906c7f96-c9ff-11ed-a82c-001dd8b726aa', name: 'NRG Yangi Baxt - 1' },
      { id: '71e3d326-1966-11ee-a827-001dd8b72708', name: 'NRG Yangi Baxt - 2' },
    ] },
    zamon: { realEstateUUID: '58e48f7d-dd1c-11ed-a82c-001dd8b726aa', blocks: [
      { id: '4a195db5-bc4b-4d07-a995-87f146b23d12', name: 'NRG Zamon 3 - 1' },
      { id: 'ca17024d-644e-11ee-a82a-001dd8b72708', name: 'NRG Zamon 2-2' },
      { id: 'd0c772dc-4b0c-11ee-a829-001dd8b72708', name: 'NRG Zamon (паркинг) 1 оч - Паркинг' },
    ] },
  },
};

export function normalizeNrgBlockRegistry(value, label = 'NRG block registry') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || value.provider !== 'nrg-bi') {
    throw new Error(`${label} envelope is invalid`);
  }
  const projects = {};
  for (const project of nrgBiProjects) {
    const source = value.projects?.[project.slug];
    if (!source || source.realEstateUUID !== project.realEstateUUID || !Array.isArray(source.blocks) || source.blocks.length === 0 || source.blocks.length > 100) {
      throw new Error(`${label} project ${project.slug} is invalid`);
    }
    const seen = new Set();
    const blocks = source.blocks.map((block, index) => {
      const id = String(block?.id ?? '').trim();
      const name = String(block?.name ?? '').trim();
      if (!uuidPattern.test(id) || !name || seen.has(id)) throw new Error(`${label} project ${project.slug} block ${index + 1} is invalid or duplicated`);
      seen.add(id);
      return { id, name };
    });
    projects[project.slug] = { realEstateUUID: project.realEstateUUID, blocks };
  }
  const unexpected = Object.keys(value.projects ?? {}).filter((slug) => !projects[slug]);
  if (unexpected.length) throw new Error(`${label} contains unexpected project ${unexpected.sort()[0]}`);
  return {
    schemaVersion: 1,
    provider: 'nrg-bi',
    source: nrgBiSeedBlockRegistry.source,
    reviewedAt: String(value.reviewedAt ?? '').trim() || null,
    projects,
  };
}

export function mergeNrgBlockRegistries(baseValue, nextValue) {
  const base = normalizeNrgBlockRegistry(baseValue, 'NRG base block registry');
  const next = normalizeNrgBlockRegistry(nextValue, 'NRG next block registry');
  const projects = {};
  for (const project of nrgBiProjects) {
    const blocks = new Map(base.projects[project.slug].blocks.map((block) => [block.id, block]));
    for (const block of next.projects[project.slug].blocks) blocks.set(block.id, block);
    projects[project.slug] = { realEstateUUID: project.realEstateUUID, blocks: [...blocks.values()] };
  }
  return normalizeNrgBlockRegistry({
    schemaVersion: 1,
    provider: 'nrg-bi',
    source: nrgBiSeedBlockRegistry.source,
    reviewedAt: next.reviewedAt ?? base.reviewedAt,
    projects,
  });
}

normalizeNrgBlockRegistry(nrgBiSeedBlockRegistry, 'NRG built-in block registry');
