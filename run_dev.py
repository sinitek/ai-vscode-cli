#!/usr/bin/env python3
"""跨平台安装依赖、构建插件并启动 VS Code 开发宿主。"""
from __future__ import annotations

import argparse
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR / "scripts"))

from vscode_extension_process import require_tool, run_process
from vscode_extension_win import find_vscode_code_command


def find_vscode_command() -> str | None:
    if sys.platform == "darwin":
        # 保留原 macOS 脚本的优先级，不要求用户先安装 PATH 中的 code。
        candidate = Path("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code")
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return find_vscode_code_command()


def workspace_has_pnpm_node_modules(root: Path | None = None) -> bool:
    root = root or ROOT_DIR
    return (root / "node_modules" / ".pnpm").is_dir()


def install_workspace_node_modules(npm: str, root: Path | None = None) -> None:
    # 与 scripts/install_workspace_node_modules.sh 保持相同的布局选择规则。
    root = root or ROOT_DIR
    node_modules = root / "node_modules"
    pnpm = shutil.which("pnpm")
    if (node_modules / ".pnpm").is_dir():
        if pnpm:
            print("检测到 pnpm node_modules，使用 pnpm install。", flush=True)
            run_process([pnpm, "install"], cwd=root)
            return
        print("检测到 pnpm node_modules，但本机没有 pnpm。删除后改用 npm install。", flush=True)
        # 根目录是符号链接或 Windows junction 时只移除链接。
        if node_modules.is_symlink():
            node_modules.unlink()
        elif os.name == "nt" and node_modules.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            node_modules.rmdir()
        else:
            shutil.rmtree(node_modules)
    elif not node_modules.exists() and (root / "pnpm-lock.yaml").is_file() and pnpm:
        print("检测到本地 pnpm-lock.yaml，使用 pnpm install。", flush=True)
        run_process([pnpm, "install"], cwd=root)
        return

    print("使用 npm install。", flush=True)
    run_process([npm, "install"], cwd=root)


def run_dev(*, code_command: str | None, skip_install: bool, skip_build: bool) -> None:
    npm = require_tool("npm") if not (skip_install and skip_build) else None
    resolved_code = code_command or find_vscode_command()
    if not resolved_code:
        raise RuntimeError(
            "未找到 VS Code 命令行工具 'code'。请安装 VS Code 并将 code 加入 PATH，"
            "或通过 --code 指定 code/code.cmd 的完整路径。\n"
            "macOS：也可在命令面板执行 Shell Command: Install 'code' command in PATH。"
        )

    if not skip_install:
        install_workspace_node_modules(npm)
    if not skip_build:
        run_process([npm, "run", "build"], cwd=ROOT_DIR)
    run_process(
        [resolved_code, "--new-window", f"--extensionDevelopmentPath={ROOT_DIR}"],
        cwd=ROOT_DIR,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code", dest="code_command", help="指定 VS Code code/code.cmd 命令路径。")
    parser.add_argument("--skip-install", action="store_true", help="跳过依赖安装。")
    parser.add_argument("--skip-build", action="store_true", help="跳过插件构建。")
    args = parser.parse_args(argv)
    try:
        run_dev(**vars(args))
    except KeyboardInterrupt:
        print("已取消启动。", file=sys.stderr)
        return 130
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"启动开发宿主失败：{error}", file=sys.stderr)
        return error.returncode if isinstance(error, subprocess.CalledProcessError) else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
