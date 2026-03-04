#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[GitHanger] Installing dependencies..."
npm install

echo "[GitHanger] Building packages..."
npm run build

echo "[GitHanger] Linking githanger CLI (npm link)..."
cd "$ROOT_DIR/packages/cli"
npm link

echo "[GitHanger] Done. Try: githanger --help"
