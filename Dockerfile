# syntax=docker/dockerfile:1

# 1. Dependencies: install the full lockfile needed to build the app.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json .npmrc ./
RUN npm ci --workspaces=false --include=dev --include=optional --no-audit --no-fund

# 2. Build: produce the Next.js standalone server using the official Node builder.
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Standalone output is opt-in so the default `next start` path stays intact.
ENV NEXT_OUTPUT=standalone
# Public, non-secret media cap. Declaring it as ARG + ENV makes `next build`
# inline the same value into the browser and server bundles; the default stays
# 250 MB. compose.prod.yaml passes this build arg from the host environment.
ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250
ENV NEXT_PUBLIC_MEDIA_LIMIT_MB=$NEXT_PUBLIC_MEDIA_LIMIT_MB
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
RUN npm run build

# 3. Runtime: minimal non-root image that serves the standalone output.
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
# Carry the same public media cap into the runtime so the server never disagrees
# with the value inlined into the browser bundle during the builder stage.
ARG NEXT_PUBLIC_MEDIA_LIMIT_MB=250
ENV NEXT_PUBLIC_MEDIA_LIMIT_MB=$NEXT_PUBLIC_MEDIA_LIMIT_MB
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# One-shot migration dependency: the Drizzle SQL plus the self-contained runner.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/container-start.mjs ./scripts/container-start.mjs
COPY --from=builder --chown=node:node /app/scripts/container-migrate.mjs ./scripts/container-migrate.mjs
USER node
EXPOSE 3000
CMD ["node", "scripts/container-start.mjs"]
