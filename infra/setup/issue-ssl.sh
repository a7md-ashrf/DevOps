#!/usr/bin/env bash
# =============================================================================
# Issue (or re-issue) the Let's Encrypt certificate for a domain.
#   ./infra/setup/issue-ssl.sh example.com [--staging]
#
# Runs certbot in WEBROOT mode against the repo-local certbot/ tree — no
# sudo, no root-owned /etc/letsencrypt, and it works while the stack is
# running because the edge Nginx serves /.well-known/acme-challenge/ from
# the same directory (mounted into the container).
#
# The resulting files land in certbot/letsencrypt/live/<domain>/, which the
# production compose file mounts at /etc/letsencrypt — the path the Nginx
# template expects (TLS_CERT/TLS_KEY).
#
# --staging: use LE's staging CA (rate-limit friendly; browsers still
# complain, but it validates the whole HTTP-01 plumbing). Recommended on the
# first run.
# =============================================================================
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "${DOMAIN}" || "${DOMAIN}" == -* ]]; then
  echo "usage: $0 <domain> [--staging]" >&2
  exit 1
fi
shift || true
EXTRA_ARGS=("$@")

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

command -v certbot >/dev/null || {
  echo "ERROR: certbot not installed — run infra/setup/vps-bootstrap.sh first" >&2
  exit 1
}
mkdir -p certbot/www certbot/letsencrypt certbot/work certbot/logs

# Is the edge already answering the challenge?
if command -v curl >/dev/null; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' \
    "http://127.0.0.1/.well-known/acme-challenge/healthcheck-probe" || true)"
  case "${CODE}" in
    200 | 404) : ;; # 404 = our server answered (file missing) => plumbing OK
    *)
      echo "WARNING: edge answered HTTP ${CODE} for the ACME path." >&2
      echo "         Is the stack running (make prod) and port 80 reachable?" >&2
      ;;
  esac
fi

echo "==> requesting certificate for ${DOMAIN}"
certbot certonly \
  --non-interactive --agree-tos \
  --register-unsafely-without-email \
  --webroot -w certbot/www \
  --cert-name "${DOMAIN}" \
  -d "${DOMAIN}" \
  --config-dir certbot/letsencrypt \
  --work-dir certbot/work \
  --logs-dir certbot/logs \
  --deploy-hook "${ROOT}/infra/setup/ssl-deploy-hook.sh" \
  "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"

# Belt and braces: make sure the renewal config carries the reload hook even
# if a future certbot version stops persisting CLI hooks.
RENEWAL_CONF="certbot/letsencrypt/renewal/${DOMAIN}.conf"
if [[ -f "${RENEWAL_CONF}" ]] && ! grep -q "^renew_hook *=" "${RENEWAL_CONF}"; then
  echo "renew_hook = ${ROOT}/infra/setup/ssl-deploy-hook.sh" >>"${RENEWAL_CONF}"
fi

# Install the daily renewal job in THIS user's crontab (idempotent). Certbot
# only reissues within 30 days of expiry, so a once-a-day run is cheap.
CRON_LINE="17 3 * * * cd ${ROOT} && ./infra/setup/renew-ssl.sh >> ${ROOT}/certbot/logs/cron.log 2>&1"
CURRENT_CRON="$(crontab -l 2>/dev/null || true)"
if ! printf '%s\n' "${CURRENT_CRON}" | grep -qF "infra/setup/renew-ssl.sh"; then
  printf '%s\n%s\n' "${CURRENT_CRON}" "${CRON_LINE}" | sed '/^$/d' | crontab -
  echo "==> installed daily renewal cron (03:17): ${CRON_LINE}"
fi

cat <<EOF

Certificate ready: certbot/letsencrypt/live/${DOMAIN}/{fullchain,privkey}.pem
Next:
  1. In .env set  ENABLE_TLS_REDIRECT=1  (if it isn't already)
  2. Restart the edge:  docker compose --env-file .env \\
       -f infra/docker-compose.yml -f infra/docker-compose.prod.yml \\
       up -d nginx
EOF
