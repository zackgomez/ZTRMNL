# syntax=docker/dockerfile:1
#
# Multi-stage build for third-party self-hosting. The maintainer's own
# production deploy is systemd-on-LXC (see deploy/ztrmnl.service and the
# README's "Deploy" section) -- this image is the Docker path for everyone
# else.
#
# Debian-based node:24-slim (NOT alpine/musl): sharp, @resvg/resvg-js, and
# better-sqlite3 all rely on glibc prebuilds. onlyBuiltDependencies in
# package.json lets pnpm run better-sqlite3's install script (downloads its
# glibc prebuild); without it the native binding silently breaks.

FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Copy manifest + lockfile first so this layer caches across source-only
# changes.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:24-slim AS prod-deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-slim AS final
ENV NODE_ENV=production
WORKDIR /app

# --chown on each COPY instead of a trailing `chown -R /app`: a recursive
# chown rewrites every file into a new layer (~70MB of pure duplication).
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node assets ./assets
COPY --chown=node:node reference ./reference
COPY --chown=node:node package.json ./

# /app/data is the mutable state dir (sqlite db, rendered PNGs, device log).
# Create it owned by the existing non-root `node` user so it works even
# without a mounted volume. /app itself (non-recursive) is chowned too so
# config.ts's boot-time config.example.json regeneration succeeds instead of
# warning.
RUN mkdir -p /app/data && chown node:node /app /app/data

USER node

EXPOSE 2400 2401

CMD ["node", "dist/server.js"]
