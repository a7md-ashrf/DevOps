# Frontend modes: `static` vs `server`

One environment variable changes which container serves the React build and
how the edge routes to it:

```bash
# .env
FRONTEND_MODE=static   # default
# or
FRONTEND_MODE=server
```

## What actually changes

| Aspect                       | `static`                                | `server`                                     |
| ---------------------------- | --------------------------------------- | -------------------------------------------- |
| Frontend Dockerfile          | `frontend/Dockerfile.static`            | `frontend/Dockerfile.server`                 |
| Container process            | `nginx` (nginx-unprivileged) serving `dist/` | `node server.mjs` (Express-free, ~60 lines) |
| Image name                   | `…/frontend-static:sha-*`               | `…/frontend-server:sha-*`                    |
| Edge template                | `nginx/templates/static-mode.conf.template` | `…/server-mode.conf.template`            |
| Edge location snippet        | `snippets/locations-static.conf`        | `snippets/locations-server.conf`             |
| `location /` behavior        | proxy → `frontend:8080`                 | proxy → `frontend:8080` + `proxy_buffering off`, `proxy_read_timeout 60s` |
| Node in production?          | **no** (UI tier is pure nginx)          | yes (one small Node process)                 |
| Health endpoint              | `/healthz` (static 200)                 | `/healthz` (express-style, app-aware)        |

Everything else is byte-identical: TLS handling, security headers, rate
limits, `/api/*` routing, cache policy for hashed assets, the two-network
layout, the health gate, CI, and the runbook.

> The two templates are intentionally the same file with different
> `include` lines — `diff nginx/templates/static-mode.conf.template
> nginx/templates/server-mode.conf.template` shows the *entire* difference.

## How the flag propagates (single source of truth)

`FRONTEND_MODE` in `.env` is read in three places — all derived, never
duplicated by hand:

1. **compose** (`infra/docker-compose.yml`)
   - `frontend.build.dockerfile: Dockerfile.${FRONTEND_MODE}` — selects the build
   - `frontend.image: …/frontend-${FRONTEND_MODE}:…` — separates tags so both
     variants can coexist in one registry
2. **edge** — compose passes `NGINX_MODE: ${FRONTEND_MODE}` into the nginx
   container; the entrypoint picks the template *and* writes
   `http-app.inc` to include the matching locations snippet.
3. **Makefile** — `make build` builds `Dockerfile.$(FRONTEND_MODE)` and tags
   it `local/frontend-$(FRONTEND_MODE):dev` (same name compose uses, so
   `make stack` reuses the image instead of rebuilding).

Both frontend images are built by CI on every release regardless of the
VPS's current mode — **switching modes is a `.env` edit + deploy, never a
rebuild**.

## Switching modes

```bash
# on the VPS
$EDITOR .env          # FRONTEND_MODE=server
make prod             # deploy.sh -> pull (picks frontend-server) -> up -> gate
```

What happens on `up`:

- the `frontend` container is recreated from the *other* image;
- nginx is recreated (its `NGINX_MODE` env changed → new template rendered);
- `--remove-orphans` cleans anything left from the previous variant;
- image names differ, so nothing stale can be reused by accident.

Rollback of a mode switch: set the flag back and `make prod` again.

## When to choose which

**`static` (default, recommended):**

- Small static SPA — nginx serves files with fewer moving parts and less
  memory than a Node process.
- One less runtime to patch/update; the UI tier has no JS runtime attack
  surface.
- Simple caching story: `assets/*` immutable, `index.html` no-store —
  enforced by the **origin** (`frontend/nginx-static.conf` for static mode,
  `server.mjs` for server mode). The edge adds security headers/compression
  but leaves `Cache-Control` alone, so exactly one layer owns caching.

**`server`:**

- You need server-side work later (SSR, BFF endpoints, auth cookie handling,
  per-user rendering) without adding a new service.
- You want Node-side logic but still prefer routing *everything* through the
  edge (so CSP, HSTS, rate limits stay in one place).
- Cost: a Node process in the UI tier (memory + patching), which is why it's
  opt-in rather than default.

The demo `server.mjs` is intentionally minimal: `/healthz`, static files
with proper `Cache-Control`, SPA fallback to `index.html`, `404` for
missing assets (no fallback for files with extensions — a missing JS chunk
must fail loudly, not serve HTML).

## Local development is unaffected

`make dev` always uses Vite's dev server (`:5173`) — the flag only matters
for the containerized paths (`make stack`, `make build`, production).
