#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
# shellcheck source=scripts/install_workspace_node_modules.sh
source "${ROOT_DIR}/scripts/install_workspace_node_modules.sh"

STAGING_DIR=""
PACKAGE_IGNORE_FILE=""

cleanup_staging() {
  if [[ -n "${STAGING_DIR}" && -d "${STAGING_DIR}" ]]; then
    rm -rf "${STAGING_DIR}"
  fi
  if [[ -n "${PACKAGE_IGNORE_FILE}" && -f "${PACKAGE_IGNORE_FILE}" ]]; then
    rm -f "${PACKAGE_IGNORE_FILE}"
  fi
}

trap cleanup_staging EXIT

usage() {
  echo "用法：./export_vscode_extension.sh [--target universal|current|darwin-arm64|darwin-x64|linux-arm64|linux-x64|win32-x64]"
  echo "默认导出通用包；--target current 仅保留本机平台资源，生成单独命名的平台包。"
  echo "跨平台导出前须安装目标平台的原生依赖；脚本不会删除或修改本机 node_modules。"
}

TARGET="universal"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 || -z "$2" ]]; then
        usage >&2
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

configure_package_options() {
  PACKAGE_OPTIONS=(--out "${OUT_FILE}")
  if [[ "${TARGET}" != "universal" ]]; then
    node "${ROOT_DIR}/scripts/vsix_target.js" prepare "${TARGET}" "${PACKAGE_IGNORE_FILE}"
    PACKAGE_OPTIONS+=(--target "${TARGET}" --ignoreFile "${PACKAGE_IGNORE_FILE}")
  fi
}

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
      --exclude .codegraph \
      --exclude '*.vsix' \
      "${ROOT_DIR}/" "${staging_dir}/"
    return
  fi

  tar -C "${ROOT_DIR}" \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    --exclude .codegraph \
    --exclude '*.vsix' \
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
    configure_package_options
    ./node_modules/.bin/vsce package "${PACKAGE_OPTIONS[@]}"
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
  configure_package_options
  echo "Building VS Code extension and exporting to ${OUT_FILE} ..."
  "${VSCE_CMD[@]}" package "${PACKAGE_OPTIONS[@]}"
}

require_command "node" "Install Node.js and retry."
require_command "unzip" "Install unzip and retry."
VSCE_CMD=()
PACKAGE_OPTIONS=()
TARGET="$(node "${ROOT_DIR}/scripts/vsix_target.js" resolve "${TARGET}")"
if [[ "${TARGET}" != "universal" ]]; then
  PACKAGE_IGNORE_FILE="$(mktemp "${TMPDIR:-/tmp}/sinitek-vsix-ignore.XXXXXX")"
fi

OUT_DIR="${ROOT_DIR}/dist"
PACKAGE_NAME="sinitek-cli-tools"
VERSION="$(node -p "require('./package.json').version")"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"
if [[ "${TARGET}" != "universal" ]]; then
  OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}-${TARGET}.vsix"
fi

package_vsix

echo "Checking VSIX contents ..."
VSIX_CONTENTS="$(unzip -Z1 "${OUT_FILE}")"
FORBIDDEN_ENTRY_REGEX='^extension/((\.agents|\.ch|\.codegraph|\.tmp|docs|scripts|dist/test)(/|$)|(AGENTS\.md|ARCHITECTURE\.md|export_vscode_extension\.sh|publish_vscode_extension\.sh|run_dev\.sh|to)$)|^extension/dist/.*\.map$|^extension/node_modules/@anthropic-ai/claude-agent-sdk/[^/]+\.d\.ts$|(^|/)__pycache__/|\.pyc$'

if FORBIDDEN_ENTRIES="$(printf '%s\n' "${VSIX_CONTENTS}" | grep -E "${FORBIDDEN_ENTRY_REGEX}")"; then
  echo "Error: VSIX contains development-only files:" >&2
  printf '%s\n' "${FORBIDDEN_ENTRIES}" >&2
  exit 1
fi

REQUIRED_ENTRIES=(
  "extension/dist/extension.js"
  "extension/package.json"
  "extension/media/logo.svg"
  "extension/media/marked.min.js"
  "extension/media/config/assets/config-app-api.js"
  "extension/media/config/assets/config-app-store.js"
  "extension/media/config/assets/config-app-ui.js"
  "extension/media/config/monaco-editor/0.52.2/min/vs/loader.js"
  "extension/media/workspace-scaffold/AGENTS.md"
  "extension/node_modules/@dagrejs/dagre/package.json"
  "extension/node_modules/@dagrejs/graphlib/package.json"
  "extension/node_modules/marked/package.json"
  "extension/node_modules/json-formatter-js/dist/json-formatter.umd.js"
)

for required_entry in "${REQUIRED_ENTRIES[@]}"; do
  if ! grep -Fxq "${required_entry}" <<<"${VSIX_CONTENTS}"; then
    echo "Error: VSIX is missing required runtime file: ${required_entry}" >&2
    exit 1
  fi
done

printf '%s\n' "${VSIX_CONTENTS}" | node "${ROOT_DIR}/scripts/vsix_target.js" audit "${TARGET}"

ENTRY_COUNT="$(printf '%s\n' "${VSIX_CONTENTS}" | wc -l | tr -d ' ')"
echo "VSIX content check passed (${ENTRY_COUNT} entries)."
node -e 'const fs = require("node:fs"); const size = fs.statSync(process.argv[1]).size; console.log(`VSIX 大小：${(size / 1024 / 1024).toFixed(2)} MiB（${size} 字节）`)' "${OUT_FILE}"
echo "Done. VSIX saved to ${OUT_FILE}"
