#!/usr/bin/env python3
"""验证 sinitek 发布权限，导出并审计 VSIX，再发布到 VS Code 市场。"""
from __future__ import annotations

import argparse
import io
import os
import subprocess
import sys

from export_vscode_extension import ROOT_DIR, output_file, read_manifest, resolve_target, resolve_vsce
from vscode_extension_process import require_tool, run_process


EXPECTED_PUBLISHER = "sinitek"


def publisher_login_hint(vsce: str) -> str:
    return f'"{vsce}" login {EXPECTED_PUBLISHER}'


def has_cached_publisher(vsce: str, publisher: str) -> bool:
    output = io.StringIO()
    try:
        run_process([vsce, "ls-publishers"], cwd=ROOT_DIR, stdout=output)
        return publisher in output.getvalue().splitlines()
    except (OSError, subprocess.CalledProcessError):
        return False


def publish_extension(target: str) -> None:
    require_tool("node")
    require_tool("npm")
    manifest = read_manifest()
    publisher = manifest.get("publisher")
    if publisher != EXPECTED_PUBLISHER:
        raise RuntimeError(f"发布者不匹配：package.json 的 publisher 必须为 sinitek，当前为 {publisher}。")
    target = resolve_target(target)
    vsce = resolve_vsce()
    token = os.environ.get("VSCE_PAT") or os.environ.get("VSCODE_MARKETPLACE_PAT")
    if token:
        os.environ["VSCE_PAT"] = token
    elif not sys.stdin.isatty() and not has_cached_publisher(vsce, publisher):
        raise RuntimeError(
            "未找到 sinitek 的发布凭据；请设置 VSCE_PAT，或在本机终端登录。\n"
            f"登录命令：{publisher_login_hint(vsce)}\n"
            "请勿将令牌写入脚本、仓库或聊天记录。"
        )
    print(f"[1/3] 验证 {publisher} 的市场发布权限...", flush=True)
    run_process([vsce, "verify-pat", publisher], cwd=ROOT_DIR)
    out_file = output_file(target)
    print(f"[2/3] 导出并校验 VSIX：{out_file}", flush=True)
    run_process([sys.executable, str(ROOT_DIR / "scripts" / "export_vscode_extension.py"), "--target", target], cwd=ROOT_DIR)
    if not out_file.is_file() or out_file.stat().st_size == 0:
        raise RuntimeError(f"导出后未找到有效 VSIX：{out_file}")
    package_name = manifest["name"]
    version = manifest["version"]
    print(f"[3/3] 发布 {publisher}.{package_name}@{version} 到 VS Code 市场...", flush=True)
    try:
        run_process([vsce, "publish", "--packagePath", str(out_file)], cwd=ROOT_DIR)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(
            f"发布失败，VSIX 保留在 {out_file}。请检查网络、发布权限及该版本是否已存在；"
            "已发布版本不能重复覆盖。"
        ) from error
    print(f"发布成功：{publisher}.{package_name}@{version}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default="universal",
        help="universal、current、darwin-arm64、darwin-x64、linux-arm64、linux-x64 或 win32-x64。",
    )
    args = parser.parse_args(argv)
    try:
        publish_extension(args.target)
        return 0
    except subprocess.CalledProcessError as error:
        print(f"命令执行失败，退出码：{error.returncode}", file=sys.stderr)
        return error.returncode or 1
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    exit_code = main()
    if sys.stdin.isatty():
        try:
            input("按 Enter 键关闭窗口...")
        except EOFError:
            pass
    raise SystemExit(exit_code)
