import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Load project environment variables for standalone CLI scripts when running
// directly with Node. Next.js loads these automatically for the web server,
// but standalone scripts (db:migrate, admin:create, db:check) need this so the
// developer does not have to manually export variables in their shell.
export function loadProjectEnv() {
  if (typeof process.loadEnvFile === 'function') {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    // Load .env.local first (higher precedence), then .env (fallback).
    // process.loadEnvFile does not overwrite existing process.env variables.
    for (const file of ['.env.local', '.env']) {
      try {
        process.loadEnvFile(join(root, file));
      } catch {}
    }
  }
}

loadProjectEnv();
