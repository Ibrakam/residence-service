import catalogSnapshot from '@/data/kayan-catalog.json';
import merosCatalogSnapshot from '@/data/meros-catalog.json';
import type { CatalogBundle } from './project-page';
import type { KayanProjectSlug } from './project-data';
import { selectCatalogTimestamp } from './catalog-timestamp';

type CatalogSnapshot = {
  generatedAt: string;
  projects: CatalogBundle[];
};

const snapshot = catalogSnapshot as CatalogSnapshot;
const merosSnapshot = merosCatalogSnapshot as CatalogBundle;

export const catalogGeneratedAt = snapshot.generatedAt;
export const merosCatalogGeneratedAt = (merosCatalogSnapshot as { capturedAt: string }).capturedAt;

export function getCatalogBundleTimestamp(bundle: CatalogBundle, fallbackGeneratedAt = catalogGeneratedAt) {
  return selectCatalogTimestamp(bundle.project.updatedAt, fallbackGeneratedAt);
}

export function getCatalogBundle(slug: KayanProjectSlug) {
  const bundle = slug === 'meros'
    ? merosSnapshot
    : snapshot.projects.find((item) => item.project.slug === slug);
  if (!bundle) throw new Error(`Catalog project not found: ${slug}`);
  return bundle;
}
