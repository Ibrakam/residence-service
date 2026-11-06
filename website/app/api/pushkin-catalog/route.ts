import { pushkinState } from '../../../lib/pushkin-state';

export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    const { snapshot } = await pushkinState();
    return Response.json(snapshot, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return Response.json({ error: 'source_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
