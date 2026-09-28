# =============================================================================
# devops-reference — single entry point for every routine command.
#
# WHY a Makefile: one discoverable, self-documenting command surface instead of
# long `docker compose -f ... -f ...` incantations that drift out of sync with
# the docs. `make help` (the default target) is the table of contents.
#
# Every target prints itself when you run plain `make`.
# =============================================================================
SHELL := /bin/bash
.DEFAULT_GOAL := help

# --env-file makes the .env lookup explicit (cwd-relative) instead of relying on
# Compose's project-directory heuristics — same invocation works on any machine
# and matches infra/deploy/deploy.sh exactly.
COMPOSE      := docker compose --env-file .env -f infra/docker-compose.yml
COMPOSE_PROD := docker compose --env-file .env -f infra/docker-compose.yml -f infra/docker-compose.prod.yml

# Make does not read .env, so parse the variables the Makefile itself needs.
FRONTEND_MODE ?= $(shell sed -n 's/^FRONTEND_MODE=//p' .env 2>/dev/null)
FRONTEND_MODE := $(if $(strip $(FRONTEND_MODE)),$(FRONTEND_MODE),static)
DOMAIN ?= $(shell sed -n 's/^DOMAIN=//p' .env 2>/dev/null)
HTTP_PORT ?= $(shell sed -n 's/^HTTP_PORT=//p' .env 2>/dev/null)
HTTP_PORT := $(if $(strip $(HTTP_PORT)),$(HTTP_PORT),8080)

.PHONY: help setup check-env dev stack stack-down logs ps prod build lint fmt \
        typecheck test test-backend test-frontend migrate migrate-down seed \
        ssl-issue ssl-renew ssl-dry-run backup restore validate clean

help: ## Show this help
	@grep -E '^[a-zA-Z][a-zA-Z0-9_-]*:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

setup: ## Create .env from the template and install node_modules for both apps
	@test -f .env || cp .env.example .env
	@echo "Created .env — edit the CHANGE-ME values before running the stack."
	@cd backend && npm install
	@cd frontend && npm install
	@echo "Dependencies installed. Next: make test"

check-env:
	@test -f .env || { echo "ERROR: .env not found — run 'make setup' first."; exit 1; }

# -----------------------------------------------------------------------------
# Local development (hot reload)
# -----------------------------------------------------------------------------
dev: check-env ## Hot-reload dev: DB in Docker, API :3000, web :5173 (Ctrl-C stops all)
	@$(COMPOSE) up -d db
	@trap '$(COMPOSE) stop db >/dev/null 2>&1 || true' EXIT INT TERM; \
	 (npm --prefix backend run dev) & API_PID=$$!; \
	 (npm --prefix frontend run dev) & WEB_PID=$$!; \
	 trap 'kill $$API_PID $$WEB_PID 2>/dev/null; $(COMPOSE) stop db >/dev/null 2>&1 || true' EXIT INT TERM; \
	 echo ""; \
	 echo "  API  -> http://localhost:3000/api/health"; \
	 echo "  Web  -> http://localhost:5173  (Vite proxies /api to the API)"; \
	 echo "  Press Ctrl-C to stop everything."; \
	 wait

# -----------------------------------------------------------------------------
# Containerized development stack (dev parity with production topology)
# -----------------------------------------------------------------------------
stack: check-env ## Full dev stack in containers (nginx:8080, mode from .env)
	$(COMPOSE) up -d --build
	@# Poll the edge instead of `--wait`: the one-shot `migrate` container
	@# exits 0 by design, and `--wait` semantics for exited services differ
	@# across Compose versions. One health probe path for dev and prod alike.
	@for i in {1..30}; do \
	  if curl -sf -o /dev/null http://localhost:$(HTTP_PORT)/healthz 2>/dev/null; then \
	    echo ""; echo "Stack up in '$(FRONTEND_MODE)' mode -> http://localhost:8080"; exit 0; \
	  fi; sleep 2; \
	done; \
	echo ""; echo "Stack did not become healthy in 60s — check: make ps / make logs"; exit 1

stack-down: check-env ## Stop the dev stack (keeps the database volume)
	$(COMPOSE) down

logs: check-env ## Tail logs of every dev container
	$(COMPOSE) logs -f --tail=100

ps: check-env ## Show container status and health
	$(COMPOSE) ps

# -----------------------------------------------------------------------------
# Production (run by infra/deploy/deploy.sh on the VPS — rarely by hand)
# -----------------------------------------------------------------------------
prod: check-env ## Deploy production: pull pinned images, start, health-gate
	./infra/deploy/deploy.sh

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------
build: check-env ## Build all images locally (frontend Dockerfile from .env)
	# Tags mirror compose's default image names so `compose up` reuses them.
	docker build -f frontend/Dockerfile.$(FRONTEND_MODE) -t local/frontend-$(FRONTEND_MODE):dev frontend
	docker build -t local/backend:dev backend
	docker build -t local/nginx:dev nginx

# -----------------------------------------------------------------------------
# Quality gates (same commands CI runs)
# -----------------------------------------------------------------------------
lint: ## ESLint + Prettier --check on both apps
	npm --prefix backend run lint
	npm --prefix frontend run lint

fmt: ## Auto-fix lint issues and format all sources
	npm --prefix backend run lint:fix
	npm --prefix frontend run lint:fix
	npm --prefix backend run format
	npm --prefix frontend run format

typecheck: ## TypeScript check with no emit (both apps)
	npm --prefix backend run typecheck
	npm --prefix frontend run typecheck

test: ## Run all tests (DB-backed tests skip if PostgreSQL is unreachable)
	$(MAKE) test-backend
	$(MAKE) test-frontend

test-backend: ## Backend unit + API tests (Vitest + Supertest)
	npm --prefix backend run test

test-frontend: ## Frontend unit tests (Vitest)
	npm --prefix frontend run test

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------
migrate: ## Apply all pending migrations (DB from .env/DATABASE_URL)
	npm --prefix backend run migrate:up

migrate-down: ## Roll back the most recent migration
	npm --prefix backend run migrate:down

seed: ## Insert demo data (idempotent — safe to run repeatedly)
	npm --prefix backend run seed

# -----------------------------------------------------------------------------
# TLS (production VPS)
# -----------------------------------------------------------------------------
ssl-issue: ## First certificate for DOMAIN from .env; STAGING=1 uses LE staging
	@test -n "$(DOMAIN)" || { echo "ERROR: DOMAIN missing in .env"; exit 1; }
	./infra/setup/issue-ssl.sh $(DOMAIN) $(if $(STAGING),--staging,)

ssl-renew: ## Force a renewal run now (normally done automatically by cron)
	./infra/setup/renew-ssl.sh

ssl-dry-run: ## Simulate renewal against the ACME server (no certificate changes)
	./infra/setup/renew-ssl.sh --dry-run

# -----------------------------------------------------------------------------
# Backups (production VPS)
# -----------------------------------------------------------------------------
backup: ## Dump PostgreSQL and prune old dumps per the retention policy
	./infra/backup/backup.sh

restore: ## Restore a dump; point at a file with RESTORE_FILE=path/to.sql.gz
	./infra/backup/restore.sh $(RESTORE_FILE)

# -----------------------------------------------------------------------------
# Validation
# -----------------------------------------------------------------------------
validate: check-env ## Merge-check every compose combination (dev/prod x static/server)
	$(COMPOSE) config -q
	$(COMPOSE_PROD) config -q
	FRONTEND_MODE=server $(COMPOSE) config -q
	FRONTEND_MODE=server $(COMPOSE_PROD) config -q
	@echo "OK: all compose configurations are valid"

clean: check-env ## DANGER: remove dev containers AND the database volume
	@read -r -p "This deletes the database volume permanently. Continue? [y/N] " r; \
	 [[ "$$r" == "y" || "$$r" == "Y" ]] || { echo "Aborted."; exit 1; }
	$(COMPOSE) down -v --remove-orphans
