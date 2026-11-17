import { dormonPlanAsset } from '../../../../../../lib/dormon-plans-state';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, context: { params: Promise<{ generation: string; filename: string }> }) {
  const { generation, filename } = await context.params;
  try {
    const bytes = await dormonPlanAsset(generation, filename);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: {
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
    } });
  } catch {
    return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } });
  }
}
