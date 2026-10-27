"""VS Code 插件脚本共用的跨平台进程与工具解析。"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path
from shutil import which
from typing import TextIO


def is_windows() -> bool:
    return os.name == "nt"


def cmd_quote(arg: str) -> str:
    if arg == "":
        return '""'
    needs_quotes = any(ch in arg for ch in ' \t"&|<>()^') or '"' in arg
    if not needs_quotes:
        return arg
    return '"' + arg.replace('"', '""') + '"'


def run_process(argv: list[str], *, cwd: Path, stdout: TextIO | None = None) -> None:
    if not argv:
        raise ValueError("empty argv")

    capture_output = stdout is not None
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
            result = subprocess.run(full, cwd=cwd, check=True, capture_output=capture_output, text=capture_output)
            if capture_output:
                stdout.write(result.stdout)
            return

    result = subprocess.run(argv, cwd=cwd, check=True, capture_output=capture_output, text=capture_output)
    if capture_output:
        stdout.write(result.stdout)


def require_tool(name: str) -> str:
    resolved = which(name)
    if not resolved:
        raise RuntimeError(f"{name} 未安装或不在 PATH 中。")
    return resolved
