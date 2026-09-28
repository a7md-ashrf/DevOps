# Runbook — day-2 operations

Commands are copy-pasteable from the repo root on the VPS (or from Actions
where noted). The compose incantation is always:

```bash
DC="docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml"
```

(Makefile targets already do this — `make ps`, `make logs`, `make prod`…)

## Status

```bash
make ps                       # container states + health
$DC config -q                 # config still valid?
$DC images                    # which tags are actually running
curl -sk https://$DOMAIN/api/health
docker system df              # disk usage (images/build cache)
```

Healthy looks like: `db (healthy)`, `backend (healthy)`, `frontend (healthy)`,
`nginx (healthy)`, `migrate exited (0)` ← one-shot, **normal**.

## Deploy

```bash
make prod                              # = ./infra/deploy/deploy.sh (uses .env tag)
IMAGE_TAG=sha-a1b2c3d make prod        # explicit tag
# via CI: Actions → Deploy → Run workflow (or automatic after approval)
```

Order inside: git sync → preflight → pull → up → health gate → record. If
the gate fails it exits non-zero **and prints the rollback command** — it
never leaves you guessing what to type.

## Rollback

```bash
IMAGE_TAG=$(cat .deploy-last-good) ./infra/deploy/deploy.sh
# or: Actions → Deploy → Run workflow → ☑ rollback
```

Schema caveat: rolling back images does **not** revert migrations. If the
bad release migrated forward destructively:

```bash
$DC exec backend npm run migrate:down    # one step; repeat if needed
IMAGE_TAG=$(cat .deploy-last-good) ./infra/deploy/deploy.sh
```

Only do this if the old code actually needs the old schema — most
migrations are additive and the old release runs fine on the new schema.

## Restart / stop / start

```bash
$DC restart backend nginx        # targeted bounce (config unchanged)
$DC up -d backend                # recreate after env/volume changes
$DC stop frontend && $DC start frontend
$DC down                         # stop everything (keeps db volume)
$DC down -v                      # DANGER: also deletes the database volume
```

Edge config (template/mode/env) is rendered **at container start** — after
editing `DOMAIN`, `ENABLE_TLS_REDIRECT`, or `FRONTEND_MODE`, recreate (not
just `nginx -s reload`):

```bash
$DC up -d nginx                  # env changes  (recreates)
$DC exec nginx nginx -s reload   # only for cert material / snippet edits
```

## Logs

```bash
make logs                                  # everything (tail 100)
$DC logs -f --tail=200 backend
$DC logs -f nginx                          # JSON access log incl. request_id
```

Follow one request end-to-end:

```bash
# 1. edge gives you a request id (or generates one):
curl -sk https://$DOMAIN/api/tasks -D- -o /dev/null | grep -i request-id
# 2. grep the app log:
$DC logs backend | grep '<that-id>'
# 3. grep the edge log for the same id:
$DC logs nginx | grep '<that-id>'
```

## Database

```bash
make migrate                     # up   (compose runs this on deploy too)
make migrate-down                # roll back one
make seed                        # idempotent demo data
$DC exec db psql -U app -d appdb
$DC exec db psql -U app -d appdb -c '\dt'
$DC exec db psql -U app -d appdb -c "select pg_size_pretty(pg_database_size(current_database()))"
```

Emergency access when the app is misbehaving but the DB is up: stop the
writers (`$DC stop backend migrate`), investigate, start again.

## Change configuration

1. Edit `.env` (values are read at container start/recreate).
2. `$DC up -d` — compose recreates only services whose effective config
   changed (env diff), so a `DOMAIN` change touches nginx; a
   `POSTGRES_PASSWORD` change touches db+migrate+backend.
3. `POSTGRES_PASSWORD` change requires updating the **db** too (password is
   set at initdb only!):

   ```bash
   $DC exec db psql -U app -c "ALTER USER app WITH PASSWORD '<new>'"
   # then update .env and $DC up -d backend migrate
   ```

## TLS

```bash
make ssl-renew          # force renewal now
make ssl-dry-run        # simulate against LE
$DC exec nginx nginx -s reload     # after manual cert changes
```

Full story: [tls.md](tls.md).

## Backups & restore

```bash
make backup                            # dump + rotate (default policy in script)
./infra/backup/backup.sh 30            # custom retention (days)
./infra/backup/restore.sh backups/db-<stamp>-<sha>.sql.gz   # interactive!
```

Restore stops writers first and refuses to proceed without typing
`restore`. Details: [backups.md](backups.md).

## Disk housekeeping

```bash
docker system df
docker image prune -a                 # unused images (keeps running ones)
docker builder prune                  # build cache
$DC logs --tail=1                     # (logs are capped 10m×3 per container)
du -sh backups/ certbot/
```

Deployments pull a new tag set monthly-ish; `prune` reclaims the old ones.
Compose `x-logging` already prevents log-driven disk fill.

## Scaling? (honest answer: don't, on one box)

This stack is intentionally single-node: one `db` (no replication), one
backend, one edge. Horizontal scale needs an external DB, shared session
state, and a real LB — out of scope and *documented as such* in
[production-checklist.md](production-checklist.md). Vertical headroom:
raise `deploy.resources.limits` in the prod overlay if you outgrow them.

## Incident quick-ref

| Symptom                    | First move                                        |
| -------------------------- | ------------------------------------------------- |
| Site down after deploy     | `IMAGE_TAG=$(cat .deploy-last-good) ./infra/deploy/deploy.sh` |
| Site down, no recent deploy| `make ps` → restart unhealthy: `$DC up -d <svc>`  |
| 502 from edge               | `$DC ps` frontend/backend; `$DC logs nginx | tail` |
| DB full / disk full        | `docker system df`; prune; check `backups/` growth|
| Cert expired (renew failed)| `make ssl-renew` → read `certbot/logs/` → fix → hook reloads |
| Need a human triage guide  | [troubleshooting.md](troubleshooting.md)          |
