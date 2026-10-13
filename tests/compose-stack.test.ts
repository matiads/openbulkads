import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROD = resolve('compose.prod.yaml');
const DEV = resolve('compose.dev.yaml');
const LOCAL = resolve('compose.local.yaml');
const CADDYFILE = resolve('deploy/Caddyfile');

type ComposeService = {
  build?: { context?: string; dockerfile?: string; args?: Record<string, string> };
  command?: string[] | string | null;
  depends_on?: Record<string, { condition?: string } | string>;
  environment?: Record<string, string | null> | null;
  healthcheck?: { test?: string[] | string | null } | null;
  image?: string;
  networks?: Record<string, unknown> | null;
  ports?: Array<{ target?: number; published?: string; host_ip?: string; mode?: string }> | null;
  restart?: string;
  secrets?: Array<{ source?: string; target?: string } | string> | null;
  user?: string;
  volumes?: Array<Record<string, unknown>> | null;
};

type ComposeConfig = {
  services: Record<string, ComposeService>;
  secrets?: Record<string, { file?: string; environment?: string }>;
  volumes?: Record<string, unknown>;
};

const SECRET_KEYS = [
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'TOKEN_ENCRYPTION_KEY',
];

function composeAvailable(): boolean {
  const result = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  return result.status === 0;
}

function composeConfig(files: string[], env: Record<string, string>): { config?: ComposeConfig; error?: string } {
  const args = files.flatMap(file => ['-f', file]);
  const result = spawnSync('docker', ['compose', ...args, 'config', '--format', 'json'], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { error: result.stderr || result.stdout || `docker compose config exited ${result.status}` };
  }
  try {
    return { config: JSON.parse(result.stdout) as ComposeConfig };
  } catch (error) {
    return { error: `invalid compose JSON: ${error instanceof Error ? error.message : error}` };
  }
}

const BASE_ENV = {
  VPN_BIND_ADDRESS: '10.8.0.5',
  MEDIA_HOST_DIR: '/var/lib/openbulkads/media',
  APP_DOMAIN: 'openbulkads.internal',
  OPENBULKADS_SECRETS_DIR: '/etc/openbulkads/secrets',
};

function requireConfig(t: { skip: (message?: string) => void }, files: string[], env: Record<string, string>) {
  if (!composeAvailable()) {
    t.skip('docker compose is not available on this host; compose contract not executable');
    return undefined;
  }
  const { config, error } = composeConfig(files, env);
  assert.ok(config, `docker compose config must succeed:\n${error}`);
  return config!;
}

test('production compose defines the migrate, app and caddy services without a database service', (t) => {
  const config = requireConfig(t, [PROD], BASE_ENV);
  if (!config) return;
  assert.deepEqual(Object.keys(config.services).sort(), ['app', 'caddy', 'migrate']);
  assert.equal(config.services.postgres, undefined, 'production must not run PostgreSQL locally');
});

test('only Caddy publishes, and only HTTPS on the configured VPN address', (t) => {
  const config = requireConfig(t, [PROD], BASE_ENV);
  if (!config) return;
  assert.equal(config.services.app.ports ?? null, null, 'the app must never publish a port');
  assert.equal(config.services.migrate.ports ?? null, null, 'the migration job must never publish a port');

  const caddyPorts = config.services.caddy.ports ?? [];
  assert.equal(caddyPorts.length, 1, 'Caddy should publish a single mapping');
  assert.equal(caddyPorts[0].target, 443);
  assert.equal(caddyPorts[0].published, '443');
  assert.equal(caddyPorts[0].host_ip, '10.8.0.5', 'Caddy must bind the configured VPN address only');

  const exposed = JSON.stringify(config.services).match(/"5432"/g) ?? [];
  assert.equal(exposed.length, 0, 'PostgreSQL must never be published by this stack');
});

test('migrations complete before the app starts and Caddy waits for a healthy app', (t) => {
  const config = requireConfig(t, [PROD], BASE_ENV);
  if (!config) return;

  const migrateCommand = config.services.migrate.command;
  const migrateText = Array.isArray(migrateCommand) ? migrateCommand.join(' ') : `${migrateCommand ?? ''}`;
  assert.match(migrateText, /--migrate-only/, 'the one-shot migrate service must run the migration mode');
  assert.equal(config.services.migrate.restart, 'no');

  const appDepends = (config.services.app.depends_on ?? {}) as Record<string, { condition?: string }>;
  assert.equal(appDepends.migrate?.condition, 'service_completed_successfully');
  const appHealthcheck = config.services.app.healthcheck?.test;
  const healthText = Array.isArray(appHealthcheck) ? appHealthcheck.join(' ') : `${appHealthcheck ?? ''}`;
  assert.match(healthText, /\/api\/ready/);

  const caddyDepends = (config.services.caddy.depends_on ?? {}) as Record<string, { condition?: string }>;
  assert.equal(caddyDepends.app?.condition, 'service_healthy');
});

test('production secrets are root-only host files and never appear in the environment', (t) => {
  const config = requireConfig(t, [PROD], BASE_ENV);
  if (!config) return;

  const appSecrets = (config.services.app.secrets ?? []).map(secret =>
    typeof secret === 'string' ? secret : secret.source ?? secret.target,
  );
  assert.deepEqual(appSecrets.sort(), ['BETTER_AUTH_SECRET', 'DATABASE_URL', 'TOKEN_ENCRYPTION_KEY']);
  const migrateSecrets = (config.services.migrate.secrets ?? []).map(secret =>
    typeof secret === 'string' ? secret : secret.source ?? secret.target,
  );
  assert.deepEqual(migrateSecrets, ['MIGRATION_DATABASE_URL']);

  for (const service of ['app', 'migrate']) {
    const environment: Record<string, string | null> = config.services[service].environment ?? {};
    for (const key of SECRET_KEYS) {
      assert.equal(environment[key] ?? null, null, `${service} must not receive ${key} through the environment`);
    }
  }

  const prodSource = readFileSync(PROD, 'utf8');
  assert.doesNotMatch(prodSource, /postgresql:\/\//, 'production compose must not embed database URLs');
  assert.match(prodSource, /^\s+user:\s*["']?0:0["']?$/m, 'the app entrypoint needs root to read root-only secret files');
});

test('media is a configurable host bind mount and Caddy persists its internal CA state', (t) => {
  const config = requireConfig(t, [PROD], BASE_ENV);
  if (!config) return;

  const appVolumes = config.services.app.volumes ?? [];
  const mediaMount = appVolumes.find(volume => volume.target === '/var/lib/openbulkads/media');
  assert.ok(mediaMount, 'the app must mount private media');
  assert.equal(mediaMount.type, 'bind');
  assert.equal(mediaMount.source, '/var/lib/openbulkads/media');

  const caddyMounts = (config.services.caddy.volumes ?? []).map(volume => volume.target);
  for (const target of ['/data', '/config']) {
    assert.ok(caddyMounts.includes(target), `Caddy must persist ${target} for its internal CA`);
  }
  assert.ok(config.services.caddy.volumes != null);

  const missingMedia = composeConfig([PROD], { ...BASE_ENV, MEDIA_HOST_DIR: '' });
  assert.ok(missingMedia.error, 'an unset MEDIA_HOST_DIR must fail the production config closed');
  const missingVpn = composeConfig([PROD], { ...BASE_ENV, VPN_BIND_ADDRESS: '' });
  assert.ok(missingVpn.error, 'an unset VPN_BIND_ADDRESS must fail the production config closed');
});

test('production app and Caddy use the configurable internal domain', (t) => {
  const config = requireConfig(t, [PROD], { ...BASE_ENV, APP_DOMAIN: 'ads.example.internal' });
  if (!config) return;
  assert.equal(config.services.app.environment?.BETTER_AUTH_URL, 'https://ads.example.internal');
  assert.equal(config.services.caddy.environment?.APP_DOMAIN, 'ads.example.internal');

  const prodSource = readFileSync(PROD, 'utf8');
  assert.match(prodSource, /openbulkads\.internal/, 'the documented default domain must be present');
});

test('production compose wires one media-limit build arg and runtime env value', (t) => {
  const defaulted = requireConfig(t, [PROD], { ...BASE_ENV, NEXT_PUBLIC_MEDIA_LIMIT_MB: '' });
  if (!defaulted) return;
  for (const service of ['app', 'migrate'] as const) {
    assert.equal(
      defaulted.services[service].build?.args?.NEXT_PUBLIC_MEDIA_LIMIT_MB,
      '250',
      `${service} must build with the default 250 MB media limit`,
    );
  }
  assert.equal(
    defaulted.services.app.environment?.NEXT_PUBLIC_MEDIA_LIMIT_MB,
    '250',
    'the app runtime must receive the same default 250 MB value',
  );

  const custom = requireConfig(t, [PROD], { ...BASE_ENV, NEXT_PUBLIC_MEDIA_LIMIT_MB: '300' });
  if (!custom) return;
  for (const service of ['app', 'migrate'] as const) {
    assert.equal(
      custom.services[service].build?.args?.NEXT_PUBLIC_MEDIA_LIMIT_MB,
      '300',
      `${service} must forward a custom media limit to the image build`,
    );
  }
  assert.equal(
    custom.services.app.environment?.NEXT_PUBLIC_MEDIA_LIMIT_MB,
    '300',
    'the app runtime must stay aligned with the built-in media limit',
  );
});

test('the Caddyfile terminates internal HTTPS and proxies to the app upstream', () => {
  const caddyfile = readFileSync(CADDYFILE, 'utf8');
  assert.match(caddyfile, /\{\$APP_DOMAIN:openbulkads\.internal\}/, 'the site address must default to the internal domain');
  assert.match(caddyfile, /tls\s+internal/, 'Caddy must issue certificates from its internal CA');
  assert.match(caddyfile, /reverse_proxy\s+\{\$APP_UPSTREAM:app:3000\}/, 'Caddy must proxy to the app service');
  assert.match(caddyfile, /^\s*bind\s+\{\$CADDY_BIND:0\.0\.0\.0\}/m, 'Caddy must support a configurable bind address');
});

test('the Caddyfile passes `caddy validate` when the Caddy binary is available', (t) => {
  const available = spawnSync('caddy', ['version'], { encoding: 'utf8' });
  if (available.status !== 0) {
    t.skip('caddy is not installed on this host; Caddy config not executed');
    return;
  }
  const validate = spawnSync(
    'caddy',
    ['validate', '--config', CADDYFILE, '--adapter', 'caddyfile'],
    { encoding: 'utf8', env: { ...process.env, APP_DOMAIN: 'openbulkads.internal', CADDY_BIND: '127.0.0.1' } },
  );
  assert.equal(validate.status, 0, `caddy validate failed:\n${validate.stdout}\n${validate.stderr}`);
});

test('the local override merges dev PostgreSQL into the same project/network and binds Caddy to loopback', (t) => {
  if (!composeAvailable()) {
    t.skip('docker compose is not available on this host; local override not executable');
    return;
  }
  // The reliable local invocation is explicit and multi-file: compose.dev.yaml
  // contributes PostgreSQL to the same Compose project/network, so app and
  // migrate reach it as `postgres:5432` without any host gateway. The local
  // file is never auto-loaded (Compose only auto-loads compose.override.yaml).
  const { config, error } = composeConfig([PROD, DEV, LOCAL], BASE_ENV);
  assert.ok(config, `merged local override must be valid:\n${error}`);

  const postgres = config!.services.postgres;
  assert.ok(postgres, 'the explicit local invocation must merge the compose.dev.yaml PostgreSQL service');
  assert.ok(
    Object.keys(postgres!.networks ?? {}).includes('default'),
    'dev PostgreSQL must join the stack default network',
  );

  const caddyPorts = config!.services.caddy.ports ?? [];
  assert.equal(caddyPorts.length, 1);
  assert.equal(caddyPorts[0].host_ip, '127.0.0.1', 'local Caddy must bind loopback only');

  for (const service of ['app', 'migrate'] as const) {
    assert.equal(config!.services[service].secrets ?? null, null, `${service} must not mount host secret files locally`);
    assert.ok(
      Object.keys(config!.services[service].networks ?? {}).includes('default'),
      `${service} must share the stack default network with PostgreSQL`,
    );
    assert.equal(
      (config!.services[service] as { extra_hosts?: string[] }).extra_hosts ?? null,
      null,
      `${service} must not rely on the obsolete Docker host gateway`,
    );
    const key = service === 'app' ? 'DATABASE_URL' : 'MIGRATION_DATABASE_URL';
    const url = `${config!.services[service].environment?.[key]}`;
    assert.match(url, /@postgres:5432\//, `${service} must reach PostgreSQL by its internal service name`);
    assert.doesNotMatch(url, /host\.docker\.internal/, `${service} must not use the host gateway`);
  }

  assert.match(`${config!.services.app.environment?.BETTER_AUTH_SECRET}`, /.{32,}/);

  // The override must add development values only; production secret mounts must stay gone.
  const localSource = readFileSync(LOCAL, 'utf8');
  assert.match(localSource, /!reset \[\]/);
  assert.doesNotMatch(localSource, /\{\$OPENBULKADS_SECRETS_DIR/);
  assert.doesNotMatch(
    localSource,
    /host\.docker\.internal|host-gateway/,
    'the obsolete host-gateway approach must be removed',
  );
});

test('the merged local override makes PostgreSQL internal-only while Caddy stays on loopback', (t) => {
  if (!composeAvailable()) {
    t.skip('docker compose is not available on this host; local override not executable');
    return;
  }
  // Regression: compose.dev.yaml publishes 127.0.0.1:5432. The documented
  // three-file smoke invocation merges that service, so it must explicitly
  // drop the host port to coexist with an already-running development
  // PostgreSQL. app/migrate keep reaching PostgreSQL internally as
  // `postgres:5432`.
  const { config, error } = composeConfig([PROD, DEV, LOCAL], BASE_ENV);
  assert.ok(config, `merged local override must be valid:\n${error}`);

  const postgresPorts = config!.services.postgres.ports ?? [];
  assert.deepEqual(
    postgresPorts,
    [],
    `the smoke PostgreSQL must not publish any host port; got ${JSON.stringify(postgresPorts)}`,
  );

  const published = JSON.stringify(config!.services).match(/"published":"5432"/g) ?? [];
  assert.equal(published.length, 0, 'PostgreSQL must never be published by the local smoke stack');

  const caddyPorts = config!.services.caddy.ports ?? [];
  assert.equal(caddyPorts.length, 1, 'Caddy should still publish exactly one mapping');
  assert.equal(caddyPorts[0].target, 443);
  assert.equal(caddyPorts[0].published, '443');
  assert.equal(caddyPorts[0].host_ip, '127.0.0.1', 'local Caddy must remain loopback-only');

  for (const service of ['app', 'migrate'] as const) {
    const key = service === 'app' ? 'DATABASE_URL' : 'MIGRATION_DATABASE_URL';
    assert.match(
      `${config!.services[service].environment?.[key]}`,
      /@postgres:5432\//,
      `${service} must still reach PostgreSQL by its internal service name`,
    );
  }
});

test('the Docker build context excludes host secret directories', () => {
  const entries = new Set(
    readFileSync(resolve('.dockerignore'), 'utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')),
  );
  assert.ok(
    entries.has('deploy/secrets') || entries.has('deploy/secrets/'),
    '.dockerignore must exclude deploy/secrets so root-only host secret files cannot enter the build context',
  );
});

test('no tracked compose or deploy file contains a real-looking secret', () => {
  for (const file of [PROD, LOCAL, CADDYFILE, resolve('deploy/README.md'), resolve('deploy/secrets/.gitignore')]) {
    assert.ok(existsSync(file), `${file} must exist`);
  }
  const local = readFileSync(LOCAL, 'utf8');
  assert.match(local, /@postgres:5432\//, 'local override must use the merged dev PostgreSQL service');
  // Only the shared development password from compose.dev.yaml may appear; no
  // production-shaped credential belongs in a tracked file.
  for (const match of local.matchAll(/postgresql:\/\/\S+/g)) {
    assert.match(match[0], /local_dev_only/, `unexpected credential in compose.local.yaml: ${match[0]}`);
  }

  const ignore = readFileSync(resolve('deploy/secrets/.gitignore'), 'utf8');
  assert.match(ignore, /^\*/m);
  assert.match(ignore, /!\.gitignore/);
});
