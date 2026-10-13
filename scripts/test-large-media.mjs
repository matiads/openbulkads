// Deterministic large-media check. Generates a 150 MB stream from in-memory
// chunks (no committed fixture) and verifies the local media store writes the
// exact byte length to disk while streaming (never buffering the whole body).
// Peak RSS is reported for context only.
// Run: node scripts/test-large-media.mjs
import { mkdtemp, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';

const SIZE = 150 * 1024 * 1024;

function generatedStream(total, chunkSize = 1 << 20) {
  let sent = 0;
  return new ReadableStream({
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

async function load(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'large-media-alias',
        setup(plugin) {
          plugin.onResolve({ filter: /^@\/lib\/media-limit$/ }, () => ({
            path: join(process.cwd(), 'lib/media-limit.ts'),
          }));
        },
      },
    ],
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
  );
}

const { createLocalMediaStore } = await load('lib/media/local.ts');

// Local store: the exact 150 MB must land on disk.
const root = await mkdtemp(join(tmpdir(), 'oba-large-media-'));
const store = createLocalMediaStore(root);
await store.put('video/large', generatedStream(SIZE), {
  httpMetadata: { contentType: 'video/mp4' },
});
const head = await store.head('video/large');
if (!head || head.size !== SIZE) {
  throw new Error(`local store size mismatch: ${head ? head.size : 'none'}`);
}
const onDisk = await stat(join(root, 'video', 'large'));
if (onDisk.size !== SIZE) {
  throw new Error(`local file size mismatch: ${onDisk.size}`);
}

console.log(
  JSON.stringify(
    {
      localBytes: onDisk.size,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    },
    null,
    2,
  ),
);
