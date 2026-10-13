import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
// Route test doubles deliberately span unrelated production dependency signatures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fakes = Record<string, any>;
const globals = globalThis as typeof globalThis & { routeFakes: Fakes };
let fakes: Fakes;
const virtual: Record<string, string> = {
  server: `export const owner=(...args)=>globalThis.routeFakes.owner(...args);
    export const connection=(...args)=>globalThis.routeFakes.connection(...args);
    export const encrypt=(...args)=>globalThis.routeFakes.encrypt(...args);
    export const meta=(...args)=>globalThis.routeFakes.meta(...args);
    export const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
    export const fail=(error)=>json({error:error.message||'No se pudo completar la operación.',code:error.code,trace:error.trace,wait:error.wait},[401,403,429].includes(error.code)?error.code:400);`,
  repositories: 'export const repositories=()=>globalThis.routeFakes.repositories;',
  settings: 'export const settings=(...args)=>globalThis.routeFakes.settings(...args); export const credentials=(...args)=>globalThis.routeFakes.credentials(...args);',
  'meta-core': 'export const graph=(...args)=>globalThis.routeFakes.graph(...args); export const allPages=(...args)=>globalThis.routeFakes.allPages(...args); export const account=(value)=>globalThis.routeFakes.account(value); export const id=(value)=>value; export const driveUrl=(value)=>globalThis.routeFakes.driveUrl(value);',
  'token-core': 'export const inspectToken=(...args)=>globalThis.routeFakes.inspectToken(...args); export const exchangeToken=(...args)=>globalThis.routeFakes.exchangeToken(...args);',
  model: 'export const isMetaCta=()=>true;',
  'recovery-source': 'export const recoverySource=(...args)=>globalThis.routeFakes.recoverySource(...args);',
  'attribution-recovery': `export const isAttributionFailure=(job)=>job.kind==='template'&&job.status==='failed';
    export const buildRecovery=()=>({attribution_spec:[{window_days:1}]}); export const fingerprint=()=>Promise.resolve('a'.repeat(64));`,
};
async function loadRoute(name: string) {
  const result = await build({ entryPoints: [`app/api/${name}/route.ts`], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'route-dependencies', setup(plugin) {
    plugin.onResolve({ filter: /^@\/lib\// }, args => {
      const key = args.path.slice('@/lib/'.length);
      if (key === 'file-name') return { path: new URL('../lib/file-name.ts', import.meta.url).pathname };
      return key in virtual ? { path: key, namespace: 'route-fake' } : undefined;
    });
    plugin.onLoad({ filter: /.*/, namespace: 'route-fake' }, args => ({ contents: virtual[args.path], loader: 'js' }));
  } }] });
  return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`) as Record<string, (request: Request) => Promise<Response>>;
}
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://app.test/api/${path}`, { method, headers: { origin: 'https://app.test' }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function expectResponse(response: Response, status: number, body: unknown) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), body);
}
function setup() {
  const connection = { owner: 'alice', token: 'encrypted', name: 'A', cooldown: 0 };
  const settings: { appId: string | null; appSecret: string | null; selectedAccounts: string | null; tokenMetadata: string | null } = { appId: null, appSecret: null, selectedAccounts: null, tokenMetadata: null };
  const presets: Array<{ id: string; name: string; configuration: string; created: number }> = [];
  const job = { id: 'a'.repeat(64), owner: 'alice', kind: 'template', status: 'failed', state: JSON.stringify({ sets: [{ id: '1' }], copiedSets: [], campaignId: '2', error: 'rejected' }), payload: JSON.stringify({ account: '1', campaign: '2' }) };
  let expected = 'encrypted';
  fakes = globals.routeFakes = {
    owner: async (r: Request, write?: boolean) => {
      if (write && r.headers.get('origin') !== new URL(r.url).origin) throw Object.assign(new Error('Solicitud de otro origen bloqueada.'), { code: 403 });
      return 'alice';
    },
    connection: async () => ({ token: 'plain', name: connection.name, cooldown: 0 }),
    encrypt: async () => 'encrypted-next',
    meta: async () => async () => ({ account_id: '1', campaign_id: '2' }),
    graph: async () => ({ name: 'A' }), allPages: async () => [{ permission: 'ads_management', status: 'granted' }],
    account: (value: string | null) => { if (!value) throw new Error('Cuenta inválida.'); return value; },
    driveUrl: (value: string) => value,
    credentials: async () => null, settings: async () => ({ app_id: settings.appId, app_secret: settings.appSecret, token_metadata: settings.tokenMetadata }),
    inspectToken: async () => ({ valid: true }), exchangeToken: async () => ({ token: 'extended', metadata: { valid: true } }),
    recoverySource: async () => ({ id: '1', name: 'source', account_id: '1', campaign_id: '2' }),
    repositories: {
      connections: {
        get: async () => expected ? { ...connection, token: expected } : null,
        upsert: async (_owner: string, token: string, name: string, metadata: string | null) => { expected = token; connection.name = name; settings.tokenMetadata = metadata; },
        updateMetadata: async (_owner: string, token: string, metadata: string, replacement?: string) => { if (expected !== token) return false; expected = replacement ?? token; settings.tokenMetadata = metadata; return true; },
        delete: async () => { expected = ''; settings.tokenMetadata = null; },
      },
      settings: {
        view: async () => ({ appId: settings.appId || '1638631194443006', hasAppSecret: Boolean(settings.appSecret), selectedAccounts: settings.selectedAccounts ? JSON.parse(settings.selectedAccounts) : null }),
        upsert: async (_owner: string, values: object) => Object.assign(settings, values),
        clearCredentials: async () => { settings.appSecret = null; settings.tokenMetadata = null; },
      },
      presets: {
        listParsed: async () => presets.map(p => ({ ...p, configuration: JSON.parse(p.configuration) })),
        create: async (preset: (typeof presets)[number]) => { presets.push(preset); }, delete: async () => true,
      },
      jobs: {
        get: async (_id: string, owner: string) => owner === job.owner ? job : null,
        recover: async () => { if (job.status !== 'failed') return false; job.status = 'ready'; return true; },
      },
    },
  };
  return { settings, presets, job, connection, replaceToken: () => { expected = 'concurrent'; } };
}

test('migrated route bodies, status mapping, origin and stale transitions', async () => {
  const state = setup();
  const connection = await loadRoute('connection');
  const settings = await loadRoute('settings');
  const presets = await loadRoute('presets');
  const recovery = await loadRoute('recovery');
  await expectResponse(await connection.GET(request('connection')), 200, { connected: true, name: 'A', canExtend: false, metadata: null });
  await expectResponse(await connection.POST(request('connection', 'POST', { token: 'bad' })), 400, { error: 'Token inválido.' });
  await expectResponse(await connection.POST(request('connection', 'POST', { token: '12345678901234567890' })), 200, { connected: true, name: 'A', canExtend: false, metadata: null });
  await expectResponse(await settings.GET(request('settings')), 200, { appId: '1638631194443006', hasAppSecret: false, selectedAccounts: null });
  fakes.credentials = async () => ({ appId: '123', secret: 'secret' });
  fakes.inspectToken = async () => { state.replaceToken(); return { valid: true }; };
  await expectResponse(await connection.PATCH(request('connection', 'PATCH', { action: 'inspect' })), 200, { connected: true, name: 'A', canExtend: false, metadata: null });
  assert.equal(state.settings.tokenMetadata, null);
  fakes.credentials = async () => null;
  fakes.inspectToken = async () => ({ valid: true });
  await expectResponse(await settings.POST(request('settings', 'POST', { action: 'credentials', appId: '123', secret: '1234567890123456' })), 200, { saved: true });
  await expectResponse(await settings.GET(request('settings')), 200, { appId: '123', hasAppSecret: true, selectedAccounts: null });
  await expectResponse(await settings.POST(request('settings', 'POST', { action: 'accounts', selectedAccounts: null })), 200, { saved: true, selectedAccounts: null });
  await expectResponse(await settings.DELETE(request('settings', 'DELETE')), 200, { saved: true });
  await expectResponse(await presets.GET(request('presets?account=1')), 200, { data: [] });
  const configuration = { campaign: '2', adset: '1', page: '', instagram: '', model: '', copy: { message: '', title: '', description: '', link: '', urlTags: '', cta: 'LEARN_MORE' } };
  const created = await presets.POST(request('presets', 'POST', { account: '1', name: 'P', configuration }));
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('Cache-Control'), 'no-store');
  assert.match(((await created.json()) as { id: string }).id, /^[0-9a-f-]{36}$/);
  state.presets.length = 0;
  state.presets.push({ id: 'preset', name: 'P', configuration: '{"x":1}', created: 1 });
  await expectResponse(await presets.GET(request('presets?account=1')), 200, { data: [{ id: 'preset', name: 'P', configuration: { x: 1 }, created: 1 }] });
  await expectResponse(await presets.DELETE(request('presets', 'DELETE', { id: '11111111-1111-4111-8111-111111111111', account: '1' })), 200, { deleted: true });
  state.presets[0].configuration = '{';
  const malformed = await presets.GET(request('presets?account=1'));
  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get('Cache-Control'), 'no-store');
  assert.match(((await malformed.json()) as { error: string }).error, /JSON|property/i);
  const fingerprint = 'a'.repeat(64), jobId = 'a'.repeat(64);
  await expectResponse(await recovery.GET(request(`recovery?job=${jobId}`)), 200, { jobId, sourceId: '1', sourceName: 'source', campaign: { account_id: '1', campaign_id: '2' }, previousAttribution: null, pageSource: null, params: { attribution_spec: [{ window_days: 1 }] }, fingerprint });
  await expectResponse(await recovery.POST(request('recovery', 'POST', { jobId, fingerprint: 'b'.repeat(64) })), 400, { error: 'La configuración cambió desde la revisión. Cerrá y volvé a abrir la recuperación.' });
  const recover = fakes.repositories.jobs.recover;
  fakes.repositories.jobs.recover = async () => false;
  await expectResponse(await recovery.POST(request('recovery', 'POST', { jobId, fingerprint })), 400, { error: 'El trabajo ya cambió de estado. Actualizá el historial.' });
  fakes.repositories.jobs.recover = recover;
  await expectResponse(await recovery.POST(request('recovery', 'POST', { jobId, fingerprint })), 200, { id: jobId, status: 'ready', state: { sets: [{ id: '1' }], copiedSets: [], campaignId: '2', attributionRecovery: { sourceId: '1', params: { attribution_spec: [{ window_days: 1 }] } } } });
  await expectResponse(await recovery.POST(request('recovery', 'POST', { jobId, fingerprint })), 400, { error: 'Este trabajo no tiene un rechazo de atribución recuperable.' });
  fakes.owner = async () => 'bob';
  await expectResponse(await recovery.GET(request(`recovery?job=${jobId}`)), 400, { error: 'Este trabajo no tiene un rechazo de atribución recuperable.' });
  fakes.owner = async (r: Request, write?: boolean) => {
    if (write && r.headers.get('origin') !== new URL(r.url).origin) throw Object.assign(new Error('Solicitud de otro origen bloqueada.'), { code: 403 });
    return 'alice';
  };
  await expectResponse(await connection.DELETE(new Request('https://app.test/api/connection', { method: 'DELETE', headers: { origin: 'https://other.test' } })), 403, { error: 'Solicitud de otro origen bloqueada.', code: 403 });
  await expectResponse(await connection.DELETE(request('connection', 'DELETE')), 200, { connected: false });
});

test('Drive filename lookup falls back to a stable id-derived name and rejects access pages', async () => {
  setup();
  const route = await loadRoute('file-name');
  const originalFetch = globalThis.fetch;
  const driveLink = 'https://drive.google.com/file/d/abcdefghijkl/view?usp=sharing';
  await expectResponse(
    await route.POST(request('file-name', 'POST', { url: '/tmp/herdr-clipboard-images-1000/client-424-clipboard-1791857999443083440-0.png' })),
    400,
    { error: 'Eso es una ruta de archivo local, no un enlace de Google Drive. Usá «Archivo local» o arrastrá la imagen al lote.' },
  );
  try {
    globalThis.fetch = async () => new Response(null, { status: 200, headers: { 'content-type': 'image/png' } });
    await expectResponse(await route.POST(request('file-name', 'POST', { url: driveLink })), 200, { filename: 'drive-abcdefghijkl.png', name: 'drive-abcdefghijkl' });
    globalThis.fetch = async () => new Response('binary', { status: 200, headers: { 'content-type': 'image/jpeg', 'content-disposition': 'attachment; filename="Oferta 01.jpg"' } });
    await expectResponse(await route.POST(request('file-name', 'POST', { url: driveLink })), 200, { filename: 'Oferta 01.jpg', name: 'Oferta 01' });
    globalThis.fetch = async () => new Response('<html>Acceder</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    await expectResponse(await route.POST(request('file-name', 'POST', { url: driveLink })), 400, { error: 'Drive devolvió una página de acceso o permisos. Compartilo como "Cualquier persona con el enlace" o usá el archivo local.' });
    globalThis.fetch = async () => new Response('binary', { status: 200, headers: { 'content-type': 'application/octet-stream' } });
    await expectResponse(await route.POST(request('file-name', 'POST', { url: driveLink })), 400, { error: 'Drive no devolvió el nombre del archivo. Revisá el acceso mediante enlace o ingresá el nombre manualmente.' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

