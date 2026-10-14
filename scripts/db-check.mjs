import './load-env.mjs';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { getDatabaseUrl } from '../db/postgres/config.ts';

const pool = new Pool({ connectionString: getDatabaseUrl(), connectionTimeoutMillis: 5000 });
try {
  const tables = await pool.query("select tablename from pg_tables where schemaname = 'public' and tablename in ('connections','jobs','presets','settings') order by tablename");
  assert.deepEqual(tables.rows.map(row => row.tablename), ['connections', 'jobs', 'presets', 'settings']);
  const indexes = await pool.query("select indexname from pg_indexes where schemaname = 'public' and indexname in ('connections_pkey','jobs_pkey','jobs_owner_created','presets_pkey','presets_owner_account','settings_pkey') order by indexname");
  assert.deepEqual(indexes.rows.map(row => row.indexname), ['connections_pkey', 'jobs_owner_created', 'jobs_pkey', 'presets_owner_account', 'presets_pkey', 'settings_pkey']);
  console.log('PostgreSQL tables and indexes verified');
} finally {
  await pool.end();
}
