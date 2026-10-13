import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import AdsWorkspace from './workspace';
import {signInPath} from './auth-paths';
export const dynamic='force-dynamic';
export default async function Page(){
  const {auth}=await import('@/lib/auth');
  const session=await auth.api.getSession({headers:await headers()});
  if(!session)redirect(signInPath('/'));
  return <AdsWorkspace nodeRuntime/>;
}
