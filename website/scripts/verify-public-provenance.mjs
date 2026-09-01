import { scanPublishedProvenancePrivacy } from './build-ofiyat-assets.mjs';

const checkedFiles = await scanPublishedProvenancePrivacy({ includeDist: true });
console.log(JSON.stringify({ mode: 'public-provenance-privacy', projects: ['mirador', 'ofiyat'], checkedFiles }, null, 2));
