export type OfiyatBlockNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type OfiyatMaskPathId = 'path-1' | 'path-2' | 'path-3' | 'path-4' | 'path-5' | 'path-6' | 'path-7';

export type OfiyatMaskPath = {
  id: OfiyatMaskPathId;
  sourceOrder: number;
  d: string;
};

export type OfiyatBlockDefinition = {
  number: OfiyatBlockNumber;
  pathId: OfiyatMaskPathId;
  tooltip: { x: number; y: number };
  entrance: null;
};

export const OFIYAT_SELECTOR_VIEW_BOX = {
  width: 4096,
  height: 2359,
  value: '0 0 4096 2359',
} as const;

/**
 * Exact source paths from the user-supplied `Frame 4.svg`.
 *
 * The source white rect is intentionally absent. The seven `d` values remain
 * byte-for-byte identical and in source DOM order so the production overlay
 * shares the render's 4096 × 2359 coordinate system without transforms.
 */
export const OFIYAT_MASK_PATHS: readonly OfiyatMaskPath[] = [
  { id: 'path-1', sourceOrder: 1, d: 'M664 726.5V1427.5V1632.5L845 1672V845.5H870V726.5L961.5 716.5L841 705H818.5V691.5H793.5L680.5 705V726.5H664Z' },
  { id: 'path-2', sourceOrder: 2, d: 'M1059.5 828.5V1348.5V1704.5L1393.5 1764.5V649L1369 650.5V674.5L1297.5 679.5L1197 670.5L1090 682.5V704.5H1081.5V828.5H1059.5Z' },
  { id: 'path-3', sourceOrder: 3, d: 'M1473 614L1394 623.5V1764.5L1622 1796L1644.5 1786.5L1856.5 1815V767L1889.5 763.5V615.5L2012 603V592L1855.5 568L1757.5 579L1757 584L1740.5 587V576L1715.5 572L1473 603V614Z' },
  { id: 'path-4', sourceOrder: 4, d: 'M1889.5 764L1857 767.5V1815.5L2058 1852L2439 1892.5V726.5L2479.5 723V553H2502.5V536.5L2457.5 528L2106.5 565.5V591.5L1889.5 615.5V764Z' },
  { id: 'path-5', sourceOrder: 5, d: 'M3011 1994.5V1764L3012.5 1191V748.5V458L3105.5 449V425L3477.5 378L3503 387.5V402.5L3681.5 382L3840.5 453V845V1196.5V1757L3836 1876L3691.5 1961V2072.5L3011 1994.5Z' },
  { id: 'path-6', sourceOrder: 6, d: 'M2951.5 473.5L3012.5 490L3011 1995L2735 1954L2439.5 1893.5V727L2479.5 723.5V554H2501.5L2739 526.5V497.5L2951.5 473.5Z' },
  { id: 'path-7', sourceOrder: 7, d: 'M845.5 845.5V1200.5V1672L1059 1705V828.5H1081V704H1089.5V694.5H1028L962.5 699V717.5H952L928.5 719.5L870.5 727V845.5H845.5Z' },
] as const;

export const OFIYAT_BLOCK_PATH_MAP: Readonly<Record<OfiyatBlockNumber, OfiyatMaskPathId>> = {
  1: 'path-1',
  2: 'path-7',
  3: 'path-2',
  4: 'path-3',
  5: 'path-4',
  6: 'path-6',
  7: 'path-5',
};

export const OFIYAT_BLOCKS: readonly OfiyatBlockDefinition[] = [
  { number: 1, pathId: OFIYAT_BLOCK_PATH_MAP[1], tooltip: { x: 810, y: 770 }, entrance: null },
  { number: 2, pathId: OFIYAT_BLOCK_PATH_MAP[2], tooltip: { x: 970, y: 785 }, entrance: null },
  { number: 3, pathId: OFIYAT_BLOCK_PATH_MAP[3], tooltip: { x: 1227, y: 730 }, entrance: null },
  { number: 4, pathId: OFIYAT_BLOCK_PATH_MAP[4], tooltip: { x: 1700, y: 650 }, entrance: null },
  { number: 5, pathId: OFIYAT_BLOCK_PATH_MAP[5], tooltip: { x: 2180, y: 610 }, entrance: null },
  { number: 6, pathId: OFIYAT_BLOCK_PATH_MAP[6], tooltip: { x: 2725, y: 555 }, entrance: null },
  { number: 7, pathId: OFIYAT_BLOCK_PATH_MAP[7], tooltip: { x: 3425, y: 465 }, entrance: null },
] as const;

export const OFIYAT_BLOCK_ENTRANCE_MAP: Readonly<Record<OfiyatBlockNumber, null>> = {
  1: null,
  2: null,
  3: null,
  4: null,
  5: null,
  6: null,
  7: null,
};

export const OFIYAT_BLOCK_PROVENANCE = {
  render: {
    publicPath: '/kayan/ofiyat/frame-4-desktop.webp',
    sourcePublicPath: '/kayan/ofiyat/source/frame-4-original.webp',
    dimensions: '4096×2359',
    sha256: 'fb8a9e4ae0abd1b8ecd9ea8313c75fe874c7060bb2a0451d8df4b16f4f74424c',
  },
  mobileDerivative: {
    publicPath: '/kayan/ofiyat/frame-4-mobile.webp',
    sourcePublicPath: '/kayan/ofiyat/source/frame-4-original.webp',
  },
  mask: {
    publicPath: '/kayan/ofiyat/block-selector-mask.svg',
    sourcePublicPath: '/kayan/ofiyat/source/frame-4-original.svg',
    viewBox: OFIYAT_SELECTOR_VIEW_BOX.value,
    sha256: '1e84693660fbbccf32766c275dc92c392722334102b38dad92890dfc152afbc9',
    adaptation: 'The white rect is omitted; all seven source path geometries are preserved.',
  },
  annotation: {
    publicPath: '/kayan/ofiyat/source/block-annotation.png',
    sha256: 'e4b9c891cb7c420127f49e28ada646992527dd22c65a11603ffd84de2dc308bb',
    result: 'Visual blocks map 1→path-1, 2→path-7, 3→path-2, 4→path-3, 5→path-4, 6→path-6, 7→path-5.',
  },
  catalogueAssociation: {
    entranceMapping: null,
    reason: 'No official source links visual blocks 1–7 to Ofiyat phases or entrances.',
  },
} as const;

const pathById = new Map(OFIYAT_MASK_PATHS.map((path) => [path.id, path]));

export function getOfiyatMaskPath(pathId: OfiyatMaskPathId) {
  const path = pathById.get(pathId);
  if (!path) throw new Error(`Unknown Ofiyat mask path: ${pathId}`);
  return path;
}
