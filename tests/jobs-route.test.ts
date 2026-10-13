import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Isolate the route's I/O without bypassing production authentication.
const fakes = globalThis as typeof globalThis & { jobFakes: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const virtual: Record<string, string> = {
  server: `export const owner=()=>Promise.resolve('alice'); export const meta=()=>Promise.resolve(globalThis.jobFakes.meta); export const connection=()=>Promise.resolve({cooldown:globalThis.jobFakes.cooldown}); export const json=(value,status=200)=>Response.json(value,{status}); export const fail=(error)=>Response.json({error:error.message,wait:error.wait},{status:error.code===429?429:400});`,
  'media/storage': `export const mediaStore=()=>globalThis.jobFakes.mediaStoreReject?Promise.reject(new Error('MEDIA_ROOT missing')):Promise.resolve({delete:(key)=>globalThis.jobFakes.cleanup(key),head:async()=>({size:1}),get:async()=>({body:new ReadableStream(),size:8})});`,
  repositories: `export const repositories=()=>Promise.resolve({jobs:globalThis.jobFakes.jobs});`,
  'recovery-source': `export const recoverySource=()=>Promise.resolve({account_id:'1',campaign_id:'2',destination_type:'WHATSAPP',optimization_goal:'CONVERSATIONS',targeting:{},promoted_object:{page_id:'3'},billing_event:'IMPRESSIONS',daily_budget:100,name:'Source'});`,
  media: `export const download=()=>Promise.resolve('downloaded'); export const uploadMeta=()=>Promise.resolve({});`,
  'meta-core': `export class MetaError extends Error {constructor(message,code=0,trace='',ambiguous=false,wait=0){super(message);Object.assign(this,{code,trace,ambiguous,wait})}}; globalThis.jobMetaError=MetaError; export const account=x=>x; export const id=x=>x; export const allPages=()=>[]; export const newStory=()=>({}); export const driveUrl=()=>{};`,
};
const result = await build({entryPoints:['app/api/jobs/route.ts'], bundle:true, write:false, platform:'node', format:'esm', plugins:[{name:'fake-boundaries',setup(plugin){
  plugin.onResolve({filter:/^@\/lib\/media\/storage$/},()=>({path:'media/storage',namespace:'fake'}));
  plugin.onResolve({filter:/^@\/lib\/(server|repositories|meta-core|media|recovery-source)$/}, args=>({path:args.path.slice(6),namespace:'fake'}));
  plugin.onResolve({filter:/^\.\/meta-core$/},()=>({path:'meta-core',namespace:'fake'}));
  plugin.onLoad({filter:/.*/,namespace:'fake'},args=>({contents:virtual[args.path],loader:'js'}));
}}]});
const route = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const id = 'a'.repeat(64);
function setup(status='ready', stage='planned') {
  const row = {id,owner:'alice',kind:'run-plan',payload:'{}',state:JSON.stringify({stage}),status,created:1,updated:1};
  const events:string[] = [];
  fakes.jobFakes = { cooldown:0, meta:async()=>({}), cleanup:async()=>{events.push('cleanup');}, jobs:{
    list:async()=>[row], get:async()=>row, create:async()=>({kind:'existing',job:row}),
    prepareRetry:async()=>{events.push('retry'); return true;},
    claim:async()=>{events.push('claim'); row.status='working'; return {kind:'claimed',job:row};},
    update:async(_id:string,_owner:string,change:{status:string;state:string;expectedStatuses:string[]})=>{assert.deepEqual(change.expectedStatuses,['working']);events.push(change.status); row.status=change.status;row.state=change.state;return true;},
  }};
  return {row,events};
}
const post=()=>route.POST(new Request('https://app.test/api/jobs',{method:'POST',body:JSON.stringify({kind:'run-plan',account:'act_1',campaign:'1',adset:'2',placement:'ads',ads:[{kind:'ad',account:'act_1',adset:'2',name:'Ad',source:'existing'}]})}));
const patch=(retryPreparation=false)=>route.PATCH(new Request('https://app.test/api/jobs',{method:'PATCH',body:JSON.stringify({jobId:id,retryPreparation})}));
test('GET parses owner-scoped repository results',async()=>{setup();assert.equal((await (await route.GET(new Request('https://app.test/api/jobs'))).json()).data[0].state.stage,'planned');});
test('PATCH preserves done and retry safety',async()=>{const {events}=setup('failed');const response=await patch(true);assert.equal(response.status,400);assert.deepEqual(events,[]);});
test('PATCH preserves cooldown before claim',async()=>{const {events}=setup();fakes.jobFakes.cooldown=Date.now()+10000;const response=await patch();assert.equal(response.status,429);assert.deepEqual(events,[]);});
test('PATCH does not process a completed job',async()=>{const {events}=setup('done');assert.equal((await (await patch()).json()).status,'done');assert.deepEqual(events,[]);});
test('POST returns confirmed existing and rejects unresolved or cross-owner writes',async()=>{
  const {row}=setup();
  assert.deepEqual(await (await post()).json(),{id,status:'ready',state:{stage:'planned'}});
  fakes.jobFakes.jobs.create=async()=>{throw new Error('insert outcome unknown');};
  assert.deepEqual(await (await post()).json(),{error:'insert outcome unknown'});
  fakes.jobFakes.jobs.create=async()=>({kind:'conflict'});
  assert.equal((await post()).status,400);
  assert.equal(row.owner,'alice');
});
test('waiting and done persist through working CAS; done precedes cleanup and swallows cleanup errors',async()=>{
  const {row,events}=setup('ready','video');row.kind='ad';row.payload=JSON.stringify({source:'existing'});
  fakes.jobFakes.meta=async()=>({status:{video_status:'processing'}});
  assert.equal((await (await patch()).json()).status,'waiting');
  assert.deepEqual(events,['claim','waiting']);
  row.status='ready';row.state=JSON.stringify({stage:'verify',adId:'12',key:'media'});
  fakes.jobFakes.meta=async()=>({status:'PAUSED',effective_status:'PAUSED'});
  fakes.jobFakes.cleanup=async()=>{events.push('cleanup');throw new Error('cleanup failed');};
  assert.equal((await (await patch()).json()).status,'done');
  assert.deepEqual(events.slice(-3),['claim','done','cleanup']);
  assert.equal(row.status,'done');
  row.status='ready';row.state=JSON.stringify({stage:'verify',adId:'12',key:'media'});
  fakes.jobFakes.cleanup=async()=>{events.push('cleanup-success');};
  assert.equal((await (await patch()).json()).status,'done');
  assert.deepEqual(events.slice(-3),['claim','done','cleanup-success']);
});
test('done cleanup swallows mediaStore() rejection after durable done',async()=>{
  const {row,events}=setup('ready','verify');row.kind='ad';row.payload=JSON.stringify({source:'existing'});
  row.state=JSON.stringify({stage:'verify',adId:'12',key:'media'});
  fakes.jobFakes.meta=async()=>({status:'PAUSED',effective_status:'PAUSED'});
  fakes.jobFakes.mediaStoreReject=true;
  assert.equal((await (await patch()).json()).status,'done');
  assert.deepEqual(events.slice(-2),['claim','done']);
  assert.equal(row.status,'done');
  fakes.jobFakes.mediaStoreReject=false;
});
test('attribution rejection persists working-to-ready fallback without marking the mutation uncertain',async()=>{
  const {row,events}=setup('ready','copy_sets');row.kind='template';row.payload=JSON.stringify({account:'1',campaign:'2'});
  row.state=JSON.stringify({stage:'copy_sets',sets:[{id:'4',name:'Set'}],copiedSets:[],campaignId:'5',autoAttribution:true});
  fakes.jobFakes.meta=async(path:string,_params:unknown,method?:string)=>{
    if(method==='POST')throw new (globalThis as typeof globalThis & {jobMetaError: new (message:string)=>Error}).jobMetaError('attribution requires 1 day');
    return {account_id:'1',status:'PAUSED',id:path};
  };
  const response=await patch();assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.status,'ready',JSON.stringify(body));
  assert.equal(body.state.attributionRecovery.sourceId,'4');
  assert.deepEqual(events,['claim','ready']);assert.equal(JSON.parse(row.state).stage,'copy_sets');
});
test('ordinary failures remain failed; ambiguous Meta and transport mutation outcomes become uncertain',async()=>{
  for(const [error,stage,expected] of [[new Error('ordinary'),'verify','failed'],[Object.assign(new Error('unknown'),{ambiguous:true}),'ad','uncertain'],[new Error('network'),'ad','uncertain']] as const){
    const {row,events}=setup('ready',stage);row.kind='ad';row.payload=JSON.stringify({account:'1',adset:'2',name:'Ad'});
    fakes.jobFakes.meta=async()=>{throw error;};
    assert.equal((await (await patch()).json()).status,expected);
    assert.deepEqual(events,['claim',expected]);
    assert.equal(row.status,expected);
    if(expected==='uncertain'){assert.equal((await patch(true)).status,400);assert.deepEqual(events,['claim',expected]);}
  }
});
