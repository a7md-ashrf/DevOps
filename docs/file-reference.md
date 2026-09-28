# File reference

Every path in the repository and what it's for. Depth-first, grouped by
layer — the "where do I go to change X" index.

## Root

| Path                | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `README.md`         | Project intro, quick start, doc map                                      |
| `Makefile`          | Every routine command; wrappers around real commands (see `make help`)    |
| `.env.example`      | Annotated template for the gitignored `.env`                             |
| `.nvmrc`            | Node 20 (both apps, CI)                                                  |
| `.gitignore`        | Blocks `.env`, `certbot/`, `backups/`, `*.pem`, build output             |
| `.prettierrc` / `.editorconfig` / `.prettierignore` | Formatting, shared by both apps       |
| `.github/workflows/`| CI, Release, Deploy (see [ci-cd.md](ci-cd.md))                           |

## `backend/` — Express API

| Path                              | Purpose                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `src/index.ts`                    | Process entry: config → app → listen → graceful shutdown (SIGTERM)   |
| `src/app.ts`                      | App factory: pino-http (X-Request-Id), helmet, rate limit, routes    |
| `src/config.ts`                   | Env parsing/validation (zod); all defaults in one place              |
| `src/logger.ts`                   | pino setup (json/pretty by `LOG_FORMAT`)                             |
| `src/errors.ts`                   | `AppError` + error codes for the response envelope                   |
| `src/middleware/error.ts`         | Final error handler → `{ error: { code, message, requestId } }`      |
| `src/routes/api.ts`               | `/api` router assembly                                                |
| `src/routes/health.ts`            | `GET /api/health` — 503 when the DB probe fails                      |
| `src/routes/tasks.ts`             | CRUD demo resource (list/create/update/delete)                       |
| `src/task.ts`                     | Task domain types + service functions                                |
| `src/validation.ts`               | zod schemas for request bodies/params/query                          |
| `src/db/pool.ts`                  | Single `pg` pool from `DATABASE_URL`                                 |
| `src/db/migrate.ts`               | Programmatic node-pg-migrate runner (CLI + tests share it)           |
| `src/load-env.ts`                 | Tiny host-dev `.env` loader (no dotenv dependency)                   |
| `scripts/migrate.ts`              | CLI wrapper: `up` / `down` / `create`                                |
| `migrations/*.ts`                 | Timestamped TS migrations (see gotchas in local-development.md)      |
| `seeds/seed.ts`                   | Idempotent demo data                                                 |
| `test/global-setup.ts`            | vitest global: `_test` DB + migrations (skips gracefully if no PG)   |
| `test/test-db-url.ts`             | `_test` URL derivation, reachability check, CREATE DATABASE          |
| `test/helpers.ts`                 | Supertest app builder + truncate helper                              |
| `test/*.test.ts`                  | config · validation · envelope · health · tasks suites               |
| `Dockerfile`                      | Stages: `deps` → `build` → `dev` (tsx watch) → `runtime` (default)   |
| `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts` | Tooling; `build` excludes tests           |

## `frontend/` — React app + two origins

| Path                    | Purpose                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `src/main.tsx`          | React root                                                          |
| `src/App.tsx`           | Layout + data flow (tasks demo)                                     |
| `src/api/client.ts`     | Typed fetch wrapper (envelope-aware, base URL from env)             |
| `src/hooks/useTasks.ts` | Server state for the tasks list (loading/error/refetch)             |
| `src/components/*`      | `TaskForm` · `TaskList` · `TaskItem`                                |
| `src/styles.css`        | Hand-rolled styles (no CSS framework — the point is the *ops*)      |
| `vite.config.ts`        | Dev server + `/api` proxy to `:3000`                                |
| `index.html`            | Vite entry                                                          |
| `server.mjs`            | **server-mode origin**: healthz, static files, SPA fallback, caching |
| `nginx-static.conf`     | **static-mode origin**: file server on :8080, cache rules, healthz   |
| `Dockerfile.static`     | Build → nginx-unprivileged serving `dist/`                          |
| `Dockerfile.server`     | Build → slim node image running `server.mjs`                        |
| `test/*`                | client unit tests + App render tests (testing-library)              |

Selected by `FRONTEND_MODE` — see [frontend-modes.md](frontend-modes.md).

## `nginx/` — edge

| Path                                   | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `nginx.conf`                           | Main config: JSON access log (`$request_id`), limit zones, gzip, TLS 1.2/1.3 defaults, includes |
| `templates/static-mode.conf.template`  | Site config rendered at start (static mode)                    |
| `templates/server-mode.conf.template`  | Site config rendered at start (server mode)                    |
| `docker-entrypoint.d/45-site-config.sh`| Pre-start: validate mode → TLS files → render template → write redirect/proxy include |
| `snippets/locations-static.conf`       | `location /api/` + `location /` (variable proxy_pass)          |
| `snippets/locations-server.conf`       | Same + `proxy_buffering off`, `proxy_read_timeout 60s`         |
| `snippets/proxy-headers.conf`          | X-Forwarded-For/Proto/Host, Connection cleanup                 |
| `snippets/security-headers.conf`       | CSP, XFO, nosniff, Referrer/Permissions policies (no HSTS)     |
| `snippets/tls-hardening.conf`          | HSTS **only** — never included on the HTTP port                |
| `Dockerfile`                           | ngx_brotli stage (best effort) → final unprivileged image      |

Detail: [architecture.md §5](architecture.md#5-the-edge-in-detail-nginx).

## `infra/` — runtime glue

| Path                            | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `docker-compose.yml`            | Base: full topology, dev defaults, healthchecks, logging rotation  |
| `docker-compose.prod.yml`       | Prod overlay: `!reset` ports/volumes, registry images, limits, TLS |
| `setup/vps-bootstrap.sh`        | One-time Ubuntu setup: Docker, UFW, certbot, dirs                  |
| `setup/issue-ssl.sh`            | First certificate (webroot, repo-local, installs renewal cron)     |
| `setup/renew-ssl.sh`            | `certbot renew` (+ `--dry-run` passthrough)                        |
| `setup/ssl-deploy-hook.sh`      | Post-renewal: graceful `nginx -s reload` in the stack              |
| `backup/backup.sh`              | `pg_dump` → `backups/db-<stamp>-<sha>.sql.gz` + sha256, rotation   |
| `backup/restore.sh`             | Verify → stop writers → restore (`ON_ERROR_STOP=1`) → restart      |
| `deploy/deploy.sh`              | **The** deploy path: git sync → pull → up → health gate → pin      |

## `.github/workflows/`

| Path          | Trigger                          | Does                                              |
| ------------- | -------------------------------- | ------------------------------------------------- |
| `ci.yml`      | PR + push main                   | lint/typecheck/test/build × apps + compose validate|
| `release.yml` | push main (not docs-only)        | builds + pushes 4 images `sha-*`, optional DH mirror|
| `deploy.yml`  | Release success / manual         | approval gate → SSH → `deploy.sh` (rollback input) |

## `docs/`

`architecture` · `local-development` · `frontend-modes` · `file-reference`
(this file) · `vps-setup` · `ssh-keys` · `ci-cd` · `tls` · `runbook` ·
`backups` · `troubleshooting` · `production-checklist`.
