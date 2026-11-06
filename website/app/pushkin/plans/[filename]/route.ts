import { pushkinPlan } from '../../../../lib/pushkin-state';

export async function GET(_: Request, context: { params: Promise<{ filename: string }> }) {
  const { filename } = await context.params;
  try {
    const bytes = await pushkinPlan(filename);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch { return new Response(null, { status: 503, headers: { 'Retry-After': '30' } }); }
}
