import {API_VERSION,MetaError} from './meta-core';
export type TokenMetadata={expiresAt:number|null;dataAccessExpiresAt:number|null;isValid:boolean;checkedAt:number;appId:string};
export function tokenMetadata(data:any,appId:string,now=Date.now()):TokenMetadata{
 if(String(data.app_id)!==appId)throw new Error('El token pertenece a otra app de Meta. Revisá el App ID.');
 if(data.type&&data.type!=='USER')throw new Error('Usá un token de usuario para este flujo.');
 const date=(v:any)=>Number(v)>0?Number(v)*1000:null;
 return {expiresAt:date(data.expires_at),dataAccessExpiresAt:date(data.data_access_expires_at),isValid:data.is_valid===true,checkedAt:now,appId};
}
export function tokenDeadline(metadata:TokenMetadata|null){const dates=[metadata?.expiresAt,metadata?.dataAccessExpiresAt].filter((d):d is number=>typeof d==='number'&&d>0);return dates.length?Math.min(...dates):null;}
export function tokenLabel(metadata:TokenMetadata|null,now=Date.now()){
 if(!metadata)return 'Vencimiento sin consultar';if(!metadata.isValid)return 'Token inválido · reconectá Meta';const end=tokenDeadline(metadata);if(!end)return 'Meta no informa fecha de vencimiento';const ms=end-now;if(ms<=0)return 'Token vencido · reconectá Meta';if(ms<3600000)return `Token vence en ${Math.ceil(ms/60000)} min`;if(ms<86400000)return `Token vence en ${Math.ceil(ms/3600000)} h`;return `Token vence en ${Math.ceil(ms/86400000)} días`;
}
// OAuth errors are deliberately translated instead of forwarding a response
// that might contain an app secret, token or complete request URL.
async function request(path:string,params:Record<string,string>,auth:string){
 let r:Response;try{r=await fetch(`https://graph.facebook.com/${API_VERSION}/${path}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${auth}`},signal:AbortSignal.timeout(30000)});}catch{throw new Error('No se pudo conectar con Meta para consultar o canjear el token.');}
 let b:any;try{b=await r.json();}catch{throw new Error('Meta devolvió una respuesta ilegible al consultar el token.');}
 if(!r.ok||b.error)throw new MetaError(b.error?.code===190?'Meta rechazó el token. Conectá uno nuevo.':'Meta rechazó la consulta o el canje. Revisá App ID, clave secreta y token de esa app.',b.error?.code||r.status,b.error?.fbtrace_id||'');return b;
}
export async function inspectToken(token:string,appId:string,secret:string){const b=await request('debug_token',{input_token:token},`${appId}|${secret}`);return tokenMetadata(b.data,appId);}
export async function exchangeToken(token:string,appId:string,secret:string){const before=await inspectToken(token,appId,secret);if(!before.isValid)throw new Error('El token no es válido. Conectá uno nuevo antes de extenderlo.');const b=await request('oauth/access_token',{grant_type:'fb_exchange_token',client_id:appId,client_secret:secret,fb_exchange_token:token},`${appId}|${secret}`);if(typeof b.access_token!=='string'||b.access_token.length<20)throw new Error('Meta no devolvió un token válido.');const metadata=await inspectToken(b.access_token,appId,secret);if(!metadata.isValid)throw new Error('Meta devolvió un token inválido. Se conserva la conexión anterior.');return {token:b.access_token,metadata};}
