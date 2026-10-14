import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import AdsWorkspace from './workspace';
import {signInPath, setupPath} from './auth-paths';
import {isSetupRequired} from '@/lib/setup-state';

export const dynamic='force-dynamic';
export default async function Page(){
  if (await isSetupRequired()) {
    redirect(setupPath());
  }
  const {auth}=await import('@/lib/auth');
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect(signInPath('/'));
  return <AdsWorkspace nodeRuntime/>;
}
