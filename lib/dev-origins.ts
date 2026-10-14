// Resolves allowed origins for `next dev` when accessing from another device
// (LAN IP, Tailscale MagicDNS, private VPN, or reverse proxy).
//
// Automatically derives the hostname from `BETTER_AUTH_URL` so developers do
// not have to maintain both `BETTER_AUTH_URL` and `ALLOWED_DEV_ORIGINS`.
// Additional origins can still be supplied through `ALLOWED_DEV_ORIGINS`.
export function resolveAllowedDevOrigins(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string[] {
  const origins = new Set<string>();

  if (env.BETTER_AUTH_URL) {
    try {
      const url = new URL(env.BETTER_AUTH_URL);
      if (url.hostname && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
        origins.add(url.hostname);
      }
    } catch {
      // Malformed or relative URL: ignore safely in config resolution.
    }
  }

  if (env.ALLOWED_DEV_ORIGINS) {
    for (const item of env.ALLOWED_DEV_ORIGINS.split(',')) {
      const trimmed = item.trim();
      if (trimmed) {
        origins.add(trimmed);
      }
    }
  }

  return Array.from(origins);
}
