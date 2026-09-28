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
RUN --mount=type=cache,target=/root/.npm \
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
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npm cache clean --force

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
