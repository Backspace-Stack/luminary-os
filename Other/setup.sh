#!/usr/bin/env bash
# =============================================================
# Luminary OS — macOS / Linux First-Time Setup
# =============================================================
set -euo pipefail

# This launcher lives in the "Other" folder, so the project root is its
# parent. Everything below is unchanged.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

if ! command -v node &>/dev/null; then
    echo ""
    echo "  [ERROR] Node.js not found."
    echo "    https://nodejs.org"
    echo "    brew install node"
    echo "    nvm install 20 && nvm use 20"
    echo ""
    exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.versions.node)))")
if [ "$NODE_MAJOR" -ne 24 ]; then
    echo "  [ERROR] Node.js v24+ required. Found: $(node --version)"
    exit 1
fi

node "$PROJECT_DIR/scripts/setup.js"

# Ensure the launchers stay executable after setup
chmod +x "$PROJECT_DIR/Other/run.sh" \
         "$PROJECT_DIR/Other/setup.sh" \
         "$PROJECT_DIR/Other/show-memories.sh" 2>/dev/null || true
