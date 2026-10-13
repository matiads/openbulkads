#!/usr/bin/env node
// Production startup contract for the self-hosted Node container image.
//
// The image ships the Next.js standalone server. This wrapper:
//   - resolves the container bind address;
//   - bridges root-only host secret files (Compose secrets) into the child
//     environment without ever writing the values to a log;
//   - permanently drops gid/uid to the unprivileged `node` account before it
//     spawns the one-shot migration or the long-running server child;
//   - forwards termination signals and re-raises the child's exit signal.
//
// Direct, non-container runs (already unprivileged, no secret directory) keep
// the previous behavior and simply pass the process environment through.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_HOSTNAME = "0.0.0.0";
export const DEFAULT_PORT = 3000;
// Compose mounts file secrets at /run/secrets; override only for tests.
export const DEFAULT_SECRET_DIR = "/run/secrets";
// The exact, known files the bridge is allowed to read. Anything else is ignored.
export const SECRET_FILE_ENV = Object.freeze([
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "TOKEN_ENCRYPTION_KEY",
]);
// The unprivileged account baked into the runtime image.
export const RUNTIME_UID = 1000;
export const RUNTIME_GID = 1000;

export function parseContainerPort(value) {
  if (value === undefined || value === null || `${value}`.trim() === "") return DEFAULT_PORT;
  const text = `${value}`.trim();
  if (!/^\d+$/.test(text)) {
    throw new Error(`PORT must be an integer between 1 and 65535, received "${value}".`);
  }
  const port = Number(text);
  if (port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, received "${value}".`);
  }
  return port;
}

export function resolveContainerConfig(env = process.env) {
  const hostname = `${env.HOSTNAME ?? ""}`.trim() || DEFAULT_HOSTNAME;
  return { runtime: "node", hostname, port: parseContainerPort(env.PORT) };
}

export function resolveServerEntry(appRoot = APP_ROOT) {
  const candidates = [
    path.join(appRoot, "server.js"),
    path.join(appRoot, ".next", "standalone", "server.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Next.js standalone server entry not found. Checked: ${candidates.join(", ")}. ` +
      "Build the image with NEXT_OUTPUT=standalone.",
  );
}

export function secretDirectory(env = process.env) {
  const configured = `${env.OPENBULKADS_SECRET_DIR ?? ""}`.trim();
  return configured || DEFAULT_SECRET_DIR;
}

// Read one exact secret file. A missing file is not an error (direct usage must
// keep working from the process environment); empty or NUL-bearing files fail
// closed so a malformed mount never silently produces a bad credential.
export function readSecretFile(filePath, readFile = readFileSync) {
  let raw;
  try {
    raw = readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return undefined;
    throw error;
  }
  const value = `${raw}`.replace(/\r?\n$/, "");
  if (value.length === 0) throw new Error(`Secret file ${filePath} is empty`);
  if (value.includes("\0")) throw new Error(`Secret file ${filePath} contains a NUL byte`);
  return value;
}

// Collect the known secret files into a plain object. Values are only ever
// returned here and placed in the child environment; they are never logged.
export function loadSecretEnv({
  env = process.env,
  secretDir = secretDirectory(env),
  readFile = readFileSync,
} = {}) {
  const secrets = {};
  for (const name of SECRET_FILE_ENV) {
    const value = readSecretFile(path.join(secretDir, name), readFile);
    if (value !== undefined) secrets[name] = value;
  }
  return secrets;
}

export function buildChildEnv(base, secrets, overrides = {}) {
  return { ...base, ...secrets, ...overrides };
}

// Permanently drop the process to the unprivileged runtime account. No-op when
// already unprivileged so direct container-less runs keep working.
export function dropPrivileges({
  uid = RUNTIME_UID,
  gid = RUNTIME_GID,
  getuid = process.getuid,
  setgroups = process.setgroups,
  setgid = process.setgid,
  setuid = process.setuid,
} = {}) {
  if (typeof getuid !== "function" || getuid() !== 0) return false;
  if (typeof setgroups === "function") setgroups([]);
  setgid(gid);
  setuid(uid);
  return true;
}

function printConfig() {
  const config = resolveContainerConfig();
  process.stdout.write(`${JSON.stringify(config)}\n`);
}

function runChild(entry, args, env) {
  const child = spawn(process.execPath, [entry, ...args], { stdio: "inherit", env });
  const onSigterm = () => child.kill("SIGTERM");
  const onSigint = () => child.kill("SIGINT");
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      if (signal) {
        // Drop our forwarding handlers before re-raising so the signal is not
        // intercepted again and the wrapper terminates with the child's status.
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

async function start() {
  const config = resolveContainerConfig();
  const entry = resolveServerEntry();
  // Read the root-only secret files first; only then drop privileges.
  const secrets = loadSecretEnv();
  const env = buildChildEnv(process.env, secrets, {
    NODE_ENV: "production",
    HOSTNAME: config.hostname,
    PORT: `${config.port}`,
  });
  dropPrivileges();
  return runChild(entry, [], env);
}

async function migrateOnly() {
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), "container-migrate.mjs");
  const secrets = loadSecretEnv();
  const env = buildChildEnv(process.env, secrets);
  dropPrivileges();
  return runChild(entry, [], env);
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help")) {
    process.stdout.write(
      `Usage: node scripts/container-start.mjs [--print-config] [--migrate-only] [--help]\n\n` +
        `Starts the Next.js standalone server (HOSTNAME=${DEFAULT_HOSTNAME}, PORT=${DEFAULT_PORT}).\n` +
        `--migrate-only applies MIGRATION_DATABASE_URL migrations and exits without starting the server.\n`,
    );
    return;
  }
  if (argv.includes("--print-config")) {
    printConfig();
    return;
  }
  if (argv.includes("--migrate-only")) {
    process.exit(await migrateOnly());
  }
  process.exit(await start());
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const selfPath = fileURLToPath(import.meta.url);
// Guard against running when this module is bundled into another entry point
// (for example the test bundle), where `import.meta.url` is the importer.
if (path.basename(selfPath) === "container-start.mjs" && invokedPath === selfPath) {
  main().catch((error) => {
    console.error(`container-start: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
