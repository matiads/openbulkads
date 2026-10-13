import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin } from 'better-auth/plugins';
// @ts-expect-error TS5097: Node's type-stripping runner requires the explicit extension.
import { createDatabase } from '../db/postgres/client.ts';
// @ts-expect-error TS5097: Node's type-stripping runner requires the explicit extension.
import { user, session, account, verification } from '../db/postgres/auth-schema.ts';

export function betterAuthEnv(env: NodeJS.ProcessEnv = process.env): { secret?: string; baseURL?: string } {
  const secret = env.BETTER_AUTH_SECRET;
  const baseURL = env.BETTER_AUTH_URL;
  if (env.NODE_ENV === 'production') {
    if (!secret || secret.length < 32) throw new Error('BETTER_AUTH_SECRET must be set to at least 32 characters in production.');
    if (!baseURL) throw new Error('BETTER_AUTH_URL must be set in production.');
  }
  return { secret, baseURL };
}

// Public self-registration is closed; users are provisioned through the admin CLI.
export const authOptions = {
  emailAndPassword: { enabled: true, disableSignUp: true },
  plugins: [admin()],
};

const database = createDatabase();
const { secret, baseURL } = betterAuthEnv();

export const auth = betterAuth({
  ...authOptions,
  ...(baseURL ? { baseURL } : {}),
  ...(secret ? { secret } : {}),
  database: drizzleAdapter(database.db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
});

// Exposed so administrative scripts can release the connection pool explicitly.
export const authPool = database.pool;
