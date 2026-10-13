const TOKEN_KEY_ERROR = 'La clave de cifrado del servidor no es una clave AES de 32 bytes en base64.';

// Canonical standard base64 of exactly 32 bytes is 43 data characters plus a
// single '=' pad. `atob` is deliberately lenient (it ignores whitespace and
// accepts unpadded or URL-safe input), so anchor the shape, decode the bytes,
// and re-encode to reject every non-canonical spelling (including non-zero
// trailing pad bits and alternate padding).
const TOKEN_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;

export function isCanonicalTokenKey(value: string): boolean {
  if (!TOKEN_KEY_PATTERN.test(value)) return false;
  try {
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (bytes.length !== 32) return false;
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary) === value;
  } catch {
    return false;
  }
}

// The self-hosted Node runtime reads its key from the process environment. An
// absent value stays undefined so lib/server.ts keeps its "Falta la clave"
// failure; a present but non-canonical value fails closed.
export function resolveTokenEncryptionKey(value: string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!isCanonicalTokenKey(value)) throw new Error(TOKEN_KEY_ERROR);
  return value;
}

export const runtime = {
  get TOKEN_ENCRYPTION_KEY() { return resolveTokenEncryptionKey(process.env.TOKEN_ENCRYPTION_KEY); },
};
