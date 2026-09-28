#!/usr/bin/env bash
# =============================================================================
# VPS bootstrap for Ubuntu 22.04/24.04 — run ONCE as root:
#   sudo ./infra/setup/vps-bootstrap.sh
#
# Installs: Docker Engine + Compose plugin, Certbot, UFW (80/443 only),
# and creates the certbot directory layout the stack expects.
#
# Idempotent: safe to re-run (apt/GPG/UFW rules are all upsert-style).
# =============================================================================
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root (sudo $0)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

APP_DIR="${1:-/srv/devops-reference}"

echo "==> [1/6] base packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg git ufw openssl rsync jq

echo "==> [2/6] Docker Engine + Compose plugin (official apt repo)"
install -m 0755 -d /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg |
    gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
fi
ARCH="$(dpkg --print-architecture)"
CODENAME="$(. /etc/os-release && echo "${VERSION_CODENAME:?}")"
echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Verify the Compose version supports `!reset` (>= 2.24, Jan 2024).
COMPOSE_VER="$(docker compose version --short 2>/dev/null || echo 0)"
echo "    docker compose ${COMPOSE_VER}"
if [[ "$(printf '%s\n' "2.24.0" "${COMPOSE_VER}" | sort -V | head -n1)" != "2.24.0" ]]; then
  echo "ERROR: docker compose ${COMPOSE_VER} < 2.24 — infra/docker-compose.prod.yml uses !reset." >&2
  exit 1
fi

echo "==> [3/6] Certbot"
apt-get install -y certbot

echo "==> [4/6] firewall (UFW)"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
# NOTE: deliberately NOT opening 5432/3000/8080. The DB and API are not
# public services; add rules manually only for short-lived debugging.
ufw --force enable
ufw status verbose

echo "==> [5/6] certbot directory layout (repo-local, no sudo needed later)"
mkdir -p "${APP_DIR}/certbot/www" "${APP_DIR}/certbot/letsencrypt" "${APP_DIR}/backups"
chmod 755 "${APP_DIR}/certbot/www"

echo "==> [6/6] done"
cat <<EOF

Next steps (as your non-root user):
  1. git clone <your-repo> ${APP_DIR}   # or rsync / scp the project there
  2. cd ${APP_DIR} && cp .env.example .env && make setup
     - edit .env: DOMAIN, POSTGRES_PASSWORD (use: openssl rand -hex 24),
       CORS_ORIGINS, IMAGE_REPO/IMAGE_TAG
  3. ./infra/setup/issue-ssl.sh <your-domain>   # add --staging to test first
  4. make prod                                 # pull images, start, health-gate
  5. ./infra/deploy/deploy.sh                  # every later deploy

README.md "VPS quick start" walks through the same sequence.
EOF
