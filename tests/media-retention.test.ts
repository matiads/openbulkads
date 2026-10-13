import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, utimes, access, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cleanupOrphanMedia, DEFAULT_RETENTION_MS } from '../lib/media/retention';
import { listLocalMedia, removeLocalMediaEntry } from '../lib/media/local';

const H = 60 * 60 * 1000;

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'oba-retention-'));
}

async function writeObject(
  root: string,
  key: string,
  createdAt: string,
  opts?: { garbledSidecar?: boolean; objectOnly?: boolean },
) {
  const slash = key.indexOf('/');
  const owner = key.slice(0, slash);
  const id = key.slice(slash + 1);
  const ownerDir = join(root, owner);
  await mkdir(ownerDir, { recursive: true });
  await writeFile(join(ownerDir, id), Buffer.from('x'));
  if (!opts?.objectOnly) {
    const sidecar = opts?.garbledSidecar ? 'not-json' : JSON.stringify({ size: 1, createdAt });
    await writeFile(join(ownerDir, `${id}.json`), sidecar);
  }
}

async function writeTemp(root: string, owner: string, name: string, mtimeMs: number) {
  const p = join(root, owner, name);
  await mkdir(join(root, owner), { recursive: true });
  await writeFile(p, 't');
  await utimes(p, mtimeMs / 1000, mtimeMs / 1000);
}

test('orphan older than 24h deleted', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const old = new Date(now - DEFAULT_RETENTION_MS - H).toISOString();
  await writeObject(root, 'o/old1', old);
  const entries = await listLocalMedia(root);
  const removed: string[] = [];
  const r = await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (key) => {
      removed.push(key);
    },
  });
  assert.equal(removed.length, 1);
  assert.equal(removed[0], 'o/old1');
  assert.equal(r.deleted, 1);
});

test('orphan younger than 24h kept', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const young = new Date(now - DEFAULT_RETENTION_MS + H).toISOString();
  await writeObject(root, 'o/young1', young);
  const entries = await listLocalMedia(root);
  const removed: string[] = [];
  const r = await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (key) => {
      removed.push(key);
    },
  });
  assert.equal(removed.length, 0);
  assert.equal(r.kept, 1);
});

test('protected key older than 24h kept', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const old = new Date(now - DEFAULT_RETENTION_MS - H).toISOString();
  const key = 'o/prot1';
  await writeObject(root, key, old);
  const entries = await listLocalMedia(root);
  const removed: string[] = [];
  const r = await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set([key]),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (k) => {
      removed.push(k);
    },
  });
  assert.equal(removed.length, 0);
  assert.equal(r.kept, 1);
});

test('missing or garbled sidecar kept', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const old = new Date(now - DEFAULT_RETENTION_MS - H).toISOString();
  await writeObject(root, 'o/garb', old, { garbledSidecar: true });
  await writeObject(root, 'o/nosc', old, { objectOnly: true });
  const entries = await listLocalMedia(root);
  const removed: string[] = [];
  await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (k) => {
      removed.push(k);
    },
  });
  assert.equal(removed.length, 0);
});

test('stale temp removed from disk and fresh temp kept', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const staleM = now - DEFAULT_RETENTION_MS - H;
  const freshM = now - H;
  const stalePath = join(root, 'o', '.obj-deadbeef');
  const freshPath = join(root, 'o', '.tmp-fresh');
  await writeTemp(root, 'o', '.obj-deadbeef', staleM);
  await writeTemp(root, 'o', '.tmp-fresh', freshM);
  const entries = await listLocalMedia(root);
  assert.ok(entries.every((e) => e.kind === 'temp' || e.kind === 'object'));
  const r = await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: (key) => removeLocalMediaEntry(root, key),
  });
  assert.equal(r.deleted, 1);
  await assert.rejects(() => access(stalePath), /ENOENT/);
  await access(freshPath);
});

test('one delete failure counted while others proceed', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const old = new Date(now - DEFAULT_RETENTION_MS - H).toISOString();
  await writeObject(root, 'o/a', old);
  await writeObject(root, 'o/b', old);
  const entries = await listLocalMedia(root);
  const r = await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (key) => {
      if (key === 'o/a') throw new Error('fail a');
    },
  });
  assert.equal(r.failed, 1);
  assert.equal(r.deleted, 1);
});

test('exactly at 24h boundary not expired', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const atBoundary = new Date(now - DEFAULT_RETENTION_MS).toISOString();
  await writeObject(root, 'o/boundary', atBoundary);
  const entries = await listLocalMedia(root);
  const removed: string[] = [];
  await cleanupOrphanMedia({
    entries,
    protectedKeys: new Set(),
    now,
    retentionMs: DEFAULT_RETENTION_MS,
    remove: async (k) => {
      removed.push(k);
    },
  });
  assert.equal(removed.length, 0);
});

test('removeLocalMediaEntry unlink failure surfaces as cleanup failed', async () => {
  const root = await tempRoot();
  const now = Date.parse('2026-01-15T12:00:00.000Z');
  const old = new Date(now - DEFAULT_RETENTION_MS - H).toISOString();
  await writeObject(root, 'o/block', old);
  const ownerDir = join(root, 'o');
  await chmod(ownerDir, 0o500);
  try {
    const entries = await listLocalMedia(root);
    const r = await cleanupOrphanMedia({
      entries,
      protectedKeys: new Set(),
      now,
      retentionMs: DEFAULT_RETENTION_MS,
      remove: (key) => removeLocalMediaEntry(root, key),
    });
    assert.equal(r.failed, 1);
    assert.equal(r.deleted, 0);
  } finally {
    await chmod(ownerDir, 0o700);
  }
});

test('removeLocalMediaEntry rejects path escape keys', async () => {
  const root = await tempRoot();
  const victim = join(root, 'escape-me');
  await writeFile(victim, 'secret');
  await removeLocalMediaEntry(root, 'alice/.tmp-x/../../escape');
  await access(victim);
  await removeLocalMediaEntry(root, 'bad/../owner/.tmp-x');
  await access(victim);
  await removeLocalMediaEntry(root, 'o/.tmp-evil');
  const outside = join(root, '..', 'oba-outside-victim');
  await writeFile(outside, 'x');
  try {
    await removeLocalMediaEntry(root, `o/.tmp-y/${'..'.repeat(20)}/oba-outside-victim`);
    await access(outside);
  } finally {
    await rm(outside, { force: true });
  }
});
