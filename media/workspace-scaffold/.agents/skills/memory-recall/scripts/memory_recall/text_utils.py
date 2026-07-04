"""Text parsing and matching helpers."""

from __future__ import annotations

import re
from datetime import UTC, datetime
from pathlib import Path

from .constants import CJK_BIGRAM_RE, CJK_TOKEN_RE, PRIVATE_TAG_RE, STARTER_HINTS

def tokenize_focus(text: str) -> list[str]:
    lowered = text.strip().lower()
    if not lowered:
        return []
    terms: list[str] = []
    for token in re.findall(r"[a-z0-9_.-]+|[\u4e00-\u9fff]{2,}", lowered):
        normalized = token.strip(" .-_")
        if len(normalized) < 2:
            continue
        append_term(terms, normalized)
        if contains_cjk(normalized):
            for expanded in expand_cjk_terms(normalized):
                append_term(terms, expanded)
    return terms[:8]

def dedupe_preserve_order(items) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in items:
        item = str(raw)
        if not item or item in seen:
            continue
        seen.add(item)
        ordered.append(item)
    return ordered


def strip_front_matter(text: str) -> str:
    return split_front_matter(text)[1]


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


def load_public_markdown_body(path: Path) -> str | None:
    text = path.read_text(encoding="utf-8")
    metadata, body = split_front_matter(text)
    if is_private_document(metadata):
        return None
    stripped, _strip_count = strip_private_blocks(body)
    return stripped


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
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or line.startswith("|") or line.startswith("```"):
            if lines:
                break
            continue
        normalized = strip_list_prefix(line)
        if normalized:
            lines.append(normalized)
        if len(" ".join(lines)) >= 160:
            break
    return " ".join(lines).strip() or "暂无摘要。"


def strip_list_prefix(text: str) -> str:
    cleaned = re.sub(r"^[-*]\s+", "", text)
    cleaned = re.sub(r"^\d+\.\s+", "", cleaned)
    cleaned = re.sub(r"^\[[ xX]\]\s+", "", cleaned)
    return cleaned.strip()


def find_matched_terms(terms: list[str], haystack: str) -> list[str]:
    lowered = haystack.lower()
    matched: list[str] = []
    haystack_terms = build_haystack_terms(lowered)
    for term in terms:
        if term in haystack_terms and term not in matched:
            matched.append(term)
    return matched


def append_term(terms: list[str], term: str) -> None:
    if term and term not in terms:
        terms.append(term)


def contains_cjk(text: str) -> bool:
    return bool(CJK_TOKEN_RE.search(text))


def expand_cjk_terms(token: str) -> list[str]:
    expanded: list[str] = []
    normalized = token.strip()
    if len(normalized) < 2:
        return expanded
    append_term(expanded, normalized)
    if len(normalized) <= 4:
        return expanded
    for match in CJK_BIGRAM_RE.finditer(normalized):
        append_term(expanded, match.group(1))
    return expanded


def build_haystack_terms(text: str) -> set[str]:
    terms: set[str] = set()
    for token in re.findall(r"[a-z0-9_.-]+|[\u3400-\u4dbf\u4e00-\u9fff]{2,}", text):
        normalized = token.strip(" .-_")
        if len(normalized) < 2:
            continue
        terms.add(normalized)
        if contains_cjk(normalized):
            terms.update(expand_cjk_terms(normalized))
    return terms


def is_starter_text(text: str) -> bool:
    lowered = text.lower()
    return any(hint in lowered for hint in STARTER_HINTS)


def iso_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_from_timestamp(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, tz=UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
