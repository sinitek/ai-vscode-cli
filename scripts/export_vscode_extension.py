#!/usr/bin/env python3
"""跨平台导出 VSIX 并审计运行时资源。"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from run_dev import install_workspace_node_modules, workspace_has_pnpm_node_modules
from vscode_extension_process import require_tool, run_process


REQUIRED_ENTRIES = (
    "dist/extension.js",
    "package.json",
    "readme.md",
    "media/icon.png",
    "media/loop-plus-intro.jpg",
    "media/logo.svg",
    "media/marked.min.js",
    "media/config/assets/config-app-api.js",
    "media/config/assets/config-app-store.js",
    "media/config/assets/config-app-ui.js",
    "media/config/monaco-editor/0.52.2/min/vs/loader.js",
    "media/workspace-scaffold/AGENTS.md",
    "node_modules/@dagrejs/dagre/package.json",
    "node_modules/@dagrejs/graphlib/package.json",
    "node_modules/marked/package.json",
    "node_modules/json-formatter-js/dist/json-formatter.umd.js",
)
FORBIDDEN_ENTRY_PATTERN = re.compile(
    r"^(?:"
    r"(?:\.agents|\.ch|\.codegraph|\.tmp|docs|scripts|dist/test)(?:/.*)?|"
    r"(?:AGENTS\.md|ARCHITECTURE\.md|export_vscode_extension\.(?:py|sh)|"
    r"publish_vscode_extension\.(?:py|sh)|run_dev\.(?:py|sh)|vscode_extension_process\.py|to)$|"
    r"dist/.*\.map$|"
    r"node_modules/@anthropic-ai/claude-agent-sdk/[^/]+\.d\.ts$|"
    r"(?:.*/)?__pycache__/|.*\.pyc$"
    r")"
)


def read_manifest(root: Path = ROOT_DIR) -> dict:
    return json.loads((root / "package.json").read_text(encoding="utf-8"))


def local_vsce(root: Path = ROOT_DIR) -> str | None:
    names = ("vsce.cmd", "vsce") if os.name == "nt" else ("vsce",)
    for name in names:
        candidate = root / "node_modules" / ".bin" / name
        if candidate.is_file():
            return str(candidate)
    return None


def resolve_vsce(root: Path = ROOT_DIR, *, install_missing: bool = True) -> str:
    command = local_vsce(root) or shutil.which("vsce")
    if command:
        return command
    if install_missing:
        print("未找到 vsce，先安装项目依赖。", flush=True)
        install_workspace_node_modules(require_tool("npm"), root)
        command = local_vsce(root)
    if not command:
        raise RuntimeError("未找到 vsce，请检查项目依赖安装结果。")
    return command


def resolve_target(target: str, root: Path = ROOT_DIR) -> str:
    result = subprocess.run(
        [require_tool("node"), str(root / "scripts" / "vsix_target.js"), "resolve", target],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def output_file(target: str, root: Path = ROOT_DIR) -> Path:
    manifest = read_manifest(root)
    suffix = "" if target == "universal" else f"-{target}"
    return root / "dist" / f"{manifest['name']}-{manifest['version']}{suffix}.vsix"


def package_options(target: str, out_file: Path, ignore_file: Path | None) -> list[str]:
    options = ["package", "--no-rewrite-relative-links", "--out", str(out_file)]
    if target != "universal":
        if ignore_file is None:
            raise ValueError("定向打包缺少 ignore 文件。")
        options.extend(["--target", target, "--ignoreFile", str(ignore_file)])
    return options


def copy_sources_to_staging(staging: Path) -> None:
    shutil.copytree(
        ROOT_DIR,
        staging,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns("node_modules", "dist", ".git", ".codegraph", "*.vsix"),
    )


def sync_compiled_dist(staging: Path) -> None:
    compiled_dist = staging / "dist"
    if compiled_dist.is_dir():
        shutil.copytree(
            compiled_dist,
            ROOT_DIR / "dist",
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("*.vsix"),
        )


def install_staging_node_modules(staging: Path) -> None:
    pnpm = shutil.which("pnpm")
    if pnpm:
        print("临时目录使用 pnpm install --node-linker=hoisted，以便 vsce 的 npm list 能通过。", flush=True)
        run_process([pnpm, "install", "--node-linker=hoisted", "--ignore-scripts"], cwd=staging)
        return
    print("本机没有 pnpm，临时目录改用 npm install。", flush=True)
    npm = require_tool("npm")
    run_process([npm, "install", "--no-fund", "--no-audit", "--ignore-scripts"], cwd=staging)


def package_vsix(target: str, out_file: Path, ignore_file: Path | None) -> None:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    print(f"Building VS Code extension and exporting to {out_file} ...", flush=True)
    if workspace_has_pnpm_node_modules(ROOT_DIR):
        print("当前 node_modules 不是 npm 布局。vsce 会执行 npm list，改为在临时目录安装后再打包。", flush=True)
        with tempfile.TemporaryDirectory(prefix="sinitek-vsix-pack-") as temporary:
            staging = Path(temporary)
            copy_sources_to_staging(staging)
            install_staging_node_modules(staging)
            vsce = local_vsce(staging)
            if not vsce:
                raise RuntimeError("临时依赖安装后仍未找到 vsce。")
            run_process([vsce, *package_options(target, out_file, ignore_file)], cwd=staging)
            sync_compiled_dist(staging)
        return
    vsce = resolve_vsce()
    with tempfile.TemporaryDirectory(prefix="sinitek-vsix-output-") as temporary:
        staged_output = Path(temporary) / out_file.name
        run_process([vsce, *package_options(target, staged_output, ignore_file)], cwd=ROOT_DIR)
        if not staged_output.is_file() or staged_output.stat().st_size == 0:
            raise RuntimeError(f"vsce 未生成有效 VSIX：{staged_output}")
        out_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(staged_output, out_file)


def audit_vsix(out_file: Path, target: str) -> None:
    print("Checking VSIX contents ...", flush=True)
    try:
        with zipfile.ZipFile(out_file) as archive:
            names = archive.namelist()
    except (OSError, zipfile.BadZipFile) as error:
        raise RuntimeError(f"无法读取 VSIX：{out_file}：{error}") from error
    entries = {name[len("extension/"):] for name in names if name.startswith("extension/")}
    forbidden = sorted(entry for entry in entries if FORBIDDEN_ENTRY_PATTERN.fullmatch(entry))
    if forbidden:
        raise RuntimeError("VSIX 包含开发态文件：\n" + "\n".join(forbidden))
    missing = sorted(entry for entry in REQUIRED_ENTRIES if entry not in entries)
    if missing:
        raise RuntimeError("VSIX 缺少必需运行时文件：\n" + "\n".join(missing))
    result = subprocess.run(
        [require_tool("node"), str(ROOT_DIR / "scripts" / "vsix_target.js"), "audit", target],
        cwd=ROOT_DIR,
        input="".join(f"extension/{entry}\n" for entry in sorted(entries)),
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    if result.returncode != 0:
        details = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"VSIX 平台运行时资源审计失败：\n{details or '未提供错误详情'}")
    print(result.stdout.strip(), flush=True)
    size = out_file.stat().st_size
    print(f"VSIX content check passed ({len(names)} entries).")
    print(f"VSIX 大小：{size / 1024 / 1024:.2f} MiB（{size} 字节）")
    print(f"Done. VSIX saved to {out_file}")


def export_extension(target: str) -> Path:
    require_tool("node")
    require_tool("npm")
    target = resolve_target(target)
    out_file = output_file(target)
    with tempfile.TemporaryDirectory(prefix="sinitek-vsix-") as temporary:
        ignore_file = Path(temporary) / "target.ignore"
        if target != "universal":
            run_process(
                [require_tool("node"), str(ROOT_DIR / "scripts" / "vsix_target.js"), "prepare", target, str(ignore_file)],
                cwd=ROOT_DIR,
            )
        package_vsix(target, out_file, ignore_file if target != "universal" else None)
        audit_vsix(out_file, target)
    return out_file


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--target",
        default="universal",
        help="universal、current、darwin-arm64、darwin-x64、linux-arm64、linux-x64 或 win32-x64。",
    )
    args = parser.parse_args(argv)
    try:
        export_extension(args.target)
        return 0
    except subprocess.CalledProcessError as error:
        print(f"命令执行失败，退出码：{error.returncode}", file=sys.stderr)
        return error.returncode or 1
    except (OSError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
