# VPS setup — bare Ubuntu → production

Target: fresh **Ubuntu 22.04/24.04** VPS (1–2 vCPU / 2 GB RAM is plenty for
this stack), a domain pointed at it, and a GitHub repository with Actions.

Costs nothing but attention: every step is idempotent and printed commands
are copy-pasteable.

## 0. DNS

Create **before anything else** (propagation + LE rate limits):

```
A     @       <your-server-ip>
A     www     <your-server-ip>     # optional; not configured by default
```

Verify: `dig +short yourdomain.com` → your IP.

## 1. Create a deploy user

On the VPS, as root:

```bash
adduser deploy
usermod -aG sudo,docker deploy
# password login can stay; key auth is configured next (ssh-keys.md)
```

## 2. Get the project onto the server

```bash
# from your machine
git clone <your-repo-url>   # or: rsync -a --exclude node_modules . deploy@<ip>:/srv/devops-reference/
```

Recommended location: `/srv/devops-reference` (everything below assumes it;
change consistently if not — it's also the `VPS_DEPLOY_DIR` Actions variable).

## 3. Bootstrap the machine

```bash
cd /srv/devops-reference
sudo ./infra/setup/vps-bootstrap.sh /srv/devops-reference
```

Installs (idempotent, re-runnable):

- Docker Engine + Compose plugin — **verifies Compose ≥ 2.24** (prod file
  uses `!reset`; the script refuses to continue on older versions)
- Certbot, git, curl, ufw, jq
- UFW: `deny incoming`, allow **22 / 80 / 443** only (5432, 3000, 8080 are
  deliberately never opened — they aren't public services)
- `certbot/{www,letsencrypt,work,logs}` + `backups/` directory layout

## 4. Configure `.env`

```bash
cd /srv/devops-reference
cp .env.example .env
```

Edit — the non-obvious lines:

| Line                  | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| `POSTGRES_PASSWORD`   | `openssl rand -hex 24` (**hex**, not base64 — URL safety)     |
| `DOMAIN`              | your real domain (cert CN/SAN + `server_name` + Host header) |
| `CORS_ORIGINS`        | `https://yourdomain.com` (scheme included!)                  |
| `IMAGE_REPO`          | `ghcr.io/<github-owner>/devops-reference`                    |
| `IMAGE_TAG`           | leave as-is; the first successful CI deploy rewrites it      |
| `ENABLE_TLS_REDIRECT` | `0` until the certificate exists (step 6), then `1`          |
| `FRONTEND_MODE`       | `static` (default) or `server`                               |

`make setup` on the server is optional (it installs node_modules for local
tooling like `make migrate`; the containers don't need them).

## 5. Registry access (if GHCR images are private)

The stack **pulls** images; it never builds on the VPS. GHCR packages are
private by default → either:

- **Option A (simplest):** GitHub → Settings → Packages → make the four
  `devops-reference/*` packages public, **or**
- **Option B:** classic PAT with `read:packages`, then on the VPS:

  ```bash
  docker login ghcr.io -u <github-user>   # paste the PAT
  # credentials land in ~/.docker/config.json — persist across reboots
  ```

Details and the deploy-key setup CI needs: [ssh-keys.md](ssh-keys.md).

## 6. TLS certificate

```bash
cd /srv/devops-reference

# First, STAGING (rate-limit friendly; validates the HTTP-01 plumbing):
./infra/setup/issue-ssl.sh yourdomain.com --staging

# Then for real:
./infra/setup/issue-ssl.sh yourdomain.com
```

Requirements: stack running (or at least edge + frontend) **and** port 80
reachable from the internet — LE must fetch
`http://yourdomain.com/.well-known/acme-challenge/...`.

The script also installs the daily renewal cron (03:17) and wires the
deploy hook (`ssl-deploy-hook.sh` → graceful nginx reload).

Now flip the redirect:

```bash
sed -i 's/ENABLE_TLS_REDIRECT=0/ENABLE_TLS_REDIRECT=1/' .env
```

More: [tls.md](tls.md).

## 7. First deploy

Two supported paths:

**A. Normal path (CI-driven):** merge your branch to `main` → `Release`
builds `sha-*` images → Actions shows *Deploy / deploy to production*
**Waiting for approval** → reviewer clicks *Approve* → job SSHes in and runs
`deploy.sh`. See [ci-cd.md](ci-cd.md).

**B. Manual first deploy** (bootstrap, or no Actions yet):

```bash
# pick the tag Release just pushed (or build images yourself with make build + push)
IMAGE_TAG=sha-<short> make prod
```

`deploy.sh` (what `make prod` runs) performs: git sync → `compose pull` →
`up -d` → **health gate** (`/api/health` + `https://<domain>/`) → records
`.deploy-last-good` → pins `IMAGE_TAG` in `.env`.

## 8. Verify

```bash
curl -sI http://yourdomain.com/ | head -3          # 301 to https
curl -sk https://yourdomain.com/ | head -3         # the app
curl -sk https://yourdomain.com/api/health         # {"data":{"status":"ok"}}
docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml ps
```

Browser: lock icon, no mixed content, tasks demo loads. If anything fails →
[troubleshooting.md](troubleshooting.md).

## 9. Recurring jobs

Already scheduled by earlier steps:

- **TLS renewal:** cron 03:17 (`issue-ssl.sh` installed it) → `renew-ssl.sh`
  → deploy hook reloads nginx. `make ssl-dry-run` simulates any time.
- **Log rotation:** Docker `json-file` driver capped at 10 MB × 3 files per
  container (compose `x-logging`) + daemon defaults from the bootstrap.

Add **backups** (recommended — not automatic):

```bash
crontab -e
# every day at 04:17, keep 14 days
17 4 * * * cd /srv/devops-reference && ./infra/backup/backup.sh 14 >> /srv/devops-reference/backups/backup.log 2>&1
```

Off-box the dumps: `rsync -a --delete /srv/devops-reference/backups/ user@nas:/backups/devops-reference/`
(or a restic/rclone job). See [backups.md](backups.md).

## 10. GitHub repository settings (one time)

- Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, (`VPS_PORT`,
  `VPS_KNOWN_HOSTS` recommended) — [ssh-keys.md](ssh-keys.md)
- Variable: `VPS_DEPLOY_DIR` (if not `/srv/devops-reference`)
- Environment **`production`** with *Required reviewers* — this **is** the
  manual approval gate
- Branch protection on `main`: require the **CI** checks to pass
- Optional: `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` for the mirror job

## Done

Day-2 operations live in [runbook.md](runbook.md); go-live hardening and
things this machine could not verify for you (Docker-dependent checks) are
in [production-checklist.md](production-checklist.md).
