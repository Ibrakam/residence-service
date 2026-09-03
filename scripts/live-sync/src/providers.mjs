const https = (host, pathPrefixes, queryKeys = null) => Object.freeze({
  protocol: 'https:',
  host,
  pathPrefixes: Object.freeze(pathPrefixes),
  ...(queryKeys ? { queryKeys: Object.freeze(queryKeys) } : {}),
});

const uysotRoutes = Object.freeze([
  { id: 'houses', url: 'https://service.app.uysot.uz/v1/smart-catalog/house' },
  { id: 'buildings', url: 'https://service.app.uysot.uz/v1/smart-catalog/building/1074' },
  { id: 'filter-properties', url: 'https://service.app.uysot.uz/v1/smart-catalog/filter-properties/1074' },
  { id: 'showroom', url: 'https://service.app.uysot.uz/v1/smart-catalog/showroom?realtorBookingCount=false' },
  { id: 'catalog-table', url: 'https://service.app.uysot.uz/v1/smart-catalog/table' },
  { id: 'block-statistics', url: 'https://service.app.uysot.uz/v2/website/block-statistic/1074' },
]);

export const nrgBiProjects = Object.freeze([
  Object.freeze({ slug: '4u', name: '4U', realEstateUUID: 'c8945ad5-c737-42a6-a5c6-aa00375d3717' }),
  Object.freeze({ slug: 'bayterak', name: 'Bayterak', realEstateUUID: '56d93ca4-d70e-407c-ba5b-21c631a538c2' }),
  Object.freeze({ slug: 'botanika-saroyi', name: 'Botanika Saroyi', realEstateUUID: '3f8ec6af-9595-11ee-a82d-001dd8b72708' }),
  Object.freeze({ slug: 'flagman', name: 'Flagman', realEstateUUID: '8d1716cb-c89d-4738-b9b5-e53ceb5c7eaf' }),
  Object.freeze({ slug: 'jomiy', name: 'Jomiy', realEstateUUID: '81153f29-f48b-11ed-a82e-001dd8b726aa' }),
  Object.freeze({ slug: 'maftun-makon', name: 'Maftun Makon', realEstateUUID: '20b833b1-0d2a-420e-81d5-98585730350f' }),
  Object.freeze({ slug: 'meros', name: 'Meros', realEstateUUID: '0e6cc6d9-6f4a-405c-a8c0-037264d133c1' }),
  Object.freeze({ slug: 'sado', name: 'Sado', realEstateUUID: '848ce8ff-54a9-4ffb-9fdf-183aea1710a6' }),
  Object.freeze({ slug: 'voha', name: 'Voha', realEstateUUID: 'ea3ccd82-e81b-11ed-a827-001dd8b72708' }),
  Object.freeze({ slug: 'yangibaxt', name: 'Yangibaxt', realEstateUUID: '6481be1c-c9fe-11ed-a82c-001dd8b726aa' }),
  Object.freeze({ slug: 'zamon', name: 'Zamon', realEstateUUID: '58e48f7d-dd1c-11ed-a82c-001dd8b726aa' }),
]);

/**
 * Provider definitions are intentionally data-only. A provider marked `discovery`
 * may be captured, but it cannot emit a publishable catalogue until its current
 * authenticated response contract is covered by a tested normalizer.
 */
export const providers = Object.freeze({
  uysot: Object.freeze({
    id: 'uysot',
    label: 'Uysot Showroom',
    projects: Object.freeze(['avalon-residence']),
    maturity: 'normalize-ready',
    captureMode: 'authorized-browser-read-post',
    profileHint: '/home/residence-crm-browser/uysot-profile',
    pageHosts: Object.freeze(['app.uysot.uz']),
    startUrl: 'https://app.uysot.uz/showroom/',
    launchFlags: Object.freeze(['--enable-unsafe-swiftshader']),
    allowedMethods: Object.freeze(['GET', 'POST']),
    allowedResponses: Object.freeze([
      https('service.app.uysot.uz', [
        '/v1/smart-catalog/house',
        '/v1/smart-catalog/building/1074',
        '/v1/smart-catalog/filter-properties/1074',
        '/v1/smart-catalog/showroom',
        '/v1/smart-catalog/table',
        '/v1/smart-catalog/flat/*',
        '/v2/website/block-statistic/1074',
        '/v1/flat/more',
        '/v1/shourum/flat-data',
        '/v1/flat/field',
        '/v1/currency/504',
      ], ['realtorBookingCount', 'flats', 'flatIds']),
    ]),
    probes: uysotRoutes,
    readOnlyPost: Object.freeze({
      host: 'service.app.uysot.uz',
      path: '/v1/smart-catalog/table',
      requestKeys: Object.freeze(['houseId', 'orders', 'page', 'size']),
      forcedBody: Object.freeze({ page: 1, size: 500, orders: Object.freeze({}), houseId: Object.freeze([1074]) }),
    }),
    requiredProbeIds: Object.freeze(['houses', 'buildings', 'showroom', 'catalog-table']),
    outputFiles: Object.freeze(['avalon-units.json']),
    baseline: Object.freeze({ minimumUnits: 268, requiredBuildings: ['B1', 'A', 'B2'] }),
  }),

  kayan: Object.freeze({
    id: 'kayan',
    label: 'KAYAN Agent Office',
    projects: Object.freeze(['mirador', 'ofiyat']),
    maturity: 'normalize-ready',
    captureMode: 'authorized-browser-get',
    profileHint: '/home/residence-crm-browser/crm-profile',
    pageHosts: Object.freeze(['smart-catalog.profitbase.ru']),
    startUrl: 'https://agent.kayan.uz/',
    launchFlags: Object.freeze([]),
    allowedMethods: Object.freeze(['GET']),
    allowedResponses: Object.freeze([
      https('pb21432.profitbase.ru', ['/api/v4/json/property'], ['houseId', 'returnFilteredCount', 'showQueueCount']),
    ]),
    probes: Object.freeze([]),
    navigationPaths: Object.freeze([
      '/eco/catalog/house/154813/smallGrid',
      '/eco/catalog/house/153505/smallGrid',
      '/eco/catalog/house/153506/smallGrid',
      '/eco/catalog/house/154273/smallGrid',
    ]),
    requiredProbeIds: Object.freeze([]),
    outputFiles: Object.freeze(['kayan-catalog.json']),
  }),

  mbc: Object.freeze({
    id: 'mbc',
    label: 'MBC Partners',
    projects: Object.freeze(['regnum-plaza']),
    maturity: 'normalize-ready',
    captureMode: 'public-read-post',
    profileHint: null,
    pageHosts: Object.freeze([]),
    startUrl: 'https://mbc.uz/project/regnum-plaza',
    launchFlags: Object.freeze([]),
    allowedMethods: Object.freeze(['POST']),
    allowedResponses: Object.freeze([
      https('mbc.uz', ['/api/plans']),
    ]),
    probes: Object.freeze([]),
    requiredProbeIds: Object.freeze([]),
    outputFiles: Object.freeze(['regnum-plaza-catalog.json']),
  }),

  sun: Object.freeze({
    id: 'sun',
    label: 'Human2Human / MacroCRM',
    projects: Object.freeze(['sun']),
    maturity: 'normalize-ready',
    captureMode: 'signed-public-read-post',
    profileHint: null,
    pageHosts: Object.freeze([]),
    startUrl: 'https://human2human.uz/#/macrocatalog/complexes/list?studio=null&category=flat&activity=sell',
    launchFlags: Object.freeze([]),
    allowedMethods: Object.freeze(['GET', 'POST']),
    allowedResponses: Object.freeze([
      https('human2human.uz', ['/*', '/wp-json/*']),
      https('api.macroserver.uz', ['/estate/embedjs/', '/estate/catalog/']),
      https('macroserver.uz', ['/estate/files/*', '/account/estate/files/*']),
    ]),
    probes: Object.freeze([]),
    requiredProbeIds: Object.freeze([]),
    outputFiles: Object.freeze(['sun-catalog.json']),
  }),

  'nrg-bi': Object.freeze({
    id: 'nrg-bi',
    label: 'NRG / BI public sales picker',
    projects: Object.freeze(nrgBiProjects.map((project) => project.slug)),
    projectDefinitions: nrgBiProjects,
    maturity: 'normalize-ready',
    captureMode: 'public-read-post',
    profileHint: null,
    pageHosts: Object.freeze([]),
    startUrl: 'https://bi.group/uz/',
    launchFlags: Object.freeze([]),
    allowedMethods: Object.freeze(['POST']),
    allowedResponses: Object.freeze([
      https('apigw.bi.group', [
        '/sales-picker/microfe-v3/placementList',
        '/sales-picker/microfe-v3/realEstateList',
      ]),
    ]),
    probes: Object.freeze([]),
    requiredProbeIds: Object.freeze([]),
    outputFiles: Object.freeze(nrgBiProjects.map((project) => `${project.slug}-catalog.json`)),
    companyUUID: '5cba02b4-8abd-11ee-ab79-001dd8b7289a',
    apartmentPropertyTypeUUID: '5990a172-812a-4fee-b4f5-c860cca824d7',
    pageSize: 300,
  }),

  alemica: Object.freeze({
    id: 'alemica',
    label: 'Alemica',
    projects: Object.freeze([]),
    maturity: 'discovery',
    captureMode: 'passive-get',
    profileHint: '/home/residence-crm-browser/crm-profile',
    pageHosts: Object.freeze(['alemica.com']),
    startUrl: 'https://alemica.com/ru',
    launchFlags: Object.freeze([]),
    allowedMethods: Object.freeze(['GET']),
    allowedResponses: Object.freeze([
      https('alemica.com', ['/ru', '/ru/*', '/api/*']),
      https('www.alemica.com', ['/ru', '/ru/*', '/api/*']),
      https('api-gateway.alemica.com', ['/catalog/api/v3/sales-picker/*']),
    ]),
    probes: Object.freeze([]),
    requiredProbeIds: Object.freeze([]),
    outputFiles: Object.freeze([]),
    blocker: 'Alemica catalogue routes are known, but no Residence project-to-realEstate mapping has been established; publishing remains disabled.',
  }),
});

export function getProvider(id) {
  const provider = providers[id];
  if (!provider) throw new Error(`Unknown provider ${JSON.stringify(id)}. Expected one of: ${Object.keys(providers).join(', ')}`);
  return provider;
}

export function providerStatus() {
  return Object.values(providers).map(({ id, label, projects, maturity, captureMode, outputFiles, blocker, launchFlags }) => ({
    id,
    label,
    projects,
    maturity,
    captureMode,
    outputFiles,
    blocker: blocker ?? null,
    requiredLaunchFlags: launchFlags,
  }));
}
