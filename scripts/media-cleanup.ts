#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { getMediaConfig } from '../lib/media/config';
import { createDatabase } from '../db/postgres/client';
import { listProtectedMediaKeys } from '../db/postgres/media-references';
import { listLocalMedia, removeLocalMediaEntry } from '../lib/media/local';
import { cleanupOrphanMedia, DEFAULT_RETENTION_MS } from '../lib/media/retention';

async function main() {
  let pool;
  try {
    const { root } = getMediaConfig();
    ({ pool } = createDatabase());
    const protectedKeys = await listProtectedMediaKeys(pool);
    const entries = await listLocalMedia(root);
    const now = Date.now();
    const counts = await cleanupOrphanMedia({
      entries,
      protectedKeys,
      now,
      retentionMs: DEFAULT_RETENTION_MS,
      remove: (key) => removeLocalMediaEntry(root, key),
    });
    console.log(JSON.stringify(counts));
    await pool.end();
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    if (pool) await pool.end().catch(() => {});
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await main();
}
