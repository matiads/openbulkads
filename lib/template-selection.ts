export function selectTemplateSets<T extends {id:string}>(available:T[],requested?:string[]){
 const ids=requested===undefined?available.map(s=>s.id):[...new Set(requested)].sort();
 if(!ids.length||ids.length>20)throw new Error('Seleccioná entre 1 y 20 conjuntos para copiar.');
 const allowed=new Set(available.map(s=>s.id));if(ids.some(id=>!allowed.has(id)))throw new Error('Un conjunto seleccionado no pertenece a la campaña plantilla.');
 return {ids,sets:available.filter(s=>ids.includes(s.id))};
}
