import {multipartStream} from './media-stream';
import {MAX_MEDIA_BYTES,oversizeMessage} from './media-limit';
import {connection} from './server';
import {mediaStore} from './media/storage';
import {repositories} from './repositories';
import {driveUrl,MetaError,usageWait} from './meta-core';
import {fetchDriveFile} from './drive-download';
const MAX=MAX_MEDIA_BYTES;
// Trust Content-Length only as a streaming hint: a syntactically valid positive
// integer lets ingestion stream a known length. Anything else (missing,
// non-numeric, negative, zero, unsafe) is ignored and storage enforces the
// actual bytes against the active limit.
function declaredSize(value:string|null){if(value===null)return undefined;const trimmed=value.trim();if(!/^\d+$/.test(trimmed))return undefined;const parsed=Number(trimmed);return Number.isSafeInteger(parsed)?parsed:undefined;}
async function metaUploadResult(response:Response){
 const ambiguous=response.ok||response.status>=500;
 const detail=`HTTP ${response.status}${response.headers.get('content-type')?` (${response.headers.get('content-type')!.split(';')[0]})`:''}`;
 let raw:string;
 try{raw=await response.text();}catch{throw new MetaError(`Meta respondió ${detail}, pero no se pudo leer la respuesta.`,response.status,'',ambiguous);}
 if(!raw.trim())throw new MetaError(`Meta respondió ${detail} con una respuesta vacía.`,response.status,'',ambiguous);
 try{return JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new MetaError(`Meta respondió ${detail} con un formato inesperado.`,response.status,'',ambiguous);}
}
async function checkedMetaResult(user:string,response:Response){
 const result=await metaUploadResult(response);let wait=usageWait(response.headers);if(response.status===429||[4,17,613,80004].includes(result.error?.code))wait=Math.max(wait,60);if(wait)await (await repositories()).connections.setCooldown(user,Date.now()+wait*1000);if(result.error||!response.ok)throw new MetaError(result.error?.error_user_msg||result.error?.message||'No se pudo subir el archivo.',result.error?.code,result.error?.fbtrace_id,response.status>=500,wait);return result;
}
async function videoRequest(user:string,url:string,token:string,body:BodyInit){
 let response:Response;try{response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`},body,signal:AbortSignal.timeout(90000)});}catch{throw new MetaError('La subida se interrumpió. Revisá la biblioteca de Meta antes de repetir.',0,'',true);}return checkedMetaResult(user,response);
}
function uploadOffsets(result:any,size:number){
 const start=Number(result.start_offset),end=Number(result.end_offset);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>size)throw new MetaError('Meta devolvió offsets inválidos para la carga del video.',0,'',true);return {start,end};
}
async function uploadMetaVideo(user:string,account:string,object:{body:ReadableStream<Uint8Array>;size:number},token:string){
 const url=`https://graph-video.facebook.com/v26.0/${account}/advideos`;
 const started=await videoRequest(user,url,token,new URLSearchParams({upload_phase:'start',file_size:String(object.size)}));
 const session=String(started.upload_session_id||''),videoId=String(started.video_id||'');if(!session||!videoId)throw new MetaError('Meta no devolvió una sesión válida para subir el video.',0,'',true);
 let {start,end}=uploadOffsets(started,object.size);const reader=object.body.getReader();let remainder:Uint8Array=new Uint8Array(0),consumed=0;
 try{
  while(start!==end){
   if(start!==consumed)throw new MetaError('Meta intentó continuar el video desde una posición inesperada.',0,'',true);
   const wanted=end-start,chunk=new Uint8Array(wanted);let filled=0;
   while(filled<wanted){
    if(remainder.byteLength){const take=Math.min(remainder.byteLength,wanted-filled);chunk.set(remainder.subarray(0,take),filled);filled+=take;remainder=remainder.subarray(take);continue;}
    const next=await reader.read();if(next.done)throw new Error('El video almacenado terminó antes del tamaño registrado.');remainder=next.value;
   }
   const form=new FormData();form.set('upload_phase','transfer');form.set('upload_session_id',session);form.set('start_offset',String(start));form.set('video_file_chunk',new Blob([chunk],{type:'application/octet-stream'}),'creative.mp4');
   const transferred=await videoRequest(user,url,token,form);consumed=end;({start,end}=uploadOffsets(transferred,object.size));
  }
  if(consumed!==object.size||remainder.byteLength)throw new Error('El tamaño almacenado del video no coincide con su contenido.');
  const extra=await reader.read();if(!extra.done)throw new Error('El tamaño almacenado del video no coincide con su contenido.');
  const finished=await videoRequest(user,url,token,new URLSearchParams({upload_phase:'finish',upload_session_id:session,title:'creative.mp4'}));return {...finished,id:videoId};
 }catch(error){await reader.cancel(error).catch(()=>{});throw error;}finally{reader.releaseLock();}
}
export async function download(user:string,url:string){const r=await fetchDriveFile(driveUrl(url),{signal:AbortSignal.timeout(90000)});if(!r.ok||!r.body)throw new Error('No se pudo descargar de Drive. Revisá el acceso mediante enlace.');const type=r.headers.get('content-type')?.split(';')[0]||'';if(type.includes('text/')||type.includes('html'))throw new Error('Drive devolvió una página de acceso o permisos. Compartilo como "Cualquier persona con el enlace" o usá el archivo local.');const size=declaredSize(r.headers.get('content-length'));if(size!==undefined&&size>MAX)throw new Error(oversizeMessage());const key=`${user}/${crypto.randomUUID()}`;await (await mediaStore()).put(key,r.body,{httpMetadata:{contentType:type},size});return key;}
export async function uploadMeta(user:string,account:string,key:string,mediaType:string){if(!key.startsWith(user+'/'))throw new Error('Archivo no autorizado.');const object=await (await mediaStore()).get(key);if(!object||!object.size||object.size>MAX)throw new Error('Archivo inexistente o demasiado grande.');
const boundary='----openbulkads'+crypto.randomUUID().replaceAll('-','');const type=object.httpMetadata?.contentType||'application/octet-stream';
const c=await connection(user);if(mediaType==='video')return uploadMetaVideo(user,account,object,c.token);const multipart=multipartStream(object.body,object.size,mediaType,type,boundary);
let r:Response;try{r=await fetch(`https://graph.facebook.com/v26.0/${account}/adimages`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':String(multipart.length)},body:multipart.body,signal:AbortSignal.timeout(90000),duplex:'half'} as RequestInit&{duplex:'half'});await multipart.completion;}catch{throw new MetaError('La subida se interrumpió. Revisá la biblioteca de Meta antes de repetir.',0,'',true);}return checkedMetaResult(user,r);}
