import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runtime, resolveTokenEncryptionKey } from '../lib/runtime/bindings';
import { build } from 'esbuild';
import { resolve } from 'node:path';

const validKey = Buffer.alloc(32, 0x2a).toString('base64');
const shortKey = Buffer.alloc(16, 0x2a).toString('base64');

function withTokenKey(value: string | undefined, run: () => void) {
  const saved = process.env.TOKEN_ENCRYPTION_KEY;
  try {
    if (value === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = value;
    run();
  } finally {
    if (saved === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = saved;
  }
}

test('Node runtime reads TOKEN_ENCRYPTION_KEY from the environment and fails closed on invalid keys', () => {
  withTokenKey(validKey, () => assert.equal(runtime.TOKEN_ENCRYPTION_KEY, validKey));
  withTokenKey(undefined, () => assert.equal(runtime.TOKEN_ENCRYPTION_KEY, undefined));
  withTokenKey('', () => assert.equal(runtime.TOKEN_ENCRYPTION_KEY, undefined));
  withTokenKey(shortKey, () => assert.throws(() => runtime.TOKEN_ENCRYPTION_KEY, /clave de cifrado/));
  withTokenKey('not base64!', () => assert.throws(() => runtime.TOKEN_ENCRYPTION_KEY, /clave de cifrado/));
});

test('Node runtime requires canonical standard base64 of exactly 32 bytes', () => {
  const binaryKey = Buffer.alloc(32, 0xfb).toString('base64'); // contains both '+' and '/'
  const urlSafeKey = binaryKey.replace(/\+/g, '-').replace(/\//g, '_');
  const unpaddedKey = validKey.replace(/=+$/, '');
  const doublePaddedKey = validKey + '=';
  // Same decoded bytes as `validKey`, but the trailing data char carries
  // non-zero pad bits, so it is a non-canonical spelling.
  const nonCanonicalTailKey = validKey.slice(0, -2) + 'p=';
  const malformed = [
    unpaddedKey,
    validKey.slice(0, 4) + ' ' + validKey.slice(4),
    validKey.slice(0, 4) + '\n' + validKey.slice(4),
    validKey.slice(0, 4) + '\t' + validKey.slice(4),
    urlSafeKey,
    doublePaddedKey,
    nonCanonicalTailKey,
  ];
  for (const invalid of malformed) {
    withTokenKey(invalid, () => assert.throws(() => runtime.TOKEN_ENCRYPTION_KEY, /clave de cifrado/));
  }
  // The canonical binary key and the canonical valid key are both accepted.
  withTokenKey(binaryKey, () => assert.equal(runtime.TOKEN_ENCRYPTION_KEY, binaryKey));
  withTokenKey(validKey, () => assert.equal(runtime.TOKEN_ENCRYPTION_KEY, validKey));
});

test('resolveTokenEncryptionKey validates the environment key and fails closed', () => {
  assert.equal(resolveTokenEncryptionKey(validKey), validKey);
  assert.equal(resolveTokenEncryptionKey(undefined), undefined);
  assert.equal(resolveTokenEncryptionKey(''), undefined);
  assert.throws(() => resolveTokenEncryptionKey('not base64!'), /clave de cifrado/);
  assert.throws(() => resolveTokenEncryptionKey(shortKey), /clave de cifrado/);
});

test('repository imports are lazy and PostgreSQL configuration is only evaluated on first call', async () => {
  const result = await build({ entryPoints: ['lib/repositories/index.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'runtime-dispatch-fakes', setup(plugin) {
    plugin.onResolve({ filter: /^@\// }, args => {
      if (args.path === '@/db/postgres/client') return { path: 'postgres-client', namespace: 'runtime-fake' };
      if (args.path === '@/db/postgres/repositories') return { path: 'postgres-repos', namespace: 'runtime-fake' };
      return { path: resolve(args.path.slice(2), 'index.ts') };
    });
    plugin.onLoad({ filter: /.*/, namespace: 'runtime-fake' }, args => ({
      contents: args.path === 'postgres-repos'
        ? 'export const createRepositories=()=>({});'
        : "throw new Error('PostgreSQL configuration was evaluated'); export const createDatabase=()=>({});",
      loader: 'js',
    }));
  } }] });
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  assert.equal(typeof loaded.repositories, 'function'); // Import did not require DATABASE_URL.
  await assert.rejects(loaded.repositories(), /PostgreSQL configuration was evaluated/);
});
