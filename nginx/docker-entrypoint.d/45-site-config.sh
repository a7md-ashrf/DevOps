#!/bin/sh
# =============================================================================
# Nginx pre-start configuration (runs as /docker-entrypoint.d/45-site-config.sh
# BEFORE the official entrypoint execs nginx).
#
# Responsibilities:
#   1. validate NGINX_MODE
#   2. resolve TLS certs (Let's Encrypt -> generated self-signed fallback)
#   3. delete the stock default.conf server block
#   4. render the mode-specific site template into conf.d/10-site.conf
#   5. write conf.d/http-app.inc (HTTPS redirect vs. proxy locations)
#
# File-name order matters: official scripts are 10..30, ours runs at 45 so the
# stock scripts see an untouched image and we get the final word.
# =============================================================================
set -eu

MODE="${NGINX_MODE:-static}"
case "$MODE" in
  static|server) ;;
  *) echo "site-config: FATAL NGINX_MODE must be 'static' or 'server', got '$MODE'" >&2; exit 1 ;;
esac

: "${DOMAIN:?site-config: FATAL DOMAIN must be set (e.g. example.com)}"

TEMPLATE="/etc/nginx/templates-src/${MODE}-mode.conf.template"
if [ ! -f "$TEMPLATE" ]; then
  echo "site-config: FATAL template not found: $TEMPLATE" >&2
  exit 1
fi

# --- TLS material -------------------------------------------------------------
# Production: compose points TLS_CERT/TLS_KEY at the bind-mounted
# /etc/nginx/letsencrypt/live/<domain>/... pair. Development: nothing is
# mounted, so we mint a throw-away self-signed certificate — the HTTPS server
# block needs *a* file to exist even when the app is only reached over HTTP.
TLS_CERT="${TLS_CERT:-/etc/nginx/letsencrypt/live/${DOMAIN}/fullchain.pem}"
TLS_KEY="${TLS_KEY:-/etc/nginx/letsencrypt/live/${DOMAIN}/privkey.pem}"

if [ ! -f "$TLS_CERT" ] || [ ! -f "$TLS_KEY" ]; then
  DEV_CERT_DIR="/tmp/nginx-dev-certs"
  mkdir -p "$DEV_CERT_DIR"
  TLS_CERT="$DEV_CERT_DIR/dev.crt"
  TLS_KEY="$DEV_CERT_DIR/dev.key"
  if [ ! -f "$TLS_KEY" ] || [ ! -f "$TLS_CERT" ]; then
    echo "site-config: no real certificate found - generating self-signed dev certificate"
    openssl req -x509 -nodes -newkey rsa:2048 -days 7 \
      -keyout "$TLS_KEY" -out "$TLS_CERT" \
      -subj "/CN=${DOMAIN}" \
      -addext "subjectAltName=DNS:${DOMAIN},DNS:localhost,IP:127.0.0.1" \
      2>/dev/null
  fi
fi
export TLS_CERT TLS_KEY

# --- Remove the stock welcome-server (it would steal the same listen ports) ---
rm -f /etc/nginx/conf.d/default.conf

# --- Render the site template -------------------------------------------------
# envsubst with an EXPLICIT allow-list of variable names. Anything NOT in the
# list ($host, $uri, $remote_addr, $request_id...) survives untouched — without
# this, envsubst would replace every $variable-looking token with an empty
# string and nginx would fail with a dozen unknown-variable errors.
DEFINED_ENVS=$(printf '${%s} ' $(awk "END { for (name in ENVIRON) { print name } }" < /dev/null))
envsubst "$DEFINED_ENVS" < "$TEMPLATE" > /etc/nginx/conf.d/10-site.conf

# --- HTTP-port behaviour ------------------------------------------------------
# .inc extension on purpose: conf.d/*.conf is included at http{} level, and a
# bare `location` there is invalid — only 10-site.conf (server blocks) belongs
# in that glob. http-app.inc is pulled in explicitly from server context.
if [ "${ENABLE_TLS_REDIRECT:-0}" = "1" ]; then
  cat > /etc/nginx/conf.d/http-app.inc <<'EOF'
# Generated: TLS redirect active
location / {
    return 301 https://$host$request_uri;
}
EOF
else
  echo "include /etc/nginx/snippets/locations-${MODE}.conf;" > /etc/nginx/conf.d/http-app.inc
fi

echo "site-config: mode=${MODE} tls_redirect=${ENABLE_TLS_REDIRECT:-0} cert=${TLS_CERT}"
