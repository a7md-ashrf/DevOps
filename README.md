# devops-reference

A complete, production-shaped full-stack project you can read, run, and copy:
**React (Vite) + Express/PostgreSQL + Nginx edge + TLS + Docker Compose +
GitHub Actions CI/CD deploying to a plain Ubuntu VPS.**

Built to be studied: every layer is small, commented, and documented
line-by-line in [`docs/`](docs/). Nothing is hidden behind a CLI framework —
the Makefile is only readable wrappers around the real commands.

```
                      Internet
                         │  :80 / :443
                         ▼
              ┌─────────────────────┐
              │  nginx (edge)       │  TLS, security headers, rate limits,
              │  nginx/             │  HTTP→HTTPS, request-id, routing
              └───┬─────────────┬───┘
        frontend_net│           │frontend_net
              ┌─────▼─────┐ ┌───▼──────────────┐
              │ frontend  │ │ backend :3000    │
              │ :8080     │ │ Express 5 + pg   │
              │ static OR │ └───┬──────────┬───┘
              │ server    │     │          │ backend_net
              └───────────┘     │          │
                        ┌───────▼───┐ ┌────▼────────┐
                        │ migrate   │ │ db          │
                        │ (one-shot)│ │ PostgreSQL16│
                        └───────────┘ └─────────────┘
```

## What's inside

| Layer      | Tech                                                     |
| ---------- | -------------------------------------------------------- |
| Frontend   | React 18 + TypeScript + Vite, two serving modes          |
| Backend    | Express 5 + TypeScript, node-pg-migrate, pino, zod       |
| Database   | PostgreSQL 16, migrations gated as a deploy dependency   |
| Edge       | nginx-unprivileged, brotli (best effort), CSP, rate limit|
| TLS        | Let's Encrypt webroot, repo-local, auto-renew + reload   |
| Runtime    | Docker Compose (dev base + prod overlay), non-root images|
| CI/CD      | GitHub Actions: CI → Release (GHCR) → approve → Deploy   |
| Ops        | Backups, rollback, VPS bootstrap, runbook, troubleshooting|

## Quick start (local, 3 commands)

```bash
make setup      # creates .env, installs node_modules (both apps)
make test       # run all tests (DB tests self-skip if Postgres is down)
make dev        # hot reload: API :3000 + web :5173, DB in Docker
```

Prefer the full production topology locally?

```bash
make stack      # all containers, mode from .env → http://localhost:8080
make stack-down
```

> Requires Docker. No Docker on this machine? `make dev` still works if
> PostgreSQL is reachable (`make setup` + local PG, or `docker run` the DB only).

## Production (the whole story, in order)

1. **[docs/vps-setup.md](docs/vps-setup.md)** — from a bare Ubuntu box to a
   healthy deployment (`vps-bootstrap.sh` → `.env` → `issue-ssl.sh` → `make prod`)
2. **[docs/ci-cd.md](docs/ci-cd.md)** — merge → Release builds `sha-*` images →
   manual approval → `deploy.sh` over SSH with a health gate
3. **[docs/runbook.md](docs/runbook.md)** — day-2: deploy, rollback, logs, restarts

## Commands

```bash
make help       # every target, one line each
```

Highlights: `make dev` (host hot reload) · `make stack` (containers) ·
`make test` · `make lint` `make typecheck` · `make migrate` · `make backup` ·
`make validate` (all 4 compose combinations) · `make prod` (deploy.sh) ·
`make ssl-issue STAGING=1`

The Makefile always passes `--env-file .env` explicitly and builds the
`-f infra/docker-compose.yml [-f infra/docker-compose.prod.yml]` chain the same
way `deploy.sh` does — one invocation everywhere, no cwd-dependent surprises.

## Documentation map

| Doc                                                              | For                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------ |
| [architecture.md](docs/architecture.md)                         | How the pieces fit: networks, compose layering, env vars |
| [local-development.md](docs/local-development.md)               | Day-to-day coding, tests, hot reload                     |
| [frontend-modes.md](docs/frontend-modes.md)                     | The `FRONTEND_MODE` switch: static vs server             |
| [file-reference.md](docs/file-reference.md)                     | Every path, one line each — the index                     |
| [vps-setup.md](docs/vps-setup.md)                               | Zero → production on Ubuntu                              |
| [ssh-keys.md](docs/ssh-keys.md)                                 | Deploy keys, GitHub secrets, known_hosts                 |
| [ci-cd.md](docs/ci-cd.md)                                       | Workflows, gates, image tags, rollback                   |
| [tls.md](docs/tls.md)                                           | Certificates, renewal, redirects, the entrypoint fallback|
| [backups.md](docs/backups.md)                                   | Backup schedule, restore, DR drills                       |
| [runbook.md](docs/runbook.md)                                   | Operational commands (deploy/rollback/restart/inspect)   |
| [troubleshooting.md](docs/troubleshooting.md)                   | Symptom → cause → fix                                    |
| [production-checklist.md](docs/production-checklist.md)         | Go-live gate + hardening backlog                         |

## Repository layout

```
.
├── backend/            Express API (TS), migrations, seeds, tests
├── frontend/           React app (Vite) + 2 Dockerfiles + node static server
├── nginx/              Edge: config, mode templates, snippets, entrypoint
├── infra/
│   ├── docker-compose.yml        base (dev + topology reference)
│   ├── docker-compose.prod.yml   production overlay (!reset ports, registry)
│   ├── setup/                    vps-bootstrap, issue/renew SSL, hooks
│   ├── backup/                   backup.sh / restore.sh
│   └── deploy/deploy.sh          THE deploy path (CI and humans)
├── .github/workflows/  ci.yml · release.yml · deploy.yml
├── docs/               the documentation (start above)
└── Makefile            every routine command
```

## Design decisions worth knowing

- **Two compose files, one flag.** Dev defaults live in the base file;
  *every* production difference is isolated in `docker-compose.prod.yml`
  (registry images, closed ports, resource limits, TLS mounts). The
  `FRONTEND_MODE=static|server` env flag selects the frontend Dockerfile,
  image name, and edge routing template — no extra override files.
- **Migrations gate deploys.** The backend `depends_on` the one-shot
  `migrate` service with `service_completed_successfully` — new code never
  starts against an old schema.
- **Images are immutable, `.env` is not.** CI tags `sha-<short>`; the server
  only ever pulls. Rollback = redeploy a previous tag (`.deploy-last-good`).
- **Health gates, not hope.** `deploy.sh` fails (and tells you how to roll
  back) unless `/api/health` and the edge over TLS both answer.
- **Non-root everywhere.** `nginx-unprivileged`, node images drop
  capabilities, `no-new-privileges` — see
  [production-checklist.md](docs/production-checklist.md) for what's left.
