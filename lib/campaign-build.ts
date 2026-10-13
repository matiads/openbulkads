import {MetaError} from './meta-core';
export const MAX_ADSETS=20;
export const BID_STRATEGIES=['LOWEST_COST_WITHOUT_CAP','LOWEST_COST_WITH_BID_CAP','COST_CAP'];
export const GROUPING_MODES=['single','per-creative','auto-group','custom'] as const;
export type GroupingMode=typeof GROUPING_MODES[number];
export const STRUCTURE_LABELS:Record<string,string>={single:'Un solo conjunto','per-creative':'Un conjunto por creativo','auto-group':'Agrupar por nombre','custom':'Personalizado'};
const CAP_STRATEGIES=['LOWEST_COST_WITH_BID_CAP','COST_CAP'];
const CONVERSION_GOALS=['OFFSITE_CONVERSIONS','CONVERSATIONS','ONSITE_CONVERSIONS','LEAD_GENERATION','VALUE'];
// Suffixes that mark a variation of the same creative: hook1.mp4 and hook1_vertical.mp4 share a group.
const VARIANT=/(?:[\s_-]+(?:vertical|horizontal|landscape|portrait|square))+$|(?:[\s_-]*(?:1x1|4x5|9x16|16x9|1:1|4:5|9:16|16:9))+$/gi;
export function groupKey(name:string){const base=(name||'').trim().replace(/\.(?:jpe?g|png|mp4|mov)$/i,'').trim();let out=base;for(let i=0;i<4&&out;i++){const next=out.replace(VARIANT,'').replace(/[\s_-]+$/,'').trim();if(next===out)break;out=next;}return out||base||'conjunto';}
export function validateSets<T extends {key:string;name:string}>(sets:T[]){if(!sets.length||sets.length>MAX_ADSETS)throw new Error(`La estructura debe tener entre 1 y ${MAX_ADSETS} conjuntos.`);const names=sets.map(s=>(s.name||'').trim());if(names.some(n=>!n))throw new Error('Todos los conjuntos necesitan un nombre.');if(names.some(n=>n.length>200))throw new Error('Un nombre de conjunto supera 200 caracteres.');if(new Set(names).size!==names.length)throw new Error('Los nombres de los conjuntos deben ser distintos.');return sets;}
export function buildGroups(rows:{key:string;name:string;group?:string}[],mode:string,fallback:string){
 if(!rows.length)throw new Error('Agregá al menos un creativo antes de armar la estructura.');
 if(mode==='single')return validateSets([{key:'single',name:(fallback||'').trim()||'Conjunto principal',rowKeys:rows.map(r=>r.key)}]);
 if(mode==='per-creative'){const seen=new Map<string,number>();return validateSets(rows.map((r,i)=>{const base=(r.name||'').trim()||`Conjunto ${i+1}`;const count=seen.get(base)||0;seen.set(base,count+1);return {key:r.key,name:count?`${base} (${count+1})`:base,rowKeys:[r.key]};}));}
 if(mode==='auto-group'||mode==='custom'){const map=new Map<string,{key:string;name:string;rowKeys:string[]}>();for(const r of rows){const label=mode==='custom'?(r.group||'').trim():groupKey(r.name);if(!label)throw new Error('Asigná un conjunto a cada anuncio en el modo personalizado.');const g=map.get(label)||{key:label,name:label,rowKeys:[]};g.rowKeys.push(r.key);map.set(label,g);}return validateSets([...map.values()]);}
 throw new Error('Modo de estructura desconocido.');
}
// Lifetime budgets need an end date (and a start before it) or Meta rejects the write after the campaign already exists.
function applySchedule(params:any,input:any,lifetime:boolean){
 if(input.startTime)params.start_time=input.startTime;
 if(input.endTime)params.end_time=input.endTime;
 if(lifetime&&!input.endTime)throw new Error('Un presupuesto total necesita fecha de fin.');
 if(input.startTime&&input.endTime&&new Date(input.endTime)<=new Date(input.startTime))throw new Error('La fecha de fin debe ser posterior a la de inicio.');
}
export function buildCampaignParams(input:any,model:any){
 const objective=model?.objective;
 if(typeof objective!=='string'||!objective)throw new Error('La campaña modelo no informa un objetivo utilizable.');
 const params:any={name:input.name,objective,status:'PAUSED',special_ad_categories:structuredClone(model?.special_ad_categories||[]),buying_type:'AUCTION'};
 if(input.cbo){
  if(!(Number(input.budgetAmount)>0))throw new Error('Ingresá el presupuesto de la campaña.');
  applySchedule(params,input,input.budgetType==='lifetime');
  if(input.budgetType==='lifetime')params.lifetime_budget=Number(input.budgetAmount);else params.daily_budget=Number(input.budgetAmount);
  if(BID_STRATEGIES.includes(input.bidStrategy)){if(CAP_STRATEGIES.includes(input.bidStrategy)&&!(Number(input.bidAmount)>0))throw new Error('Ingresá el monto de la puja para la estrategia elegida.');params.bid_strategy=input.bidStrategy;if(CAP_STRATEGIES.includes(input.bidStrategy))params.bid_amount=Number(input.bidAmount);}
 }
 return params;
}
export function buildAdSetParams(input:any,model:any,campaignId:string,name:string){
 if(!model)throw new Error('Elegí un conjunto modelo.');
 const missing=['targeting','billing_event','optimization_goal','destination_type'].filter(k=>!model[k]);
 if(missing.length)throw new MetaError('Meta no devolvió los campos necesarios del conjunto modelo: '+missing.join(', ')+'.',100,'',false);
 const override=input.targeting||{};
 const targeting=structuredClone(model.targeting);
 if(Array.isArray(override.countries)&&override.countries.length)targeting.geo_locations={...(targeting.geo_locations||{}),countries:override.countries};
 if(Number.isInteger(override.ageMin))targeting.age_min=override.ageMin;
 if(Number.isInteger(override.ageMax))targeting.age_max=override.ageMax;
 if(Array.isArray(override.genders)){if(override.genders.length)targeting.genders=override.genders;else delete targeting.genders;}
 const params:any={name,campaign_id:campaignId,status:'PAUSED',destination_type:model.destination_type,optimization_goal:model.optimization_goal,billing_event:model.billing_event,targeting};
 if(model.promoted_object)params.promoted_object=structuredClone(model.promoted_object);
 else if(model.optimization_goal==='CONVERSATIONS')throw new MetaError('El conjunto modelo no tiene promoted_object y la optimización de conversaciones lo exige.',100,'',false);
 const messages=['WHATSAPP','INSTAGRAM_DIRECT','MESSENGER'].includes(model.destination_type)&&model.optimization_goal==='CONVERSATIONS';
 const attribution=messages?[{event_type:'CLICK_THROUGH',window_days:1}]:(Array.isArray(model.attribution_spec)&&model.attribution_spec.length)?structuredClone(model.attribution_spec):(CONVERSION_GOALS.includes(model.optimization_goal)?[{event_type:'CLICK_THROUGH',window_days:1}]:undefined);
 if(attribution)params.attribution_spec=attribution;
 for(const k of ['optimization_sub_event','dsa_beneficiary','dsa_payor'])if(model[k]!==undefined&&model[k]!==null&&model[k]!=='')params[k]=structuredClone(model[k]);
 if(!input.cbo){
  if(!(Number(input.adBudgetAmount)>0))throw new Error('Ingresá el presupuesto por conjunto.');
  applySchedule(params,input,input.adBudgetType==='lifetime');
  if(input.adBudgetType==='lifetime')params.lifetime_budget=Number(input.adBudgetAmount);else params.daily_budget=Number(input.adBudgetAmount);
  if(BID_STRATEGIES.includes(input.bidStrategy)){if(CAP_STRATEGIES.includes(input.bidStrategy)&&!(Number(input.bidAmount)>0))throw new Error('Ingresá el monto de la puja para la estrategia elegida.');params.bid_strategy=input.bidStrategy;if(CAP_STRATEGIES.includes(input.bidStrategy))params.bid_amount=Number(input.bidAmount);}
 }
 return params;
}
