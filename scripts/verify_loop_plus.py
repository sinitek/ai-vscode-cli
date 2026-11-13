"""Python 检测入口共用的参数转发与退出码处理。"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from vscode_extension_process import require_tool, run_process

ROOT_DIR = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    try:
        verifier = ROOT_DIR / "scripts" / "verify_loop_plus_fix.js"
        if not verifier.is_file():
            raise RuntimeError(f"未找到检测脚本：{verifier}，请从完整仓库运行入口。")
        node = require_tool("node")
        run_process([node, str(verifier), "--live", *arguments], cwd=ROOT_DIR)
        return 0
    except subprocess.CalledProcessError as error:
        return error.returncode if error.returncode >= 0 else 128 - error.returncode
    except KeyboardInterrupt:
        print("检测已中断，不能判定修复通过。", file=sys.stderr)
        return 130
    except (OSError, RuntimeError) as error:
        print(f"检测无法启动：{error}", file=sys.stderr)
        return 1
