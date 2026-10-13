import { getMediaConfig } from '@/lib/media/config';

export type ProbeFileHandle = {
  writeFile(data: string): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
};

export type ProbeFileSystem = {
  open(path: string, flags: string, mode: number): Promise<ProbeFileHandle>;
  unlink(path: string): Promise<void>;
};

export type ReadinessBody = { ready: boolean; database: boolean; media: boolean };
export type ReadinessOutcome = { status: 200 | 503; body: ReadinessBody };
export type ReadinessProbes = {
  database: () => Promise<boolean>;
  media: () => Promise<boolean>;
};

// `node:fs` is imported lazily so route graphs that never run readiness keep it
// out of their static bundle.
async function defaultFileSystem(): Promise<ProbeFileSystem> {
  const fs = await import('node:fs/promises');
  return {
    open: (path, flags, mode) => fs.open(path, flags, mode),
    unlink: path => fs.unlink(path),
  };
}

// Writes, fsyncs, closes and unlinks a uniquely named 0600 probe so a readiness
// check never leaves an artifact behind and never succeeds on an unwritable root.
export async function probeMediaRoot(
  env: Record<string, string | undefined> = process.env,
  fileSystem?: ProbeFileSystem,
): Promise<boolean> {
  let root: string;
  try {
    root = getMediaConfig(env).root;
  } catch {
    return false;
  }

  let fs: ProbeFileSystem;
  try {
    fs = fileSystem ?? (await defaultFileSystem());
  } catch {
    return false;
  }

  const probePath = `${root.replace(/\/+$/u, '')}/.readiness-${crypto.randomUUID()}`;
  let handle: ProbeFileHandle | undefined;
  let created = false;
  let ok = false;
  try {
    handle = await fs.open(probePath, 'wx', 0o600);
    created = true;
    await handle.writeFile('readiness');
    await handle.sync();
    ok = true;
  } catch {
    ok = false;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        ok = false;
      }
    }
    if (created) {
      try {
        await fs.unlink(probePath);
      } catch {
        ok = false;
      }
    }
  }
  return ok;
}

// `pg` lives behind the same lazy postgres boundary as the repositories.
async function defaultDatabaseProbe(): Promise<boolean> {
  const { checkDatabaseReady } = await import('@/db/postgres/client');
  return checkDatabaseReady();
}

async function safely(probe: () => Promise<boolean>): Promise<boolean> {
  try {
    return (await probe()) === true;
  } catch {
    return false;
  }
}

// Minimal, non-verbose outcome: booleans only, never raw errors or secrets.
export async function readinessResult(probes: Partial<ReadinessProbes> = {}): Promise<ReadinessOutcome> {
  const [database, media] = await Promise.all([
    safely(probes.database ?? defaultDatabaseProbe),
    safely(probes.media ?? (() => probeMediaRoot())),
  ]);
  const ready = database && media;
  return { status: ready ? 200 : 503, body: { ready, database, media } };
}
