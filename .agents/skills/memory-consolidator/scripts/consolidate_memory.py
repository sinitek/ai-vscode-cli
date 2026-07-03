#!/usr/bin/env python3
"""Generate a low-noise memory consolidation report for the harness docs system."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

GENERATOR_NAME = "memory-consolidator"
GENERATOR_VERSION = "0.1.0"
DEFAULT_OUTPUT_DIR = ".ch/docs/generated/memory-index"
DEFAULT_HANDOFF_LIMIT = 3
HANDOFFS_DIR = ".ch/docs/handoffs"
ACTIVE_PLANS_DIR = ".ch/docs/exec-plans/active"
MEMORY_DIR = ".ch/docs/memory"
DESIGN_DOCS_DIR = ".ch/docs/design-docs"
PITFALLS_DIR = ".ch/docs/runbooks/pitfalls"
EXCLUDED_FILENAMES = {"README.md", "TEMPLATE.md", ".keep"}
STARTER_HINTS = (
    "starter 默认",
    "starter 状态",
    "starter 默认留空",
    "starter 默认不预置",
    "当前为模板初始状态",
)
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
OPEN_LOOP_KEYWORDS = ("待", "未", "后续", "继续", "跟进", "补", "完善", "确认", "同步", "验证", "收尾", "推进")
RISK_KEYWORDS = ("风险", "阻塞", "卡住", "依赖", "不确定", "兼容", "失败", "报错", "异常", "观察", "前置", "回滚")
PITFALL_KEYWORDS = ("报错", "失败", "前置", "坑", "踩", "兼容", "不要", "避免", "注意", "环境", "目录", "权限", "依赖")
DESIGN_KEYWORDS = ("设计", "约束", "边界", "分层", "抽象", "统一", "规范", "默认", "架构", "策略", "模型", "接口", "契约")
EVENT_KEYWORDS = ("失败", "成功", "原因", "方案", "修复", "解决", "事故", "迁移", "回滚", "复盘", "上线", "阻塞", "决策")
PROFILE_KEYWORDS = ("用户要求", "用户偏好", "项目约束", "技术栈", "业务约束", "长期约束", "项目画像", "不允许替换技术栈")
USER_PROFILE_KEYWORDS = ("用户", "偏好", "沟通", "验证偏好", "实现偏好")
PROCEDURAL_KEYWORDS = ("每次", "必须", "不要", "避免", "步骤", "流程", "固定动作", "脚本", "自动", "检查", "规避")
ROLLING_SUMMARY_HEADERS = ("时间窗口", "摘要", "覆盖来源", "保留原因", "下一次复核")
EVENT_MEMORY_HEADERS = ("日期", "类型", "事件", "结果/原因", "可复用结论", "来源")
PENDING_ITEMS_HEADERS = ("事项", "状态", "Owner", "来源", "下一步")
ACTIVE_RISKS_HEADERS = ("风险", "影响", "当前缓解", "来源")
LESSONS_HEADERS = ("场景", "推荐动作", "来源")


@dataclass
class MarkdownDoc:
    path: str
    title: str
    modified_at: str
    sections: dict[str, list[str]]

    def to_dict(self) -> dict[str, object]:
        return {
            "path": self.path,
            "title": self.title,
            "modified_at": self.modified_at,
            "sections": sorted(self.sections.keys()),
        }


@dataclass
class PitfallEntry:
    path: str
    title: str
    status: str
    symptom: str
    long_term_avoidance: str
    verification: str
    modified_at: str

    def to_dict(self) -> dict[str, str]:
        return asdict(self)


@dataclass
class Suggestion:
    kind: str
    destination: str
    confidence: str
    source_path: str
    source_section: str
    text: str
    reason: str
    draft_fields: dict[str, str]

    def to_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class PrivacyStats:
    private_docs_skipped: list[str]
    private_blocks_stripped: int = 0

    def add_private_doc(self, path: str) -> None:
        if path not in self.private_docs_skipped:
            self.private_docs_skipped.append(path)

    def add_private_blocks(self, count: int) -> None:
        self.private_blocks_stripped += count

    def to_dict(self) -> dict[str, object]:
        return {
            "private_docs_skipped": list(self.private_docs_skipped),
            "private_doc_skip_count": len(self.private_docs_skipped),
            "private_blocks_stripped": self.private_blocks_stripped,
            "supported_tags": list(PRIVATE_TAG_NAMES),
        }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate a memory consolidation report.")
    parser.add_argument("--root", default=".", help="Repository root to scan.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated consolidation artifacts. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--handoff-limit",
        type=int,
        default=DEFAULT_HANDOFF_LIMIT,
        help="How many recent handoff files to scan.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    output_dir = resolve_output_dir(root, args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    privacy = PrivacyStats(private_docs_skipped=[])

    handoffs = collect_markdown_docs(root / HANDOFFS_DIR, root, privacy, limit=args.handoff_limit, newest_first=True)
    active_plans = collect_markdown_docs(root / ACTIVE_PLANS_DIR, root, privacy, newest_first=False)
    pitfall_entries = collect_pitfall_entries(root, privacy)
    design_titles = collect_design_doc_titles(root, privacy)

    rolling_summaries = load_named_table(root / MEMORY_DIR / "ROLLING_SUMMARY.md", ROLLING_SUMMARY_HEADERS, root, privacy)
    event_memories = load_named_table(root / MEMORY_DIR / "EVENT_MEMORY.md", EVENT_MEMORY_HEADERS, root, privacy)
    pending_items = load_named_table(root / MEMORY_DIR / "PENDING_ITEMS.md", PENDING_ITEMS_HEADERS, root, privacy)
    active_risks = load_named_table(root / MEMORY_DIR / "ACTIVE_RISKS.md", ACTIVE_RISKS_HEADERS, root, privacy)
    lessons = load_named_table(root / MEMORY_DIR / "LESSONS_LEARNED.md", LESSONS_HEADERS, root, privacy)

    existing_rollups = {normalize_key(row["摘要"]) for row in rolling_summaries}
    existing_events = {normalize_key(row["事件"]) for row in event_memories}
    existing_pending = {normalize_key(row["事项"]) for row in pending_items}
    existing_risks = {normalize_key(row["风险"]) for row in active_risks}
    existing_lessons = {normalize_key(row["场景"]) for row in lessons}
    existing_pitfalls = {normalize_key(entry.title) for entry in pitfall_entries}

    suggestions: list[Suggestion] = []
    seen_keys: set[str] = set()

    collect_rolling_summary_suggestions(suggestions, seen_keys, handoffs, active_plans, existing_rollups)
    collect_event_memory_suggestions(suggestions, seen_keys, handoffs, active_plans, pitfall_entries, existing_events)
    collect_profile_suggestions(suggestions, seen_keys, handoffs, active_plans)
    collect_procedural_suggestions(suggestions, seen_keys, handoffs, active_plans, pitfall_entries, existing_pitfalls)
    collect_pending_item_suggestions(suggestions, seen_keys, handoffs, active_plans, existing_pending)
    collect_active_risk_suggestions(suggestions, seen_keys, handoffs, active_plans, pitfall_entries, existing_risks)
    collect_lesson_suggestions(suggestions, seen_keys, pitfall_entries, existing_lessons)
    collect_pitfall_suggestions(suggestions, seen_keys, handoffs, active_plans, existing_pitfalls)
    collect_design_suggestions(suggestions, seen_keys, handoffs, active_plans, design_titles)

    coverage_gaps = build_coverage_gaps(
        handoffs=handoffs,
        active_plans=active_plans,
        rolling_summaries=rolling_summaries,
        event_memories=event_memories,
        pending_items=pending_items,
        active_risks=active_risks,
        lessons=lessons,
        suggestions=suggestions,
    )

    summary = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "repo_root": str(root),
        "sources": {
            "handoffs": [doc.to_dict() for doc in handoffs],
            "active_plans": [doc.to_dict() for doc in active_plans],
            "pitfalls": [entry.to_dict() for entry in pitfall_entries],
        },
        "current_hot_zone": {
            "rolling_summaries": rolling_summaries,
            "event_memories": event_memories,
            "pending_items": pending_items,
            "active_risks": active_risks,
            "lessons_learned": lessons,
        },
        "pyramid_review": build_pyramid_review(rolling_summaries, event_memories, suggestions),
        "suggestions": [item.to_dict() for item in suggestions],
        "coverage_gaps": coverage_gaps,
        "privacy": privacy.to_dict(),
    }

    report_path = output_dir / "consolidation-report.md"
    summary_path = output_dir / "consolidation-summary.json"
    report_path.write_text(
        render_report(
            handoffs=handoffs,
            active_plans=active_plans,
            pitfall_entries=pitfall_entries,
            rolling_summaries=rolling_summaries,
            event_memories=event_memories,
            pending_items=pending_items,
            active_risks=active_risks,
            lessons=lessons,
            suggestions=suggestions,
            coverage_gaps=coverage_gaps,
            privacy=privacy,
        ),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[{GENERATOR_NAME}] wrote {report_path}")
    print(f"[{GENERATOR_NAME}] wrote {summary_path}")
    print(f"- handoffs scanned: {len(handoffs)}")
    print(f"- active plans scanned: {len(active_plans)}")
    print(f"- pitfall entries scanned: {len(pitfall_entries)}")
    print(f"- suggestions: {len(suggestions)}")
    print(f"- coverage gaps: {len(coverage_gaps)}")
    print(f"- private docs skipped: {len(privacy.private_docs_skipped)}")
    print(f"- private blocks stripped: {privacy.private_blocks_stripped}")
    return 0


def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir


def collect_markdown_docs(
    path: Path,
    root: Path,
    privacy: PrivacyStats,
    *,
    limit: int | None = None,
    newest_first: bool = False,
) -> list[MarkdownDoc]:
    if not path.exists():
        return []

    files = [child for child in path.glob("*.md") if child.is_file() and child.name not in EXCLUDED_FILENAMES]
    if newest_first:
        files.sort(key=lambda item: item.stat().st_mtime, reverse=True)
    else:
        files.sort()
    if limit is not None:
        files = files[:limit]

    docs: list[MarkdownDoc] = []
    for file_path in files:
        body = load_public_markdown_body(file_path, root, privacy)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        docs.append(
            MarkdownDoc(
                path=file_path.relative_to(root).as_posix(),
                title=extract_title(body, file_path.stem),
                modified_at=iso_from_timestamp(file_path.stat().st_mtime),
                sections=parse_h2_sections(body),
            )
        )
    return docs


def collect_pitfall_entries(root: Path, privacy: PrivacyStats) -> list[PitfallEntry]:
    pitfalls_root = root / PITFALLS_DIR
    if not pitfalls_root.exists():
        return []

    entries: list[PitfallEntry] = []
    for file_path in sorted(pitfalls_root.glob("*.md")):
        if not file_path.is_file() or file_path.name in EXCLUDED_FILENAMES:
            continue
        body = load_public_markdown_body(file_path, root, privacy)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        entries.extend(parse_pitfall_entries(body, file_path, root))
    return entries


def collect_design_doc_titles(root: Path, privacy: PrivacyStats) -> set[str]:
    design_root = root / DESIGN_DOCS_DIR
    if not design_root.exists():
        return set()
    titles: set[str] = set()
    for file_path in sorted(design_root.glob("*.md")):
        if not file_path.is_file() or file_path.name in {"index.md", "TEMPLATE.md"}:
            continue
        body = load_public_markdown_body(file_path, root, privacy)
        if body is None or not body.strip():
            continue
        title = extract_title(body, file_path.stem)
        if title:
            titles.add(normalize_key(title))
    return titles


def load_named_table(path: Path, headers: tuple[str, ...], root: Path, privacy: PrivacyStats) -> list[dict[str, str]]:
    if not path.exists():
        return []

    text = load_public_markdown_body(path, root, privacy)
    if text is None:
        return []
    lines = text.splitlines()
    for index in range(len(lines) - 1):
        header = parse_table_row(lines[index])
        divider = parse_table_row(lines[index + 1])
        if not header or not divider:
            continue
        if tuple(header) != headers:
            continue

        rows: list[dict[str, str]] = []
        for row_index in range(index + 2, len(lines)):
            row = parse_table_row(lines[row_index])
            if not row:
                break
            if len(row) != len(header):
                continue
            mapped = {header[col]: row[col].strip() for col in range(len(header))}
            combined = " ".join(mapped.values())
            if not combined or is_placeholder_text(combined):
                continue
            rows.append(mapped)
        return rows
    return []


def parse_table_row(line: str) -> list[str] | None:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    cells = [cell.strip() for cell in stripped.strip("|").split("|")]
    if not cells:
        return None
    return cells


def strip_front_matter(text: str) -> str:
    if not text.startswith("---\n"):
        return text
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return text
    return parts[1]


def split_front_matter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}, text
    raw_meta = parts[0].splitlines()[1:]
    metadata: dict[str, str] = {}
    for line in raw_meta:
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


def load_public_markdown_body(path: Path, root: Path, privacy: PrivacyStats) -> str | None:
    text = path.read_text(encoding="utf-8")
    metadata, body = split_front_matter(text)
    if is_private_document(metadata):
        privacy.add_private_doc(path.relative_to(root).as_posix())
        return None
    stripped, strip_count = strip_private_blocks(body)
    privacy.add_private_blocks(strip_count)
    return stripped


def parse_h2_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in text.splitlines():
        if line.startswith("## "):
            current = line[3:].strip()
            sections.setdefault(current, [])
            continue
        if current is not None:
            sections[current].append(line)
    return sections


def parse_pitfall_entries(text: str, path: Path, root: Path) -> list[PitfallEntry]:
    entries: list[PitfallEntry] = []
    current_title: str | None = None
    current_section = "_summary"
    sections: dict[str, list[str]] = {}

    def flush_entry() -> None:
        nonlocal current_title, current_section, sections
        if not current_title:
            return
        status = extract_prefixed_value(sections.get("_summary", []), "状态")
        symptom = summarize_section(sections.get("现象", []))
        long_term_avoidance = summarize_section(sections.get("长期规避", []))
        verification = summarize_section(sections.get("验证方式", []))
        entries.append(
            PitfallEntry(
                path=path.relative_to(root).as_posix(),
                title=current_title,
                status=status or "未标注",
                symptom=symptom,
                long_term_avoidance=long_term_avoidance,
                verification=verification,
                modified_at=iso_from_timestamp(path.stat().st_mtime),
            )
        )
        current_title = None
        current_section = "_summary"
        sections = {}

    for line in text.splitlines():
        if line.startswith("## "):
            flush_entry()
            current_title = line[3:].strip()
            current_section = "_summary"
            sections = {"_summary": []}
            continue
        if current_title is None:
            continue
        if line.startswith("### "):
            current_section = line[4:].strip()
            sections.setdefault(current_section, [])
            continue
        sections.setdefault(current_section, []).append(line)

    flush_entry()
    return entries


def extract_prefixed_value(lines: list[str], label: str) -> str:
    for line in lines:
        payload = strip_list_prefix(line.strip())
        if not payload:
            continue
        matched = re.match(rf"^{re.escape(label)}\s*[:：]\s*(.+)$", payload)
        if matched:
            value = normalize_sentence(matched.group(1))
            if not is_placeholder_text(value):
                return value
    return ""


def summarize_section(lines: list[str]) -> str:
    items = extract_list_items(lines)
    if items:
        return "；".join(items[:2])

    chunks: list[str] = []
    for line in lines:
        normalized = normalize_sentence(line)
        if normalized and not is_placeholder_text(normalized):
            chunks.append(normalized)
        if len(" ".join(chunks)) >= 120:
            break
    return "；".join(chunks[:2])


def collect_rolling_summary_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_rollups: set[str],
) -> None:
    for doc in handoffs:
        summary = build_doc_summary(doc, ("本轮摘要", "已完成", "未完成 / 下一步"))
        add_rolling_summary_suggestion(
            suggestions,
            seen_keys,
            existing_rollups,
            source_path=doc.path,
            source_section="本轮摘要",
            text=summary,
            confidence="high",
            reason="最近 handoff 中存在跨会话上下文，适合压缩成 L1 滚动摘要以减少后续读取原文成本。",
        )

    for doc in active_plans:
        summary = build_doc_summary(doc, ("当前结论", "任务列表", "决策记录"))
        add_rolling_summary_suggestion(
            suggestions,
            seen_keys,
            existing_rollups,
            source_path=doc.path,
            source_section="当前结论",
            text=summary,
            confidence="medium",
            reason="active plan 中存在阶段性上下文；如果任务跨会话延续，适合收尾时压缩到 L1。",
        )


def add_rolling_summary_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_rollups: set[str],
    *,
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_rollups or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="rolling_summary",
            destination=".ch/docs/memory/ROLLING_SUMMARY.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "时间窗口": iso_now()[:10],
                "摘要": candidate,
                "覆盖来源": source_path,
                "保留原因": "跨会话上下文压缩",
                "下一次复核": "下次非平凡任务收尾",
            },
        ),
    )


def collect_event_memory_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_events: set[str],
) -> None:
    source_sections = ("本轮摘要", "已完成", "未完成 / 下一步", "当前结论", "决策记录", "风险与缓解")
    for doc in [*handoffs, *active_plans]:
        for section_name in source_sections:
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_event(text):
                    add_event_memory_suggestion(
                        suggestions,
                        seen_keys,
                        existing_events,
                        source_path=doc.path,
                        source_section=section_name,
                        text=text,
                        confidence="medium",
                        reason="来源中出现失败原因、成功方案、回滚、迁移或关键决策语义，适合抽取为 L2 事件记忆。",
                    )

    for entry in pitfall_entries:
        event_text = entry.title
        if entry.symptom:
            event_text = f"{entry.title}：{entry.symptom}"
        add_event_memory_suggestion(
            suggestions,
            seen_keys,
            existing_events,
            source_path=entry.path,
            source_section=entry.title,
            text=event_text,
            confidence="high",
            reason="pitfall 已经记录可复发问题，适合保留为 L2 事件索引，后续再上提到 L4 runbook 或 skill。",
        )


def add_event_memory_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_events: set[str],
    *,
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_events or is_placeholder_text(candidate):
        return
    event_type = classify_event_type(candidate)
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="event_memory",
            destination=".ch/docs/memory/EVENT_MEMORY.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "日期": iso_now()[:10],
                "类型": event_type,
                "事件": candidate,
                "结果/原因": "待确认",
                "可复用结论": "待提炼",
                "来源": source_path,
            },
        ),
    )


def collect_profile_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
) -> None:
    for doc in [*handoffs, *active_plans]:
        for section_name in ("本轮摘要", "当前结论", "决策记录", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_profile(text):
                    destination = profile_destination(text)
                    add_suggestion(
                        suggestions,
                        seen_keys,
                        Suggestion(
                            kind="profile_memory",
                            destination=destination,
                            confidence="medium",
                            source_path=doc.path,
                            source_section=section_name,
                            text=normalize_sentence(text),
                            reason="来源中出现长期用户偏好、项目约束或技术栈画像语义，可能应上提到 L3。",
                            draft_fields={
                                "建议位置": destination,
                                "建议条目": normalize_sentence(text),
                                "来源": doc.path,
                            },
                        ),
                    )


def collect_procedural_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_pitfalls: set[str],
) -> None:
    for doc in [*handoffs, *active_plans]:
        for section_name in ("当前结论", "决策记录", "风险与缓解", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                candidate = normalize_sentence(text)
                key = normalize_key(candidate)
                if not looks_like_procedural(candidate) or key in existing_pitfalls:
                    continue
                add_suggestion(
                    suggestions,
                    seen_keys,
                    Suggestion(
                        kind="procedural_experience",
                        destination=".ch/docs/runbooks/ or .agents/skills/",
                        confidence="medium",
                        source_path=doc.path,
                        source_section=section_name,
                        text=candidate,
                        reason="来源中出现可复用操作规则语义，可能应沉淀到 L4 runbook、checklist、skill 或脚本。",
                        draft_fields={
                            "建议容器": "先判断 runbook；如果可机械化再进入 skill/script",
                            "建议规则": candidate,
                            "来源": doc.path,
                        },
                    ),
                )

    for entry in pitfall_entries:
        if is_placeholder_text(entry.long_term_avoidance):
            continue
        add_suggestion(
            suggestions,
            seen_keys,
            Suggestion(
                kind="procedural_experience",
                destination=".ch/docs/runbooks/",
                confidence="high",
                source_path=entry.path,
                source_section=entry.title,
                text=entry.long_term_avoidance,
                reason="pitfall 已经有长期规避动作，适合进入 L4 程序性经验。",
                draft_fields={
                    "建议容器": ".ch/docs/runbooks/",
                    "建议规则": entry.long_term_avoidance,
                    "来源": entry.path,
                },
            ),
        )


def collect_pending_item_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_pending: set[str],
) -> None:
    for doc in handoffs:
        for text in extract_list_items(doc.sections.get("未完成 / 下一步", [])):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "未完成 / 下一步", text, "high")
        for text in extract_prefixed_items(
            doc.sections.get("本轮摘要", []),
            ("当前停在", "下一次接手时最先要知道"),
        ):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "本轮摘要", text, "medium")

    for doc in active_plans:
        for task in extract_checklist_items(doc.sections.get("任务列表", []), checked=False):
            add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "任务列表", task, "high")
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_open_loop(text):
                add_pending_item_suggestion(suggestions, seen_keys, existing_pending, doc.path, "当前结论", text, "medium")


def add_pending_item_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_pending: set[str],
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
) -> None:
    candidate = normalize_sentence(text)
    if is_placeholder_text(candidate):
        return
    key = normalize_key(candidate)
    if not key or key in existing_pending:
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="pending_item",
            destination=".ch/docs/memory/PENDING_ITEMS.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="最近 handoff 或 active plan 中仍有开放动作，但当前未进入 pending items 热区。",
            draft_fields={
                "事项": candidate,
                "状态": "open",
                "Owner": "待定",
                "来源": source_path,
                "下一步": candidate,
            },
        ),
    )


def collect_active_risk_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    existing_risks: set[str],
) -> None:
    for doc in active_plans:
        for risk, mitigation in extract_risk_pairs(doc.sections.get("风险与缓解", [])):
            add_active_risk_suggestion(
                suggestions,
                seen_keys,
                existing_risks,
                source_path=doc.path,
                source_section="风险与缓解",
                risk=risk,
                mitigation=mitigation,
                confidence="high",
                reason="active plan 已经明确记录风险，但当前热区没有对应 active risk。",
            )
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_risk(text):
                add_active_risk_suggestion(
                    suggestions,
                    seen_keys,
                    existing_risks,
                    source_path=doc.path,
                    source_section="当前结论",
                    risk=text,
                    mitigation="待补充",
                    confidence="medium",
                    reason="当前结论里出现了风险或不确定项，适合进入 active risks 热区跟踪。",
                )

    for doc in handoffs:
        for text in extract_list_items(doc.sections.get("未完成 / 下一步", [])):
            if looks_like_risk(text):
                add_active_risk_suggestion(
                    suggestions,
                    seen_keys,
                    existing_risks,
                    source_path=doc.path,
                    source_section="未完成 / 下一步",
                    risk=text,
                    mitigation="待补充",
                    confidence="medium",
                    reason="handoff 中存在待持续关注的风险，但当前热区未显式跟踪。",
                )

    for entry in pitfall_entries:
        if "有效" not in entry.status and "观察" not in entry.status:
            continue
        add_active_risk_suggestion(
            suggestions,
            seen_keys,
            existing_risks,
            source_path=entry.path,
            source_section=entry.title,
            risk=entry.title,
            mitigation=entry.long_term_avoidance or entry.verification or "待补充",
            confidence="medium",
            reason="pitfall 条目仍处于有效或需观察状态，说明它可能也应进入 active risks 热区。",
        )


def add_active_risk_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_risks: set[str],
    *,
    source_path: str,
    source_section: str,
    risk: str,
    mitigation: str,
    confidence: str,
    reason: str,
) -> None:
    candidate = normalize_sentence(risk)
    if is_placeholder_text(candidate):
        return
    key = normalize_key(candidate)
    if not key or key in existing_risks:
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="active_risk",
            destination=".ch/docs/memory/ACTIVE_RISKS.md",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason=reason,
            draft_fields={
                "风险": candidate,
                "影响": "待补充",
                "当前缓解": mitigation if not is_placeholder_text(mitigation) else "待补充",
                "来源": source_path,
            },
        ),
    )


def collect_lesson_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    pitfall_entries: list[PitfallEntry],
    existing_lessons: set[str],
) -> None:
    for entry in pitfall_entries:
        if is_placeholder_text(entry.long_term_avoidance):
            continue
        key = normalize_key(entry.title)
        if not key or key in existing_lessons:
            continue
        add_suggestion(
            suggestions,
            seen_keys,
            Suggestion(
                kind="lesson",
                destination=".ch/docs/memory/LESSONS_LEARNED.md",
                confidence="high",
                source_path=entry.path,
                source_section=entry.title,
                text=entry.title,
                reason="pitfall 已经沉淀出长期规避动作，适合压缩成热区 lesson 入口。",
                draft_fields={
                    "场景": entry.title,
                    "推荐动作": entry.long_term_avoidance,
                    "来源": entry.path,
                },
            ),
        )


def collect_pitfall_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    existing_pitfalls: set[str],
) -> None:
    source_sections = ("本轮摘要", "已完成", "未完成 / 下一步", "风险与缓解", "当前结论")
    for doc in [*handoffs, *active_plans]:
        for section_name in source_sections:
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_pitfall(text):
                    add_pitfall_suggestion(suggestions, seen_keys, existing_pitfalls, doc.path, section_name, text)


def add_pitfall_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    existing_pitfalls: set[str],
    source_path: str,
    source_section: str,
    text: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in existing_pitfalls or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="pitfall",
            destination=".ch/docs/runbooks/PITFALLS.md",
            confidence="medium",
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="handoff 或 plan 中出现了可复发的坑点语义，可能值得上提到 runbook / pitfalls。",
            draft_fields={
                "建议模块": "待判断",
                "建议条目": candidate,
                "来源": source_path,
            },
        ),
    )


def collect_design_suggestions(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    design_titles: set[str],
) -> None:
    for doc in active_plans:
        for text in extract_list_items(doc.sections.get("决策记录", [])):
            add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, "决策记录", text, "high")
        for text in extract_list_items(doc.sections.get("当前结论", [])):
            if looks_like_design(text):
                add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, "当前结论", text, "medium")

    for doc in handoffs:
        for section_name in ("本轮摘要", "已完成"):
            for text in extract_list_items(doc.sections.get(section_name, [])):
                if looks_like_design(text):
                    add_design_suggestion(suggestions, seen_keys, design_titles, doc.path, section_name, text, "medium")


def add_design_suggestion(
    suggestions: list[Suggestion],
    seen_keys: set[str],
    design_titles: set[str],
    source_path: str,
    source_section: str,
    text: str,
    confidence: str,
) -> None:
    candidate = normalize_sentence(text)
    key = normalize_key(candidate)
    if not key or key in design_titles or is_placeholder_text(candidate):
        return
    add_suggestion(
        suggestions,
        seen_keys,
        Suggestion(
            kind="design_doc",
            destination=".ch/docs/design-docs/",
            confidence=confidence,
            source_path=source_path,
            source_section=source_section,
            text=candidate,
            reason="计划或 handoff 中已经出现稳定决策语义，可能值得提升为设计文档事实来源。",
            draft_fields={
                "建议标题": make_design_title(candidate),
                "相关来源": source_path,
            },
        ),
    )


def build_coverage_gaps(
    *,
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    suggestions: list[Suggestion],
) -> list[str]:
    gaps: list[str] = []
    rolling_candidates = count_suggestions(suggestions, "rolling_summary")
    event_candidates = count_suggestions(suggestions, "event_memory")
    profile_candidates = count_suggestions(suggestions, "profile_memory")
    procedural_candidates = count_suggestions(suggestions, "procedural_experience")
    pending_candidates = count_suggestions(suggestions, "pending_item")
    risk_candidates = count_suggestions(suggestions, "active_risk")
    lesson_candidates = count_suggestions(suggestions, "lesson")
    pitfall_candidates = count_suggestions(suggestions, "pitfall")
    design_candidates = count_suggestions(suggestions, "design_doc")

    if active_plans and not handoffs:
        gaps.append("存在 active plans，但未扫描到最近 handoff；如果任务会跨会话继续，暂停前应补 handoff。")
    if rolling_candidates:
        gaps.append(
            f"发现 {rolling_candidates} 条 L1 滚动摘要候选；可压缩旧 handoff/active plan，降低后续 recall 成本。"
        )
    if event_candidates:
        gaps.append(
            f"发现 {event_candidates} 条 L2 事件记忆候选；可抽取失败原因、成功方案或关键决策。"
        )
    if profile_candidates:
        gaps.append(
            f"发现 {profile_candidates} 条 L3 用户/项目画像候选；确认是否应进入 `PROJECT_CONTEXT.md` 或 `USER_PREFERENCES.md`。"
        )
    if procedural_candidates:
        gaps.append(
            f"发现 {procedural_candidates} 条 L4 程序性经验候选；确认是否应进入 runbook、checklist、skill 或脚本。"
        )
    if pending_candidates:
        gaps.append(
            f"发现 {pending_candidates} 条 open-loop 候选尚未进入 `.ch/docs/memory/PENDING_ITEMS.md`。"
        )
    if risk_candidates:
        gaps.append(
            f"发现 {risk_candidates} 条风险候选尚未进入 `.ch/docs/memory/ACTIVE_RISKS.md`。"
        )
    if lesson_candidates:
        gaps.append(
            f"发现 {lesson_candidates} 条经验候选可从 pitfalls 上提到 `.ch/docs/memory/LESSONS_LEARNED.md`。"
        )
    if pitfall_candidates:
        gaps.append(
            f"发现 {pitfall_candidates} 条 handoff/plan 语义看起来像可复发坑点，值得考虑补入 `.ch/docs/runbooks/PITFALLS.md`。"
        )
    if design_candidates:
        gaps.append(
            f"发现 {design_candidates} 条稳定决策候选可能需要进入 `.ch/docs/design-docs/`，避免长期停留在计划或 handoff。"
        )
    if not pending_items and (handoffs or active_plans):
        gaps.append("当前已有 handoff 或 active plan，但 `PENDING_ITEMS.md` 仍为空；确认是否真的没有跨会话开放事项。")
    if not active_risks and risk_candidates:
        gaps.append("当前存在风险候选，但 `ACTIVE_RISKS.md` 为空；确认是否漏了热区风险跟踪。")
    if not lessons and lesson_candidates:
        gaps.append("当前已有 pitfall 的长期规避动作，但 `LESSONS_LEARNED.md` 为空；确认是否需要压缩成热区经验入口。")
    if not rolling_summaries and (handoffs or active_plans) and rolling_candidates:
        gaps.append("当前已有 handoff 或 active plan，但 `ROLLING_SUMMARY.md` 仍为空；确认是否需要建立第一条 L1 摘要。")
    if not event_memories and event_candidates:
        gaps.append("当前已有重要事件候选，但 `EVENT_MEMORY.md` 仍为空；确认是否需要建立第一条 L2 事件记忆。")
    return gaps


def build_pyramid_review(
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    suggestions: list[Suggestion],
) -> dict[str, object]:
    return {
        "l1_rolling_summary": {
            "tracked": len(rolling_summaries),
            "candidates": [item.to_dict() for item in suggestions if item.kind == "rolling_summary"],
        },
        "l2_event_memory": {
            "tracked": len(event_memories),
            "candidates": [item.to_dict() for item in suggestions if item.kind == "event_memory"],
        },
        "l3_user_project_profile": {
            "candidates": [item.to_dict() for item in suggestions if item.kind == "profile_memory"],
        },
        "l4_procedural_experience": {
            "candidates": [item.to_dict() for item in suggestions if item.kind == "procedural_experience"],
        },
    }


def count_suggestions(suggestions: list[Suggestion], kind: str) -> int:
    return sum(1 for item in suggestions if item.kind == kind)


def add_suggestion(suggestions: list[Suggestion], seen_keys: set[str], suggestion: Suggestion) -> None:
    key = f"{suggestion.kind}:{normalize_key(suggestion.text)}"
    if not suggestion.text or key in seen_keys:
        return
    seen_keys.add(key)
    suggestions.append(suggestion)


def extract_list_items(lines: list[str]) -> list[str]:
    items: list[str] = []
    for line in lines:
        payload = strip_list_prefix(line.strip())
        if not payload:
            continue
        if payload.startswith("[") and "]" in payload:
            payload = payload.split("]", 1)[1].strip()
        normalized = normalize_sentence(payload)
        if normalized and not is_placeholder_text(normalized):
            items.append(normalized)
    return items


def extract_checklist_items(lines: list[str], *, checked: bool) -> list[str]:
    items: list[str] = []
    pattern = re.compile(r"^[-*]\s+\[([ xX])\]\s+(.+)$")
    for line in lines:
        matched = pattern.match(line.strip())
        if not matched:
            continue
        is_checked = matched.group(1).lower() == "x"
        if is_checked != checked:
            continue
        text = normalize_sentence(matched.group(2))
        if text and not is_placeholder_text(text):
            items.append(text)
    return items


def extract_prefixed_items(lines: list[str], prefixes: tuple[str, ...]) -> list[str]:
    results: list[str] = []
    for line in lines:
        payload = strip_list_prefix(line.strip())
        if not payload:
            continue
        for prefix in prefixes:
            matched = re.match(rf"^{re.escape(prefix)}\s*[:：]\s*(.+)$", payload)
            if not matched:
                continue
            text = normalize_sentence(matched.group(1))
            if text and not is_placeholder_text(text):
                results.append(text)
            break
    return results


def extract_risk_pairs(lines: list[str]) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    current_risk = ""
    current_mitigation = ""

    def flush_pair() -> None:
        nonlocal current_risk, current_mitigation
        if current_risk and not is_placeholder_text(current_risk):
            pairs.append((normalize_sentence(current_risk), normalize_sentence(current_mitigation) or "待补充"))
        current_risk = ""
        current_mitigation = ""

    for line in lines:
        payload = strip_list_prefix(line.strip())
        if not payload:
            continue
        matched = re.match(r"^(风险|缓解)\s*[:：]\s*(.+)$", payload)
        if matched:
            label = matched.group(1)
            value = normalize_sentence(matched.group(2))
            if label == "风险":
                flush_pair()
                current_risk = value
            elif label == "缓解":
                current_mitigation = value
            continue
        if looks_like_risk(payload):
            flush_pair()
            current_risk = normalize_sentence(payload)

    flush_pair()
    return pairs


def strip_list_prefix(text: str) -> str:
    cleaned = re.sub(r"^[-*]\s+", "", text)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    return cleaned.strip()


def normalize_sentence(text: str) -> str:
    normalized = text.strip()
    normalized = re.sub(r"\[[^\]]+\]\(([^)]+)\)", r"\1", normalized)
    normalized = normalized.replace("`", "")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip(" -")


def normalize_key(text: str) -> str:
    cleaned = normalize_sentence(text).lower()
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "", cleaned)
    return cleaned[:120]


def looks_like_open_loop(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in OPEN_LOOP_KEYWORDS)


def looks_like_risk(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in RISK_KEYWORDS)


def looks_like_pitfall(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in PITFALL_KEYWORDS)


def looks_like_design(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in DESIGN_KEYWORDS)


def looks_like_event(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in EVENT_KEYWORDS)


def looks_like_profile(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in PROFILE_KEYWORDS)


def looks_like_procedural(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(keyword in candidate for keyword in PROCEDURAL_KEYWORDS)


def classify_event_type(text: str) -> str:
    candidate = normalize_sentence(text)
    if any(keyword in candidate for keyword in ("失败", "报错", "事故", "回滚", "阻塞")):
        return "failure"
    if any(keyword in candidate for keyword in ("成功", "修复", "解决", "方案")):
        return "success"
    if any(keyword in candidate for keyword in ("迁移", "上线")):
        return "migration"
    if any(keyword in candidate for keyword in ("决策", "决定", "策略")):
        return "decision"
    return "event"


def profile_destination(text: str) -> str:
    candidate = normalize_sentence(text)
    if any(keyword in candidate for keyword in USER_PROFILE_KEYWORDS):
        return ".ch/docs/memory/USER_PREFERENCES.md"
    return ".ch/docs/memory/PROJECT_CONTEXT.md"


def build_doc_summary(doc: MarkdownDoc, section_names: tuple[str, ...]) -> str:
    chunks: list[str] = []
    for section_name in section_names:
        lines = doc.sections.get(section_name, [])
        chunks.extend(extract_list_items(lines))
        chunks.extend(extract_checklist_items(lines, checked=False))
        if len(chunks) >= 3:
            break
    if chunks:
        return "；".join(chunks[:3])
    return ""


def make_design_title(text: str) -> str:
    compact = normalize_sentence(text)
    compact = re.sub(r"^\d{4}-\d{2}-\d{2}\s*[:：]\s*", "", compact)
    if len(compact) <= 28:
        return compact
    return compact[:28].rstrip() + "..."


def is_placeholder_text(text: str) -> bool:
    candidate = normalize_sentence(text).lower()
    if not candidate:
        return True
    if candidate in {"-", "todo", "tbd", "待定", "unknown"}:
        return True
    return any(hint in candidate for hint in STARTER_HINTS)


def is_starter_text(text: str) -> bool:
    candidate = normalize_sentence(text)
    return any(hint in candidate for hint in STARTER_HINTS)


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def render_report(
    *,
    handoffs: list[MarkdownDoc],
    active_plans: list[MarkdownDoc],
    pitfall_entries: list[PitfallEntry],
    rolling_summaries: list[dict[str, str]],
    event_memories: list[dict[str, str]],
    pending_items: list[dict[str, str]],
    active_risks: list[dict[str, str]],
    lessons: list[dict[str, str]],
    suggestions: list[Suggestion],
    coverage_gaps: list[str],
    privacy: PrivacyStats,
) -> str:
    lines = [
        "# Memory Consolidation Report",
        "",
        "## Summary",
        "",
        f"- Generated at: {iso_now()}",
        f"- Handoffs scanned: {len(handoffs)}",
        f"- Active plans scanned: {len(active_plans)}",
        f"- Pitfall entries scanned: {len(pitfall_entries)}",
        f"- Rolling summaries tracked: {len(rolling_summaries)}",
        f"- Event memories tracked: {len(event_memories)}",
        f"- Pending items tracked: {len(pending_items)}",
        f"- Active risks tracked: {len(active_risks)}",
        f"- Lessons tracked: {len(lessons)}",
        f"- Suggestions: {len(suggestions)}",
        f"- Coverage gaps: {len(coverage_gaps)}",
        f"- Private docs skipped: {len(privacy.private_docs_skipped)}",
        f"- Private blocks stripped: {privacy.private_blocks_stripped}",
        "",
        "## Sources Scanned",
        "",
    ]

    lines.extend(render_source_list("Recent handoffs", handoffs))
    lines.extend(render_source_list("Active plans", active_plans))
    lines.extend(render_pitfall_list(pitfall_entries))

    lines.extend(["## Memory Pyramid Review", ""])
    lines.extend(
        [
            f"- L1 rolling summaries tracked: {len(rolling_summaries)}; candidates: {count_suggestions(suggestions, 'rolling_summary')}",
            f"- L2 event memories tracked: {len(event_memories)}; candidates: {count_suggestions(suggestions, 'event_memory')}",
            f"- L3 user/project profile candidates: {count_suggestions(suggestions, 'profile_memory')}",
            f"- L4 procedural experience candidates: {count_suggestions(suggestions, 'procedural_experience')}",
            "",
        ]
    )

    lines.extend(render_suggestion_section("L1 Rolling Summary Candidates", suggestions, "rolling_summary"))
    lines.extend(render_suggestion_section("L2 Event Memory Candidates", suggestions, "event_memory"))
    lines.extend(render_suggestion_section("L3 User / Project Profile Candidates", suggestions, "profile_memory"))
    lines.extend(render_suggestion_section("L4 Procedural Experience Candidates", suggestions, "procedural_experience"))
    lines.extend(render_suggestion_section("Pending Item Candidates", suggestions, "pending_item"))
    lines.extend(render_suggestion_section("Active Risk Candidates", suggestions, "active_risk"))
    lines.extend(render_suggestion_section("Lesson Candidates", suggestions, "lesson"))
    lines.extend(render_suggestion_section("Pitfall Candidates", suggestions, "pitfall"))
    lines.extend(render_suggestion_section("Design Doc Candidates", suggestions, "design_doc"))

    lines.extend(["## Coverage Gaps", ""])
    if coverage_gaps:
        lines.extend(f"- {gap}" for gap in coverage_gaps)
    else:
        lines.append("- No obvious consolidation gaps found.")

    lines.extend(
        [
            "",
            "## Next Actions",
            "",
            "1. 先处理 `high` 置信度的 L1/L2、pending item、active risk、lesson 候选。",
            "2. 再判断 L3/L4、pitfall 和 design-doc 候选是否足够稳定，避免把临时信息过早上提。",
            "3. 完成压缩、抽取或上提后，重新运行 `memory-indexer`，必要时再跑 `memory-freshness-auditor`。",
            "",
        ]
    )
    return "\n".join(lines)


def render_source_list(title: str, docs: list[MarkdownDoc]) -> list[str]:
    lines = [f"### {title}", ""]
    if docs:
        lines.extend(f"- `{doc.path}` | updated={doc.modified_at}" for doc in docs)
    else:
        lines.append("- None")
    lines.append("")
    return lines


def render_pitfall_list(entries: list[PitfallEntry]) -> list[str]:
    lines = ["### Pitfall entries", ""]
    if entries:
        lines.extend(f"- `{entry.path}` | {entry.title} | 状态={entry.status}" for entry in entries)
    else:
        lines.append("- None")
    lines.append("")
    return lines


def render_suggestion_section(title: str, suggestions: list[Suggestion], kind: str) -> list[str]:
    lines = [f"## {title}", ""]
    filtered = [item for item in suggestions if item.kind == kind]
    if not filtered:
        lines.append("- No candidates.")
        lines.append("")
        return lines

    for item in filtered:
        draft = ", ".join(f"{key}={value}" for key, value in item.draft_fields.items())
        lines.extend(
            [
                (
                    f"- [{item.confidence}] `{item.source_path}` / `{item.source_section}`"
                    f" -> `{item.destination}`"
                ),
                f"  Candidate: {item.text}",
                f"  Why: {item.reason}",
                f"  Draft: `{draft}`",
                "",
            ]
        )
    return lines


if __name__ == "__main__":
    raise SystemExit(main())
