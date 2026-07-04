"""Collect memory documents and active execution plans."""

from __future__ import annotations

from pathlib import Path

from .constants import ACTIVE_PLANS_DIR, MEMORY_DIR, MEMORY_RULES
from .extractors import (
    classify_freshness,
    detect_category,
    detect_pyramid_level,
    extract_headings,
    extract_references,
    extract_summary,
    extract_title,
    is_starter_text,
)
from .models import ActivePlan, ClaimSourceDoc, MemoryDoc
from .privacy import is_private_document, split_front_matter, strip_private_blocks
from .text_utils import estimate_tokens, iso_from_timestamp


def collect_memory_docs(root: Path, stale_days: int) -> tuple[list[MemoryDoc], list[str], list[ClaimSourceDoc]]:
    docs: list[MemoryDoc] = []
    privacy_skips: list[str] = []
    claim_source_docs: list[ClaimSourceDoc] = []
    candidates = [root / MEMORY_RULES]
    memory_dir = root / MEMORY_DIR
    if memory_dir.exists():
        candidates.extend(sorted(memory_dir.glob("*.md")))

    for path in candidates:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        metadata, body = split_front_matter(text)
        rel_path = path.relative_to(root).as_posix()
        if is_private_document(metadata):
            privacy_skips.append(rel_path)
            continue
        stripped_body, strip_count = strip_private_blocks(body)
        modified_at = iso_from_timestamp(path.stat().st_mtime)
        last_verified = metadata.get("last_verified_at")
        status = metadata.get("status")
        source_of_truth = metadata.get("source_of_truth")
        memory_type = metadata.get("memory_type") or metadata.get("doc_type") or ""
        headings = extract_headings(stripped_body)
        summary = extract_summary(stripped_body)
        references = extract_references(stripped_body)
        starter = is_starter_text(text)
        freshness = classify_freshness(modified_at, last_verified, starter, stale_days)
        docs.append(
            MemoryDoc(
                path=rel_path,
                title=extract_title(stripped_body, path.stem),
                category=detect_category(path, memory_type),
                pyramid_level=detect_pyramid_level(memory_type),
                memory_type=memory_type,
                summary=summary,
                headings=headings[:8],
                references=references,
                modified_at=modified_at,
                last_verified_at=last_verified,
                status=status,
                source_of_truth=source_of_truth,
                starter=starter,
                freshness=freshness,
                read_tokens=estimate_tokens(summary, " ".join(headings[:4])),
                privacy_stripped_count=strip_count,
            )
        )
        claim_source_docs.append(
            ClaimSourceDoc(
                path=rel_path,
                title=extract_title(stripped_body, path.stem),
                memory_type=memory_type,
                status=status,
                source_of_truth=source_of_truth,
                modified_at=modified_at,
                last_verified_at=last_verified,
                starter=starter,
                metadata=metadata,
                stripped_body=stripped_body,
            )
        )
    return docs, privacy_skips, claim_source_docs


def collect_active_plans(root: Path) -> tuple[list[ActivePlan], list[str]]:
    plans_dir = root / ACTIVE_PLANS_DIR
    if not plans_dir.exists():
        return [], []

    plans: list[ActivePlan] = []
    privacy_skips: list[str] = []
    for path in sorted(plans_dir.glob("*.md")):
        if path.name.startswith("."):
            continue
        text = path.read_text(encoding="utf-8")
        metadata, body = split_front_matter(text)
        rel_path = path.relative_to(root).as_posix()
        if is_private_document(metadata):
            privacy_skips.append(rel_path)
            continue
        stripped, strip_count = strip_private_blocks(body)
        plans.append(
            ActivePlan(
                path=rel_path,
                title=extract_title(stripped, path.stem),
                modified_at=iso_from_timestamp(path.stat().st_mtime),
                summary=extract_summary(stripped),
                references=extract_references(stripped),
                read_tokens=estimate_tokens(stripped),
                privacy_stripped_count=strip_count,
            )
        )
    return plans, privacy_skips
