import catalogSnapshot from '@/data/kayan-catalog.json';
import { selectCatalogTimestamp } from '@/app/kayan/catalog-timestamp';

const ofiyat = catalogSnapshot.projects.find((bundle) => bundle.project.slug === 'ofiyat');
if (!ofiyat) throw new Error('Ofiyat catalog bundle is missing');

const explorerGeneratedAt = selectCatalogTimestamp(ofiyat.project.updatedAt, catalogSnapshot.generatedAt);

const explorerUnits = ofiyat.units
  .filter((unit) => unit.phaseSlug === 'phase-1' || unit.phaseSlug === 'phase-2')
  .map((unit) => ({
    sourceKey: unit.sourceKey,
    phaseSlug: unit.phaseSlug,
    status: unit.status,
    number: unit.number,
    entrance: unit.entrance,
    floor: unit.floor,
    area: unit.area,
    rooms: unit.rooms,
  }));

export async function GET() {
  return Response.json(
    { generatedAt: explorerGeneratedAt, items: explorerUnits },
    { headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400' } },
  );
}
