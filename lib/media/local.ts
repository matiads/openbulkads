import { createReadStream } from 'node:fs';
import { open, mkdir, rename, unlink, readFile, stat, readdir } from 'node:fs/promises';
import { join, resolve, relative, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { MAX_MEDIA_BYTES, storageOversizeMessage } from '@/lib/media-limit';
import type { MediaHeadObject, MediaObjectBody, MediaPutOptions, MediaStore } from './storage';

const KEY_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

type Sidecar = { contentType?: string; size: number; createdAt: string };

function parseKey(key: string): { owner: string; id: string } {
  if (key.includes('\0') || key.includes('\\') || key.includes('..')) {
    throw new Error('Invalid media key');
  }
  if (!KEY_RE.test(key)) {
    throw new Error('Invalid media key');
  }
  const slash = key.indexOf('/');
  const owner = key.slice(0, slash);
  const id = key.slice(slash + 1);
  if (!owner || !id) throw new Error('Invalid media key');
  if (owner.startsWith('.') || id.startsWith('.')) throw new Error('Invalid media key');
  if (id.endsWith('.json')) throw new Error('Invalid media key');
  return { owner, id };
}

function pathsForKey(root: string, key: string) {
  const { owner, id } = parseKey(key);
  const ownerDir = join(root, owner);
  const objectPath = join(ownerDir, id);
  const sidecarPath = join(ownerDir, `${id}.json`);
  const resolvedRoot = resolve(root);
  const resolvedObject = resolve(objectPath);
  const rel = relative(resolvedRoot, resolvedObject);
  if (rel.startsWith('..') || rel.includes(`..${sep}`) || rel === '') {
    throw new Error('Invalid media key');
  }
  return { ownerDir, objectPath, sidecarPath };
}

async function removeQuiet(path: string) {
  await unlink(path).catch(() => {});
}

async function unlinkIdempotent(path: string) {
  try {
    await unlink(path);
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : undefined;
    if (code !== 'ENOENT') throw e;
  }
}

function isSafeListKeySegment(segment: string): boolean {
  if (!segment || segment.includes('/') || segment.includes('\\') || segment.includes('\0') || segment.includes('..')) {
    return false;
  }
  return true;
}

function assertPathUnderRoot(resolvedRoot: string, targetPath: string): boolean {
  const rel = relative(resolvedRoot, resolve(targetPath));
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`)) {
    return false;
  }
  return true;
}

async function writeAtomic(filePath: string, data: Buffer) {
  const dir = join(filePath, '..');
  const tmp = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    handle = await open(tmp, 'w', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tmp, filePath);
  } catch (e) {
    if (handle) await handle.close().catch(() => {});
    await removeQuiet(tmp);
    throw e;
  }
}

async function bodyToStream(body: ReadableStream<Uint8Array> | Blob): Promise<ReadableStream<Uint8Array>> {
  if (body instanceof Blob) return body.stream();
  return body;
}

type ChunkSink = {
  write(view: Uint8Array): Promise<{ bytesWritten: number }>;
};

/**
 * Writes a whole chunk to a sink that may accept fewer bytes than offered.
 * Awaiting each write keeps backpressure, and the loop guarantees the stored
 * object matches the counted size even when the filesystem does a short write.
 */
export async function writeAll(sink: ChunkSink, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await sink.write(chunk.subarray(offset));
    if (!(bytesWritten > 0)) {
      throw new Error('Media write made no progress');
    }
    offset += bytesWritten;
  }
}

async function writeBoundedToFile(
  handle: Awaited<ReturnType<typeof open>>,
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<number> {
  const reader = stream.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > limit) {
        throw new Error(storageOversizeMessage(limit));
      }
      await writeAll(handle, value);
    }
  } catch (e) {
    await reader.cancel(e).catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
  return size;
}

async function readSidecar(sidecarPath: string): Promise<Sidecar | null> {
  try {
    const raw = await readFile(sidecarPath, 'utf8');
    return JSON.parse(raw) as Sidecar;
  } catch {
    return null;
  }
}

const TEMP_PREFIXES = ['.obj-', '.meta-', '.tmp-'];

function isTempName(name: string): boolean {
  return TEMP_PREFIXES.some((p) => name.startsWith(p));
}

export type LocalMediaListEntry = {
  key: string;
  kind: 'object' | 'temp';
  createdAt: string | null;
};

/** Lists valid media objects (sidecar + file) and stale temp files by mtime. Not part of MediaStore. */
export async function listLocalMedia(root: string): Promise<LocalMediaListEntry[]> {
  const resolvedRoot = resolve(root);
  const entries: LocalMediaListEntry[] = [];
  let owners: string[];
  try {
    owners = await readdir(resolvedRoot);
  } catch {
    return entries;
  }
  for (const owner of owners) {
    if (owner.startsWith('.')) continue;
    const ownerDir = join(resolvedRoot, owner);
    let names: string[];
    try {
      const st = await stat(ownerDir);
      if (!st.isDirectory()) continue;
      names = await readdir(ownerDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (isTempName(name)) {
        const tempPath = join(ownerDir, name);
        try {
          const st = await stat(tempPath);
          if (!st.isFile()) continue;
          entries.push({
            key: `${owner}/${name}`,
            kind: 'temp',
            createdAt: new Date(st.mtimeMs).toISOString(),
          });
        } catch {
          /* skip */
        }
        continue;
      }
      if (name.endsWith('.json')) continue;
      if (name.startsWith('.')) continue;
      const key = `${owner}/${name}`;
      try {
        parseKey(key);
      } catch {
        continue;
      }
      const sidecarPath = join(ownerDir, `${name}.json`);
      const meta = await readSidecar(sidecarPath);
      let objectOk = false;
      try {
        const st = await stat(join(ownerDir, name));
        objectOk = st.isFile();
      } catch {
        objectOk = false;
      }
      if (!meta || !objectOk) {
        entries.push({ key, kind: 'object', createdAt: null });
        continue;
      }
      const createdAt =
        typeof meta.createdAt === 'string' && meta.createdAt ? meta.createdAt : null;
      entries.push({ key, kind: 'object', createdAt });
    }
  }
  return entries;
}

/** Removes a listed media object or a temp file under root. Not part of MediaStore. */
export async function removeLocalMediaEntry(root: string, key: string): Promise<void> {
  const resolvedRoot = resolve(root);
  const slash = key.indexOf('/');
  if (slash <= 0) return;
  const owner = key.slice(0, slash);
  const rest = key.slice(slash + 1);
  if (!rest || owner.startsWith('.')) return;
  if (!isSafeListKeySegment(owner) || !isSafeListKeySegment(rest)) return;
  if (isTempName(rest)) {
    const tempPath = join(resolvedRoot, owner, rest);
    if (!assertPathUnderRoot(resolvedRoot, tempPath)) return;
    await unlinkIdempotent(tempPath);
    return;
  }
  let objectPath: string;
  let sidecarPath: string;
  try {
    ({ objectPath, sidecarPath } = pathsForKey(resolvedRoot, key));
  } catch {
    return;
  }
  await unlinkIdempotent(objectPath);
  await unlinkIdempotent(sidecarPath);
}

export function createLocalMediaStore(root: string): MediaStore {
  const resolvedRoot = resolve(root);

  return {
    async put(key, body, options?: MediaPutOptions) {
      const { ownerDir, objectPath, sidecarPath } = pathsForKey(resolvedRoot, key);
      const contentType = options?.httpMetadata?.contentType;
      const stream = await bodyToStream(body);
      const objectTmp = join(ownerDir, `.obj-${randomBytes(8).toString('hex')}`);
      const sidecarTmp = join(ownerDir, `.meta-${randomBytes(8).toString('hex')}.json`);
      let objHandle: Awaited<ReturnType<typeof open>> | undefined;
      let objectRenamed = false;
      try {
        await mkdir(ownerDir, { recursive: true, mode: 0o700 });
        objHandle = await open(objectTmp, 'w', 0o600);
        const size = await writeBoundedToFile(objHandle, stream, MAX_MEDIA_BYTES);
        if (size === 0) throw new Error('Empty media object');
        await objHandle.sync();
        await objHandle.close();
        objHandle = undefined;
        const sidecar: Sidecar = {
          size,
          contentType,
          createdAt: new Date().toISOString(),
        };
        await writeAtomic(sidecarTmp, Buffer.from(JSON.stringify(sidecar), 'utf8'));
        await rename(objectTmp, objectPath);
        objectRenamed = true;
        await rename(sidecarTmp, sidecarPath);
      } catch (e) {
        if (objHandle) await objHandle.close().catch(() => {});
        await removeQuiet(objectTmp);
        await removeQuiet(sidecarTmp);
        if (objectRenamed) await removeQuiet(objectPath);
        throw e;
      }
    },

    async get(key): Promise<MediaObjectBody | null> {
      let objectPath: string;
      let sidecarPath: string;
      try {
        ({ objectPath, sidecarPath } = pathsForKey(resolvedRoot, key));
      } catch {
        return null;
      }
      const meta = await readSidecar(sidecarPath);
      if (!meta) return null;
      try {
        const st = await stat(objectPath);
        if (!st.isFile()) return null;
      } catch {
        return null;
      }
      const nodeStream = createReadStream(objectPath);
      return {
        body: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
        size: meta.size,
        httpMetadata: meta.contentType ? { contentType: meta.contentType } : undefined,
      };
    },

    async head(key): Promise<MediaHeadObject | null> {
      let objectPath: string;
      let sidecarPath: string;
      try {
        ({ objectPath, sidecarPath } = pathsForKey(resolvedRoot, key));
      } catch {
        return null;
      }
      const meta = await readSidecar(sidecarPath);
      if (!meta) return null;
      try {
        const st = await stat(objectPath);
        if (!st.isFile()) return null;
      } catch {
        return null;
      }
      return {
        size: meta.size,
        httpMetadata: meta.contentType ? { contentType: meta.contentType } : undefined,
      };
    },

    async delete(key) {
      let objectPath: string;
      let sidecarPath: string;
      try {
        ({ objectPath, sidecarPath } = pathsForKey(resolvedRoot, key));
      } catch {
        return;
      }
      await removeQuiet(objectPath);
      await removeQuiet(sidecarPath);
    },
  };
}
