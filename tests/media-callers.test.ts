import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { MAX_MEDIA_BYTES } from '../lib/media-limit';
import { createLocalMediaStore } from '../lib/media/local';

type MediaCallerFakes = {
  puts: { key: string; contentType?: string; size?: number; body: unknown }[];
  gets: string[];
  store: {
    put: (key: string, body: unknown, options?: { httpMetadata?: { contentType?: string }; size?: number }) => Promise<void>;
    get: (key: string) => Promise<{ body: ReadableStream<Uint8Array>; size: number; httpMetadata?: { contentType?: string } } | null>;
    head: (key: string) => Promise<{ size: number } | null>;
    delete: (key: string) => Promise<void>;
  };
};

const globals = globalThis as typeof globalThis & { mediaCallerFakes: MediaCallerFakes };

const storageVirtual = `export const mediaStore=()=>Promise.resolve(globalThis.mediaCallerFakes.store);`;

const sharedVirtual: Record<string, string> = {
  'media/storage': storageVirtual,
  server: `export const owner=async(r,write)=>{if(write){const o=r.headers.get('origin');if(!o||o!==new URL(r.url).origin)throw Object.assign(new Error('Solicitud de otro origen bloqueada.'),{code:403});}return 'alice';}
export const json=(v,s=200)=>Response.json(v,{status:s});
export const fail=(e)=>Response.json({error:e.message},{status:400});
export const connection=async()=>({token:'t',name:'n',cooldown:0});`,
  'media-stream': `export function multipartStream(body,size,mediaType,type,boundary){const completion=Promise.resolve();return {body,completion};}`,
  'meta-core': `export class MetaError extends Error {}
export const driveUrl=(u)=>u;
export function usageWait(){return 0;}`,
  repositories: `export const repositories=()=>Promise.resolve({connections:{setCooldown:async()=>{}}});`,
};

function jpegObject(size = 8) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0].slice(0, size)));
        c.close();
      },
    }),
    size,
    httpMetadata: { contentType: 'image/jpeg' },
  };
}

function streamOfBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
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

function makeStore() {
  const puts: MediaCallerFakes['puts'] = [];
  const gets: string[] = [];
  const store = {
    async put(key: string, body: unknown, options?: { httpMetadata?: { contentType?: string }; size?: number }) {
      puts.push({ key, contentType: options?.httpMetadata?.contentType, size: options?.size, body });
    },
    async get(key: string) {
      gets.push(key);
      return jpegObject();
    },
    async head(key: string) {
      void key;
      return { size: 8 };
    },
    async delete(key: string) {
      void key;
    },
  };
  return { puts, gets, store };
}

async function bundleEntry(entry: string, extraVirtual: Record<string, string> = {}) {
  const virtual = { ...sharedVirtual, ...extraVirtual };
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [{
      name: 'media-callers-fakes',
      setup(plugin) {
        plugin.onResolve({ filter: /^@\/lib\/media\/storage$/ }, () => ({ path: 'media/storage', namespace: 'mc' }));
        plugin.onResolve({ filter: /^\.\/media\/storage$/ }, () => ({ path: 'media/storage', namespace: 'mc' }));
        plugin.onResolve({ filter: /^@\/lib\/(server|media-stream|meta-core|repositories)$/ }, args => ({ path: args.path.slice(6), namespace: 'mc' }));
        plugin.onResolve({ filter: /^\.\/(server|media-stream|meta-core|repositories)$/ }, args => ({ path: args.path.slice(2), namespace: 'mc' }));
        plugin.onLoad({ filter: /.*/, namespace: 'mc' }, args => ({ contents: virtual[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}

test('upload route put uses mediaStore with owner-prefixed key and contentType', async () => {
  const { puts, store } = makeStore();
  globals.mediaCallerFakes = { puts, gets: [], store };
  const route = await bundleEntry('app/api/upload/route.ts') as { POST: (r: Request) => Promise<Response> };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([9]));
      c.close();
    },
  });
  const response = await route.POST(
    new Request('https://app.test/api/upload', {
      method: 'POST',
      headers: { origin: 'https://app.test', 'content-length': '1', 'content-type': 'image/png' },
      body,
      duplex: 'half',
    } as RequestInit),
  );
  assert.equal(response.status, 200);
  const json = (await response.json()) as { key: string; type: string };
  assert.match(json.key, /^alice\//);
  assert.equal(json.type, 'image/png');
  assert.equal(puts.length, 1);
  assert.equal(puts[0].key, json.key);
  assert.equal(puts[0].contentType, 'image/png');
  assert.equal(puts[0].size, 1);
  assert.ok(puts[0].body instanceof ReadableStream);
});

test('download put uses mediaStore', async () => {
  const { puts, store } = makeStore();
  globals.mediaCallerFakes = { puts, gets: [], store };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(new ReadableStream(), {
      status: 200,
      headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
    });
  try {
    const mod = await bundleEntry('lib/media.ts') as { download: (user: string, url: string) => Promise<string> };
    const key = await mod.download('alice', 'https://drive.test/file');
    assert.match(key, /^alice\//);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].key, key);
    assert.equal(puts[0].size, 3);
    assert.ok(puts[0].body instanceof ReadableStream);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('download follows a valid Google Drive confirmation form', async () => {
  const { puts, store } = makeStore();
  globals.mediaCallerFakes = { puts, gets: [], store };
  const oldFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async (input) => {
    urls.push(String(input));
    if (urls.length === 1) return new Response('<form><input name="id" value="abcdefghijkl"><input name="confirm" value="t"><input name="uuid" value="safe-token"></form>', { status: 200, headers: { 'content-type': 'text/html' } });
    return new Response(streamOfBytes(new Uint8Array([1, 2, 3])), { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': '3' } });
  };
  try {
    const mod = await bundleEntry('lib/media.ts') as { download: (user: string, url: string) => Promise<string> };
    await mod.download('alice', 'https://drive.google.com/uc?export=download&id=abcdefghijkl');
    assert.equal(puts.length, 1);
    assert.match(urls[1], /^https:\/\/drive\.usercontent\.google\.com\/download\?/);
    assert.match(urls[1], /confirm=t/);
    assert.match(urls[1], /uuid=safe-token/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('uploadMeta rejects foreign key before mediaStore get', async () => {
  const { puts, gets, store } = makeStore();
  globals.mediaCallerFakes = { puts, gets, store };
  const mod = await bundleEntry('lib/media.ts') as {
    uploadMeta: (user: string, account: string, key: string, mediaType: string) => Promise<unknown>;
  };
  await assert.rejects(mod.uploadMeta('alice', 'act_1', 'bob/secret', 'image'), /Archivo no autorizado/);
  assert.deepEqual(gets, []);
});

test('uploadMeta get uses mediaStore for owner key', async () => {
  const { puts, gets, store } = makeStore();
  globals.mediaCallerFakes = { puts, gets, store };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ images: { bytes: { hash: 'h' } } }, { status: 200 });
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      uploadMeta: (user: string, account: string, key: string, mediaType: string) => Promise<unknown>;
    };
    await mod.uploadMeta('alice', 'act_1', 'alice/owned-key', 'image');
    assert.deepEqual(gets, ['alice/owned-key']);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('uploadMeta sends videos through Meta resumable chunks instead of one large request', async () => {
  const { puts, gets, store } = makeStore();
  const bytes = new Uint8Array([10, 11, 12, 13, 14]);
  store.get = async (key: string) => {
    gets.push(key);
    return { body: streamOfBytes(bytes), size: bytes.byteLength, httpMetadata: { contentType: 'video/mp4' } };
  };
  globals.mediaCallerFakes = { puts, gets, store };
  const oldFetch = globalThis.fetch;
  const requests: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    if (requests.length === 1) return Response.json({ upload_session_id: 'session-1', video_id: 'video-1', start_offset: '0', end_offset: '3' });
    if (requests.length === 2) return Response.json({ start_offset: '3', end_offset: '5' });
    if (requests.length === 3) return Response.json({ start_offset: '5', end_offset: '5' });
    return Response.json({ success: true });
  };
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      uploadMeta: (user: string, account: string, key: string, mediaType: string) => Promise<{ id: string }>;
    };
    const result = await mod.uploadMeta('alice', 'act_1', 'alice/video-key', 'video');
    assert.equal(result.id, 'video-1');
    assert.equal(requests.length, 4);
    assert.ok(requests.every(request => request.url === 'https://graph-video.facebook.com/v26.0/act_1/advideos'));

    const start = requests[0].init?.body as URLSearchParams;
    assert.equal(start.get('upload_phase'), 'start');
    assert.equal(start.get('file_size'), '5');

    const first = requests[1].init?.body as FormData;
    assert.equal(first.get('upload_phase'), 'transfer');
    assert.equal(first.get('start_offset'), '0');
    assert.deepEqual(new Uint8Array(await (first.get('video_file_chunk') as Blob).arrayBuffer()), bytes.slice(0, 3));

    const second = requests[2].init?.body as FormData;
    assert.equal(second.get('start_offset'), '3');
    assert.deepEqual(new Uint8Array(await (second.get('video_file_chunk') as Blob).arrayBuffer()), bytes.slice(3));

    const finish = requests[3].init?.body as URLSearchParams;
    assert.equal(finish.get('upload_phase'), 'finish');
    assert.equal(finish.get('upload_session_id'), 'session-1');
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('uploadMeta reports malformed Meta responses with status and correct ambiguity', async () => {
  const metaCore = `export class MetaError extends Error {constructor(message,code=0,trace='',ambiguous=false,wait=0){super(message);Object.assign(this,{code,trace,ambiguous,wait});}}
export const driveUrl=(u)=>u; export function usageWait(){return 0;}`;
  for (const [status, ambiguous] of [[400, false], [502, true]] as const) {
    const { puts, store } = makeStore();
    globals.mediaCallerFakes = { puts, gets: [], store };
    const oldFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('<html>proxy error</html>', { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    try {
      const mod = await bundleEntry('lib/media.ts', { 'meta-core': metaCore }) as { uploadMeta: (user: string, account: string, key: string, mediaType: string) => Promise<unknown> };
      await assert.rejects(mod.uploadMeta('alice', 'act_1', 'alice/owned-key', 'image'), (error: Error & { ambiguous?: boolean }) => {
        assert.match(error.message, new RegExp(`HTTP ${status}.*text/html`));
        assert.equal(error.ambiguous, ambiguous);
        return true;
      });
    } finally {
      globalThis.fetch = oldFetch;
    }
  }
});

async function withDownload(
  response: () => Response,
  run: (mod: { download: (user: string, url: string) => Promise<string> }, fakes: MediaCallerFakes) => Promise<void>,
) {
  const { puts, gets, store } = makeStore();
  const fakes: MediaCallerFakes = { puts, gets, store };
  globals.mediaCallerFakes = fakes;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => response();
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      download: (user: string, url: string) => Promise<string>;
    };
    await run(mod, fakes);
  } finally {
    globalThis.fetch = oldFetch;
  }
}

test('download forwards a streamed Drive body and the declared size without buffering', async () => {
  await withDownload(
    () =>
      new Response(streamOfBytes(new Uint8Array([1, 2, 3, 4, 5])), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': '5' },
      }),
    async (mod, fakes) => {
      const key = await mod.download('alice', 'https://drive.test/file');
      assert.equal(fakes.puts.length, 1);
      assert.ok(fakes.puts[0].body instanceof ReadableStream, 'Drive body must stay a stream');
      assert.equal(fakes.puts[0].size, 5);
      assert.match(key, /^alice\//);
    },
  );
});

test('download does not trust missing or invalid Content-Length values', async () => {
  for (const header of [undefined, 'not-a-number', '-4', '', '99999999999999999999']) {
    await withDownload(
      () => {
        const headers: Record<string, string> = { 'content-type': 'video/mp4' };
        if (header !== undefined) headers['content-length'] = header;
        return new Response(streamOfBytes(new Uint8Array([1, 2, 3])), { status: 200, headers });
      },
      async (mod, fakes) => {
        await mod.download('alice', 'https://drive.test/file');
        assert.equal(fakes.puts[0].size, undefined, `Content-Length ${String(header)} must not be trusted`);
        assert.ok(fakes.puts[0].body instanceof ReadableStream);
      },
    );
  }
});

test('download rejects a known oversized Content-Length before storing', async () => {
  await withDownload(
    () =>
      new Response(streamOfBytes(new Uint8Array([1])), {
        status: 200,
        headers: { 'content-type': 'video/mp4', 'content-length': String(MAX_MEDIA_BYTES + 1) },
      }),
    async (mod, fakes) => {
      await assert.rejects(mod.download('alice', 'https://drive.test/file'), /40|limit|supera|MB/i);
      assert.equal(fakes.puts.length, 0);
    },
  );
});

test('download end to end stores the exact size when Content-Length is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oba-callers-'));
  const realStore = createLocalMediaStore(root) as unknown as MediaCallerFakes['store'];
  globals.mediaCallerFakes = { puts: [], gets: [], store: realStore };
  const oldFetch = globalThis.fetch;
  const total = 1_500_000;
  globalThis.fetch = async () =>
    new Response(generatedStream(total, 65536), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      download: (user: string, url: string) => Promise<string>;
    };
    const key = await mod.download('alice', 'https://drive.test/file');
    const got = await realStore.get(key);
    assert.ok(got);
    assert.equal(got!.size, total);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('download end to end ignores an understated Content-Length and stores actual bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oba-callers-under-'));
  const realStore = createLocalMediaStore(root) as unknown as MediaCallerFakes['store'];
  globals.mediaCallerFakes = { puts: [], gets: [], store: realStore };
  const oldFetch = globalThis.fetch;
  const total = 1000;
  globalThis.fetch = async () =>
    new Response(generatedStream(total, 128), {
      status: 200,
      headers: { 'content-type': 'video/mp4', 'content-length': '5' },
    });
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      download: (user: string, url: string) => Promise<string>;
    };
    const key = await mod.download('alice', 'https://drive.test/file');
    const got = await realStore.get(key);
    assert.ok(got);
    assert.equal(got!.size, total);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('download end to end stores an exact 150 MB generated Drive body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oba-callers-150-'));
  const realStore = createLocalMediaStore(root) as unknown as MediaCallerFakes['store'];
  globals.mediaCallerFakes = { puts: [], gets: [], store: realStore };
  const oldFetch = globalThis.fetch;
  const total = 150 * 1024 * 1024;
  globalThis.fetch = async () =>
    new Response(generatedStream(total, 1 << 20), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      download: (user: string, url: string) => Promise<string>;
    };
    const key = await mod.download('alice', 'https://drive.test/file');
    const got = await realStore.get(key);
    assert.ok(got);
    assert.equal(got!.size, total);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('download end to end rejects an interrupted Drive body and leaves no temp files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oba-callers-intr-'));
  const realStore = createLocalMediaStore(root) as unknown as MediaCallerFakes['store'];
  globals.mediaCallerFakes = { puts: [], gets: [], store: realStore };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(interruptedStream(1024, 2), {
      status: 200,
      headers: { 'content-type': 'video/mp4' },
    });
  try {
    const mod = await bundleEntry('lib/media.ts') as {
      download: (user: string, url: string) => Promise<string>;
    };
    await assert.rejects(mod.download('alice', 'https://drive.test/file'), /interrupted/i);
    let entries: string[] = [];
    try {
      entries = await readdir(join(root, 'alice'));
    } catch {
      entries = [];
    }
    for (const name of entries) {
      assert.ok(
        !name.startsWith('.obj-') && !name.startsWith('.meta-') && !name.startsWith('.tmp-'),
        `unexpected temp file: ${name}`,
      );
    }
  } finally {
    globalThis.fetch = oldFetch;
  }
});
