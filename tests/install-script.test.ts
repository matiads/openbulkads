import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const SCRIPT = resolve('install.sh');
const COMPOSE = resolve('deploy/quickstart/compose.yaml');

// The script never runs against the real home directory: every run gets its own
// HOME and OPENBULKADS_DIR under a fresh temp directory, and skips Docker.
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'openbulkads-install-'));
  return { root, dir: join(root, 'app') };
}

function run(root: string, extra: Record<string, string> = {}, path = process.env.PATH ?? '') {
  return spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: asEnv({
      PATH: path,
      HOME: root,
      OPENBULKADS_SKIP_START: '1',
      OPENBULKADS_COMPOSE_FILE: COMPOSE,
      ...extra,
    }),
  });
}

function parseEnv(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const asEnv = (env: Record<string, string>) => env as NodeJS.ProcessEnv;

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('install.sh is valid POSIX sh, strict, and runs everything through main', () => {
  const contents = readFileSync(SCRIPT, 'utf8');
  assert.match(contents, /^#!\/bin\/sh\n/);
  assert.match(contents, /^set -eu$/m);
  assert.match(contents, /^main\(\) \{$/m);
  assert.match(contents, /^main "\$@"$/m, 'main must be the last statement so a truncated download does nothing');
  assert.equal(contents.trimEnd().split('\n').at(-1), 'main "$@"');
  const syntax = spawnSync('sh', ['-n', SCRIPT], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('a fresh install writes a private .env with strong generated secrets and the chosen settings', () => {
  const { root, dir } = scratch();
  const result = run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_PORT: '3500', OPENBULKADS_URL: 'https://ads.example.net/' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /==> Generando claves seguras en /);
  assert.match(result.stdout, /Listo: preparé .* sin iniciar nada/);
  assert.equal(result.stderr, '');

  const envFile = join(dir, '.env');
  assert.equal(statSync(envFile).mode & 0o777, 0o600, '.env must be private');
  assert.equal(readFileSync(join(dir, 'compose.yaml'), 'utf8'), readFileSync(COMPOSE, 'utf8'));

  const env = parseEnv(envFile);
  assert.match(env.POSTGRES_PASSWORD, /^[0-9a-f]{48}$/);
  assert.match(env.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').length, 32);
  assert.equal(Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').toString('base64'), env.TOKEN_ENCRYPTION_KEY, 'canonical base64');
  assert.equal(env.BETTER_AUTH_URL, 'https://ads.example.net');
  assert.equal(env.OPENBULKADS_PORT, '3500');
  assert.equal(env.OPENBULKADS_BIND, '127.0.0.1');
  assert.equal(env.OPENBULKADS_IMAGE, 'ghcr.io/matiads/openbulkads:latest');

  for (const secret of [env.POSTGRES_PASSWORD, env.BETTER_AUTH_SECRET, env.TOKEN_ENCRYPTION_KEY]) {
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), 'secrets must never be printed');
  }
});

test('defaults: URL follows the port, image follows OPENBULKADS_VERSION, OPENBULKADS_IMAGE wins', () => {
  const first = scratch();
  assert.equal(run(first.root, { OPENBULKADS_DIR: first.dir, OPENBULKADS_PORT: '3600', OPENBULKADS_VERSION: '1.2.3' }).status, 0);
  const env = parseEnv(join(first.dir, '.env'));
  assert.equal(env.BETTER_AUTH_URL, 'http://localhost:3600');
  assert.equal(env.OPENBULKADS_IMAGE, 'ghcr.io/matiads/openbulkads:1.2.3');

  const second = scratch();
  assert.equal(run(second.root, { OPENBULKADS_DIR: second.dir, OPENBULKADS_VERSION: '1.2.3', OPENBULKADS_IMAGE: 'openbulkads:local' }).status, 0);
  assert.equal(parseEnv(join(second.dir, '.env')).OPENBULKADS_IMAGE, 'openbulkads:local');
});

test('the default install directory is ~/openbulkads under HOME', () => {
  const { root } = scratch();
  const result = run(root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(existsSync(join(root, 'openbulkads', '.env')));
  assert.ok(existsSync(join(root, 'openbulkads', 'compose.yaml')));
});

test('re-running without options keeps the existing .env byte for byte and does not rotate secrets', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  const before = sha(join(dir, '.env'));
  const again = run(root, { OPENBULKADS_DIR: dir });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Ya existe .*\.env: lo conservo \(tus claves no cambian\)\./);
  assert.doesNotMatch(again.stdout, /Generando claves|Actualicé/);
  assert.equal(sha(join(dir, '.env')), before);
});

const SECRETS = ['POSTGRES_PASSWORD', 'BETTER_AUTH_SECRET', 'TOKEN_ENCRYPTION_KEY'];

test('re-running with OPENBULKADS_PORT applies it, follows the default URL and keeps secrets', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  const before = parseEnv(join(dir, '.env'));
  const again = run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_PORT: '3999' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Actualicé OPENBULKADS_PORT en .*\.env: 3000 → 3999/);
  assert.match(again.stdout, /Actualicé BETTER_AUTH_URL en .*\.env: http:\/\/localhost:3000 → http:\/\/localhost:3999/);
  const after = parseEnv(join(dir, '.env'));
  assert.equal(after.OPENBULKADS_PORT, '3999');
  assert.equal(after.BETTER_AUTH_URL, 'http://localhost:3999');
  for (const key of SECRETS) assert.equal(after[key], before[key], `${key} must not change`);
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
});

test('a port change keeps a custom BETTER_AUTH_URL', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_URL: 'https://ads.example.net' }).status, 0);
  const again = run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_PORT: '3999' });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(parseEnv(join(dir, '.env')).BETTER_AUTH_URL, 'https://ads.example.net');
  assert.doesNotMatch(again.stdout, /Actualicé BETTER_AUTH_URL/);
});

test('re-running with OPENBULKADS_BIND applies it and keeps secrets', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  const before = parseEnv(join(dir, '.env'));
  const again = run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_BIND: '100.64.0.7' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Actualicé OPENBULKADS_BIND en .*\.env: 127\.0\.0\.1 → 100\.64\.0\.7/);
  const after = parseEnv(join(dir, '.env'));
  assert.equal(after.OPENBULKADS_BIND, '100.64.0.7');
  for (const key of SECRETS) assert.equal(after[key], before[key]);
});

test('re-running with OPENBULKADS_URL applies it and keeps secrets', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  const before = parseEnv(join(dir, '.env'));
  const again = run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_URL: 'http://mi-server.ts.net:3000/' });
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Actualicé BETTER_AUTH_URL en .*\.env: http:\/\/localhost:3000 → http:\/\/mi-server\.ts\.net:3000/);
  const after = parseEnv(join(dir, '.env'));
  assert.equal(after.BETTER_AUTH_URL, 'http://mi-server.ts.net:3000');
  for (const key of SECRETS) assert.equal(after[key], before[key]);
});

test('re-running restores .env mode 600', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  chmodSync(join(dir, '.env'), 0o644);
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
});

test('re-running with a new version only updates the image line', () => {
  const { root, dir } = scratch();
  assert.equal(run(root, { OPENBULKADS_DIR: dir }).status, 0);
  const before = parseEnv(join(dir, '.env'));
  assert.equal(run(root, { OPENBULKADS_DIR: dir, OPENBULKADS_VERSION: '2.0.0' }).status, 0);
  const after = parseEnv(join(dir, '.env'));
  assert.equal(after.OPENBULKADS_IMAGE, 'ghcr.io/matiads/openbulkads:2.0.0');
  assert.deepEqual({ ...after, OPENBULKADS_IMAGE: '' }, { ...before, OPENBULKADS_IMAGE: '' });
  assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600, '.env stays private after an update');
});

test('without openssl the secrets still come from /dev/urandom with the same shape', () => {
  const { root, dir } = scratch();
  // A PATH holding only the tools the script needs, deliberately without openssl.
  const bin = join(root, 'bin');
  mkdirSync(bin);
  for (const tool of ['sh', 'head', 'od', 'tr', 'base64', 'sed', 'grep', 'mv', 'cp', 'cat', 'mkdir', 'chmod', 'dirname', 'basename', 'pwd']) {
    const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (found) symlinkSync(found, join(bin, tool));
  }
  const result = run(root, { OPENBULKADS_DIR: dir }, bin);
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(join(dir, '.env'));
  assert.match(env.POSTGRES_PASSWORD, /^[0-9a-f]{48}$/);
  assert.match(env.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.from(env.TOKEN_ENCRYPTION_KEY, 'base64').length, 32);
  assert.equal(env.TOKEN_ENCRYPTION_KEY.length, 44);
});

test('two installs never share secrets', () => {
  const a = scratch();
  const b = scratch();
  run(a.root, { OPENBULKADS_DIR: a.dir });
  run(b.root, { OPENBULKADS_DIR: b.dir });
  const envA = parseEnv(join(a.dir, '.env'));
  const envB = parseEnv(join(b.dir, '.env'));
  assert.notEqual(envA.POSTGRES_PASSWORD, envB.POSTGRES_PASSWORD);
  assert.notEqual(envA.BETTER_AUTH_SECRET, envB.BETTER_AUTH_SECRET);
  assert.notEqual(envA.TOKEN_ENCRYPTION_KEY, envB.TOKEN_ENCRYPTION_KEY);
});

test('invalid options fail with a clear Spanish error and create nothing', () => {
  const cases: Array<[Record<string, string>, RegExp]> = [
    [{ OPENBULKADS_PORT: 'abc' }, /^Error: OPENBULKADS_PORT tiene que ser un número entre 1 y 65535 \(recibí 'abc'\)\.$/m],
    [{ OPENBULKADS_PORT: '70000' }, /^Error: OPENBULKADS_PORT tiene que ser un número entre 1 y 65535 \(recibí '70000'\)\.$/m],
    [{ OPENBULKADS_BIND: '1.2.3.4;ls' }, /^Error: OPENBULKADS_BIND no es una dirección válida/m],
    [{ OPENBULKADS_URL: 'ads.example.net' }, /^Error: OPENBULKADS_URL tiene que empezar con http:\/\/ o https:\/\//m],
    [{ OPENBULKADS_URL: 'http://' }, /^Error: OPENBULKADS_URL tiene que empezar con http:\/\/ o https:\/\/ y tener un nombre \(recibí 'http:\/\/'\)\./m],
    [{ OPENBULKADS_COMPOSE_FILE: '/nonexistent/compose.yaml' }, /^Error: No existe OPENBULKADS_COMPOSE_FILE/m],
  ];
  for (const [extra, message] of cases) {
    const { root, dir } = scratch();
    const result = run(root, { OPENBULKADS_DIR: dir, ...extra });
    assert.equal(result.status, 1, JSON.stringify(extra));
    assert.match(result.stderr, message);
    assert.equal(existsSync(join(dir, '.env')), false, 'no .env on invalid input');
  }
});

test('a missing Docker is reported in Spanish with the install link', () => {
  const { root, dir } = scratch();
  const bin = join(root, 'empty-bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'placeholder'), '');
  const result = spawnSync('/bin/sh', [SCRIPT], {
    encoding: 'utf8',
    env: asEnv({ PATH: bin, HOME: root, OPENBULKADS_DIR: dir, OPENBULKADS_COMPOSE_FILE: COMPOSE }),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Error: No encontré Docker\. Instalalo desde https:\/\/docs\.docker\.com\/get-docker\/ y volvé a correr este comando\.$/m);
  assert.equal(existsSync(join(dir, '.env')), false, 'nothing is generated before Docker is verified');
});

test('a Docker without Compose v2 and a Docker without permission get specific messages', () => {
  const stub = (script: string) => {
    const { root, dir } = scratch();
    const bin = join(root, 'stub-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'docker'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    const result = spawnSync('/bin/sh', [SCRIPT], {
      encoding: 'utf8',
      env: asEnv({ PATH: bin, HOME: root, OPENBULKADS_DIR: dir, OPENBULKADS_COMPOSE_FILE: COMPOSE }),
    });
    return result;
  };
  const noCompose = stub('exit 1');
  assert.equal(noCompose.status, 1);
  assert.match(noCompose.stderr, /^Error: Falta Docker Compose v2 \(el comando 'docker compose'\)\./m);

  const noPermission = stub('[ "$1" = compose ] && exit 0; exit 1');
  assert.equal(noPermission.status, 1);
  assert.match(noPermission.stderr, /^Error: No puedo hablar con Docker\..*usermod -aG docker.*newgrp docker.*sin sudo/m);
  assert.doesNotMatch(noPermission.stderr, /probá con 'sudo'/);
});

test('docker pull and up failures print a Spanish hint and exit non-zero', () => {
  const stub = (failing: string) => {
    const { root, dir } = scratch();
    const bin = join(root, 'stub-bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'docker'),
      `#!/bin/sh\n[ "$1" = compose ] && [ "$2" = "${failing}" ] && exit 1\nexit 0\n`,
      { mode: 0o755 },
    );
    return spawnSync('/bin/sh', [SCRIPT], {
      encoding: 'utf8',
      env: asEnv({ PATH: bin + ':/usr/bin:/bin', HOME: root, OPENBULKADS_DIR: dir, OPENBULKADS_COMPOSE_FILE: COMPOSE }),
    });
  };
  const pull = stub('pull');
  assert.equal(pull.status, 1);
  assert.match(pull.stderr, /^Error: No pude descargar la imagen\..*todavía no esté publicada.*conexión/m);
  const up = stub('up');
  assert.equal(up.status, 1);
  assert.match(up.stderr, /^Error: No pude iniciar OpenBulkAds\..*puerto.*OPENBULKADS_PORT=/m);
});
