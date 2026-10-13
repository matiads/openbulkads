const MEDIA_EXTENSIONS:Record<string,string>={'image/jpeg':'jpg','image/png':'png','video/mp4':'mp4','video/quicktime':'mov'};
export const LOCAL_PATH_DRIVE_MESSAGE='Eso es una ruta de archivo local, no un enlace de Google Drive. Usá «Archivo local» o arrastrá la imagen al lote.';
export function looksLikeLocalFilePath(value:string){const t=value.trim();if(!t)return false;if(t.startsWith('/')&&!t.startsWith('//'))return true;if(/^[A-Za-z]:[\\/]/.test(t))return true;if(t.toLowerCase().startsWith('file://'))return true;return false;}
export function rejectLocalPathForDrive(value:string){if(looksLikeLocalFilePath(value))throw new Error(LOCAL_PATH_DRIVE_MESSAGE);}
export function dispositionFilename(header:string){
 const extended=header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/)?.[1];let name='';if(extended){try{name=decodeURIComponent(extended.trim().replace(/^"|"$/g,''));}catch{}}
 if(!name)name=header.match(/filename\s*=\s*"([^"]+)"/i)?.[1]||header.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim()||'';
 return name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g,'').trim()||'';
}
export function driveFileId(url:string){try{const u=new URL(url);return u.pathname.match(/^\/file\/d\/([\w-]+)/)?.[1]||u.searchParams.get('id')||'';}catch{return '';}}
export function isDriveAccessPage(contentType:string){const type=contentType.split(';')[0].trim().toLowerCase();return type.startsWith('text/')||type.includes('html');}
export function fallbackFilename(fileId:string,contentType:string){const ext=MEDIA_EXTENSIONS[contentType.split(';')[0].trim().toLowerCase()];if(!ext)return '';const safe=fileId.replace(/[^A-Za-z0-9_-]/g,'').slice(0,64);return safe?`drive-${safe}.${ext}`:'';}
export function defaultAdName(filename:string){return filename.trim().replace(/\.(?:jpe?g|png|mp4|mov)$/i,'').slice(0,200);}
