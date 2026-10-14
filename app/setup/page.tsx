import { redirect } from 'next/navigation';
import { isSetupRequired } from '@/lib/setup-state';
import { signInPath } from '@/app/auth-paths';
import SetupWizard from './setup-wizard';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const setupAllowed = await isSetupRequired();
  if (!setupAllowed) {
    redirect(signInPath('/'));
  }

  return <SetupWizard />;
}
