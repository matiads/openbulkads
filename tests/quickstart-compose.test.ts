import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const QUICKSTART = resolve('deploy/quickstart/compose.yaml');

type Service = {
  command?: string[] | string | null;
  depends_on?: Record<string, { condition?: string }>;
  environment?: Record<string, string | null> | null;
  healthcheck?: { test?: string[] | string | null } | null;
  image?: string;
  ports?: Array<{ target?: number; published?: string; host_ip?: string }> | null;
  restart?: string;
  user?: string;
  volumes?: Array<{ type?: string; source?: string; target?: string }> | null;
};
type Config = { name?: string; services: Record<string, Service>; volumes?: Record<string, unknown> };

const ENV = {
  POSTGRES_PASSWORD: 'pw_for_tests_only',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  TOKEN_ENCRYPTION_KEY: 'k'.repeat(43) + '=',
  BETTER_AUTH_URL: 'http://localhost:3000',
};

function composeAvailable(): boolean {
  return spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
}

function composeConfig(env: Record<string, string>) {
  const base: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['OPENBULKADS_IMAGE', 'OPENBULKADS_BIND', 'OPENBULKADS_PORT', ...Object.keys(ENV)]) delete base[key];
  return spawnSync('docker', ['compose', '-f', QUICKSTART, '--project-directory', resolve('deploy/quickstart'), 'config', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...base, ...env },
    maxBuffer: 32 * 1024 * 1024,
  });
}

function requireConfig(t: { skip: (message?: string) => void }, env: Record<string, string> = ENV): Config | undefined {
  if (!composeAvailable()) {
    t.skip('docker compose is not available on this host; compose contract not executable');
    return undefined;
  }
  const result = composeConfig(env);
  assert.equal(result.status, 0, `docker compose config must succeed:\n${result.stderr}`);
  return JSON.parse(result.stdout) as Config;
}

const text = (value: unknown) => (Array.isArray(value) ? value.join(' ') : `${value ?? ''}`);

test('quickstart compose defines postgres, media-init, migrate and app with named volumes', (t) => {
  const config = requireConfig(t);
  if (!config) return;
  assert.deepEqual(Object.keys(config.services).sort(), ['app', 'media-init', 'migrate', 'postgres']);
  assert.deepEqual(Object.keys(config.volumes ?? {}).sort(), ['media', 'postgres_data']);
  assert.equal(config.name, 'openbulkads-quickstart', 'must not share a project name with the dev stack');
  assert.match(config.services.postgres.image ?? '', /^postgres:16$/);
  const pgVolume = config.services.postgres.volumes?.find(v => v.target === '/var/lib/postgresql/data');
  assert.equal(pgVolume?.type, 'volume');
  assert.match(text(config.services.postgres.healthcheck?.test), /pg_isready/);
  // The image's temporary initdb server listens on the unix socket only; probing over
  // TCP keeps postgres unhealthy until the real server accepts migrate's connections.
  assert.match(text(config.services.postgres.healthcheck?.test), /pg_isready -h 127\.0\.0\.1 /);
});

test('the app image defaults to the GHCR latest tag and follows OPENBULKADS_IMAGE', (t) => {
  const config = requireConfig(t);
  if (!config) return;
  for (const name of ['app', 'migrate', 'media-init']) {
    assert.equal(config.services[name].image, 'ghcr.io/matiads/openbulkads:latest');
  }
  const custom = requireConfig(t, { ...ENV, OPENBULKADS_IMAGE: 'openbulkads:local' });
  if (!custom) return;
  for (const name of ['app', 'migrate', 'media-init']) {
    assert.equal(custom.services[name].image, 'openbulkads:local');
  }
});

test('the app publishes only on 127.0.0.1:3000 by default and honors bind and port overrides', (t) => {
  const config = requireConfig(t);
  if (!config) return;
  const ports = config.services.app.ports ?? [];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].target, 3000);
  assert.equal(ports[0].published, '3000');
  assert.equal(ports[0].host_ip, '127.0.0.1');
  for (const name of ['postgres', 'migrate', 'media-init']) {
    assert.equal(config.services[name].ports ?? null, null, `${name} must not publish a port`);
  }
  const custom = requireConfig(t, { ...ENV, OPENBULKADS_BIND: '100.64.0.7', OPENBULKADS_PORT: '3500' });
  if (!custom) return;
  assert.equal(custom.services.app.ports?.[0].host_ip, '100.64.0.7');
  assert.equal(custom.services.app.ports?.[0].published, '3500');
  assert.equal(custom.services.app.ports?.[0].target, 3000);
});

test('migrations and media ownership complete, and the database is healthy, before the app starts', (t) => {
  const config = requireConfig(t);
  if (!config) return;
  const depends = config.services.app.depends_on ?? {};
  assert.equal(depends.migrate?.condition, 'service_completed_successfully');
  assert.equal(depends['media-init']?.condition, 'service_completed_successfully');
  assert.equal(depends.postgres?.condition, 'service_healthy');
  assert.equal(config.services.migrate.depends_on?.postgres?.condition, 'service_healthy');
  assert.match(text(config.services.migrate.command), /--migrate-only/);
  assert.equal(config.services.migrate.restart, 'no');
  assert.equal(config.services['media-init'].restart, 'no');
  assert.equal(config.services['media-init'].user, '0:0');
  assert.match(text(config.services['media-init'].command), /chown 1000:1000 \/var\/lib\/openbulkads\/media/);
});

test('media lives on a named volume at MEDIA_ROOT and the app restarts and reports health on /api/ready', (t) => {
  const config = requireConfig(t);
  if (!config) return;
  const app = config.services.app;
  assert.equal(app.environment?.MEDIA_ROOT, '/var/lib/openbulkads/media');
  assert.equal(app.environment?.BETTER_AUTH_URL, ENV.BETTER_AUTH_URL);
  const media = app.volumes?.find(v => v.target === '/var/lib/openbulkads/media');
  assert.equal(media?.type, 'volume');
  assert.equal(media?.source, 'media');
  const init = config.services['media-init'].volumes?.find(v => v.target === '/var/lib/openbulkads/media');
  assert.equal(init?.source, 'media');
  assert.equal(app.restart, 'unless-stopped');
  assert.equal(config.services.postgres.restart, 'unless-stopped');
  assert.match(text(app.healthcheck?.test), /\/api\/ready/);
  assert.equal(app.user ?? null, null, 'the app runs as the image default non-root user');
});

test('the compose file fails closed when a required .env value is missing', (t) => {
  if (!composeAvailable()) return t.skip('docker compose is not available on this host');
  for (const key of Object.keys(ENV)) {
    const env = { ...ENV } as Record<string, string>;
    delete env[key];
    const result = composeConfig(env);
    assert.notEqual(result.status, 0, `config must fail without ${key}`);
    assert.match(result.stderr, new RegExp(`${key} must be set in \\.env`));
  }
});

test('the compose file contains no secret values and no fixed database password', () => {
  const contents = readFileSync(QUICKSTART, 'utf8');
  assert.doesNotMatch(contents, /^\s*POSTGRES_PASSWORD:[ \t]*[^$\s]/m, 'the database password must come from .env');
  assert.doesNotMatch(contents, /^\s*(BETTER_AUTH_SECRET|TOKEN_ENCRYPTION_KEY):[ \t]*[^$\s]/m);
  assert.doesNotMatch(contents, /postgresql:\/\/[^:\s]+:(?!\$\{)[^@\s]+@/, 'no inline database credentials');
  assert.doesNotMatch(contents, /local_dev_only|changeme|password123/i);
  assert.match(contents, /\$\{POSTGRES_PASSWORD:\?/);
});
