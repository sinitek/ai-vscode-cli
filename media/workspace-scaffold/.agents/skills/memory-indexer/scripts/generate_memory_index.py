#!/usr/bin/env python3
"""Generate low-noise memory recall artifacts for the harness docs system."""

from __future__ import annotations

import argparse
from pathlib import Path

from memory_indexer.constants import DEFAULT_OUTPUT_DIR, DEFAULT_STALE_DAYS
from memory_indexer.pipeline import run_generation


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate harness memory index artifacts.")
    parser.add_argument("--root", default=".", help="Repository root to scan.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated artifacts. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=DEFAULT_STALE_DAYS,
        help="Age threshold in days for freshness warnings.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    run_generation(root=root, output_dir_arg=args.output_dir, stale_days=args.stale_days)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
