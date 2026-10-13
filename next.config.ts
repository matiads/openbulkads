import type { NextConfig } from "next";

// Standalone output is opt-in: the container build sets NEXT_OUTPUT=standalone,
// while the default `next build` stays unchanged.
// Comma-separated hostnames for `next dev` when the browser origin differs
// from the bind address (for example a Tailscale MagicDNS name). Unset in
// production and in the default build.
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
