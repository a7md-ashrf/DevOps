# Local development

Two workflows — pick per taste. Both share the same code, tests, and
`.env`; only *where* processes run differs.

| Workflow        | Command        | API                | Web                | DB               | Hot reload |
| --------------- | -------------- | ------------------ | ------------------ | ---------------- | ---------- |
| Host (fastest)  | `make dev`     | host `:3000` (tsx) | host `:5173` (Vite)| Docker           | both        |
| Containerized   | `make stack`   | container          | container          | container        | backend yes |

## Prerequisites

- Node 20 (`.nvmrc` — `nvm use`)
- Docker + Compose ≥ 2.24 (for `db`, `make stack`, `make validate`)
- PostgreSQL reachable **only** if you want DB-backed tests without Docker
  (they self-skip otherwise; CI always has one)

## First run

```bash
make setup       # cp .env.example .env + npm install (both apps)
$EDITOR .env     # at minimum: POSTGRES_PASSWORD (openssl rand -hex 24)
make test        # all tests, DB suites skip gracefully if no PG
make lint typecheck
```

`.env` notes:

- `POSTGRES_PASSWORD` must be **URL-safe** (`openssl rand -hex 24`). The
  password is interpolated into `DATABASE_URL`; base64 output can contain
  `/` or `+`, which breaks URL parsing.
- `FRONTEND_MODE` is only consulted by `make stack` / `make build` here —
  `make dev` always uses Vite's dev server.

## `make dev` — host workflow (recommended for day-to-day)

```bash
make dev
# API  -> http://localhost:3000/api/health
# Web  -> http://localhost:5173   (Vite proxies /api to the API)
```

What it does:

1. `docker compose up -d db` — only the database is containerized.
2. Runs `backend` (`tsx watch src/index.ts`, log format `pretty`) and
   `frontend` (`vite`) in the background.
3. Ctrl-C kills both processes **and** stops the db container (the named
   volume keeps your data).

Details:

- Vite proxies `/api` → `localhost:3000` (configured in `frontend/vite.config.ts`),
  so there is no CORS in this mode.
- Backend reads `backend/.env` if present, else falls back to defaults
  (`postgresql://app:app@127.0.0.1:5432/appdb` — matching the compose db
  credentials from the root `.env.example`). Keep them in sync or create
  `backend/.env`.
- Migrations: `make migrate` (or `npm --prefix backend run migrate:up`).
  Seed demo rows: `make seed`.

## `make stack` — full container topology

```bash
make stack      # builds + starts everything, polls edge /healthz (60s)
# -> http://localhost:8080   (mode from FRONTEND_MODE)
make logs       # tail everything
make ps         # status + health
make stack-down # stop (keeps the db volume)
```

This is production's topology locally: edge, frontend, backend, migrate,
db — same compose file, without the prod overlay. Use it to verify proxying,
headers, or mode switches ([frontend-modes.md](frontend-modes.md)).

Hot reload in the stack: `backend/src`, `scripts/`, `migrations/` are
bind-mounted into the dev-target image; `tsx watch` picks up changes.
**node_modules is deliberately not mounted** — the image contains the
linux/musl build; shadowing it with your host's (macOS/arm64) modules is
the classic "works on my machine" failure.

> Note: on macOS/Windows, file-watching through a bind mount occasionally
> misses events. If edits don't trigger a restart:
> `docker compose ... restart backend`.

## Tests

```bash
make test                 # both apps
make test-backend         # vitest + supertest (40 tests)
make test-frontend        # vitest + testing-library (8 tests)
```

Backend behavior (`backend/test/global-setup.ts`):

1. derives `<db>_test` from `DATABASE_URL` — tests **never** touch your dev DB;
2. creates it if missing, runs all migrations;
3. if PostgreSQL is unreachable → prints a warning and DB suites
   `describe.runIf(...)` skip themselves (unit tests still run).
   In CI this is not allowed to pass silently — the workflow fails if
   anything was skipped.

Write tests: `npm --prefix backend run test:watch` / `npm --prefix frontend run test:watch`.

## Quality commands (identical to CI)

```bash
make lint        # eslint + prettier --check, both apps
make fmt         # auto-fix
make typecheck   # tsc --noEmit, both apps
make validate    # compose config for all 4 combos (dev/prod x static/server)
```

## Database day-to-day

```bash
make migrate       # up
make migrate-down  # roll back last migration
make seed          # idempotent demo data
docker compose --env-file .env -f infra/docker-compose.yml exec db psql -U app -d appdb
```

Create a migration:

```bash
npm --prefix backend run migrate:create <name>
# edit the generated file in backend/migrations/, then: make migrate
```

Migration gotchas (both hit during the build):

- Defaults that are *function calls* (`gen_random_uuid()`, `now()`) need
  `PgLiteral.create(...)` — a plain string gets dollar-quoted and breaks.
- Plain string defaults must be written `'todo'` (one layer of quotes).
- TypeScript migrations only run under `tsx` (node-pg-migrate requires them
  via CJS) — that's why `tsx` is a **production** dependency of the backend.

## Debugging

- Backend logs (JSON in stack mode, pretty in `make dev`):
  `docker compose ... logs -f backend`
- Edge access log (JSON, includes `request_id`, `status`, `upstream`):
  `docker compose ... logs -f nginx`
- Entry point decisions (mode, cert paths, redirect state) print once at
  boot: look for `site-config: mode=... tls_redirect=... cert=...`
- `make ps` shows health states; `migrate` legitimately shows `exited (0)`.

## Cleaning up

```bash
make clean       # DANGER: removes dev containers AND the db volume (asks first)
docker compose --env-file .env -f infra/docker-compose.yml down -v --prune
```
