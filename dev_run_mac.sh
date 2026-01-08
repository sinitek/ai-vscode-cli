#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "$0")" && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm 未安装或不在 PATH 中。"
  exit 1
fi

vscode_bin="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"

if [ -x "$vscode_bin" ]; then
  code_cmd="$vscode_bin"
elif command -v code >/dev/null 2>&1; then
  code_cmd="code"
else
  echo "未找到 VS Code 命令行工具 'code'。请在 VS Code 中执行: Cmd+Shift+P -> Shell Command: Install 'code' command in PATH"
  exit 1
fi

cd "$workspace_dir"

npm install
npm run build

"$code_cmd" --extensionDevelopmentPath="$workspace_dir"
