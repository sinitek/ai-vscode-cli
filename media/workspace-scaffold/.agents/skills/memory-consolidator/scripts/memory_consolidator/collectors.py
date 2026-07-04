"""Collectors for memory source documents and hot-zone tables."""

from __future__ import annotations

import re
from pathlib import Path

from .constants import DESIGN_DOCS_DIR, EXCLUDED_FILENAMES, PITFALLS_DIR, PRIVATE_TAG_RE
from .models import MarkdownDoc, PitfallEntry, PrivacyStats
from .utils import (
    extract_title,
    is_placeholder_text,
    is_starter_text,
    iso_from_timestamp,
    normalize_key,
    normalize_sentence,
    strip_list_prefix,
)

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
