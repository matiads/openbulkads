// Single contract for the media size limit. Every ingestion path and the
// browser UI compare against these helpers instead of hard-coding a byte count,
// so one configured value drives enforcement and user-facing messages.

const BYTES_PER_MB = 1024 * 1024;

/** Documented default used when no valid limit is configured. */
export const DEFAULT_MEDIA_LIMIT_MB = 250;

/**
 * Parse a configured whole-megabyte limit. Missing, empty, non-numeric, zero,
 * negative, fractional, or unsafe values all fail safe to the default so a
 * malformed deployment setting can never widen or crash the enforcement.
 */
export function parseMediaLimitMb(raw: string | undefined | null): number {
  if (raw === undefined || raw === null) return DEFAULT_MEDIA_LIMIT_MB;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_MEDIA_LIMIT_MB;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MEDIA_LIMIT_MB;
}

// `NEXT_PUBLIC_*` is inlined at build time by Next.js into both the browser
// bundle and the server, so one build-time value drives the UI text and the
// ingestion enforcement. When the variable is unset, both sides fall back to
// the 250 MB default; browser bundles without a `process` global provide an
// empty `process.env`, so this stays loadable.
const configuredMediaLimitMb = process.env.NEXT_PUBLIC_MEDIA_LIMIT_MB;

/** Configured limit in whole megabytes. */
export const MAX_MEDIA_MB = parseMediaLimitMb(configuredMediaLimitMb);

/** Configured limit in bytes; the value every ingestion path enforces. */
export const MAX_MEDIA_BYTES = MAX_MEDIA_MB * BYTES_PER_MB;

/** Display a byte limit as whole megabytes for user-facing messages. */
export function mediaLimitMb(limitBytes: number = MAX_MEDIA_BYTES): number {
  return Math.floor(limitBytes / BYTES_PER_MB);
}

/** True when a non-empty size fits within the active (or supplied) limit. */
export function isWithinMediaLimit(size: number, limitBytes: number = MAX_MEDIA_BYTES): boolean {
  return size > 0 && size <= limitBytes;
}

/** Spanish message when a downloaded or streamed body crosses the limit. */
export function oversizeMessage(limitBytes: number = MAX_MEDIA_BYTES): string {
  return `El archivo supera ${mediaLimitMb(limitBytes)} MB.`;
}

/** Spanish message for domain validation of a named upload file. */
export function fileSizeRangeMessage(name: string, limitBytes: number = MAX_MEDIA_BYTES): string {
  return `${name}: el archivo debe pesar entre 1 byte y ${mediaLimitMb(limitBytes)} MB.`;
}

/** Spanish message for the local upload route when `Content-Length` is too large. */
export function uploadTooLargeMessage(limitBytes: number = MAX_MEDIA_BYTES): string {
  return `El archivo debe pesar menos de ${mediaLimitMb(limitBytes)} MB.`;
}

/** Internal English message when a media store rejects an oversized body. */
export function storageOversizeMessage(limitBytes: number = MAX_MEDIA_BYTES): string {
  return `Media exceeds the ${mediaLimitMb(limitBytes)} MB limit`;
}
