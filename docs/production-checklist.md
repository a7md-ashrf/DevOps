# Production checklist

Two parts: **(A)** what you must verify before going live — including every
Docker-dependent check this repository was authored on a machine *without*
a container runtime, so they're listed explicitly rather than assumed — and
**(B)** the deliberate hardening/ops backlog that this single-node reference
leaves as documented next steps.

## A. Pre-launch verification

### A1. Already verified during authoring (re-run if you touch the code)

```bash
make lint          # eslint + prettier, both apps      ✓ 0 problems
make typecheck     # tsc --noEmit, both apps           ✓
make test          # 40 backend + 8 frontend           ✓ (needs PG for 26 of them)
```

Also statically checked: all five YAML files parse (workflows + both compose
files, `!reset` tag included), every shell script passes `bash -n`/`sh -n`,
`make -n <target>` renders the intended recipes.

### A2. Docker-dependent checks — **run these; they could not run here**

```bash
# 1. Config semantics (interpolation, !reset, anchors, paths)
cp .env.example .env && make validate

# 2. Images actually build
make build
#    expect: brotli stage prints either "brotli: enabled" or a WARNING
#            (build must SUCCEED either way — that's the fallback design)

# 3. Dev topology boots and answers (static mode)
make stack            # expect: "Stack up in 'static' mode" in ≤60 s
make ps               # db/backend/frontend/nginx healthy, migrate exited (0)
curl -i localhost:8080/healthz
curl -i localhost:8080/api/health
curl -skI localhost:8443/ | head -5     # TLS with the dev fallback cert
docker compose --env-file .env logs nginx | grep site-config
#    expect: mode=static tls_redirect=0 cert=/tmp/nginx-dev-certs/dev.crt

# 4. Server mode end-to-end
sed -i 's/FRONTEND_MODE=static/FRONTEND_MODE=server/' .env
make stack && curl -i localhost:8080/healthz    # JSON now: {"mode":"server"}
docker compose --env-file .env logs nginx | grep 'mode=server'
sed -i 's/FRONTEND_MODE=server/FRONTEND_MODE=static/' .env && make stack

# 5. Prod overlay boots (on a machine where 80/443 are free)
docker compose --env-file .env -f infra/docker-compose.yml \
  -f infra/docker-compose.prod.yml config | grep -E 'published|target'
#    expect: NO published 5432/3000; 80->8080, 443->8443 only
#    (this validates the !reset semantics — compose < 2.24 fails loudly)

# 6. TLS real-world path (staging first!)
make ssl-issue STAGING=1 && make ssl-dry-run
```

On the VPS after first deploy ([vps-setup.md](vps-setup.md)):

```bash
curl -sI  http://<domain>/            # 301 → https
curl -skf https://<domain>/           # 200
curl -skf https://<domain>/api/health # 200 {"data":{"status":"ok"}}
curl -sI  https://<domain>/ | grep -i strict-transport-security
echo | openssl s_client -connect <domain>:443 -servername <domain> \
  | openssl x509 -noout -dates        # Not After ~90 days out
./infra/deploy/deploy.sh              # second deploy: only recreate changed
IMAGE_TAG=$(cat .deploy-last-good) ./infra/deploy/deploy.sh   # rollback drill
./infra/backup/backup.sh              # + restore drill per backups.md
```

### A3. Repository/platform configuration

- [ ] `.env` exists on VPS, `CHANGE-ME` values all replaced
      (`POSTGRES_PASSWORD` = `openssl rand -hex 24`)
- [ ] `DOMAIN` correct; DNS A record live; `CORS_ORIGINS=https://<domain>`
- [ ] `IMAGE_REPO` matches `ghcr.io/<owner>/devops-reference`
- [ ] GHCR: packages public **or** `docker login ghcr.io` done on VPS
- [ ] GitHub environment `production` has **required reviewers** ← the approval gate
- [ ] Branch protection on `main` requires `backend` / `frontend` / `compose`
- [ ] Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
      (+ `VPS_KNOWN_HOSTS` pinned, `VPS_PORT` if ≠22) — [ssh-keys.md](ssh-keys.md)
- [ ] Optional: `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` (mirror), `VPS_DEPLOY_DIR`
- [ ] Cron present: `crontab -l` → renewal (03:17) + your backup line
- [ ] `ENABLE_TLS_REDIRECT=1` after the real certificate exists
- [ ] Backup off-box copy configured ([backups.md](backups.md))
- [ ] `.env` + deploy key stored in the team password manager
- [ ] Someone on the team has run a full
      [restore drill](backups.md#restore-drills-do-this-before-you-need-it)

### A4. Security posture shipped with this repo

Present (verify once, then trust the code review):

- [ ] non-root edge (`nginx-unprivileged`, uid 101), non-root frontend/backend
- [ ] `no-new-privileges` on all services; `cap_drop: ALL` on node services
- [ ] DB/API publish **no host ports** in prod (`ports: !reset []`)
- [ ] two-network segmentation (edge never touches `backend_net`)
- [ ] HSTS only on HTTPS server block; CSP/`XFO`/`nosniff` on every response
- [ ] rate limits at edge **and** in Express (two independent lines)
- [ ] secrets: `.env` gitignored, `*.pem`/`certbot/`/`backups/` ignored, no
      credentials in images, registry creds are ephemeral `GITHUB_TOKEN`
- [ ] resource limits + log rotation caps (disk can't be filled by logs)

## B. Deliberate backlog (documented next steps, not gaps)

Singly or together, these take the reference from "solid single node" to
"boringly reliable":

**Hardening**

1. `read_only: true` root filesystems + explicit `tmpfs` — needs a round of
   testing against the entrypoint's writes to `conf.d` (skip-listed on
   purpose rather than shipped untested).
2. `cap_drop: ALL` on `db` and `nginx` too — DB init/chown paths and the
   unprivileged entrypoint need empirical verification first.
3. fail2ban / `ufw` rate limiting at the host perimeter (app-level limits
   already exist).
4. Image signing (cosign) + SBOM (buildx `--sbom=true`) in Release.
5. Central secret store (SOPS/age or a managed vault) instead of `.env` on
   the box.

**Observability**

6. Ship logs off-box (vector/promtail → Loki) — today: local rotation only.
7. Metrics + alerting: `node_exporter`/`postgres_exporter` + Alertmanager,
   or a hosted probe on `/api/health` (the 503-on-DB-down semantics make it
   a truthful uptime signal).
8. Uptime monitor from outside (catches "health gate passed, DNS broken").

**Data**

9. WAL archiving / PITR (basebackup + continuous archive) — current scheme
   is snapshot-at-cron ([backups.md](backups.md#what-this-scheme-does-not-cover)).
10. Encrypted off-site backups with scheduled restore automation.

**Scale-out (when actually needed)**

11. Managed/replicated Postgres before adding app replicas.
12. Sessions/stateless check before `--scale backend` (this app is already
    stateless; the DB is the wall).
13. Real LB/CDN in front (then `TRUST_PROXY` hop count needs revisiting).

**Process**

14. Dependabot/Renovate for base images and npm.
15. Nightly `make validate` + full test run on a schedule (catches bit-rot
    in branches that don't get PRs).

---

Go/no-go: **A2 fully green on a real machine + A3 checked = ship.**
Everything in B can land later without a migration — that's the point of
having it written down.
