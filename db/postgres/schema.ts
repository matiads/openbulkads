import { pgTable, text, bigint, index } from 'drizzle-orm/pg-core';

// Node's type-stripping runner requires the explicit extension for this re-export.
// @ts-expect-error TS5097: allowImportingTsExtensions is not enabled in tsconfig.
export * from './auth-schema.ts';

// Epoch milliseconds and serialized payloads retain the legacy persistence contract.
export const connections = pgTable('connections', {
  owner: text('owner').primaryKey(), token: text('token').notNull(), name: text('name').notNull(),
  cooldown: bigint('cooldown', { mode: 'number' }).notNull().default(0),
});
export const jobs = pgTable('jobs', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(),
  payload: text('payload').notNull(), state: text('state').notNull(), status: text('status').notNull(),
  created: bigint('created', { mode: 'number' }).notNull(), updated: bigint('updated', { mode: 'number' }).notNull(),
}, t => [index('jobs_owner_created').on(t.owner, t.created)]);
export const presets = pgTable('presets', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), account: text('account').notNull(),
  name: text('name').notNull(), configuration: text('configuration').notNull(),
  created: bigint('created', { mode: 'number' }).notNull(),
}, t => [index('presets_owner_account').on(t.owner, t.account)]);
export const settings = pgTable('settings', {
  owner: text('owner').primaryKey(), appId: text('app_id'), appSecret: text('app_secret'),
  selectedAccounts: text('selected_accounts'), tokenMetadata: text('token_metadata'),
});
