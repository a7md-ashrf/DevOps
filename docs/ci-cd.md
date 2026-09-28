# CI/CD

Three workflows, three gates. The invariant: **what was tested is what is
deployed, and a human says when.**

```
   PR                    merge to main                 after Release
    │                         │                              │
    ▼                         ▼                              ▼
┌────────┐             ┌────────────┐               ┌─────────────────┐
│  CI    │ required    │  Release   │               │     Deploy      │
│ ci.yml │ check       │ release.yml│               │    deploy.yml   │
└────────┘             └────────────┘               └─────────────────┘
 lint, typecheck        build 4 images               environment:
 test (real PG)         push ghcr.io:sha-*           production
 compose validate       export image-tag             = manual APPROVE
                        optional DH mirror           then SSH → deploy.sh
```

## 1. `ci.yml` — every PR, every push to main

| Job       | Runs                                                        | Fails when                          |
| --------- | ----------------------------------------------------------- | ----------------------------------- |
| `backend` | lint, typecheck, **tests against a PostgreSQL service container**, build | any test fails **or any test was skipped** |
| `frontend`| lint, test, `npm run build` (typecheck included)             | any of the above                    |
| `compose` | `make validate` (all 4 compose combos) + `bash -n` on every script | config invalid / syntax error     |

Details worth knowing:

- The PG service is `postgres:16-alpine` on `localhost:5432` with
  `DATABASE_URL=…@127.0.0.1:5432/appdb`; `global-setup.ts` derives and
  creates `appdb_test`.
- **Skip guard:** locally, DB suites skip when Postgres is down — in CI that
  would be a silent false-green, so the workflow greps the vitest output for
  `| N skipped` (N ≥ 1) and fails.
- `concurrency` cancels superseded runs on the same ref (saves minutes on
  rapid pushes; PRs only).
- Node version comes from `.nvmrc`; npm caches keyed on each lockfile.

## 2. `release.yml` — main only (docs-only pushes skipped via `paths-ignore`)

Builds and pushes **four** images, all tagged `sha-<shortsha>`:

```
ghcr.io/<owner>/devops-reference/backend:sha-a1b2c3d
ghcr.io/<owner>/devops-reference/frontend-static:sha-a1b2c3d
ghcr.io/<owner>/devops-reference/frontend-server:sha-a1b2c3d
ghcr.io/<owner>/devops-reference/nginx:sha-a1b2c3d
```

- **Both frontend variants always build** — switching `FRONTEND_MODE` on the
  VPS must never require a rebuild.
- Layer cache: `type=gha` (GitHub Actions cache) per image.
- `permissions: packages: write` + ephemeral `GITHUB_TOKEN` → no long-lived
  registry secret in CI.
- The tag is uploaded as the `image-tag` artifact — the Deploy workflow reads
  it from the *exact* Release run that produced it (no "latest is probably
  fine" guessing).
- **Mirror job** (optional): if `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`
  secrets exist, pulls the GHCR images, retags, and pushes to
  `docker.io/<user>/devops-reference/*` — same digests, zero rebuild.
  With no secrets it's a skipped no-op (secrets can't be used in `if:`, so
  the gate is an `env` + step-level `if`).

Tags are immutable: re-running a Release rebuilds and overwrites the same
`sha-*` tag only if the commit moved (same SHA → same content inputs).

## 3. `deploy.yml` — approval, then promotion

Triggers:

- **`workflow_run`**: after a *successful* Release whose event was a `push`
  to `main` (docs-only releases don't deploy — they produce no images; the
  guard also requires `head_branch == main`).
- **`workflow_dispatch`**: manual — optional `image_tag` input, or the
  `rollback` checkbox.

The gate: `environment: production`. Configure
**Settings → Environments → production → Required reviewers** — the job then
sits in *"Waiting"* until someone with rights clicks **Approve**. That single
setting is the entire "manual approval" requirement; no custom code.

Sequence once approved:

1. **Resolve tag** — `workflow_run` → download the `image-tag` artifact from
   that run; dispatch → `image_tag` input (empty → `.env` pin / rollback).
2. **Secrets check** → **SSH configure** (key file 600, pinned or scanned
   `known_hosts`, `IdentitiesOnly=yes`).
3. **Run `deploy.sh` over SSH** with `IMAGE_TAG=…` — the script owns every
   subsequent step (see below).
4. `if: failure()` → best-effort diagnostics (`compose ps` + last 60 log
   lines) so the failing PR/author sees *why* without shell access.
5. `if: always()` → remove the key file.

Concurrency: `group: production-deploy`, **`cancel-in-progress: false`** — a
half-finished deploy must never be killed by a newer run.

### What `deploy.sh` does (the single deploy implementation)

| # | Step                      | Failure behavior                                   |
| - | ------------------------- | -------------------------------------------------- |
| 1 | `git pull --ff-only origin main` | abort — diverged checkout needs a human       |
| 2 | preflight: `.env`, Compose ≥ 2.24, sane `IMAGE_TAG`, `compose config -q` | abort **before touching the stack** |
| 3 | `compose pull`            | abort (set -e) — missing tag/image                 |
| 4 | `compose up -d --remove-orphans` | abort — includes the migrate gate            |
| 5 | **health gate** ≤ 60 s: `backend: /api/health` **and** `https://<domain>/` via `--resolve` (real TLS + SNI path) | fail → prints exact rollback command |
| 6 | record `.deploy-last-good`, rewrite `IMAGE_TAG` in `.env`, print `ps` | — |

Everything it prints is prefixed `[deploy]` so it reads as one transcript in
the Actions log.

`make prod` runs this same script — CI and humans cannot drift.

## 4. Rollback

Three equivalent ways:

```bash
# a) Actions:  Deploy → Run workflow → check "rollback"
#    (redeploys .deploy-last-good automatically)

# b) VPS: exact previous tag, discovered from state
IMAGE_TAG=$(cat .deploy-last-good) ./infra/deploy/deploy.sh

# c) VPS: pick any tag from the GHCR package history
IMAGE_TAG=sha-<older> ./infra/deploy/deploy.sh
#    (or edit IMAGE_TAG in .env and: make prod)
```

Why this is fast and safe: images are immutable and self-contained (schema
included — migrations ran *before* the old backend started, and going
backwards intentionally does **not** auto-revert schema; if a rollback needs
an older schema, run `npm --prefix backend run migrate:down` consciously —
see [runbook.md](runbook.md)).

## 5. Branch protection (recommended settings)

On `main`:

- Require status checks: `backend`, `frontend`, `compose`
- Require branches up to date before merging
- (Optional) require 1 approving review

This makes "green CI → merge → Release" a property of the platform, not a
habit.

## 6. Local parity

| CI step            | Local command                     |
| ------------------ | --------------------------------- |
| backend/frontend   | `make lint typecheck test`        |
| compose job        | `make validate`                   |
| release build      | `make build`                      |
| deploy             | `IMAGE_TAG=… make prod`           |

## 7. Required configuration summary

| Where                       | Name                       | Purpose                        |
| --------------------------- | -------------------------- | ------------------------------ |
| Repo → Environments         | `production` + reviewers   | manual approval                |
| Repo → Actions → Secrets    | `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | SSH transport       |
|                             | `VPS_PORT`, `VPS_KNOWN_HOSTS` | optional hardening          |
|                             | `DOCKERHUB_*`              | optional mirror                |
| Repo → Actions → Variables  | `VPS_DEPLOY_DIR`           | checkout path (default OK)     |
| Repo → Branch protection    | required checks            | gate merges                    |
| Repo → Packages (GHCR)      | visibility / VPS pull auth | image access ([ssh-keys.md](ssh-keys.md)) |
| VPS `.env`                  | `IMAGE_REPO`, `DOMAIN`, …  | ([vps-setup.md](vps-setup.md)) |
