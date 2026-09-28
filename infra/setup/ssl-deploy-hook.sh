#!/bin/sh
# =============================================================================
# Certbot deploy hook — runs ONLY after a (re)issued cert is saved.
# Reloads the edge Nginx inside the compose stack so it picks up the new
# files without dropping in-flight connections (nginx -s reload = graceful).
#
# Referenced from issue-ssl.sh (--deploy-hook) and the renewal config
# (renew_hook). `|| true` keeps certbot from reporting a renewal failure
# when the stack is intentionally down — the next reload picks it up.
# =============================================================================
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "${ROOT}"

echo "ssl-deploy-hook: reloading nginx"
docker compose --env-file .env \
  -f infra/docker-compose.yml \
  -f infra/docker-compose.prod.yml \
  exec -T nginx nginx -s reload || \
  echo "ssl-deploy-hook: nginx reload skipped (stack not running?)"
