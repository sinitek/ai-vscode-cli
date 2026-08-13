#!/usr/bin/env python3
"""Build a generated task board from active execution plans and git status."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

GENERATOR_NAME = "task-board"
GENERATOR_VERSION = "0.1.0"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
COMPLETED_PLANS_DIR = ".ch/docs/exec-plans/completed"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/task-board"
EXCLUDED_FILES = {".gitkeep", ".keep"}
PRIVATE_TAG_NAMES = (
    "private",
    "no-memory",
    "memory-private",
    "system_instruction",
    "system-instruction",
    "system-reminder",
    "persisted-output",
)
PRIVATE_TAG_RE = re.compile(
    rf"<({'|'.join(re.escape(name) for name in PRIVATE_TAG_NAMES)})\b[^>]*>[\s\S]*?</\1>",
    re.IGNORECASE,
)
TEMPLATE_MARKERS = (
    "# 计划标题",
    "- 日期：YYYY-MM-DD",
    "- 状态：draft / in-progress / blocked / completed",
    "- 负责人：Codex / 人类 / 协作",
    "## 验收标准",
    "- [ ] 标准 1",
    "## 任务列表",
    "- [ ] 步骤 1",
)
KNOWN_STATUSES = {"draft", "pending", "in-progress", "blocked", "completed"}


@dataclass
class BoardTask:
    id: str
    title: str
    status: str
    owner: str
    responsible: str
    source_path: str
    modified_at: str
    next_steps: list[str] = field(default_factory=list)
    completed_steps: list[str] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)
    checks: list[str] = field(default_factory=list)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build generated task board artifacts.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for task-board artifacts. Relative paths resolve from --root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_path(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    tasks = collect_tasks(root)
    changed_paths = collect_git_changed_paths(root)
    payload = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "source_paths": [task.source_path for task in tasks],
        "summary": build_summary(tasks, changed_paths),
        "tasks": [asdict(task) for task in tasks],
        "changed_paths": changed_paths,
    }

    write_json(output_dir / "task-board.json", payload)
    write_text(output_dir / "task-board.md", render_markdown(payload))

    print(f"[{GENERATOR_NAME}] generated task board artifacts in {output_dir}")
    print("- task-board.md")
    print("- task-board.json")
    return 0


def resolve_path(root: Path, value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return root / path


def collect_tasks(root: Path) -> list[BoardTask]:
    plans_dir = root / ACTIVE_PLANS_DIR
    if not plans_dir.exists():
        return []

    tasks: list[BoardTask] = []
    for path in sorted(plans_dir.glob("*.md")):
        if not path.is_file() or path.name in EXCLUDED_FILES:
            continue
        plan = load_public_plan(path)
        if plan is None:
            continue
        metadata, text = plan
        if is_starter_plan(path, metadata, text):
            continue
        tasks.append(parse_plan(path, root, text))
    return tasks


def parse_plan(path: Path, root: Path, text: str) -> BoardTask:
    lines = text.splitlines()
    sections = parse_sections(lines)
    header_lines = lines[: first_section_line(lines)]
    checklist = parse_checklist_items(sections.get("任务列表", []))

    source_path = path.relative_to(root).as_posix()
    title = extract_title(lines, path.stem)
    status = normalize_status(extract_prefixed_value(header_lines, "状态") or "draft")
    owner = extract_prefixed_value(header_lines, "owner") or "未指定"
    responsible = extract_prefixed_value(header_lines, "负责人") or "未指定"

    blockers = collect_matching_items(
        sections.get("风险与缓解", []) + sections.get("当前结论", []),
        ("阻塞", "blocker", "blocked", "卡住", "等待"),
    )
    checks = collect_matching_items(
        sections.get("验证计划", []) + sections.get("测试与清单同步", []),
        ("验证", "测试", "自测", "check", "build", "pytest", "unittest"),
    )

    return BoardTask(
        id=slugify(path.stem),
        title=title,
        status=status,
        owner=owner,
        responsible=responsible,
        source_path=source_path,
        modified_at=iso_from_timestamp(path.stat().st_mtime),
        next_steps=[item for item, checked in checklist if not checked][:8],
        completed_steps=[item for item, checked in checklist if checked][:8],
        blockers=dedupe(blockers)[:8],
        checks=dedupe(checks)[:8],
    )


def parse_sections(lines: list[str]) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in lines:
        if line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def first_section_line(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if line.startswith("## "):
            return index
    return len(lines)


def extract_title(lines: list[str], fallback: str) -> str:
    for line in lines:
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def extract_prefixed_value(lines: list[str], label: str) -> str:
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("-"):
            continue
        payload = strip_list_prefix(stripped)
        matched = re.match(rf"^{re.escape(label)}\s*[:：]\s*(.+)$", payload)
        if matched:
            return matched.group(1).strip()
    return ""


def normalize_status(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    if normalized == "inprogress":
        return "in-progress"
    if normalized not in KNOWN_STATUSES:
        return "draft"
    return normalized


def parse_checklist_items(lines: list[str]) -> list[tuple[str, bool]]:
    items: list[tuple[str, bool]] = []
    pattern = re.compile(r"^[-*]\s+\[([ xX])\]\s+(.+)$")
    for line in lines:
        matched = pattern.match(line.strip())
        if not matched:
            continue
        text = matched.group(2).strip()
        if text:
            items.append((text, matched.group(1).lower() == "x"))
    return items


def collect_matching_items(lines: list[str], keywords: tuple[str, ...]) -> list[str]:
    items: list[str] = []
    for line in lines:
        payload = strip_list_prefix(line.strip())
        if not payload:
            continue
        lowered = payload.lower()
        if any(keyword.lower() in lowered for keyword in keywords):
            items.append(payload)
    return items


def strip_list_prefix(text: str) -> str:
    return re.sub(r"^[-*]\s+", "", text).strip()


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}, text
    metadata: dict[str, str] = {}
    for line in parts[0].splitlines()[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, parts[1]


def is_private_document(metadata: dict[str, str]) -> bool:
    visibility = metadata.get("memory_visibility", "").strip().lower()
    private = metadata.get("private", "").strip().lower()
    return visibility in {"private", "no-memory"} or private in {"true", "yes", "1"}


def strip_private_blocks(text: str) -> tuple[str, int]:
    count = 0

    def replace(_match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return ""

    parts = re.split(r"(```[\s\S]*?```)", text)
    stripped_parts: list[str] = []
    for part in parts:
        if part.startswith("```"):
            stripped_parts.append(part)
            continue
        inline_parts = re.split(r"(`[^`\n]*`)", part)
        for inline_part in inline_parts:
            if inline_part.startswith("`") and inline_part.endswith("`"):
                stripped_parts.append(inline_part)
            else:
                stripped_parts.append(PRIVATE_TAG_RE.sub(replace, inline_part))
    return "".join(stripped_parts), count


def load_public_plan(path: Path) -> tuple[dict[str, str], str] | None:
    metadata, body = split_front_matter(path.read_text(encoding="utf-8"))
    if is_private_document(metadata):
        return None
    stripped, _strip_count = strip_private_blocks(body)
    return metadata, stripped


def is_starter_plan(path: Path, metadata: dict[str, str], text: str) -> bool:
    if path.stem.lower() == "template":
        return True
    if is_truthy(metadata.get("starter")) or is_truthy(metadata.get("template")):
        return True
    marker_hits = sum(1 for marker in TEMPLATE_MARKERS if marker in text)
    return marker_hits >= 6 and extract_title(text.splitlines(), path.stem) == "计划标题"


def is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"true", "yes", "1"}


def collect_git_changed_paths(root: Path) -> list[str]:
    try:
        result = subprocess.run(
            ["git", "status", "--short"],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        return []

    if result.returncode != 0:
        return []

    paths: list[str] = []
    for line in result.stdout.splitlines():
        if not line.strip():
            continue
        payload = line[3:].strip()
        if " -> " in payload:
            payload = payload.split(" -> ", 1)[1]
        normalized = normalize_completed_plan_path(root, payload)
        if normalized not in paths:
            paths.append(normalized)
    return paths


def normalize_completed_plan_path(root: Path, value: str) -> str:
    prefix = f"{COMPLETED_PLANS_DIR}/"
    if not value.startswith(prefix):
        return value
    filename = value[len(prefix):]
    if "/" in filename or not re.match(r"^\d{4}-\d{2}-.*\.md$", filename):
        return value
    normalized = f"{prefix}{filename[:7]}/{filename}"
    if (root / normalized).exists():
        return normalized
    return value


def build_summary(tasks: list[BoardTask], changed_paths: list[str]) -> dict[str, int]:
    summary = {
        "task_count": len(tasks),
        "changed_path_count": len(changed_paths),
        "pending_count": 0,
        "in_progress_count": 0,
        "blocked_count": 0,
        "completed_count": 0,
    }
    for task in tasks:
        if task.status in {"draft", "pending"}:
            summary["pending_count"] += 1
        elif task.status == "in-progress":
            summary["in_progress_count"] += 1
        elif task.status == "blocked":
            summary["blocked_count"] += 1
        elif task.status == "completed":
            summary["completed_count"] += 1
    return summary


def render_markdown(payload: dict[str, object]) -> str:
    summary = payload["summary"]
    tasks = payload["tasks"]
    changed_paths = payload["changed_paths"]
    lines = [
        "# Task Board",
        "",
        f"- generated_at: {payload['generated_at']}",
        f"- generator: {payload['generator']}@{payload['version']}",
        f"- active tasks: {summary['task_count']}",
        f"- changed paths: {summary['changed_path_count']}",
        "",
        "## Summary",
        "",
        "| Status | Count |",
        "| --- | ---: |",
        f"| pending | {summary['pending_count']} |",
        f"| in-progress | {summary['in_progress_count']} |",
        f"| blocked | {summary['blocked_count']} |",
        f"| completed | {summary['completed_count']} |",
        "",
        "## Tasks",
        "",
    ]

    if not tasks:
        lines.append("No active execution plans found.")
    else:
        lines.extend(
            [
                "| ID | Title | Status | Owner | Next | Source |",
                "| --- | --- | --- | --- | --- | --- |",
            ]
        )
        for task in tasks:
            next_steps = task["next_steps"] or ["-"]
            lines.append(
                "| "
                + " | ".join(
                    [
                        escape_table(str(task["id"])),
                        escape_table(str(task["title"])),
                        escape_table(str(task["status"])),
                        escape_table(str(task["owner"])),
                        escape_table("; ".join(next_steps[:3])),
                        f"`{task['source_path']}`",
                    ]
                )
                + " |"
            )

    lines.extend(["", "## Blockers", ""])
    blocker_rows = [
        (task["id"], blocker)
        for task in tasks
        for blocker in task["blockers"]
    ]
    if not blocker_rows:
        lines.append("No blockers detected from active plans.")
    else:
        for task_id, blocker in blocker_rows:
            lines.append(f"- `{task_id}`: {blocker}")

    lines.extend(["", "## Changed Paths", ""])
    if not changed_paths:
        lines.append("No git changes detected.")
    else:
        for path in changed_paths:
            lines.append(f"- `{path}`")

    return "\n".join(lines).rstrip() + "\n"


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def write_text(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9一-龥_-]+", "-", value).strip("-").lower()
    return slug or "task"


def dedupe(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def escape_table(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def iso_now() -> str:
    return datetime.now(UTC).astimezone().isoformat(timespec="seconds")


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, UTC).astimezone().isoformat(timespec="seconds")


if __name__ == "__main__":
    raise SystemExit(main())
