import {runtime} from './runtime/bindings';
import {repositories} from './repositories';
import {graph,MetaError} from './meta-core';
import {isSameOriginWrite} from './write-origin';
export {runtime};
// Identity is resolved exclusively through Better Auth sessions.
export async function currentUser(r:Request){const {auth}=await import('./auth');const session=await auth.api.getSession({headers:r.headers});return session?{userId:session.user.id}:null;}
export async function owner(r:Request,write=false){const user=await currentUser(r);if(!user)throw new MetaError('Iniciá sesión para usar la app.',401);if(write&&!isSameOriginWrite(r))throw new MetaError('Solicitud de otro origen bloqueada.',403);return user.userId;}
async function key(){if(!runtime.TOKEN_ENCRYPTION_KEY)throw new Error('Falta la clave de cifrado del servidor.');return crypto.subtle.importKey('raw',Uint8Array.from(atob(runtime.TOKEN_ENCRYPTION_KEY),c=>c.charCodeAt(0)),'AES-GCM',false,['encrypt','decrypt']);}
export async function encrypt(token:string){const iv=crypto.getRandomValues(new Uint8Array(12));const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),new TextEncoder().encode(token)));return JSON.stringify({iv:btoa(String.fromCharCode(...iv)),data:btoa(String.fromCharCode(...data))});}
export async function connection(user:string){const row=await (await repositories()).connections.get(user);if(!row)throw new MetaError('Conectá tu token de Meta.',401);const token=await decrypt(row.token);return {token,name:row.name,cooldown:Number(row.cooldown)};}
export async function meta(user:string){const c=await connection(user);return async(path:string,p:Record<string,any>={},method='GET')=>{const latest=await (await repositories()).connections.get(user);const wait=Math.ceil((Number(latest?.cooldown)-Date.now())/1000);if(wait>0)throw new MetaError(`Meta necesita una pausa. Probá en ${wait} segundos.`,429,'',false,wait);return graph(c.token,path,p,method,async seconds=>{await (await repositories()).connections.setCooldown(user,Date.now()+seconds*1000);});};}
export function json(v:any,status=200){return Response.json(v,{status,headers:{'Cache-Control':'no-store'}});}
export function fail(error:unknown){const e=error as MetaError;return json({error:e.message||'No se pudo completar la operación.',code:e.code,trace:e.trace,wait:e.wait},[401,403,429].includes(e.code)?e.code:400);}

export async function decrypt(value:string){const c=JSON.parse(value),decode=(s:string)=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(c.iv)},await key(),decode(c.data)));}
