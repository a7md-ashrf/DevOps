# Architecture

How the pieces fit together: request paths, containers, networks, compose
layering, and every environment variable. Read this once and the rest of the
docs become details.

## 1. Services and the dependency graph

```
db (healthy) ──▶ migrate (exits 0) ──▶ backend ──▶ nginx ◀── frontend
                              ▲                     ▲
                              └── depends_on ───────┘
```

| Service    | Image (prod)                              | Role                                    | Exposed              |
| ---------- | ----------------------------------------- | --------------------------------------- | -------------------- |
| `db`       | `postgres:16-alpine`                      | Data store                              | **nothing** (prod)   |
| `migrate`  | same image as `backend`                   | One-shot `npm run migrate`, then exits  | nothing              |
| `backend`  | `…/backend:sha-*`                         | Express API + `/api/health`             | **nothing** (prod)   |
| `frontend` | `…/frontend-{static,server}:sha-*`        | Serves the built React app on :8080     | internal only        |
| `nginx`    | `…/nginx:sha-*`                           | Edge: TLS, headers, limits, routing     | **80, 443**          |

Compose ordering guarantees (all in `infra/docker-compose.yml`):

- `db` exposes a healthcheck (`pg_isready`) — everything downstream waits on
  `condition: service_healthy`.
- `migrate` runs **after** `db` is healthy and **before** `backend` starts
  (`condition: service_completed_successfully`). A failed migration aborts
  the whole `up`: the old backend containers simply keep running → a bad
  schema change can never be paired with new code.
- `nginx` starts once `frontend` and `backend` are *started* (its own
  `resolver` + variable `proxy_pass` means it tolerates upstream IP churn
  anyway — see §5).

## 2. Request paths

### Static mode (`FRONTEND_MODE=static`, default)

```
browser ──HTTPS──▶ nginx ──/──────────────▶ frontend:8080   (nginx serving dist/)
                   │  └──/api/*───────────▶ backend:3000
                   └──/healthz             answered by nginx itself
```

### Server mode (`FRONTEND_MODE=server`)

```
browser ──HTTPS──▶ nginx ──/ + /assets/* + /healthz ─▶ frontend:8080  (node server.mjs)
                   └──/api/*────────────────────────▶ backend:3000
```

The only differences are *inside* the `location /` block:
`nginx/snippets/locations-static.conf` (proxy) vs `locations-server.conf`
(proxy + `proxy_buffering off` + longer read timeout, because the origin is a
long-lived Node process that may serve streamed/SSR-ish responses later).
Everything else — TLS, headers, rate limits, API routing — is identical.
See [frontend-modes.md](frontend-modes.md).

### Local dev, no containers for the app

```
browser ──▶ vite :5173 ──/api proxy──▶ tsx watch :3000 ──▶ db (docker only)
```

## 3. Networks and segmentation

| Network      | Members                     | Purpose                              |
| ------------ | --------------------------- | ------------------------------------ |
| `frontend_net` | nginx, frontend, backend  | Browser-facing request path          |
| `backend_net`  | backend, db               | Data path                            |

The `db` is **not** attached to `frontend_net`. An attacker who compromises
the edge can still only reach `frontend` and `backend` ports; opening a raw
5432 connection would require pivoting onto a network the edge isn't on.
Ports reinforce this: in production neither `db` nor `backend` publishes a
host port at all (the prod overlay replaces the dev mappings with
`ports: !reset []`).

## 4. Compose layering

```
docker-compose.yml          ← dev defaults + the topology itself
   +  docker-compose.prod.yml   ← ONLY what differs in production
   ────────────────────────────
   = production stack
```

Rules that keep this honest:

1. If dev and prod behave the same, the setting lives in the base file once
   (healthchecks, logging rotation, restart policy, env plumbing).
2. Every prod difference is in the overlay, with a comment saying why:
   - `ports: !reset []` — Compose *merges* lists; without `!reset` the
     dev-only 5432/3000 host ports would silently survive into production.
     (Requires Compose ≥ 2.24; `deploy.sh` and `vps-bootstrap.sh` both check.)
   - `volumes: !reset []` on `backend` — removes hot-reload source mounts.
   - `pull_policy: always` + registry `image:` — the server builds nothing.
   - `deploy.resources.limits`, `cap_drop`, `no-new-privileges`, `init`.
   - Let's Encrypt mounts + `TLS_CERT`/`TLS_KEY` + `ENABLE_TLS_REDIRECT=1`.
3. Invocation is always the same pair of flags, from the repo root:

   ```bash
   docker compose --env-file .env -f infra/docker-compose.yml \
                  [-f infra/docker-compose.prod.yml] <cmd>
   ```

   `--env-file` is explicit so behavior never depends on the current
   directory; `COMPOSE_PROJECT_NAME` in `.env` pins container/network names.

## 5. The edge in detail (`nginx/`)

- **Base image**: `nginxinc/nginx-unprivileged:1.27-alpine` — master process
  runs as uid 101, no root in the container. Host 80/443 → container
  8080/8443 (a non-root process cannot bind <1024).
- **Config generation** happens in
  `docker-entrypoint.d/45-site-config.sh` at *container start* (not build
  time), because it depends on runtime env:
  1. validate `NGINX_MODE`, resolve `DOMAIN`;
  2. pick TLS material: mounted Let's Encrypt pair → else generate a
     7-day self-signed dev cert into `/tmp` (so the HTTPS server block
     always has files);
  3. delete the stock `default.conf`;
  4. `envsubst` (with an **allow-list** of `${VAR}`s so `$host`, `$uri`,
     `$request_id`… survive) renders `templates/${NGINX_MODE}-mode.conf.template`
     → `conf.d/10-site.conf`;
  5. write `conf.d/http-app.inc`: `ENABLE_TLS_REDIRECT=1` → `return 301`
     on `location /`, else → the mode's locations snippet. It's `.inc` on
     purpose: `conf.d/*.conf` is included at `http{}` level where a bare
     `location` is a syntax error — only server blocks belong in that glob.
- **`resolver 127.0.0.11` + variable `proxy_pass`** in the location snippets:
  upstream IPs are re-resolved after containers are recreated. With a static
  `proxy_pass http://frontend:8080;`, nginx would cache the *old* IP for
  `proxy_connect_timeout` after a deploy → intermittent 502s until reload.
  This is the reason deploys stay zero-touch.
- **brotli**: `nginx/Dockerfile` stage 1 compiles `ngx_brotli` against the
  exact nginx version of the base image; if that fails, the build continues
  with a loud warning and a gzip-only image (an upstream change can never
  brick your release). Directives only load when the `.so` exists.
- **Security headers** come from snippets; HSTS lives *only* in
  `tls-hardening.conf` so it never appears on the plain-HTTP port.
- **Rate limits**: `limit_req_zone` in `nginx.conf` — `site_limit`
  (30 r/s burst 60) at server level, `api_limit` available for `/api/*`;
  responses 429 (status configured, not the default 503).
- **Correlation**: nginx generates/forwards `X-Request-Id` (`$request_id`);
  pino-http in the backend reuses it (`genReqId`) → one id greppable across
  edge access logs and app logs.

## 6. Backend (`backend/`)

- Express **5** (async errors reach the middleware chain automatically),
  zod for input validation, a uniform envelope
  (`{ data } | { error: { code, message, requestId } }`).
- `pino` + `pino-http` (JSON, `X-Request-Id` aware, health probes excluded),
  `helmet` (CSP off — the edge owns CSP to avoid duplication),
  `express-rate-limit` as a second line of defense behind nginx.
- `TRUST_PROXY=1` in the stack (nginx is always one hop away) so rate
  limiting keys on the real client IP; unset in the host `make dev` workflow
  where nothing proxies.
- DB access: one `pg` pool (`src/db/pool.ts`), URL from `DATABASE_URL`.
- Migrations: **node-pg-migrate** TypeScript files in `migrations/`, run via
  `tsx` (the package uses CJS `require` semantics; `tsx` provides them under
  ESM). Programmatic runner `src/db/migrate.ts` is reused by tests.
- Health: `GET /api/health` returns 503 when the DB probe fails → the
  deploy gate and compose healthcheck both mean "usable", not "process up".

## 7. Ports matrix

| Port            | dev (`make stack`)        | prod (overlay) | Process             |
| --------------- | ------------------------- | -------------- | ------------------- |
| host 80         | —                         | → nginx 8080   | HTTP + ACME         |
| host 443        | —                         | → nginx 8443   | HTTPS               |
| host 8080       | → nginx 8080              | —              | edge (dev)          |
| host 8443       | → nginx 8443              | —              | edge TLS (dev)      |
| host 3000       | → backend 3000 (loopback) | **not published** | API (dev debugging) |
| host 5432       | → db 5432 (loopback)      | **not published** | PostgreSQL (dev)    |
| internal 8080   | frontend                  | frontend       | UI origin           |
| internal 3000   | backend                   | backend        | API                 |
| internal 5432   | db                        | db             | PostgreSQL          |

`make dev` additionally runs the API on the host (`:3000`) with Vite on
`:5173` — only `db` is containerized in that mode.

## 8. Environment variables

`.env` (gitignored) is the single source; `.env.example` is the annotated
template. Who reads what:

| Variable                    | Read by                                        |
| --------------------------- | ---------------------------------------------- |
| `FRONTEND_MODE`             | compose (Dockerfile + image name), nginx mode, Makefile |
| `COMPOSE_PROJECT_NAME`      | compose (stable names)                         |
| `POSTGRES_USER/PASSWORD/DB` | compose → db, migrate, backend `DATABASE_URL`  |
| `POSTGRES_HOST_PORT`        | compose (dev binding only)                     |
| `LOG_LEVEL`, `CORS_ORIGINS`, `TRUST_PROXY` | backend (compose sets `TRUST_PROXY`) |
| `IMAGE_REPO`, `IMAGE_TAG`   | compose prod images, `deploy.sh`               |
| `DOMAIN`                    | nginx (`server_name`, cert CN/SAN), certbot, deploy gate |
| `ENABLE_TLS_REDIRECT`       | nginx entrypoint → `http-app.inc`              |
| `HTTP_PORT`, `HTTPS_PORT`   | compose (dev host ports)                       |
| `BACKEND_HOST_PORT`         | compose (dev binding)                          |

Production-only overrides that are **not** in `.env`: `NODE_ENV=production`,
`LOG_FORMAT=json` (set by the prod overlay), `IMAGE_TAG` (set by CI/deploy).

Secrets policy: `.env` never enters git (`.gitignore` also blocks `*.pem`,
`certbot/`, `backups/`); images never contain env values; GitHub holds VPS
credentials as Actions secrets ([ssh-keys.md](ssh-keys.md)).

## 9. CI/CD pipeline

```
PR ──────────────▶ ci.yml (lint/typecheck/test/compose) ──▶ required check
 │                                                     │
 └── merge main ────────▶ release.yml: build×4 ────────▶ ghcr.io/...:sha-*
                                        │                    │
                                        ▼                    ▼
                          deploy.yml (environment: production)
                          manual APPROVE ─▶ SSH ─▶ deploy.sh
                                               1. git pull --ff-only
                                               2. compose pull
                                               3. compose up -d
                                               4. health gate
                                               5. record .deploy-last-good
```

Full details: [ci-cd.md](ci-cd.md).
