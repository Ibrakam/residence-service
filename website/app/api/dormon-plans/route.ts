import { dormonPlansState } from '../../../lib/dormon-plans-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(await dormonPlansState(), { headers: { 'Cache-Control': 'private, no-store' } });
}
