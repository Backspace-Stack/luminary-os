#!/usr/bin/env bash
# =============================================================
# Luminary OS — Memories viewer (macOS / Linux)
#
# Read-only: prints the curated MEMORIES.md in full plus semantic
# memory database stats. Writes nothing.
# =============================================================
set -euo pipefail

# This launcher lives in the "Other" folder, so the
# project root is its parent.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v node &>/dev/null; then
    echo ""
    echo "  [ERROR] Node.js is not installed."
    echo "    https://nodejs.org"
    echo ""
    exit 1
fi

exec node "$PROJECT_DIR/scripts/memories.js" "$@"
