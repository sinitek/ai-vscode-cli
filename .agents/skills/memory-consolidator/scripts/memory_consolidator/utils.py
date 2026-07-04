"""Parsing, normalization, and shared helper functions."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from .constants import (
    DESIGN_KEYWORDS,
    EVENT_KEYWORDS,
    OPEN_LOOP_KEYWORDS,
    PITFALL_KEYWORDS,
    PRIVATE_TAG_RE,
    PROCEDURAL_KEYWORDS,
    PROFILE_KEYWORDS,
    RISK_KEYWORDS,
    STARTER_HINTS,
    USER_PROFILE_KEYWORDS,
)
from .models import MarkdownDoc, PrivacyStats, Suggestion

def resolve_output_dir(root: Path, output_dir_arg: str) -> Path:
    output_dir = Path(output_dir_arg)
    if output_dir.is_absolute():
        return output_dir
    return root / output_dir

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
