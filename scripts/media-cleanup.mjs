#!/usr/bin/env node
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..');
const outDir = join(projectRoot, '.build-cache', 'scripts');
const outfile = join(outDir, 'media-cleanup.mjs');

await mkdir(outDir, { recursive: true });
await build({
  entryPoints: [join(here, 'media-cleanup.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  packages: 'external',
  tsconfig: join(projectRoot, 'tsconfig.json'),
});

const result = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: projectRoot,
});
process.exit(result.status ?? 1);
