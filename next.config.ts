import type { NextConfig } from "next";

type DevOriginEnvironment = {
  BETTER_AUTH_URL?: string;
  ALLOWED_DEV_ORIGINS?: string;
};

export function resolveAllowedDevOrigins(env: DevOriginEnvironment): string[] {
  const origins: string[] = [];

  if (env.BETTER_AUTH_URL) {
    let authUrl: URL;
    try {
      authUrl = new URL(env.BETTER_AUTH_URL);
    } catch {
      throw new Error("BETTER_AUTH_URL must be a valid absolute URL");
    }
    if (!["http:", "https:"].includes(authUrl.protocol) || !authUrl.hostname) {
      throw new Error("BETTER_AUTH_URL must be a valid absolute URL");
    }
    origins.push(authUrl.hostname);
  }

  const additionalOrigins = (env.ALLOWED_DEV_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of additionalOrigins) {
    if (origin.includes("://") || origin.includes("/") || origin.includes(":")) {
      throw new Error(
        "ALLOWED_DEV_ORIGINS must contain hostnames without protocol or port",
      );
    }
  }
  origins.push(...additionalOrigins);

  return [...new Set(origins)];
}

// Standalone output is opt-in: the container build sets NEXT_OUTPUT=standalone,
// while the default `next build` stays unchanged. During development, the
// public Better Auth hostname is allowed automatically; extra hostnames can be
// supplied as a comma-separated ALLOWED_DEV_ORIGINS list.
const allowedDevOrigins = resolveAllowedDevOrigins({
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  ALLOWED_DEV_ORIGINS: process.env.ALLOWED_DEV_ORIGINS,
});

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
