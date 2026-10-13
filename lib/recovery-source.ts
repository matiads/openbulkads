import {RECOVERY_FIELDS} from './attribution-recovery';
import {allPages,MetaError} from './meta-core';
import {CREATIVE_FIELDS,describeModel,promotedObjectFromCreative} from './model';
export async function recoverySource(call:(path:string,params:any)=>Promise<any>,sourceId:string){
 const source=await call(sourceId,{fields:RECOVERY_FIELDS});
 if(!source.promoted_object&&['WHATSAPP','INSTAGRAM_DIRECT','MESSENGER'].includes(source.destination_type)){
  const creatives=await allPages(p=>call(sourceId+'/adcreatives',p),{fields:CREATIVE_FIELDS});
  const candidates=new Map<string,any>();for(const c of creatives){try{const promoted=promotedObjectFromCreative(source.destination_type,describeModel(c));candidates.set(JSON.stringify(promoted),promoted);}catch{}}
  if(candidates.size===1){source.promoted_object=[...candidates.values()][0];source.recovery_page_source='existing_creatives';}
  else throw new MetaError(candidates.size?'Los anuncios originales usan distintas identidades de mensajería. No se puede elegir una automáticamente.':'Meta no devolvió promoted_object ni una identidad verificable en los creativos originales.',100,'',false);
 }
 return source;
}
