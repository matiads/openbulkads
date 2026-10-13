import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  runBackup as runBackupImpl,
  runRestore as runRestoreImpl,
  planRetention,
  resolveCommandDatabaseUrl as resolveCommandDatabaseUrlImpl,
} from '../scripts/backup-ops.mjs';

// backup-ops.mjs infers `env` as NodeJS.ProcessEnv (from its `env = process.env`
// default), which Next.js augments to require NODE_ENV. Test fixtures pass partial
// environments on purpose, so widen only the `env` field here.
type LooseOpts = { env?: Record<string, string | undefined>; [key: string]: unknown };
const runBackup = runBackupImpl as (
  opts?: LooseOpts,
) => ReturnType<typeof runBackupImpl>;
const runRestore = runRestoreImpl as (
  opts?: LooseOpts,
) => ReturnType<typeof runRestoreImpl>;
const resolveCommandDatabaseUrl = resolveCommandDatabaseUrlImpl as (
  opts: LooseOpts,
) => ReturnType<typeof resolveCommandDatabaseUrlImpl>;
import { SECRET_FILE_ENV } from '../scripts/container-start.mjs';

type RunSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd?: string;
  shell?: boolean;
};

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'oba-backup-'));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function patchedRunner() {
  const calls: RunSpec[] = [];
  const run = async (spec: RunSpec) => {
    calls.push(spec);
    if (spec.command === 'pg_dump') {
      const fileArg = spec.args.find(arg => arg.startsWith('--file='));
      assert.ok(fileArg, 'pg_dump must receive --file=');
      const file = fileArg.slice('--file='.length);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, 'DUMP-PAYLOAD');
    } else if (spec.command === 'tar') {
      if (spec.args.includes('-cf')) {
        const archive = spec.args[spec.args.indexOf('-cf') + 1];
        await writeFile(archive, 'MEDIA-PAYLOAD');
      } else {
        const staging = spec.args[spec.args.indexOf('-C') + 1];
        await writeFile(join(staging, 'restored.txt'), 'restored');
      }
    } else if (spec.command === 'pg_restore') {
      // no-op, restored database is out of scope for these deterministic tests
    }
    return { code: 0 };
  };
  return { run, calls };
}

async function stageValidSnapshot(
  backupDir: string,
  id: string,
  dump = 'DUMP-PAYLOAD',
  media = 'MEDIA-PAYLOAD',
): Promise<string> {
  const dir = join(backupDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'postgres.dump'), dump);
  await writeFile(join(dir, 'media.tar'), media);
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify({
      version: 1,
      id,
      createdAt: '2026-01-01T00:00:00.000Z',
      database: { file: 'postgres.dump', sha256: sha256(dump) },
      media: { file: 'media.tar', sha256: sha256(media) },
    }),
  );
  return dir;
}

test('backup fails closed on missing, empty and NUL secrets without leaking the password', async () => {
  const root = await tempRoot();
  const secretDir = join(root, 'secrets');
  await mkdir(secretDir, { recursive: true });
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const baseEnv = {
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
    OPENBULKADS_SECRET_DIR: secretDir,
  };

  await assert.rejects(
    () => runBackup({ env: { ...baseEnv }, now: () => new Date('2026-01-10T00:00:00Z') }),
    /BACKUP_DATABASE_URL/,
  );

  await writeFile(join(secretDir, 'BACKUP_DATABASE_URL'), '');
  await assert.rejects(
    () => runBackup({ env: { ...baseEnv }, now: () => new Date('2026-01-10T00:00:00Z') }),
    /empty/i,
  );

  const password = 'SUPER-SECRET-PASSWORD';
  await writeFile(
    join(secretDir, 'BACKUP_DATABASE_URL'),
    `postgres://user:${password}@db.internal:5432/appdb\0trailing`,
  );
  await assert.rejects(
    async () => {
      try {
        await runBackup({ env: { ...baseEnv }, now: () => new Date('2026-01-10T00:00:00Z') });
      } catch (error) {
        assert.doesNotMatch(String((error as Error).message), new RegExp(password));
        throw error;
      }
    },
    /NUL/,
  );
});

test('resolveCommandDatabaseUrl never falls back to the other command URL', async () => {
  const root = await tempRoot();
  const secretDir = join(root, 'secrets');
  await mkdir(secretDir, { recursive: true });
  await writeFile(
    join(secretDir, 'BACKUP_DATABASE_URL'),
    'postgres://user:backuppw@db.internal:5432/appdb',
  );
  assert.throws(
    () =>
      resolveCommandDatabaseUrl({
        name: 'RESTORE_DATABASE_URL',
        env: { OPENBULKADS_SECRET_DIR: secretDir },
        secretDir,
      }),
    /RESTORE_DATABASE_URL/,
  );
});

test('backup fails closed on relative BACKUP_DIR or MEDIA_ROOT', async () => {
  const root = await tempRoot();
  const env = {
    BACKUP_DATABASE_URL: 'postgres://user:relativepw@db.internal:5432/appdb',
    BACKUP_DIR: 'relative-backups',
    MEDIA_ROOT: join(root, 'media'),
  };
  await assert.rejects(
    async () => {
      try {
        await runBackup({ env, now: () => new Date('2026-01-10T00:00:00Z') });
      } catch (error) {
        assert.doesNotMatch(String((error as Error).message), /relativepw/);
        throw error;
      }
    },
    /BACKUP_DIR/,
  );

  await assert.rejects(
    () =>
      runBackup({
        env: { ...env, BACKUP_DIR: join(root, 'backups'), MEDIA_ROOT: 'relative-media' },
        now: () => new Date('2026-01-10T00:00:00Z'),
      }),
    /MEDIA_ROOT/,
  );
});

test('a failed dump never publishes a snapshot and removes the incomplete directory', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const env = {
    BACKUP_DATABASE_URL: 'postgres://user:toppw@db.internal:5432/appdb',
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };
  const run = async (spec: RunSpec) => {
    if (spec.command === 'pg_dump') return { code: 1 };
    return { code: 0 };
  };
  await assert.rejects(
    async () => {
      try {
        await runBackup({ env, now: () => new Date('2026-01-10T03:04:05Z'), run });
      } catch (error) {
        assert.doesNotMatch(String((error as Error).message), /toppw/);
        throw error;
      }
    },
    /pg_dump/i,
  );
  const entries = await readdir(backupDir).catch(() => [] as string[]);
  assert.ok(!entries.some(name => !name.startsWith('.')), 'no complete snapshot may be published');
  assert.ok(!entries.some(name => name.startsWith('.incomplete-')), 'the incomplete directory must be removed');
});

test('a successful backup publishes a paired snapshot with checksums and no secrets', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const password = 'GOODPASSWORD';
  const env = {
    BACKUP_DATABASE_URL: `postgres://backupuser:${password}@db.internal:5433/appdb`,
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };
  const { run, calls } = patchedRunner();
  const id = '20260110T030405Z';
  const result = await runBackup({ env, now: () => new Date('2026-01-10T03:04:05Z'), run });

  assert.deepEqual(result, { id, kept: [id], deleted: [] });
  const snapshot = join(backupDir, id);
  const manifest = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.id, id);
  assert.equal(manifest.database.file, 'postgres.dump');
  assert.equal(manifest.media.file, 'media.tar');
  assert.equal(manifest.database.sha256, sha256('DUMP-PAYLOAD'));
  assert.equal(manifest.media.sha256, sha256('MEDIA-PAYLOAD'));
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(password));

  const dumpCall = calls.find(call => call.command === 'pg_dump');
  const tarCall = calls.find(call => call.command === 'tar');
  assert.ok(dumpCall);
  assert.ok(tarCall);
  assert.deepEqual(dumpCall.args[0], '--format=custom');
  assert.equal(dumpCall.args[1], `--file=${join(backupDir, '.incomplete-' + id, 'postgres.dump')}`);
  assert.deepEqual(dumpCall.args.slice(2), ['--no-password']);
  assert.equal(tarCall.args[0], '-C');
  assert.equal(tarCall.args[1], mediaRoot);
  assert.equal(tarCall.args[2], '-cf');
  assert.equal(tarCall.args[3], join(backupDir, '.incomplete-' + id, 'media.tar'));
  assert.deepEqual(tarCall.args.slice(4), ['.']);
  const credentialFreeEnvKeys = [
    'BACKUP_DATABASE_URL',
    'RESTORE_DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
  ];
  for (const call of calls) {
    for (const arg of call.args) {
      assert.doesNotMatch(arg, new RegExp(password));
    }
    assert.ok(!('BACKUP_DATABASE_URL' in call.env), 'the URL must not leak into the child environment');
    assert.ok(!('RESTORE_DATABASE_URL' in call.env), 'the URL must not leak into the child environment');
    assert.notEqual(call.shell, true, 'no shell may be used');
    if (call.command === 'tar') {
      for (const key of credentialFreeEnvKeys) {
        assert.ok(!(key in call.env), `tar must not inherit ${key}`);
      }
    }
  }
  assert.equal(dumpCall.env.PGHOST, 'db.internal');
  assert.equal(dumpCall.env.PGPORT, '5433');
  assert.equal(dumpCall.env.PGUSER, 'backupuser');
  assert.equal(dumpCall.env.PGDATABASE, 'appdb');
  assert.equal(dumpCall.env.PGPASSWORD, password);
});

test('backup reads the URL from a root-only secret file and prunes older snapshots', async () => {
  const root = await tempRoot();
  const secretDir = join(root, 'secrets');
  await mkdir(secretDir, { recursive: true });
  await writeFile(
    join(secretDir, 'BACKUP_DATABASE_URL'),
    'postgres://secretuser:secretpw@db.internal:5432/appdb\n',
  );
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  // Nine older distinct days plus the new snapshot: the oldest three must be pruned.
  for (let day = 1; day <= 9; day += 1) {
    await stageValidSnapshot(backupDir, `2026010${day}T010000Z`);
  }
  const { run } = patchedRunner();
  const result = await runBackup({
    env: { BACKUP_DIR: backupDir, MEDIA_ROOT: mediaRoot, OPENBULKADS_SECRET_DIR: secretDir },
    now: () => new Date('2026-01-10T03:04:05Z'),
    run,
  });
  assert.equal(result.id, '20260110T030405Z');
  assert.deepEqual(result.deleted, ['20260101T010000Z', '20260102T010000Z', '20260103T010000Z']);
  assert.ok(result.kept.includes('20260110T030405Z'));
  assert.ok(!(await exists(join(backupDir, '20260101T010000Z'))));
  assert.ok(await exists(join(backupDir, '20260110T030405Z')));
});

test('retention keeps the newest snapshot on the seven most recent UTC dates and deletes same-day extras', () => {
  const now = Date.parse('2026-01-21T00:00:00Z');
  const ids: string[] = [];
  for (let day = 1; day <= 10; day += 1) {
    ids.push(`202601${String(day).padStart(2, '0')}T010000Z`);
  }
  ids.push('20260105T230000Z'); // second snapshot on an older day
  const plan = planRetention(ids, now);
  assert.equal(plan.kept.length, 7);
  assert.ok(plan.kept.includes('20260105T230000Z'), 'the later same-day snapshot is kept');
  assert.ok(plan.deleted.includes('20260105T010000Z'), 'the earlier same-day snapshot is deleted');
  for (let day = 1; day <= 3; day += 1) {
    assert.ok(plan.deleted.includes(`202601${String(day).padStart(2, '0')}T010000Z`));
  }
  for (let day = 4; day <= 10; day += 1) {
    const expected =
      day === 5
        ? '20260105T230000Z'
        : `202601${String(day).padStart(2, '0')}T010000Z`;
    assert.ok(plan.kept.includes(expected), `day ${day} keeper ${expected} must be kept`);
  }
});

test('retention keeps a Sunday inside the daily window once and keeps older Sundays among the four newest', () => {
  const now = Date.parse('2026-01-21T00:00:00Z');
  const ids: string[] = [];
  for (let day = 1; day <= 20; day += 1) {
    ids.push(`202601${String(day).padStart(2, '0')}T010000Z`);
  }
  // 2025-12-21 and 2025-12-28 are Sundays; 2026-01-04, 11 and 18 are Sundays.
  ids.push('20251221T010000Z');
  ids.push('20251228T010000Z');
  const plan = planRetention(ids, now);

  // A Sunday inside the daily window is kept exactly once.
  assert.equal(plan.kept.filter(id => id === '20260118T010000Z').length, 1);
  assert.ok(plan.kept.includes('20260118T010000Z'));

  // Older-than-7-days Sundays: the four newest are kept even outside the daily window.
  assert.ok(plan.kept.includes('20260104T010000Z'));
  assert.ok(plan.kept.includes('20260111T010000Z'));
  assert.ok(plan.kept.includes('20251228T010000Z'));

  // The fifth-newest Sunday is not one of the four weekly copies and no longer daily.
  assert.ok(plan.deleted.includes('20251221T010000Z'));
});

test('restore refuses a missing file, a bad checksum or an incomplete pair without invoking the runner', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(mediaRoot, 'keep.txt'), 'original');
  const id = '20260110T030405Z';
  const env = {
    RESTORE_DATABASE_URL: 'postgres://restoreuser:restorepw@db.internal:5432/appdb',
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };

  const cases: Array<[string, (dir: string) => Promise<void>]> = [
    ['missing archive', dir => rm(join(dir, 'media.tar'))],
    ['missing dump', dir => rm(join(dir, 'postgres.dump'))],
    ['bad checksum', dir => writeFile(join(dir, 'postgres.dump'), 'TAMPERED')],
  ];

  for (const [label, tamper] of cases) {
    await rm(join(backupDir, id), { recursive: true, force: true });
    const dir = await stageValidSnapshot(backupDir, id);
    await tamper(dir);
    const { run, calls } = patchedRunner();
    await assert.rejects(async () => {
      try {
        await runRestore({ id, env, run });
      } catch (error) {
        assert.doesNotMatch(String((error as Error).message), /restorepw/);
        throw error;
      }
    }, `restore must refuse ${label}`);
    assert.equal(calls.length, 0, `the restore runner must not run for ${label}`);
    assert.equal(await readFile(join(mediaRoot, 'keep.txt'), 'utf8'), 'original');
  }
});

test('restore verifies the pair before replacing media and uses --dbname from the URL', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  await writeFile(join(mediaRoot, 'old.txt'), 'old');
  const id = '20260110T030405Z';
  await stageValidSnapshot(backupDir, id);
  const env = {
    RESTORE_DATABASE_URL: 'postgres://restoreuser:restorepw@db.internal:5432/baddb',
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };
  const { run, calls } = patchedRunner();
  const result = await runRestore({ id, env, run });
  assert.deepEqual(result, { id, restored: true });

  const restoreCall = calls.find(call => call.command === 'pg_restore');
  assert.ok(restoreCall);
  assert.ok(restoreCall.args.includes('--dbname=baddb'));
  assert.equal(restoreCall.env.PGPASSWORD, 'restorepw');
  for (const arg of restoreCall.args) {
    assert.doesNotMatch(arg, /restorepw|postgres:\/\//);
  }
  assert.ok(!('RESTORE_DATABASE_URL' in restoreCall.env));

  const tarCall = calls.find(call => call.command === 'tar');
  assert.ok(tarCall);
  for (const key of [
    'BACKUP_DATABASE_URL',
    'RESTORE_DATABASE_URL',
    'PGHOST',
    'PGPORT',
    'PGUSER',
    'PGPASSWORD',
    'PGDATABASE',
  ]) {
    assert.ok(!(key in tarCall.env), `tar must not inherit ${key}`);
  }

  assert.equal(await readFile(join(mediaRoot, 'restored.txt'), 'utf8'), 'restored');
  assert.ok(!(await exists(join(mediaRoot, 'old.txt'))), 'media contents must be replaced');
});

test('restore refuses to stage media inside MEDIA_ROOT', async () => {
  const root = await tempRoot();
  const mediaRoot = join(root, 'media');
  const backupDir = join(mediaRoot, 'backups');
  await mkdir(mediaRoot, { recursive: true });
  const id = '20260110T030405Z';
  await stageValidSnapshot(backupDir, id);
  const { run, calls } = patchedRunner();
  await assert.rejects(
    () =>
      runRestore({
        id,
        env: {
          RESTORE_DATABASE_URL: 'postgres://u:p@db.internal:5432/appdb',
          BACKUP_DIR: backupDir,
          MEDIA_ROOT: mediaRoot,
        },
        run,
      }),
    /outside MEDIA_ROOT/,
  );
  assert.equal(calls.length, 0);
});

test('restore requires an absolute snapshot id, absolute paths and never falls back to the backup URL', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(mediaRoot, { recursive: true });
  const { run } = patchedRunner();
  await assert.rejects(
    () =>
      runRestore({
        id: '',
        env: {
          RESTORE_DATABASE_URL: 'postgres://u:p@db.internal:5432/appdb',
          BACKUP_DIR: backupDir,
          MEDIA_ROOT: mediaRoot,
        },
        run,
      }),
    /snapshot id/i,
  );
  const id = '20260110T030405Z';
  await assert.rejects(
    () =>
      runRestore({
        id,
        env: {
          BACKUP_DATABASE_URL: 'postgres://u:backuppw@db.internal:5432/appdb',
          BACKUP_DIR: backupDir,
          MEDIA_ROOT: mediaRoot,
        },
        run,
      }),
    /RESTORE_DATABASE_URL/,
  );
  await assert.rejects(
    () =>
      runRestore({
        id,
        env: {
          RESTORE_DATABASE_URL: 'postgres://u:p@db.internal:5432/appdb',
          BACKUP_DIR: 'relative',
          MEDIA_ROOT: mediaRoot,
        },
        run,
      }),
    /BACKUP_DIR/,
  );
});

test('restore rejects a traversal snapshot id before reading secrets or running any command', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(backupDir, { recursive: true });
  await mkdir(mediaRoot, { recursive: true });
  const password = 'TRAVERSALPW';
  const env = {
    RESTORE_DATABASE_URL: `postgres://restoreuser:${password}@db.internal:5432/appdb`,
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };
  const { run, calls } = patchedRunner();
  await assert.rejects(async () => {
    try {
      await runRestore({ id: '../outside', env, run });
    } catch (error) {
      const message = String((error as Error).message);
      assert.doesNotMatch(message, new RegExp(password));
      assert.doesNotMatch(message, /postgres:\/\//);
      throw error;
    }
  }, /snapshot id/i);
  assert.equal(calls.length, 0, 'the runner must not run for a rejected traversal id');
  assert.deepEqual(await readdir(backupDir), [], 'no snapshot directory may be created for a rejected id');
  assert.ok(!(await exists(join(root, 'outside'))), 'the traversal target must not be created');
});

test('restore rejects a non-snapshot id even when a restore URL is available', async () => {
  const root = await tempRoot();
  const backupDir = join(root, 'backups');
  const mediaRoot = join(root, 'media');
  await mkdir(backupDir, { recursive: true });
  await mkdir(mediaRoot, { recursive: true });
  const env = {
    RESTORE_DATABASE_URL: 'postgres://restoreuser:somepw@db.internal:5432/appdb',
    BACKUP_DIR: backupDir,
    MEDIA_ROOT: mediaRoot,
  };
  const { run, calls } = patchedRunner();
  await assert.rejects(() => runRestore({ id: 's', env, run }), /snapshot id/i);
  assert.equal(calls.length, 0, 'the runner must not run for a rejected id');
  assert.deepEqual(await readdir(backupDir), []);
});

test('package.json exposes backup and restore commands', async () => {
  const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.backup, 'node scripts/backup-ops.mjs backup');
  assert.equal(pkg.scripts.restore, 'node scripts/backup-ops.mjs restore');
});

test('the app container secret bridge excludes backup and restore URLs', () => {
  assert.ok(!SECRET_FILE_ENV.includes('BACKUP_DATABASE_URL'));
  assert.ok(!SECRET_FILE_ENV.includes('RESTORE_DATABASE_URL'));
});
