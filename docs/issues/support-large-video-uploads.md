# Support large video uploads without buffering entire files

## Summary

OpenBulkAds must support the real video workload: files around 150 MB are common, while the current 40 MB application limit rejects both local uploads and Google Drive downloads. Replace the memory-bound transfer path with bounded streaming or multipart storage before raising the limit.

## Current behavior

| Source | Current limit behavior |
|---|---|
| Local upload | The browser rejects files over the shared configurable limit (default 250 MB) before sending them; the upload route streams and storage enforces the actual bytes. |
| Google Drive | The download streams; `Content-Length` is only a streaming hint and storage enforces the actual bytes against the same limit. |
| Local media storage | Writes incrementally to a temp file with backpressure, publishes atomically, and preserves exact size and `0600` permissions. |

Relevant code:

- `lib/batch-core.ts`
- `app/api/upload/route.ts`
- `lib/media-stream.ts`
- `lib/media.ts`
- `lib/media/local.ts`
- `app/workspace.tsx`

## Goal

Allow typical 150 MB videos, up to the selected 250 MB rollout target, to move from local upload or Google Drive through temporary storage and into Meta without loading the complete file into application memory.

## Required design work

1. Define a configurable maximum media size based on operational capacity and upstream Meta constraints.
2. Stream local uploads into the selected media store with backpressure and an enforced byte limit.
3. Stream Google Drive downloads into storage without converting the complete response into a `Blob` in memory.
4. Preserve a known object length for the fixed-length multipart request sent to Meta.
5. Ensure interrupted or rejected transfers remove partial objects.
6. Expose progress and actionable errors for oversized, interrupted, or unsupported uploads.
7. Keep the existing MIME allowlist and owner isolation intact.

## Acceptance criteria

- [x] A local MP4 of at least 150 MB can be uploaded without an out-of-memory failure. Verified by generated 150 MB coverage in `tests/media-storage.test.ts` and `scripts/test-large-media.mjs`.
- [x] A public Google Drive MP4 of at least 150 MB can be downloaded and stored without whole-file buffering. Verified end to end with a generated 150 MB response body.
- [x] The server enforces one documented configurable upper bound for every ingestion path. `NEXT_PUBLIC_MEDIA_LIMIT_MB` (default 250) is read once in `lib/media-limit.ts`.
- [x] Files over that bound fail with a clear size-specific message before downstream Meta creation.
- [x] Empty files and unsupported MIME types remain rejected.
- [x] Interrupted uploads and downloads leave no usable partial media object behind.
- [x] Stored media reports the exact byte length required by the Meta multipart upload.
- [x] Automated tests cover boundary sizes, missing `Content-Length`, interrupted streams, cleanup, and the local storage path.
- [x] The UI reports transfer progress or, at minimum, an explicit in-progress state suitable for large files. Upload guidance now uses the shared 250 MB display value.

## Non-goals

- Video transcoding or compression.
- Supporting arbitrary file formats.
- Persisting media after the existing job-retention lifecycle requires deletion.
- Raising the numeric limit without first removing whole-file memory buffering.

## Decisions recorded

- Active default maximum size: **250 MB**, configurable with `NEXT_PUBLIC_MEDIA_LIMIT_MB` (whole MB). Parsing fails safe to 250 for missing, empty, non-numeric, zero, negative, fractional, or unsafe values. Because Next.js inlines `NEXT_PUBLIC_*` at build time, set it before building: a build-time value keeps the browser and server in agreement, while a runtime-only value would leave the browser at the default.
- Initial transport: **bounded non-resumable streaming**. Interrupted transfers restart from zero; resumable uploads are deferred past the first rollout.
- The 250 MB default is active because local upload, Google Drive download, and local storage all enforce the limit while streaming. No path buffers a complete media file.
- Next.js `experimental.proxyClientMaxBodySize` does **not** apply: this app defines no `proxy`/`middleware`, so Next never clones or buffers the request body. The body-size boundary belongs to the actual reverse proxy.
- The bundled Caddy sets no request-body limit, so no Caddyfile change is needed; an external reverse proxy (for example nginx `client_max_body_size`) must allow more than the configured media limit plus multipart headroom. Documented in `deploy/README.md`.

## Open decisions

- Reverse-proxy body-size limits are documented for the self-hosted stack; revisit if a proxy other than the bundled Caddy is introduced.
- Confirm the effective Meta video limit for every supported upload endpoint before raising the enforced ceiling beyond 250 MB.

## Verification plan

Use generated streams rather than committing large fixtures. Cover one byte below, exactly at, and one byte above the selected limit, plus a representative 150 MB transfer. Measure peak process memory during local and Drive ingestion to demonstrate that it does not scale linearly with file size.

Executed: `tests/media-storage.test.ts` and `tests/media-callers.test.ts` cover the boundaries and a generated 150 MB local/Drive transfer. `scripts/test-large-media.mjs` (`npm run test:large-media`) repeats the 150 MB local check and reports peak RSS for context.
