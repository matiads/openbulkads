import { redirect } from 'next/navigation';
import { safeRelativeReturnPath, setupPath } from '@/app/auth-paths';
import { isSetupRequired } from '@/lib/setup-state';
import SignInForm from './sign-in-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  if (await isSetupRequired()) {
    redirect(setupPath());
  }
  const params = await searchParams;
  return <SignInForm returnTo={safeRelativeReturnPath(params.return_to ?? '/')} />;
}
