# syntax=docker/dockerfile:1
# =============================================================================
# Edge Nginx image (custom build on top of nginxinc/nginx-unprivileged).
#
# What we add over the stock image:
#   1. ngx_brotli dynamic module (best effort — falls back to gzip-only with
#      a loud warning if the compile fails, so an upstream/toolchain change
#      can never brick the build)
#   2. openssl CLI (dev self-signed certificate fallback)
#   3. our config: nginx.conf, mode templates, snippets, entrypoint drop-in
#
# Base image: nginx-unprivileged instead of nginx — the master process runs as
# uid 101 (nginx), no root inside the container. Host ports 80/443 are mapped
# to container 8080/8443 by compose, so nothing needs a privileged port.
# =============================================================================

# ---- Stage 1: compile ngx_brotli as a dynamic module ------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine AS brotli
USER root

RUN apk add --no-cache bash build-base pcre2-dev zlib-dev openssl-dev linux-headers git wget tar

# Clone WITH submodules: ngx_brotli embeds the brotli library sources.
RUN git clone --depth 1 --recurse-submodules https://github.com/google/ngx_brotli.git /tmp/ngx_brotli

# Build against the EXACT nginx version baked into the base image — a dynamic
# module compiled for a different version will refuse to load. The whole
# build is wrapped in `( set -e; ... ) || warning` so a toolchain hiccup
# degrades to gzip-only instead of failing the image build.
RUN mkdir -p /tmp/modules && ( set -e; \
      NGINX_VER="$(nginx -v 2>&1 | sed 's|^nginx/||')"; \
      echo "building ngx_brotli for nginx ${NGINX_VER}"; \
      wget -q -O /tmp/nginx.tar.gz "https://nginx.org/download/nginx-${NGINX_VER}.tar.gz"; \
      tar -xzf /tmp/nginx.tar.gz -C /tmp; \
      cd "/tmp/nginx-${NGINX_VER}"; \
      ./configure --with-compat --add-dynamic-module=/tmp/ngx_brotli; \
      make modules; \
      cp objs/ngx_brotli_filter.so objs/ngx_brotli_static.so /tmp/modules/; \
    ) || echo "WARNING: ngx_brotli build failed - image will be gzip-only"

# ---- Stage 2: final edge image ----------------------------------------------
FROM nginxinc/nginx-unprivileged:1.27-alpine
USER root

# openssl req is used by the entrypoint for the development certificate.
RUN apk add --no-cache openssl

COPY --from=brotli /tmp/modules/ /tmp/modules/

# Wire the module up ONLY if it actually materialised. load_module lives in
# modules-enabled/ (main context), the brotli http{} directives in
# conf.d/00-brotli.conf — both are picked up by includes in nginx.conf, and an
# empty include glob is a silent no-op, so gzip-only builds stay valid.
RUN mkdir -p /etc/nginx/modules-enabled && \
    if ls /tmp/modules/*.so >/dev/null 2>&1; then \
      cp /tmp/modules/*.so /etc/nginx/modules/; \
      printf 'load_module modules/ngx_brotli_filter.so;\nload_module modules/ngx_brotli_static.so;\n' \
        > /etc/nginx/modules-enabled/10-brotli.conf; \
      printf 'brotli on;\nbrotli_comp_level 5;\nbrotli_min_length 1024;\nbrotli_types text/plain text/css text/csv application/json application/javascript application/xml application/manifest+json image/svg+xml;\n' \
        > /etc/nginx/conf.d/00-brotli.conf; \
      echo "brotli: enabled"; \
    else \
      echo "brotli: NOT available - gzip only"; \
    fi && rm -rf /tmp/modules

COPY nginx.conf /etc/nginx/nginx.conf
COPY templates/ /etc/nginx/templates-src/
COPY snippets/ /etc/nginx/snippets/
COPY docker-entrypoint.d/45-site-config.sh /docker-entrypoint.d/45-site-config.sh

RUN chmod +x /docker-entrypoint.d/45-site-config.sh && \
    mkdir -p /var/www/certbot && \
    # The entrypoint (running as uid 101) must be able to write the rendered
    # site config and the ACME webroot is bind-mounted read-only in prod.
    chown -R nginx:nginx /etc/nginx/conf.d /var/www/certbot

USER nginx
EXPOSE 8080 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
