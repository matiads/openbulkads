#!/usr/bin/env node
// One-shot PostgreSQL migration entry point for the self-hosted container image.
//
// It applies the Drizzle SQL in `drizzle/postgres` using the dedicated
// `MIGRATION_DATABASE_URL` credentials, then exits. It never starts the Next.js
// server, so Compose can gate the app on `service_completed_successfully`.
// Ordinary application startup keeps using `DATABASE_URL` and never migrates.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_FOLDER = path.join('drizzle', 'postgres');
export const MIGRATION_DATABASE_URL = 'MIGRATION_DATABASE_URL';
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';
const SCRIPT_NAME = 'container-migrate.mjs';

const MIGRATIONS_TABLE_CREATE = `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
)`;

// Fail closed on absent or malformed credentials instead of silently skipping.
export function resolveMigrationDatabaseUrl(env = process.env) {
  const value = env[MIGRATION_DATABASE_URL];
  if (!value) {
    throw new Error(`${MIGRATION_DATABASE_URL} is required to run database migrations`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${MIGRATION_DATABASE_URL} must be a valid PostgreSQL URL`);
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.pathname.length < 2 ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${MIGRATION_DATABASE_URL} must contain PostgreSQL credentials, host and database (without query or fragment)`);
  }
  return value;
}

export async function readMigrations(migrationsFolder) {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  let journal;
  try {
    journal = JSON.parse(await readFile(journalPath, 'utf8'));
  } catch {
    throw new Error(`Can't find migrations journal at ${journalPath}`);
  }
  const migrations = [];
  for (const entry of journal.entries ?? []) {
    const file = path.join(migrationsFolder, `${entry.tag}.sql`);
    let contents;
    try {
      contents = await readFile(file, 'utf8');
    } catch {
      throw new Error(`No migration file ${file} found`);
    }
    migrations.push({
      statements: contents.split('--> statement-breakpoint'),
      folderMillis: entry.when ?? 0,
      hash: createHash('sha256').update(contents).digest('hex'),
    });
  }
  return migrations;
}

// Mirrors drizzle-orm's `drizzle.__drizzle_migrations` journal so the dev
// `db:migrate` command and this container entry point agree on applied state.
export async function applyMigrations({ pool, migrationsFolder }) {
  const migrations = await readMigrations(migrationsFolder);
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${MIGRATIONS_SCHEMA}"`);
    await client.query(MIGRATIONS_TABLE_CREATE);
    const applied = await client.query(
      `select created_at from "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" order by created_at desc limit 1`,
    );
    const last = applied.rows[0]?.created_at;
    await client.query('BEGIN');
    try {
      for (const migration of migrations) {
        if (last !== undefined && last !== null && Number(last) >= migration.folderMillis) continue;
        for (const statement of migration.statements) {
          const trimmed = statement.trim();
          if (trimmed) await client.query(trimmed);
        }
        await client.query(
          `insert into "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash","created_at") values($1,$2)`,
          [migration.hash, migration.folderMillis],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

async function defaultLoadPostgres() {
  const { Pool } = await import('pg');
  return { Pool };
}

export async function runMigrations({
  env = process.env,
  appRoot = APP_ROOT,
  migrationsFolder,
  logger = console,
  load = defaultLoadPostgres,
} = {}) {
  const databaseUrl = resolveMigrationDatabaseUrl(env);
  const folder = migrationsFolder ?? path.join(appRoot, MIGRATIONS_FOLDER);
  const { Pool } = await load();
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  try {
    await applyMigrations({ pool, migrationsFolder: folder });
    logger.log?.('PostgreSQL migrations applied');
  } finally {
    await pool.end();
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    process.stdout.write(
      'Usage: node scripts/container-migrate.mjs\n\n' +
        `Applies drizzle/postgres migrations with ${MIGRATION_DATABASE_URL} and exits without starting the server.\n`,
    );
    return;
  }
  await runMigrations();
}

// Guard against running when this module is bundled into another entry point.
const invokedEntry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedEntry.endsWith(SCRIPT_NAME) && fileURLToPath(import.meta.url).endsWith(SCRIPT_NAME)) {
  main().catch(error => {
    console.error(`container-migrate: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
