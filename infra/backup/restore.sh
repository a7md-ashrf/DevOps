#!/usr/bin/env bash
# =============================================================================
# Database restore — DESTRUCTIVE, overwrites the current database:
#   ./infra/backup/restore.sh backups/db-20260928-031500-a1b2c3d.sql.gz [-y]
#
# Procedure (write-safe ordering matters):
#   1. verify the archive (gzip integrity + optional .sha256)
#   2. STOP the app writers (backend + migrate) so nothing races the restore
#   3. psql restore with ON_ERROR_STOP=1 (abort on first error, no partial
#      silent success)
#   4. restart services
#
# The DB itself stays up the whole time — only writers are stopped.
# =============================================================================
set -euo pipefail

DUMP="${1:-}"
ASSUME_YES="${2:-}"

if [[ -z "${DUMP}" ]]; then
  echo "usage: $0 <dump.sql.gz> [-y]" >&2
  exit 1
fi
if [[ ! -f "${DUMP}" ]]; then
  echo "ERROR: no such file: ${DUMP}" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

echo "==> verifying archive"
gzip -t "${DUMP}"
if [[ -f "${DUMP}.sha256" ]]; then
  (cd "$(dirname "${DUMP}")" && shasum -a 256 -c "$(basename "${DUMP}").sha256" 2>/dev/null) ||
    (cd "$(dirname "${DUMP}")" && sha256sum -c "$(basename "${DUMP}").sha256")
fi

if [[ "${ASSUME_YES}" != "-y" ]]; then
  echo "!! This will OVERWRITE the database with ${DUMP} !!"
  read -r -p "Type 'restore' to continue: " ANSWER
  if [[ "${ANSWER}" != "restore" ]]; then
    echo "aborted"
    exit 1
  fi
fi

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)

echo "==> stopping writers (backend, migrate)"
"${COMPOSE[@]}" stop backend migrate

echo "==> restoring (ON_ERROR_STOP=1)"
if ! gunzip -c "${DUMP}" | "${COMPOSE[@]}" exec -T db sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; then
  echo "!! restore FAILED — the database may be in a partial state; fix the" >&2
  echo "!! error above and re-run (dumps contain --clean, so a re-run resets)" >&2
  "${COMPOSE[@]}" start backend migrate || true
  exit 1
fi

echo "==> restarting writers"
"${COMPOSE[@]}" start backend migrate

echo "==> done. Verify with: docker compose ... exec backend npm run ... / curl the API"
