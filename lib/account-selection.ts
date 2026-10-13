export function filterAccounts<T extends {id:string}>(available:T[],selection:string[]|null){return selection===null?available:available.filter(a=>selection.includes(a.id));}
