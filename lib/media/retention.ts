export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

export type LocalMediaEntry = {
  key: string;
  createdAt: string | null;
};

export type CleanupCounts = {
  scanned: number;
  deleted: number;
  kept: number;
  failed: number;
};

function isExpired(createdAt: string | null, now: number, retentionMs: number): boolean {
  if (createdAt == null || createdAt === '') return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return now - t > retentionMs;
}

export async function cleanupOrphanMedia(options: {
  entries: LocalMediaEntry[];
  protectedKeys: Set<string>;
  now: number;
  retentionMs?: number;
  remove: (key: string) => Promise<void>;
}): Promise<CleanupCounts> {
  const retentionMs = options.retentionMs ?? DEFAULT_RETENTION_MS;
  const counts: CleanupCounts = { scanned: 0, deleted: 0, kept: 0, failed: 0 };

  for (const entry of options.entries) {
    counts.scanned += 1;
    const protectedKey = options.protectedKeys.has(entry.key);
    const expired = isExpired(entry.createdAt, options.now, retentionMs);

    if (protectedKey || !expired) {
      counts.kept += 1;
      continue;
    }

    try {
      await options.remove(entry.key);
      counts.deleted += 1;
    } catch {
      counts.failed += 1;
    }
  }

  return counts;
}
