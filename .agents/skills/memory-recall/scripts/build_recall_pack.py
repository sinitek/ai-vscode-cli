#!/usr/bin/env python3
"""Build a bounded recall pack from harness memory artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from memory_recall.constants import (
    DEFAULT_FULL_COUNT,
    DEFAULT_HANDOFF_LIMIT,
    DEFAULT_INDEX_LIMIT,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_RELATED_LIMIT,
    DEFAULT_STALE_DAYS,
    DEFAULT_TIMELINE_DEPTH,
    DESIGN_DOCS_DIR,
    EXCLUDED_FILES,
    GENERATOR_NAME,
    GENERATOR_VERSION,
    RUNBOOK_EXCLUDED_FILES,
    RUNBOOKS_DIR,
)
from memory_recall.loaders import (
    build_claim_index,
    build_generated_entries,
    load_json,
    load_optional_claims,
    load_optional_json,
    resolve_output_dir,
    run_memory_indexer,
)
from memory_recall.related_docs import (
    collect_related_docs,
    select_active_plans,
    select_handoffs,
    select_hot_zone_docs,
)
from memory_recall.renderers import render_report, render_retrieval_debug
from memory_recall.selection import build_timeline_window, select_observations
from memory_recall.text_utils import dedupe_preserve_order, iso_now, tokenize_focus
from memory_recall.watch_items import (
    build_claim_status_summary,
    build_score_summary,
    build_selected_claims,
    build_source_diversity,
    build_watch_items,
    collect_selected_matched_terms,
    unique_selected_source_paths,
    watch_item_message,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a bounded recall pack from memory artifacts.")
    parser.add_argument("--root", default=".", help="Repository root.")
    parser.add_argument(
        "--output-dir",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory for generated recall files. Relative paths resolve from --root.",
    )
    parser.add_argument(
        "--focus",
        default="",
        help="Optional short focus phrase used to match observations, plans, design docs, and runbooks.",
    )
    parser.add_argument(
        "--related-limit",
        type=int,
        default=DEFAULT_RELATED_LIMIT,
        help="Maximum number of focus-matched design docs or runbooks to include per group.",
    )
    parser.add_argument(
        "--handoff-limit",
        type=int,
        default=DEFAULT_HANDOFF_LIMIT,
        help="Maximum number of recent handoffs to include.",
    )
    parser.add_argument(
        "--index-limit",
        type=int,
        default=DEFAULT_INDEX_LIMIT,
        help="Maximum observation index entries to include in recall-pack.md.",
    )
    parser.add_argument(
        "--full-count",
        type=int,
        default=DEFAULT_FULL_COUNT,
        help="How many selected observation entries to expand with details.",
    )
    parser.add_argument(
        "--anchor-id",
        default="",
        help="Optional observation ID such as mem-abc123. Adds a timeline window around that entry.",
    )
    parser.add_argument(
        "--timeline-depth",
        type=int,
        default=DEFAULT_TIMELINE_DEPTH,
        help="How many observations before and after --anchor-id to include.",
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=DEFAULT_STALE_DAYS,
        help="Freshness threshold passed to memory-indexer.",
    )
    parser.add_argument(
        "--skip-indexer",
        action="store_true",
        help="Use existing memory-index artifacts in --output-dir when present instead of regenerating them.",
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

    if not args.skip_indexer or not (output_dir / "summary.json").exists():
        run_memory_indexer(root, output_dir, args.stale_days)
    memory_summary = load_json(output_dir / "summary.json")
    consolidation_summary = load_optional_json(output_dir / "consolidation-summary.json")
    claims = load_optional_claims(output_dir, memory_summary)
    claim_index = build_claim_index(claims)
    focus_terms = tokenize_focus(args.focus)

    generated_docs = build_generated_entries(display_output_dir, memory_summary, consolidation_summary)
    observations, selection_debug = select_observations(
        memory_summary,
        focus_terms,
        args.index_limit,
        claim_index,
    )
    expanded_observations = observations[: max(0, args.full_count)]
    timeline_window = build_timeline_window(memory_summary, args.anchor_id.strip(), args.timeline_depth)
    hot_zone_docs = select_hot_zone_docs(memory_summary, focus_terms)
    handoffs = select_handoffs(root, focus_terms, args.handoff_limit)
    active_plans = select_active_plans(memory_summary, focus_terms, args.related_limit)
    design_docs = collect_related_docs(
        root / DESIGN_DOCS_DIR,
        root,
        focus_terms,
        args.related_limit,
        kind="design_doc",
        excluded=EXCLUDED_FILES | {"index.md"},
    )
    runbooks = collect_related_docs(
        root / RUNBOOKS_DIR,
        root,
        focus_terms,
        args.related_limit,
        kind="runbook",
        excluded=RUNBOOK_EXCLUDED_FILES,
    )
    selected_claims = build_selected_claims(observations, claim_index)
    watch_items = build_watch_items(memory_summary, consolidation_summary, selected_claims)
    selected_source_paths = unique_selected_source_paths(observations)
    selected_source_kinds = dedupe_preserve_order(item.source_kind for item in observations if item.source_kind)
    matched_terms = collect_selected_matched_terms(observations)
    score_summary = build_score_summary(observations)
    source_diversity = build_source_diversity(observations)
    selected_tokens = sum(item.read_tokens for item in observations)
    expanded_tokens = sum(item.read_tokens for item in expanded_observations)
    total_available = int(memory_summary.get("observation_count", 0) or 0)
    total_available_tokens = int(memory_summary.get("total_read_tokens", 0) or 0)

    report_path = output_dir / "recall-pack.md"
    summary_path = output_dir / "recall-summary.json"
    debug_path = output_dir / "retrieval-debug.md"
    summary_payload = {
        "generator": GENERATOR_NAME,
        "version": GENERATOR_VERSION,
        "generated_at": iso_now(),
        "repo_root": str(root),
        "focus": args.focus.strip(),
        "focus_terms": focus_terms,
        "anchor_id": args.anchor_id.strip(),
        "selection_mode": selection_debug["mode"],
        "available_observation_count": total_available,
        "selected_observation_count": len(observations),
        "selected_observation_ids": [item.id for item in observations],
        "generated_docs": [doc.to_dict() for doc in generated_docs],
        "selected_observations": [item.to_dict() for item in observations],
        "expanded_observation_ids": [item.id for item in expanded_observations],
        "selected_source_paths": selected_source_paths,
        "selected_source_kinds": selected_source_kinds,
        "matched_terms": matched_terms,
        "score": score_summary,
        "score_summary": score_summary,
        "source_diversity": source_diversity,
        "estimated_read_tokens": {
            "selected_total": selected_tokens,
            "expanded_total": expanded_tokens,
            "available_total": total_available_tokens,
        },
        "selected_claim_ids": [claim["claim_id"] for claim in selected_claims if claim.get("claim_id")],
        "selected_claims": selected_claims,
        "claim_status_summary": build_claim_status_summary(selected_claims),
        "watch_items": watch_items,
        "watch_item_messages": [watch_item_message(item) for item in watch_items],
        "retrieval_debug": {
            "file": f"{display_output_dir}/retrieval-debug.md",
            "candidate_count": selection_debug["candidate_count"],
            "ranked_candidate_count": selection_debug["ranked_candidate_count"],
            "focus_match_count": selection_debug["focus_match_count"],
            "focus_excluded_count": selection_debug["focus_excluded_count"],
            "heuristics": selection_debug["heuristics"],
            "top_unselected": selection_debug["top_unselected"],
        },
        "timeline_window": [item.to_dict() for item in timeline_window],
        "hot_zone_docs": [doc.to_dict() for doc in hot_zone_docs],
        "handoffs": [doc.to_dict() for doc in handoffs],
        "active_plans": [doc.to_dict() for doc in active_plans],
        "design_docs": [doc.to_dict() for doc in design_docs],
        "runbooks": [doc.to_dict() for doc in runbooks],
    }

    report_path.write_text(
        render_report(
            focus=args.focus.strip(),
            anchor_id=args.anchor_id.strip(),
            generated_docs=generated_docs,
            observations=observations,
            expanded_observations=expanded_observations,
            timeline_window=timeline_window,
            hot_zone_docs=hot_zone_docs,
            handoffs=handoffs,
            active_plans=active_plans,
            design_docs=design_docs,
            runbooks=runbooks,
            watch_items=watch_items,
            memory_summary=memory_summary,
            selection_mode=selection_debug["mode"],
            retrieval_debug_path=f"{display_output_dir}/retrieval-debug.md",
            source_diversity=source_diversity,
            matched_terms=matched_terms,
        ),
        encoding="utf-8",
    )
    summary_path.write_text(json.dumps(summary_payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    debug_path.write_text(
        render_retrieval_debug(
            focus=args.focus.strip(),
            focus_terms=focus_terms,
            anchor_id=args.anchor_id.strip(),
            observations=observations,
            selection_debug=selection_debug,
            source_diversity=source_diversity,
            selected_claims=selected_claims,
            watch_items=watch_items,
        ),
        encoding="utf-8",
    )

    print(f"[{GENERATOR_NAME}] wrote {report_path}")
    print(f"[{GENERATOR_NAME}] wrote {summary_path}")
    print(f"[{GENERATOR_NAME}] wrote {debug_path}")
    print(f"- focus: {args.focus.strip() or '(baseline)'}")
    print(f"- generated docs: {len(generated_docs)}")
    print(f"- selected observations: {len(observations)}")
    print(f"- expanded observations: {len(expanded_observations)}")
    print(f"- timeline window: {len(timeline_window)}")
    print(f"- hot zone docs: {len(hot_zone_docs)}")
    print(f"- handoffs: {len(handoffs)}")
    print(f"- active plans: {len(active_plans)}")
    print(f"- design docs: {len(design_docs)}")
    print(f"- runbooks: {len(runbooks)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
