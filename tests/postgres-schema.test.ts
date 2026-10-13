import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// Dynamic paths keep the Node strip-types runner and the project tsconfig compatible.
const configPath = '../db/postgres/config.ts';
const schemaPath = '../db/postgres/schema.ts';
const { getDatabaseUrl } = await import(configPath) as typeof import('../db/postgres/config');
const { connections, jobs, presets, settings, user, session, account, verification } = await import(schemaPath) as typeof import('../db/postgres/schema');
import { getTableName } from 'drizzle-orm';

test('DATABASE_URL fails closed for missing, malformed, and non-Postgres values', () => {
  for (const value of [undefined, '', 'sqlite://local', 'postgres://localhost/db', 'postgresql://localhost/db', 'postgresql://user:pass@localhost/db?sslmode=disable']) {
    assert.throws(() => getDatabaseUrl(value));
  }
  assert.equal(getDatabaseUrl('postgresql://user:pass@localhost:5432/db'), 'postgresql://user:pass@localhost:5432/db');
});

test('fresh PostgreSQL schema declares the four durable tables', () => {
  assert.deepEqual([connections, jobs, presets, settings].map(getTableName), ['connections', 'jobs', 'presets', 'settings']);
});

test('fresh PostgreSQL schema declares the Better Auth persistence tables', () => {
  assert.deepEqual([user, session, account, verification].map(getTableName), ['user', 'session', 'account', 'verification']);
});
