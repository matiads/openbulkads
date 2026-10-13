import {isDriveAccessPage} from './file-name';

const MAX_CONFIRMATION_BYTES=1024*1024;
const CONFIRMATION_FIELDS=new Set(['confirm','uuid','resourcekey']);

function decodeHtmlAttribute(value:string){return value.replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#(?:39|x27);/gi,"'");}

async function confirmationHtml(response:Response){
 const length=Number(response.headers.get('content-length'));
 if(Number.isFinite(length)&&length>MAX_CONFIRMATION_BYTES)throw new Error('La página de confirmación de Drive es demasiado grande.');
 const reader=response.body?.getReader();
 if(!reader)return '';
 const decoder=new TextDecoder();let total=0,text='';
 try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_CONFIRMATION_BYTES)throw new Error('La página de confirmación de Drive es demasiado grande.');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
 finally{reader.releaseLock();}
}

function confirmationUrl(html:string,directUrl:string){
 const original=new URL(directUrl),id=original.searchParams.get('id');
 if(!id)return null;
 const fields=new URLSearchParams();
 for(const input of html.match(/<input\b[^>]*>/gi)||[]){
  const attrs=new Map<string,string>();
  for(const match of input.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))attrs.set(match[1].toLowerCase(),decodeHtmlAttribute(match[2]??match[3]??match[4]??''));
  const name=attrs.get('name'),value=attrs.get('value');
  if(name&&value!==undefined&&(name==='id'||CONFIRMATION_FIELDS.has(name)))fields.set(name,value);
 }
 if(fields.get('id')&&fields.get('id')!==id)return null;
 if(!fields.has('confirm')&&!fields.has('uuid'))return null;
 const confirmed=new URL('https://drive.usercontent.google.com/download');
 confirmed.searchParams.set('id',id);confirmed.searchParams.set('export','download');
 for(const name of CONFIRMATION_FIELDS){const value=fields.get(name)||original.searchParams.get(name);if(value)confirmed.searchParams.set(name,value);}
 return confirmed;
}

/** Downloads a public Drive file, following only Google's explicit large-file confirmation form. */
export async function fetchDriveFile(directUrl:string,init:RequestInit={}){
 const first=await fetch(directUrl,{...init,redirect:'follow'});
 if(!first.ok||!isDriveAccessPage(first.headers.get('content-type')||''))return first;
 const confirmed=confirmationUrl(await confirmationHtml(first),directUrl);
 if(!confirmed)return first;
 const headers=new Headers(init.headers),cookie=first.headers.get('set-cookie');
 if(cookie)headers.set('Cookie',cookie.split(';',1)[0]);
 return fetch(confirmed,{...init,headers,redirect:'follow'});
}
