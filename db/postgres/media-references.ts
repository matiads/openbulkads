import type { Pool } from 'pg';

function collectFromObject(obj: unknown, keys: Set<string>) {
  if (!obj || typeof obj !== 'object') return;
  const record = obj as Record<string, unknown>;
  const uploadKey = record.uploadKey;
  if (typeof uploadKey === 'string' && uploadKey) keys.add(uploadKey);
  const key = record.key;
  if (typeof key === 'string' && key) keys.add(key);
}

/** Media keys referenced by jobs that are not done (failed/uncertain jobs keep their media). */
export async function listProtectedMediaKeys(pool: Pool): Promise<Set<string>> {
  const keys = new Set<string>();
  const { rows } = await pool.query<{ payload: string; state: string }>(
    "SELECT payload, state FROM jobs WHERE status <> 'done'",
  );
  for (const row of rows) {
    for (const raw of [row.payload, row.state]) {
      try {
        collectFromObject(JSON.parse(raw), keys);
      } catch {
        /* skip malformed */
      }
    }
  }
  return keys;
}
