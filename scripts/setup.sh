#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# --- Node sanity ---
NODE_V="$(node -v 2>/dev/null || true)"
if [[ -z "$NODE_V" ]]; then
  echo "[GitHanger] ERROR: node is not available on PATH." >&2
  exit 1
fi

# GitHanger requires node ^20.19 || ^22.13 || >=24 (see package engines from deps).
# We keep this check lightweight (avoid semver deps in bash).
MAJOR="${NODE_V#v}"; MAJOR="${MAJOR%%.*}"
if [[ "$MAJOR" -lt 20 || ( "$MAJOR" -eq 20 && "${NODE_V#v20.}" < "19" ) || ( "$MAJOR" -eq 22 && "${NODE_V#v22.}" < "13" ) || "$MAJOR" -eq 23 ]]; then
  echo "[GitHanger] ERROR: Unsupported node version $NODE_V. Use ^20.19, ^22.13, or >=24." >&2
  echo "[GitHanger] Tip (nvm): nvm install 24 && nvm use 24" >&2
  exit 1
fi

# --- Install deps ---
echo "[GitHanger] Installing dependencies..."
npm install

# --- Fix occasional TS incremental weirdness (missing dist but tsbuildinfo present) ---
# This avoids: Cannot find module '@githanger/shared' or its corresponding type declarations.
echo "[GitHanger] Cleaning shared build outputs (safe)..."
rm -f packages/shared/tsconfig.tsbuildinfo
rm -rf packages/shared/dist

echo "[GitHanger] Building packages..."
# Build shared first so server/cli can resolve @githanger/shared types.
npm run -w @githanger/shared build
npm run build

# --- Make CLI available from any folder ---
# NOTE: npm link writes to the *global* npm prefix for the current node installation.
echo "[GitHanger] Linking githanger CLI (npm link)..."
# Prefer linking the workspace package by name.
# (Equivalent to: cd packages/cli && npm link)
npm link -w githanger

PREFIX="$(npm config get prefix)"
BIN_DIR="$PREFIX/bin"

echo "[GitHanger] Done. Try: githanger --help"
echo "[GitHanger] Global npm prefix: $PREFIX"
echo "[GitHanger] If 'githanger' is still not found, ensure this is on PATH: $BIN_DIR"
