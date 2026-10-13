import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, chmod } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { probeMediaRoot, readinessResult, type ProbeFileSystem } from '../lib/readiness';
import { checkDatabaseReady, sharedDatabasePool } from '../db/postgres/client';

type FakeOptions = {
  openError?: Error;
  writeError?: Error;
  syncError?: Error;
  closeError?: Error;
  unlinkError?: Error;
};

function fakeFs(options: FakeOptions = {}) {
  const opens: Array<{ path: string; flags: string; mode: number }> = [];
  const unlinked: string[] = [];
  const events: string[] = [];
  const fs: ProbeFileSystem = {
    async open(path, flags, mode) {
      events.push('open');
      opens.push({ path, flags, mode });
      if (options.openError) throw options.openError;
      return {
        async writeFile() {
          events.push('write');
          if (options.writeError) throw options.writeError;
        },
        async sync() {
          events.push('sync');
          if (options.syncError) throw options.syncError;
        },
        async close() {
          events.push('close');
          if (options.closeError) throw options.closeError;
        },
      };
    },
    async unlink(path) {
      events.push('unlink');
      unlinked.push(path);
      if (options.unlinkError) throw options.unlinkError;
    },
  };
  return { fs, opens, unlinked, events };
}

test('media probe writes a uniquely named 0600 file and leaves no artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oba-ready-'));
  try {
    assert.equal(await probeMediaRoot({ MEDIA_ROOT: root }), true);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('media probe opens with exclusive creation and 0600 mode, using unique names', async () => {
  const first = fakeFs();
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: '/var/media' }, first.fs), true);
  assert.equal(first.opens.length, 1);
  assert.equal(first.opens[0].flags, 'wx');
  assert.equal(first.opens[0].mode, 0o600);
  assert.equal(first.opens[0].path, first.unlinked[0]);
  assert.match(first.opens[0].path, /^\/var\/media\/\.readiness-/);

  const second = fakeFs();
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: '/var/media' }, second.fs), true);
  assert.notEqual(first.opens[0].path, second.opens[0].path);
});

test('media probe closes and unlinks in finally when write or sync fails', async () => {
  for (const failure of [{ syncError: new Error('sync') }, { writeError: new Error('write') }] as FakeOptions[]) {
    const fake = fakeFs(failure);
    assert.equal(await probeMediaRoot({ MEDIA_ROOT: '/var/media' }, fake.fs), false);
    assert.equal(fake.events.at(-2), 'close');
    assert.equal(fake.events.at(-1), 'unlink');
    assert.equal(fake.unlinked.length, 1);
  }
});

test('media probe fails closed when the root is missing, relative or unwritable', async () => {
  assert.equal(await probeMediaRoot({}), false);
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: '' }), false);
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: 'relative/media' }), false);

  const denied = fakeFs({ openError: Object.assign(new Error('EACCES'), { code: 'EACCES' }) });
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: '/var/media' }, denied.fs), false);
  assert.deepEqual(denied.events, ['open']);
  assert.equal(denied.unlinked.length, 0);

  const unlinkFails = fakeFs({ unlinkError: new Error('busy') });
  assert.equal(await probeMediaRoot({ MEDIA_ROOT: '/var/media' }, unlinkFails.fs), false);
  assert.deepEqual(unlinkFails.events, ['open', 'write', 'sync', 'close', 'unlink']);
});

test('readiness is 200 only when database and media both pass', async () => {
  assert.deepEqual(await readinessResult({ database: async () => true, media: async () => true }), {
    status: 200,
    body: { ready: true, database: true, media: true },
  });
  assert.deepEqual(await readinessResult({ database: async () => false, media: async () => true }), {
    status: 503,
    body: { ready: false, database: false, media: true },
  });
  assert.deepEqual(await readinessResult({ database: async () => true, media: async () => false }), {
    status: 503,
    body: { ready: false, database: true, media: false },
  });
});

test('readiness never throws and never returns probe errors or secrets', async () => {
  const result = await readinessResult({
    database: async () => {
      throw new Error('postgresql://user:secret@host/openbulkads');
    },
    media: async () => {
      throw new Error('secret');
    },
  });
  assert.deepEqual(result, { status: 503, body: { ready: false, database: false, media: false } });
  assert.doesNotMatch(JSON.stringify(result.body), /secret|postgres/i);
});

test('database readiness uses a non-mutating schema-aware query', async () => {
  const queries: string[] = [];
  const ready = await checkDatabaseReady({
    query: async (text) => {
      queries.push(text);
      return { rows: [{ ready: true }] };
    },
  });
  assert.equal(ready, true);
  assert.match(queries[0], /to_regclass/);
  assert.doesNotMatch(queries[0], /\b(?:insert|update|delete|alter|drop|create|truncate)\b/i);
  assert.equal(await checkDatabaseReady({ query: async () => ({ rows: [{ ready: false }] }) }), false);
  assert.equal(await checkDatabaseReady({ query: async () => ({ rows: [] }) }), false);
});

test('database readiness reuses one memoized pool instead of a per-request pool', async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://readiness:readiness@127.0.0.1:5432/readiness';
  try {
    const first = sharedDatabasePool();
    assert.equal(sharedDatabasePool(), first);
    await first.end();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

async function loadRoute(readinessSource: string) {
  const result = await build({
    entryPoints: ['app/api/ready/route.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'fake-readiness',
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/readiness$/ }, () => ({ path: 'readiness', namespace: 'fake-readiness' }));
          plugin.onLoad({ filter: /.*/, namespace: 'fake-readiness' }, () => ({ contents: readinessSource, loader: 'js' }));
        },
      },
    ],
  });
  return (await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  )) as { GET: () => Promise<Response> };
}

test('readiness route maps results to 200/503 with no-store and a minimal body', async () => {
  const ready = await loadRoute(
    'export const readinessResult=async()=>({status:200,body:{ready:true,database:true,media:true}});',
  );
  const readyResponse = await ready.GET();
  assert.equal(readyResponse.status, 200);
  assert.equal(readyResponse.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await readyResponse.json(), { ready: true, database: true, media: true });

  const down = await loadRoute(
    'export const readinessResult=async()=>({status:503,body:{ready:false,database:false,media:true}});',
  );
  const downResponse = await down.GET();
  assert.equal(downResponse.status, 503);
  assert.equal(downResponse.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await downResponse.json(), { ready: false, database: false, media: true });
});

test('readiness modules keep pg and fs behind dynamic imports', async () => {
  for (const file of ['lib/readiness.ts', 'app/api/ready/route.ts']) {
    const source = readFileSync(resolve(file), 'utf8');
    assert.doesNotMatch(
      source,
      /^\s*import\s[^;\n]*from\s+['"](?:pg|node:fs|node:fs\/promises)['"]/m,
      `${file} must not statically import pg or fs`,
    );
  }
  const readiness = readFileSync(resolve('lib/readiness.ts'), 'utf8');
  assert.match(readiness, /import\(['"]@\/db\/postgres\/client['"]\)/);
  assert.match(readiness, /import\(['"]node:fs\/promises['"]\)/);

  const result = await build({
    entryPoints: ['lib/readiness.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    metafile: true,
    plugins: [
      {
        name: 'postgres-boundary',
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/db\/postgres\/client$/ }, () => ({ path: '@/db/postgres/client', external: true }));
        },
      },
    ],
  });
  const output = result.outputFiles[0].text;
  assert.doesNotMatch(output, /from\s*['"]pg['"]/);
  assert.doesNotMatch(output, /from\s*['"]node:fs['"]/);
  assert.doesNotMatch(output, /from\s*['"]node:fs\/promises['"]/);
});

test('media probe reports false on a real unwritable root', async (t) => {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    t.skip('running as root; directory permissions are not enforced');
    return;
  }
  const root = await mkdtemp(join(tmpdir(), 'oba-ready-ro-'));
  await chmod(root, 0o500);
  try {
    assert.equal(await probeMediaRoot({ MEDIA_ROOT: root }), false);
  } finally {
    await chmod(root, 0o700);
    await rm(root, { recursive: true, force: true });
  }
});

