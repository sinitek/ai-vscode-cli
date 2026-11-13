#!/usr/bin/env python3
"""macOS 根目录 Loop+/Codex 一键检测入口。"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "scripts"))

from verify_loop_plus import main


if __name__ == "__main__":
    raise SystemExit(main())
