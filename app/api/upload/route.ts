import {owner,json,fail} from '@/lib/server';
import {MAX_MEDIA_BYTES,uploadTooLargeMessage} from '@/lib/media-limit';
import {mediaStore} from '@/lib/media/storage';
// Content-Length is a streaming hint, not the limit. A valid positive integer
// lets ingestion stream a known length; anything else is ignored and storage
// enforces the real byte count so a missing, understated, or invalid header
// cannot smuggle an oversized body through.
function declaredSize(value:string|null){if(value===null)return undefined;const trimmed=value.trim();if(!/^\d+$/.test(trimmed))return undefined;const parsed=Number(trimmed);return Number.isSafeInteger(parsed)?parsed:undefined;}
export async function POST(r:Request){try{const user=await owner(r,true),type=r.headers.get('content-type')||'',size=declaredSize(r.headers.get('content-length'));if(size!==undefined&&size>MAX_MEDIA_BYTES)throw new Error(uploadTooLargeMessage());if(!['image/jpeg','image/png','video/mp4','video/quicktime'].includes(type))throw new Error('Usá JPG, PNG, MP4 o MOV.');if(!r.body)throw new Error('Archivo vacío.');const key=`${user}/${crypto.randomUUID()}`;await (await mediaStore()).put(key,r.body,{httpMetadata:{contentType:type},size});return json({key,type});}catch(e){return fail(e);}}
