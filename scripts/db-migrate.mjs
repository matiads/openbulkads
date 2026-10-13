import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDatabaseUrl } from '../db/postgres/config.ts';

const pool = new Pool({ connectionString: getDatabaseUrl(), connectionTimeoutMillis: 5000 });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle/postgres' });
  console.log('PostgreSQL migrations applied');
} finally {
  await pool.end();
}
