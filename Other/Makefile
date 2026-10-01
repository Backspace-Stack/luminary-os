# =============================================================
# Luminary OS — Makefile
# For developers who prefer make over npm scripts.
# Requires: make, Node.js 24 LTS
#
# This file lives in Other/, so every path is resolved from the
# Makefile's own location rather than the current directory. That means
# it works both from the project root (make -f Other/Makefile start)
# and from inside Other/ (make start).
# =============================================================

THIS_FILE := $(abspath $(lastword $(MAKEFILE_LIST)))
ROOT      := $(patsubst %/,%,$(dir $(THIS_FILE)))/..

.PHONY: start dev setup doctor memories install build \
        build-backend build-frontend \
        dev-backend dev-frontend \
        clean clean-deps help

# Default target
all: start

## start     : Start the full application (backend + frontend + browser)
start:
	node "$(ROOT)/scripts/start.js"

## dev       : Alias for start
dev: start

## setup     : Install all dependencies (run once after clone)
setup:
	node "$(ROOT)/scripts/setup.js"

## doctor    : Check the environment for problems
doctor:
	node "$(ROOT)/scripts/doctor.js"

## memories  : Print curated memories + memory stats (read-only)
memories:
	node "$(ROOT)/scripts/memories.js"

## install   : Install dependencies in backend and frontend
install:
	npm ci --prefix "$(ROOT)/backend"
	npm ci --prefix "$(ROOT)/frontend"

## build     : Production build
build: build-backend build-frontend

## build-backend : Build backend TypeScript
build-backend:
	npm run build --prefix "$(ROOT)/backend"

## build-frontend : Build frontend with Vite
build-frontend:
	npm run build --prefix "$(ROOT)/frontend"

## dev-backend  : Start backend only (dev mode)
dev-backend:
	npm run dev --prefix "$(ROOT)/backend"

## dev-frontend : Start frontend only (dev mode)
dev-frontend:
	npm run dev --prefix "$(ROOT)/frontend"

## clean     : Remove build artefacts
clean:
	rm -rf "$(ROOT)/backend/dist" "$(ROOT)/frontend/dist"

## clean-deps : Remove all node_modules (forces fresh install on next run)
clean-deps:
	rm -rf "$(ROOT)/node_modules" "$(ROOT)/backend/node_modules" "$(ROOT)/frontend/node_modules"
	@echo "Removed all node_modules. Run 'make setup' to reinstall."

## help      : Show this help message
help:
	@echo ""
	@echo "  Luminary OS — Makefile targets"
	@echo ""
	@grep -E '^## ' "$(THIS_FILE)" | sed 's/## /  /'
	@echo ""
