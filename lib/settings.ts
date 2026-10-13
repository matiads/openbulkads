import {decrypt} from './server';
import {repositories} from './repositories';
export async function settings(user:string){const s=await (await repositories()).settings.get(user);return {app_id:s?.appId,app_secret:s?.appSecret,selected_accounts:s?.selectedAccounts,token_metadata:s?.tokenMetadata};}
export async function credentials(user:string){const s=await settings(user);return s.app_id&&s.app_secret?{appId:s.app_id,secret:await decrypt(s.app_secret)}:null;}
export function selectedAccounts(value:string|null|undefined):string[]|null{return value?JSON.parse(value):null;}
