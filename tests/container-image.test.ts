import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  SECRET_FILE_ENV,
  buildChildEnv,
  dropPrivileges,
  loadSecretEnv,
} from '../scripts/container-start.mjs';

const dockerfile = () => readFileSync(resolve('Dockerfile'), 'utf8');

function baseEnv(extra: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.OPENBULKADS_RUNTIME;
  delete env.PORT;
  delete env.HOSTNAME;
  delete env.MIGRATION_DATABASE_URL;
  return { ...env, ...extra };
}

function runStart(args: string[], extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['scripts/container-start.mjs', ...args], {
    encoding: 'utf8',
    env: baseEnv(extra),
  });
}

test('production image is a multi-stage Node 22 build with a non-root runtime', () => {
  const contents = dockerfile();
  const stages = contents.match(/^FROM\s+\S+/gm) ?? [];
  assert.ok(stages.length >= 3, `expected at least three build stages, found ${stages.length}`);
  for (const stage of stages) {
    assert.match(stage, /node:22/, `every build stage must pin Node 22: ${stage}`);
  }
  assert.match(contents, /^ENV NEXT_OUTPUT=standalone$/m);
  assert.match(contents, /^ENV NODE_ENV=production$/m);
  assert.match(contents, /^EXPOSE 3000$/m);
  assert.match(contents, /scripts\/container-start\.mjs/);

  const userLine = contents
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('USER '));
  assert.ok(userLine, 'the runtime stage must declare a USER');
  assert.doesNotMatch(userLine!, /^USER\s+(root|0)\b/, 'the runtime user must not be root');
});

test('the production image consumes the public media-limit build arg into build and runtime', () => {
  const contents = dockerfile();
  const argMatches = contents.match(/^ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250$/gm) ?? [];
  assert.equal(
    argMatches.length,
    2,
    'the build ARG must be declared in the builder and runner stages with a 250 MB default',
  );
  const envMatches = contents.match(/^ENV NEXT_PUBLIC_MEDIA_LIMIT_MB=\$NEXT_PUBLIC_MEDIA_LIMIT_MB$/gm) ?? [];
  assert.equal(envMatches.length, 2, 'the ARG must be consumed as ENV in both stages');

  const builderIndex = contents.indexOf('FROM node:22-bookworm-slim AS builder');
  const runnerIndex = contents.indexOf('FROM node:22-bookworm-slim AS runner');
  const buildIndex = contents.indexOf('RUN npm run build');
  assert.ok(builderIndex >= 0 && runnerIndex >= 0 && buildIndex >= 0, 'the build stages and command must exist');
  const builderArg = contents.indexOf('ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250', builderIndex);
  const builderEnv = contents.indexOf('ENV NEXT_PUBLIC_MEDIA_LIMIT_MB=$NEXT_PUBLIC_MEDIA_LIMIT_MB', builderIndex);
  assert.ok(builderArg > builderIndex && builderArg < buildIndex, 'the ARG must be declared in the builder before next build');
  assert.ok(builderEnv > builderArg && builderEnv < buildIndex, 'the builder must export the ARG before next build');
  const runnerArg = contents.indexOf('ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250', runnerIndex);
  const runnerEnv = contents.indexOf('ENV NEXT_PUBLIC_MEDIA_LIMIT_MB=$NEXT_PUBLIC_MEDIA_LIMIT_MB', runnerIndex);
  assert.ok(runnerArg > runnerIndex, 'the runner must declare the same ARG');
  assert.ok(runnerEnv > runnerArg, 'the runner must carry the same value into the runtime environment');
});

test('build context is bounded by a .dockerignore that keeps state and secrets out', () => {
  const entries = new Set(
    readFileSync(resolve('.dockerignore'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')),
  );
  for (const excluded of [
    'node_modules',
    '.next',
    '.git',
    '.build-cache',
    '.env',
    '.env.*',
  ]) {
    assert.ok(entries.has(excluded), `.dockerignore must exclude ${excluded}`);
  }
});

test('Next.js standalone output is opt-in so the default start path is preserved', () => {
  const config = readFileSync(resolve('next.config.ts'), 'utf8');
  assert.match(config, /NEXT_OUTPUT/);
  assert.match(config, /standalone/);
});

test('package.json exposes the container startup contract', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts['start:container'], 'node scripts/container-start.mjs');
});

test('container startup resolves host and port', () => {
  const defaults = runStart(['--print-config']);
  assert.equal(defaults.status, 0, defaults.stderr);
  assert.deepEqual(JSON.parse(defaults.stdout), {
    runtime: 'node',
    hostname: '0.0.0.0',
    port: 3000,
  });

  const configured = runStart(['--print-config'], { HOSTNAME: '127.0.0.1', PORT: '8080' });
  assert.equal(configured.status, 0, configured.stderr);
  assert.deepEqual(JSON.parse(configured.stdout), {
    runtime: 'node',
    hostname: '127.0.0.1',
    port: 8080,
  });

  const blankPort = runStart(['--print-config'], { PORT: '   ' });
  assert.equal(blankPort.status, 0, blankPort.stderr);
  assert.equal(JSON.parse(blankPort.stdout).port, 3000);
});

test('container startup fails closed on invalid ports', () => {
  for (const invalid of ['0', '65536', '3000.5', 'not-a-port']) {
    const result = runStart(['--print-config'], { PORT: invalid });
    assert.notEqual(result.status, 0, `PORT=${invalid} should be rejected`);
    assert.match(result.stderr, /PORT/);
  }
});

test('container startup re-raises the child signal and terminates', { timeout: 15000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'container-start-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  copyFileSync(resolve('scripts/container-start.mjs'), join(root, 'scripts', 'container-start.mjs'));
  // The server terminates itself by signal so the wrapper must re-raise it.
  writeFileSync(join(root, 'server.js'), "process.kill(process.pid, 'SIGTERM');\n");
  const child = spawn(process.execPath, [join(root, 'scripts', 'container-start.mjs')], {
    stdio: 'ignore',
    env: baseEnv(),
  });
  try {
    const result = await new Promise<{ signal: string | null }>((done, fail) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        fail(new Error('container-start did not terminate after its child exited by signal'));
      }, 5000);
      child.once('exit', (_code, signal) => {
        clearTimeout(timer);
        done({ signal });
      });
    });
    assert.equal(result.signal, 'SIGTERM');
  } finally {
    child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
});

test('container startup reads root-only secret files into the child environment only', () => {
  const root = mkdtempSync(join(tmpdir(), 'container-secrets-'));
  try {
    writeFileSync(join(root, 'DATABASE_URL'), 'postgresql://user:pass@db:5432/openbulkads\n');
    writeFileSync(join(root, 'BETTER_AUTH_SECRET'), 'a'.repeat(48));
    const before = JSON.stringify(process.env);
    const secrets = loadSecretEnv({ secretDir: root });
    assert.deepEqual(secrets, {
      DATABASE_URL: 'postgresql://user:pass@db:5432/openbulkads',
      BETTER_AUTH_SECRET: 'a'.repeat(48),
    });
    // Values must never leak into the parent process environment.
    assert.equal(JSON.stringify(process.env), before);
    assert.notEqual(process.env.DATABASE_URL, 'postgresql://user:pass@db:5432/openbulkads');

    const childEnv = buildChildEnv({ PATH: process.env.PATH }, secrets, { PORT: '3000' });
    assert.equal(childEnv.DATABASE_URL, 'postgresql://user:pass@db:5432/openbulkads');
    assert.equal(childEnv.PORT, '3000');
    assert.equal(childEnv.PATH, process.env.PATH);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('container startup fails closed on empty or NUL secret files and skips a missing directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'container-secrets-'));
  try {
    assert.deepEqual(loadSecretEnv({ secretDir: join(root, 'does-not-exist') }), {});

    writeFileSync(join(root, 'DATABASE_URL'), '\n');
    assert.throws(() => loadSecretEnv({ secretDir: root }), /empty/i);

    writeFileSync(join(root, 'DATABASE_URL'), 'postgresql://user:pass@db/\u0000openbulkads');
    assert.throws(() => loadSecretEnv({ secretDir: root }), /NUL/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('container startup drops gid and uid to node only when running as root', () => {
  const calls: string[] = [];
  const asRoot = dropPrivileges({
    uid: 1000,
    gid: 1000,
    getuid: () => 0,
    setgroups: () => {
      calls.push('setgroups');
    },
    setgid: (id: string | number) => {
      calls.push(`setgid:${id}`);
    },
    setuid: (id: string | number) => {
      calls.push(`setuid:${id}`);
    },
  });
  assert.equal(asRoot, true);
  assert.deepEqual(calls, ['setgroups', 'setgid:1000', 'setuid:1000']);

  const nonRootCalls: string[] = [];
  const asNonRoot = dropPrivileges({
    getuid: () => 1000,
    setgroups: () => nonRootCalls.push('setgroups'),
    setgid: () => nonRootCalls.push('setgid'),
    setuid: () => nonRootCalls.push('setuid'),
  });
  assert.equal(asNonRoot, false);
  assert.deepEqual(nonRootCalls, []);
});

test('container startup reads secret files before dropping privileges and never logs their values', () => {
  const source = readFileSync(resolve('scripts/container-start.mjs'), 'utf8');
  const readIndex = source.indexOf('loadSecretEnv()');
  const dropIndex = source.indexOf('dropPrivileges()');
  assert.ok(readIndex >= 0 && dropIndex >= 0, 'startup must load secrets and drop privileges');
  assert.ok(readIndex < dropIndex, 'secret files must be read while still root, then privileges dropped');
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*secret/i, 'secret values must never be logged');
  for (const name of SECRET_FILE_ENV) {
    assert.match(source, new RegExp(name));
  }
});

function tempMigrations(folder: string, tag: string, when: number, sql: string) {
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: [{ idx: 0, version: '7', when, tag, breakpoints: true }] }),
  );
  writeFileSync(join(folder, `${tag}.sql`), sql);
}

test('production image ships migrations and a one-shot migration entrypoint without auto-migrating', () => {
  const contents = dockerfile();
  assert.match(contents, /COPY --from=builder --chown=node:node \/app\/drizzle \.\/drizzle/);
  assert.match(contents, /\/app\/scripts\/container-migrate\.mjs \.\/scripts\/container-migrate\.mjs/);
  const cmd = contents.split('\n').find(line => line.startsWith('CMD '));
  assert.equal(cmd, 'CMD ["node", "scripts/container-start.mjs"]');
  assert.doesNotMatch(contents, /--migrate-only/);
});

test('container migration separates its credentials and fails closed without MIGRATION_DATABASE_URL', () => {
  const migrate = readFileSync(resolve('scripts/container-migrate.mjs'), 'utf8');
  assert.match(migrate, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(migrate, /env\.DATABASE_URL/);
  const start = readFileSync(resolve('scripts/container-start.mjs'), 'utf8');
  assert.match(start, /--migrate-only/);
  assert.match(start, /container-migrate\.mjs/);

  const missing = spawnSync(process.execPath, ['scripts/container-migrate.mjs'], { encoding: 'utf8', env: baseEnv() });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /MIGRATION_DATABASE_URL/);

  for (const invalid of [
    'not-a-url',
    'postgresql://host:5432/db',
    'postgresql://user:pass@host:5432',
    'mysql://user:pass@host/db',
    'postgresql://user:pass@host/db?sslmode=require',
  ]) {
    const result = spawnSync(process.execPath, ['scripts/container-migrate.mjs'], {
      encoding: 'utf8',
      env: baseEnv({ MIGRATION_DATABASE_URL: invalid }),
    });
    assert.notEqual(result.status, 0, `${invalid} should be rejected`);
    assert.match(result.stderr, /MIGRATION_DATABASE_URL/);
  }
});

test('container --migrate-only stops before the server when the database is unreachable', () => {
  const startup = runStart(['--migrate-only'], { MIGRATION_DATABASE_URL: 'postgresql://user:pass@127.0.0.1:1/openbulkads' });
  assert.notEqual(startup.status, 0);
  assert.doesNotMatch(startup.stdout, /"runtime":"node"/);
  assert.doesNotMatch(startup.stdout, /listening/i);
});

test('container --migrate-only fails closed before starting without MIGRATION_DATABASE_URL', () => {
  const startup = runStart(['--migrate-only']);
  assert.notEqual(startup.status, 0);
  assert.match(startup.stderr, /MIGRATION_DATABASE_URL/);
  assert.doesNotMatch(startup.stdout, /"runtime"/);
});

test('container migration applies Drizzle SQL once and records it compatibly', async () => {
  const { applyMigrations } = await import('../scripts/container-migrate.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'oba-migrate-'));
  try {
    tempMigrations(folder, '0000_init', 111, 'CREATE TABLE a(id int);\n--> statement-breakpoint\nCREATE TABLE b(id int);\n');
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    let released = false;
    const client = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] as Array<{ created_at?: string }> };
      },
      release() {
        released = true;
      },
    };
    await applyMigrations({ pool: { connect: async () => client }, migrationsFolder: folder });
    const text = queries.map(q => q.text);
    assert.ok(text.some(t => /CREATE SCHEMA IF NOT EXISTS "drizzle"/.test(t)));
    assert.ok(text.some(t => /CREATE TABLE IF NOT EXISTS "drizzle"\."__drizzle_migrations"/.test(t)));
    assert.ok(text.some(t => /CREATE TABLE a\(id int\)/.test(t)));
    assert.ok(text.some(t => /CREATE TABLE b\(id int\)/.test(t)));
    assert.ok(text.some(t => /^BEGIN$/.test(t)));
    assert.ok(text.some(t => /^COMMIT$/.test(t)));
    assert.ok(text.some(t => /insert into "drizzle"\."__drizzle_migrations"/.test(t)));
    assert.equal(released, true);

    const second: string[] = [];
    const already = {
      async query(queryText: string) {
        second.push(queryText);
        return { rows: [{ created_at: '111' }] };
      },
      release() {},
    };
    await applyMigrations({ pool: { connect: async () => already }, migrationsFolder: folder });
    assert.ok(!second.some(t => /CREATE TABLE a/.test(t)));
    assert.ok(second.some(t => /^COMMIT$/.test(t)));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('container migration uses MIGRATION_DATABASE_URL and always closes the pool', async () => {
  const { runMigrations } = await import('../scripts/container-migrate.mjs');
  const folder = mkdtempSync(join(tmpdir(), 'oba-migrate-'));
  tempMigrations(folder, '0000_init', 1, 'SELECT 1;');
  let options: { connectionString?: string } | undefined;
  let ended = false;
  const queries: string[] = [];
  function FakePool(this: unknown, value: { connectionString?: string }) {
    options = value;
    return {
      connect: async () => ({
        async query(text: string) {
          queries.push(text);
          return { rows: [] };
        },
        release() {},
      }),
      end: async () => {
        ended = true;
      },
    };
  }
  try {
    await runMigrations({
      env: baseEnv({ MIGRATION_DATABASE_URL: 'postgresql://migration:migration@db:5432/openbulkads' }),
      migrationsFolder: folder,
      load: async () => ({ Pool: FakePool }),
    } as never);
    assert.equal(options?.connectionString, 'postgresql://migration:migration@db:5432/openbulkads');
    assert.equal(ended, true);
    assert.ok(queries.some(t => /SELECT 1/.test(t)));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
