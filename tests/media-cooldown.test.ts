import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

type CooldownFakes = {
  setCooldownCalls: { owner: string; until: number }[];
  dbPrepareCalled: boolean;
  bucketGet: () => Promise<{ body: ReadableStream<Uint8Array>; size: number; httpMetadata?: { contentType?: string } }>;
  connection: () => Promise<{ token: string; name: string; cooldown: number }>;
};
const globals = globalThis as typeof globalThis & { cooldownFakes: CooldownFakes };

const virtual: Record<string, string> = {
  server: `export const connection=(user)=>globalThis.cooldownFakes.connection(user);
export function db(){globalThis.cooldownFakes.dbPrepareCalled=true;throw new Error('legacy db() path must not be used');}`,
  'media/storage': `export const mediaStore=()=>Promise.resolve({get:(key)=>globalThis.cooldownFakes.bucketGet(key)});`,
  'media-stream': `export async function boundedBlob(){return new Blob([]);}
export function multipartStream(body){const completion=(async()=>{const r=body.getReader();try{while(true){const {done}=await r.read();if(done)break;}}finally{r.releaseLock();}})();return {body,completion};}`,
  'meta-core': `export class MetaError extends Error {constructor(m,c=0,t='',a=false,w=0){super(m);Object.assign(this,{code:c,trace:t,ambiguous:a,wait:w});}}
export const driveUrl=()=>{}; export function usageWait(){return 0;}`,
  repositories: `export const repositories=()=>Promise.resolve({connections:{setCooldown:(owner,until)=>{globalThis.cooldownFakes.setCooldownCalls.push({owner,until});}}});`,
};

async function loadUploadMeta() {
  const result = await build({
    entryPoints: ['lib/media.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'media-cooldown-fakes',
      setup(plugin) {
        plugin.onResolve({ filter: /^\.\/media\/storage$/ }, () => ({ path: 'media/storage', namespace: 'mc-fake' }));
        plugin.onResolve({ filter: /^@\/lib\/media\/storage$/ }, () => ({ path: 'media/storage', namespace: 'mc-fake' }));
        plugin.onResolve({ filter: /^\.\/server$/ }, () => ({ path: 'server', namespace: 'mc-fake' }));
        plugin.onResolve({ filter: /^\.\/media-stream$/ }, () => ({ path: 'media-stream', namespace: 'mc-fake' }));
        plugin.onResolve({ filter: /^\.\/meta-core$/ }, () => ({ path: 'meta-core', namespace: 'mc-fake' }));
        plugin.onResolve({ filter: /^\.\/repositories$/ }, () => ({ path: 'repositories', namespace: 'mc-fake' }));
        plugin.onLoad({ filter: /.*/, namespace: 'mc-fake' }, args => ({ contents: virtual[args.path], loader: 'js' }));
      },
    }],
  });
  return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`) as { uploadMeta: typeof import('../lib/media').uploadMeta };
}

function tinyBody(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
}

test('uploadMeta persists rate-limit cooldown via repositories, not the legacy db()', async () => {
  globals.cooldownFakes = {
    setCooldownCalls: [],
    dbPrepareCalled: false,
    bucketGet: async () => ({ body: tinyBody(8), size: 8, httpMetadata: { contentType: 'image/jpeg' } }),
    connection: async () => ({ token: 'fake-token', name: 'n', cooldown: 0 }),
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ error: { code: 4, message: 'Rate limit', fbtrace_id: 'trace' } }, { status: 429 });
  const before = Date.now();
  try {
    const { uploadMeta } = await loadUploadMeta();
    await assert.rejects(uploadMeta('alice', 'act_123', 'alice/key-1', 'image'), (e: { wait?: number }) => (e.wait ?? 0) >= 60);
    assert.equal(globals.cooldownFakes.dbPrepareCalled, false);
    assert.equal(globals.cooldownFakes.setCooldownCalls.length, 1);
    assert.equal(globals.cooldownFakes.setCooldownCalls[0].owner, 'alice');
    assert.ok(globals.cooldownFakes.setCooldownCalls[0].until >= before + 60_000);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
