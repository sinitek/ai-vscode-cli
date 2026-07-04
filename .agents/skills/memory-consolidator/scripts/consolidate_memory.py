#!/usr/bin/env python3
"""Generate a low-noise memory consolidation report for the harness docs system."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from memory_consolidator.collectors import collect_design_doc_titles, collect_markdown_docs, collect_pitfall_entries, load_named_table
from memory_consolidator.constants import (
    ACTIVE_PLANS_DIR,
    ACTIVE_RISKS_HEADERS,
    DEFAULT_HANDOFF_LIMIT,
    DEFAULT_OUTPUT_DIR,
    EVENT_MEMORY_HEADERS,
    GENERATOR_NAME,
    GENERATOR_VERSION,
    HANDOFFS_DIR,
    LESSONS_HEADERS,
    MEMORY_DIR,
    PENDING_ITEMS_HEADERS,
    ROLLING_SUMMARY_HEADERS,
)
from memory_consolidator.coverage import build_coverage_gaps, build_pyramid_review
from memory_consolidator.models import PrivacyStats, Suggestion
from memory_consolidator.renderers import render_report
from memory_consolidator.suggestions import (
    collect_active_risk_suggestions,
    collect_design_suggestions,
    collect_event_memory_suggestions,
    collect_lesson_suggestions,
    collect_pending_item_suggestions,
    collect_pitfall_suggestions,
    collect_procedural_suggestions,
    collect_profile_suggestions,
    collect_rolling_summary_suggestions,
)
from memory_consolidator.utils import iso_now, normalize_key, resolve_output_dir


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


if __name__ == "__main__":
    raise SystemExit(main())
