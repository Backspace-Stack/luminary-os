#!/usr/bin/env bash
# =============================================================
# Luminary OS — macOS / Linux Launcher
# =============================================================
set -euo pipefail

# This launcher lives in the "Other" folder, so the project
# root is its parent. Everything below is unchanged.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v node &>/dev/null; then
    echo ""
    echo "  [ERROR] Node.js is not installed."
    echo ""
    echo "  Install options:"
    echo "    https://nodejs.org           (recommended)"
    echo "    brew install node            (macOS Homebrew)"
    echo "    nvm install 20 && nvm use 20 (nvm)"
    echo ""
    exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.versions.node)))")
if [ "$NODE_MAJOR" -ne 24 ]; then
    echo "  [ERROR] Node.js v24 LTS required. Found: $(node --version)"
    echo "  Update at: https://nodejs.org"
    exit 1
fi

exec node "$PROJECT_DIR/scripts/start.js" "$@"
