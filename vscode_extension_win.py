#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from shutil import which


ROOT_DIR = Path(__file__).resolve().parent


def is_windows() -> bool:
    return os.name == "nt"


def cmd_quote(arg: str) -> str:
    if arg == "":
        return '""'
    needs_quotes = any(ch in arg for ch in ' \t"&|<>()^') or '"' in arg
    if not needs_quotes:
        return arg
    return '"' + arg.replace('"', '""') + '"'


def run_process(argv: list[str], *, cwd: Path) -> None:
  if not argv:
    raise ValueError("empty argv")

  if is_windows():
    exe = argv[0]
    resolved = which(exe) if exe and not any(sep in exe for sep in ("\\", "/")) else None
    if resolved:
      exe = resolved
      argv = [resolved, *argv[1:]]

    if exe.lower().endswith((".cmd", ".bat")):
      comspec = os.environ.get("COMSPEC", "cmd.exe")
      inner = " ".join(cmd_quote(a) for a in argv)
      # Pass a single string to avoid Python escaping quotes (\"...\") which breaks cmd.exe parsing.
      full = f'{cmd_quote(comspec)} /d /s /c "{inner}"'
      subprocess.run(full, cwd=cwd, check=True)
      return

  subprocess.run(argv, cwd=cwd, check=True)


def require_tool(name: str) -> str:
    resolved = which(name)
    if not resolved:
        raise RuntimeError(f"{name} 未安装或不在 PATH 中。")
    return resolved


def find_vscode_code_command() -> str | None:
    for name in ("code", "code.cmd", "code-insiders", "code-insiders.cmd"):
        resolved = which(name)
        if resolved:
            return resolved

    if not is_windows():
        return None

    candidates: list[Path] = []
    local_app_data = os.environ.get("LOCALAPPDATA")
    program_files = os.environ.get("ProgramFiles")
    program_files_x86 = os.environ.get("ProgramFiles(x86)")

    if local_app_data:
        candidates += [
            Path(local_app_data) / "Programs" / "Microsoft VS Code" / "bin" / "code.cmd",
            Path(local_app_data) / "Programs" / "Microsoft VS Code Insiders" / "bin" / "code-insiders.cmd",
        ]
    if program_files:
        candidates += [
            Path(program_files) / "Microsoft VS Code" / "bin" / "code.cmd",
            Path(program_files) / "Microsoft VS Code Insiders" / "bin" / "code-insiders.cmd",
        ]
    if program_files_x86:
        candidates += [
            Path(program_files_x86) / "Microsoft VS Code" / "bin" / "code.cmd",
            Path(program_files_x86) / "Microsoft VS Code Insiders" / "bin" / "code-insiders.cmd",
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def read_package_json() -> dict:
    package_json_path = ROOT_DIR / "package.json"
    with package_json_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def cmd_dev(*, code_cmd: str | None, skip_install: bool, skip_build: bool) -> None:
    require_tool("npm")

    resolved_code = code_cmd or find_vscode_code_command()
    if not resolved_code:
        raise RuntimeError(
            "未找到 VS Code 命令行工具 'code'。\n"
            "Windows：可在 VS Code 中执行 Ctrl+Shift+P -> Shell Command: Install 'code' command in PATH，"
            "或手动定位 code.cmd（常见路径：%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code.cmd）。"
        )

    if not skip_install:
        run_process(["npm", "install"], cwd=ROOT_DIR)
    if not skip_build:
        run_process(["npm", "run", "build"], cwd=ROOT_DIR)

    run_process([resolved_code, f"--extensionDevelopmentPath={str(ROOT_DIR)}"], cwd=ROOT_DIR)


def resolve_vsce_command() -> list[str] | None:
    vsce = which("vsce")
    if vsce:
        return [vsce]
    npx = which("npx")
    if npx:
        return [npx, "--yes", "@vscode/vsce"]
    return None


def cmd_package(*, out_file: str | None) -> None:
    pkg = read_package_json()
    package_name = str(pkg.get("name") or "sinitek-cli-tools")
    version = str(pkg.get("version") or "0.0.0")

    out_dir = ROOT_DIR / "dist"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = Path(out_file) if out_file else (out_dir / f"{package_name}-{version}.vsix")

    vsce_cmd = resolve_vsce_command()
    if not vsce_cmd:
        raise RuntimeError(
            "vsce 未安装且未找到 npx。\n"
            "建议：npm i -g @vscode/vsce（或确保 npx 可用）。"
        )

    print(f"Building VS Code extension and exporting to {target} ...")
    run_process([*vsce_cmd, "package", "--out", str(target)], cwd=ROOT_DIR)
    print(f"Done. VSIX saved to {target}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        prog="vscode_extension_win.py",
        description="Windows helper script for running and packaging this VS Code extension.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    dev = sub.add_parser("dev", help="Install deps, build, and open VS Code in extension dev mode.")
    dev.add_argument("--code", dest="code_cmd", help="Override VS Code 'code' command path.")
    dev.add_argument("--skip-install", action="store_true", help="Skip npm install.")
    dev.add_argument("--skip-build", action="store_true", help="Skip npm run build.")

    package = sub.add_parser("package", help="Export VSIX to dist/<name>-<version>.vsix.")
    package.add_argument("--out", dest="out_file", help="Override output VSIX path.")

    args = parser.parse_args(argv)
    try:
        if args.command == "dev":
            cmd_dev(code_cmd=args.code_cmd, skip_install=args.skip_install, skip_build=args.skip_build)
            return 0
        if args.command == "package":
            cmd_package(out_file=args.out_file)
            return 0
        raise RuntimeError(f"unknown command: {args.command}")
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
