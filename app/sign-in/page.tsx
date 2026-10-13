import { safeRelativeReturnPath } from '@/app/auth-paths';
import SignInForm from './sign-in-form';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const params = await searchParams;
  return <SignInForm returnTo={safeRelativeReturnPath(params.return_to ?? '/')} />;
}
