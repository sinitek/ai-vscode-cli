"""Selection helpers for hot-zone, handoff, plan, design, and runbook docs."""

from __future__ import annotations

from pathlib import Path

from .constants import EXCLUDED_FILES, HANDOFFS_DIR, HOT_ZONE_PRIORITY, HOT_ZONE_REASON
from .models import SelectedDoc
from .text_utils import (
    extract_headings,
    extract_summary,
    extract_title,
    find_matched_terms,
    is_starter_text,
    iso_from_timestamp,
    load_public_markdown_body,
)

def select_hot_zone_docs(memory_summary: dict[str, object], focus_terms: list[str]) -> list[SelectedDoc]:
    memory_docs = memory_summary.get("memory_docs", [])
    if not isinstance(memory_docs, list):
        return []

    selected: list[SelectedDoc] = []
    fallback: list[SelectedDoc] = []

    for raw_doc in memory_docs:
        if not isinstance(raw_doc, dict):
            continue
        path = str(raw_doc.get("path", ""))
        title = str(raw_doc.get("title", path))
        summary = str(raw_doc.get("summary", ""))
        starter = bool(raw_doc.get("starter"))
        base_priority = HOT_ZONE_PRIORITY.get(path, 50)
        matched_terms = find_matched_terms(
            focus_terms,
            " ".join(
                [
                    path,
                    title,
                    summary,
                    " ".join(str(item) for item in raw_doc.get("headings", []) if item),
                    " ".join(str(item) for item in raw_doc.get("references", []) if item),
                ]
            ),
        )
        score = 50 - base_priority + (len(matched_terms) * 4)
        doc = SelectedDoc(
            path=path,
            title=title,
            kind="hot_zone",
            reason=HOT_ZONE_REASON.get(path, "默认优先召回的热区入口。"),
            score=score,
            modified_at=str(raw_doc.get("modified_at", "")),
            matched_terms=matched_terms,
            summary=summary,
        )

        if starter and path not in {".ch/docs/MEMORY.md", ".ch/docs/memory/README.md"}:
            continue
        if path in {".ch/docs/MEMORY.md", ".ch/docs/memory/README.md"}:
            fallback.append(doc)
        else:
            selected.append(doc)

    selected.sort(key=lambda item: (-item.score, item.path))
    if not selected:
        return sorted(fallback, key=lambda item: HOT_ZONE_PRIORITY.get(item.path, 99))

    combined = selected[:7]
    for doc in sorted(fallback, key=lambda item: HOT_ZONE_PRIORITY.get(item.path, 99)):
        if doc.path not in {item.path for item in combined}:
            combined.append(doc)
    return combined[:9]


def select_handoffs(root: Path, focus_terms: list[str], limit: int) -> list[SelectedDoc]:
    handoff_dir = root / HANDOFFS_DIR
    if not handoff_dir.exists():
        return []

    docs: list[SelectedDoc] = []
    for path in sorted(handoff_dir.glob("*.md"), key=lambda item: item.stat().st_mtime, reverse=True):
        if path.name in EXCLUDED_FILES:
            continue
        body = load_public_markdown_body(path)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        title = extract_title(body, path.stem)
        summary = extract_summary(body)
        matched_terms = find_matched_terms(focus_terms, " ".join([path.as_posix(), title, summary, body[:1000]]))
        score = 30 + (len(matched_terms) * 5)
        docs.append(
            SelectedDoc(
                path=path.relative_to(root).as_posix(),
                title=title,
                kind="handoff",
                reason="最近一次跨会话收口入口，优先恢复当前停点和下一步。",
                score=score,
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (item.score, item.modified_at), reverse=True)
    return docs[:limit]


def select_active_plans(memory_summary: dict[str, object], focus_terms: list[str], limit: int) -> list[SelectedDoc]:
    active_plans = memory_summary.get("active_plans", [])
    if not isinstance(active_plans, list):
        return []

    docs: list[SelectedDoc] = []
    for raw_plan in active_plans:
        if not isinstance(raw_plan, dict):
            continue
        path = str(raw_plan.get("path", ""))
        title = str(raw_plan.get("title", path))
        summary = str(raw_plan.get("summary", "查看当前目标、任务列表、验证计划和下一步。"))
        matched_terms = find_matched_terms(focus_terms, f"{path} {title} {summary}")
        score = 20 + (len(matched_terms) * 6)
        docs.append(
            SelectedDoc(
                path=path,
                title=title,
                kind="active_plan",
                reason="当前任务推进中的 working-layer 事实来源。",
                score=score,
                modified_at=str(raw_plan.get("modified_at", "")),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (item.score, item.modified_at), reverse=True)
    return docs[:limit]


def collect_related_docs(
    base_dir: Path,
    root: Path,
    focus_terms: list[str],
    limit: int,
    *,
    kind: str,
    excluded: set[str],
) -> list[SelectedDoc]:
    if not focus_terms or not base_dir.exists():
        return []

    docs: list[SelectedDoc] = []
    for path in sorted(base_dir.rglob("*.md")):
        if not path.is_file() or path.name in excluded:
            continue
        body = load_public_markdown_body(path)
        if body is None:
            continue
        if is_starter_text(body):
            continue
        title = extract_title(body, path.stem)
        summary = extract_summary(body)
        headings = extract_headings(body)
        matched_terms = find_matched_terms(
            focus_terms,
            " ".join([path.relative_to(root).as_posix(), title, summary, " ".join(headings), body[:1500]]),
        )
        if not matched_terms:
            continue
        score = compute_focus_score(path.relative_to(root).as_posix(), title, headings, summary, body, matched_terms)
        docs.append(
            SelectedDoc(
                path=path.relative_to(root).as_posix(),
                title=title,
                kind=kind,
                reason=related_reason(kind, matched_terms),
                score=score,
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                matched_terms=matched_terms,
                summary=summary,
            )
        )

    docs.sort(key=lambda item: (-item.score, item.path))
    return docs[:limit]


def related_reason(kind: str, matched_terms: list[str]) -> str:
    joined = " / ".join(matched_terms)
    if kind == "design_doc":
        return f"与当前 focus 相关的设计决策入口，命中：{joined}。"
    return f"与当前 focus 相关的排障或规避动作入口，命中：{joined}。"


def compute_focus_score(
    path: str,
    title: str,
    headings: list[str],
    summary: str,
    body: str,
    matched_terms: list[str],
) -> int:
    score = 0
    title_lower = title.lower()
    path_lower = path.lower()
    headings_lower = " ".join(headings).lower()
    summary_lower = summary.lower()
    body_lower = body.lower()
    for term in matched_terms:
        if term in title_lower:
            score += 10
        if term in path_lower:
            score += 6
        if term in headings_lower:
            score += 5
        if term in summary_lower:
            score += 3
        if term in body_lower:
            score += 1
    return score
