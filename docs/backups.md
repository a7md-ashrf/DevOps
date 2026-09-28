# Backups & disaster recovery

What is backed up, how, how often, and how to get back up. Scope is honest:
this project backs up the **database** (the only state that matters) plus the
things you should mirror separately (`.env`, certificates).

## What exists, what's at risk

| Data                          | Volatile?  | Backup mechanism                              |
| ----------------------------- | ---------- | --------------------------------------------- |
| PostgreSQL data (volume `pgdata`) | **yes** — container/volume loss = data loss | `infra/backup/backup.sh` (pg_dump) |
| Certificates (`certbot/`)     | semi       | reissuable in minutes; cheap to rsync anyway  |
| `.env`                        | config     | keep a copy in your password manager          |
| Images                        | no         | re-pullable by tag from GHCR                  |
| Source                        | no         | git                                            |
| Container logs                | no (wanted)| rotated away by design                        |

The dump is **logical** (`pg_dump`), not a filesystem snapshot — it's
portable across versions/architectures and restores into a fresh stack,
which is exactly what a DR scenario looks like.

## Taking backups

```bash
./infra/backup/backup.sh          # default retention: 14 days
./infra/backup/backup.sh 30       # keep a month
make backup                       # same thing via Makefile
```

Produces (in `backups/`, gitignored):

```
db-20260928-041700-a1b2c3d.sql.gz
db-20260928-041700-a1b2c3d.sql.gz.sha256
```

The filename encodes timestamp **and git SHA of the code that was live** —
when you're staring at a week of dumps during an incident, that SHA tells
you which migration level the dump is at.

Script properties (all deliberate):

- `set -euo pipefail` — a failed `pg_dump` piping into `gzip` would
  otherwise exit **0** with a truncated archive;
- dump runs **inside** the db container (`exec`) — no host `psql` needed;
- `--clean --if-exists --no-owner` — the dump can be applied to a database
  that already has tables (idempotent-ish restore);
- `gzip -t` integrity check + `sha256` sidecar before declaring success;
- retention prune by `-mtime`.

### Schedule (recommended)

```bash
crontab -e
17 4 * * * cd /srv/devops-reference && ./infra/backup/backup.sh 14 >> /srv/devops-reference/backups/backup.log 2>&1
```

### The 3-2-1 gap (do this part)

A dump on the same disk as the database protects against *app bugs*, not
*disk death*. Add an off-box copy:

```bash
# push to another host / NAS, hourly, via SSH
7 * * * * rsync -a --delete /srv/devops-reference/backups/ nas:/backups/devops-reference/
# or restic/rclone to object storage — anything beats same-disk
```

## Restoring

```bash
./infra/backup/restore.sh backups/db-20260928-041700-a1b2c3d.sql.gz
# type: restore
```

Sequence (write-safe ordering):

1. **verify** `gzip -t` + `.sha256` — refuses to restore a corrupt archive;
2. interactive confirmation (`-y` for scripted use);
3. **stop writers** (`backend`, `migrate`) — the DB itself stays up;
4. `psql -v ON_ERROR_STOP=1` — first error aborts loudly instead of leaving
   a half-restored database *quietly*;
5. **restart writers** (also on the failure path — the stack never stays
   down because of a restore attempt).

Verify afterwards:

```bash
$DC exec backend wget -qO- http://127.0.0.1:3000/api/health
$DC exec db psql -U app -d appdb -c 'select count(*) from tasks;'
```

### Restoring into a **fresh** stack (disaster recovery)

The interesting case — old server gone:

```bash
# 1. new box: vps-bootstrap.sh, clone repo, .env (from password manager!)
# 2. do NOT issue a cert yet if DNS still points at the dead box's twin
# 3. start the data tier only:
$DC up -d db
# 4. copy the dump over and restore (script works as-is):
scp backups/db-<stamp>-<sha>.sql.gz deploy@newbox:/srv/devops-reference/backups/
./infra/backup/restore.sh backups/db-<stamp>-<sha>.sql.gz -y
# 5. full deploy (image tag = the git SHA in the dump's filename!):
IMAGE_TAG=sha-<from-filename> make prod
# 6. repoint DNS, issue cert, flip ENABLE_TLS_REDIRECT
```

The `git SHA in the dump filename` convention collapses the hardest part of
DR — "which code version matches this data?" — into a filename read.

## Certificates (DR side note)

Losing `certbot/` is **not** an emergency:

```bash
./infra/setup/issue-ssl.sh <domain>      # LE reissues (respect rate limits)
```

Still, keeping `certbot/` rsynced alongside backups avoids rate-limit
anxiety:

```bash
rsync -a certbot/ nas:/backups/devops-reference/certbot/
```

## What this scheme does NOT cover

- **Point-in-time recovery** — pg_dump is a snapshot at cron time; up to
  `interval` of writes can be lost. WAL archiving would fix that; documented
  as a next step in
  [production-checklist.md](production-checklist.md).
- **The `.env` file** — not dumped anywhere by the scripts (it contains the
  DB password that's *inside* the dump anyway…). Store it in your password
  manager at setup time; the runbook assumes you have it.
- **Multi-node failover** — single box by design.

## Restore drills (do this before you need it)

Quarterly, on a scratch machine or local Docker:

1. `make setup && cp <prod>.env.example .env` (fresh stack);
2. `docker compose … up -d db`;
3. restore a **recent prod dump**;
4. sanity: hit `/api/health`, list rows, confirm counts look right;
5. time it. If step 2–4 take 40 minutes of archaeology, automate it now —
   an untested backup is a hypothesis, not a backup.

Checklist form: [production-checklist.md](production-checklist.md).
