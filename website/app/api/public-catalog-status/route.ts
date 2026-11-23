import { loadPublicCatalogStatus } from '../../../lib/public-catalog-status';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return Response.json(await loadPublicCatalogStatus(), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return Response.json({ items: [], error: 'catalog_status_unavailable' }, { status: 503,
      headers: { 'Cache-Control': 'no-store', 'Retry-After': '15', 'X-Content-Type-Options': 'nosniff' } });
  }
}
