import type { NextConfig } from "next";
import { resolveAllowedDevOrigins } from "./lib/dev-origins";

// Standalone output is opt-in: the container build sets NEXT_OUTPUT=standalone,
// while the default `next build` stays unchanged.
// Hostnames for `next dev` when the browser origin differs from the bind address
// (for example a Tailscale MagicDNS name or LAN IP). Derived automatically from
// BETTER_AUTH_URL, with optional extras in ALLOWED_DEV_ORIGINS.
const allowedDevOrigins = resolveAllowedDevOrigins();

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
