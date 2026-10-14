import '../../scripts/load-env.mjs';
import { defineConfig } from 'drizzle-kit';
import { getDatabaseUrl } from './config';

export default defineConfig({
  out: './drizzle/postgres',
  schema: './db/postgres/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: getDatabaseUrl() },
});
