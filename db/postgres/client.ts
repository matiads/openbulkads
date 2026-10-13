import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
// @ts-expect-error TS5097: Node's type-stripping runner requires the explicit extension.
import { getDatabaseUrl } from './config.ts';

// Instantiate only at the self-hosted database boundary.
export function createDatabase() {
  const pool = new Pool({ connectionString: getDatabaseUrl() });
  return { pool, db: drizzle(pool) };
}

type ReadinessQueryable = {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
};

// A readiness probe must not create a pool per request, so the Node runtime
// memoizes one pool for the process lifetime.
let readinessPool: Pool | undefined;

export function sharedDatabasePool(): Pool {
  return (readinessPool ??= new Pool({ connectionString: getDatabaseUrl() }));
}

// Non-mutating and schema-aware: it fails until every expected table exists.
const READINESS_SCHEMA_QUERY =
  "SELECT to_regclass('public.connections') IS NOT NULL AND to_regclass('public.settings') IS NOT NULL AND to_regclass('public.presets') IS NOT NULL AND to_regclass('public.jobs') IS NOT NULL AS ready";

export async function checkDatabaseReady(queryable: ReadinessQueryable = sharedDatabasePool()): Promise<boolean> {
  const { rows } = await queryable.query(READINESS_SCHEMA_QUERY);
  return rows[0]?.ready === true;
}
