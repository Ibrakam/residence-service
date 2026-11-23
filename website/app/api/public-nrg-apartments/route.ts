import { PlacementInputError, requestSanatPlacements } from '../../../lib/public-sanat-placements';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    return Response.json(await requestSanatPlacements(request), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const status = error instanceof PlacementInputError ? error.status : 503;
    return Response.json({ error: status === 503 ? 'catalog_source_unavailable' : 'invalid_catalog_request' },
      { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 503 ? { 'Retry-After': '15' } : {}) } });
  }
}
