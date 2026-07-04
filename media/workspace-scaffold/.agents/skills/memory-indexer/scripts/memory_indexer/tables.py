"""Markdown table loading and row rendering helpers."""

from __future__ import annotations

from pathlib import Path

from .privacy import is_private_document, split_front_matter, strip_private_blocks
from .text_utils import clean_inline, iso_from_timestamp


def load_named_table(
    path: Path,
    headers: tuple[str, ...],
    rel_path: str,
) -> tuple[list[dict[str, str]], str | None, int, str]:
    if not path.exists():
        return [], None, 0, ""
    modified_at = iso_from_timestamp(path.stat().st_mtime)
    text = path.read_text(encoding="utf-8")
    metadata, body = split_front_matter(text)
    if is_private_document(metadata):
        return [], rel_path, 0, metadata.get("last_verified_at", "").strip() or modified_at
    text, strip_count = strip_private_blocks(body)
    review_reference = metadata.get("last_verified_at", "").strip() or modified_at
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
            if is_placeholder_row(mapped):
                continue
            rows.append(mapped)
        return rows, None, strip_count, review_reference
    return [], None, strip_count, review_reference


def resolve_table_row_anchor(row: dict[str, str], source_kind: str) -> str:
    if source_kind == "pending_item":
        return clean_inline(row.get("事项", ""))
    if source_kind == "active_risk":
        return clean_inline(row.get("风险", ""))
    if source_kind == "lesson":
        return clean_inline(row.get("场景", ""))
    return clean_inline(next(iter(row.values()), ""))


def render_table_row_claim_text(row: dict[str, str], source_kind: str) -> str:
    if source_kind == "pending_item":
        title = clean_inline(row.get("事项", ""))
        next_step = clean_inline(row.get("下一步", ""))
        status = clean_inline(row.get("状态", ""))
        if not title:
            return ""
        parts = [title]
        if next_step:
            parts.append(f"下一步：{next_step}")
        if status:
            parts.append(f"状态：{status}")
        return "；".join(parts)
    if source_kind == "active_risk":
        title = clean_inline(row.get("风险", ""))
        impact = clean_inline(row.get("影响", ""))
        mitigation = clean_inline(row.get("当前缓解", ""))
        if not title:
            return ""
        parts = [title]
        if impact:
            parts.append(f"影响：{impact}")
        if mitigation:
            parts.append(f"缓解：{mitigation}")
        return "；".join(parts)
    if source_kind == "lesson":
        scenario = clean_inline(row.get("场景", ""))
        action = clean_inline(row.get("推荐动作", ""))
        if not scenario or not action:
            return ""
        return f"{scenario}：推荐动作是 {action}"
    return ""


def parse_table_row(line: str) -> list[str] | None:
    stripped = line.strip()
    if not stripped.startswith("|") or not stripped.endswith("|"):
        return None
    cells = [cell.strip() for cell in stripped.strip("|").split("|")]
    if not cells:
        return None
    if all(set(cell) <= {"-", ":"} for cell in cells):
        return cells
    return cells


def is_placeholder_row(row: dict[str, str]) -> bool:
    combined = " ".join(row.values())
    return not combined or "starter 默认" in combined or combined == "---"
