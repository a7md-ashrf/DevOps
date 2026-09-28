# TLS / HTTPS

How certificates are obtained, stored, served, and renewed in this stack —
and what happens when they're missing (dev).

## The pieces

```
                            Let's Encrypt
                                  ▲  HTTP-01 over :80
                                  │
   cron 03:17 → renew-ssl.sh → certbot ── writes ──▶ certbot/letsencrypt/live/<domain>/
                    │                                            │ (bind-mounted ro)
                    └── on success: ssl-deploy-hook.sh            ▼
                          docker compose exec nginx nginx -s reload
                                                                 nginx entrypoint
        issue-ssl.sh (first issuance, same webroot)              picks TLS_CERT/KEY
                                                                 renders template
   browser ── :80 ACME path served by nginx ──▶ certbot/www/     → conf.d/10-site.conf
               (never redirected — see below)
```

| Component                 | File                                        | Role                                  |
| ------------------------- | ------------------------------------------- | ------------------------------------- |
| Webroot                   | `certbot/www/` (repo root)                  | ACME HTTP-01 challenge files           |
| Certificates              | `certbot/letsencrypt/` (repo root)          | `live/<domain>/{fullchain,privkey}.pem` + renewal configs |
| First issuance            | `infra/setup/issue-ssl.sh`                  | `certbot certonly --webroot`, installs renewal cron |
| Renewal                   | `infra/setup/renew-ssl.sh` + cron           | `certbot renew` (auto within 30 days)  |
| Post-renew hook           | `infra/setup/ssl-deploy-hook.sh`            | graceful `nginx -s reload` in the stack|
| Serving                   | `nginx/templates/*.conf.template`           | `listen 8443 ssl` + cert paths         |
| Dev fallback              | `nginx/docker-entrypoint.d/45-site-config.sh` | self-signed pair when files absent   |
| Redirect                  | `ENABLE_TLS_REDIRECT` → `http-app.inc`      | `301 https://$host$request_uri`        |

**Why repo-local certbot dirs (no `/etc/letsencrypt`):** no `sudo` needed,
the compose file can bind-mount exactly the tree it serves, backups/rotation
are visible in one place, and wiping the container can't take the
certificates with it. The mount target is still `/etc/letsencrypt`, so the
template path is the "normal" one.

## HTTP port behaviour

The HTTP server block (port 8080 ← host 80) contains, in priority order:

1. `location = /healthz` — probes (never redirected)
2. `location /.well-known/acme-challenge/` — **prefix match beats `location /`**,
   so ACME revalidations keep working *even while the 301 redirect is active*.
   This is why renewal never needs the redirect disabled.
3. `location /` — either the redirect (`ENABLE_TLS_REDIRECT=1`) or the app
   (dev / pre-certificate).

HSTS lives only in `tls-hardening.conf`, included by the HTTPS block — the
plain-HTTP port can never advertise it.

## First issuance (walkthrough)

```bash
# 0. prerequisites: stack up (edge serving :80), DNS → server, UFW 80 open
make ssl-issue STAGING=1        # rate-limit-friendly dry run of the whole path
make ssl-issue                  # the real certificate
```

What `issue-ssl.sh` does:

1. probes `http://127.0.0.1/.well-known/acme-challenge/…` and warns if the
   edge isn't answering (helps distinguish "LE can't reach me" from
   "my own stack isn't up");
2. `certbot certonly --webroot -w certbot/www -d <domain>` with repo-local
   `--config-dir/--work-dir/--logs-dir`;
3. passes `--deploy-hook ssl-deploy-hook.sh` **and** appends `renew_hook =`
   to the renewal config if certbot didn't persist it (belt & braces);
4. installs the daily cron entry (idempotent, `grep`-guarded).

Then enable the redirect:

```bash
sed -i 's/ENABLE_TLS_REDIRECT=0/ENABLE_TLS_REDIRECT=1/' .env
docker compose --env-file .env -f infra/docker-compose.yml \
  -f infra/docker-compose.prod.yml up -d nginx
```

Verify:

```bash
curl -sI http://yourdomain.com/          # HTTP/1.1 301 ... Location: https://...
curl -sI https://yourdomain.com/         # 200 + strict-transport-security
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null \
  | openssl x509 -noout -subject -dates -ext subjectAltName
```

## Development fallback (no certificate at all)

Local `make stack` (or a VPS before step *issue-ssl*) has no
`certbot/letsencrypt/...` files. The entrypoint then:

1. generates a 7-day self-signed cert (CN + SAN = `DOMAIN`, plus
   `localhost`) into `/tmp/nginx-dev-certs/` — container-local, gone on
   recreate, never committed (`*.pem` is gitignored as a second net);
2. logs `site-config: … cert=/tmp/nginx-dev-certs/dev.crt` at boot so
   it's obvious which material is live;
3. the HTTPS server block still boots → `https://localhost:8443` works with
   the browser warning you'd expect.

So: **config errors fail fast, but missing certs never fail the boot.**

## Renewal

```
03:17 daily → certbot renew (no-op unless <30 days left)
                ├─ not due      → exit 0
                └─ renewed      → deploy-hook → nginx -s reload (graceful)
```

- `--deploy-hook` runs only after a successful save → a renewal never
  reloads nginx for nothing.
- The hook uses `exec … nginx -s reload || echo skipped` — if the stack is
  down during renewal, certbot still succeeds and the next boot picks up
  the new files (the entrypoint reads them at start).
- Test any time without touching certificates:
  `make ssl-dry-run` (`certbot renew --dry-run`).
- Cron log: `certbot/logs/cron.log`.

## Operations

| Task                    | Command                                                       |
| ----------------------- | ------------------------------------------------------------- |
| See expiry              | `openssl x509 -in certbot/letsencrypt/live/<domain>/fullchain.pem -noout -enddate` |
| Force renewal now       | `make ssl-renew`                                              |
| Dry run                 | `make ssl-dry-run`                                            |
| Revoke                  | `certbot revoke --cert-path certbot/letsencrypt/live/<domain>/cert.pem --config-dir certbot/letsencrypt --work-dir certbot/work --logs-dir certbot/logs` |
| New domain              | `./infra/setup/issue-ssl.sh newdomain.com` + update `DOMAIN`/`CORS_ORIGINS` in `.env` |
| Disable redirect (emerg)| `ENABLE_TLS_REDIRECT=0` in `.env` + `compose up -d nginx`     |

Certificates survive deploys (bind mount), image updates (not baked in),
and container recreation — only deleting `certbot/` loses them (re-run
`issue-ssl.sh`; LE will reissue).

## Security notes

- `privkey.pem` is **never** copied into an image, logged, or committed —
  `.gitignore` blocks `*.pem`/`*.key` and the whole `certbot/` tree.
- TLS: only 1.2/1.3, modern cipher defaults from the unprivileged base
  image, `http2 on` (nginx ≥ 1.25.1 syntax).
- HSTS: present on HTTPS responses (`tls-hardening.conf`). Start without
  `includeSubDomains`-style stickiness in mind — the snippet's max-age can
  be extended once you're sure every subdomain is HTTPS-ready.
- Private key sits on the VPS root-owned `certbot/letsencrypt/...` path and
  is mounted **read-only** into the container as uid 101's read material.

## When something's wrong

| Symptom                                   | Likely cause → fix                             |
| ----------------------------------------- | ---------------------------------------------- |
| `issue-ssl.sh` "Unauthorized"             | DNS wrong / port 80 blocked / edge not up → [troubleshooting](troubleshooting.md) |
| Renewal cron never fires                  | cron installed under a different user → `crontab -l` |
| `404` on renewal                          | redirect on + ACME path not mounted → check `certbot/www` mount (prod file) |
| Browser: "not secure" but files exist     | `TLS_CERT/KEY` env pointing elsewhere → boot log line shows the active path |
| `nginx` won't start after cert copy       | key/cert mismatch → re-run `issue-ssl.sh`, `up -d nginx` |
