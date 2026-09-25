#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/install_workspace_node_modules.sh
source "${ROOT_DIR}/scripts/install_workspace_node_modules.sh"

STAGING_DIR=""

cleanup_staging() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf "${STAGING_DIR}"
  fi
}

trap cleanup_staging EXIT

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

copy_sources_to_staging() {
  local staging_dir="$1"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a \
      --exclude node_modules \
      --exclude dist \
      --exclude .git \
      --exclude '*.vsix' \
      "${ROOT_DIR}/" "${staging_dir}/"
    return
  fi

  tar -C "${ROOT_DIR}" \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    -cf - . | tar -C "${staging_dir}" -xf -
}

sync_compiled_dist_from_staging() {
  local staging_dir="$1"
  if [[ ! -d "${staging_dir}/dist" ]]; then
    return
  fi

  mkdir -p "${ROOT_DIR}/dist"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --exclude '*.vsix' "${staging_dir}/dist/" "${ROOT_DIR}/dist/"
    return
  fi

  cp -R "${staging_dir}/dist/." "${ROOT_DIR}/dist/"
}

install_staging_node_modules() {
  if command -v pnpm >/dev/null 2>&1; then
    echo "临时目录使用 pnpm install --node-linker=hoisted，以便 vsce 的 npm list 能通过。"
    pnpm install --node-linker=hoisted --ignore-scripts
    return
  fi

  echo "本机没有 pnpm，临时目录改用 npm install。"
  npm install --no-fund --no-audit --ignore-scripts
}

package_vsix_from_staging() {
  echo "当前 node_modules 不是 npm 布局。vsce 会执行 npm list，改为在临时目录安装后再打包。"
  echo "Building VS Code extension and exporting to ${OUT_FILE} ..."

  STAGING_DIR="$(mktemp -d "${TMPDIR:-/tmp}/sinitek-vsix-pack.XXXXXX")"
  copy_sources_to_staging "${STAGING_DIR}"
  (
    cd "${STAGING_DIR}"
    install_staging_node_modules
    if [[ ! -x node_modules/.bin/vsce ]]; then
      echo "Error: vsce is missing after the temporary install." >&2
      exit 1
    fi
    ./node_modules/.bin/vsce package --out "${OUT_FILE}"
  )
  sync_compiled_dist_from_staging "${STAGING_DIR}"
}

package_vsix() {
  mkdir -p "${OUT_DIR}"

  if workspace_has_pnpm_node_modules; then
    package_vsix_from_staging
    return
  fi

  if [[ ! -x "${ROOT_DIR}/node_modules/.bin/vsce" ]] && ! command -v vsce >/dev/null 2>&1; then
    echo "未找到 vsce，先安装依赖。"
    install_workspace_node_modules
  fi

  resolve_vsce_command
  echo "Building VS Code extension and exporting to ${OUT_FILE} ..."
  "${VSCE_CMD[@]}" package --out "${OUT_FILE}"
}

require_command "node" "Install Node.js and retry."
require_command "unzip" "Install unzip and retry."
VSCE_CMD=()

OUT_DIR="${ROOT_DIR}/dist"
PACKAGE_NAME="sinitek-cli-tools"
VERSION="$(node -p "require('./package.json').version")"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"

package_vsix

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
  "extension/node_modules/marked/package.json"
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
