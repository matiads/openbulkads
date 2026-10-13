import {owner,meta,json,fail} from '@/lib/server';
import {account,id} from '@/lib/meta-core';
import {CREATIVE_FIELDS,describeModel} from '@/lib/model';
export async function GET(r:Request){try{const call=await meta(await owner(r)),p=new URL(r.url).searchParams,c=await call(id(p.get('creative')),{fields:CREATIVE_FIELDS});if(account(c.account_id)!==account(p.get('account')))throw new Error('El modelo pertenece a otra cuenta.');return json(describeModel(c));}catch(e){return fail(e);}}
