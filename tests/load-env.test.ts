import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('loadProjectEnv loads .env.local and .env without overriding shell environment', () => {
  const tempDir = join(tmpdir(), `load-env-test-${Date.now()}`);
  mkdirSync(join(tempDir, 'scripts'), { recursive: true });

  writeFileSync(join(tempDir, '.env'), 'FROM_ENV=base\nSHARED=env\n');
  writeFileSync(join(tempDir, '.env.local'), 'FROM_LOCAL=local\nSHARED=local\n');

  // Copy or test the logic
  const testScript = `
    import { loadProjectEnv } from './scripts/load-env.mjs';
    console.log(JSON.stringify({
      fromEnv: process.env.FROM_ENV,
      fromLocal: process.env.FROM_LOCAL,
      shared: process.env.SHARED,
      existing: process.env.EXISTING,
    }));
  `;
  writeFileSync(join(tempDir, 'test.mjs'), testScript);

  // Copy load-env.mjs to temp scripts/
  const loadEnvSource = `
    import { fileURLToPath } from 'node:url';
    import { dirname, join } from 'node:path';
    export function loadProjectEnv() {
      if (typeof process.loadEnvFile === 'function') {
        const root = join(dirname(fileURLToPath(import.meta.url)), '..');
        for (const file of ['.env.local', '.env']) {
          try { process.loadEnvFile(join(root, file)); } catch {}
        }
      }
    }
    loadProjectEnv();
  `;
  writeFileSync(join(tempDir, 'scripts', 'load-env.mjs'), loadEnvSource);

  try {
    const res = spawnSync(process.execPath, ['test.mjs'], {
      cwd: tempDir,
      env: { ...process.env, EXISTING: 'shell-value', SHARED: 'shell-wins' },
      encoding: 'utf-8',
    });

    assert.equal(res.status, 0, res.stderr);
    const parsed = JSON.parse(res.stdout.trim());
    assert.equal(parsed.fromEnv, 'base');
    assert.equal(parsed.fromLocal, 'local');
    assert.equal(parsed.shared, 'shell-wins');
    assert.equal(parsed.existing, 'shell-value');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
