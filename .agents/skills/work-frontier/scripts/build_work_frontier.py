#!/usr/bin/env python3
"""Build generated frontier views from active execution plans."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

GENERATOR_NAME = "work-frontier"
GENERATOR_VERSION = "0.1.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
PLAN_TEMPLATE = ".ch/docs/exec-plans/TEMPLATE.md"
EXCLUDED_FILES = {".keep"}
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
STATUS_PRIORITY = {
    "blocked": 0,
    "in-progress": 1,
    "draft": 2,
    "completed": 3,
}


@dataclass
class PlanTask:
    text: str
    checked: bool


@dataclass
class PlanRecord:
    path: str
    title: str
    date: str
    status: str
    responsible: str
    owner: str
    claimed_at: str
    claim_ttl: str
    handoff_to: str
    modified_at: str
    next_tasks: list[str]
    completed_tasks: list[str]
    blockers: list[str]
    dependencies: list[str]
    current_conclusions: list[str]
    validation_summary: list[str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build generated work frontier views.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated frontier docs. Relative paths resolve from --root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        display_output_dir = output_dir.relative_to(root).as_posix()
    except ValueError:
        display_output_dir = str(output_dir)

    plans = collect_active_plans(root)
    summary = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "repo_root": str(root),
        "active_plan_count": len(plans),
        "plans": [plan.to_dict() for plan in plans],
        "blocked_count": sum(1 for plan in plans if plan.status == "blocked"),
        "claimed_count": sum(1 for plan in plans if plan.claimed_at or plan.owner not in {"", "未指定"}),
    }

    write_text(output_dir / "work-frontier.md", render_work_frontier(plans, display_output_dir))
    write_text(output_dir / "open-blockers.md", render_open_blockers(plans, display_output_dir))
    write_text(output_dir / "ownership-map.md", render_ownership_map(plans, display_output_dir))
    write_json(output_dir / "work-frontier-summary.json", summary)

    print(f"[{GENERATOR_NAME}] generated frontier artifacts in {output_dir}")
    print("- work-frontier.md")
    print("- open-blockers.md")
    print("- ownership-map.md")
    print("- work-frontier-summary.json")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def collect_active_plans(root: Path) -> list[PlanRecord]:
    plans_dir = root / ACTIVE_PLANS_DIR
    if not plans_dir.exists():
        return []

    records: list[PlanRecord] = []
    for path in sorted(plans_dir.glob("*.md")):
        if not path.is_file() or path.name in EXCLUDED_FILES:
            continue
        plan = load_public_plan(path)
        if plan is None:
            continue
        metadata, text = plan
        if is_starter_plan(path, metadata, text):
            continue
        records.append(parse_plan(path, root, text))

    records.sort(key=plan_sort_key)
    return records


def parse_plan(path: Path, root: Path, text: str) -> PlanRecord:
    lines = text.splitlines()
    sections = parse_sections(lines)
    title = extract_title(lines, path.stem)
    header_lines = lines[: first_section_line(lines)]

    date = extract_prefixed_value(header_lines, "日期")
    status = normalize_status(extract_prefixed_value(header_lines, "状态") or "draft")
    responsible = extract_prefixed_value(header_lines, "负责人") or "未指定"
    owner = extract_prefixed_value(header_lines, "owner")
    claimed_at = extract_prefixed_value(header_lines, "claimed_at")
    claim_ttl = extract_prefixed_value(header_lines, "claim_ttl")
    handoff_to = extract_prefixed_value(header_lines, "handoff_to")

    task_items = parse_checklist_items(sections.get("任务列表", []))
    blockers = collect_semantic_items(sections.get("风险与缓解", []), ("阻塞", "blocker", "依赖"))
    blockers.extend(item for item in collect_semantic_items(sections.get("当前结论", []), ("阻塞", "卡住", "等待", "依赖")) if item not in blockers)
    dependencies = collect_semantic_items(sections.get("影响面", []), ("依赖", "上游", "外部", "服务", "配置"))
    dependencies.extend(item for item in collect_semantic_items(sections.get("当前结论", []), ("依赖", "等待", "需要先")) if item not in dependencies)

    return PlanRecord(
        path=path.relative_to(root).as_posix(),
        title=title,
        date=date,
        status=status,
        responsible=responsible,
        owner=owner,
        claimed_at=claimed_at,
        claim_ttl=claim_ttl,
        handoff_to=handoff_to,
        modified_at=iso_from_timestamp(path.stat().st_mtime),
        next_tasks=[item.text for item in task_items if not item.checked][:5],
        completed_tasks=[item.text for item in task_items if item.checked][:5],
        blockers=dedupe_preserve_order(blockers)[:5],
        dependencies=dedupe_preserve_order(dependencies)[:5],
        current_conclusions=extract_list_items(sections.get("当前结论", []))[:5],
        validation_summary=extract_list_items(sections.get("验证计划", []))[:4],
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
        if not payload:
            continue
        matched = re.match(rf"^{re.escape(label)}\s*[:：]\s*(.+)$", payload)
        if matched:
            return matched.group(1).strip()
    return ""


def normalize_status(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    if normalized in {"in_progress", "inprogress"}:
        return "in-progress"
    if normalized == "pending":
        return "draft"
    if normalized not in {"draft", "in-progress", "blocked", "completed"}:
        return "draft"
    return normalized


def parse_checklist_items(lines: list[str]) -> list[PlanTask]:
    items: list[PlanTask] = []
    pattern = re.compile(r"^[-*]\s+\[([ xX])\]\s+(.+)$")
    for line in lines:
        matched = pattern.match(line.strip())
        if not matched:
            continue
        checked = matched.group(1).lower() == "x"
        text = matched.group(2).strip()
        if text:
            items.append(PlanTask(text=text, checked=checked))
    return items


def collect_semantic_items(lines: list[str], keywords: tuple[str, ...]) -> list[str]:
    items: list[str] = []
    for text in extract_list_items(lines):
        if any(keyword in text for keyword in keywords) and not any(token in text for token in ("并行", "可并行")):
            items.append(text)
    return items


def extract_list_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for line in lines:
        stripped = line.strip()
        payload = strip_list_prefix(stripped)
        if not payload:
            continue
        if payload.startswith("[") and "]" in payload:
            payload = payload.split("]", 1)[1].strip()
        if payload:
            items.append(payload)
    return items


def strip_list_prefix(text: str) -> str:
    cleaned = re.sub(r"^[-*]\s+", "", text)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    return cleaned.strip()


def dedupe_preserve_order(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result


def plan_sort_key(plan: PlanRecord) -> tuple[int, int, str]:
    status_weight = STATUS_PRIORITY.get(plan.status, 9)
    blocked_boost = 0 if plan.blockers else 1
    return (status_weight, blocked_boost, plan.path)


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
    if path.as_posix().endswith(PLAN_TEMPLATE) or path.stem.lower() == "template":
        return True
    if is_truthy(metadata.get("starter")) or is_truthy(metadata.get("template")):
        return True
    marker_hits = sum(1 for marker in TEMPLATE_MARKERS if marker in text)
    return marker_hits >= 6 and extract_title(text.splitlines(), path.stem) == "计划标题"


def is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"true", "yes", "1"}


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_text(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


def write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render_work_frontier(plans: list[PlanRecord], display_output_dir: str) -> str:
    lines = [
        "# Work Frontier",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Output dir: {display_output_dir}",
        f"- Active plans: {len(plans)}",
        f"- Blocked plans: {sum(1 for plan in plans if plan.status == 'blocked')}",
        f"- Claimed plans: {sum(1 for plan in plans if plan.claimed_at or plan.owner not in {'', '未指定'})}",
        "",
    ]

    lines.extend(render_frontier_group("Now", [plan for plan in plans if plan.status == "in-progress"]))
    lines.extend(render_frontier_group("Blocked", [plan for plan in plans if plan.status == "blocked"]))
    lines.extend(render_frontier_group("Next", [plan for plan in plans if plan.status == "draft"]))
    return "\n".join(lines)


def render_frontier_group(title: str, plans: list[PlanRecord]) -> list[str]:
    lines = [f"## {title}", ""]
    if not plans:
        lines.append("- None")
        lines.append("")
        return lines

    for plan in plans:
        claim_suffix = []
        if plan.owner and plan.owner != "未指定":
            claim_suffix.append(f"owner={plan.owner}")
        if plan.responsible and plan.responsible != "未指定":
            claim_suffix.append(f"负责人={plan.responsible}")
        if plan.claimed_at:
            claim_suffix.append(f"claimed_at={plan.claimed_at}")
        if plan.claim_ttl:
            claim_suffix.append(f"claim_ttl={plan.claim_ttl}")
        if plan.handoff_to:
            claim_suffix.append(f"handoff_to={plan.handoff_to}")
        extra = f" | {'; '.join(claim_suffix)}" if claim_suffix else ""
        lines.append(f"- `{plan.path}` | 状态={plan.status}{extra}")
        lines.append(f"  标题：{plan.title}")
        if plan.next_tasks:
            lines.append("  下一步：" + "；".join(plan.next_tasks[:3]))
        elif plan.current_conclusions:
            lines.append("  当前结论：" + "；".join(plan.current_conclusions[:2]))
        if plan.blockers:
            lines.append("  阻塞：" + "；".join(plan.blockers[:2]))
        if plan.dependencies:
            lines.append("  依赖：" + "；".join(plan.dependencies[:2]))
        lines.append("")
    return lines


def render_open_blockers(plans: list[PlanRecord], display_output_dir: str) -> str:
    lines = [
        "# Open Blockers",
        "",
        f"- Output dir: {display_output_dir}",
        "",
        "## Current blockers",
        "",
    ]
    blocked_plans = [plan for plan in plans if plan.blockers or plan.status == "blocked"]
    if not blocked_plans:
        lines.append("- No explicit blockers found.")
        lines.append("")
        return "\n".join(lines)

    for plan in blocked_plans:
        lines.append(f"## {plan.title}")
        lines.append("")
        lines.append(f"- Plan: `{plan.path}`")
        lines.append(f"- Status: {plan.status}")
        if plan.owner and plan.owner != "未指定":
            lines.append(f"- Owner: {plan.owner}")
        if plan.responsible and plan.responsible != "未指定":
            lines.append(f"- Responsible: {plan.responsible}")
        if plan.blockers:
            for blocker in plan.blockers:
                lines.append(f"- Blocker: {blocker}")
        if plan.dependencies:
            for dependency in plan.dependencies[:3]:
                lines.append(f"- Dependency: {dependency}")
        if plan.handoff_to:
            lines.append(f"- Handoff to: {plan.handoff_to}")
        lines.append("")
    return "\n".join(lines)


def render_ownership_map(plans: list[PlanRecord], display_output_dir: str) -> str:
    lines = [
        "# Ownership Map",
        "",
        f"- Output dir: {display_output_dir}",
        "",
        "## Claimed plans",
        "",
    ]
    if not plans:
        lines.append("- No active plans.")
        lines.append("")
        return "\n".join(lines)

    for plan in plans:
        lines.append(
            f"- `{plan.path}` | 状态={plan.status} | owner={plan.owner or '未指定'} | 负责人={plan.responsible or '未指定'}"
        )
        if plan.claimed_at:
            lines.append(f"  claimed_at={plan.claimed_at}")
        if plan.claim_ttl:
            lines.append(f"  claim_ttl={plan.claim_ttl}")
        if plan.handoff_to:
            lines.append(f"  handoff_to={plan.handoff_to}")
        if not plan.claimed_at and not plan.owner and not plan.handoff_to:
            lines.append("  未声明占用；如为并发任务，建议补 `owner` / `claimed_at` / `claim_ttl`。")
        lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
