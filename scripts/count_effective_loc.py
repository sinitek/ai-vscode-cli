#!/usr/bin/env python3

"""Python entry point for the repository's code line count report."""

import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent
COUNTER_SCRIPT = SCRIPT_DIR / "count_effective_loc.js"


def main() -> int:
    try:
        result = subprocess.run(
            ["node", str(COUNTER_SCRIPT), *sys.argv[1:]],
            check=False,
        )
    except FileNotFoundError:
        print("未找到 Node.js，无法运行代码行数统计。", file=sys.stderr)
        return 1
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
