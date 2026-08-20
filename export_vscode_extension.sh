#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

require_command() {
  local command_name="$1"
  local install_hint="$2"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: ${command_name} is not installed. ${install_hint}" >&2
    exit 1
  fi
}

resolve_vsce_command() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/vsce" ]]; then
    VSCE_CMD=("${ROOT_DIR}/node_modules/.bin/vsce")
    return
  fi

  if command -v vsce >/dev/null 2>&1; then
    VSCE_CMD=("vsce")
    return
  fi

  echo "Error: vsce is not installed. Run npm install, or install it globally with: npm i -g @vscode/vsce" >&2
  exit 1
}

require_command "node" "Install Node.js and retry."
require_command "unzip" "Install unzip and retry."
VSCE_CMD=()
resolve_vsce_command

OUT_DIR="${ROOT_DIR}/dist"
mkdir -p "$OUT_DIR"

PACKAGE_NAME="sinitek-cli-tools"
VERSION="$(node -p "require('./package.json').version")"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"

echo "Building VS Code extension and exporting to ${OUT_FILE} ..."
"${VSCE_CMD[@]}" package --out "${OUT_FILE}"

echo "Checking VSIX contents ..."
VSIX_CONTENTS="$(unzip -Z1 "${OUT_FILE}")"
FORBIDDEN_ENTRY_REGEX='^extension/((\.agents|\.ch|\.codegraph|docs|scripts|dist/test)(/|$)|(AGENTS\.md|ARCHITECTURE\.md|export_vscode_extension\.sh|publish_vscode_extension\.sh|run_dev\.sh|to)$)|(^|/)__pycache__/|\.pyc$'

if FORBIDDEN_ENTRIES="$(printf '%s\n' "${VSIX_CONTENTS}" | grep -E "${FORBIDDEN_ENTRY_REGEX}")"; then
  echo "Error: VSIX contains development-only files:" >&2
  printf '%s\n' "${FORBIDDEN_ENTRIES}" >&2
  exit 1
fi

REQUIRED_ENTRIES=(
  "extension/dist/extension.js"
  "extension/package.json"
  "extension/package.nls.json"
  "extension/package.nls.zh-cn.json"
  "extension/media/logo.svg"
  "extension/media/marked.min.js"
  "extension/media/mcp_marketplace.json"
  "extension/media/official_skills_catalog.json"
  "extension/media/workspace-scaffold/AGENTS.md"
  "extension/node_modules/@dagrejs/dagre/package.json"
  "extension/node_modules/@dagrejs/graphlib/package.json"
)

for required_entry in "${REQUIRED_ENTRIES[@]}"; do
  if ! grep -Fxq "${required_entry}" <<<"${VSIX_CONTENTS}"; then
    echo "Error: VSIX is missing required runtime file: ${required_entry}" >&2
    exit 1
  fi
done

ENTRY_COUNT="$(printf '%s\n' "${VSIX_CONTENTS}" | wc -l | tr -d ' ')"
echo "VSIX content check passed (${ENTRY_COUNT} entries)."
echo "Done. VSIX saved to ${OUT_FILE}"
