#!/usr/bin/env bash
# =============================================================================
# Renew all Let's Encrypt certificates, then reload the edge.
# Invoked by the cron job installed in vps-bootstrap.sh (03:17 daily);
# certbot itself only reissues when the cert is within 30 days of expiry.
#
# Paths are repo-local — same rationale as issue-ssl.sh (no root, works with
# the bind-mounted config tree the compose file uses).
# =============================================================================
set -euo pipefail

# Extra args are passed through to `certbot renew` (e.g. --dry-run).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

command -v certbot >/dev/null || {
  echo "ERROR: certbot not installed" >&2
  exit 1
}

certbot renew --quiet \
  --config-dir certbot/letsencrypt \
  --work-dir certbot/work \
  --logs-dir certbot/logs \
  --deploy-hook "${ROOT}/infra/setup/ssl-deploy-hook.sh" \
  "$@"
