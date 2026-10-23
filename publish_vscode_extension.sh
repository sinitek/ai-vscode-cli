#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"
source "${ROOT_DIR}/scripts/install_workspace_node_modules.sh"

usage() {
  echo "用法：./publish_vscode_extension.sh [--target universal|current|darwin-arm64|darwin-x64|linux-arm64|linux-x64|win32-x64]"
  echo "默认导出通用 VSIX，并发布到 VS Code 市场的 sinitek 发布者。"
  echo "鉴权：设置 VSCE_PAT（兼容 VSCODE_MARKETPLACE_PAT），或在项目根目录执行 ./node_modules/.bin/vsce login sinitek。"
  echo "令牌需要 Marketplace 的 Manage 权限，以及 sinitek 发布者的发布权限。"
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

if ! command -v node >/dev/null 2>&1; then
  echo "node 未安装或不在 PATH 中。" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm 未安装或不在 PATH 中。" >&2
  exit 1
fi

resolve_vsce_command() {
  if [[ -x "${ROOT_DIR}/node_modules/.bin/vsce" ]]; then
    VSCE_CMD=("${ROOT_DIR}/node_modules/.bin/vsce")
    return
  fi

  if command -v vsce >/dev/null 2>&1; then
    VSCE_CMD=("vsce")
    return
  fi

  echo "未找到 vsce，先安装项目依赖。"
  install_workspace_node_modules
  if [[ ! -x "${ROOT_DIR}/node_modules/.bin/vsce" ]]; then
    echo "安装依赖后仍未找到 vsce，请检查 npm install 的结果。" >&2
    exit 1
  fi
  VSCE_CMD=("${ROOT_DIR}/node_modules/.bin/vsce")
}

PUBLISHER="$(node -p "require('./package.json').publisher")"
if [[ "$PUBLISHER" != "sinitek" ]]; then
  echo "发布者不匹配：package.json 的 publisher 必须为 sinitek，当前为 ${PUBLISHER}。" >&2
  exit 1
fi

TARGET="$(node "${ROOT_DIR}/scripts/vsix_target.js" resolve "$TARGET")"
VSCE_CMD=()
resolve_vsce_command

if [[ -n "${VSCE_PAT:-${VSCODE_MARKETPLACE_PAT:-}}" ]]; then
  export VSCE_PAT="${VSCE_PAT:-${VSCODE_MARKETPLACE_PAT:-}}"
elif [[ ! -t 0 ]] && ! "${VSCE_CMD[@]}" ls-publishers | grep -Fxq "$PUBLISHER"; then
  echo "未找到 sinitek 的发布凭据；请设置 VSCE_PAT，或在本机终端登录。" >&2
  printf '登录命令："%s" login sinitek\n' "${VSCE_CMD[0]}" >&2
  echo "请勿将令牌写入脚本、仓库或聊天记录。" >&2
  exit 1
fi

echo "[1/3] 验证 ${PUBLISHER} 的市场发布权限..."
if ! "${VSCE_CMD[@]}" verify-pat "$PUBLISHER"; then
  echo "鉴权失败：请检查令牌有效期、Marketplace 的 Manage 权限和 sinitek 发布者权限。" >&2
  exit 1
fi

PACKAGE_NAME="$(node -p "require('./package.json').name")"
VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="${ROOT_DIR}/dist"
OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}.vsix"
if [[ "$TARGET" != "universal" ]]; then
  OUT_FILE="${OUT_DIR}/${PACKAGE_NAME}-${VERSION}-${TARGET}.vsix"
fi

mkdir -p "$OUT_DIR"

echo "[2/3] 导出并校验 VSIX：${OUT_FILE}"
"${ROOT_DIR}/export_vscode_extension.sh" --target "$TARGET"
if [[ ! -s "$OUT_FILE" ]]; then
  echo "导出后未找到有效 VSIX：${OUT_FILE}" >&2
  exit 1
fi

echo "[3/3] 发布 ${PUBLISHER}.${PACKAGE_NAME}@${VERSION} 到 VS Code 市场..."
if ! "${VSCE_CMD[@]}" publish --packagePath "$OUT_FILE"; then
  echo "发布失败，VSIX 保留在 ${OUT_FILE}。请检查网络、发布权限及该版本是否已存在；已发布版本不能重复覆盖。" >&2
  exit 1
fi

echo "发布成功：${PUBLISHER}.${PACKAGE_NAME}@${VERSION}"
