#!/usr/bin/env bash
# =============================================================================
# Canonical production deploy (used by GitHub Actions AFTER approval, and by
# humans via `make prod` / direct invocation on the VPS).
#
#   ./infra/deploy/deploy.sh                # deploy IMAGE_TAG from .env (or $IMAGE_TAG)
#   ./infra/deploy/deploy.sh --rollback     # redeploy the last known-good tag
#   IMAGE_TAG=sha-abc123 ./infra/deploy/deploy.sh
#
# What it does, in order — each step is a gate (set -e):
#   1. preflight        (.env present, tag sane, compose >= 2.24, images pull)
#   2. pull             (registry is canonical: NEVER builds on the server)
#   3. up               (recreates only what changed; migrate is a dep gate)
#   4. health gate      (edge->frontend over TLS + backend/db via /api/health)
#   5. record last-good (so --rollback has a target)
#
# On failure: prints the exact rollback command (manual, deliberate — an
# automated rollback that races a half-started stack makes things worse).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT}"

COMPOSE=(docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml)
LAST_GOOD_FILE="${ROOT}/.deploy-last-good"

log() { printf '\n[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

rollback_hint() {
  local prev="sha-<previous>"
  [[ -f "${LAST_GOOD_FILE}" ]] && prev="$(cat "${LAST_GOOD_FILE}")"
  cat >&2 <<EOF

Rollback:
  IMAGE_TAG=${prev} $0
  # or edit IMAGE_TAG in .env, then: make prod
EOF
}

# --- sync the checkout -------------------------------------------------------
# CI deploys by SSHing into the VPS and running THIS script; the compose files
# and images must both come from the same release, so bring the checkout to
# the current main first. Skipped (with a warning) if the directory was
# deployed by rsync/scp instead of git clone.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "syncing checkout: origin ${GIT_BRANCH:-main} (ff-only)"
  git fetch --quiet origin "${GIT_BRANCH:-main}"
  git pull --quiet --ff-only origin "${GIT_BRANCH:-main}" ||
    die "git pull failed — local changes or divergence on the VPS; fix before deploying"
else
  log "warning: not a git checkout — assuming files were placed by hand/rsync"
fi

# --- rollback mode -----------------------------------------------------------
if [[ "${1:-}" == "--rollback" ]]; then
  [[ -f "${LAST_GOOD_FILE}" ]] || die "no .deploy-last-good file — nothing to roll back to"
  export IMAGE_TAG
  IMAGE_TAG="$(cat "${LAST_GOOD_FILE}")"
  log "ROLLBACK to IMAGE_TAG=${IMAGE_TAG}"
fi

# --- 1. preflight ------------------------------------------------------------
[[ -f .env ]] || die ".env missing — run 'cp .env.example .env && make setup'"
command -v docker >/dev/null || die "docker not installed"
docker compose version >/dev/null || die "compose plugin missing"

# IMAGE_TAG: env (CI sets it) wins, else .env; 'dev' is a local-only value.
if [[ -z "${IMAGE_TAG:-}" ]]; then
  IMAGE_TAG="$(grep -E '^IMAGE_TAG=' .env | tail -n1 | cut -d= -f2- || true)"
fi
[[ -n "${IMAGE_TAG:-}" && "${IMAGE_TAG}" != "dev" ]] ||
  die "IMAGE_TAG is '${IMAGE_TAG:-}' — set a release tag (CI writes IMAGE_TAG=sha-<git sha>)"
export IMAGE_TAG

DOMAIN="$(grep -E '^DOMAIN=' .env | tail -n1 | cut -d= -f2- || true)"
[[ -n "${DOMAIN}" ]] || die "DOMAIN missing from .env"
export DOMAIN

COMPOSE_VER="$(docker compose version --short)"
if [[ "$(printf '%s\n' "2.24.0" "${COMPOSE_VER}" | sort -V | head -n1)" != "2.24.0" ]]; then
  die "docker compose ${COMPOSE_VER} < 2.24 (prod file uses !reset)"
fi

# Catch config errors BEFORE touching the running stack.
"${COMPOSE[@]}" config -q

log "deploying IMAGE_TAG=${IMAGE_TAG} (DOMAIN=${DOMAIN})"

# --- 2. pull -----------------------------------------------------------------
# pull_policy:always in the prod file double-guarantees `up` cannot fall back
# to building whatever happens to be checked out on the server.
"${COMPOSE[@]}" pull

# --- 3. up -------------------------------------------------------------------
"${COMPOSE[@]}" up -d --remove-orphans

# --- 4. health gate ----------------------------------------------------------
# Both checks must pass for the release to be considered good:
#   (a) backend + db : GET /api/health through the app itself (503 if DB down)
#   (b) edge + ui    : GET https://<domain>/ through Nginx (TLS, SNI, proxy)
gate_fail() {
  log "HEALTH GATE FAILED: $*"
  rollback_hint
  exit 1
}

log "waiting for health (max 60s)"
HEALTHY=0
for _ in $(seq 1 30); do
  if "${COMPOSE[@]}" exec -T backend wget -q -O /dev/null http://127.0.0.1:3000/api/health 2>/dev/null &&
    curl -skf -o /dev/null --resolve "${DOMAIN}:443:127.0.0.1" "https://${DOMAIN}/"; then
    HEALTHY=1
    break
  fi
  sleep 2
done
[[ "${HEALTHY}" == "1" ]] || gate_fail "backend /api/health or edge https://${DOMAIN}/ never became ready"

# Optional extra: confirm the HTTP->HTTPS redirect once TLS redirect is on.
if grep -q '^ENABLE_TLS_REDIRECT=1' .env 2>/dev/null; then
  REDIR="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: ${DOMAIN}" http://127.0.0.1/ || true)"
  [[ "${REDIR}" == "301" ]] || log "warning: expected 301 from http://, got '${REDIR}'"
fi

# --- 5. record ---------------------------------------------------------------
log "SUCCESS"
echo "${IMAGE_TAG}" >"${LAST_GOOD_FILE}"
# Keep .env pinned to what is actually running, so a later manual `make prod`
# without CI re-deploys the same release instead of a stale/default tag.
if grep -qE '^IMAGE_TAG=' .env; then
  sed -i.bak -E "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env && rm -f .env.bak
fi
"${COMPOSE[@]}" ps
