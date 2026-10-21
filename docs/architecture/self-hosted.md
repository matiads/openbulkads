# Self-hosted architecture

OpenBulkAds is an independent, self-hosted product built on the official Next.js
Node.js runtime, Better Auth (closed registration), PostgreSQL/Drizzle, and
private persistent local media. The supported deployment runs **behind a private
network/VPN**, never as a public SaaS. Publishing a single instance under a
public domain is an advanced, operator-owned option; its minimum requirements
are in [SECURITY.md](../../SECURITY.md#alcance).

## Scope and behavior contract

| In scope | Out of scope |
| --- | --- |
| A private deployment that preserves the validated workspace, API responses, Meta operations, and recoverable jobs. | A public SaaS, public sign-up, or multi-tenant hosting. |
| Replaceable identity, persistence, media, and runtime boundaries that keep platform APIs out of the domain logic. | Multi-replica execution or external object storage in the initial release. |

**Invariants:** the Spanish UI and error behavior, request/response shapes,
validation limits (including the configurable 250 MB media cap enforced while
streaming), per-owner isolation, Meta cooldowns, token encryption, idempotent
job creation, claim/retry and uncertain-outcome recovery, and same-origin checks
on mutations. Authentication does not replace authorization. A passing build is
not proof of browser parity — verify over the VPN in a real browser.

## Target topology and trust boundaries

```text
VPN client -- internal HTTPS --> private reverse proxy --> Next.js Node app (app VPS)
                                                       |-- persistent private media volume
                                                       `-- private DB connection --> PostgreSQL (separate VPS)
                                              app --> Meta/Drive outbound HTTPS
```

- Only VPN clients reach the proxy. Bind application and PostgreSQL ports to
  private interfaces/firewall rules, never public ingress.
- Terminate internal HTTPS at the proxy, forward trusted host/proto headers only
  from that proxy, and set secure session cookies for the canonical internal
  origin.
- The bundled Caddy sets no request-body limit, so the 250 MB media cap flows
  through it. Any external reverse proxy placed in front must allow bodies larger
  than the configured media limit plus multipart headroom.
- PostgreSQL accepts only the app VPS identity/network, with least-privilege
  application credentials and separately controlled migration privileges.
- Media is never served as an unauthenticated static directory.
- Protect backups, database, volume, encryption key, and auth signing key
  independently. No credentials in the repository, logs, or image layers.
- Outbound Drive fetches retain URL validation, download bounds, and timeouts;
  Meta calls retain retry/cooldown behavior.

## Boundaries and adapters

| Boundary | Contract and adapter |
| --- | --- |
| Identity | Better Auth on Node with persistent PostgreSQL sessions. Registration is disabled; users are provisioned through an administrator-only flow (`npm run admin:create`), never public sign-up. The authenticated stable local user ID is resolved server-side for pages and API; a missing session returns 401. Every owner lookup/write is scoped to that ID, same-origin mutation guards and safe relative post-login redirects are preserved, and caller-supplied owner headers are never trusted. See `app/auth-paths.ts`, `app/page.tsx`, and `lib/server.ts`. |
| Repositories | PostgreSQL schema with the Drizzle `node-postgres` adapter and migrations for users/sessions plus domain connections, settings, presets, and jobs. An explicit repository interface covers owner-scoped reads/writes, atomic claims, transactions/batches, uniqueness, and monotonic cooldown updates, preserving stored job payload/state semantics and timestamp units. See `db/postgres/` and `lib/repositories/`. |
| Media | A private app-VPS volume outside the web root. The adapter supports put/get/head/delete with opaque owner-prefixed keys, size/content-type metadata, and bounded streaming. Keys are generated server-side, ownership is verified before access, path traversal/symlinks are rejected, writes are atomic temp-to-final with restrictive permissions, and incomplete files are removed on failure. Media is deleted on successful job completion, and a bounded scheduled cleanup removes expired unreferenced uploads without ever deleting media required by pending/retryable jobs. See `lib/media/`, `lib/media-stream.ts`, and `app/api/upload/route.ts`. |
| Runtime/config | The official Next.js Node production server/build. Server-only environment is validated once at startup and fails closed for absent keys, DB, or volume. Variables: canonical internal app URL, Better Auth secret, PostgreSQL connection URL, token-encryption key, and `MEDIA_ROOT` (absolute private volume path). The non-secret media size cap, `NEXT_PUBLIC_MEDIA_LIMIT_MB`, is the one intentional build-time value (whole MB, default 250, fail-safe parsing) because the browser and server must agree on it; the Dockerfile declares it as a build `ARG` consumed as `ENV` before `next build` and repeats it in the runner stage, and `compose.prod.yaml` forwards the same host value to both the image build and the app runtime. Sensitive variables are supplied via a secret store/env injection and never exposed as `NEXT_PUBLIC_*`. |
| Deployment | The app VPS runs the proxy + a single Node app instance with a durable media mount; the DB VPS runs PostgreSQL with private connectivity. Health/readiness checks the app, DB, and writable media separately, and reviewed migrations run before switching the app version. `npm run media:cleanup` is scheduled at least daily (cron/systemd timer) with the same `DATABASE_URL` and `MEDIA_ROOT` as the app. See [deploy/README.md](../../deploy/README.md). |

## Media size and streaming

`NEXT_PUBLIC_MEDIA_LIMIT_MB` (whole MB, default 250, fail-safe parsing) is the
single media cap shared by the browser and the server. Local uploads and public
Google Drive downloads are streamed with backpressure into a bounded temp file
and published atomically, preserving the exact byte length and `0600`
permissions. Images are sent to Meta with an exact-length multipart request;
large videos use Meta's resumable `start`/`transfer`/`finish` protocol to avoid
the monolithic POST limit. No path buffers a complete media file in memory.

Automated coverage: `npm test` runs the bundled media-storage, media-callers,
media-retention, and media-cooldown suites; `npm run test:large-media` generates
a 150 MB transfer and reports peak RSS for context.

## Backups, cleanup, and operations

- **Backups** run on the app VPS host (never inside the container) as a paired
  PostgreSQL custom dump plus media archive with a checksum manifest. Separate
  read-only dump and write-only restore roles are used, and neither URL is
  injected into the app container. Rehearse a restore against a disposable
  database and media directory before relying on it.
- **Cleanup** removes orphan uploads older than 24 hours with no reference from a
  non-`done` job; media tied to pending, working, waiting, failed, or uncertain
  jobs is never deleted.
- Backup, restore, upgrade, and rollback procedures live in
  [deploy/README.md](../../deploy/README.md).

A code rollback does not reverse persisted schema or media. Take a recoverable,
consistent DB + media snapshot before each stateful change, and restore both from
the same snapshot when rolling back.

## Deferred decisions

- **External object storage (MinIO/S3):** consider only when volume durability,
  off-host replication, or scale requires it; retain the media contract.
- **Multi-replica:** defer until shared media, distributed job claims/cleanup
  ownership, and session consistency are proven.
- **Supported public exposure:** making a public domain a supported deployment
  requires a separate security review for ingress, abuse/rate limits,
  provisioning, and operations. Until then the VPN is the supported boundary
  and public domains remain operator-owned (see SECURITY.md).
