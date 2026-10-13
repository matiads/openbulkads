#!/usr/bin/env node
// Host-side backup and restore tooling for the self-hosted deployment.
//
// This command runs on the app VPS host, never inside the app container. It
// produces one self-describing snapshot directory that pairs a PostgreSQL
// custom archive with a tar of the host media root, then prunes the backup
// directory to 7 daily and 4 weekly copies (a weekly copy is the Sunday run).
//
// Credentials are read from the environment or a root-only secret file and are
// only ever passed to child processes through PG* environment variables. The
// URL and its password are never placed in argv, written to a manifest, or
// printed on success or failure.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSecretFile, secretDirectory } from "./container-start.mjs";

export const BACKUP_URL_ENV = "BACKUP_DATABASE_URL";
export const RESTORE_URL_ENV = "RESTORE_DATABASE_URL";
export const DEFAULT_SECRET_DIR = "/run/secrets";
export const MANIFEST_VERSION = 1;
export const DAILY_KEEP = 7;
export const WEEKLY_KEEP = 4;

const SNAPSHOT_ID_RE = /^\d{8}T\d{6}Z$/;
const CHECKSUM_RE = /^[0-9a-f]{64}$/;
const INCOMPLETE_PREFIX = ".incomplete-";
const RESTORE_STAGING_PREFIX = ".restore-";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// Default runner: a real child process with no shell. The URL is never placed
// in argv; callers pass connection fields through the environment.
export function defaultRun({ command, args, env, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      env,
      cwd,
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.once("error", reject);
    child.once("close", code => resolve({ code: code ?? 1 }));
  });
}

function toDate(now) {
  const value = typeof now === "function" ? now() : now;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  return new Date(value);
}

// Read one command URL from the environment or the root-only secret file of the
// exact same name. An explicit URL never falls back to the other command's URL.
export function resolveCommandDatabaseUrl({
  name,
  env = process.env,
  secretDir = secretDirectory(env),
  readFile: readFileImpl = readFileSync,
} = {}) {
  const fromEnv = env[name];
  if (fromEnv !== undefined && fromEnv !== null && `${fromEnv}`.trim() !== "") {
    return `${fromEnv}`.trim();
  }
  const filePath = path.join(secretDir, name);
  const value = readSecretFile(filePath, readFileImpl);
  if (value === undefined) {
    throw new Error(`${name} is required; provide it in the environment or in ${filePath}`);
  }
  return value;
}

// Parse a PostgreSQL URL into the individual connection fields used by PG*.
export function parseDatabaseUrl(raw) {
  let url;
  try {
    url = new URL(`${raw}`);
  } catch {
    throw new Error("database URL is not a valid URL");
  }
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.pathname.length < 2
  ) {
    throw new Error("database URL must be a PostgreSQL URL with credentials, host and database");
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };
}

function requireAbsoluteDir(value, name) {
  const text = `${value ?? ""}`.trim();
  if (text === "") {
    throw new Error(`${name} is required and must be an absolute path`);
  }
  if (!path.isAbsolute(text)) {
    throw new Error(`${name} must be an absolute path, received "${text}"`);
  }
  return text;
}

function isWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// Connection environment for a child process. The command URL is stripped so a
// stray dump of the child environment cannot reveal it.
function connectionEnv(baseEnv, parsed) {
  const env = { ...baseEnv };
  delete env[BACKUP_URL_ENV];
  delete env[RESTORE_URL_ENV];
  delete env.PGHOST;
  delete env.PGPORT;
  delete env.PGUSER;
  delete env.PGPASSWORD;
  delete env.PGDATABASE;
  env.PGHOST = parsed.host;
  env.PGPORT = `${parsed.port}`;
  env.PGUSER = parsed.user;
  env.PGPASSWORD = parsed.password;
  env.PGDATABASE = parsed.database;
  return env;
}

// Environment for the media tar child process. Unlike pg_dump/pg_restore, tar
// has no use for database credentials, so none are inherited from the host or
// from the command environment. This keeps the archive tool from ever seeing
// the URL or the PG* secrets.
function mediaEnv(baseEnv) {
  const env = { ...baseEnv };
  delete env[BACKUP_URL_ENV];
  delete env[RESTORE_URL_ENV];
  delete env.PGHOST;
  delete env.PGPORT;
  delete env.PGUSER;
  delete env.PGPASSWORD;
  delete env.PGDATABASE;
  return env;
}

export function snapshotIdFrom(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function parseSnapshotId(id) {
  if (!SNAPSHOT_ID_RE.test(`${id}`)) return null;
  return Date.UTC(
    Number(id.slice(0, 4)),
    Number(id.slice(4, 6)) - 1,
    Number(id.slice(6, 8)),
    Number(id.slice(9, 11)),
    Number(id.slice(11, 13)),
    Number(id.slice(13, 15)),
  );
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function runChecked(run, spec, label) {
  let result;
  try {
    result = await run(spec);
  } catch (error) {
    throw new Error(`${label} could not be started`, { cause: error });
  }
  const code = typeof result === "number" ? result : result?.code;
  if (code !== 0) {
    throw new Error(`${label} failed with exit code ${code}`);
  }
  return result;
}

export async function listSnapshotIds(backupDir) {
  let entries;
  try {
    entries = await readdir(backupDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isDirectory() && SNAPSHOT_ID_RE.test(entry.name))
    .map(entry => entry.name)
    .sort();
}

// Retention evaluated in UTC against `nowMs`: keep the newest snapshot on each
// of the 7 most recent calendar dates that have a snapshot, plus the newest
// snapshot on each of the 4 most recent Sundays that have a snapshot. The
// union is kept once; every other eligible snapshot is deleted.
export function planRetention(snapshots, nowMs = Date.now()) {
  const parsed = [];
  for (const entry of snapshots ?? []) {
    const id = typeof entry === "string" ? entry : entry?.id;
    const ms =
      typeof entry === "object" && entry?.at != null ? Number(entry.at) : parseSnapshotId(id);
    if (!id || ms == null || !Number.isFinite(ms)) continue;
    if (ms > nowMs) continue;
    parsed.push({ id, ms });
  }

  const newestByDate = new Map();
  const newestBySunday = new Map();
  for (const snapshot of parsed) {
    const dateKey = snapshot.id.slice(0, 8);
    const currentDate = newestByDate.get(dateKey);
    if (!currentDate || snapshot.ms > currentDate.ms) newestByDate.set(dateKey, snapshot);
    if (new Date(snapshot.ms).getUTCDay() === 0) {
      const currentSunday = newestBySunday.get(dateKey);
      if (!currentSunday || snapshot.ms > currentSunday.ms) {
        newestBySunday.set(dateKey, snapshot);
      }
    }
  }

  const dailyKeep = new Set(
    [...newestByDate.keys()]
      .sort()
      .reverse()
      .slice(0, DAILY_KEEP)
      .map(key => newestByDate.get(key).id),
  );
  const weeklyKeep = new Set(
    [...newestBySunday.keys()]
      .sort()
      .reverse()
      .slice(0, WEEKLY_KEEP)
      .map(key => newestBySunday.get(key).id),
  );

  const kept = parsed
    .map(snapshot => snapshot.id)
    .filter(id => dailyKeep.has(id) || weeklyKeep.has(id))
    .sort();
  const keptSet = new Set(kept);
  const deleted = parsed
    .map(snapshot => snapshot.id)
    .filter(id => !keptSet.has(id))
    .sort();
  return { kept, deleted };
}

// Load a manifest and verify that the paired files exist and match their
// recorded checksums. Any failure throws before the caller can mutate state.
export async function verifySnapshot({ snapshotDir, expectedId } = {}) {
  const manifestPath = path.join(`${snapshotDir}`, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new Error(`snapshot manifest is missing or invalid: ${manifestPath}`);
  }
  if (manifest?.version !== MANIFEST_VERSION) {
    throw new Error(`snapshot manifest version must be ${MANIFEST_VERSION}`);
  }
  if (expectedId !== undefined && manifest.id !== expectedId) {
    throw new Error("snapshot manifest id does not match the requested snapshot");
  }
  if (manifest.database?.file !== "postgres.dump" || manifest.media?.file !== "media.tar") {
    throw new Error("snapshot manifest must pair postgres.dump and media.tar");
  }
  if (!CHECKSUM_RE.test(`${manifest.database?.sha256}`) || !CHECKSUM_RE.test(`${manifest.media?.sha256}`)) {
    throw new Error("snapshot manifest checksums are invalid");
  }
  const databasePath = path.join(`${snapshotDir}`, "postgres.dump");
  const mediaPath = path.join(`${snapshotDir}`, "media.tar");
  if (!(await exists(databasePath)) || !(await exists(mediaPath))) {
    throw new Error("snapshot is incomplete: both postgres.dump and media.tar are required");
  }
  const [databaseSha, mediaSha] = await Promise.all([
    sha256File(databasePath),
    sha256File(mediaPath),
  ]);
  if (databaseSha !== manifest.database.sha256 || mediaSha !== manifest.media.sha256) {
    throw new Error("snapshot checksum mismatch");
  }
  return { manifest, databasePath, mediaPath };
}

export async function pruneBackups({ backupDir, nowMs = Date.now() } = {}) {
  const ids = await listSnapshotIds(backupDir);
  const plan = planRetention(ids, nowMs);
  for (const id of plan.deleted) {
    await rm(path.join(backupDir, id), { recursive: true, force: true });
  }
  return plan;
}

// Back up PostgreSQL and the media root into one snapshot directory. The
// snapshot is built under a dot-prefixed incomplete directory and renamed to
// its final id only after the manifest and checksums validate.
export async function runBackup({
  env = process.env,
  now = () => new Date(),
  run = defaultRun,
  secretDir = secretDirectory(env),
  readFile: readFileImpl = readFileSync,
} = {}) {
  const rawUrl = resolveCommandDatabaseUrl({
    name: BACKUP_URL_ENV,
    env,
    secretDir,
    readFile: readFileImpl,
  });
  const parsed = parseDatabaseUrl(rawUrl);
  const backupDir = requireAbsoluteDir(env.BACKUP_DIR, "BACKUP_DIR");
  const mediaRoot = requireAbsoluteDir(env.MEDIA_ROOT, "MEDIA_ROOT");
  const nowDate = toDate(now);
  const nowMs = nowDate.getTime();
  const id = snapshotIdFrom(nowDate);

  await mkdir(backupDir, { recursive: true });
  const incompleteDir = path.join(backupDir, `${INCOMPLETE_PREFIX}${id}`);
  await rm(incompleteDir, { recursive: true, force: true });
  await mkdir(incompleteDir, { recursive: true });

  try {
    const databasePath = path.join(incompleteDir, "postgres.dump");
    const mediaPath = path.join(incompleteDir, "media.tar");
    const childEnv = connectionEnv(env, parsed);

    await runChecked(
      run,
      {
        command: "pg_dump",
        args: ["--format=custom", `--file=${databasePath}`, "--no-password"],
        env: childEnv,
        shell: false,
      },
      "pg_dump",
    );
    await runChecked(
      run,
      {
        command: "tar",
        args: ["-C", mediaRoot, "-cf", mediaPath, "."],
        env: mediaEnv(env),
        shell: false,
      },
      "tar",
    );

    const manifest = {
      version: MANIFEST_VERSION,
      id,
      createdAt: nowDate.toISOString(),
      database: { file: "postgres.dump", sha256: await sha256File(databasePath) },
      media: { file: "media.tar", sha256: await sha256File(mediaPath) },
    };
    await writeFile(
      path.join(incompleteDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    await verifySnapshot({ snapshotDir: incompleteDir, expectedId: id });
    await rename(incompleteDir, path.join(backupDir, id));
  } catch (error) {
    await rm(incompleteDir, { recursive: true, force: true });
    throw error;
  }

  const plan = await pruneBackups({ backupDir, nowMs });
  return { id, kept: plan.kept, deleted: plan.deleted };
}

// Replace MEDIA_ROOT with the extracted staging directory, keeping a
// recoverable pre-restore copy of the old contents if the swap cannot complete.
async function replaceMediaRoot({ mediaRoot, staged, id }) {
  const preRestore = `${mediaRoot}.pre-restore-${id}`;
  const hadMedia = await exists(mediaRoot);
  if (hadMedia) {
    await rm(preRestore, { recursive: true, force: true });
    await rename(mediaRoot, preRestore);
  }
  try {
    await rename(staged, mediaRoot);
  } catch (error) {
    if (hadMedia) {
      // Best effort: put the original back so the host is not left without
      // media. If this also fails, preRestore remains as the recoverable copy.
      try {
        await rename(preRestore, mediaRoot);
      } catch {
        // keep the pre-restore copy in place for manual recovery
      }
    }
    throw error;
  }
  if (hadMedia) {
    await rm(preRestore, { recursive: true, force: true });
  }
}

// Restore a verified snapshot. The manifest and both checksums are validated
// before pg_restore runs or anything under MEDIA_ROOT changes. Media is
// extracted to a staging directory outside MEDIA_ROOT first.
export async function runRestore({
  id,
  env = process.env,
  run = defaultRun,
  secretDir = secretDirectory(env),
  readFile: readFileImpl = readFileSync,
} = {}) {
  if (!id || `${id}`.trim() === "") {
    throw new Error("restore requires a snapshot id");
  }
  const snapshotId = `${id}`.trim();
  // Reject anything that is not an exact snapshot id before paths, secrets or
  // child processes are touched, so a traversal id can never reach
  // path.join/verifySnapshot and fail closed without echoing a URL.
  if (parseSnapshotId(snapshotId) === null) {
    throw new Error("restore snapshot id must match YYYYMMDDTHHMMSSZ");
  }
  const rawUrl = resolveCommandDatabaseUrl({
    name: RESTORE_URL_ENV,
    env,
    secretDir,
    readFile: readFileImpl,
  });
  const parsed = parseDatabaseUrl(rawUrl);
  const backupDir = requireAbsoluteDir(env.BACKUP_DIR, "BACKUP_DIR");
  const mediaRoot = requireAbsoluteDir(env.MEDIA_ROOT, "MEDIA_ROOT");
  if (isWithin(mediaRoot, backupDir)) {
    throw new Error("BACKUP_DIR must be outside MEDIA_ROOT so restore staging never touches media");
  }
  const snapshotDir = path.join(backupDir, snapshotId);

  const { databasePath, mediaPath } = await verifySnapshot({
    snapshotDir,
    expectedId: snapshotId,
  });

  const childEnv = connectionEnv(env, parsed);
  await runChecked(
    run,
    {
      command: "pg_restore",
      args: [
        "--format=custom",
        "--clean",
        "--if-exists",
        "--no-owner",
        `--dbname=${parsed.database}`,
        databasePath,
      ],
      env: childEnv,
      shell: false,
    },
    "pg_restore",
  );

  const staging = await mkdtemp(path.join(backupDir, RESTORE_STAGING_PREFIX));
  try {
    await runChecked(
      run,
      {
        command: "tar",
        args: ["-C", staging, "-x", "-f", mediaPath],
        env: mediaEnv(env),
        shell: false,
      },
      "tar",
    );
    await replaceMediaRoot({ mediaRoot, staged: staging, id: snapshotId });
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  return { id: snapshotId, restored: true };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const [command, snapshotId] = argv;
  if (command === "backup") {
    const result = await runBackup(deps);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "restore") {
    if (!snapshotId) throw new Error("restore requires a snapshot id");
    const result = await runRestore({ ...deps, id: snapshotId });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error("usage: node scripts/backup-ops.mjs backup | restore <snapshot-id>");
}

const selfPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (path.basename(selfPath) === "backup-ops.mjs" && invokedPath === selfPath) {
  main().catch(error => {
    console.error(`backup-ops: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
