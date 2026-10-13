# Private deployment (Caddy + Compose)

This directory holds the reference deployment assets for the self-hosted
OpenBulkAds stack. Caddy is a **deployment recommendation**, not an application
dependency: the app image runs on its own and can sit behind another private
proxy as long as it is given the same configuration.

```
VPN client -- internal HTTPS --> Caddy (this stack) --> app (this stack)
app / migrate --> external PostgreSQL on the separate private VPN/network host
```

- Caddy terminates internal HTTPS with its own CA and is the only published
  service. HTTPS is published on the configured `VPN_BIND_ADDRESS` only.
- The app and the one-shot migration never publish a port. PostgreSQL is never
  published; it lives on the separate private DB host.
- Secrets are mounted as root-only host files. The container entrypoint reads
  them while root and permanently drops gid/uid to `1000` before starting any
  migration or server child. Secret values never enter Compose environment,
  image layers, logs, or tracked files.

## Large media uploads and proxy body size

The app enforces one media size cap shared by the browser and the server:
`NEXT_PUBLIC_MEDIA_LIMIT_MB` (whole megabytes, default 250, fail-safe parsing).
Next.js inlines `NEXT_PUBLIC_*` at **build time**, so always set it before
building. Setting it only at runtime is unsafe: the server can read it while the
already-built browser bundle keeps the 250 MB default, so the UI would disagree
with the enforced cap.

- Local development/build: set it in `.env` (see `.env.example`) before
  `npm run dev` or `npm run build`.
- The Dockerfile declares `ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250` in the builder and
  runner stages, `compose.prod.yaml` forwards the host value to both the build
  arg and the app runtime, and both default to 250. Export the variable before
  building and starting; no manual `--build-arg` is needed:

  ```bash
  export NEXT_PUBLIC_MEDIA_LIMIT_MB=300   # optional; omit for the 250 MB default
  export VPN_BIND_ADDRESS=10.8.0.5
  export MEDIA_HOST_DIR=/var/lib/openbulkads/media
  docker compose -f compose.prod.yaml build
  docker compose -f compose.prod.yaml up -d
  ```

This app defines no Next.js `proxy`/`middleware`, so
`experimental.proxyClientMaxBodySize` does not apply to it, and the bundled
Caddyfile sets no request-body limit. The media cap therefore flows through the
reference stack untouched. If you place a different reverse proxy in front,
raise its request-body limit above the media cap plus multipart form overhead
(for example nginx `client_max_body_size 260m;`), otherwise large uploads are
rejected before reaching the app.

## Host prerequisites

| Variable | Required | Meaning |
| --- | --- | --- |
| `VPN_BIND_ADDRESS` | yes | Private VPN interface address Caddy binds to (for example `10.8.0.5`). Compose fails closed when unset. |
| `MEDIA_HOST_DIR` | yes | Absolute host directory for private media. Compose fails closed when unset. |
| `APP_DOMAIN` | no | Internal domain; defaults to `openbulkads.internal`. |
| `OPENBULKADS_SECRETS_DIR` | no | Root-only host directory holding the secret files; defaults to `./deploy/secrets`. |
| `NEXT_PUBLIC_MEDIA_LIMIT_MB` | no | Whole-MB media cap forwarded to the image build and the app runtime; defaults to `250`. |

Media directory ownership: `MEDIA_HOST_DIR` must be owned by uid/gid `1000`
(the unprivileged `node` account in the image) with restrictive permissions:

```bash
sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/openbulkads/media
```

## Secret files

Create four files, one value each, in the secret directory. Use root-only
permissions and never commit or copy them into the build context:

```bash
sudo install -d -m 0700 /etc/openbulkads/secrets
# Write each value without printing it to the terminal or shell history.
sudo sh -c 'umask 077; printf %s "$VALUE" > /etc/openbulkads/secrets/DATABASE_URL'
sudo chmod 0600 /etc/openbulkads/secrets/*
```

| File | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | app | Least-privilege runtime PostgreSQL credentials. |
| `MIGRATION_DATABASE_URL` | migrate | Dedicated migration credentials; the app never migrates. |
| `BETTER_AUTH_SECRET` | app | At least 32 characters. |
| `TOKEN_ENCRYPTION_KEY` | app | Canonical base64 of exactly 32 bytes. |

The entrypoint rejects empty or NUL-bearing files and never logs their values.

## Build and start

```bash
export VPN_BIND_ADDRESS=10.8.0.5
export MEDIA_HOST_DIR=/var/lib/openbulkads/media
export OPENBULKADS_SECRETS_DIR=/etc/openbulkads/secrets

docker compose -f compose.prod.yaml build
docker compose -f compose.prod.yaml up -d
```

Startup ordering is enforced by Compose:

1. `migrate` runs `--migrate-only` and must exit successfully.
2. `app` starts and reports healthy through the unauthenticated `/api/ready`
   endpoint (`database` and `media` probes).
3. `caddy` starts only once the app is healthy.

The `.dockerignore` excludes `deploy/secrets/`, so the default secret layout
can never enter the Docker build context. For defence in depth, prefer storing
secrets outside the repository (`OPENBULKADS_SECRETS_DIR=/etc/openbulkads/secrets`).

## Internal CA trust

Caddy persists its internal CA under the `caddy_data` volume. Export the root
certificate and trust it on each VPN client:

```bash
docker compose -f compose.prod.yaml exec caddy \
  cat /data/caddy/pki/authorities/local/root.crt > openbulkads-root.crt
```

Add the hostname to the client's DNS (or `/etc/hosts`) so
`https://openbulkads.internal` resolves to `VPN_BIND_ADDRESS`.

## Local validation override

`compose.local.yaml` is explicit and **not auto-loaded** (Compose only
auto-loads `compose.override.yaml`). The reliable local invocation is
explicitly multi-file: `compose.dev.yaml` contributes the existing development
PostgreSQL 16 service to the **same Compose project and default network** as the
production-shaped stack, so app and migrate reach it as `postgres:5432`. No
Docker host gateway is involved. The override resets the `127.0.0.1:5432` host
port inherited from `compose.dev.yaml`, so the smoke database is
internal-only and the stack can run alongside an already-running development
PostgreSQL. The override also binds Caddy to `127.0.0.1`, and replaces the
root-only secret files with development-only non-secret values. Production
defaults, including production secret mounts, are unchanged.

```bash
export VPN_BIND_ADDRESS=127.0.0.1
export MEDIA_HOST_DIR=/tmp/openbulkads-media
docker compose -f compose.prod.yaml -f compose.dev.yaml -f compose.local.yaml config
docker compose -f compose.prod.yaml -f compose.dev.yaml -f compose.local.yaml up
```

The database is never published publicly: the merged stack reaches PostgreSQL
over the shared Compose network by service name, and the inherited dev host
port is reset so the smoke database never binds `5432` on the host.

## Backup and restore

Backups and restores run on the app VPS **host**, never inside the app
container. The host must have `pg_dump`, `pg_restore` and `tar` on `PATH`.

### Credentials and required paths

| Variable | Read from | Meaning |
| --- | --- | --- |
| `BACKUP_DATABASE_URL` | environment, or the root-only file `$OPENBULKADS_SECRET_DIR/BACKUP_DATABASE_URL` | Read-only dump role. |
| `RESTORE_DATABASE_URL` | environment, or the root-only file `$OPENBULKADS_SECRET_DIR/RESTORE_DATABASE_URL` | Separate write role used only by restore. Never falls back to `BACKUP_DATABASE_URL` or `DATABASE_URL`. |
| `BACKUP_DIR` | environment | Absolute snapshot directory outside `MEDIA_ROOT`. |
| `MEDIA_ROOT` | environment | Absolute host media directory. In production this is the same path as `MEDIA_HOST_DIR`. |

`OPENBULKADS_SECRET_DIR` defaults to `/run/secrets`. It is **not** the Compose
variable `OPENBULKADS_SECRETS_DIR`, and neither URL is injected into the app
container. Keep both URLs in the root-only secret files; never print them and
never put them in a crontab line.

### Take a backup

`npm run backup` writes one snapshot directory named for the UTC timestamp
(`YYYYMMDDTHHMMSSZ`) holding `postgres.dump` (PostgreSQL custom format),
`media.tar` and a `manifest.json` that pairs their sha256 values. The snapshot
is published only after both checksums match.

```bash
export BACKUP_DIR=/var/lib/openbulkads/backups
export MEDIA_ROOT="$MEDIA_HOST_DIR"
export OPENBULKADS_SECRET_DIR=/etc/openbulkads/secrets
npm run backup
```

Success prints one JSON line: `{"id":"...","kept":[...],"deleted":[...]}`.
Retention runs automatically after a successful backup:

| Rule | Selects |
| --- | --- |
| 7 daily copies | Newest snapshot on each of the 7 most recent UTC calendar dates that have a snapshot. |
| 4 weekly copies | Newest snapshot on each of the 4 most recent Sundays (UTC) that have a snapshot. |

The union is kept once; every other snapshot is deleted. A Sunday daily run
**is** the weekly copy, so there is no second job.

### Daily cron

Run every day, including Sunday UTC, as a user that can read the root-only
secret files:

```cron
0 2 * * * cd /opt/openbulkads && OPENBULKADS_SECRET_DIR=/etc/openbulkads/secrets BACKUP_DIR=/var/lib/openbulkads/backups MEDIA_ROOT=/var/lib/openbulkads/media /usr/bin/npm run backup >> /var/log/openbulkads-backup.log 2>&1
```

Keep both database URLs in the root-only secret files, not in the crontab line.

### Rehearsal checklist

Rehearse before relying on the backup path:

1. Take a backup and record the `id` from the JSON output.
2. Restore that id **only** against a disposable database and a disposable
   media directory, with `RESTORE_DATABASE_URL`, `BACKUP_DIR` and `MEDIA_ROOT`
   pointing at the throwaway targets.
3. Confirm the restore JSON and that the app can read the restored data.

Never rehearse a restore against production.

## Restore

Stop the app first so it is not writing while the database and media are
replaced:

```bash
docker compose -f compose.prod.yaml stop app
npm run restore -- <YYYYMMDDTHHMMSSZ>
```

`npm run restore` maps to `node scripts/backup-ops.mjs restore`, and npm
forwards arguments after `--`, so the id is passed through. The equivalent
direct form is `node scripts/backup-ops.mjs restore <YYYYMMDDTHHMMSSZ>`. Start
the app again afterwards.

Restore verifies the manifest and both sha256 values **before** `pg_restore`
and **before** anything under `MEDIA_ROOT` changes. Database restore and media
replacement are not one transaction:

- If media replacement fails after `pg_restore` completed, the database is
  already restored and the previous media is unchanged.
- If a swap fails after the old media was moved aside, a
  `MEDIA_ROOT.pre-restore-<id>` copy may remain for manual recovery.

Success prints one JSON line: `{"id":"...","restored":true}`.

## Upgrade

1. Stop writes by stopping the app.
2. Take a backup and record the snapshot id.
3. Update the source and rebuild the image.
4. Bring the stack up; `migrate` applies new migrations before the app starts.
5. Check readiness through `/api/ready`.

The [Build and start](#build-and-start) startup order is unchanged: the one-shot
`migrate` service must exit successfully before `app` starts, and `caddy`
starts only once the app is healthy.

## Rollback

1. Stop the app.
2. Restore the matched snapshot id so database and media come from the same
   snapshot.
3. Deploy the last image verified against that snapshot.

Do not leave a newer migrated schema running on an older snapshot. If the
schema moved forward, restore both the database and the media from the same
snapshot before starting the older image.

## Cleanup and first administrator

- Schedule the daily `npm run media:cleanup` described in
  [docs/architecture/self-hosted.md](../docs/architecture/self-hosted.md).
- Create the first administrator with `npm run admin:create`.
