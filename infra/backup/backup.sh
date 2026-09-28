#!/usr/bin/env bash
# =============================================================================
# Database backup — run on the VPS (cron or by hand):
#   ./infra/backup/backup.sh [retention_days]     # default retention: 14
#
# Produces a gzipped pg_dump plus a .sha256 sidecar in ./backups/:
#   backups/db-20260928-031500-a1b2c3d.sql.gz     # stamp + git short SHA
#
# Notes:
#   * `set -o pipefail` is load-bearing: without it a failed pg_dump piping
#     into gzip would still exit 0 and quietly "succeed" with a partial file.
#   * The dump runs INSIDE the db container (exec), so no host psql needed.
# =============================================================================
set -euo pipefail

RETENTION_DAYS="${1:-14}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

BACKUP_DIR="${BACKUP_DIR:-${ROOT}/backups}"
mkdir -p "${BACKUP_DIR}"

STAMP="$(date +%Y%m%d-%H%M%S)"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
FILE="${BACKUP_DIR}/db-${STAMP}-${GIT_SHA}.sql.gz"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)

echo "==> dumping database to ${FILE}"
"${COMPOSE[@]}" exec -T db sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' |
  gzip -9 >"${FILE}"

# Fail loudly rather than keeping a corrupt archive.
gzip -t "${FILE}"
(cd "${BACKUP_DIR}" && shasum -a 256 "$(basename "${FILE}")" >"$(basename "${FILE}").sha256" 2>/dev/null) ||
  (cd "${BACKUP_DIR}" && sha256sum "$(basename "${FILE}")" >"$(basename "${FILE}").sha256")

SIZE="$(du -h "${FILE}" | cut -f1)"
echo "==> ok: ${FILE} (${SIZE})"

echo "==> rotating: deleting dumps older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'db-*.sql.gz*' -mtime "+${RETENTION_DAYS}" -delete
echo "==> done ($(ls -1 "${BACKUP_DIR}"/db-*.sql.gz 2>/dev/null | wc -l | tr -d ' ') dump(s) kept)"
