"""Markdown extraction and classification helpers."""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .constants import (
    CLAIM_TYPE_BY_MEMORY_TYPE,
    PATH_PREFIXES,
    PYRAMID_LEVEL_BY_MEMORY_TYPE,
    REVIEW_AFTER_DAYS_BY_CLAIM_TYPE,
    SHORT_BULLET_MAX_LENGTH,
    STARTER_HINTS,
)
from .models import MemoryDoc, MemoryObservation
from .text_utils import clean_inline, parse_iso, shorten, strip_list_prefix


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def extract_headings(text: str) -> list[str]:
    headings: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            cleaned = stripped.lstrip("#").strip()
            if cleaned:
                headings.append(cleaned)
    return headings


def extract_summary(text: str) -> str:
    lines = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("|") or line.startswith("```"):
            if lines:
                break
            continue
        normalized = strip_list_prefix(line)
        if normalized:
            lines.append(normalized)
        if len(" ".join(lines)) >= 180:
            break
    summary = " ".join(lines).strip()
    return shorten(summary, 220) if summary else "暂无摘要。"


def extract_references(text: str) -> list[str]:
    found: set[str] = set()

    for match in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        candidate = match.strip()
        if candidate.startswith("http://") or candidate.startswith("https://"):
            continue
        found.add(normalize_reference_path(candidate))

    for match in re.findall(r"`([^`\n]+)`", text):
        candidate = match.strip()
        if candidate.startswith(PATH_PREFIXES):
            found.add(candidate)

    return sorted(found)


def normalize_reference_path(candidate: str) -> str:
    normalized = candidate.strip()
    if normalized.startswith("./"):
        return normalized.removeprefix("./")
    return normalized


def detect_category(path: Path, memory_type: str | None) -> str:
    if path.name == "MEMORY.md":
        return "memory-rules"
    if memory_type in {"rolling_summary", "event_memory"}:
        return "memory-pyramid"
    return "hot-memory"


def detect_pyramid_level(memory_type: str | None) -> str:
    if not memory_type:
        return "unclassified"
    return PYRAMID_LEVEL_BY_MEMORY_TYPE.get(memory_type, "operational_hot_zone")


def count_by_pyramid_level(memory_docs: list[MemoryDoc]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for doc in memory_docs:
        counts[doc.pyramid_level] = counts.get(doc.pyramid_level, 0) + 1
    return dict(sorted(counts.items()))


def build_topic_summary(observations: list[MemoryObservation]) -> dict[str, dict[str, object]]:
    summary: dict[str, dict[str, object]] = {}
    for observation in observations:
        bucket = summary.setdefault(observation.topic, {"count": 0, "read_tokens": 0, "ids": []})
        bucket["count"] = int(bucket["count"]) + 1
        bucket["read_tokens"] = int(bucket["read_tokens"]) + observation.read_tokens
        ids = bucket["ids"]
        if isinstance(ids, list):
            ids.append(observation.id)
    return dict(sorted(summary.items(), key=lambda item: (-int(item[1]["count"]), item[0])))


def is_starter_text(text: str) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in STARTER_HINTS)


def classify_freshness(
    modified_at: str,
    last_verified_at: str | None,
    starter: bool,
    stale_days: int,
) -> str:
    if starter:
        return "starter"

    reference = last_verified_at or modified_at
    try:
        age_days = (datetime.now(UTC) - parse_iso(reference)).days
    except ValueError:
        return "unknown"
    return "stale" if age_days > stale_days else "fresh"


def detect_concepts(text: str) -> list[str]:
    lowered = text.lower()
    concepts: list[str] = []
    keyword_map = [
        ("active-risk", ("风险", "risk", "阻塞", "blocker", "blocked", "卡住")),
        ("open-loop", ("待", "未", "pending", "next", "下一步", "跟进", "继续")),
        ("decision", ("决策", "decision", "trade-off", "权衡", "策略")),
        ("problem-solution", ("失败", "修复", "解决", "bug", "报错", "方案")),
        ("gotcha", ("坑", "gotcha", "陷阱", "避免", "不要", "注意")),
        ("pattern", ("模式", "pattern", "复用", "经验", "lesson")),
        ("procedure", ("流程", "步骤", "procedure", "runbook", "skill", "脚本", "必须")),
        ("context", ("上下文", "context", "项目", "技术栈", "约束")),
        ("source-linked", (".ch/", "src/", "apps/", "packages/", "scripts/", "tests/")),
    ]
    for concept, keywords in keyword_map:
        if any(keyword in lowered for keyword in keywords):
            concepts.append(concept)
    return concepts or ["general"]


def infer_claim_type_for_front_matter(key: str, memory_type: str) -> str:
    if key in {"source_of_truth", "related_paths", "scope"}:
        return "fact"
    if key in {"supersedes", "derived_from", "status"}:
        return "decision"
    return CLAIM_TYPE_BY_MEMORY_TYPE.get(memory_type, "fact")


def infer_claim_type_from_text(text: str, memory_type: str) -> str:
    lowered = text.lower()
    if any(keyword in lowered for keyword in ("风险", "risk", "blocker", "阻塞")):
        return "risk"
    if any(keyword in lowered for keyword in ("必须", "should", "需要", "下一步", "建议", "推荐", "run", "执行")):
        return "instruction"
    if any(keyword in lowered for keyword in ("偏好", "preference", "prefer")):
        return "preference"
    if any(keyword in lowered for keyword in ("假设", "hypothesis", "待确认", "可能")):
        return "hypothesis"
    if any(keyword in lowered for keyword in ("决策", "decision", "采用", "固定为", "不应", "禁止")):
        return "decision"
    return CLAIM_TYPE_BY_MEMORY_TYPE.get(memory_type, "fact")


def normalize_claim_value(value: str) -> str:
    normalized = clean_inline(value.strip("[]"))
    if not normalized or normalized in {"[]", "-"}:
        return ""
    return normalized


def normalize_claim_status(value: str) -> str:
    lowered = clean_inline(value).lower()
    allowed = {"active", "superseded", "archived", "disputed", "needs_verification"}
    if lowered in allowed:
        return lowered
    if lowered in {"open", "todo", "pending", "in_progress"}:
        return "active"
    if lowered in {"stale", "unknown"}:
        return "needs_verification"
    return "active"


def compute_review_after(reference: str, claim_type: str) -> str:
    days = REVIEW_AFTER_DAYS_BY_CLAIM_TYPE.get(claim_type, 60)
    try:
        base = parse_iso(reference)
    except ValueError:
        base = datetime.now(UTC)
    return (base + timedelta(days=days)).date().isoformat()


def is_short_claim_bullet(line: str) -> bool:
    if not line:
        return False
    if not re.match(r"^([-*]|\d+\.)\s+", line):
        return False
    text = strip_list_prefix(line)
    if not text or len(text) > SHORT_BULLET_MAX_LENGTH:
        return False
    if line.startswith("- [") or line.startswith("* ["):
        return False
    return True


def should_skip_claim_text(text: str) -> bool:
    lowered = text.lower()
    if len(text) < 8:
        return True
    if "starter 默认" in text or "当前没有" in text:
        return True
    if text.startswith("`") and text.endswith("`"):
        return True
    if re.search(r"https?://", text):
        return True
    if lowered.startswith("例如") or lowered.startswith("example"):
        return True
    return False


def next_nonempty_line_is_table(lines: list[str], start_index: int) -> bool:
    for line in lines[start_index + 1 :]:
        stripped = line.strip()
        if not stripped:
            continue
        return stripped.startswith("|")
    return False


def choose_topic(obs_type: str, concepts: list[str]) -> str:
    if obs_type in {"risk", "pending", "event", "lesson", "plan"}:
        return obs_type
    for concept in concepts:
        if concept != "general":
            return concept
    return obs_type or "general"
