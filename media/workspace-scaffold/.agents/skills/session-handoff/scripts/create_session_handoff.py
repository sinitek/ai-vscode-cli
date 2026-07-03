#!/usr/bin/env python3
"""Instantiate the session handoff template with a small repository snapshot."""

from __future__ import annotations

import argparse
import re
from datetime import datetime
from pathlib import Path

DEFAULT_OUTPUT_DIR = ".ch/docs/handoffs"
DEFAULT_TEMPLATE = ".ch/docs/handoffs/TEMPLATE.md"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
PENDING_ITEMS_FILE = ".ch/docs/memory/PENDING_ITEMS.md"
ACTIVE_RISKS_FILE = ".ch/docs/memory/ACTIVE_RISKS.md"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a session handoff from TEMPLATE.md.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument("--slug", required=True, help="Short slug for the handoff filename.")
    parser.add_argument("--title", default="", help="Human-readable handoff title.")
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR, help="Output directory.")
    parser.add_argument("--template", default=DEFAULT_TEMPLATE, help="Template file to instantiate.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing handoff.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    slug = normalize_slug(args.slug)
    if not slug:
        raise SystemExit("ERROR: slug must contain at least one letter or number.")

    today = datetime.now().strftime("%Y-%m-%d")
    output_dir = resolve_path(root, args.output_dir)
    output_path = output_dir / f"{today}-{slug}.md"
    if output_path.exists() and not args.force:
        raise SystemExit(f"ERROR: file already exists: {display_path(output_path, root)}")

    template_path = resolve_path(root, args.template)
    template = template_path.read_text(encoding="utf-8")
    output_dir.mkdir(parents=True, exist_ok=True)

    content = instantiate_template(
        template=template,
        title=args.title.strip() or slug.replace("-", " "),
        date=today,
        slug=slug,
        output_path=display_path(output_path, root),
    )
    content = replace_section(content, "关联 active plans", snapshot_active_plans(root))
    content = replace_section(content, "Pending items 快照", snapshot_table(root / PENDING_ITEMS_FILE))
    content = replace_section(content, "Active risks 快照", snapshot_table(root / ACTIVE_RISKS_FILE))
    output_path.write_text(content, encoding="utf-8")

    print(f"[session-handoff] created {display_path(output_path, root)}")
    return 0


def normalize_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", value.strip().lower())
    return re.sub(r"-{2,}", "-", slug).strip("-")


def resolve_path(root: Path, value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else root / path


def display_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.name


def instantiate_template(*, template: str, title: str, date: str, slug: str, output_path: str) -> str:
    replacements = {
        ".ch/docs/handoffs/YYYY-MM-DD-slug.md": output_path,
        "YYYY-MM-DD": date,
        "slug": slug,
        "<title>": title,
    }
    content = template
    for old, new in replacements.items():
        content = content.replace(old, new)
    return content


def snapshot_active_plans(root: Path) -> list[str]:
    active_dir = root / ACTIVE_PLANS_DIR
    if not active_dir.exists():
        return ["- 当前无 active plan"]
    plans = sorted(path for path in active_dir.glob("*.md") if path.is_file())
    if not plans:
        return ["- 当前无 active plan"]
    return [f"- `{display_path(path, root)}`" for path in plans[:10]]


def snapshot_table(path: Path) -> list[str]:
    if not path.exists():
        return ["- 当前无记录"]
    rows = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("|") and "starter 默认" not in line
    ]
    data_rows = [line for line in rows if not is_table_divider(line)]
    if len(data_rows) <= 1:
        return ["- 当前无记录"]
    return [f"- {compact_table_row(line)}" for line in data_rows[1:11]]


def is_table_divider(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell or "") for cell in cells)


def compact_table_row(line: str) -> str:
    cells = [cell.strip() for cell in line.strip("|").split("|")]
    return " | ".join(cell for cell in cells if cell)


def replace_section(content: str, heading: str, bullets: list[str]) -> str:
    pattern = re.compile(rf"(## {re.escape(heading)}\n\n)(.*?)(?=\n## |\Z)", re.S)
    return pattern.sub(lambda match: f"{match.group(1)}{chr(10).join(bullets)}\n", content, count=1)


if __name__ == "__main__":
    raise SystemExit(main())
