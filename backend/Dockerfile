# syntax=docker/dockerfile:1
# =============================================================================
# Backend image
#
# Stages:
#   deps     — npm ci from the lockfile (cached: invalidated only when
#              package.json / package-lock.json change, NOT on every source edit)
#   build    — tsc -> dist/
#   dev      — full toolchain + source; docker-compose.dev runs `tsx watch`
#              from this stage for hot reload
#   runtime  — production deps only + compiled output; runs as non-root `node`
#
# WHY multi-stage: build tooling (typescript, eslint, vitest) never reaches the
# final image — only dist/ and production node_modules do. Result: smaller
# image, smaller attack surface, faster pulls on deploy.
#
# WHY tsx sits in `dependencies`: schema migrations are TypeScript files that
# node-pg-migrate loads at deploy time through the same image that serves
# traffic (see docs/architecture.md "one artifact" reasoning).
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `id=` is load-bearing, not decoration. `deps` and `runtime` are SIBLING
# stages (both start `FROM node:20-alpine`; neither derives from the other), so
# BuildKit runs them in PARALLEL. With no explicit id, both
# `--mount=type=cache,target=/root/.npm` resolve to the SAME cache directory,
# and two concurrent `npm ci` processes then fight over one `_cacache`:
#   npm error ENOTEMPTY: directory not empty, rmdir '/root/.npm/_cacache/index-v5/6e'
#   npm warn tarball data for ... seems to be corrupted. Trying again.
# That second line is the same race — the sibling stage deleted tarballs while
# this one was reading them. One id per stage; they warm independently.
RUN --mount=type=cache,target=/root/.npm,id=npm-dev \
    npm ci

FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- Development target (used by docker-compose.yml via `target: dev`) ------
FROM deps AS dev
COPY . .
EXPOSE 3000
CMD ["npm", "run", "dev"]

# ---- Production target (image that CI tags and pushes) ----------------------
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY package.json package-lock.json ./
# There is deliberately NO `npm cache clean --force` here. A BuildKit cache
# mount is not part of the image: everything npm writes to /root/.npm goes into
# the cache, and the layer that gets committed contains only the original
# (empty) directory. So cleaning the cache cannot make this image smaller — it
# can only corrupt a cache that a parallel stage is reading, which is exactly
# the ENOTEMPTY failure this replaced. It is a habit carried over from
# Dockerfiles that install WITHOUT a mount, where the cache really does bloat
# the layer. (If you ever drop the mount, put the clean back.)
RUN --mount=type=cache,target=/root/.npm,id=npm-prod \
    npm ci --omit=dev

COPY --from=build /app/dist ./dist
# Migrations are executed by the compose one-shot `migrate` service from this
# same image — guarantees the code and the schema migration tooling match.
COPY migrations ./migrations
COPY scripts ./scripts

# Drop root: the official image ships an unprivileged `node` user (uid 1000).
# The app only listens on port 3000 (>1024), so no capability is needed.
USER node
EXPOSE 3000

# The image carries its own probe so `docker run` gets health checking without
# any orchestrator config; docker-compose repeats it explicitly for visibility.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/index.js"]
