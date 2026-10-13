import { readinessResult } from '@/lib/readiness';

export const dynamic = 'force-dynamic';

// Unauthenticated but intended only for the private Docker/VPN network.
export async function GET() {
  const { status, body } = await readinessResult();
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
