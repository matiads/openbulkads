import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_MEDIA_BYTES } from '../lib/media-limit';
import { getMediaConfig } from '../lib/media/config';
import { createLocalMediaStore, writeAll } from '../lib/media/local';
import { mediaStore } from '../lib/media/storage';
import { multipartStream } from '../lib/media-stream';

async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'oba-media-'));
}

function streamOf(bytes: number) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
}

function generatedStream(total: number, chunkSize = 1 << 20): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) {
        controller.close();
        return;
      }
      const length = Math.min(chunkSize, total - sent);
      const chunk = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) chunk[i] = (sent + i) & 0xff;
      controller.enqueue(chunk);
      sent += length;
    },
  });
}

function interruptedStream(chunkSize: number, chunksBeforeError: number): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunksBeforeError) {
        controller.error(new Error('source interrupted'));
        return;
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(index & 0xff));
      index += 1;
    },
  });
}

async function readStreamBody(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

function streamOfBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
}

async function ownerDirEntries(root: string, owner: string): Promise<string[]> {
  const ownerDir = join(root, owner);
  try {
    return await readdir(ownerDir);
  } catch {
    return [];
  }
}

function noTempLeftovers(entries: string[]) {
  for (const name of entries) {
    assert.ok(
      !name.startsWith('.obj-') && !name.startsWith('.meta-') && !name.startsWith('.tmp-'),
      `unexpected temp file: ${name}`,
    );
  }
}

test('put/get round trip with Blob and content-type', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'alice/' + crypto.randomUUID();
  const payload = new Uint8Array([1, 2, 3, 4]);
  await store.put(key, new Blob([payload]), { httpMetadata: { contentType: 'image/png' } });
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, 4);
  assert.equal(got!.httpMetadata?.contentType, 'image/png');
  const buf = await readStreamBody(got!.body);
  assert.deepEqual([...buf], [...payload]);
});

test('put/get round trip with ReadableStream', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'bob/' + crypto.randomUUID();
  await store.put(key, streamOf(16), { httpMetadata: { contentType: 'video/mp4' } });
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, 16);
  assert.equal(got!.httpMetadata?.contentType, 'video/mp4');
});

test('head returns metadata without requiring get body', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'carol/' + crypto.randomUUID();
  await store.put(key, new Blob([new Uint8Array(7)]), { httpMetadata: { contentType: 'image/jpeg' } });
  const h = await store.head(key);
  assert.ok(h);
  assert.equal(h!.size, 7);
  assert.equal(h!.httpMetadata?.contentType, 'image/jpeg');
});

test('delete is idempotent and missing get/head return null', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'dave/' + crypto.randomUUID();
  assert.equal(await store.get(key), null);
  assert.equal(await store.head(key), null);
  await store.delete(key);
  await store.put(key, new Blob([new Uint8Array([9])]), { httpMetadata: { contentType: 'image/png' } });
  await store.delete(key);
  await store.delete(key);
  assert.equal(await store.get(key), null);
});

test('writeAll writes the whole chunk across partial filesystem writes', async () => {
  const input = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const target = new Uint8Array(input.byteLength);
  const observed: number[] = [];
  let targetOffset = 0;
  const partialSink = {
    async write(view: Uint8Array) {
      const accepted = Math.min(3, view.byteLength);
      target.set(view.subarray(0, accepted), targetOffset);
      targetOffset += accepted;
      observed.push(accepted);
      return { bytesWritten: accepted };
    },
  };
  await writeAll(partialSink, input);
  assert.deepEqual([...target], [...input]);
  assert.deepEqual(observed, [3, 3, 3, 1]);
});

test('writeAll rejects a sink that reports zero progress', async () => {
  const stalledSink = {
    async write() {
      return { bytesWritten: 0 };
    },
  };
  await assert.rejects(writeAll(stalledSink, new Uint8Array([1, 2])), /progress/i);
});

test('streams a generated 150 MB body under the active limit with exact stored size', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const size = 150 * 1024 * 1024;
  const key = 'video150/' + crypto.randomUUID();
  await store.put(key, generatedStream(size, 1 << 20), {
    httpMetadata: { contentType: 'video/mp4' },
  });
  const h = await store.head(key);
  assert.ok(h);
  assert.equal(h!.size, size);
  const st = await stat(join(root, 'video150', key.slice(key.indexOf('/') + 1)));
  assert.equal(st.size, size);
});

test('accepts a multi-chunk stream at exactly the active limit with exact stored size', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'limit/' + crypto.randomUUID();
  await store.put(key, generatedStream(MAX_MEDIA_BYTES, 1 << 20), {
    httpMetadata: { contentType: 'video/mp4' },
  });
  const h = await store.head(key);
  assert.ok(h);
  assert.equal(h!.size, MAX_MEDIA_BYTES);
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, MAX_MEDIA_BYTES);
});

test('rejects a multi-chunk stream one byte over the limit and cleans temps', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const owner = 'over' + crypto.randomUUID().slice(0, 8);
  const key = `${owner}/big`;
  await assert.rejects(
    store.put(key, generatedStream(MAX_MEDIA_BYTES + 1, 1 << 20), {
      httpMetadata: { contentType: 'video/mp4' },
    }),
    /40|limit|size|MB/i,
  );
  assert.equal(await store.get(key), null);
  noTempLeftovers(await ownerDirEntries(root, owner));
});

test('writes chunks incrementally before the source stream completes', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const owner = 'inc' + crypto.randomUUID().slice(0, 8);
  const key = `${owner}/stream`;
  const first = new Uint8Array(1024).fill(7);
  const second = new Uint8Array(1024).fill(9);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pulls = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      pulls += 1;
      if (pulls === 1) {
        controller.enqueue(first);
        return;
      }
      await gate;
      controller.enqueue(second);
      controller.close();
    },
  });

  const putPromise = store.put(key, stream, { httpMetadata: { contentType: 'video/mp4' } });

  let tempBytes = 0;
  try {
    for (let i = 0; i < 200 && tempBytes < first.byteLength; i += 1) {
      const entries = await ownerDirEntries(root, owner);
      const objTmp = entries.find((name) => name.startsWith('.obj-'));
      if (objTmp) {
        const st = await stat(join(root, owner, objTmp));
        tempBytes = st.size;
      }
      if (tempBytes < first.byteLength) await new Promise((r) => setTimeout(r, 10));
    }
  } finally {
    release();
  }
  await putPromise;
  assert.equal(
    tempBytes,
    first.byteLength,
    'first chunk should be on disk while the source stream is still open',
  );
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, first.byteLength + second.byteLength);
});

test('interrupted source stream rejects and leaves no temp files', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const owner = 'intr' + crypto.randomUUID().slice(0, 8);
  const key = `${owner}/vid`;
  await assert.rejects(
    store.put(key, interruptedStream(1024, 4), { httpMetadata: { contentType: 'video/mp4' } }),
    /interrupted/i,
  );
  assert.equal(await store.get(key), null);
  noTempLeftovers(await ownerDirEntries(root, owner));
});

test('interrupted replacement preserves existing object and cleans temps', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const owner = 'keep' + crypto.randomUUID().slice(0, 8);
  const key = `${owner}/vid`;
  const original = new Uint8Array([1, 2, 3, 4, 5]);
  await store.put(key, new Blob([original]), { httpMetadata: { contentType: 'image/png' } });
  await assert.rejects(
    store.put(key, interruptedStream(512, 2), { httpMetadata: { contentType: 'video/mp4' } }),
    /interrupted/i,
  );
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, original.byteLength);
  assert.equal(got!.httpMetadata?.contentType, 'image/png');
  const buf = await readStreamBody(got!.body);
  assert.deepEqual([...buf], [...original]);
  const entries = await ownerDirEntries(root, owner);
  noTempLeftovers(entries);
  assert.equal(entries.length, 2);
});

test('stored object keeps exact byte size and 0600 permissions', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const owner = 'perm' + crypto.randomUUID().slice(0, 8);
  const key = `${owner}/obj`;
  await store.put(key, generatedStream(4096, 512), { httpMetadata: { contentType: 'video/mp4' } });
  const h = await store.head(key);
  assert.ok(h);
  assert.equal(h!.size, 4096);
  const st = await stat(join(root, owner, 'obj'));
  assert.equal(st.size, 4096);
  assert.equal(st.mode & 0o777, 0o600);
});

test('failed re-put oversize preserves existing object and cleans temps', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'alice/k1';
  const original = new Uint8Array([10, 20, 30]);
  await store.put(key, new Blob([original]), { httpMetadata: { contentType: 'image/png' } });
  const over = MAX_MEDIA_BYTES + 1;
  await assert.rejects(
    store.put(key, streamOf(over), { httpMetadata: { contentType: 'video/mp4' } }),
    /40|limit|size|MB/i,
  );
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, 3);
  assert.equal(got!.httpMetadata?.contentType, 'image/png');
  const buf = await readStreamBody(got!.body);
  assert.deepEqual([...buf], [...original]);
  const entries = await ownerDirEntries(root, 'alice');
  noTempLeftovers(entries);
  assert.equal(entries.length, 2);
});

test('failed re-put empty body preserves existing object and cleans temps', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'alice/k1';
  const original = new Uint8Array([5, 6]);
  await store.put(key, new Blob([original]), { httpMetadata: { contentType: 'image/jpeg' } });
  await assert.rejects(
    store.put(key, streamOf(0), { httpMetadata: { contentType: 'image/jpeg' } }),
    /empty/i,
  );
  const got = await store.get(key);
  assert.ok(got);
  assert.equal(got!.size, 2);
  assert.equal(got!.httpMetadata?.contentType, 'image/jpeg');
  const buf = await readStreamBody(got!.body);
  assert.deepEqual([...buf], [...original]);
  const entries = await ownerDirEntries(root, 'alice');
  noTempLeftovers(entries);
  assert.equal(entries.length, 2);
});

test('rejects dot-prefixed segments, id ending in .json, and invalid keys are no-op on get/head/delete', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const blob = new Blob([new Uint8Array([1])]);
  const invalidPut = ['./x', 'alice/.obj-abc', 'alice/.hidden', '.alice/x', 'alice/x.json'];
  for (const key of invalidPut) {
    await assert.rejects(store.put(key, blob, { httpMetadata: { contentType: 'image/png' } }), /invalid|key/i);
  }
  const invalidRead = ['./x', 'alice/.hidden', '.alice/x', 'alice/x.json'];
  for (const key of invalidRead) {
    assert.equal(await store.get(key), null);
    assert.equal(await store.head(key), null);
    await store.delete(key);
  }
});

test('rejects path traversal and malformed keys', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const blob = new Blob([new Uint8Array([1])]);
  const bad = [
    '../etc/passwd',
    'owner/../secret/id',
    'owner/id/extra',
    '/absolute/key',
    'owner\\id',
    'owner/',
    '/only-owner',
    'owner\0id',
  ];
  for (const key of bad) {
    await assert.rejects(store.put(key, blob, { httpMetadata: { contentType: 'image/png' } }), /invalid|key/i);
  }
});

test('oversize stream rejected with no leftover files', async () => {
  const root = await tempRoot();
  const store = createLocalMediaStore(root);
  const key = 'eve/' + crypto.randomUUID();
  const over = MAX_MEDIA_BYTES + 1;
  await assert.rejects(
    store.put(key, streamOf(over), { httpMetadata: { contentType: 'video/mp4' } }),
    /40|limit|size|MB/i,
  );
  assert.equal(await store.get(key), null);
  const ownerDir = join(root, 'eve');
  let entries: string[];
  try {
    entries = await readdir(ownerDir);
  } catch {
    entries = [];
  }
  assert.equal(entries.length, 0);
});

test('getMediaConfig fail-closed for MEDIA_ROOT and MEDIA_STORAGE', () => {
  assert.throws(() => getMediaConfig({ MEDIA_STORAGE: 'local' }), /MEDIA_ROOT/i);
  assert.throws(() => getMediaConfig({ MEDIA_STORAGE: 'local', MEDIA_ROOT: 'relative/path' }), /absolute/i);
  assert.throws(() => getMediaConfig({ MEDIA_STORAGE: 'local', MEDIA_ROOT: '' }), /MEDIA_ROOT/i);
  assert.throws(
    () => getMediaConfig({ MEDIA_STORAGE: 's3', MEDIA_ROOT: '/tmp/x' }),
    /MEDIA_STORAGE|local|unsupported/i,
  );
  const cfg = getMediaConfig({ MEDIA_STORAGE: 'local', MEDIA_ROOT: '/var/media/oba' });
  assert.equal(cfg.adapter, 'local');
  assert.equal(cfg.root, '/var/media/oba');
});

test('multipart streaming works in Node without a global FixedLengthStream', async () => {
  const runtime = globalThis as typeof globalThis & { FixedLengthStream?: unknown };
  const saved = runtime.FixedLengthStream;
  Reflect.deleteProperty(runtime, 'FixedLengthStream');
  try {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const multipart = multipartStream(streamOfBytes(bytes), bytes.byteLength, 'image', 'image/png', 'node-test');
    const output = await readStreamBody(multipart.body);
    await multipart.completion;
    assert.equal(output.byteLength, multipart.length);
    assert.match(output.toString(), /name="filename"/);
    assert.ok(output.includes(Buffer.from(bytes)));
  } finally {
    if (saved !== undefined) runtime.FixedLengthStream = saved;
  }
});

test('importing storage module without env does not throw; mediaStore fails when env missing', async () => {
  const savedRoot = process.env.MEDIA_ROOT;
  const savedStorage = process.env.MEDIA_STORAGE;
  delete process.env.MEDIA_ROOT;
  delete process.env.MEDIA_STORAGE;
  assert.equal(typeof mediaStore, 'function');
  await assert.rejects(mediaStore(), /MEDIA_ROOT/i);
  if (savedRoot === undefined) delete process.env.MEDIA_ROOT;
  else process.env.MEDIA_ROOT = savedRoot;
  if (savedStorage === undefined) delete process.env.MEDIA_STORAGE;
  else process.env.MEDIA_STORAGE = savedStorage;
});
