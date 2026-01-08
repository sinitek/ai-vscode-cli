#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v vsce >/dev/null 2>&1; then
  echo "Error: vsce is not installed. Install it with: npm i -g @vscode/vsce" >&2
  exit 1
fi

OUT_DIR="${ROOT_DIR}/dist"
mkdir -p "$OUT_DIR"

PACKAGE_NAME="sinitek-cli-tools"
VERSION="$(node -p "require('./package.json').version")"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"

echo "Building VS Code extension and exporting to ${OUT_FILE} ..."
vsce package --out "${OUT_FILE}"
echo "Done. VSIX saved to ${OUT_FILE}"
