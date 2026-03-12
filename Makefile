.PHONY: help ci test test-server test-client typecheck lint dev dev-down dev-scratch prod prod-down

COMPOSE ?= docker compose

GIT_COMMIT := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
GIT_TAG    := $(shell git describe --tags --exact-match 2>/dev/null || echo unknown)
BUILD_DATE := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)

export GIT_COMMIT GIT_TAG BUILD_DATE

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F ':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

ci: typecheck lint test ## Run all CI checks (typecheck + lint + test)

test: test-server test-client ## Run all tests

test-server: ## Run server tests
	npx vitest run --project server

test-client: ## Run client tests
	npx vitest run --project client

typecheck: ## Run TypeScript type checking
	npm run typecheck

lint: ## Run ESLint
	npm run lint

dev: ## Start dev environment
	$(COMPOSE) up

dev-down: ## Stop dev environment
	$(COMPOSE) down

dev-scratch: ## Rebuild dev from scratch (removes volumes)
	$(COMPOSE) down -v
	$(COMPOSE) up --build

prod: ## Start production environment
	$(COMPOSE) -f compose.yaml -f compose.prod.yaml up -d --build

prod-down: ## Stop production environment
	$(COMPOSE) -f compose.yaml -f compose.prod.yaml down
