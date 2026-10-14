import { isSetupRequired } from '@/lib/setup-state';
import { json, fail } from '@/lib/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const required = await isSetupRequired();
    return json({ setupRequired: required });
  } catch (error) {
    return fail(error);
  }
}
