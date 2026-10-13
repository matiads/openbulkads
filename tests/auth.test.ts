import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Configuration must exist before the Node Better Auth module is evaluated.
process.env.DATABASE_URL = 'postgresql://user:password@127.0.0.1:5432/openbulkads_test';
process.env.BETTER_AUTH_SECRET = 'test-secret-0123456789abcdef0123456789abcdef';
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
delete process.env.OPENBULKADS_RUNTIME;

const authBundlePath = './lib-auth.mjs';
const { auth, authOptions, betterAuthEnv } = await import(authBundlePath) as unknown as typeof import('../lib/auth');

import { safeRelativeReturnPath, signInPath } from '../app/auth-paths';

// Route-boundary test doubles deliberately span unrelated production dependency signatures.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fakes = Record<string, any>;
const globals = globalThis as typeof globalThis & { authFakes: Fakes };
let fakes: Fakes;

const virtual: Record<string, string> = {
  bindings: 'export const runtime = {};',
  repositories: 'export const repositories = () => globalThis.authFakes.repositories;',
  auth: 'export const auth = { api: { getSession: (args) => globalThis.authFakes.getSession(args) } };',
  'meta-core': `export class MetaError extends Error { constructor(message, code, trace, retryable, wait) { super(message); this.code = code; this.trace = trace; this.retryable = retryable; this.wait = wait; } }
    export const graph = () => {};`,
};
let serverPromise: Promise<Record<string, (request: Request, write?: boolean) => Promise<string>>> | undefined;
async function loadServer() {
  serverPromise ??= (async () => {
    const result = await build({ entryPoints: ['lib/server.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'server-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /^\.\/runtime\/bindings$/ }, () => ({ path: 'bindings', namespace: 'auth-fake' }));
      plugin.onResolve({ filter: /^\.\/repositories$/ }, () => ({ path: 'repositories', namespace: 'auth-fake' }));
      plugin.onResolve({ filter: /^\.\/auth$/ }, () => ({ path: 'auth', namespace: 'auth-fake' }));
      plugin.onResolve({ filter: /^\.\/meta-core$/ }, () => ({ path: 'meta-core', namespace: 'auth-fake' }));
      plugin.onLoad({ filter: /.*/, namespace: 'auth-fake' }, args => ({ contents: virtual[args.path], loader: 'js' }));
    } }] });
    return await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  })();
  return serverPromise;
}
function setup() {
  fakes = globals.authFakes = {
    getSession: async () => null,
    repositories: {},
  };
}
function request(path: string, origin = 'https://app.test') {
  return new Request(`https://app.test${path}`, { headers: { origin } });
}
async function expectCode(promise: Promise<unknown>, code: number) {
  await assert.rejects(promise, (error: { code?: number }) => error.code === code);
}

test('public registration is closed and administrative provisioning stays available', async () => {
  assert.equal(auth.options.emailAndPassword?.enabled, true);
  assert.equal(auth.options.emailAndPassword?.disableSignUp, true);
  await assert.rejects(
    auth.api.signUpEmail({ body: { email: 'someone@example.com', password: 'password-123', name: 'Someone' } }),
    (error: { body?: { code?: string } }) => error.body?.code === 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
  );
});

test('admin provisioning creates a credential user and resolves a valid session', async () => {
  const { betterAuth } = await import('better-auth');
  const { memoryAdapter } = await import('better-auth/adapters/memory');
  const memoryAuth = betterAuth({
    ...authOptions,
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    secret: 'in-memory-test-secret-0123456789abcdef',
    baseURL: 'http://localhost:3000',
  });
  const created = await memoryAuth.api.createUser({
    body: { email: 'admin@example.com', password: 'admin-password-123', name: 'Admin', role: 'admin' },
  });
  assert.equal(created.user.email, 'admin@example.com');
  assert.equal((created.user as { role?: string | null }).role, 'admin');
  const signedIn = await memoryAuth.api.signInEmail({
    body: { email: 'admin@example.com', password: 'admin-password-123' },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const session = await memoryAuth.api.getSession({ headers: new Headers({ cookie }) });
  assert.equal(session?.user?.id, created.user.id);
  assert.equal((session?.user as { role?: string | null } | undefined)?.role, 'admin');
  const missing = await memoryAuth.api.getSession({ headers: new Headers() });
  assert.equal(missing, null);
});

test('Node owner resolution uses the Better Auth session, never caller owner headers', async () => {
  setup();
  let sessionCalls = 0;
  fakes.getSession = async () => { sessionCalls += 1; return null; };
  const server = await loadServer();
  assert.equal(sessionCalls, 0); // Importing the server boundary never resolves a request session.
  await expectCode(server.owner(request('/api/connection')), 401);
  assert.equal(sessionCalls, 1);
  fakes.getSession = async () => ({ user: { id: 'better-auth-user' } });
  assert.equal(await server.owner(request('/api/connection')), 'better-auth-user');
});

test('distinct Better Auth sessions map to distinct owners and ignore caller headers', async () => {
  setup();
  const server = await loadServer();
  const spoofed = { origin: 'https://app.test', 'oai-authenticated-user-id': 'attacker' };
  fakes.getSession = async () => ({ user: { id: 'user-a' } });
  const first = await server.owner(new Request('https://app.test/api/connection', { headers: spoofed }));
  fakes.getSession = async () => ({ user: { id: 'user-b' } });
  const second = await server.owner(new Request('https://app.test/api/connection', { headers: spoofed }));
  assert.equal(first, 'user-a');
  assert.equal(second, 'user-b');
  assert.notEqual(first, second);
});

test('Node mutations reject foreign origins and keep same-origin writes', async () => {
  setup();
  fakes.getSession = async () => ({ user: { id: 'better-auth-user' } });
  const server = await loadServer();
  await expectCode(server.owner(request('/api/connection', 'https://other.test'), true), 403);
  assert.equal(await server.owner(request('/api/connection'), true), 'better-auth-user');
});

test('return paths stay relative and the sign-in path collapses to root', () => {
  assert.equal(safeRelativeReturnPath('/workspace?account=1#tab'), '/workspace?account=1#tab');
  assert.equal(safeRelativeReturnPath('//evil.example'), '/');
  assert.equal(safeRelativeReturnPath('https://evil.example'), '/');
  assert.equal(safeRelativeReturnPath('/sign-in?return_to=/x'), '/');
  assert.equal(signInPath('/workspace'), '/sign-in?return_to=%2Fworkspace');
});

test('Better Auth environment fails closed in production', () => {
  assert.throws(() => betterAuthEnv({ NODE_ENV: 'production' }), /BETTER_AUTH_SECRET/);
  assert.throws(() => betterAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'short' }), /BETTER_AUTH_SECRET/);
  assert.throws(() => betterAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(40) }), /BETTER_AUTH_URL/);
  assert.deepEqual(
    betterAuthEnv({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'x'.repeat(40), BETTER_AUTH_URL: 'https://app.example' }),
    { secret: 'x'.repeat(40), baseURL: 'https://app.example' },
  );
});

test('auth route dispatches GET and POST to the matching Better Auth handler', async () => {
  const calls: string[] = [];
  (globalThis as typeof globalThis & { authRouteCalls: string[] }).authRouteCalls = calls;
  const result = await build({ entryPoints: ['app/api/auth/[...all]/route.ts'], bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'auth-route-deps', setup(plugin) {
    plugin.onResolve({ filter: /^better-auth\/next-js$/ }, () => ({ path: 'next-js', namespace: 'auth-route' }));
    plugin.onResolve({ filter: /^@\/lib\/auth$/ }, () => ({ path: 'auth', namespace: 'auth-route' }));
    plugin.onLoad({ filter: /.*/, namespace: 'auth-route' }, args => ({ contents: args.path === 'next-js'
      ? 'export const toNextJsHandler = () => ({ GET: async () => { globalThis.authRouteCalls.push("GET"); return new Response("get"); }, POST: async () => { globalThis.authRouteCalls.push("POST"); return new Response("post", { status: 201 }); } });'
      : 'export const auth = {};', loader: 'js' }));
  } }] });
  const route = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
  assert.equal((await route.GET(request('/api/auth/get-session'))).status, 200);
  assert.equal((await route.POST(request('/api/auth/sign-in/email'))).status, 201);
  assert.deepEqual(calls, ['GET', 'POST']);
});

test('administrative CLI enables Node TypeScript type stripping', async () => {
  const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts['admin:create'], /--experimental-strip-types/);
});

const createAdminPath = resolve('scripts/create-admin.mjs');
function runCreateAdmin(args: string[]) {
  // Piped stdin is deliberately not a TTY, exactly like a non-interactive shell.
  return spawnSync(process.execPath, [createAdminPath, ...args], { input: '', encoding: 'utf8' });
}

test('administrative CLI rejects plaintext password arguments', () => {
  const result = runCreateAdmin(['--email', 'admin@example.com', '--password', 'secret-123']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /--password/);
  assert.doesNotMatch(result.stdout, /secret-123/);
  assert.doesNotMatch(result.stderr, /secret-123/);
});

test('administrative CLI fails closed without an interactive terminal', () => {
  const result = runCreateAdmin(['--email', 'admin@example.com']);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /interactive terminal/);
});

test('administrative CLI usage requires an email and advertises no password argument', () => {
  const result = runCreateAdmin([]);
  assert.equal(result.status, 64);
  assert.match(result.stderr, /--email/);
  assert.doesNotMatch(result.stderr, /--password/);
});

test('interactive password prompt returns the secret without echoing it', () => {
  const script = `
    import { promptPassword } from ${JSON.stringify(pathToFileURL(createAdminPath).href)};
    import { PassThrough, Writable } from 'node:stream';
    const input = new PassThrough();
    let captured = '';
    const output = new Writable({ write(chunk, _encoding, callback) { captured += chunk.toString(); callback(); } });
    const pending = promptPassword('Password: ', { input, output });
    input.write('hunter2-secret\\n');
    const answer = await pending;
    process.stdout.write(JSON.stringify({ answer, captured }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const { answer, captured } = JSON.parse(result.stdout) as { answer: string; captured: string };
  assert.equal(answer, 'hunter2-secret');
  assert.doesNotMatch(captured, /hunter2-secret/);
});
