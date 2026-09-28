# Troubleshooting

Symptom → likely cause → fix. Ordered by layer, fastest checks first.
Universal first move: `make ps` and the boot log line
`site-config: mode=… tls_redirect=… cert=…`.

## Setup & local dev

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ERROR: .env not found` | never ran setup | `make setup` |
| `POSTGRES_PASSWORD missing` (compose) | empty/CHANGE-ME value in `.env` | set a real value (`openssl rand -hex 24`) |
| DB tests say *unreachable, skipped* | no local PostgreSQL | start the stack db (`make dev` does), or accept unit-only runs |
| `EADDRINUSE :3000` | stray dev server | `lsof -i :3000` → kill, or change `PORT` |
| Vite: `proxy error` to `/api` | backend not running | `make dev` runs both; check `curl :3000/api/health` |
| `tsx: command not found` / no hot reload | deps not installed in that app | `npm --prefix backend install` |
| Migration fails: *default for column … is a query* | plain-string function default | use `PgLiteral.create('gen_random_uuid()')` (see local-dev doc) |
| Weird test DB name / wrong DB hit | `DATABASE_URL` points somewhere odd | tests derive `<name>_test` from it — check `echo $DATABASE_URL` |

## Compose boot

| Symptom | Cause | Fix |
| --- | --- | --- |
| `unsupported config … !reset` | Compose < 2.24 | upgrade (`docker compose version`); bootstrap refuses old versions for this reason |
| `env file .env not found` | ran compose outside repo root / forgot `--env-file` | always run from root; use `make` targets (they pass the flags) |
| `port is already allocated` (8080/80/443) | another process/host stack | `lsof -i :80` …; dev ports are overridable (`HTTP_PORT`) |
| `migrate` exits 1 → backend never starts | migration error — **by design** | `$DC logs migrate`, fix/add migration, `up -d` again |
| backend healthy in dev, 503 in stack | wrong `DATABASE_URL` (host vs container host) | in containers the host is `db`, never `127.0.0.1` — use the compose value |
| bind-mount edits not picked up (macOS) | file-watch misses through mounts | `$DC restart backend` |
| `pull` fails: *manifest unknown* | tag doesn't exist yet (e.g. `IMAGE_TAG=main` before first release) | set the `sha-*` from GHCR/Actions, or build locally |

## Edge (nginx)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `nginx: [emerg] unexpected "}"` etc. | rendered template broken | `$DC logs nginx` — entrypoint errors print *before* nginx starts; check `NGINX_MODE`, `DOMAIN` |
| `unknown directive` / `$host` empty | envsubst ate nginx variables | only possible if the entrypoint allow-list broke — inspect `45-site-config.sh` (`DEFINED_ENVS`) |
| 502 from `/` or `/api` | upstream down or IP stale | `$DC ps` (backend/frontend healthy?) — resolver+`$var` proxy re-resolves in ≤10 s, so a *persistent* 502 means the app is really down |
| 502 right after deploy, self-heals ~10 s | old container IP during recreate | normal; if it never heals: `$DC restart nginx` |
| 429 | rate limit (30 r/s site, 10 r/s api) | burst beyond that; raise `limit_req_zone` in `nginx.conf` if legit traffic |
| Double compression / no brotli | brotli build fell back | boot log shows `brotli: NOT available` — gzip still works; rebuild later |
| Wrong container serves `/` | mode mismatch | `NGINX_MODE` must equal `FRONTEND_MODE`; recreate nginx after changing either |
| Security headers missing on `/healthz` | nginx `add_header` inheritance: that location `return`s without `add_header` | by design (no body to protect); never add `add_header` to that location without re-adding all headers |
| Access log has no `$request_id` | old config baked in | recreate container (config is rendered at start) |

## TLS

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Unauthorized` from Let's Encrypt | DNS / :80 unreachable / edge down | `dig +short $DOMAIN`; `curl http://$DOMAIN/.well-known/acme-challenge/x`; `ufw status` |
| `RateLimited` | too many staging/prod attempts | wait (hours–week), use `--staging` while iterating |
| Redirect loop | redirect enabled while testing HTTP-only | `ENABLE_TLS_REDIRECT=0` → `up -d nginx`; ACME path and `/healthz` are never redirected |
| Renewal never runs | cron missing/other user | `crontab -l`; rerun `issue-ssl.sh` (idempotent install) |
| Renewal runs, old cert still served | reload hook skipped | `$DC exec nginx nginx -s reload`; check hook output in `certbot/logs/cron.log` |
| Browser "not secure" on :443 | self-signed fallback in use (no LE files) | confirm `certbot/letsencrypt/live/$DOMAIN/*.pem` exist → recreate nginx → boot log shows the real path |
| Clock-skew `invalid token` | wrong server time | `timedatectl` / install `ntp`/`systemd-timesyncd` |

## Backend / API

| Symptom | Cause | Fix |
| --- | --- | --- |
| 503 health but process up | DB unreachable / wrong URL | `$DC logs backend`; `exec db pg_isready` |
| 500 with `requestId` | logged exception | take that `requestId` → `$DC logs backend \| grep <id>` (edge forwarded the same id) |
| CORS errors (prod) | `CORS_ORIGINS` missing scheme/`https://` | fix `.env`, `up -d backend` |
| Rate limiting blocks a real user | trusting wrong IP (no `TRUST_PROXY`) | stack sets `TRUST_PROXY=1`; direct-host `make dev` sets none — both correct; never set it when there's no proxy |
| `SIGTERM` exits ugly / logs cut | shutdown not completing | check grace: `stop_grace_period` 30 s prod; see `src/index.ts` |
| 404 on all routes after deploy | wrong `NODE_ENV`/dist missing | prod image must run `runtime` stage (`npm run build`); verify `$DC images` tag |

## Database / migrations

| Symptom | Cause | Fix |
| --- | --- | --- |
| `password authentication failed` | `.env` changed after initdb | `ALTER USER … WITH PASSWORD` (runbook) — initdb only sets it once |
| `database does not exist` | volume from older setup | `$DC exec db psql -U app -c 'CREATE DATABASE appdb'` or restore |
| Migration applied but no effect | TS migration not compiled/run under node | migrations **must** run via `tsx` (that's why it's a prod dependency) |
| Test suite touches dev data | impossible by construction — unless `DATABASE_URL` already ends `_test` | check derived URL in global-setup warning |
| Disk full: `could not extend relation` | volume at capacity | `docker system df`; prune images; move old dumps off-box |
| Duplicate key on deploy | seed/migration ran twice | migrations are tracked in `node-pg_migrations` — a *tracked* migration re-running means the table was wiped; restore from dump |

## Frontend modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| After switching mode, old UI still served | nginx recreated with old env / orphan container | `up -d --remove-orphans` (deploy.sh does both) |
| `frontend-<mode>: manifest unknown` | mode switched before that image was released | CI builds *both* — pull again, or `make build` locally |
| Server mode: asset 404 served as HTML | by design (no SPA fallback for files with extensions) | check the asset path; the loud 404 beats a broken page |
| `/healthz` differs between modes | static returns `ok` text, server returns JSON | probes only assert HTTP 200 — both fine |

## CI / CD / SSH

| Symptom | Cause | Fix |
| --- | --- | --- |
| CI: "tests were skipped" failure | PG service not reachable (or a suite `runIf` misfired) | read the vitest output above the error — service logs are in the job |
| Release doesn't run | `paths-ignore` (docs-only push) or not `main` | push a code change; check workflow file validity |
| Deploy stuck "Waiting" | environment approval not configured/assigned | Settings → Environments → `production` → required reviewers |
| `Permission denied (publickey)` from deploy | wrong/absent `VPS_SSH_KEY`, or user/permissions | test locally: `ssh -i key user@host echo ok`; perms 600/700 on VPS |
| `Host key verification failed` | unknown/changed host | pin `VPS_KNOWN_HOSTS` (ssh-keyscan) — or accept-new warning path |
| `docker pull: denied` on VPS | private GHCR + no login | `docker login ghcr.io` as the deploy user, or make packages public |
| Deploy: `git pull failed` | local changes/divergence on VPS | `git -C $VPS_DEPLOY_DIR status`; never edit files on the server |
| Health gate 60 s timeout | slow pulls or app crash loop | Actions already prints `compose ps` + logs on failure; locally: `$DC logs --tail=100` |
| Deploy succeeded but old version visible | CDN/browser cache or wrong image tag | hard refresh; `$DC images` vs `.deploy-last-good`; HTML is `no-cache` so this is rare |
| Rollback didn't revert schema | by design | `migrate:down` consciously (runbook) |
