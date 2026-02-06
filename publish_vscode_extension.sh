#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is not installed or not on PATH." >&2
  exit 1
fi

if ! command -v vsce >/dev/null 2>&1; then
  echo "Error: vsce is not installed. Install it with: npm i -g @vscode/vsce" >&2
  exit 1
fi

PACKAGE_NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="${ROOT_DIR}/dist"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"

mkdir -p "$OUT_DIR"

echo "[1/3] Building extension..."
npm run build

echo "[2/3] Packaging VSIX: ${OUT_FILE}"
vsce package --out "$OUT_FILE"

PUBLISH_ARGS=("--packagePath" "$OUT_FILE")
if [[ -n "${VSCE_PAT:-}" ]]; then
  PUBLISH_ARGS+=("--pat" "$VSCE_PAT")
elif [[ -n "${VSCODE_MARKETPLACE_PAT:-}" ]]; then
  PUBLISH_ARGS+=("--pat" "$VSCODE_MARKETPLACE_PAT")
fi

echo "[3/3] Publishing to Marketplace..."
vsce publish "${PUBLISH_ARGS[@]}"

echo "Done. Published ${PACKAGE_NAME}@${VERSION}."
